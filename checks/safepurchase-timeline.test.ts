// Run: node --import tsx --test checks/safepurchase-timeline.test.ts
// SafePurchase timeline derivation (lib/safepurchase.ts buildTimeline) from real policy events, plus
// admin identity helpers. Pure: no database, network or processor.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyCommerceEvent,createCommerceState,commercePolicyVersion,type CommerceEvent,type CommerceState} from '../lib/commerce-policy';
import {buildTimeline,type OrderRow} from '../lib/safepurchase';
import {RECEIVING_ADDRESS_PLACEHOLDER,orderNumber,safePurchaseRecommended} from '../lib/safepurchase-steps';
import {adminEmails,isAdmin,isFounder} from '../lib/admin';
import {ownerAccountId} from '../lib/owner';

const hour=3600000,t0=Date.now()-45*hour,at=(h:number)=>new Date(t0+h*hour).toISOString();
const id='4f1c2a9e-0000-4000-8000-000000000001',buyer='buyer-user',seller='seller-user';
const policy={version:commercePolicyVersion,trackingHours:48 as const,carrierHours:72 as const,highValue:false,highValueConfigured:false,requiresSignature:true,claimDays:30,tier:'safepurchase' as const,reviewHours:48,insured:true};
const order={orderId:id,buyerId:'bp',sellerId:'sp',sellerAccountId:'acct_TEST1',currency:'USD' as const,totalCents:60000,sellerTransferCents:57000,createdAt:at(0),paymentIntentId:'pi_1',chargeId:'ch_1',paidAt:at(1),fulfillment:'shipping' as const};
const snapshot={title:'Amazing Spider-Man #300',kind:'single',fulfillment:'shipping',itemCount:1,items:[],photoIds:[],itemAmountCents:60000,shippingCents:0,taxCents:0,totalCents:60000,currency:'USD',sellerTransferCents:57000,platformFeeCents:3000,shippingAddress:{name:'B',line1:'1 St',line2:'',city:'Minneapolis',state:'MN',postalCode:'55401',country:'US'},policyVersion:commercePolicyVersion};
const base=(eventId:string,source:CommerceEvent['source'],occurredAt:string)=>({eventId,orderId:id,buyerId:'bp',sellerId:'sp',source,occurredAt,verified:true as const});
function apply(state:CommerceState,event:CommerceEvent){const result=applyCommerceEvent(state,event,new Date().toISOString());assert.ok(result.accepted,result.error);return result.state}
function row(state:CommerceState):OrderRow{return {id,buyerId:'bp',buyerUserId:buyer,sellerId:'sp',sellerUserId:seller,listingId:'l1',requestId:'r1',status:state.status,version:state.version,sandbox:1,snapshot:JSON.stringify(snapshot),state:JSON.stringify(state),checkoutSessionId:null,paymentIntentId:'pi_1',chargeId:'ch_1',transferId:null,createdAt:at(0),updatedAt:at(0)}}
const env={SAFEPURCHASE_ENABLED:'true',SAFEPURCHASE_INSPECTION_ADDRESS:'ComicHuddle Receiving, 100 Test Ave, Minneapolis, MN 55401'};
const states=(timeline:ReturnType<typeof buildTimeline>)=>Object.fromEntries(timeline.steps.map(s=>[s.step,s.state]));

