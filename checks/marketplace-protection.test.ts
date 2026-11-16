// Run: node --import tsx --test checks/marketplace-protection.test.ts
// Binding auctions, local pickup codes, carrier release, SafePurchase inspection, claims, guest
// projection and wallet credit, against actual lib code + PGlite + a synthetic in-memory Stripe.
// No network, card, carrier, refund, transfer or payout is real.
import {getPool} from '../db/postgres';
import {nativeGcdFixture} from './native-gcd-fixture';
import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {Pool} from 'pg';
import {eq,sql} from 'drizzle-orm';
import {getDb} from '../db';
import {profiles,collections,media,listings,listingInventory,commerceOrders,auctionBids} from '../db/schema';
import {seedStarterStatements} from '../lib/catalog-store';
import {emptyVault} from '../lib/vault';
import {previewRulesVersion} from '../lib/community';
import {createListing,placeBid,retractBid} from '../lib/marketplace';
import {marketplaceDirectory,publicListingFields,publicSellerFields,publicItemFields,publicAuctionFields} from '../lib/marketplace-directory';
import {bidHistory,markAuctionUnpaid,resolveEndedAuctions,auctionTerms} from '../lib/marketplace-auction';
import {applyProxyBid,bidIncrement,maskHandle,minimumBid,resolveAuction,type ProxyState} from '../lib/auction-engine';
import {ownerAccountId} from '../lib/owner';
import {commerceRefreshCarrierStatus,commerceApplyCarrierUpdate,commerceApplyWebhook,commerceCancelOrder,commerceCheckout,commerceConfirmPickup,commerceConfirmPickupCode,commerceInspection,commerceInspectionChoice,commerceOnboard,commerceOrderDto,commerceOverview,commerceOwnerRefund,commerceRequestRefund,commerceSubmitTracking} from '../lib/commerce';
import {addBusinessDays,createCommerceState,evaluateCommercePolicy,applyCommerceEvent} from '../lib/commerce-policy';
import {pickupCodeHash,pickupCodeMatches,protectionConfig,protectionPlan,sameDigest} from '../lib/commerce-protection';
import {carrierStatusLabel,carrierUpdate,createCarrierTracker,easyPostSignature,retrieveCarrierTracker,verifyEasyPostWebhook} from '../lib/commerce-carrier';
import {orderProgress} from '../lib/marketplace-order-progress';
import {collectorRewards,convertPoints} from '../lib/collector-rewards';
import {sandboxSetup,type StripeVerifiedEvent} from '../lib/stripe-sandbox';

const origin='https://comichuddle.test',secret='pickup-secret-for-isolated-tests-0001';
const testEnv={COMMERCE_SANDBOX_ENABLED:'true',COMMERCE_SANDBOX_REVIEWED:'true',COMMERCE_STRIPE_TEST_SECRET_KEY:'sk_test_SYNTHETICPROTECTIONFIXTURE1',COMMERCE_STRIPE_TEST_WEBHOOK_SECRET:'whsec_SYNTHETICPROTECTIONFIXTURE',COMMERCE_PUBLIC_ORIGIN:origin,COMMERCE_PICKUP_CODE_SECRET:secret};
const spEnv={...testEnv,SAFEPURCHASE_ENABLED:'true',SAFEPURCHASE_INSPECTION_ADDRESS:'ComicHuddle Inspection Center, 100 Test Ave, Minneapolis, MN 55401'};
type Obj=Record<string,unknown>;
const address={name:'QA Buyer',line1:'1 Test St',line2:'',city:'Minneapolis',state:'MN',postalCode:'55401',country:'US' as const};
const hour=3600000;

// ---- Synthetic Stripe (same contract as commerce-webhook-flows.test.ts) ----
let counter=0;const next=()=>String(++counter).padStart(6,'0')+'PRT';
const stripe={sessions:new Map<string,Obj>(),sessionFields:new Map<string,Record<string,string>>(),intents:new Map<string,Obj>(),charges:new Map<string,Obj>(),refunds:new Map<string,Obj>(),accounts:new Map<string,Obj>(),idem:new Map<string,Obj>()};
const realFetch=globalThis.fetch;
async function fakeStripe(input:string|URL|Request,init:RequestInit={}){
 const url=new URL(String(input));assert.equal(url.origin,'https://api.stripe.com','Real network is forbidden');
 const method=init.method||'GET',route=url.pathname,headers=new Headers(init.headers),key=headers.get('Idempotency-Key');
 const fields=Object.fromEntries(new URLSearchParams(String(init.body||''))) as Record<string,string>;
 if(method==='POST'&&key&&stripe.idem.has(route+key))return Response.json(stripe.idem.get(route+key));
 const id=route.split('/').at(-1)!;let value:Obj|undefined;
 // Seller onboarding uses Stripe Accounts v2 (JSON bodies).
 if(route.startsWith('/v2/')){
  const body=init.body?JSON.parse(String(init.body)) as Obj:{};
  if(method==='POST'&&route==='/v2/core/accounts'){value={id:'acct_'+next(),object:'v2.core.account',livemode:false,closed:false,contact_email:body.contact_email,dashboard:'express',identity:{country:'US'},metadata:body.metadata,applied_configurations:['recipient'],configuration:{recipient:{applied:true,capabilities:{stripe_balance:{stripe_transfers:{status:'active',status_details:[]},payouts:{status:'active',status_details:[]}}}}},requirements:{entries:[],summary:{minimum_deadline:null}}};stripe.accounts.set(value.id as string,value)}
  else if(method==='POST'&&route==='/v2/core/account_links')value={object:'v2.core.account_link',account:body.account,livemode:false,created:new Date().toISOString(),expires_at:new Date(Date.now()+300000).toISOString(),url:'https://accounts.stripe.com/r/'+body.account+'#alu_'+next()};
  else if(method==='GET'&&route.startsWith('/v2/core/accounts/'))value=stripe.accounts.get(id);
  if(!value)return Response.json({error:{code:'not_found'}},{status:404});
  if(method==='POST'&&key)stripe.idem.set(route+key,structuredClone(value));
  return Response.json(value);
 }
 if(method==='POST'&&route==='/v1/accounts'){value={id:'acct_'+next(),object:'account',livemode:false,country:'US',metadata:{profile_id:fields['metadata[profile_id]'],user_id:fields['metadata[user_id]']},details_submitted:true,payouts_enabled:true,capabilities:{transfers:'active'}};stripe.accounts.set(value.id as string,value)}
 else if(method==='POST'&&route==='/v1/account_links')value={object:'account_link',expires_at:Math.floor(Date.now()/1000)+300,url:'https://connect.stripe.com/setup/'+next()};
 else if(method==='POST'&&route==='/v1/checkout/sessions'){
  const sid='cs_test_'+next(),amount=Object.entries(fields).filter(([k])=>/^line_items\[\d+\]\[price_data\]\[unit_amount\]$/.test(k)).reduce((s,[,v])=>s+Number(v),0);
  value={id:sid,object:'checkout.session',livemode:false,mode:'payment',currency:'usd',amount_total:amount,client_reference_id:fields.client_reference_id,metadata:{order_id:fields['metadata[order_id]'],orderId:fields['metadata[orderId]']},status:'open',payment_status:'unpaid',payment_intent:null,url:'https://checkout.stripe.com/c/pay/'+sid};
  stripe.sessions.set(sid,value);stripe.sessionFields.set(sid,fields);
 }
 else if(method==='POST'&&route==='/v1/refunds'){
  const intent=stripe.intents.get(fields.payment_intent)!,charge=stripe.charges.get(intent.latest_charge as string)!;charge.amount_refunded=Number(charge.amount_refunded)+Number(fields.amount);
  value={id:'re_'+next(),object:'refund',livemode:false,payment_intent:fields.payment_intent,amount:Number(fields.amount),currency:'usd',metadata:{order_id:fields['metadata[order_id]'],orderId:fields['metadata[orderId]']},status:'succeeded'};stripe.refunds.set(value.id as string,value);
 }
 else if(method==='GET'){const store=route.startsWith('/v1/checkout/sessions/')?stripe.sessions:route.startsWith('/v1/payment_intents/')?stripe.intents:route.startsWith('/v1/charges/')?stripe.charges:route.startsWith('/v1/refunds/')?stripe.refunds:route.startsWith('/v1/accounts/')?stripe.accounts:undefined;value=store?.get(id)}
 if(route==='/v1/transfers')throw Error('No transfer may be created');
 if(!value)return Response.json({error:{message:'not found'}},{status:404});
 if(method==='POST'&&key)stripe.idem.set(route+key,structuredClone(value));
 return Response.json(value);
}
function pay(sessionId:string){
 const session=stripe.sessions.get(sessionId)!,fields=stripe.sessionFields.get(sessionId)!,orderId=session.client_reference_id as string,amount=session.amount_total as number;
 const pi='pi_'+next(),ch='ch_'+next(),meta={order_id:fields['payment_intent_data[metadata][order_id]'],orderId:fields['payment_intent_data[metadata][orderId]']};
 stripe.charges.set(ch,{id:ch,object:'charge',livemode:false,amount,amount_captured:amount,amount_refunded:0,paid:true,captured:true,currency:'usd',status:'succeeded',payment_intent:pi,disputed:false,refunded:false,metadata:{}});
 stripe.intents.set(pi,{id:pi,object:'payment_intent',livemode:false,currency:'usd',amount,amount_received:amount,metadata:meta,transfer_group:'ORDER_'+orderId,status:'succeeded',latest_charge:ch,transfer_data:null,application_fee_amount:null});
 Object.assign(session,{status:'complete',payment_status:'paid',payment_intent:pi,url:null});return session;
}
function deliver(type:string,object:Obj,env:Obj=testEnv){const value={id:'evt_'+next(),object:'event',type,livemode:false,created:Math.floor(Date.now()/1000),data:{object:structuredClone(object)}};return commerceApplyWebhook(getDb(),value as unknown as StripeVerifiedEvent,new TextEncoder().encode(JSON.stringify(value)),env)}

