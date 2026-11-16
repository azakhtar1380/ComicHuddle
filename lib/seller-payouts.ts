// Seller trust tiers and bank payouts (server-only). Two separate steps, kept separate on purpose:
//  1. release: platform → seller's Stripe account (lib/commerce.ts commerceOwnerRelease, after the review window)
//  2. bank payout: seller's Stripe account → their bank (this file)
// New sellers: manual payouts, made by us 7 days after delivery or pickup. Trusted sellers (5+ completed orders,
// no disputes or refund claims): Stripe's automatic daily payouts. Any dispute or claim drops them back to new.
import {getPool} from '../db/postgres';
import {notify} from './notifications';
import type {StripeVerifiedEvent} from './stripe-sandbox';

export const TRUSTED_MIN_COMPLETED=5,NEW_SELLER_PAYOUT_DAYS=7;
export type SellerTier={tier:'new'|'trusted';completedOrders:number;problemOrders:number;schedule:'manual'|'daily';payoutDelayDays:number|null;ordersToTrusted:number};
const completed="('delivered_review','picked_up','release_eligible','transfer_pending','transferred')";

/** Derived live from the seller's orders, so a dispute or refund claim drops the tier immediately. */
export async function sellerTier(userId:string,sandbox:0|1=1):Promise<SellerTier>{
 const r=await getPool().query<{done:string;problems:string}>(`SELECT
  count(*) FILTER (WHERE status IN ${completed}) AS done,
  count(*) FILTER (WHERE COALESCE(state::jsonb->>'dispute','none')<>'none' OR state::jsonb->'issue' IS NOT NULL AND state::jsonb->'issue'<>'null'::jsonb OR status IN ('refunded','refund_pending','refund_eligible') AND COALESCE(state::jsonb->>'refundReason','')<>'') AS problems
  FROM ch_web.commerce_orders WHERE seller_user_id=$1 AND sandbox=$2`,[userId,sandbox]);
 const done=Number(r.rows[0]?.done||0),problems=Number(r.rows[0]?.problems||0),trusted=done>=TRUSTED_MIN_COMPLETED&&problems===0;
 return {tier:trusted?'trusted':'new',completedOrders:done,problemOrders:problems,schedule:trusted?'daily':'manual',payoutDelayDays:trusted?null:NEW_SELLER_PAYOUT_DAYS,ordersToTrusted:trusted?0:Math.max(0,TRUSTED_MIN_COMPLETED-done)};
}

type PayoutProcessor={setPayoutSchedule(accountId:string,interval:'manual'|'daily',key:string):Promise<unknown>;createConnectedPayout(input:{accountId:string;amountCents:number;orderId:string},key:string):Promise<{id?:unknown;status?:unknown}>};

/** Keeps the seller's Stripe payout schedule in line with their tier. Only calls Stripe when the tier changed. */
export async function syncPayoutSchedule(processor:PayoutProcessor,userId:string,sandbox:0|1=1){
 const [seller]=(await getPool().query<{account:string|null;state:string}>('SELECT stripe_account_id AS account,state FROM ch_web.commerce_sellers WHERE user_id=$1',[userId])).rows;
 if(!seller?.account)return null;
 const tier=await sellerTier(userId,sandbox),state=JSON.parse(seller.state||'{}') as {payoutSchedule?:string};
 if(state.payoutSchedule===tier.schedule)return tier;
 await processor.setPayoutSchedule(seller.account,tier.schedule,'comichuddle_schedule_'+seller.account+'_'+tier.schedule+'_'+tier.completedOrders+'_'+tier.problemOrders);
 await getPool().query("UPDATE ch_web.commerce_sellers SET state=(state::jsonb||jsonb_build_object('payoutSchedule',$2::text))::text,updated_at=$3 WHERE user_id=$1",[userId,tier.schedule,new Date().toISOString()]);
 return tier;
}

/** Cron: pay out released orders of new-tier sellers once 7 days have passed since delivery or pickup.
 * Safe to run twice: one payout row per order (unique) and a per-order Stripe idempotency key. */
