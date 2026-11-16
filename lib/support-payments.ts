// "Support ComicHuddle": one-time payments to ComicHuddle (Malik LLC) itself, through Stripe Checkout on the
// platform account. Not Connect, no seller, no fee split. They never touch wallet balance, reward points or
// store credit (those live in other tables and only count marketplace orders). A payment is recorded as paid
// only from the signed Stripe webhook; the thank-you page never marks anything paid.
import {z} from 'zod';
import {getPool} from '../db/postgres';
import type {StripeVerifiedEvent} from './stripe-sandbox';

export const SUPPORT_PRESETS_CENTS=[500,1000,2500] as const;
export const SUPPORT_MIN_CENTS=100,SUPPORT_MAX_CENTS=50000;
export const SUPPORT_DISCLOSURE='Your support goes directly to ComicHuddle (Malik LLC) to keep the site running and improving. Contributions aren’t charitable donations and aren’t tax-deductible.';
export const supportRequestSchema=z.object({amountCents:z.number().int().min(SUPPORT_MIN_CENTS,'The minimum is $1.').max(SUPPORT_MAX_CENTS,'The maximum is $500.')}).strict();

type SupportProcessor={createSupportCheckout(input:{supportId:string;amountCents:number;successUrl:string;cancelUrl:string;email?:string},key:string):Promise<{id?:unknown;url?:unknown}>};