let engine:PGlite;const pool=new Pool();
before(async()=>{
 engine=new PGlite();await nativeGcdFixture(engine);await engine.exec('CREATE SCHEMA ch_web;BEGIN;');
 const skip=new Set(['003_catalog_ingestion.sql','005_gcd_snapshot_import.sql']);
 for(const name of readdirSync('db/postgres-migrations').filter(n=>n.endsWith('.sql')&&!skip.has(n)&&(n<'025'||n.startsWith('026_')||n.startsWith('042_')||n.startsWith('043_')||n.startsWith('044_'))).sort())await engine.exec(readFileSync('db/postgres-migrations/'+name,'utf8'));
 await engine.exec('COMMIT;SET search_path TO ch_web,public;');
 const query=async(config:string|{text:string;rowMode?:string},values:unknown[]=[])=>{const result=await engine.query<Record<string,unknown>>(typeof config==='string'?config:config.text,values);return {...result,rowCount:result.affectedRows,command:'',rows:typeof config!=='string'&&config.rowMode==='array'?result.rows.map(row=>result.fields.map(field=>row[field.name])):result.rows}};
 Object.assign(pool,{query,connect:async()=>({query,release(){}})});
 (globalThis as typeof globalThis&{comicHuddlePool:Pool}).comicHuddlePool=pool;
 await getDb().batch(seedStarterStatements(getDb(),new Date().toISOString()));
 globalThis.fetch=fakeStripe as typeof fetch;
});
after(async()=>{globalThis.fetch=realFetch;await engine.close();delete (globalThis as typeof globalThis&{comicHuddlePool?:Pool}).comicHuddlePool});

async function collector(prefix:string){
 const stamp=new Date().toISOString(),uuid=crypto.randomUUID();
 return (await getDb().insert(profiles).values({id:uuid,userId:crypto.randomUUID(),handle:prefix+'_'+uuid.slice(0,8),name:prefix,bio:'QA isolated fixture',tagline:'',location:'Minneapolis, MN',favorite:'',since:2026,color:'red',featured:'[]',visible:1,dmOpen:1,createdAt:stamp,rulesVersion:previewRulesVersion,rulesAcceptedAt:stamp}).returning())[0];
}
type Profile=Awaited<ReturnType<typeof collector>>;
type OfferOptions={price?:number;shipping?:number;count?:number;fulfillment?:'shipping'|'pickup'|'both';saleType?:'fixed'|'auction';reserveCents?:number;durationHours?:number};
async function offer(seller:Profile,options:OfferOptions={}){
 const db=getDb(),photo=crypto.randomUUID(),count=options.count??1,ids=Array.from({length:count},()=>crypto.randomUUID()),fulfillment=options.fulfillment??'shipping';
 await db.insert(media).values({id:photo,userId:seller.userId,contentType:'image/jpeg',createdAt:new Date().toISOString()});await getPool().query('INSERT INTO ch_web.photo_bytes(key,body,content_type) VALUES($1,$2,$3)',['photos/'+photo,readFileSync('public/covers/planet-12.jpg'),'image/jpeg']);
 const old=(await db.select().from(collections).where(eq(collections.userId,seller.userId)))[0],vault=old?JSON.parse(old.data):emptyVault(seller.name);
 for(const [index,id] of ids.entries())vault.books.push({id,title:'Amazing Spider-Man',issue:'#'+(300+index),grade:'Raw 9.0',price:200});
 await db.insert(collections).values({userId:seller.userId,data:JSON.stringify(vault),revision:crypto.randomUUID()}).onConflictDoUpdate({target:collections.userId,set:{data:JSON.stringify(vault),revision:crypto.randomUUID()}});
 const result=await createListing(db,seller,{action:'listing',kind:count>1?'collection':'single',saleType:options.saleType??'fixed',bookIds:ids,...(count>1?{title:'QA '+count+'-book lot'}:{}),description:'Isolated QA owned-copy fixture.',price:options.price??60000,shipping:fulfillment==='pickup'?0:options.shipping??1500,photos:[photo],attest:true,usaAttest:true,fulfillment,...(fulfillment==='shipping'?{}:{pickupCity:'Minneapolis',pickupState:'MN'}),...(options.reserveCents?{reserveCents:options.reserveCents}:{}),...(options.durationHours?{durationHours:options.durationHours}:{})});
 return (await db.select().from(listings).where(eq(listings.id,result.listingId)))[0];
}
const onboard=(seller:Profile)=>commerceOnboard(getDb(),seller,'seller@example.test',{action:'seller_onboard',sandboxAcknowledged:true},testEnv);
const checkout=(buyer:Profile,listingId:string,env:Obj=testEnv,extra:Obj={})=>commerceCheckout(getDb(),buyer,'buyer@example.test',{action:'checkout',listingId,requestId:crypto.randomUUID(),sandboxAcknowledged:true,...(extra.fulfillment==='pickup'?{}:{shippingAddress:address}),...extra},env);
const orderRow=async(id:string)=>(await getDb().select().from(commerceOrders).where(eq(commerceOrders.id,id)))[0];
const listingRow=async(id:string)=>(await getDb().select().from(listings).where(eq(listings.id,id)))[0];
async function paid(buyer:Profile,listingId:string,env:Obj=testEnv,extra:Obj={}){const started=await checkout(buyer,listingId,env,extra),orderId=started.order.id;await deliver('checkout.session.completed',pay((await orderRow(orderId)).checkoutSessionId!),env);return orderId}
const dto=async(orderId:string,userId:string,env:Obj=testEnv)=>(await commerceOverview(getDb(),userId,env)).orders.find(order=>order.id===orderId)!;
const rejects=(work:Promise<unknown>,status:number,pattern?:RegExp)=>assert.rejects(work,(e:{status?:number;message?:string})=>{assert.equal(e.status,status,e.message);if(pattern)assert.match(e.message||'',pattern);return true});
const ago=(ms:number)=>new Date(Date.now()-ms).toISOString();
async function backdate(orderId:string,ms:number){
 // Moves the order's creation/payment back in time so deadline rules can be exercised.
 const row=await orderRow(orderId),state=JSON.parse(row.state),shift=(value:string|null)=>value?new Date(Date.parse(value)-ms).toISOString():value;
 state.order.createdAt=shift(state.order.createdAt);state.order.paidAt=shift(state.order.paidAt);
 await getDb().update(commerceOrders).set({createdAt:state.order.createdAt,state:JSON.stringify(state)}).where(eq(commerceOrders.id,orderId));
}

