// eBay-style order feedback (ch_web.order_feedback, migration 027).
// Buyer → seller: Positive / Neutral / Negative, optional 1–5 detailed ratings, comment ≤ 500, one per order,
// within 60 days of completion, editable for 30 days; the seller may post one public reply.
// Seller → buyer: positive only. Public output is an allowlist: no order ids, amounts or user ids.
import type {Pool} from 'pg';
import {randomUUID} from 'node:crypto';

export const FEEDBACK_LEAVE_DAYS=60,FEEDBACK_EDIT_DAYS=30,FEEDBACK_SUMMARY_DAYS=365;
/** Order statuses that mean the item reached the buyer (carrier delivery or confirmed pickup) or the release window has run. */
// SafePurchase orders reach delivered_review only after signed delivery from the Inspection Center;
// local pickups (including Inspection Center hand-offs) reach picked_up when the pickup is confirmed.
export const completedOrderStatuses=['delivered_review','picked_up','release_eligible','transfer_pending','transferred'] as const;
export type FeedbackRating='positive'|'neutral'|'negative';
export type FeedbackDirection='buyer_to_seller'|'seller_to_buyer';
export class FeedbackError extends Error{constructor(message:string,public status:number,public code:string){super(message)}}
const day=86_400_000;

type OrderRow={id:string;buyer_id:string;buyer_user_id:string;seller_id:string;seller_user_id:string;status:string;state:string;created_at:string};
type FeedbackRow={id:string;order_id:string;direction:FeedbackDirection;author_profile_id:string;subject_profile_id:string;rating:FeedbackRating;item_as_described:number|null;communication:number|null;shipping_speed:number|null;comment:string;reply:string|null;reply_at:string|Date|null;created_at:string|Date;updated_at:string|Date};
const iso=(v:string|Date|null)=>v===null?null:new Date(v).toISOString();

/** When the order became complete: carrier/pickup delivery time if recorded, otherwise the payment time, otherwise creation.
 * Falling back to an earlier timestamp can only shorten (never extend) the feedback window. */
export function orderCompletedAt(row:Pick<OrderRow,'status'|'state'|'created_at'>):string|null{
 if(!(completedOrderStatuses as readonly string[]).includes(row.status))return null;
 let state:{shipment?:{deliveredAt?:string|null};order?:{paidAt?:string|null};pickup?:{confirmedAt?:string|null}|null}={};
 try{state=JSON.parse(row.state)||{}}catch{}
 const candidates=[state.pickup?.confirmedAt,state.shipment?.deliveredAt,state.order?.paidAt,row.created_at];
 for(const value of candidates){if(value&&Number.isFinite(Date.parse(value)))return new Date(value).toISOString()}
 return null;
}

/** Masks a handle the way eBay masks buyer names: first and last character only. */
export function maskHandle(handle:string){const h=handle.trim();if(h.length<=2)return h.charAt(0)+'***';return h.charAt(0)+'***'+h.charAt(h.length-1)}

export function feedbackPercent(positive:number,negative:number){const rated=positive+negative;return rated?Math.round(positive/rated*1000)/10:null}

export type FeedbackInput={orderId:string;rating:FeedbackRating;itemAsDescribed?:number|null;communication?:number|null;shippingSpeed?:number|null;comment?:string};
export function validateFeedback(input:unknown):FeedbackInput{
 const v=input as Record<string,unknown>;
 if(!v||typeof v!=='object')throw new FeedbackError('Choose a rating.',400,'invalid');
 if(typeof v.orderId!=='string'||!/^[A-Za-z0-9_-]{8,80}$/.test(v.orderId))throw new FeedbackError('Order not found.',404,'not_found');
 if(!['positive','neutral','negative'].includes(v.rating as string))throw new FeedbackError('Choose Positive, Neutral or Negative.',400,'invalid');
 const score=(key:string)=>{const s=v[key];if(s===undefined||s===null||s==='')return null;if(typeof s!=='number'||!Number.isInteger(s)||s<1||s>5)throw new FeedbackError('Detailed ratings are whole stars from 1 to 5.',400,'invalid');return s};
 const comment=v.comment===undefined?'':v.comment;
 if(typeof comment!=='string'||comment.trim().length>500)throw new FeedbackError('Comments can be up to 500 characters.',400,'invalid');
 const allowed=new Set(['orderId','rating','itemAsDescribed','communication','shippingSpeed','comment','action']);
 if(Object.keys(v).some(k=>!allowed.has(k)))throw new FeedbackError('Unexpected field.',400,'invalid');
 return {orderId:v.orderId,rating:v.rating as FeedbackRating,itemAsDescribed:score('itemAsDescribed'),communication:score('communication'),shippingSpeed:score('shippingSpeed'),comment:comment.trim()};
}