export async function runManualPayouts(processor:PayoutProcessor,sandbox:0|1,nowMs=Date.now(),limit=25){
 const cutoff=new Date(nowMs-NEW_SELLER_PAYOUT_DAYS*86400000).toISOString();
 const rows=(await getPool().query<{id:string;seller_user_id:string;account:string;amount:string}>(`SELECT o.id,o.seller_user_id,s.stripe_account_id AS account,(o.state::jsonb->'order'->>'sellerTransferCents') AS amount
  FROM ch_web.commerce_orders o JOIN ch_web.commerce_sellers s ON s.user_id=o.seller_user_id
  WHERE o.status='transferred' AND o.sandbox=$1 AND s.stripe_account_id IS NOT NULL AND COALESCE(s.state::jsonb->>'payoutSchedule','manual')='manual'
   AND (o.state::jsonb->'shipment'->>'deliveredAt')<=$2 AND NOT EXISTS (SELECT 1 FROM ch_web.seller_payouts p WHERE p.order_id=o.id)
  ORDER BY o.updated_at LIMIT $3`,[sandbox,cutoff,limit])).rows;
 const results:{orderId:string;result:string}[]=[];
 for(const row of rows){
  const amount=Number(row.amount);if(!Number.isSafeInteger(amount)||amount<=0){results.push({orderId:row.id,result:'skipped_amount'});continue}
  const id=crypto.randomUUID();
  // Reserve the order first so a second run can't pay it twice, then call Stripe with a per-order key.
  const reserved=await getPool().query('INSERT INTO ch_web.seller_payouts(id,order_id,seller_user_id,account_id,amount_cents,status,sandbox) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (order_id) DO NOTHING RETURNING id',[id,row.id,row.seller_user_id,row.account,amount,'pending',sandbox]);
  if(!reserved.rows.length){results.push({orderId:row.id,result:'already_reserved'});continue}
  try{
   const payout=await processor.createConnectedPayout({accountId:row.account,amountCents:amount,orderId:row.id},'comichuddle_payout_'+row.id);
   await getPool().query('UPDATE ch_web.seller_payouts SET stripe_payout_id=$2,status=$3,updated_at=now() WHERE id=$1',[id,String(payout.id),payout.status==='paid'?'paid':payout.status==='in_transit'?'in_transit':'pending']);
   results.push({orderId:row.id,result:'payout_created'});
  }catch{
   // Leave the reservation for review rather than retrying blindly (the Stripe key keeps a retry safe).
   await getPool().query("UPDATE ch_web.seller_payouts SET status='failed',failure_message='Stripe did not confirm the payout. Support will retry.',updated_at=now() WHERE id=$1",[id]);
   results.push({orderId:row.id,result:'payout_unconfirmed'});
  }
 }
 return results;
}

const payoutStatus:Record<string,'pending'|'in_transit'|'paid'|'failed'|'canceled'>={'payout.created':'pending','payout.updated':'pending','payout.paid':'paid','payout.failed':'failed','payout.canceled':'canceled'};
/** Signed Connect webhook payout.* event (from a seller's connected account). payout.failed tells the seller
 * to fix their bank details; the problem shows in Orders and Wallet until a later payout succeeds. */
export async function applyPayoutEvent(event:StripeVerifiedEvent&{account?:unknown},sandbox:0|1){
 const status=payoutStatus[event.type],payout=event.data.object as {id?:unknown;amount?:unknown;failure_message?:unknown;status?:unknown;metadata?:{order_id?:unknown}};
 const account=typeof event.account==='string'?event.account:'';
 if(!status||typeof payout.id!=='string'||!payout.id.startsWith('po_')||!/^acct_/.test(account))return {received:true,ignored:true};
 const [seller]=(await getPool().query<{user_id:string}>('SELECT user_id FROM ch_web.commerce_sellers WHERE stripe_account_id=$1',[account])).rows;
 if(!seller)return {received:true,ignored:true};
 const amount=Number(payout.amount),message=typeof payout.failure_message==='string'?payout.failure_message.slice(0,300):'',orderId=typeof payout.metadata?.order_id==='string'?payout.metadata.order_id:null;
 const effective=status==='pending'&&payout.status==='in_transit'?'in_transit':status;
 // Only a real status change counts, so Stripe retrying the same webhook never notifies twice.
 const known=await getPool().query('SELECT id FROM ch_web.seller_payouts WHERE stripe_payout_id=$1',[payout.id]);
 const updated=await getPool().query('UPDATE ch_web.seller_payouts SET status=$2,failure_message=$3,updated_at=now() WHERE stripe_payout_id=$1 AND status IS DISTINCT FROM $2 RETURNING id',[payout.id,effective,message]);
 let changed=updated.rows.length>0;
 if(!known.rows.length&&Number.isSafeInteger(amount)&&amount>0)changed=((await getPool().query('INSERT INTO ch_web.seller_payouts(id,order_id,seller_user_id,account_id,stripe_payout_id,amount_cents,status,failure_message,sandbox) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id',
  [crypto.randomUUID(),orderId&&/^[0-9a-f-]{36}$/.test(orderId)?orderId:null,seller.user_id,account,payout.id,amount,effective,message,sandbox])).rows.length)>0;
 if(changed&&effective==='failed')await notify({userId:seller.user_id,kind:'payout',title:'Your bank payout failed',body:'Stripe couldn’t send $'+(Number.isFinite(amount)?(amount/100).toFixed(2):'')+' to your bank. Update your bank details in payment setup.',href:'/?section=Orders'});
 return {received:true,payout:effective};
}

/** The latest payout problem for a seller, shown in Orders and Wallet until a newer payout succeeds. */
export async function payoutProblem(userId:string){
 try{
  const r=(await getPool().query<{amount_cents:number;failure_message:string;updated_at:Date;status:string}>("SELECT amount_cents,failure_message,updated_at,status FROM ch_web.seller_payouts WHERE seller_user_id=$1 ORDER BY updated_at DESC LIMIT 1",[userId])).rows[0];
  return r?.status==='failed'?{amountCents:r.amount_cents,message:r.failure_message||'Your bank rejected the payout.',at:new Date(r.updated_at).toISOString()}:null;
 }catch{return null}
}