// ---------- Pure rules ----------
test('eBay-style bid increments by price band',()=>{
 assert.deepEqual([50,99,100,499,500,2499,2500,9999,10000,24999,25000,49999,50000,99999,100000,249999,250000,499999,500000,900000].map(bidIncrement),[5,5,25,25,50,50,100,100,250,250,500,500,1000,1000,2500,2500,5000,5000,10000,10000]);
});
test('proxy bidding: price is second-highest max plus one increment, capped at the leader max; ties keep the earlier bidder',()=>{
 let state:ProxyState={openingCents:1000,reserveCents:null,leader:null,currentCents:null};
 const bid=(bidderId:string,maxCents:number)=>{const result=applyProxyBid(state,{bidderId,maxCents,bidId:bidderId+maxCents});assert.ok(result.accepted);state=result.state;return result};
 assert.equal(bid('a',5000).state.currentCents,1000,'First bid shows the opening price');
 assert.equal(minimumBid(state),1050);
 assert.equal(applyProxyBid(state,{bidderId:'b',maxCents:1049,bidId:'x'}).accepted,false,'Below the minimum is rejected');
 assert.equal(bid('b',3000).outcome,'outbid');assert.equal(state.currentCents,3100,'Outbid bidder pushes price to their max + increment');assert.equal(state.leader?.bidderId,'a');
 assert.equal(bid('c',5000).outcome,'outbid');assert.equal(state.currentCents,5000,'Equal maximum: earlier bidder keeps the lead at that price');
 assert.equal(bid('c',8000).outcome,'leading');assert.equal(state.currentCents,5100,'New leader pays one increment over the old max');
 assert.equal(bid('c',9000).outcome,'raised_max');assert.equal(state.currentCents,5100,'Raising your own max does not raise the price');
 assert.equal(applyProxyBid(state,{bidderId:'c',maxCents:9000,bidId:'y'}).accepted,false);
 assert.equal(bid('d',20000).state.currentCents,9100,'Increment follows the band of the previous max ($90 → $1.00)');
 assert.equal(bid('e',30000).state.currentCents,20250,'Above $100 the increment is $2.50');
});
test('reserve: hidden amount, price jumps to the reserve when met, unmet reserve has no winner',()=>{
 let state:ProxyState={openingCents:1000,reserveCents:10000,leader:null,currentCents:null};
 let result=applyProxyBid(state,{bidderId:'a',maxCents:5000,bidId:'1'});assert.ok(result.accepted);state=result.state;
 assert.equal(state.currentCents,1000);assert.deepEqual(resolveAuction(state),{result:'reserve_not_met',winnerId:null,winningCents:null});
 result=applyProxyBid(state,{bidderId:'b',maxCents:15000,bidId:'2'});assert.ok(result.accepted);state=result.state;
 assert.equal(state.currentCents,10000,'Meeting the reserve shows the reserve price');assert.deepEqual(resolveAuction(state),{result:'awaiting_payment',winnerId:'b',winningCents:10000});
 assert.deepEqual(resolveAuction({openingCents:1000,reserveCents:null,leader:null,currentCents:null}).result,'no_bids');
});
test('bidder handles are masked',()=>{assert.equal(maskHandle('collector'),'c******r');assert.equal(maskHandle('ab'),'a*');assert.equal(maskHandle('x'),'*')});
test('protection plan: SafePurchase is automatic at the threshold, opt-in below it, and "coming soon" without an inspection center',()=>{
 const on=protectionConfig(spEnv),off=protectionConfig(testEnv),choice={fulfillment:'shipping' as const,sellerOptIn:false,buyerOptIn:false,waiveSafePurchase:false};
 assert.equal(protectionPlan(on,{...choice,itemCents:50000}).tier,'safepurchase');
 assert.equal(protectionPlan(on,{...choice,itemCents:49999}).tier,'standard');
 assert.equal(protectionPlan(on,{...choice,itemCents:1000,sellerOptIn:true}).tier,'safepurchase','Existing seller opt-in still applies below the threshold');
 assert.equal(protectionPlan(on,{...choice,itemCents:1000,buyerOptIn:true}).tier,'safepurchase');
 const sp=protectionPlan(on,{...choice,itemCents:60000});assert.deepEqual([sp.policy.reviewHours,sp.policy.requiresSignature,sp.policy.insured],[48,true,true],'SafePurchase: 48h review window, signature, insured');
 const soon=protectionPlan(off,{...choice,itemCents:60000});assert.deepEqual([soon.tier,soon.comingSoon,soon.policy.requiresSignature,soon.policy.reviewHours],['standard',true,true,72]);
 const standard=protectionPlan(off,{...choice,itemCents:2000});assert.deepEqual([standard.policy.reviewHours,standard.policy.handlingBusinessDays,standard.policy.requiresSignature],[72,3,false]);
 const waived=protectionPlan(on,{...choice,itemCents:60000,fulfillment:'pickup',waiveSafePurchase:true});assert.deepEqual([waived.tier,waived.waived],['standard',true],'Over-threshold pickup may waive SafePurchase explicitly');
 assert.equal(protectionPlan(on,{...choice,itemCents:60000,waiveSafePurchase:true}).tier,'safepurchase','Shipped orders cannot waive SafePurchase');
 assert.equal(protectionConfig({...spEnv,SAFEPURCHASE_INSPECTION_ADDRESS:''}).safePurchaseEnabled,false,'No inspection address means not enabled');
});
test('standard handling deadline is 3 business days; missing it lets the buyer cancel',()=>{
 const friday=Date.parse('2026-11-13T15:00:00.000Z');assert.equal(new Date(addBusinessDays(friday,3)).toISOString(),'2026-11-18T15:00:00.000Z','Fri + 3 business days = Wed');
 const plan=protectionPlan(protectionConfig(testEnv),{itemCents:2000,fulfillment:'shipping',sellerOptIn:false,buyerOptIn:false,waiveSafePurchase:false});
 const createdAt='2026-11-13T14:00:00.000Z',paidAt='2026-11-13T15:00:00.000Z';
 const state=createCommerceState({orderId:'o1',buyerId:'b',sellerId:'s',sellerAccountId:'acct_1',currency:'USD',totalCents:2500,sellerTransferCents:2500,createdAt,paymentIntentId:'pi_1',chargeId:'ch_1',paidAt,fulfillment:'shipping'},plan.policy);
 assert.equal(evaluateCommercePolicy(state,'2026-11-18T14:59:59.000Z').refundEligible,false);
 const late=evaluateCommercePolicy(state,'2026-11-18T15:00:00.000Z');assert.equal(late.status,'refund_eligible');assert.equal(late.state.refundReason,'tracking_deadline');
 const tracked=applyCommerceEvent(state,{eventId:'t',orderId:'o1',buyerId:'b',sellerId:'s',occurredAt:'2026-11-17T10:00:00.000Z',source:'server',verified:true,type:'tracking_submitted',carrier:'USPS',trackingNumber:'9400100000000000000000'},'2026-11-17T10:00:00.000Z');
 assert.ok(tracked.accepted);assert.equal(evaluateCommercePolicy(tracked.state,'2026-11-20T00:00:00.000Z').refundEligible,false,'Tracking before the deadline satisfies it');
 const buyerShip=applyCommerceEvent(state,{eventId:'p',orderId:'o1',buyerId:'b',sellerId:'s',occurredAt:'2026-11-14T10:00:00.000Z',source:'buyer',verified:true,type:'pickup_confirmed',actor:'buyer'},'2026-11-14T10:00:00.000Z');
 assert.equal(buyerShip.accepted,false,'"I picked it up" is never accepted on a shipped order');
});
test('pickup codes: only a hash is stored and comparison is constant-time',async()=>{
 const hash=await pickupCodeHash('order-1','123456');assert.match(hash,/^[a-f0-9]{64}$/);assert.doesNotMatch(hash,/123456/);
 assert.equal(await pickupCodeMatches('order-1',hash,'123456'),true);assert.equal(await pickupCodeMatches('order-1',hash,'123457'),false);assert.equal(await pickupCodeMatches('order-2',hash,'123456'),false);assert.equal(await pickupCodeMatches('order-1',hash,'12345'),false);
 assert.equal(sameDigest('ab','ab'),true);assert.equal(sameDigest('ab','abc'),false);
});
test('EasyPost: HMAC signature is verified over the raw body and statuses map to trusted carrier evidence',async()=>{
 const env={EASYPOST_WEBHOOK_SECRET:'easypost-webhook-secret',EASYPOST_API_KEY:'EZTK_test_key_000000'},payload={description:'tracker.updated',result:{object:'Tracker',id:'trk_1',tracking_code:'9400111899223197428490',status:'delivered',signed_by:'J SMITH',tracking_details:[{status:'in_transit',datetime:'2026-11-12T10:00:00Z'},{status:'delivered',datetime:'2026-11-13T10:00:00Z'}]}};
 const body=new TextEncoder().encode(JSON.stringify(payload)),signature=await easyPostSignature(env.EASYPOST_WEBHOOK_SECRET,body);
 assert.match(signature,/^hmac-sha256-hex=[a-f0-9]{64}$/);
 assert.equal(await verifyEasyPostWebhook(env,body,signature),true);
 assert.equal(await verifyEasyPostWebhook(env,body,signature.replace(/.$/,c=>c==='0'?'1':'0')),false,'Tampered signature');
 assert.equal(await verifyEasyPostWebhook(env,new TextEncoder().encode(JSON.stringify({...payload,description:'tracker.created'})),signature),false,'Tampered body');
 assert.equal(await verifyEasyPostWebhook({EASYPOST_WEBHOOK_SECRET:''},body,signature),false,'Unconfigured secret');
 const mapped=carrierUpdate(payload)!;assert.deepEqual([mapped.trackerId,mapped.trackingCode,mapped.status,mapped.occurredAt,mapped.signedBy,mapped.rawStatus],['trk_1','9400111899223197428490','delivered','2026-11-13T10:00:00.000Z','J SMITH','delivered']);
 assert.equal(carrierUpdate({...payload,result:{...payload.result,status:'pre_transit'}})?.status,'pending');
 assert.equal(carrierUpdate({description:'batch.updated',result:{}}),null);
 const calls:{url:string;auth:string|null;body:string}[]=[];
 const tracker=await createCarrierTracker(env,'USPS','9400111899223197428490',async(url,init)=>{calls.push({url,auth:new Headers(init.headers).get('Authorization'),body:String(init.body)});return Response.json({id:'trk_mock',tracking_code:'9400111899223197428490',status:'pre_transit'})});
 assert.equal(tracker?.id,'trk_mock');assert.equal(calls[0].url,'https://api.easypost.com/v2/trackers');assert.equal(calls[0].auth,'Basic '+btoa('EZTK_test_key_000000:'));
 assert.equal(await createCarrierTracker({},'USPS','9400111899223197428490',async()=>{throw Error('must not be called')}),null,'No key: no tracker and no network call');
});
test('production rejects a plain-http public origin; local development may use http://localhost',()=>{
 const env={...testEnv,COMMERCE_PUBLIC_ORIGIN:'http://localhost:3000'},previous=process.env.NODE_ENV,previousVercel=process.env.VERCEL;
 try{
  (process.env as Record<string,string|undefined>).NODE_ENV='production';assert.equal(sandboxSetup(env).reason,'public_origin_invalid');
  (process.env as Record<string,string|undefined>).NODE_ENV='development';delete process.env.VERCEL;assert.notEqual(sandboxSetup(env).reason,'public_origin_invalid');
  process.env.VERCEL='1';assert.equal(sandboxSetup(env).reason,'public_origin_invalid','Vercel deployments are never treated as local');
 }finally{(process.env as Record<string,string|undefined>).NODE_ENV=previous;if(previousVercel===undefined)delete process.env.VERCEL;else process.env.VERCEL=previousVercel}
});

