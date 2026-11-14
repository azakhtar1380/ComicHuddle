// Run: node --import tsx --test checks/seller-feedback.test.ts
// Executes lib/community-feedback.ts against real migrations 001 + 027 in in-process PGlite.
import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import type {Pool} from 'pg';
import {FeedbackError,feedbackStatus,feedbackSummary,leaveFeedback,replyToFeedback,validateFeedback,feedbackPercent,maskHandle,orderCompletedAt} from '../lib/community-feedback';

let pool:Pool;
const day=86_400_000,now=new Date('2026-11-14T12:00:00Z'),ago=(d:number)=>new Date(now.getTime()-d*day).toISOString();
const people={seller:'p-seller-0001',buyer:'p-buyer-00001',other:'p-other-00001'};
const users={seller:'u-seller',buyer:'u-buyer',other:'u-other'};
async function order(id:string,status:string,deliveredDaysAgo:number|null,{buyer='buyer',seller='seller'}:{buyer?:keyof typeof people;seller?:keyof typeof people}={}){
 const state={status,order:{paidAt:ago((deliveredDaysAgo??0)+5)},shipment:{deliveredAt:deliveredDaysAgo===null?null:ago(deliveredDaysAgo)}};
 await pool.query(`INSERT INTO ch_web.commerce_orders(id,buyer_id,buyer_user_id,seller_id,seller_user_id,listing_id,request_id,status,snapshot,state,created_at,updated_at)
  VALUES($1,$2,$3,$4,$5,'listing-'||$1,'req-'||$1,$6,'{"totalCents":5000,"title":"Saga #1"}',$7,$8,$8)`,[id,people[buyer],users[buyer],people[seller],users[seller],status,JSON.stringify(state),ago(90)]);
}
async function rejects(promise:Promise<unknown>,code:string){await assert.rejects(promise,(e:unknown)=>e instanceof FeedbackError&&e.code===code)}

before(async()=>{
 const engine=new PGlite();await engine.exec('CREATE SCHEMA ch_web;BEGIN;');
 await engine.exec(readFileSync('db/postgres-migrations/001_original_comichuddle.sql','utf8'));
 await engine.exec('COMMIT;');
 await engine.exec(readFileSync('db/postgres-migrations/027_seller_feedback.sql','utf8'));
 const query=async(text:string,values:unknown[]=[])=>{const r=await engine.query<Record<string,unknown>>(text,values);return {...r,rowCount:r.affectedRows??r.rows.length}};
 pool={query} as unknown as Pool;
 for(const [key,id] of Object.entries(people))await pool.query(`INSERT INTO ch_web.profiles(id,user_id,handle,name,bio,tagline,location,favorite,since,color,featured,visible,dm_open,created_at) VALUES($1,$2,$3,$3,'','','','',2000,'red','[]',1,1,$4)`,[id,users[key as keyof typeof users],key+'_handle',now.toISOString()]);
 await order('order-delivered-1','delivered_review',3);
 await order('order-transferred','transferred',20);
 await order('order-in-transit','in_transit',null);
 await order('order-refunded','refunded',4);
 await order('order-old-61','release_eligible',61);
 await order('order-self','delivered_review',2,{buyer:'seller'});
 for(let i=0;i<8;i++)await order('order-bulk-'+i,'transferred',10+i);
});

test('Only completed orders (delivered, picked up/release window, transferred) open feedback',async()=>{
 assert.equal(orderCompletedAt({status:'in_transit',state:'{}',created_at:ago(1)}),null);
 assert.equal(orderCompletedAt({status:'refunded',state:'{}',created_at:ago(1)}),null);
 assert.equal(orderCompletedAt({status:'delivered_review',state:JSON.stringify({shipment:{deliveredAt:ago(3)}}),created_at:ago(9)}),ago(3));
 await rejects(leaveFeedback(pool,users.buyer,{orderId:'order-in-transit',rating:'positive'},now),'not_completed');
 await rejects(leaveFeedback(pool,users.buyer,{orderId:'order-refunded',rating:'positive'},now),'not_completed');
 const status=await feedbackStatus(pool,users.buyer,'order-delivered-1',now);assert.equal(status.canLeave,true);assert.equal(status.role,'buyer');
});

test('Non-participants and the seller rating themselves are rejected',async()=>{
 await rejects(leaveFeedback(pool,users.other,{orderId:'order-delivered-1',rating:'positive'},now),'not_found');
 await rejects(feedbackStatus(pool,users.other,'order-delivered-1',now),'not_found');
 await rejects(leaveFeedback(pool,users.seller,{orderId:'order-self',rating:'positive'},now),'self');
});