function ownView(row:FeedbackRow){return {id:row.id,rating:row.rating,itemAsDescribed:row.item_as_described,communication:row.communication,shippingSpeed:row.shipping_speed,comment:row.comment,reply:row.reply,replyAt:iso(row.reply_at),createdAt:iso(row.created_at)!,updatedAt:iso(row.updated_at)!}}

async function loadOrder(pool:Pool,orderId:string){return (await pool.query<OrderRow>('SELECT id,buyer_id,buyer_user_id,seller_id,seller_user_id,status,state,created_at FROM ch_web.commerce_orders WHERE id=$1',[orderId])).rows[0]}

/** Private: what the signed-in participant may do for one order. */
export async function feedbackStatus(pool:Pool,userId:string,orderId:string,now=new Date()){
 const order=await loadOrder(pool,orderId);
 if(!order||(order.buyer_user_id!==userId&&order.seller_user_id!==userId))throw new FeedbackError('Order not found.',404,'not_found');
 const role:'buyer'|'seller'=order.buyer_user_id===userId?'buyer':'seller',direction:FeedbackDirection=role==='buyer'?'buyer_to_seller':'seller_to_buyer';
 const completedAt=orderCompletedAt(order);
 const rows=(await pool.query<FeedbackRow>('SELECT * FROM ch_web.order_feedback WHERE order_id=$1',[orderId])).rows;
 const mine=rows.find(r=>r.direction===direction),received=rows.find(r=>r.direction!==direction);
 const deadline=completedAt?new Date(Date.parse(completedAt)+FEEDBACK_LEAVE_DAYS*day).toISOString():null;
 const editableUntil=mine?new Date(new Date(mine.created_at).getTime()+FEEDBACK_EDIT_DAYS*day).toISOString():null;
 let reason:string|null=null;
 if(order.buyer_user_id===order.seller_user_id||order.buyer_id===order.seller_id)reason='self';
 else if(!completedAt)reason='not_completed';
 else if(mine)reason=Date.parse(editableUntil!)<now.getTime()?'locked':null;
 else if(Date.parse(deadline!)<now.getTime())reason='window_closed';
 return {role,direction,completedAt,deadline,editableUntil,canLeave:!mine&&!reason,canEdit:!!mine&&!reason,reason,
  mine:mine?ownView(mine):null,
  received:received?{...ownView(received),canReply:role==='seller'&&received.direction==='buyer_to_seller'&&!received.reply}:null};
}

export async function leaveFeedback(pool:Pool,userId:string,input:FeedbackInput,now=new Date()){
 const status=await feedbackStatus(pool,userId,input.orderId,now);
 if(status.reason==='self')throw new FeedbackError('You can’t leave feedback for yourself.',403,'self');
 if(status.reason==='not_completed')throw new FeedbackError('Feedback opens once the order is delivered or picked up.',409,'not_completed');
 if(status.reason==='window_closed')throw new FeedbackError('The 60-day feedback window for this order has closed.',409,'window_closed');
 if(status.reason==='locked')throw new FeedbackError('Feedback can’t be changed more than 30 days after it was left.',409,'locked');
 const order=(await loadOrder(pool,input.orderId))!;
 const seller=status.role==='seller';
 if(seller&&input.rating!=='positive')throw new FeedbackError('Sellers can leave positive feedback for buyers only.',400,'seller_positive_only');
 const author=seller?order.seller_id:order.buyer_id,subject=seller?order.buyer_id:order.seller_id;
 const detail=seller?[null,null,null]:[input.itemAsDescribed??null,input.communication??null,input.shippingSpeed??null];
 const stamp=now.toISOString(),editCutoff=new Date(now.getTime()-FEEDBACK_EDIT_DAYS*day).toISOString();
 const result=await pool.query(`INSERT INTO ch_web.order_feedback(id,order_id,direction,author_profile_id,subject_profile_id,rating,item_as_described,communication,shipping_speed,comment,created_at,updated_at)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
  ON CONFLICT (order_id,direction) DO UPDATE SET rating=excluded.rating,item_as_described=excluded.item_as_described,communication=excluded.communication,shipping_speed=excluded.shipping_speed,comment=excluded.comment,updated_at=excluded.updated_at
  WHERE ch_web.order_feedback.created_at>=$12::timestamptz AND ch_web.order_feedback.author_profile_id=excluded.author_profile_id`,
  [randomUUID(),order.id,status.direction,author,subject,input.rating,...detail,input.comment||'',stamp,editCutoff]);
 if(!result.rowCount)throw new FeedbackError('Feedback can’t be changed more than 30 days after it was left.',409,'locked');
 return feedbackStatus(pool,userId,input.orderId,now);
}

