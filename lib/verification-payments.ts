// The verification fee (migration 057). Paying it is the first step of a collector's "Get verified" request:
// the request reaches the admin queue only once the signed Stripe webhook confirms the payment. An admin who
// approves keeps the fee; an admin who declines refunds it in full. VERIFICATION_FEE_CENTS (default 1000 = $10)
// sets the amount; 0 turns the fee off (requests go straight to review, used by the local test server).
import {getPool} from '../db/postgres';
import type {StripeVerifiedEvent} from './stripe-sandbox';
import {requestPersonVerification} from './person-verification';
import {notify} from './notifications';

export const verificationFeeCents=(env:Record<string,string|undefined>=process.env)=>{const raw=env.VERIFICATION_FEE_CENTS;if(raw===undefined||raw==='')return 1000;const n=Number(raw);return Number.isInteger(n)&&n>=0&&n<=10000?n:1000};
export const feeLabel=(cents:number)=>'$'+(cents/100).toFixed(cents%100?2:0);
type Processor={
 createVerificationCheckout(input:{verificationId:string;amountCents:number;successUrl:string;cancelUrl:string;email?:string},key:string):Promise<{id?:unknown;url?:unknown}>;
 refundVerification(input:{paymentIntentId:string;verificationId:string;amountCents:number},key:string):Promise<unknown>;
};
export class FeeError extends Error{constructor(message:string,public status=400){super(message)}}