/** Starts a Stripe Checkout for a support payment. Signed-out visitors can pay too (userId null). */
export async function startSupportCheckout(processor:SupportProcessor,input:{amountCents:number;userId:string|null;name:string;email?:string|null;sandbox:0|1}){
 const value=supportRequestSchema.parse({amountCents:input.amountCents}),id=crypto.randomUUID();
 await getPool().query('INSERT INTO ch_web.support_payments(id,amount_cents,user_id,supporter_name,sandbox) VALUES($1,$2,$3,$4,$5)',[id,value.amountCents,input.userId,input.userId?input.name.slice(0,100):'',input.sandbox]);
 const session=await processor.createSupportCheckout({supportId:id,amountCents:value.amountCents,successUrl:'/support/thanks?ref='+id,cancelUrl:'/about#support',...(input.email?{email:input.email}:{})},'comichuddle_support_'+id);
 if(typeof session.id!=='string'||typeof session.url!=='string'||!/^https:\/\/checkout\.stripe\.com\//.test(session.url))throw new Error('Checkout did not return a payment page.');
 await getPool().query('UPDATE ch_web.support_payments SET checkout_session_id=$2 WHERE id=$1',[id,session.id]);
 return {id,url:session.url};
}

const isSupport=(object:Record<string,unknown>)=>(object.metadata as {purpose?:unknown}|undefined)?.purpose==='support';
export const isSupportEvent=(event:StripeVerifiedEvent)=>isSupport(event.data.object as Record<string,unknown>);

/** Signed webhook only. checkout.session.completed (paid) marks the payment paid once; expired sessions close it;
 * a refund marks it refunded. Repeated events change nothing. Returns null when the event isn't a support payment. */
export async function applySupportEvent(event:StripeVerifiedEvent,sandbox:0|1){
 const object=event.data.object as Record<string,unknown>;
 // Refunds arrive on the charge, which doesn't carry the session's metadata: match by payment intent.
 if(event.type==='charge.refunded'&&typeof object.payment_intent==='string'){
  const r=await getPool().query("UPDATE ch_web.support_payments SET status='refunded' WHERE payment_intent_id=$1 AND status='paid' RETURNING id",[object.payment_intent]);
  if(r.rows.length)return {received:true,support:'refunded'};
  const known=await getPool().query('SELECT 1 FROM ch_web.support_payments WHERE payment_intent_id=$1',[object.payment_intent]);if(known.rows.length)return {received:true,support:'duplicate'};
 }
 if(!isSupport(object))return null;
 const supportId=(object.metadata as {support_id?:unknown}).support_id;
 if(typeof supportId!=='string'||!/^[0-9a-f-]{36}$/.test(supportId))return {received:true,ignored:true};
 const [row]=(await getPool().query<{amount_cents:number;checkout_session_id:string|null;sandbox:string|number;status:string}>('SELECT amount_cents,checkout_session_id,sandbox,status FROM ch_web.support_payments WHERE id=$1',[supportId])).rows;
 if(!row||Number(row.sandbox)!==sandbox)return {received:true,ignored:true};
 if(event.type==='checkout.session.completed'||event.type==='checkout.session.async_payment_succeeded'){
  // Exact match against what we created: same session, same amount, actually paid.
  if(object.id!==row.checkout_session_id||object.amount_total!==row.amount_cents||object.currency!=='usd'||object.payment_status!=='paid')return {received:true,ignored:true,reason:'support_payment_mismatch'};
  const intent=typeof object.payment_intent==='string'?object.payment_intent:null;
  const r=await getPool().query("UPDATE ch_web.support_payments SET status='paid',paid_at=now(),payment_intent_id=COALESCE(payment_intent_id,$2) WHERE id=$1 AND status='pending' RETURNING id",[supportId,intent]);
  return {received:true,support:r.rows.length?'paid':'duplicate'};
 }
 if(event.type==='checkout.session.expired'){await getPool().query("UPDATE ch_web.support_payments SET status='expired' WHERE id=$1 AND status='pending'",[supportId]);return {received:true,support:'expired'}}
 return {received:true,ignored:true};
}

export type SupportPaymentRow={id:string;amountCents:number;status:string;supporterName:string;createdAt:string;paidAt:string|null;stripeId:string|null};
const toRow=(r:{id:string;amount_cents:number;status:string;supporter_name:string;created_at:Date;paid_at:Date|null;payment_intent_id:string|null;checkout_session_id:string|null}):SupportPaymentRow=>({id:r.id,amountCents:r.amount_cents,status:r.status,supporterName:r.supporter_name||'Signed-out supporter',createdAt:new Date(r.created_at).toISOString(),paidAt:r.paid_at?new Date(r.paid_at).toISOString():null,stripeId:r.payment_intent_id||r.checkout_session_id});
/** Owner revenue view: paid support payments, separate from marketplace revenue. */
export async function supportPaymentsForOwner(sandbox:0|1,limit=100){
 try{
  const r=await getPool().query("SELECT id,amount_cents,status,supporter_name,created_at,paid_at,payment_intent_id,checkout_session_id FROM ch_web.support_payments WHERE status IN ('paid','refunded') AND sandbox=$1 ORDER BY paid_at DESC NULLS LAST LIMIT $2",[sandbox,limit]);
  const rows=r.rows.map(toRow);return {rows,totalCents:rows.filter(row=>row.status==='paid').reduce((sum,row)=>sum+row.amountCents,0)};
 }catch{return {rows:[],totalCents:0}}
}
/** The signed-in supporter's own receipts. */
export async function supportReceipts(userId:string){
 try{return (await getPool().query("SELECT id,amount_cents,status,supporter_name,created_at,paid_at,payment_intent_id,checkout_session_id FROM ch_web.support_payments WHERE user_id=$1 AND status IN ('paid','refunded') ORDER BY paid_at DESC LIMIT 50",[userId])).rows.map(toRow)}catch{return []}
}
/** Thank-you page: shows the amount only once the webhook has confirmed it. */
export async function supportStatus(id:string){
 if(!/^[0-9a-f-]{36}$/.test(id))return null;
 try{const r=(await getPool().query<{amount_cents:number;status:string}>('SELECT amount_cents,status FROM ch_web.support_payments WHERE id=$1',[id])).rows[0];return r?{amountCents:r.amount_cents,status:r.status}:null}catch{return null}
}
