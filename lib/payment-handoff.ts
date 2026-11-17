// "Pay on your phone": the desktop checkout shows a QR code with a one-time code. Scanned on the buyer's phone (signed
// in as the same buyer) it opens the same unpaid order's payment form, so Apple Pay / Google Pay can be used there.
// Codes are random, stored only as a SHA-256 hash, work once, and expire after 10 minutes.
import {createHash,randomBytes} from 'node:crypto';
import {z} from 'zod';
import {getPool} from '../db/postgres';
import {ApiRequestError} from './api-security';
import {usAddressSchema,type UsAddress} from './us-address';

export const HANDOFF_TTL_MS=10*60_000;
const hash=(token:string)=>createHash('sha256').update(token).digest('hex');

export async function createPaymentHandoff(userId:string,raw:Record<string,unknown>){
 const {orderId}=z.object({action:z.literal('payment_handoff'),orderId:z.string().min(1).max(100)}).strict().parse(raw);
 const order=await getPool().query<{status:string}>('SELECT status FROM ch_web.commerce_orders WHERE id=$1 AND buyer_user_id=$2',[orderId,userId]);
 if(!order.rows.length)throw new ApiRequestError('Order not found.',404);
 if(order.rows[0].status!=='awaiting_payment')throw new ApiRequestError('This order is no longer waiting for payment.',409);
 const recent=await getPool().query<{n:string}>("SELECT count(*)::text AS n FROM ch_web.payment_handoffs WHERE user_id=$1 AND created_at>now()-interval '10 minutes'",[userId]);
 if(Number(recent.rows[0]?.n)>=10)throw new ApiRequestError('Too many phone codes. Wait a few minutes and try again.',429);
 const token=randomBytes(32).toString('base64url'),expiresAt=new Date(Date.now()+HANDOFF_TTL_MS).toISOString();
 await getPool().query('INSERT INTO ch_web.payment_handoffs(token_hash,order_id,user_id,expires_at) VALUES($1,$2,$3,$4)',[hash(token),orderId,userId,expiresAt]);
 return {token,expiresAt};
}

/** Uses the code once. Returns the order to open; the caller re-checks it with the normal buyer payment rules. */
export async function redeemPaymentHandoff(userId:string,raw:Record<string,unknown>){
 const {token}=z.object({action:z.literal('redeem_handoff'),token:z.string().min(20).max(100)}).strict().parse(raw);
 const used=await getPool().query<{order_id:string;user_id:string}>(
  'UPDATE ch_web.payment_handoffs SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() RETURNING order_id,user_id',[hash(token)]);
 const row=used.rows[0];
 if(!row)throw new ApiRequestError('This code has expired or was already used. Make a new one on your computer.',410);
 if(row.user_id!==userId)throw new ApiRequestError('Sign in on your phone with the same account you used on your computer.',403);
 return row.order_id;
}

// ---- Private saved shipping address (prefills checkout) ----
export async function savedBuyerAddress(userId:string):Promise<UsAddress|null>{
 const own=await getPool().query<{shipping_address:string}>('SELECT shipping_address FROM ch_web.buyer_addresses WHERE user_id=$1',[userId]).catch(()=>({rows:[]as {shipping_address:string}[]}));
 const card=own.rows.length?own.rows:(await getPool().query<{shipping_address:string}>("SELECT shipping_address FROM ch_web.buyer_saved_cards WHERE user_id=$1 AND shipping_address<>'' ORDER BY updated_at DESC LIMIT 1",[userId]).catch(()=>({rows:[]as {shipping_address:string}[]}))).rows;
 for(const r of card){try{const parsed=usAddressSchema.safeParse(JSON.parse(r.shipping_address));if(parsed.success)return parsed.data}catch{/* unreadable: ignore */}}
 return null;
}
export async function saveBuyerAddress(userId:string,raw:Record<string,unknown>){
 const {shippingAddress}=z.object({action:z.literal('save_buyer_address'),shippingAddress:usAddressSchema}).strict().parse(raw);
 await getPool().query('INSERT INTO ch_web.buyer_addresses(user_id,shipping_address) VALUES($1,$2) ON CONFLICT (user_id) DO UPDATE SET shipping_address=EXCLUDED.shipping_address,updated_at=now()',[userId,JSON.stringify(shippingAddress)]);
 return {saved:true};
}