/** Starts the fee checkout. One open payment per profile: an unpaid one is replaced, a paid one blocks a second. */
export async function startVerificationCheckout(processor:Processor,input:{profileId:string;userId:string;contact:string;email?:string|null;amountCents:number;sandbox:0|1}){
 const pool=getPool();
 const open=(await pool.query<{status:string}>("SELECT status FROM ch_web.verification_payments WHERE profile_id=$1 AND status IN ('paid','refund_pending') LIMIT 1",[input.profileId])).rows[0];
 if(open)throw new FeeError('Your verification fee is already paid. We’ll be in touch.',409);
 const id=crypto.randomUUID();
 await pool.query("UPDATE ch_web.verification_payments SET status='expired' WHERE profile_id=$1 AND status='pending'",[input.profileId]);
 await pool.query('INSERT INTO ch_web.verification_payments(id,profile_id,user_id,amount_cents,contact_note,sandbox) VALUES($1,$2,$3,$4,$5,$6)',[id,input.profileId,input.userId,input.amountCents,input.contact.slice(0,500),input.sandbox]);
 const session=await processor.createVerificationCheckout({verificationId:id,amountCents:input.amountCents,successUrl:'/verified?paid='+id,cancelUrl:'/verified?canceled=1',...(input.email?{email:input.email}:{})},'comichuddle_verification_'+id);
 if(typeof session.id!=='string'||typeof session.url!=='string'||!/^https:\/\/checkout\.stripe\.com\//.test(session.url))throw new Error('Checkout did not return a payment page.');
 await pool.query('UPDATE ch_web.verification_payments SET checkout_session_id=$2 WHERE id=$1',[id,session.id]);
 return {id,url:session.url};
}

const isVerification=(object:Record<string,unknown>)=>(object.metadata as {purpose?:unknown}|undefined)?.purpose==='verification';
/** Signed webhook only. Paid → the request goes to review (pending). Expired → closed. Refunded → marked refunded. */
export async function applyVerificationEvent(event:StripeVerifiedEvent,sandbox:0|1){
 // Before migration 057 there are no fees: let the order webhook handle the event as before.
 try{return await applyVerificationEventInner(event,sandbox)}catch(error){if((error as {code?:string})?.code==='42P01')return null;throw error}
}
async function applyVerificationEventInner(event:StripeVerifiedEvent,sandbox:0|1){
 const object=event.data.object as Record<string,unknown>,pool=getPool();
 if(event.type==='charge.refunded'&&typeof object.payment_intent==='string'){
  const r=await pool.query("UPDATE ch_web.verification_payments SET status='refunded',refunded_at=COALESCE(refunded_at,now()) WHERE payment_intent_id=$1 AND status IN ('paid','refund_pending') RETURNING id",[object.payment_intent]);
  if(r.rows.length)return {received:true,verification:'refunded'};
  const known=await pool.query('SELECT 1 FROM ch_web.verification_payments WHERE payment_intent_id=$1',[object.payment_intent]);if(known.rows.length)return {received:true,verification:'duplicate'};
 }
 if(!isVerification(object))return null;
 const id=(object.metadata as {verification_id?:unknown}).verification_id;
 if(typeof id!=='string'||!/^[0-9a-f-]{36}$/.test(id))return {received:true,ignored:true};
 const [row]=(await pool.query<{profile_id:string;user_id:string;amount_cents:number;contact_note:string;checkout_session_id:string|null;sandbox:string|number}>('SELECT profile_id,user_id,amount_cents,contact_note,checkout_session_id,sandbox FROM ch_web.verification_payments WHERE id=$1',[id])).rows;
 if(!row||Number(row.sandbox)!==sandbox)return {received:true,ignored:true};
 if(event.type==='checkout.session.completed'||event.type==='checkout.session.async_payment_succeeded'){
  if(object.id!==row.checkout_session_id||object.amount_total!==row.amount_cents||object.currency!=='usd'||object.payment_status!=='paid')return {received:true,ignored:true,reason:'verification_payment_mismatch'};
  const intent=typeof object.payment_intent==='string'?object.payment_intent:null;
  const r=await pool.query("UPDATE ch_web.verification_payments SET status='paid',paid_at=now(),payment_intent_id=COALESCE(payment_intent_id,$2) WHERE id=$1 AND status='pending' RETURNING id",[id,intent]);
  if(r.rows.length){
   await requestPersonVerification({id:row.profile_id,userId:row.user_id},row.contact_note);
   await notify({userId:row.user_id,kind:'verification',title:'Verification fee received',body:'Your request is in review. We’ll contact you to confirm you’re a real person. If we decline, the fee is refunded in full.',href:'/verified'});
  }
  return {received:true,verification:r.rows.length?'paid':'duplicate'};
 }
 if(event.type==='checkout.session.expired'){await pool.query("UPDATE ch_web.verification_payments SET status='expired' WHERE id=$1 AND status='pending'",[id]);return {received:true,verification:'expired'}}
 return {received:true,ignored:true};
}

/** The paid fee for a profile's current request, if any. */
export async function paidFee(profileId:string){
 return (await getPool().query<{id:string;payment_intent_id:string|null;amount_cents:number;status:string}>("SELECT id,payment_intent_id,amount_cents,status FROM ch_web.verification_payments WHERE profile_id=$1 AND status IN ('paid','refund_pending') ORDER BY paid_at DESC NULLS LAST LIMIT 1",[profileId]).catch(()=>({rows:[]}))).rows[0]||null;
}
/** Approved: the fee is kept. */
export async function keepFee(profileId:string){await getPool().query("UPDATE ch_web.verification_payments SET status='kept' WHERE profile_id=$1 AND status='paid'",[profileId]).catch(()=>undefined)}
/** Declined: refund the fee in full. On a Stripe error the payment stays 'refund_pending' for the admin to retry. */
export async function refundFee(processor:Processor,profileId:string):Promise<'refunded'|'none'|'failed'>{
 const fee=await paidFee(profileId);if(!fee)return 'none';
 if(!fee.payment_intent_id)return 'failed';
 await getPool().query("UPDATE ch_web.verification_payments SET status='refund_pending' WHERE id=$1 AND status='paid'",[fee.id]);
 try{await processor.refundVerification({paymentIntentId:fee.payment_intent_id,verificationId:fee.id,amountCents:fee.amount_cents},'comichuddle_verification_refund_'+fee.id);
  await getPool().query("UPDATE ch_web.verification_payments SET status='refunded',refunded_at=now() WHERE id=$1",[fee.id]);return 'refunded'}
 catch{return 'failed'}
}