// ---------- Auctions against the database ----------
test('binding auctions: proxy bids, seller cannot bid, masked history, retraction blocked, concurrency-safe',async()=>{
 const db=getDb(),seller=await collector('auctioneer'),a=await collector('alpha'),b=await collector('bravo'),c=await collector('charlie'),d=await collector('delta');
 const listing=await offer(seller,{saleType:'auction',price:1000,reserveCents:8000,durationHours:72});
 assert.equal(Date.parse(listing.endAt)-Date.parse(listing.createdAt),72*hour);
 await assert.rejects(createListing(db,seller,{action:'listing',kind:'single',saleType:'auction',bookIds:['x'],description:'x',price:1000,shipping:0,photos:[crypto.randomUUID()],attest:true,usaAttest:true,durationHours:48}),/1, 3, 5, 7 or 10 days/);
 const bid=(who:Profile,amount:number)=>placeBid(db,who,{listingId:listing.id,amount,requestId:crypto.randomUUID(),bindingConsent:true});
 await rejects(bid(seller,2000),403,/own auction/);
 await assert.rejects(placeBid(db,a,{listingId:listing.id,amount:2000,requestId:crypto.randomUUID(),nonbindingConsent:true}),/binding/,'A bid without binding consent is rejected');
 assert.equal((await bid(a,5000)).currentBid,1000);
 assert.equal((await bid(b,3000)).outcome,'outbid');assert.equal((await listingRow(listing.id)).currentBid,3100);
 await rejects(bid(b,3100),400,/at least/);
 assert.equal((await bid(b,6000)).outcome,'leading');assert.equal((await listingRow(listing.id)).currentBid,5100);
 const view=(await marketplaceDirectory(db,a,{location:'',radius:'nationwide',view:'active',q:'',category:'auction',issueId:null,offset:0,listingId:listing.id})).listings[0].auction as unknown as Obj;
 assert.deepEqual([view.binding,view.reserve,view.currentBid,view.yourMax],[true,'not_met',5100,null],'Reserve amount is hidden; only "not met" is shown; nobody else sees a max');
 assert.equal(view.minNextBid,5100+bidIncrement(5100));
 const own=(await marketplaceDirectory(db,b,{location:'',radius:'nationwide',view:'active',q:'',category:'auction',issueId:null,offset:0,listingId:listing.id})).listings[0].auction as unknown as Obj;
 assert.deepEqual([own.leading,own.yourMax],[true,6000],'Only the leader sees their own maximum');
 await rejects(retractBid(db,b,{listingId:listing.id,bidId:(await db.select().from(auctionBids).where(eq(auctionBids.bidderId,b.id)))[0].id,nonbindingConsent:true}),409,/binding/);
 const before=(await listingRow(listing.id)).bidCount;
 await Promise.all([bid(c,7000),bid(d,9000)]);
 const after=await listingRow(listing.id);assert.equal(after.bidCount,before+2,'Both concurrent bids are applied exactly once');assert.equal(after.leaderId,d.id);assert.equal(after.currentBid,8000,'d leads; price meets the $80 reserve exactly');
 const history=await bidHistory(db,listing.id,a.id);assert.equal(history.length,after.bidCount);
 for(const entry of history){assert.doesNotMatch(entry.bidder,/alpha|bravo|charlie|delta/);assert.match(entry.bidder,/^\w\*+\w?$/)}
 assert.ok(history.some(entry=>entry.you));assert.ok(!history.some(entry=>entry.amountCents===9000),'The leader maximum is never shown in history');
});
test('auction end: reserve not met releases copies; a winner pays the winning price in 48h; unpaid can be marked; no bids after end',async()=>{
 const db=getDb(),seller=await collector('ender'),winner=await collector('winner'),other=await collector('runnerup');await onboard(seller);
 const unmet=await offer(seller,{saleType:'auction',price:1000,reserveCents:50000});
 await placeBid(db,winner,{listingId:unmet.id,amount:2000,requestId:crypto.randomUUID(),bindingConsent:true});
 const won=await offer(seller,{saleType:'auction',price:1000});
 await placeBid(db,winner,{listingId:won.id,amount:4000,requestId:crypto.randomUUID(),bindingConsent:true});
 await placeBid(db,other,{listingId:won.id,amount:2500,requestId:crypto.randomUUID(),bindingConsent:true});
 const unpaid=await offer(seller,{saleType:'auction',price:1000});
 await placeBid(db,other,{listingId:unpaid.id,amount:1500,requestId:crypto.randomUUID(),bindingConsent:true});
 await db.update(listings).set({endAt:ago(1000)}).where(sql`${listings.id} IN (${unmet.id},${won.id},${unpaid.id})`);
 await rejects(placeBid(db,other,{listingId:won.id,amount:9000,requestId:crypto.randomUUID(),bindingConsent:true}),409,/ended/);
 const resolved=await resolveEndedAuctions(db);assert.ok(resolved.length>=3);
 assert.equal((await listingRow(unmet.id)).status,'ended');assert.equal((await auctionTerms(db,[unmet.id])).get(unmet.id)?.result,'reserve_not_met');
 assert.equal((await db.select().from(listingInventory).where(eq(listingInventory.listingId,unmet.id))).length,0,'Unsold copies are released to relist');
 const terms=(await auctionTerms(db,[won.id])).get(won.id)!;assert.deepEqual([terms.result,terms.winnerId,terms.winningCents],['awaiting_payment',winner.id,2600]);
 assert.equal(Date.parse(terms.paymentDueAt!)-Date.parse(terms.resolvedAt!),48*hour);
 const mine=(await marketplaceDirectory(db,winner,{location:'',radius:'nationwide',view:'won',q:'',category:'all',issueId:null,offset:0})).listings.find(row=>row.id===won.id)!;
 assert.equal((mine.auction as unknown as Obj).youWon,true);
 await rejects(checkout(other,won.id),409,/winning bidder/);
 const orderId=await paid(winner,won.id);const order=await orderRow(orderId);
 assert.equal(JSON.parse(order.snapshot).itemAmountCents,2600,'Checkout charges the winning amount');assert.equal((await listingRow(won.id)).status,'pending');assert.equal((await auctionTerms(db,[won.id])).get(won.id)?.result,'paid');
 await rejects(markAuctionUnpaid(db,seller,unpaid.id),409,/until/);
 await db.execute(sql`UPDATE ch_web.marketplace_auction_terms SET payment_due_at=${ago(1000)} WHERE listing_id=${unpaid.id}`);
 assert.equal((await markAuctionUnpaid(db,seller,unpaid.id)).saved,true);assert.equal((await listingRow(unpaid.id)).status,'ended');assert.equal((await auctionTerms(db,[unpaid.id])).get(unpaid.id)?.result,'unpaid');
});