/** The seller's single public reply to feedback they received. */
export async function replyToFeedback(pool:Pool,userId:string,feedbackId:string,reply:string,now=new Date()){
 const text=typeof reply==='string'?reply.trim():'';
 if(!text||text.length>500)throw new FeedbackError('Replies must be 1 to 500 characters.',400,'invalid');
 const result=await pool.query(`UPDATE ch_web.order_feedback f SET reply=$3,reply_at=$4 FROM ch_web.commerce_orders o
  WHERE f.id=$1 AND f.order_id=o.id AND f.direction='buyer_to_seller' AND f.reply IS NULL AND o.seller_user_id=$2 AND f.subject_profile_id=o.seller_id`,[feedbackId,userId,text,now.toISOString()]);
 if(!result.rowCount)throw new FeedbackError('You can reply once to feedback left for you.',409,'reply_unavailable');
 return {saved:true};
}

/** Public, allowlisted summary for a profile: "98.7% positive (152)" plus recent comments. */
export async function feedbackSummary(pool:Pool,profileId:string,now=new Date(),limit=10){
 const since=new Date(now.getTime()-FEEDBACK_SUMMARY_DAYS*day).toISOString();
 const [counts]=(await pool.query<{positive:string;neutral:string;negative:string;lifetime:string;iad:string|null;comm:string|null;ship:string|null;as_buyer:string}>(`SELECT
  count(*) FILTER (WHERE direction='buyer_to_seller' AND rating='positive' AND created_at>=$2)::text AS positive,
  count(*) FILTER (WHERE direction='buyer_to_seller' AND rating='neutral' AND created_at>=$2)::text AS neutral,
  count(*) FILTER (WHERE direction='buyer_to_seller' AND rating='negative' AND created_at>=$2)::text AS negative,
  count(*) FILTER (WHERE direction='buyer_to_seller')::text AS lifetime,
  avg(item_as_described) FILTER (WHERE direction='buyer_to_seller' AND created_at>=$2)::text AS iad,
  avg(communication) FILTER (WHERE direction='buyer_to_seller' AND created_at>=$2)::text AS comm,
  avg(shipping_speed) FILTER (WHERE direction='buyer_to_seller' AND created_at>=$2)::text AS ship,
  count(*) FILTER (WHERE direction='seller_to_buyer')::text AS as_buyer
  FROM ch_web.order_feedback WHERE subject_profile_id=$1`,[profileId,since])).rows;
 const n=(v:string|null|undefined)=>Number(v||0),avg=(v:string|null)=>v===null||v===undefined?null:Math.round(Number(v)*10)/10;
 const positive=n(counts?.positive),neutral=n(counts?.neutral),negative=n(counts?.negative);
 const recent=(await pool.query<FeedbackRow&{handle:string|null}>(`SELECT f.*,p.handle FROM ch_web.order_feedback f LEFT JOIN ch_web.profiles p ON p.id=f.author_profile_id
  WHERE f.subject_profile_id=$1 AND f.direction='buyer_to_seller' ORDER BY f.created_at DESC,f.id LIMIT $2`,[profileId,Math.min(Math.max(limit,1),50)])).rows;
 return {
  positive,neutral,negative,count:positive+neutral+negative,percentPositive:feedbackPercent(positive,negative),lifetimeCount:n(counts?.lifetime),positiveAsBuyer:n(counts?.as_buyer),windowDays:FEEDBACK_SUMMARY_DAYS,
  detailed:{itemAsDescribed:avg(counts?.iad??null),communication:avg(counts?.comm??null),shippingSpeed:avg(counts?.ship??null)},
  recent:recent.map(r=>({id:r.id,rating:r.rating,comment:r.comment,itemAsDescribed:r.item_as_described,communication:r.communication,shippingSpeed:r.shipping_speed,buyer:maskHandle(r.handle||'member'),createdAt:iso(r.created_at)!,reply:r.reply,replyAt:iso(r.reply_at)}))
 };
}
export type FeedbackSummary=Awaited<ReturnType<typeof feedbackSummary>>;
export type FeedbackStatus=Awaited<ReturnType<typeof feedbackStatus>>;