test('60-day leave window and one feedback per order per direction',async()=>{
 await rejects(leaveFeedback(pool,users.buyer,{orderId:'order-old-61',rating:'positive'},now),'window_closed');
 const first=await leaveFeedback(pool,users.buyer,{orderId:'order-delivered-1',rating:'neutral',itemAsDescribed:4,communication:5,shippingSpeed:3,comment:'Fine.'},now);
 assert.equal(first.mine?.rating,'neutral');
 const edited=await leaveFeedback(pool,users.buyer,{orderId:'order-delivered-1',rating:'positive',comment:'Great after all.'},new Date(now.getTime()+5*day));
 assert.equal(edited.mine?.rating,'positive');
 const rows=(await pool.query("SELECT count(*)::int AS n FROM ch_web.order_feedback WHERE order_id='order-delivered-1' AND direction='buyer_to_seller'")).rows[0] as {n:number};
 assert.equal(rows.n,1);
 await assert.rejects(pool.query("INSERT INTO ch_web.order_feedback(id,order_id,direction,author_profile_id,subject_profile_id,rating) VALUES('dup','order-delivered-1','buyer_to_seller','p-buyer-00001','p-seller-0001','negative')"));
});

test('Feedback is immutable after 30 days, except the seller’s single reply',async()=>{
 await leaveFeedback(pool,users.buyer,{orderId:'order-transferred',rating:'negative',comment:'Slow shipping.'},now);
 const later=new Date(now.getTime()+31*day);
 await rejects(leaveFeedback(pool,users.buyer,{orderId:'order-transferred',rating:'positive'},later),'locked');
 const status=await feedbackStatus(pool,users.seller,'order-transferred',later);
 assert.equal(status.received?.canReply,true);
 await rejects(replyToFeedback(pool,users.other,status.received!.id,'Not mine'),'reply_unavailable');
 await rejects(replyToFeedback(pool,users.buyer,status.received!.id,'Buyer cannot reply'),'reply_unavailable');
 assert.deepEqual(await replyToFeedback(pool,users.seller,status.received!.id,'Sorry, carrier delay.',later),{saved:true});
 await rejects(replyToFeedback(pool,users.seller,status.received!.id,'Second reply',later),'reply_unavailable');
});

test('Seller → buyer feedback is positive only and stored separately',async()=>{
 await rejects(leaveFeedback(pool,users.seller,{orderId:'order-delivered-1',rating:'negative'},now),'seller_positive_only');
 const s=await leaveFeedback(pool,users.seller,{orderId:'order-delivered-1',rating:'positive',comment:'Fast payment.',itemAsDescribed:1},now);
 assert.equal(s.mine?.rating,'positive');assert.equal(s.mine?.itemAsDescribed,null);
 await assert.rejects(pool.query("UPDATE ch_web.order_feedback SET rating='negative' WHERE order_id='order-delivered-1' AND direction='seller_to_buyer'"));
});

test('Validation: rating enum, whole 1–5 stars, 500-char comment, field allowlist',()=>{
 assert.throws(()=>validateFeedback({orderId:'order-delivered-1',rating:'great'}),FeedbackError);
 assert.throws(()=>validateFeedback({orderId:'order-delivered-1',rating:'positive',communication:6}),FeedbackError);
 assert.throws(()=>validateFeedback({orderId:'order-delivered-1',rating:'positive',communication:4.5}),FeedbackError);
 assert.throws(()=>validateFeedback({orderId:'order-delivered-1',rating:'positive',comment:'x'.repeat(501)}),FeedbackError);
 assert.throws(()=>validateFeedback({orderId:'order-delivered-1',rating:'positive',amountCents:1}),FeedbackError);
 assert.equal(validateFeedback({orderId:'order-delivered-1',rating:'positive',comment:'  ok  '}).comment,'ok');
});

test('Percent positive = positive ÷ (positive + negative), neutral excluded; public summary is an allowlist',async()=>{
 assert.equal(feedbackPercent(0,0),null);assert.equal(feedbackPercent(151,2),98.7);assert.equal(feedbackPercent(3,1),75);
 for(let i=0;i<8;i++)await leaveFeedback(pool,users.buyer,{orderId:'order-bulk-'+i,rating:i===7?'negative':'positive',communication:5},now);
 const summary=await feedbackSummary(pool,people.seller,now);
 // 9 positive (8 bulk incl. 1 negative → 7 positive + order-delivered-1), 2 negative (bulk-7, order-transferred), 0 neutral
 assert.equal(summary.positive,8);assert.equal(summary.negative,2);assert.equal(summary.neutral,0);assert.equal(summary.count,10);assert.equal(summary.percentPositive,80);
 const json=JSON.stringify(summary);
 for(const secret of ['order-','totalCents','5000','u-seller','u-buyer','p-buyer-00001','user_id','order_id'])assert.ok(!json.includes(secret),'public summary leaked '+secret);
 assert.equal(summary.recent[0].buyer,maskHandle('buyer_handle'));assert.equal(maskHandle('buyer_handle'),'b***e');
 assert.ok(summary.recent.some(r=>r.reply==='Sorry, carrier delay.'));
 const buyerSide=await feedbackSummary(pool,people.buyer,now);assert.equal(buyerSide.positiveAsBuyer,1);assert.equal(buyerSide.count,0);
});