// ---------- Local pickup ----------
test('local pickup: 6-digit PIN shown only to the buyer; the seller enters it (or the buyer taps); pending until then, sold after',async()=>{
 const db=getDb(),seller=await collector('pickupseller'),buyer=await collector('pickupbuyer');await onboard(seller);
 const listing=await offer(seller,{price:2500,fulfillment:'pickup'});
 await rejects(checkout(buyer,listing.id),409,/local pickup only/);
 const orderId=await paid(buyer,listing.id,testEnv,{fulfillment:'pickup'});
 const row=await orderRow(orderId),state=JSON.parse(row.state);
 assert.equal(JSON.parse(row.snapshot).shippingCents,0);assert.equal(JSON.parse(row.snapshot).shippingAddress,undefined);
 const buyerView=await dto(orderId,buyer.userId) as Obj,sellerView=await dto(orderId,seller.userId) as Obj;
 assert.match(String(buyerView.pickupCode),/^\d{6}$/);assert.equal(sellerView.pickupCode,undefined,'The seller never sees the PIN');
 assert.ok(state.pickupCodeHash);assert.ok(!row.state.includes(String(buyerView.pickupCode)),'Plain PIN is not stored');
 assert.equal(sellerView.canEnterPickupCode,true);
 assert.equal((await listingRow(listing.id)).status,'pending','a paid pickup waits as pending');
 assert.equal(buyerView.status,'awaiting_pickup');assert.equal(orderProgress(buyerView as never).steps[2].label,'Ready for pickup');
 await rejects(commerceSubmitTracking(db,seller.userId,{action:'submit_tracking',orderId,carrier:'USPS',trackingNumber:'9400111899223197428490'}),409,/pickup/);
 await rejects(commerceConfirmPickup(db,seller.userId,{action:'confirm_pickup',orderId}),403);
 await rejects(commerceConfirmPickupCode(db,seller.userId,{action:'confirm_pickup_code',orderId,code:String(buyerView.pickupCode)==='000000'?'111111':'000000'}),400,/doesn’t match/);
 assert.equal((await listingRow(listing.id)).status,'pending','a wrong PIN changes nothing');
 await commerceConfirmPickupCode(db,seller.userId,{action:'confirm_pickup_code',orderId,code:String(buyerView.pickupCode)});
 assert.equal((await listingRow(listing.id)).status,'sold','right PIN: picked up and the listing is sold');
 const done=await dto(orderId,seller.userId) as Obj&{pickup:{by:string;confirmedAt:string}};assert.equal(done.status,'picked_up');assert.equal(done.pickup.by,'seller');
 assert.equal(Date.parse(String(done.fundsAvailableAt))-Date.parse(done.pickup.confirmedAt),72*hour,'Funds available 72h after pickup');
 const model=orderProgress(done as never);assert.equal(model.complete,4);assert.equal(model.steps[3].label,'Picked up');
 assert.equal((await commerceConfirmPickup(db,buyer.userId,{action:'confirm_pickup',orderId})).duplicate,true,'Idempotent');
 // Buyer tap path on a second pickup order; never allowed for shipped orders.
 const other=await offer(seller,{price:2500,fulfillment:'both'}),pickupOrder=await paid(buyer,other.id,testEnv,{fulfillment:'pickup'});
 assert.equal((await commerceConfirmPickup(db,buyer.userId,{action:'confirm_pickup',orderId:pickupOrder})).order.status,'picked_up');
 const shipped=await offer(seller,{price:2500,fulfillment:'both'}),shippedOrder=await paid(buyer,shipped.id);
 await rejects(commerceConfirmPickup(db,buyer.userId,{action:'confirm_pickup',orderId:shippedOrder}),409,/carrier/);
});