test('timeline follows real events only; seller sees the receiving address until we receive the book',async()=>{
 let state=createCommerceState(order,policy);
 let timeline=buildTimeline(row(state),{userId:seller,admin:false},[],true,env);
 assert.equal(timeline.role,'seller');assert.equal(timeline.currentStep,'seller_shipped');
 assert.deepEqual(states(timeline),{paid:'done',seller_shipped:'current',received:'upcoming',checked:'upcoming',shipped_to_buyer:'upcoming',delivered:'upcoming',done:'upcoming'});
 assert.match(String(timeline.receiving?.address),/ComicHuddle Receiving/);
 assert.equal(buildTimeline(row(state),{userId:seller,admin:false},[],true,{}).receiving?.address,null,'Empty setting → placeholder, never a fake address');
 assert.equal(buildTimeline(row(state),{userId:buyer,admin:false},[],true,env).receiving,undefined,'Buyer never gets the receiving address');
 state=apply(state,{...base('in1','server',at(2)),type:'inspection_inbound',carrier:'UPS',trackingNumber:'1Z999AA10123456784',submittedAt:at(2)} as CommerceEvent);
 state=apply(state,{...base('rc1','operator',at(30)),type:'inspection_received'});
 timeline=buildTimeline(row(state),{userId:buyer,admin:false},[],true,env);
 assert.equal(timeline.steps[1].tracking?.number,'1Z999AA10123456784');assert.equal(timeline.currentStep,'checked');
 state=apply(state,{...base('dc1','operator',at(40)),type:'inspection_decided',result:'passed',reasons:[],failedItems:0,totalItems:1});
 state=apply(state,{...base('sh1','operator',at(41)),type:'inspection_shipped',carrier:'UPS',trackingNumber:'1Z999AA10123456799'} as CommerceEvent);
 timeline=buildTimeline(row(state),{userId:buyer,admin:false},[],true,env);
 assert.equal(timeline.currentStep,'delivered','Delivered waits for the carrier; nothing marks it by hand');
 assert.equal(timeline.steps[4].tracking?.number,'1Z999AA10123456799');
 assert.equal(timeline.orderNumber,orderNumber(id));assert.equal(timeline.orderNumber,'4F1C2A9E');
});

test('a missed seller deadline is shown as refund-eligible, not as a refund in progress',()=>{
 const late={...order,createdAt:new Date(Date.now()-80*hour).toISOString(),paidAt:new Date(Date.now()-79*hour).toISOString()};
 const state=createCommerceState(late,policy),r={...row(state),createdAt:late.createdAt};
 const timeline=buildTimeline(r,{userId:buyer,admin:false},[],true,env);
 assert.equal(timeline.outcome,'on_hold');assert.match(String(timeline.outcomeNote),/Eligible for a full refund/);assert.equal(states(timeline).seller_shipped,'skipped');
});

test('a failed check shows failed, skips the rest, and says the buyer is refunded',()=>{
 let state=createCommerceState(order,policy);
 state=apply(state,{...base('rc2','operator',at(30)),type:'inspection_received'});
 state=apply(state,{...base('dc2','operator',at(40)),type:'inspection_decided',result:'failed',reasons:['Later printing'],failedItems:1,totalItems:1});
 const timeline=buildTimeline(row(state),{userId:'admin-user',admin:true},[{id:'u1',step:'checked',kind:'internal_note',note:'Checked twice',carrier:null,trackingNumber:null,photoIds:[],createdAt:at(40),internal:true}],true,env);
 assert.equal(timeline.role,'admin');
 const s=states(timeline);assert.equal(s.checked,'failed');assert.equal(s.shipped_to_buyer,'skipped');assert.equal(s.done,'skipped');
 assert.match(String(timeline.steps[3].detail),/Later printing/);assert.equal(timeline.steps[3].updates.length,1);
 assert.notEqual(timeline.outcome,'in_progress');
});

test('admin identity: owner is Founder; listed emails capped; badges never need emails client-side',()=>{
 assert.ok(isFounder({userId:ownerAccountId}));assert.ok(isAdmin({userId:ownerAccountId}));
 const env={COMICHUDDLE_ADMIN_EMAILS:'a@x.com, B@x.com ,c@x.com,d@x.com,bad',COMICHUDDLE_ADMIN_LIMIT:'3'};
 assert.deepEqual(adminEmails(env),['a@x.com','b@x.com','c@x.com']);
 assert.ok(isAdmin({userId:'u',email:'b@x.com'},env));assert.ok(!isAdmin({userId:'u',email:'d@x.com'},env));assert.ok(!isAdmin({userId:'u',email:'b@x.com'},{}));
 assert.equal(RECEIVING_ADDRESS_PLACEHOLDER,'ComicHuddle receiving address — set by the owner');
 assert.ok(safePurchaseRecommended(50000,50000));assert.ok(!safePurchaseRecommended(49999,50000));
});
