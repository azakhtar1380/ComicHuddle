import {DomainError,once,serializable,type SqlPool,type SqlClient} from './db';
import {bps,cents} from './money';
export type RewardPolicy={version:string;enabled:boolean;pointsPerDollar:number;centsPerPoint:number;maxDiscountBps:number;listingPoints:number;dailyListingPointsCap:number};
export const defaultRewards:RewardPolicy={version:'2026-10-v1',enabled:false,pointsPerDollar:1,centsPerPoint:1,maxDiscountBps:1000,listingPoints:0,dailyListingPointsCap:50};
function validate(p:RewardPolicy){for(const n of [p.pointsPerDollar,p.centsPerPoint,p.maxDiscountBps,p.listingPoints,p.dailyListingPointsCap])if(!Number.isSafeInteger(n)||n<0)throw new DomainError('reward_policy_invalid','Invalid reward policy.');if(p.maxDiscountBps>10000)throw new DomainError('reward_policy_invalid','Discount exceeds price.')}
async function lockUser(db:SqlClient,userId:string){await db.query('SELECT id FROM ch_platform.users WHERE id=$1 FOR UPDATE',[userId])}
export async function pointsBalance(db:SqlClient,userId:string){return BigInt((await db.query<{balance:string}>('SELECT coalesce(sum(points),0)::text AS balance FROM ch_platform.reward_points_ledger WHERE user_id=$1',[userId])).rows[0].balance)}
export async function awardPurchasePoints(pool:SqlPool,orderId:string,p:RewardPolicy){
 validate(p);if(!p.enabled)return {points:'0',disabled:true};
 return serializable(pool,db=>once(db,'reward:purchase:'+orderId,'purchase_reward',{orderId,policy:p.version},async()=>{
  const o=(await db.query<{buyer_id:string;status:string;subtotal_cents:string;discount_cents:string;dispute_open:boolean}>('SELECT * FROM ch_platform.orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];
  if(!o||o.status!=='fulfilled'||o.dispute_open)throw new DomainError('reward_not_eligible','Rewards require a settled, undisputed order.');
  await lockUser(db,o.buyer_id);const points=((cents(o.subtotal_cents)-cents(o.discount_cents))*BigInt(p.pointsPerDollar))/BigInt(100);
  if(points>BigInt(0))await db.query(`INSERT INTO ch_platform.reward_points_ledger(user_id,order_id,points,kind,idempotency_key,policy_version)
   VALUES($1,$2,$3,'earned_purchase',$4,$5)`,[o.buyer_id,orderId,points.toString(),'reward:purchase:'+orderId,p.version]);
  return {points:points.toString(),disabled:false};
 }));
}
export async function redeemPoints(pool:SqlPool,userId:string,orderId:string,pointsString:string,key:string,p:RewardPolicy){
 validate(p);if(!p.enabled||p.centsPerPoint===0)throw new DomainError('rewards_disabled','Points redemption is not enabled.',503);
 const points=cents(pointsString);if(points===BigInt(0))throw new DomainError('empty_redemption','Choose a positive number of points.',400);
 return serializable(pool,db=>once(db,key,'redeem_points',{userId,orderId,points:pointsString},async()=>{
  await lockUser(db,userId);
  const o=(await db.query<{buyer_id:string;status:string;subtotal_cents:string;platform_fee_cents:string;discount_cents:string}>('SELECT * FROM ch_platform.orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];
  if(!o||o.buyer_id!==userId)throw new DomainError('order_not_found','Order not found.',404);
  if(o.status!=='pending_payment'||cents(o.discount_cents)>BigInt(0))throw new DomainError('order_price_sealed','This order cannot accept another discount.');
  const discount=points*BigInt(p.centsPerPoint);
  // Commission-funded discounts never reduce seller proceeds or require unfunded transfer subsidies.
  if(discount>bps(cents(o.subtotal_cents),p.maxDiscountBps)||discount>cents(o.platform_fee_cents))throw new DomainError('discount_too_large','Points exceed the funded discount limit.');
  if(await pointsBalance(db,userId)<points)throw new DomainError('insufficient_points','Not enough earned points.');
  const row=(await db.query<{id:string}>(`INSERT INTO ch_platform.reward_redemptions(user_id,order_id,points,discount_cents,status,idempotency_key)
   VALUES($1,$2,$3,$4,'reserved',$5) RETURNING id`,[userId,orderId,pointsString,discount.toString(),key])).rows[0];
  await db.query(`INSERT INTO ch_platform.reward_points_ledger(user_id,order_id,points,kind,idempotency_key,reference_id,policy_version)
   VALUES($1,$2,$3,'redeemed',$4,$5,$6)`,[userId,orderId,(-points).toString(),key,row.id,p.version]);
  await db.query('UPDATE ch_platform.orders SET discount_cents=$2 WHERE id=$1',[orderId,discount.toString()]);
  return {redemptionId:row.id,discountCents:discount.toString(),points:pointsString};
 }));
}
export async function reverseOrderRewards(pool:SqlPool,orderId:string,p:RewardPolicy){
 return serializable(pool,db=>once(db,'reward:reverse:'+orderId,'reverse_rewards',{orderId},async()=>{
  const o=(await db.query<{buyer_id:string;status:string}>('SELECT buyer_id,status FROM ch_platform.orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];
  if(!o||!['cancelled','refunded'].includes(o.status))throw new DomainError('reversal_not_eligible','Rewards are reversed after a confirmed cancellation/refund.');
  await lockUser(db,o.buyer_id);
  const earn=(await db.query<{id:string;points:string}>('SELECT id,points FROM ch_platform.reward_points_ledger WHERE order_id=$1 AND kind=\'earned_purchase\'',[orderId])).rows[0];
  if(earn)await db.query(`INSERT INTO ch_platform.reward_points_ledger(user_id,order_id,points,kind,idempotency_key,reference_id,policy_version)
   VALUES($1,$2,$3,'reversed',$4,$5,$6)`,[o.buyer_id,orderId,(-BigInt(earn.points)).toString(),'reward:reverse-earn:'+orderId,earn.id,p.version]);
  const r=(await db.query<{id:string;points:string}>('SELECT id,points FROM ch_platform.reward_redemptions WHERE order_id=$1 AND status<>\'restored\' FOR UPDATE',[orderId])).rows[0];
  if(r){await db.query(`INSERT INTO ch_platform.reward_points_ledger(user_id,order_id,points,kind,idempotency_key,reference_id,policy_version)
    VALUES($1,$2,$3,'restored',$4,$5,$6)`,[o.buyer_id,orderId,r.points,'reward:restore:'+orderId,r.id,p.version]);
   await db.query("UPDATE ch_platform.reward_redemptions SET status='restored' WHERE id=$1",[r.id]);}
  return {reversed:earn?.points||'0',restored:r?.points||'0'};
 }));
}
export async function awardApprovedListingPoints(pool:SqlPool,listingId:string,p:RewardPolicy){
 validate(p);if(!p.enabled||p.listingPoints===0)return {points:'0',disabled:true};
 return serializable(pool,db=>once(db,'reward:listing:'+listingId,'listing_reward',{listingId,policy:p.version},async()=>{
  const l=(await db.query<{seller_id:string;status:string;is_custom_entry:boolean}>('SELECT * FROM ch_platform.marketplace_listings WHERE id=$1 FOR UPDATE',[listingId])).rows[0];
  if(!l||l.status!=='active'||l.is_custom_entry)throw new DomainError('listing_reward_not_eligible','Only a moderated active canonical listing can earn points.');
  await lockUser(db,l.seller_id);
  const items=(await db.query<{collection_item_id:string}>(`SELECT i.collection_item_id FROM ch_platform.listing_items i
   WHERE i.listing_id=$1 AND EXISTS(SELECT 1 FROM ch_platform.ai_authenticity_scans s WHERE s.collection_item_id=i.collection_item_id AND s.user_id=i.seller_id AND s.disposition='human_verified')`,[listingId])).rows;
  if(!items.length)throw new DomainError('listing_reward_review_required','Human review is required for listing rewards.');
  const used=BigInt((await db.query<{points:string}>(`SELECT coalesce(sum(points),0)::text AS points FROM ch_platform.reward_points_ledger WHERE user_id=$1 AND kind='earned_listing' AND created_at>=date_trunc('day',now())`,[l.seller_id])).rows[0].points);
  if(used+BigInt(p.listingPoints)>BigInt(p.dailyListingPointsCap))return {points:'0',capped:true};
  let fresh=0;for(const item of items){const claim=await db.query('INSERT INTO ch_platform.listing_reward_claims(user_id,collection_item_id,listing_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING collection_item_id',[l.seller_id,item.collection_item_id,listingId]);fresh+=claim.rows.length;}
  if(!fresh)return {points:'0',alreadyClaimed:true};
  await db.query(`INSERT INTO ch_platform.reward_points_ledger(user_id,listing_id,points,kind,idempotency_key,policy_version)
   VALUES($1,$2,$3,'earned_listing',$4,$5)`,[l.seller_id,listingId,String(p.listingPoints),'reward:listing:'+listingId,p.version]);
  return {points:String(p.listingPoints)};
 }));
}