// ---------- Standard: missed handling deadline, claims ----------
test('standard: buyer may cancel for a full refund after a missed 3-business-day handling deadline',async()=>{
 const seller=await collector('lateseller'),buyer=await collector('latebuyer');await onboard(seller);
 const listing=await offer(seller,{price:2500}),orderId=await paid(buyer,listing.id);
 await rejects(commerceCancelOrder(getDb(),buyer.userId,{action:'cancel_order',orderId,requestId:crypto.randomUUID()},testEnv),409,/deadline/);
 await backdate(orderId,8*24*hour);
 const view=await dto(orderId,buyer.userId) as Obj;assert.equal(view.canCancel,true);assert.equal(view.status,'refund_eligible');
 await rejects(commerceCancelOrder(getDb(),seller.userId,{action:'cancel_order',orderId,requestId:crypto.randomUUID()},testEnv),403);
 const result=await commerceCancelOrder(getDb(),buyer.userId,{action:'cancel_order',orderId,requestId:crypto.randomUUID()},testEnv);
 assert.equal(result.order.status,'refunded');
});
test('claims: "not as described" needs delivery and photos; claims freeze release; window is enforced',async()=>{
 const db=getDb(),seller=await collector('claimseller'),buyer=await collector('claimbuyer');await onboard(seller);
 const listing=await offer(seller,{price:2500}),orderId=await paid(buyer,listing.id);
 const claim=(extra:Obj)=>commerceRequestRefund(db,buyer.userId,{action:'request_refund',orderId,requestId:crypto.randomUUID(),reason:'Cover is a different printing',...extra});
 await rejects(claim({claimType:'not_as_described'}),409,/delivered/);
 await commerceSubmitTracking(db,seller.userId,{action:'submit_tracking',orderId,carrier:'USPS',trackingNumber:'9400111899223197420001'});
 await commerceApplyCarrierUpdate(db,{trackerId:null,trackingCode:'9400111899223197420001',status:'delivered',occurredAt:null,signedBy:null});
 assert.equal((await dto(orderId,seller.userId)).status,'delivered_review');
 await rejects(claim({claimType:'not_as_described'}),400,/photo/);
 const photo=crypto.randomUUID();await db.insert(media).values({id:photo,userId:buyer.userId,contentType:'image/jpeg',createdAt:new Date().toISOString()});
 const opened=await claim({claimType:'not_as_described',photoIds:[photo]});
 assert.equal(opened.order.status,'manual_review','An open claim freezes release');assert.equal((opened.order.issue as {kind?:string}).kind,'not_as_described');
 const state=JSON.parse((await orderRow(orderId)).state);state.shipment.deliveredAt=ago(31*24*hour);state.shipment.acceptedAt=ago(32*24*hour);state.shipment.validatedAt=ago(33*24*hour);state.shipment.submittedAt=ago(33*24*hour);state.order.paidAt=ago(34*24*hour);state.order.createdAt=ago(35*24*hour);state.issue=null;
 await db.update(commerceOrders).set({state:JSON.stringify(state),createdAt:state.order.createdAt}).where(eq(commerceOrders.id,orderId));
 await rejects(claim({claimType:'other'}),409,/claim window/);
});

// ---------- SafePurchase ----------
test('SafePurchase: auto over threshold, seller ships to inspection, operator-only receive/pass/ship, signed delivery, 48h window',async()=>{
 const db=getDb(),seller=await collector('spseller'),buyer=await collector('spbuyer');await onboard(seller);
 const listing=await offer(seller,{price:60000}),orderId=await paid(buyer,listing.id,spEnv);
 let view=await dto(orderId,seller.userId,spEnv) as Obj;
 assert.deepEqual([(view.protection as Obj).tier,(view.protection as Obj).releaseHoldHours,view.status],['safepurchase',48,'awaiting_shipment']);
 assert.match(String(view.inspectionAddress),/Inspection Center/,'Seller sees where to ship');
 await commerceSubmitTracking(db,seller.userId,{action:'submit_tracking',orderId,carrier:'UPS',trackingNumber:'1Z999AA10123456784'},spEnv);
 assert.equal((await dto(orderId,buyer.userId,spEnv)).status,'shipped_to_inspection');
 await rejects(commerceInspection(db,seller.userId,{action:'inspection',orderId,step:'receive'},spEnv),403,/Inspection Center/);
 await commerceInspection(db,ownerAccountId,{action:'inspection',orderId,step:'receive'},spEnv);
 assert.equal((await dto(orderId,buyer.userId,spEnv)).status,'at_inspection');
 await commerceInspection(db,ownerAccountId,{action:'inspection',orderId,step:'decide',result:'passed',requestId:crypto.randomUUID()},spEnv);
 assert.equal((await dto(orderId,buyer.userId,spEnv)).status,'inspection_passed');
 await commerceInspection(db,ownerAccountId,{action:'inspection',orderId,step:'ship',carrier:'UPS',trackingNumber:'1Z999AA10123456799'},spEnv);
 assert.equal((await dto(orderId,buyer.userId,spEnv)).status,'shipped_to_buyer');
 await commerceApplyCarrierUpdate(db,{trackerId:null,trackingCode:'1Z999AA10123456799',status:'delivered',occurredAt:null,signedBy:null});
 assert.equal((await dto(orderId,buyer.userId,spEnv)).protectionReason,'delivery_signature_required','SafePurchase requires a signed delivery');
 await commerceApplyCarrierUpdate(db,{trackerId:null,trackingCode:'1Z999AA10123456799',status:'delivered',occurredAt:null,signedBy:'Q BUYER'});
 view=await dto(orderId,seller.userId,spEnv) as Obj;assert.equal(view.status,'delivered_review');
 const state=JSON.parse((await orderRow(orderId)).state);assert.equal(Date.parse(String(view.fundsAvailableAt))-Date.parse(state.shipment.deliveredAt),48*hour);
 const model=orderProgress(view as never);assert.deepEqual(model.steps.map(step=>step.label),['Order placed','Payment confirmed','Shipped to inspection','Inspected','Shipped to you','Delivered']);assert.equal(model.complete,6);
 await rejects(commerceRequestRefund(db,buyer.userId,{action:'request_refund',orderId,requestId:crypto.randomUUID(),reason:'Never arrived',claimType:'not_received'}),409,/signed delivery/);
});
test('SafePurchase: a failed inspection refunds in full automatically; partial collection failure lets the buyer choose',async()=>{
 const db=getDb(),seller=await collector('failseller'),buyer=await collector('failbuyer');await onboard(seller);
 const single=await offer(seller,{price:60000}),failed=await paid(buyer,single.id,spEnv);
 await commerceInspection(db,ownerAccountId,{action:'inspection',orderId:failed,step:'receive'},spEnv);
 await rejects(commerceInspection(db,ownerAccountId,{action:'inspection',orderId:failed,step:'decide',result:'failed',requestId:crypto.randomUUID()},spEnv),400,/finding/);
 const result=await commerceInspection(db,ownerAccountId,{action:'inspection',orderId:failed,step:'decide',result:'failed',reasons:['Undisclosed color touch on the spine'],requestId:crypto.randomUUID()},spEnv);
 assert.equal(result.order.status,'refunded','Automatic full refund');
 const lot=await offer(seller,{price:90000,count:3}),partial=await paid(buyer,lot.id,spEnv);
 await commerceInspection(db,ownerAccountId,{action:'inspection',orderId:partial,step:'receive'},spEnv);
 await commerceInspection(db,ownerAccountId,{action:'inspection',orderId:partial,step:'decide',result:'partial',failedItems:1,reasons:['#302 is a later printing'],requestId:crypto.randomUUID()},spEnv);
 const waiting=await dto(partial,buyer.userId,spEnv) as Obj;assert.equal(waiting.status,'inspection_failed');assert.equal((waiting.inspection as Obj).failedItems,1);
 await rejects(commerceInspectionChoice(db,seller.userId,{action:'inspection_choice',orderId:partial,choice:'accept_partial',requestId:crypto.randomUUID()},spEnv),403);
 const accepted=await commerceInspectionChoice(db,buyer.userId,{action:'inspection_choice',orderId:partial,choice:'accept_partial',requestId:crypto.randomUUID()},spEnv);
 assert.equal((accepted.order.inspection as Obj).partialRefundCents,30000,'Pro-rated: one of three books');assert.equal(accepted.order.status,'inspection_passed');
 const lot2=await offer(seller,{price:90000,count:3}),full=await paid(buyer,lot2.id,spEnv);
 await commerceInspection(db,ownerAccountId,{action:'inspection',orderId:full,step:'receive'},spEnv);
 await commerceInspection(db,ownerAccountId,{action:'inspection',orderId:full,step:'decide',result:'partial',failedItems:2,reasons:['Two books trimmed'],requestId:crypto.randomUUID()},spEnv);
 assert.equal((await commerceInspectionChoice(db,buyer.userId,{action:'inspection_choice',orderId:full,choice:'full_refund',requestId:crypto.randomUUID()},spEnv)).order.status,'refunded');
});
test('SafePurchase pickup over the threshold: hand-off at the Inspection Center, or an explicit buyer waiver to Standard',async()=>{
 const db=getDb(),seller=await collector('sppickup'),buyer=await collector('sppickupbuyer');await onboard(seller);
 const listing=await offer(seller,{price:70000,fulfillment:'pickup'}),orderId=await paid(buyer,listing.id,spEnv,{fulfillment:'pickup'});
 const code=String((await dto(orderId,buyer.userId,spEnv) as Obj).pickupCode);
 await rejects(commerceConfirmPickupCode(db,seller.userId,{action:'confirm_pickup_code',orderId,code}),409,/doesn’t use/);
 await rejects(commerceConfirmPickup(db,buyer.userId,{action:'confirm_pickup',orderId}),409);
 await commerceInspection(db,ownerAccountId,{action:'inspection',orderId,step:'receive'},spEnv);
 await commerceInspection(db,ownerAccountId,{action:'inspection',orderId,step:'decide',result:'passed',requestId:crypto.randomUUID()},spEnv);
 assert.equal((await commerceInspection(db,ownerAccountId,{action:'inspection',orderId,step:'handoff',code},spEnv)).order.status,'picked_up');
 const waived=await offer(seller,{price:70000,fulfillment:'pickup'}),waivedOrder=await paid(buyer,waived.id,spEnv,{fulfillment:'pickup',waiveSafePurchase:true});
 const view=await dto(waivedOrder,buyer.userId,spEnv) as Obj;assert.deepEqual([(view.protection as Obj).tier,(view.protection as Obj).waived,view.status],['standard',true,'awaiting_pickup']);
});

// ---------- Guest projection ----------
test('guest browsing: public payload follows an explicit field allowlist',async()=>{
 const db=getDb(),seller=await collector('publicseller');
 const listing=await offer(seller,{price:4321,count:2});await offer(seller,{saleType:'auction',price:1000,reserveCents:5000});
 const page=await marketplaceDirectory(db,undefined,{location:'',radius:'nationwide',view:'active',q:'',category:'all',issueId:null,offset:0},{guest:true});
 assert.ok(page.listings.length>=2);
 for(const row of page.listings as Obj[]){
  for(const key of Object.keys(row))assert.ok((publicListingFields as readonly string[]).includes(key),'Unexpected public field '+key);
  for(const key of Object.keys(row.seller as Obj))assert.ok((publicSellerFields as readonly string[]).includes(key),'Unexpected seller field '+key);
  for(const item of row.items as Obj[]){for(const key of Object.keys(item))assert.ok((publicItemFields as readonly string[]).includes(key),'Unexpected item field '+key);assert.match(String(item.id),new RegExp('^'+row.id+':\\d+$'))}
  if(row.auction)for(const key of Object.keys(row.auction as Obj))assert.ok((publicAuctionFields as readonly string[]).includes(key),'Unexpected auction field '+key);
  const text=JSON.stringify(row);for(const secret of ['sellerId','bookId','userId','locationZip','vaultRevision','leaderId','yourMax','reserveCents'])assert.ok(!text.includes('"'+secret+'"'),secret+' leaked');
  assert.ok(!text.includes(seller.userId),'Seller user id leaked');
 }
 assert.ok(page.listings.some(row=>row.id===listing.id));
 await rejects(marketplaceDirectory(db,undefined,{location:'',radius:'nationwide',view:'mine',q:'',category:'all',issueId:null,offset:0},{guest:true}),401);
});

// ---------- Wallet points → store credit → checkout ----------
test('wallet: purchase points accrue, convert to store credit, reduce the next charge, and a refund restores the credit',async()=>{
 const seller=await collector('walletseller'),buyer=await collector('walletbuyer');await onboard(seller);
 const first=await offer(seller,{price:60000});await paid(buyer,first.id);
 let rewards=await collectorRewards(getPool(),buyer.userId,'sandbox');assert.equal(rewards.balances.sandbox.points,600,'1 point per dollar of item price');
 rewards=await convertPoints(getPool(),buyer.userId,'sandbox',crypto.randomUUID(),600);assert.deepEqual([rewards.balances.sandbox.points,rewards.balances.sandbox.availableCreditCents],[0,600]);
 const second=await offer(seller,{price:2500,shipping:500}),started=await checkout(buyer,second.id,testEnv,{storeCreditCents:600});
 const sessionId=(await orderRow(started.order.id)).checkoutSessionId!;assert.equal(stripe.sessions.get(sessionId)!.amount_total,2500+500-600,'Charge reduced by the applied credit');
 assert.equal((await collectorRewards(getPool(),buyer.userId,'sandbox')).balances.sandbox.reservedCreditCents,600);
 await deliver('checkout.session.completed',pay(sessionId));
 rewards=await collectorRewards(getPool(),buyer.userId,'sandbox');assert.deepEqual([rewards.balances.sandbox.availableCreditCents,rewards.balances.sandbox.reservedCreditCents,rewards.balances.sandbox.points],[0,0,19],'Credit spent; points only on the card-paid item portion');
 await commerceRequestRefund(getDb(),buyer.userId,{action:'request_refund',orderId:started.order.id,requestId:crypto.randomUUID(),reason:'Seller cancelled the sale'});
 assert.equal((await commerceOwnerRefund(getDb(),ownerAccountId,{action:'owner_refund',orderId:started.order.id,requestId:crypto.randomUUID(),approveIssue:true},testEnv)).order.status,'refunded');
 rewards=await collectorRewards(getPool(),buyer.userId,'sandbox');assert.deepEqual([rewards.balances.sandbox.availableCreditCents,rewards.balances.sandbox.points],[600,0],'Refund restores the credit and reverses that order’s points');
 const kinds=rewards.history.map(row=>row.kind).sort();assert.deepEqual(kinds,['credit_restore','credit_spend','points_conversion','points_reversal','purchase_points','purchase_points'].sort());
});

// ---------- EasyPost polling backup ----------
type Tracker={id:string;tracking_code:string;status:string;est_delivery_date?:string|null;signed_by?:string|null;tracking_details:{status:string;message:string;datetime:string;tracking_location:{city:string;state:string}}[]};
function easyPost(trackers:Map<string,Tracker>,calls:string[]){
 return async(url:string,init:RequestInit)=>{
  assert.match(url,/^https:\/\/api\.easypost\.com\/v2\/trackers/,'Only EasyPost is called');calls.push((init.method||'GET')+' '+url.replace('https://api.easypost.com',''));
  if(init.method==='POST'){const body=JSON.parse(String(init.body)).tracker,id='trk_'+body.tracking_code.toLowerCase().replace(/[^a-z0-9]/g,'').slice(-12);if(!trackers.has(id))trackers.set(id,{id,tracking_code:body.tracking_code,status:'pre_transit',tracking_details:[]});return Response.json({object:'Tracker',...trackers.get(id)!})}
  const id=url.split('/').at(-1)!,tracker=trackers.get(id);return tracker?Response.json({object:'Tracker',...tracker}):Response.json({error:{code:'NOT_FOUND'}},{status:404});
 };
}
test('EasyPost polling backup: tracker read from the API drives in-transit, delivered (72h window) and failure (frozen) states',async()=>{
 const db=getDb(),env={...testEnv,EASYPOST_API_KEY:'EZTK_test_polling_key'},seller=await collector('pollseller'),buyer=await collector('pollbuyer');await onboard(seller);
 const trackers=new Map<string,Tracker>(),calls:string[]=[],fetcher=easyPost(trackers,calls),scan=(status:string,city:string)=>({status,message:carrierStatusLabel(status)+' at '+city,datetime:new Date(Date.now()-3600000).toISOString(),tracking_location:{city,state:'MN'}});
 const order=async(code:string)=>{const listing=await offer(seller,{price:2500}),orderId=await paid(buyer,listing.id,env);await commerceSubmitTracking(db,seller.userId,{action:'submit_tracking',orderId,carrier:'USPS',trackingNumber:code},env,fetcher);return orderId};
 // Delivered: tracker created on submission, then EasyPost reports delivery.
 const delivered=await order('EZ4000000004'),deliveredTracker=[...trackers.values()].find(t=>t.tracking_code==='EZ4000000004')!;
 assert.ok(calls.some(call=>call.startsWith('POST /v2/trackers')),'Tracker created when tracking is submitted');
 let view=await dto(delivered,buyer.userId,env) as Obj&{carrier:{label:string}};assert.equal(view.carrier.label,'Label created');assert.equal(view.status,'awaiting_shipment');
 Object.assign(deliveredTracker,{status:'delivered',tracking_details:[scan('in_transit','Saint Paul'),scan('delivered','Minneapolis')]});
 assert.equal((await commerceRefreshCarrierStatus(db,env,{orderIds:[delivered],fetcher})).checked,0,'At most one poll per order every 10 minutes');
 const later=Date.now()+11*60000;assert.equal((await commerceRefreshCarrierStatus(db,env,{orderIds:[delivered],fetcher,stamp:later})).updated,1);
 view=await dto(delivered,seller.userId,env) as Obj&{carrier:{label:string;lastScan:{location:string}}};
 assert.equal(view.status,'delivered_review');assert.equal(view.carrier.label,'Delivered');assert.equal(view.carrier.lastScan.location,'Minneapolis, MN');
 const state=JSON.parse((await orderRow(delivered)).state);assert.equal(Date.parse(String(view.fundsAvailableAt))-Date.parse(state.shipment.deliveredAt),72*hour,'Funds available 72h after the carrier-reported delivery');
 assert.equal(orderProgress(view as never).complete,4,'Progress reaches Delivered');
 // In transit: scans update the display; nothing is released.
 const transit=await order('EZ2000000002'),transitTracker=[...trackers.values()].find(t=>t.tracking_code==='EZ2000000002')!;
 Object.assign(transitTracker,{status:'in_transit',est_delivery_date:new Date(Date.now()+2*86400000).toISOString(),tracking_details:[scan('in_transit','Minneapolis')]});
 await commerceRefreshCarrierStatus(db,env,{orderIds:[transit],fetcher,stamp:later});
 view=await dto(transit,buyer.userId,env) as Obj&{carrier:{label:string;estDeliveryAt:string}};assert.equal(view.status,'in_transit');assert.equal(view.carrier.label,'In transit');assert.ok(view.carrier.estDeliveryAt);assert.equal(view.fundsAvailableAt,null);
 // Failure: flagged for support and release frozen.
 const failure=await order('EZ6000000006'),failureTracker=[...trackers.values()].find(t=>t.tracking_code==='EZ6000000006')!;
 Object.assign(failureTracker,{status:'failure',tracking_details:[scan('failure','Minneapolis')]});
 await commerceRefreshCarrierStatus(db,env,{orderIds:[failure],fetcher,stamp:later});
 view=await dto(failure,seller.userId,env) as Obj&{carrier:{problem:boolean;label:string}};assert.equal(view.status,'manual_review');assert.equal(view.protectionReason,'carrier_exception_requires_review');assert.equal(view.carrier.problem,true);assert.equal(view.carrier.label,'Delivery problem');
 // A tracker that answers for a different code is ignored; without a key nothing is polled.
 const other=await order('EZ1000000001'),otherTracker=[...trackers.values()].find(t=>t.tracking_code==='EZ1000000001')!;
 Object.assign(otherTracker,{tracking_code:'EZ9999999999',status:'delivered',tracking_details:[scan('delivered','Elsewhere')]});
 await commerceRefreshCarrierStatus(db,env,{orderIds:[other],fetcher,stamp:later});assert.notEqual((await dto(other,buyer.userId,env)).status,'delivered_review');
 assert.equal((await commerceRefreshCarrierStatus(db,testEnv,{fetcher})).skipped,'carrier_not_configured');
 await assert.rejects(retrieveCarrierTracker(env,'trk_missing00',fetcher));
});
test('own checkout reservation: the paying buyer still sees the listing and can resume; others see it as unavailable',async()=>{
 const db=getDb(),seller=await collector('holdseller'),buyer=await collector('holdbuyer'),other=await collector('holdother');await onboard(seller);
 const listing=await offer(seller,{price:2500}),started=await checkout(buyer,listing.id),lookup=(viewer:Profile)=>marketplaceDirectory(db,viewer,{location:'',radius:'nationwide',view:'active',q:'',category:'all',issueId:null,offset:0,listingId:listing.id});
 const mine=(await lookup(buyer)).listings[0] as Obj;assert.equal(mine?.status,'checkout_reserved');
 assert.equal(Date.parse(String(mine.reservedForYouUntil))-Date.parse(started.order.createdAt),3600000,'Reserved for the buyer for the checkout hour');
 assert.equal((await lookup(other)).listings.length,0,'Another buyer sees it as no longer available');
 const resumed=await commerceCheckout(db,buyer,'buyer@example.test',{action:'checkout',listingId:listing.id,requestId:crypto.randomUUID(),sandboxAcknowledged:true,shippingAddress:address},testEnv);
 assert.equal(resumed.order.id,started.order.id,'A new checkout request resumes the same reservation');
 await rejects(commerceCheckout(db,buyer,'buyer@example.test',{action:'checkout',listingId:listing.id,requestId:crypto.randomUUID(),sandboxAcknowledged:true,shippingAddress:{...address,line1:'2 Other St'}},testEnv),409,/already have a checkout/);
 await rejects(checkout(other,listing.id),409,/reserved|no longer available/);
});