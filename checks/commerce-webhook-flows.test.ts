// Run: node --import tsx --test checks/commerce-webhook-flows.test.ts
// Actual lib/commerce.ts + Drizzle against an in-process PostgreSQL (PGlite) with every
// migration through 024, and a synthetic in-memory Stripe behind a stubbed fetch.
// No network, Stripe account, card, refund, transfer or payout is used.
import {getPool} from '../db/postgres';
import {startSupportCheckout,supportPaymentsForOwner,supportReceipts,supportStatus} from '../lib/support-payments';
import {chargeableCard,startSaveCard,savedCardView} from '../lib/saved-cards';
import {applyPayoutEvent,payoutProblem,runManualPayouts,sellerTier,syncPayoutSchedule} from '../lib/seller-payouts';
import {nativeGcdFixture} from './native-gcd-fixture';
import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {Pool} from 'pg';
import {eq} from 'drizzle-orm';
import {getDb} from '../db';
import {profiles,collections,media,listings,listingInventory,commerceOrders,commerceSellers} from '../db/schema';
import {seedStarterStatements} from '../lib/catalog-store';
import {emptyVault} from '../lib/vault';
import {previewRulesVersion} from '../lib/community';
import {createListing} from '../lib/marketplace';
import {ownerAccountId} from '../lib/owner';
import {commerceInspection,commerceSafePurchaseRefund,commerceApplyCarrierUpdate,commerceApplyThinAccountEvent,commerceApplyWebhook,commerceCheckout,commerceOnboard,commerceOrderDto,commerceOverview,commerceOwnerRefund,commerceOwnerRelease,commerceOwnerRevenue,commerceRequestRefund,commerceSubmitTracking,createSellerPayout,commerceResumePayment,commerceCancelCheckout,commerceBidCardGate,commerceChargeAuctionWinners} from '../lib/commerce';
import {commerceEvents} from '../db/schema';
import {stripeSandbox} from '../lib/stripe-sandbox';
import {orderProgress} from '../lib/marketplace-order-progress';
import type {StripeVerifiedEvent} from '../lib/stripe-sandbox';
import {thinAccountEvent} from '../lib/stripe-connect-v2';

const origin='https://comichuddle.test';
const testEnv={COMMERCE_SANDBOX_ENABLED:'true',COMMERCE_SANDBOX_REVIEWED:'true',COMMERCE_STRIPE_TEST_SECRET_KEY:'sk_test_SYNTHETICFLOWFIXTURE00001',COMMERCE_STRIPE_TEST_WEBHOOK_SECRET:'whsec_SYNTHETICFLOWFIXTURE0001',COMMERCE_PUBLIC_ORIGIN:origin};
const liveEnv={COMMERCE_SANDBOX_ENABLED:'true',COMMERCE_SANDBOX_REVIEWED:'true',COMMERCE_STRIPE_MODE:'live',COMMERCE_LIVE_REVIEWED:'true',COMMERCE_STRIPE_LIVE_SECRET_KEY:['sk','live','SYNTHETICFLOWFIXTURE00001'].join('_'),COMMERCE_STRIPE_LIVE_WEBHOOK_SECRET:'whsec_SYNTHETICLIVEFLOWFIXTURE01',COMMERCE_PUBLIC_ORIGIN:origin};
type Obj=Record<string,unknown>;
const address={name:'QA Buyer',line1:'1 Test St',line2:'',city:'Minneapolis',state:'MN',postalCode:'55401',country:'US' as const};

// ---- Synthetic Stripe ----
let counter=0;const next=()=>String(++counter).padStart(6,'0')+'SYN';
const stripe={sessions:new Map<string,Obj>(),sessionFields:new Map<string,Record<string,string>>(),intents:new Map<string,Obj>(),charges:new Map<string,Obj>(),refunds:new Map<string,Obj>(),accounts:new Map<string,Obj>(),v2accounts:new Map<string,Obj>(),transfers:new Map<string,Obj>(),v2LinkMode:'v2' as 'v2'|'testmode_rejects',disputes:new Map<string,Obj>(),idem:new Map<string,Obj>(),requests:[] as {method:string;route:string;key:string|null;auth:string|null}[]};
const realFetch=globalThis.fetch;
function liveFromAuth(auth:string|null){return !!auth&&auth.includes('_live_')}
async function fakeStripe(input:string|URL|Request,init:RequestInit={}){
 const url=new URL(String(input));assert.equal(url.origin,'https://api.stripe.com','Real network is forbidden');
 const method=init.method||'GET',route=url.pathname,headers=new Headers(init.headers),key=headers.get('Idempotency-Key'),auth=headers.get('Authorization'),livemode=liveFromAuth(auth);
 const fields=Object.fromEntries(new URLSearchParams(String(init.body||''))) as Record<string,string>;stripe.requests.push({method,route,key,auth});
 if(method==='POST'&&key&&stripe.idem.has(route+key))return Response.json(stripe.idem.get(route+key));
 const id=route.split('/').at(-1)!;let value:Obj|undefined;
 if(route.startsWith('/v2/')){
  assert.equal(headers.get('Stripe-Version'),'2026-10-28.endive');
  const body=init.body?JSON.parse(String(init.body)) as Obj:{};
  if(method==='POST'&&route==='/v2/core/accounts'){
   assert.equal(body.dashboard,'express');assert.deepEqual(body.defaults,{currency:'usd',responsibilities:{fees_collector:'application',losses_collector:'application'}});
   assert.deepEqual(body.configuration,{recipient:{capabilities:{stripe_balance:{stripe_transfers:{requested:true}}}}});assert.ok(typeof body.contact_email==='string');
   value={id:'acct_'+next(),object:'v2.core.account',livemode,closed:false,contact_email:body.contact_email,dashboard:'express',identity:{country:'US'},metadata:body.metadata,applied_configurations:['recipient'],configuration:{recipient:{applied:true,capabilities:{stripe_balance:{stripe_transfers:{status:'active',status_details:[]},payouts:{status:'active',status_details:[]}}}}},requirements:{entries:[],summary:{minimum_deadline:null}}};
   stripe.v2accounts.set(value.id as string,value);
  }else if(method==='POST'&&route==='/v2/core/account_links'){
   if(stripe.v2LinkMode==='testmode_rejects')return Response.json({error:{code:'invalid_fields',message:'synthetic testmode restriction'}},{status:400});
   value={object:'v2.core.account_link',account:body.account,livemode,created:new Date().toISOString(),expires_at:new Date(Date.now()+300000).toISOString(),url:'https://accounts.stripe.com/r/'+body.account+'#alu_'+next()};
  }else if(method==='GET'&&route.startsWith('/v2/core/accounts/')){
   assert.match(url.search,/include=configuration\.recipient/);value=stripe.v2accounts.get(id);if(value&&value.livemode!==livemode)value=undefined;
  }
  if(!value)return Response.json({error:{code:'not_found'}},{status:404});
  if(method==='POST'&&key)stripe.idem.set(route+key,structuredClone(value));
  return Response.json(value);
 }
 // Saved cards (setup-mode Checkout) and off-session auction charges.
 if(method==='POST'&&route==='/v1/customers'){const prior=key&&stripe.idem.get(route+key);if(prior)return Response.json(prior);value={id:'cus_'+next(),object:'customer',livemode,metadata:{user_id:fields['metadata[user_id]'],profile_id:fields['metadata[profile_id]']}};stripe.idem.set(route+key,structuredClone(value));return Response.json(value)}
 if(method==='POST'&&route==='/v1/checkout/sessions'&&fields.mode==='setup'){const sid='cs_'+(livemode?'live':'test')+'_'+next();value={id:sid,object:'checkout.session',livemode,mode:'setup',customer:fields.customer,client_reference_id:fields.client_reference_id,metadata:{purpose:fields['metadata[purpose]'],user_id:fields['metadata[user_id]']},status:'open',url:'https://checkout.stripe.com/c/pay/'+sid,setup_intent:null,success_url:fields.success_url};stripe.sessions.set(sid,value);stripe.idem.set(route+key,structuredClone(value));return Response.json(value)}
 if(method==='POST'&&/^\/v1\/payment_methods\/pm_[A-Za-z0-9]+\/detach$/.test(route)){stripe.requests.push({method,route,detach:true} as never);return Response.json({id:route.split('/')[3],object:'payment_method',customer:null})}
 if(method==='POST'&&route==='/v1/payment_intents'){
  if((globalThis as {declineCards?:boolean}).declineCards)return Response.json({error:{code:'card_declined',type:'card_error'}},{status:402});
  const amount=Number(fields.amount),pi='pi_'+next(),ch='ch_'+next(),orderId=fields['metadata[order_id]'];
  assert.equal(fields.off_session,'true');assert.equal(fields.confirm,'true');assert.equal(fields.transfer_group,'ORDER_'+orderId);
  stripe.charges.set(ch,{id:ch,object:'charge',livemode,amount,amount_captured:amount,amount_refunded:0,paid:true,captured:true,currency:'usd',status:'succeeded',payment_intent:pi,disputed:false,refunded:false,metadata:{}});
  value={id:pi,object:'payment_intent',livemode,created:Math.floor(Date.now()/1000),currency:'usd',amount,amount_received:amount,customer:fields.customer,payment_method:fields.payment_method,metadata:{order_id:orderId,orderId:fields['metadata[orderId]'],purpose:fields['metadata[purpose]']},transfer_group:fields.transfer_group,status:'succeeded',latest_charge:ch,transfer_data:null,application_fee_amount:null};
  stripe.intents.set(pi,value);stripe.idem.set(route+key,structuredClone(value));return Response.json(value);
 }
 if(method==='POST'&&/^\/v1\/accounts\/acct_[A-Za-z0-9]+$/.test(route)){stripe.requests.push({method,route,fields} as never);return Response.json({id:route.split('/')[3],object:'account',settings:{payouts:{schedule:{interval:fields['settings[payouts][schedule][interval]']}}}})}
 if(method==='POST'&&route==='/v1/payouts'){stripe.requests.push({method,route,fields} as never);const k='payout'+key;const prior=stripe.idem.get(k);if(prior)return Response.json(prior);const po={id:'po_'+next(),object:'payout',amount:Number(fields.amount),currency:'usd',status:'pending',metadata:{order_id:fields['metadata[order_id]']}};stripe.idem.set(k,po);return Response.json(po)}
 if(method==='POST'&&route==='/v1/accounts')return Response.json({error:{message:'Accounts v1 creation is unavailable for this platform (synthetic)'}},{status:400});
 else if(method==='POST'&&route==='/v1/account_links')value={object:'account_link',expires_at:Math.floor(Date.now()/1000)+300,url:'https://connect.stripe.com/setup/'+next()};
 else if(method==='POST'&&route==='/v1/checkout/sessions'){
  const sid='cs_'+(livemode?'live':'test')+'_'+next(),amount=Object.entries(fields).filter(([k])=>/^line_items\[\d+\]\[price_data\]\[unit_amount\]$/.test(k)).reduce((s,[,v])=>s+Number(v),0);
  value={id:sid,object:'checkout.session',livemode,mode:'payment',currency:'usd',amount_total:amount,client_reference_id:fields.client_reference_id,metadata:{order_id:fields['metadata[order_id]'],orderId:fields['metadata[orderId]'],...(fields['metadata[purpose]']?{purpose:fields['metadata[purpose]'],support_id:fields['metadata[support_id]']}:{})},status:'open',payment_status:'unpaid',payment_intent:null,url:'https://checkout.stripe.com/c/pay/'+sid};
  stripe.sessions.set(sid,value);stripe.sessionFields.set(sid,fields);
 }
 else if(method==='POST'&&route==='/v1/refunds'){
  const intent=stripe.intents.get(fields.payment_intent)!,charge=stripe.charges.get(intent.latest_charge as string)!;charge.amount_refunded=Number(charge.amount_refunded)+Number(fields.amount);charge.refunded=charge.amount_refunded===charge.amount;
  value={id:'re_'+next(),object:'refund',livemode,payment_intent:fields.payment_intent,amount:Number(fields.amount),currency:'usd',metadata:{order_id:fields['metadata[order_id]'],orderId:fields['metadata[orderId]']},status:'succeeded'};stripe.refunds.set(value.id as string,value);
 }
 else if(method==='GET'){
  const store=route.startsWith('/v1/checkout/sessions/')?stripe.sessions:route.startsWith('/v1/payment_intents/')?stripe.intents:route.startsWith('/v1/charges/')?stripe.charges:route.startsWith('/v1/refunds/')?stripe.refunds:route.startsWith('/v1/accounts/')?stripe.accounts:route.startsWith('/v1/disputes/')?stripe.disputes:undefined;
  value=store?.get(id);if(value&&value.livemode!==undefined&&value.livemode!==livemode)value=undefined;
  // Stripe serves v2 accounts through /v1/accounts/{id} in the v1 shape (verified against the sandbox).
  const v2=route.startsWith('/v1/accounts/')&&!value?stripe.v2accounts.get(id):undefined;
  if(v2&&v2.livemode===livemode){const caps=(((v2.configuration as Obj).recipient as Obj).capabilities as {stripe_balance:{stripe_transfers:{status:string};payouts:{status:string}}}).stripe_balance;value={id,object:'account',country:'US',metadata:v2.metadata,details_submitted:true,payouts_enabled:caps.payouts.status==='active',capabilities:{transfers:caps.stripe_transfers.status==='active'?'active':'inactive'}}}
 }
 if(method==='POST'&&/^\/v1\/checkout\/sessions\/cs_[a-z]+_[A-Za-z0-9]+\/expire$/.test(route)){const session=stripe.sessions.get(route.split('/')[4]);if(!session||session.status!=='open')return Response.json({error:{message:'not open'}},{status:400});session.status='expired';session.url=null;value=session}
 if(method==='POST'&&route==='/v1/transfers'){
  if(fields.source_transaction){const charge=stripe.charges.get(fields.source_transaction);if(!charge||Number(fields.amount)>Number(charge.amount))return Response.json({error:{message:'transfer exceeds source charge'}},{status:400})}
  value={id:'tr_'+next(),object:'transfer',livemode,amount:Number(fields.amount),currency:'usd',destination:fields.destination,source_transaction:fields.source_transaction??null,transfer_group:fields.transfer_group,metadata:{order_id:fields['metadata[order_id]'],orderId:fields['metadata[orderId]'],...(fields['metadata[purpose]']?{purpose:fields['metadata[purpose]']}:{})},reversed:false};stripe.transfers.set(value.id as string,value);
 }
 if(method==='POST'&&/^\/v1\/transfers\/tr_[A-Za-z0-9]+\/reversals$/.test(route)){
  const transfer=stripe.transfers.get(route.split('/')[3]);if(!transfer)return Response.json({error:{message:'not found'}},{status:404});
  if((globalThis as {failReversals?:boolean}).failReversals)return Response.json({error:{message:'insufficient funds in the connected account'}},{status:400});
  transfer.reversed=true;value={id:'trr_'+next(),object:'transfer_reversal',amount:Number(fields.amount),currency:'usd',transfer:transfer.id};
 }
 if(!value)return Response.json({error:{message:'not found'}},{status:404});
 if(method==='POST'&&key)stripe.idem.set(route+key,structuredClone(value));
 return Response.json(value);
}
function pay(sessionId:string,{async:delayed=false}={}){
 const session=stripe.sessions.get(sessionId)!,fields=stripe.sessionFields.get(sessionId)!,livemode=session.livemode,orderId=session.client_reference_id as string,amount=session.amount_total as number;
 const pi='pi_'+next(),ch='ch_'+next(),meta={order_id:fields['payment_intent_data[metadata][order_id]'],orderId:fields['payment_intent_data[metadata][orderId]']};
 stripe.charges.set(ch,{id:ch,object:'charge',livemode,amount,amount_captured:amount,amount_refunded:0,paid:true,captured:true,currency:'usd',status:'succeeded',payment_intent:pi,disputed:false,refunded:false,metadata:{}});
 stripe.intents.set(pi,{id:pi,object:'payment_intent',livemode,currency:'usd',amount,amount_received:delayed?0:amount,metadata:meta,transfer_group:'ORDER_'+orderId,status:delayed?'processing':'succeeded',latest_charge:ch,transfer_data:null,application_fee_amount:null});
 Object.assign(session,{status:'complete',payment_status:delayed?'unpaid':'paid',payment_intent:pi,url:null});
 return {session,pi,ch};
}
function event(type:string,object:Obj,livemode=false,extra:Obj={}):[StripeVerifiedEvent,Uint8Array]{
 const value={id:'evt_'+next(),object:'event',type,livemode,created:Math.floor(Date.now()/1000),data:{object:structuredClone(object)},...extra};
 return [value as unknown as StripeVerifiedEvent,new TextEncoder().encode(JSON.stringify(value))];
}
const deliver=(type:string,object:Obj,env:Obj=testEnv,livemode=false,extra:Obj={})=>{const [e,raw]=event(type,object,livemode,extra);return commerceApplyWebhook(getDb(),e,raw,env)};

// ---- Database fixture (same isolated PGlite pattern as marketplace-business.test.ts) ----
let engine:PGlite;const pool=new Pool();
before(async()=>{
 engine=new PGlite();await nativeGcdFixture(engine);await engine.exec('CREATE SCHEMA ch_web;BEGIN;');
 const skip=new Set(['003_catalog_ingestion.sql','005_gcd_snapshot_import.sql']);
 for(const name of readdirSync('db/postgres-migrations').filter(n=>n.endsWith('.sql')&&!skip.has(n)&&(n<'025'||n.startsWith('026_')||n.startsWith('042_')||n.startsWith('043_')||n.startsWith('044_')||n.startsWith('045_')||n.startsWith('046_')||n.startsWith('047_')||n.startsWith('048_')||n.startsWith('049_')||n.startsWith('036_'))).sort())await engine.exec(readFileSync('db/postgres-migrations/'+name,'utf8'));
 await engine.exec('COMMIT;SET search_path TO ch_web,public;');
 const query=async(config:string|{text:string;rowMode?:string},values:unknown[]=[])=>{
  const result=await engine.query<Record<string,unknown>>(typeof config==='string'?config:config.text,values);
  return {...result,rowCount:result.affectedRows,command:'',rows:typeof config!=='string'&&config.rowMode==='array'?result.rows.map(row=>result.fields.map(field=>row[field.name])):result.rows};
 };
 Object.assign(pool,{query,connect:async()=>({query,release(){}})});
 (globalThis as typeof globalThis&{comicHuddlePool:Pool}).comicHuddlePool=pool;
 await getDb().batch(seedStarterStatements(getDb(),new Date().toISOString()));
 globalThis.fetch=fakeStripe as typeof fetch;
});
after(async()=>{globalThis.fetch=realFetch;await engine.close();delete (globalThis as typeof globalThis&{comicHuddlePool?:Pool}).comicHuddlePool});

async function collector(prefix:string,userId:string=crypto.randomUUID()){
 const stamp=new Date().toISOString(),uuid=crypto.randomUUID();
 return (await getDb().insert(profiles).values({id:uuid,userId,handle:prefix+'_'+uuid.slice(0,8),name:prefix,bio:'QA isolated fixture',tagline:'',location:'Minneapolis, MN',favorite:'',since:2026,color:'red',featured:'[]',visible:1,dmOpen:1,createdAt:stamp,rulesVersion:previewRulesVersion,rulesAcceptedAt:stamp}).returning())[0];
}
type Profile=Awaited<ReturnType<typeof collector>>;
async function offer(seller:Profile,price=60000){
 const db=getDb(),photo=crypto.randomUUID(),bookId=crypto.randomUUID();
 await db.insert(media).values({id:photo,userId:seller.userId,contentType:'image/jpeg',createdAt:new Date().toISOString()});await getPool().query('INSERT INTO ch_web.photo_bytes(key,body,content_type) VALUES($1,$2,$3)',['photos/'+photo,readFileSync('public/covers/planet-12.jpg'),'image/jpeg']);
 const old=(await db.select().from(collections).where(eq(collections.userId,seller.userId)))[0],vault=old?JSON.parse(old.data):emptyVault(seller.name);
 vault.books.push({id:bookId,title:'Amazing Spider-Man',issue:'#300',grade:'Raw 9.0',price:200,catalogId:0});
 await db.insert(collections).values({userId:seller.userId,data:JSON.stringify(vault),revision:crypto.randomUUID()}).onConflictDoUpdate({target:collections.userId,set:{data:JSON.stringify(vault),revision:crypto.randomUUID()}});
 const result=await createListing(db,seller,{action:'listing',kind:'single',saleType:'fixed',bookIds:[bookId],description:'Isolated QA owned-copy fixture.',price,shipping:1500,photos:[photo],attest:true,usaAttest:true});
 return (await db.select().from(listings).where(eq(listings.id,result.listingId)))[0];
}
const onboard=(seller:Profile,env:Obj=testEnv)=>commerceOnboard(getDb(),seller,'seller@example.test',{action:'seller_onboard',sandboxAcknowledged:true},env);
const checkout=(buyer:Profile,listingId:string,env:Obj=testEnv)=>commerceCheckout(getDb(),buyer,'buyer@example.test',{action:'checkout',listingId,requestId:crypto.randomUUID(),sandboxAcknowledged:true,shippingAddress:address},env);
const orderRow=async(id:string)=>(await getDb().select().from(commerceOrders).where(eq(commerceOrders.id,id)))[0];
const listingRow=async(id:string)=>(await getDb().select().from(listings).where(eq(listings.id,id)))[0];
const sessionOf=async(orderId:string)=>(await orderRow(orderId)).checkoutSessionId!;
async function setup(env:Obj=testEnv){const seller=await collector('seller'),buyer=await collector('buyer');await onboard(seller,env);const listing=await offer(seller);return {seller,buyer,listing}}
async function paidOrder(env:Obj=testEnv,livemode=false){
 const fixture=await setup(env),started=await checkout(fixture.buyer,fixture.listing.id,env),orderId=started.order.id,{session}=pay(await sessionOf(orderId));
 await deliver('checkout.session.completed',session,env,livemode);return {...fixture,orderId};
}

test('test-mode order: deterministic checkout expiry, signed payment, refund, and charge.refunded does not re-flag the order',async()=>{
 const {buyer,listing,orderId}=await paidOrder();
 const row=await orderRow(orderId),fields=stripe.sessionFields.get(row.checkoutSessionId!)!;
 assert.equal(row.sandbox,1);assert.match(row.checkoutSessionId!,/^cs_test_/);
 assert.equal(Number(fields.expires_at),Math.floor(Date.parse(row.createdAt)/1000)+3600,'Checkout expires one hour after the persisted order');
 assert.equal(JSON.parse(row.state).order.paidAt!==null,true);assert.equal((await listingRow(listing.id)).status,'pending','paid but not delivered: pending');
 // Duplicate payment signal for the same intent is accepted without a second state change.
 await deliver('payment_intent.succeeded',stripe.intents.get(row.paymentIntentId!)!);
 await commerceRequestRefund(getDb(),buyer.userId,{action:'request_refund',orderId,requestId:crypto.randomUUID(),reason:'Item never shipped'});
 const refunded=await commerceOwnerRefund(getDb(),ownerAccountId,{action:'owner_refund',orderId,requestId:crypto.randomUUID(),approveIssue:true},testEnv);
 assert.equal(refunded.order.status,'refunded');
 const charge=stripe.charges.get((await orderRow(orderId)).chargeId!)!;
 const before=await orderRow(orderId),result=await deliver('charge.refunded',charge);
 assert.equal((result as Obj).ignored,true);
 const afterRow=await orderRow(orderId);assert.equal(afterRow.status,'refunded');assert.equal(afterRow.version,before.version);
 assert.notEqual(JSON.parse(afterRow.state).holdReason,'unknown_processor_state_requires_reconciliation');
 const refund=[...stripe.refunds.values()].find(r=>r.payment_intent===afterRow.paymentIntentId)!;
 assert.equal(((await deliver('refund.updated',refund)) as Obj).duplicate,true);
});

test('charge.dispute.closed with a won dispute clears the open dispute instead of re-opening it',async()=>{
 const {orderId}=await paidOrder(),row=await orderRow(orderId);
 const dispute={id:'dp_'+next(),object:'dispute',livemode:false,charge:row.chargeId,payment_intent:row.paymentIntentId,currency:'usd',amount:61500,status:'needs_response',metadata:{}};
 stripe.disputes.set(dispute.id,dispute);
 await deliver('charge.dispute.created',dispute);assert.equal(JSON.parse((await orderRow(orderId)).state).dispute,'open');
 dispute.status='won';await deliver('charge.dispute.closed',dispute);
 assert.equal(JSON.parse((await orderRow(orderId)).state).dispute,'won');
 // A lost dispute is recorded as lost.
 const second=await paidOrder(),secondRow=await orderRow(second.orderId);
 const lost={...dispute,id:'dp_'+next(),charge:secondRow.chargeId,payment_intent:secondRow.paymentIntentId,status:'lost'};stripe.disputes.set(lost.id,lost);
 await deliver('charge.dispute.closed',lost);assert.equal(JSON.parse((await orderRow(second.orderId)).state).dispute,'lost');
});

test('expired checkout returns the listing to the marketplace with its inventory, and it can be bought again',async()=>{
 const {listing}=await setup(),buyer=await collector('buyer'),started=await checkout(buyer,listing.id),session=stripe.sessions.get(await sessionOf(started.order.id))!;
 assert.equal((await listingRow(listing.id)).status,'checkout_reserved');
 session.status='expired';await deliver('checkout.session.expired',session);
 assert.equal((await orderRow(started.order.id)).status,'checkout_expired');assert.equal((await listingRow(listing.id)).status,'active');
 assert.ok((await getDb().select().from(listingInventory).where(eq(listingInventory.listingId,listing.id))).length>0,'Inventory reservation is kept');
 const again=await checkout(await collector('buyer2'),listing.id);assert.ok(again.checkoutUrl);
});

test('a delayed payment that fails releases the reservation; completed-but-unpaid is acknowledged without retries',async()=>{
 const {buyer,listing}=await setup(),started=await checkout(buyer,listing.id),{session}=pay(await sessionOf(started.order.id),{async:true});
 const pending=await deliver('checkout.session.completed',session);assert.equal((pending as Obj).pending,true);
 assert.equal((await orderRow(started.order.id)).status,'awaiting_payment');
 await deliver('checkout.session.async_payment_failed',session);
 assert.equal((await orderRow(started.order.id)).status,'cancelled');assert.equal((await listingRow(listing.id)).status,'active');
});

const transfersCapability=(account:Obj)=>(((account.configuration as Obj).recipient as Obj).capabilities as {stripe_balance:{stripe_transfers:{status:string}}}).stripe_balance.stripe_transfers;
test('new sellers onboard as Accounts v2 recipients; POST /v1/accounts is never called',async()=>{
 const seller=await collector('seller'),result=await onboard(seller);
 const [record]=await getDb().select().from(commerceSellers).where(eq(commerceSellers.profileId,seller.id));
 assert.equal(JSON.parse(record.state).api,'v2');assert.equal(JSON.parse(record.state).ready,true);
 const account=stripe.v2accounts.get(record.stripeAccountId!)!;assert.deepEqual(account.metadata,{profile_id:seller.id,user_id:seller.userId});assert.equal(account.contact_email,'seller@example.test');
 assert.match(String(result.onboardingUrl),/^https:\/\/accounts\.stripe\.com\//);
 assert.ok(!stripe.requests.some(r=>r.method==='POST'&&r.route==='/v1/accounts'));
 // Non-sandbox test platforms reject v2 recipient links; the documented v1 account_links endpoint is used instead.
 stripe.v2LinkMode='testmode_rejects';try{const again=await onboard(seller);assert.match(String(again.onboardingUrl),/^https:\/\/connect\.stripe\.com\//)}finally{stripe.v2LinkMode='v2'}
});
test('v2 readiness needs active stripe_transfers and no currently/past-due requirements; checkout re-checks it',async()=>{
 const {seller,listing}=await setup();
 const [record]=await getDb().select().from(commerceSellers).where(eq(commerceSellers.profileId,seller.id));
 const account=stripe.v2accounts.get(record.stripeAccountId!)!;
 transfersCapability(account).status='restricted';
 await assert.rejects(checkout(await collector('buyer'),listing.id),(e:{status?:number})=>e.status===409);
 transfersCapability(account).status='active';(account.requirements as Obj).entries=[{description:'external_account',minimum_deadline:{status:'currently_due'}}];
 await assert.rejects(checkout(await collector('buyer'),listing.id),(e:{status?:number})=>e.status===409);
 (account.requirements as Obj).entries=[{description:'later',minimum_deadline:{status:'eventually_due'}}];
 assert.ok((await checkout(await collector('buyer'),listing.id)).checkoutUrl);
});
test('account.updated and v2 thin account events refresh seller readiness from the re-retrieved account',async()=>{
 const seller=await collector('seller');await onboard(seller);
 const [record]=await getDb().select().from(commerceSellers).where(eq(commerceSellers.profileId,seller.id));
 const account=stripe.v2accounts.get(record.stripeAccountId!)!;assert.equal((await commerceOverview(getDb(),seller.userId,testEnv)).seller.ready,true);
 transfersCapability(account).status='restricted';await deliver('account.updated',{id:account.id,object:'account'},testEnv,false,{account:account.id});
 assert.equal((await commerceOverview(getDb(),seller.userId,testEnv)).seller.ready,false);
 transfersCapability(account).status='active';
 const thin=thinAccountEvent({id:'evt_test_'+next(),object:'v2.core.event',type:'v2.core.account[configuration.recipient].capability_status_updated',livemode:false,created:new Date().toISOString(),related_object:{id:account.id,type:'v2.core.account',url:'/v2/core/accounts/'+account.id}},false);
 assert.equal(((await commerceApplyThinAccountEvent(getDb(),thin,testEnv)) as Obj).received,true);
 assert.equal((await commerceOverview(getDb(),seller.userId,testEnv)).seller.ready,true);
 assert.equal(JSON.parse((await getDb().select().from(commerceSellers).where(eq(commerceSellers.profileId,seller.id)))[0].state).api,'v2');
 // Unrelated thin event types are acknowledged and ignored; a live thin event is rejected by a test deployment.
 assert.equal(thinAccountEvent({id:'evt_test_x',object:'v2.core.event',type:'v2.core.account_person.created',livemode:false,related_object:{id:account.id,type:'v2.core.account_person'}},false),null);
 await assert.rejects(commerceApplyThinAccountEvent(getDb(),{...thin!,livemode:true},testEnv),(e:{status?:number})=>e.status===400);
});
test('legacy v1-bound sellers stay readable through the v1 readiness check',async()=>{
 const seller=await collector('legacy'),acct='acct_'+next();
 stripe.accounts.set(acct,{id:acct,object:'account',livemode:false,country:'US',metadata:{profile_id:seller.id,user_id:seller.userId},details_submitted:true,payouts_enabled:true,capabilities:{transfers:'active'}});
 await getDb().insert(commerceSellers).values({profileId:seller.id,userId:seller.userId,stripeAccountId:acct,state:JSON.stringify({ready:true,status:'verified',mode:'test'}),updatedAt:new Date().toISOString()});
 const listing=await offer(seller);assert.ok((await checkout(await collector('buyer'),listing.id)).checkoutUrl);
 const again=await onboard(seller);assert.match(String(again.onboardingUrl),/^https:\/\/connect\.stripe\.com\//);
 const [record]=await getDb().select().from(commerceSellers).where(eq(commerceSellers.profileId,seller.id));
 assert.equal(record.stripeAccountId,acct);assert.equal(JSON.parse(record.state).api,undefined);
 stripe.accounts.get(acct)!.payouts_enabled=false;await assert.rejects(checkout(await collector('buyer'),(await offer(seller)).id),(e:{status?:number})=>e.status===409);
});

test('live mode: separate seller binding, sandbox=0 orders, cs_live_ sessions, live wallet mode and strict mode isolation',async()=>{
 await assert.rejects(checkout(await collector('b'),'missing',{...liveEnv,COMMERCE_LIVE_REVIEWED:'false'}),(e:{status?:number})=>e.status===503);
 const seller=await collector('seller');await onboard(seller,testEnv);
 const [testRecord]=await getDb().select().from(commerceSellers).where(eq(commerceSellers.profileId,seller.id));
 assert.equal((await commerceOverview(getDb(),seller.userId,liveEnv)).seller.ready,false,'A test-mode seller is not ready in live mode');
 await onboard(seller,liveEnv);
 const [liveRecord]=await getDb().select().from(commerceSellers).where(eq(commerceSellers.profileId,seller.id));
 assert.notEqual(liveRecord.stripeAccountId,testRecord.stripeAccountId);assert.equal(JSON.parse(liveRecord.state).mode,'live');
 assert.equal(stripe.v2accounts.get(liveRecord.stripeAccountId!)!.livemode,true);
 const listing=await offer(seller),buyer=await collector('buyer'),started=await checkout(buyer,listing.id,liveEnv);
 const row=await orderRow(started.order.id);assert.equal(row.sandbox,0);assert.match(row.checkoutSessionId!,/^cs_live_/);assert.equal(started.sandbox,false);
 const reservation=await getPool().query('SELECT mode FROM ch_web.credit_reservations WHERE order_id=$1',[row.id]).catch(()=>({rows:[]}));
 if(reservation.rows.length)assert.equal(reservation.rows[0].mode,'live');
 const {session}=pay(row.checkoutSessionId!);
 await assert.rejects(deliver('checkout.session.completed',session,liveEnv,false),(e:{status?:number})=>e.status===400,'A test-mode event is rejected by a live deployment');
 assert.equal(((await deliver('checkout.session.completed',session,testEnv,false)) as Obj).ignored,true,'A test deployment ignores live orders');
 await deliver('checkout.session.completed',session,liveEnv,true);
 assert.notEqual(JSON.parse((await orderRow(row.id)).state).order.paidAt,null);
 await assert.rejects(commerceOwnerRefund(getDb(),ownerAccountId,{action:'owner_refund',orderId:row.id,requestId:crypto.randomUUID()},testEnv),(e:{status?:number})=>e.status===409);
 assert.ok(stripe.requests.filter(r=>r.route==='/v1/checkout/sessions'&&r.method==='POST').some(r=>r.auth===`Bearer ${liveEnv.COMMERCE_STRIPE_LIVE_SECRET_KEY}`));
});

test('order progress tracker follows the server order from placed to paid, shipped, delivered, and refunded',async()=>{
 const fixture=await setup(),started=await checkout(fixture.buyer,fixture.listing.id),orderId=started.order.id,db=getDb();
 const progress=async(userId=fixture.buyer.userId)=>{const dto=(await commerceOverview(db,userId,testEnv)).orders.find(o=>o.id===orderId)!;return {dto,model:orderProgress(dto)}};
 let {dto,model}=await progress();
 assert.equal(dto.status,'awaiting_payment');assert.equal(model.complete,1);assert.equal(model.current,1,'Order placed; payment is the current step');
 const {session}=pay(await sessionOf(orderId));await deliver('checkout.session.completed',session);
 ({dto,model}=await progress());assert.equal(dto.status,'awaiting_shipment');assert.equal(model.complete,2);assert.equal(model.current,2,'Paid; shipping is the current step');
 await commerceSubmitTracking(db,fixture.seller.userId,{action:'submit_tracking',orderId,carrier:'USPS',trackingNumber:'9400111899223197428490'});
 ({dto,model}=await progress());assert.equal(dto.tracking?.number,'9400111899223197428490');assert.equal(model.complete,3,'Seller tracking marks the order shipped');assert.equal(model.current,3);
 assert.equal(dto.status,'awaiting_shipment','Seller tracking without carrier confirmation does not release anything');assert.equal(dto.protectionReason,'carrier_confirmation_pending');assert.equal(dto.tracking?.verified,false);
 const seller=await progress(fixture.seller.userId);assert.equal(seller.dto.role,'seller');assert.equal(seller.model.complete,3,'Seller sees the same progress');assert.equal(seller.dto.fundsAvailableAt,null,'No funds date before confirmed delivery');
 // The same code path the signed EasyPost webhook uses.
 // The $600 fixture is under the $1,000 SafePurchase threshold: a Standard order, no signature, unchanged 72-hour hold.
 assert.deepEqual([dto.protection?.tier,dto.protection?.overThreshold,dto.protection?.comingSoon,dto.protection?.signatureRequired,dto.protection?.releaseHoldHours],['standard',false,false,false,72]);
 const deliveredAt=new Date(Date.now()-1000).toISOString();
 await commerceApplyCarrierUpdate(db,{trackerId:'trk_test',trackingCode:'9400111899223197428490',status:'delivered',occurredAt:deliveredAt,signedBy:null});
 assert.equal(commerceOrderDto(await orderRow(orderId),fixture.buyer.userId).protectionReason,'buyer_review_window_open','Under $1,000 is Standard: an unsigned delivery opens the normal review window');
 await commerceApplyCarrierUpdate(db,{trackerId:'trk_test',trackingCode:'9400111899223197428490',status:'delivered',occurredAt:deliveredAt,signedBy:'Q BUYER'});
 const delivered=commerceOrderDto(await orderRow(orderId),fixture.buyer.userId);
 assert.equal(delivered.status,'delivered_review');assert.equal(delivered.tracking?.verified,true);const done=orderProgress(delivered);assert.equal(done.complete,4);assert.equal(done.current,-1,'Every step is complete once delivery is confirmed');assert.equal(done.terminal,null);
 const sellerView=commerceOrderDto(await orderRow(orderId),fixture.seller.userId);
 assert.equal(Date.parse(sellerView.fundsAvailableAt!)-Date.parse(JSON.parse((await orderRow(orderId)).state).shipment.deliveredAt),72*3600000,'Standard funds are available 72 hours after carrier-confirmed delivery');
 assert.equal(sellerView.payoutsEnabled,false);
 await commerceRequestRefund(db,fixture.buyer.userId,{action:'request_refund',orderId,requestId:crypto.randomUUID(),reason:'Arrived damaged'});
 await commerceOwnerRefund(db,ownerAccountId,{action:'owner_refund',orderId,requestId:crypto.randomUUID(),approveIssue:true},testEnv);
 ({dto,model}=await progress());assert.equal(dto.status,'refunded');assert.equal(model.terminal?.label,'Refunded');assert.equal(model.current,-1);
});

// ---- Marketplace fee ----
const ledger=async(orderId:string,type:string)=>(await getDb().select().from(commerceEvents).where(eq(commerceEvents.orderId,orderId))).filter(e=>e.type===type).map(e=>JSON.parse(e.body));
test('marketplace fee: 8% of the item only is snapshotted; buyer pays the listed price; seller net is item + shipping - fee; ledger records and returns the fee',async()=>{
 const {buyer,seller,orderId}=await paidOrder();
 const row=await orderRow(orderId),snapshot=JSON.parse(row.snapshot);
 assert.equal(snapshot.itemAmountCents,60000);assert.equal(snapshot.shippingCents,1500);assert.equal(snapshot.platformFeeBps,800);
 assert.equal(snapshot.platformFeeCents,4800);assert.equal(snapshot.sellerTransferCents,56700);assert.equal(snapshot.totalCents,61500,'The fee is never added to the buyer charge');
 assert.equal(stripe.sessions.get(row.checkoutSessionId!)!.amount_total,61500);
 const sellerView=commerceOrderDto(row,seller.userId) as Obj,buyerView=commerceOrderDto(row,buyer.userId) as Obj;
 assert.equal(sellerView.platformFeeCents,4800);assert.equal(sellerView.sellerNetCents,56700);assert.equal(sellerView.saleCents,61500);
 assert.equal(buyerView.platformFeeCents,undefined);assert.equal(buyerView.sellerNetCents,undefined);
 assert.deepEqual((await ledger(orderId,'application_fee_recorded')).map(e=>e.amountCents),[4800]);
 await deliver('payment_intent.succeeded',stripe.intents.get(row.paymentIntentId!)!);
 assert.equal((await ledger(orderId,'application_fee_recorded')).length,1,'A duplicate payment signal records the fee once');
 await commerceRequestRefund(getDb(),buyer.userId,{action:'request_refund',orderId,requestId:crypto.randomUUID(),reason:'Item never shipped'});
 await commerceOwnerRefund(getDb(),ownerAccountId,{action:'owner_refund',orderId,requestId:crypto.randomUUID(),approveIssue:true},testEnv);
 assert.deepEqual((await ledger(orderId,'application_fee_refunded')).map(e=>e.amountCents),[-4800]);
});
test('fee config: max cap and rate are snapshotted, later config changes never alter the order; invalid config refuses checkout',async()=>{
 const capped={...testEnv,COMMERCE_PLATFORM_FEE_BPS:'1000',COMMERCE_PLATFORM_FEE_MAX_CENTS:'2500'};
 const {listing}=await setup(),started=await checkout(await collector('buyer'),listing.id,capped),snapshot=JSON.parse((await orderRow(started.order.id)).snapshot);
 assert.equal(snapshot.platformFeeCents,2500);assert.equal(snapshot.platformFeeBps,1000);assert.equal(snapshot.sellerTransferCents,61500-2500);
 const later=await commerceOverview(getDb(),(await getDb().select().from(profiles).where(eq(profiles.id,listing.sellerId)))[0].userId,testEnv);
 assert.equal((later.orders.find(o=>o.id===started.order.id) as Obj).platformFeeCents,2500);
 const other=await setup();
 await assert.rejects(checkout(await collector('buyer'),other.listing.id,{...testEnv,COMMERCE_PLATFORM_FEE_BPS:'nine'}),(e:{status?:number})=>e.status===503);
 await assert.rejects(checkout(await collector('buyer'),other.listing.id,{...testEnv,COMMERCE_PLATFORM_FEE_BPS:'5000'}),(e:{status?:number})=>e.status===503);
});
test('seller payout: one source_transaction transfer of the net; store-credit shortfall becomes a platform-funded top-up',async()=>{
 const {orderId}=await paidOrder(),row=await orderRow(orderId),state=JSON.parse(row.state);
 const processor=stripeSandbox(testEnv as never);
 const payout=await createSellerPayout(processor,{orderId,paymentIntentId:row.paymentIntentId!,chargeId:row.chargeId!,chargeCents:61500,sellerNetCents:56700,destination:state.order.sellerAccountId,keyBase:'comichuddle_test_payout_'+orderId});
 assert.equal(payout.legs.fromChargeCents,56700);assert.equal(payout.legs.platformTopUpCents,0);assert.equal(payout.topUp,null);
 const tr=stripe.transfers.get(payout.transfer!.id as string)!;assert.equal(tr.amount,56700);assert.equal(tr.source_transaction,row.chargeId);assert.equal(tr.destination,state.order.sellerAccountId);
 // Idempotent retry: same key, same transfer.
 const again=await createSellerPayout(processor,{orderId,paymentIntentId:row.paymentIntentId!,chargeId:row.chargeId!,chargeCents:61500,sellerNetCents:56700,destination:state.order.sellerAccountId,keyBase:'comichuddle_test_payout_'+orderId});
 assert.equal(again.transfer!.id,payout.transfer!.id);
 // Credit-funded: the buyer paid 61500 but the seller is owed 70000 -> 61500 from the charge + 8500 from the platform balance.
 const credit=await createSellerPayout(processor,{orderId,paymentIntentId:row.paymentIntentId!,chargeId:row.chargeId!,chargeCents:61500,sellerNetCents:70000,destination:state.order.sellerAccountId,keyBase:'comichuddle_test_credit_'+orderId});
 assert.deepEqual(credit.legs,{fromChargeCents:61500,platformTopUpCents:8500});
 const topUp=stripe.transfers.get(credit.topUp!.id as string)!;assert.equal(topUp.amount,8500);assert.equal(topUp.source_transaction,null);assert.equal((topUp.metadata as Obj).purpose,'store_credit_topup');
});
test('owner release is gated: owner only, payouts flag required, and the order must be release-eligible',async()=>{
 const {orderId,buyer}=await paidOrder(),body={action:'owner_release',orderId,requestId:crypto.randomUUID()};
 await assert.rejects(commerceOwnerRelease(getDb(),buyer.userId,body,testEnv),(e:{status?:number})=>e.status===403);
 await assert.rejects(commerceOwnerRelease(getDb(),ownerAccountId,body,testEnv),(e:{status?:number})=>e.status===503);
 await assert.rejects(commerceOwnerRelease(getDb(),ownerAccountId,body,{...testEnv,COMMERCE_PAYOUTS_ENABLED:'true'}),(e:{status?:number})=>e.status===409);
 assert.ok(![...stripe.transfers.values()].some(t=>(t.metadata as Obj).order_id===orderId),'No transfer for an order that is not release-eligible');
});
test('owner revenue summary: fees, GMV and refunds for the current mode; owner only',async()=>{
 const revenue=await commerceOwnerRevenue(getDb(),ownerAccountId,testEnv);
 assert.ok(revenue.paidOrders>0);assert.ok(revenue.platformFeesCents>=4800);assert.ok(revenue.refundedOrders>=1);
 assert.equal(revenue.ownerNetCents,revenue.platformFeesCents+revenue.safePurchaseFeesCents-revenue.feesRefundedCents-revenue.storeCreditSubsidyCents-revenue.estimatedStripeFeesCents);
 await assert.rejects(commerceOwnerRevenue(getDb(),crypto.randomUUID(),testEnv),(e:{status?:number})=>e.status===403);
});
test('a not-ready seller is re-checked with Stripe on read (60s rate limit; 10s after ?seller=return); eventually_due does not block',async()=>{
 const seller=await collector('seller');await onboard(seller);
 const [record]=await getDb().select().from(commerceSellers).where(eq(commerceSellers.profileId,seller.id)),account=stripe.v2accounts.get(record.stripeAccountId!)!;
 transfersCapability(account).status='restricted';await deliver('account.updated',{id:account.id,object:'account'},testEnv,false,{account:account.id});
 assert.equal((await commerceOverview(getDb(),seller.userId,testEnv)).seller.ready,false);
 // Hosted onboarding finishes; no webhook reaches the app.
 transfersCapability(account).status='active';(account.requirements as Obj).entries=[{description:'identity.individual.id_numbers.us_ssn_last_4',minimum_deadline:{status:'eventually_due'}}];
 const gets=()=>stripe.requests.filter(r=>r.method==='GET'&&r.route==='/v2/core/accounts/'+account.id).length,before=gets();
 assert.equal((await commerceOverview(getDb(),seller.userId,testEnv)).seller.ready,false,'Within 60s the stored state is served');assert.equal(gets(),before);
 const age=(ms:number)=>getDb().update(commerceSellers).set({updatedAt:new Date(Date.now()-ms).toISOString()}).where(eq(commerceSellers.profileId,seller.id));
 await age(15_000);assert.equal((await commerceOverview(getDb(),seller.userId,testEnv,undefined,{sellerReturn:true})).seller.ready,true,'Returning from onboarding refreshes after 10s');
 transfersCapability(account).status='restricted';await deliver('account.updated',{id:account.id,object:'account'},testEnv,false,{account:account.id});
 transfersCapability(account).status='active';await age(61_000);
 assert.equal((await commerceOverview(getDb(),seller.userId,testEnv)).seller.ready,true,'A plain read refreshes after 60s');
});
test('buyer can resume the same unpaid checkout (no second order or session) and sees the reservation end',async()=>{
 const {listing,buyer}=await setup(),started=await checkout(buyer,listing.id),row=await orderRow(started.order.id);
 const sessionPosts=()=>stripe.requests.filter(r=>r.method==='POST'&&r.route==='/v1/checkout/sessions').length,before=sessionPosts();
 const resumed=await commerceResumePayment(getDb(),buyer.userId,'buyer@example.test',{action:'resume_payment',orderId:row.id},testEnv);
 assert.equal(resumed.checkoutUrl,started.checkoutUrl);assert.equal(sessionPosts(),before,'The existing session is reused');
 assert.equal(resumed.reservedUntil,new Date(Date.parse(row.createdAt)+3600000).toISOString());
 assert.equal((commerceOrderDto(row,buyer.userId) as Obj).reservedUntil,resumed.reservedUntil);
 await assert.rejects(commerceResumePayment(getDb(),(await getDb().select().from(profiles).where(eq(profiles.id,listing.sellerId)))[0].userId,'x@example.test',{action:'resume_payment',orderId:row.id},testEnv),(e:{status?:number})=>e.status===403);
});
test('buyer can cancel an unpaid checkout: the session is expired at Stripe and the listing goes back on sale; paid orders cannot be cancelled this way',async()=>{
 const {listing,buyer}=await setup(),started=await checkout(buyer,listing.id),row=await orderRow(started.order.id);
 const result=await commerceCancelCheckout(getDb(),buyer.userId,{action:'cancel_checkout',orderId:row.id},testEnv);
 assert.equal(result.order.status,'cancelled');assert.equal(stripe.sessions.get(row.checkoutSessionId!)!.status,'expired');
 assert.equal((await listingRow(listing.id)).status,'active');
 assert.ok((await checkout(await collector('buyer2'),listing.id)).checkoutUrl,'Another buyer can buy it now');
 await assert.rejects(commerceResumePayment(getDb(),buyer.userId,'buyer@example.test',{action:'resume_payment',orderId:row.id},testEnv),(e:{status?:number})=>e.status===409);
 const paid=await paidOrder();
 await assert.rejects(commerceCancelCheckout(getDb(),paid.buyer.userId,{action:'cancel_checkout',orderId:paid.orderId},testEnv),(e:{status?:number})=>e.status===409);
});
test('Stripe Dashboard readability: PaymentIntent description and statement suffix carry the order reference and title',async()=>{
 const {listing,buyer}=await setup(),started=await checkout(buyer,listing.id),row=await orderRow(started.order.id),fields=stripe.sessionFields.get(row.checkoutSessionId!)!;
 const ref=row.id.replace(/[^A-Za-z0-9]/g,'').slice(0,8).toUpperCase();
 assert.equal(fields['payment_intent_data[description]'],'ComicHuddle order '+ref+' · '+JSON.parse(row.snapshot).title);
 assert.equal(fields['payment_intent_data[statement_descriptor_suffix]'],'CH '+ref);assert.ok(fields['payment_intent_data[statement_descriptor_suffix]'].length<=22);
});
test('refund after the seller was paid: the transfer is reversed first; if Stripe refuses, the order is held and nothing is refunded',async t=>{
 const db=getDb(),{orderId,buyer,seller}=await paidOrder(),env={...testEnv,COMMERCE_PAYOUTS_ENABLED:'true'};
 await commerceSubmitTracking(db,seller.userId,{action:'submit_tracking',orderId,carrier:'USPS',trackingNumber:'9400111899223197425555'},env);
 await commerceApplyCarrierUpdate(db,{trackerId:null,trackingCode:'9400111899223197425555',status:'delivered',occurredAt:null,signedBy:'Q BUYER'});
 // Five days later: the buyer review window has ended.
 t.mock.timers.enable({apis:['Date'],now:Date.now()+5*86400000});
 const released=await commerceOwnerRelease(db,ownerAccountId,{action:'owner_release',orderId,requestId:crypto.randomUUID()},env);
 assert.equal(released.order.status,'transferred','released to the seller after the review window');
 await commerceRequestRefund(db,buyer.userId,{action:'request_refund',orderId,requestId:crypto.randomUUID(),reason:'Not as described'});
 (globalThis as {failReversals?:boolean}).failReversals=true;
 try{await assert.rejects(commerceOwnerRefund(db,ownerAccountId,{action:'owner_refund',orderId,requestId:crypto.randomUUID(),approveIssue:true},env),(e:{status?:number})=>e.status===502)}
 finally{(globalThis as {failReversals?:boolean}).failReversals=false}
 const held=JSON.parse((await orderRow(orderId)).state);
 assert.equal(held.holdReason,'transfer_reversal_failed','held for manual review');assert.equal(held.financial.kind,'transfer','no refund was issued');
 const intent=stripe.intents.get(JSON.parse((await orderRow(orderId)).state).order.paymentIntentId) as Obj|undefined;void intent;
 assert.equal([...stripe.refunds.values()].filter(r=>(r as Obj).payment_intent===held.order.paymentIntentId).length,0,'the buyer was not refunded while the transfer is unresolved');
});

test('seller trust tiers, manual bank payouts 7 days after delivery, and payout.failed alerts',async()=>{
 const {seller,orderId}=await paidOrder(),pool=getPool();
 let tier=await sellerTier(seller.userId,1);assert.deepEqual([tier.tier,tier.schedule,tier.payoutDelayDays],['new','manual',7],'new sellers: manual payouts after 7 days');
 // Five completed, problem-free orders make a trusted seller; one claim drops them back.
 for(let i=0;i<5;i++)await pool.query("INSERT INTO ch_web.commerce_orders SELECT gen_random_uuid()::text,buyer_id,buyer_user_id,seller_id,seller_user_id,gen_random_uuid()::text,gen_random_uuid()::text,'transferred',version,sandbox,snapshot,state,NULL,NULL,charge_id,transfer_id,created_at,updated_at FROM ch_web.commerce_orders WHERE id=$1",[orderId]).catch(async()=>{
  const cols=(await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='ch_web' AND table_name='commerce_orders' ORDER BY ordinal_position")).rows.map((r:{column_name:string})=>r.column_name);
  const pick=cols.map((c:string)=>c==='id'||c==='listing_id'||c==='request_id'?'gen_random_uuid()::text':c==='status'?"'transferred'":c==='checkout_session_id'||c==='payment_intent_id'?'NULL':c).join(',');
  await pool.query('INSERT INTO ch_web.commerce_orders('+cols.join(',')+') SELECT '+pick+' FROM ch_web.commerce_orders WHERE id=$1',[orderId]);
 });
 tier=await sellerTier(seller.userId,1);assert.deepEqual([tier.tier,tier.schedule],['trusted','daily'],'5+ completed orders and no problems: daily automatic payouts');
 const processor=stripeSandbox(testEnv as never);
 await syncPayoutSchedule(processor,seller.userId,1);
 const schedule=stripe.requests.filter(r=>r.method==='POST'&&r.route.startsWith('/v1/accounts/acct_'));assert.equal((schedule.at(-1) as unknown as {fields:Record<string,string>}).fields['settings[payouts][schedule][interval]'],'daily');
 await syncPayoutSchedule(processor,seller.userId,1);assert.equal(stripe.requests.filter(r=>r.method==='POST'&&r.route.startsWith('/v1/accounts/acct_')).length,schedule.length,'no Stripe call when the tier did not change');
 await pool.query("UPDATE ch_web.commerce_orders SET state=jsonb_set(state::jsonb,'{dispute}','\"open\"')::text WHERE id=$1",[orderId]);
 assert.equal((await sellerTier(seller.userId,1)).tier,'new','any dispute drops the seller back');
 // Manual payout: the released order delivered 8 days ago gets exactly one bank payout, even when the job runs twice.
 await pool.query("UPDATE ch_web.commerce_sellers SET state=(state::jsonb||'{\"payoutSchedule\":\"manual\"}')::text WHERE user_id=$1",[seller.userId]);
 await pool.query("UPDATE ch_web.commerce_orders SET status='transferred',state=jsonb_set(jsonb_set(state::jsonb,'{dispute}','\"none\"'),'{shipment,deliveredAt}',to_jsonb($2::text))::text WHERE id=$1",[orderId,new Date(Date.now()-8*86400000).toISOString()]);
 const first=await runManualPayouts(processor,1);assert.ok(first.some(r=>r.orderId===orderId&&r.result==='payout_created'));
 const second=await runManualPayouts(processor,1);assert.ok(!second.some(r=>r.orderId===orderId),'never paid twice');
 const row=(await pool.query('SELECT stripe_payout_id,status FROM ch_web.seller_payouts WHERE order_id=$1',[orderId])).rows[0];assert.match(row.stripe_payout_id,/^po_/);
 // payout.failed: one alert for the seller, shown until a later payout succeeds.
 const account=(await pool.query('SELECT stripe_account_id FROM ch_web.commerce_sellers WHERE user_id=$1',[seller.userId])).rows[0].stripe_account_id;
 const failed={id:'evt_po_fail',type:'payout.failed',livemode:false,account,data:{object:{id:row.stripe_payout_id,amount:100,status:'failed',failure_message:'The bank account is closed.'}}};
 await applyPayoutEvent(failed as never,1);await applyPayoutEvent(failed as never,1);
 const alerts=(await pool.query("SELECT count(*)::int AS n FROM ch_web.notifications WHERE user_id=$1 AND kind='payout'",[seller.userId])).rows[0].n;
 assert.equal(alerts,1,'a retried webhook never alerts twice');
 assert.equal((await payoutProblem(seller.userId))?.message,'The bank account is closed.');
 await applyPayoutEvent({...failed,id:'evt_po_paid',type:'payout.paid',data:{object:{...failed.data.object,status:'paid',failure_message:null}}} as never,1);
 assert.equal(await payoutProblem(seller.userId),null,'cleared once a payout succeeds');
});

test('Support ComicHuddle: platform payment, confirmed only by the signed webhook, never wallet money',async()=>{
 const pool=getPool(),buyer=await collector('supporter'),processor=stripeSandbox(testEnv as never);
 const walletBefore=JSON.stringify((await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='ch_web' AND table_name LIKE '%wallet%' OR table_name LIKE '%reward%' OR table_name LIKE '%credit%'")).rows);
 const counts=async()=>{const out:Record<string,number>={};for(const t of ['commerce_orders','commerce_money_requests']){out[t]=(await pool.query('SELECT count(*)::int AS n FROM ch_web.'+t)).rows[0].n}return out};
 const before=await counts();
 await assert.rejects(startSupportCheckout(processor,{amountCents:50,userId:buyer.userId,name:'QA',sandbox:1}),/minimum/);
 await assert.rejects(startSupportCheckout(processor,{amountCents:50001,userId:buyer.userId,name:'QA',sandbox:1}),/maximum/);
 const started=await startSupportCheckout(processor,{amountCents:1000,userId:buyer.userId,name:'QA Supporter',sandbox:1});
 const req=stripe.requests.filter(r=>r.method==='POST'&&r.route==='/v1/checkout/sessions').at(-1)!;void req;
 const sid=(await pool.query('SELECT checkout_session_id FROM ch_web.support_payments WHERE id=$1',[started.id])).rows[0].checkout_session_id;
 const fields=stripe.sessionFields.get(sid)!;
 assert.equal(fields['payment_intent_data[transfer_group]'],undefined,'no Connect transfer group');assert.equal(fields['payment_intent_data[transfer_data][destination]'],undefined,'no seller');
 assert.equal((await supportStatus(started.id))?.status,'pending','returning to the thank-you page alone never marks it paid');
 const session={...stripe.sessions.get(sid)!,status:'complete',payment_status:'paid',payment_intent:'pi_support_1'};
 // A mismatched amount is ignored.
 await deliver('checkout.session.completed',{...session,amount_total:999});assert.equal((await supportStatus(started.id))?.status,'pending');
 await deliver('checkout.session.completed',session);await deliver('checkout.session.completed',session);
 assert.equal((await supportStatus(started.id))?.status,'paid');
 assert.equal((await supportReceipts(buyer.userId)).length,1,'one receipt for the supporter');
 assert.equal((await supportPaymentsForOwner(1)).rows.filter(r=>r.id===started.id).length,1,'listed in the owner view');
 assert.deepEqual(await counts(),before,'no marketplace order or money request was created');
 assert.equal(JSON.stringify((await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='ch_web' AND table_name LIKE '%wallet%' OR table_name LIKE '%reward%' OR table_name LIKE '%credit%'")).rows),walletBefore);
 const ledgers=(await pool.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='ch_web' AND column_name='support_payment_id'")).rows[0].n;
 assert.equal(ledgers,0,'no wallet, points or credit table references support payments');
});

// ---- Saved cards and automatic charging of auction winners ----
async function wonAuction(){
 const fixture=await setup(),db=getDb(),stamp=new Date().toISOString(),ended=new Date(Date.now()-60000).toISOString(),due=new Date(Date.now()+48*3600000).toISOString();
 await db.update(listings).set({saleType:'auction',status:'auction_won',leaderId:fixture.buyer.id,currentBid:fixture.listing.price,bidCount:1,endAt:ended}).where(eq(listings.id,fixture.listing.id));
 await getPool().query("INSERT INTO ch_web.marketplace_auction_terms(listing_id,reserve_cents,result,winner_id,winning_cents,resolved_at,payment_due_at,created_at) VALUES($1,NULL,'awaiting_payment',$2,$3,$4,$5,$4)",[fixture.listing.id,fixture.buyer.id,fixture.listing.price,stamp,due]);
 return fixture;
}
async function saveCard(buyer:Profile){
 const processor=stripeSandbox(testEnv as never),started=await startSaveCard(processor,{userId:buyer.userId,profileId:buyer.id,email:'buyer@example.test',sandbox:1,raw:{action:'save_card',shippingAddress:address,returnTo:'/?section=Marketplace'}});
 assert.match(started.url,/^https:\/\/checkout\.stripe\.com\//);
 const sid=(await getPool().query('SELECT setup_session_id FROM ch_web.buyer_saved_cards WHERE user_id=$1',[buyer.userId])).rows[0].setup_session_id as string,session=stripe.sessions.get(sid)!;
 assert.equal(session.mode,'setup');assert.match(String(session.success_url),/card_session=\{CHECKOUT_SESSION_ID\}/);
 assert.equal(await chargeableCard(buyer.userId,1),null,'nothing counts as saved before Stripe confirms the setup');
 Object.assign(session,{status:'complete',setup_intent:{id:'seti_'+next(),object:'setup_intent',status:'succeeded',payment_method:{id:'pm_'+next(),object:'payment_method',type:'card',customer:session.customer,card:{brand:'visa',last4:'4242',exp_month:12,exp_year:2031}}}});
 const result=await deliver('checkout.session.completed',session);assert.equal((result as {savedCard?:string}).savedCard,'saved');
 assert.equal((await deliver('checkout.session.completed',session) as {savedCard?:string}).savedCard,'duplicate','a repeated webhook changes nothing');
}
test('auctions: a saved card is required to bid, and the winner is charged automatically, exactly once',async()=>{
 const {buyer,listing}=await wonAuction(),db=getDb();
 await assert.rejects(commerceBidCardGate(db,buyer,{listingId:listing.id},testEnv),(e:{status?:number})=>e.status===428,'no saved card: binding bids are refused');
 await commerceBidCardGate(db,buyer,{listingId:listing.id},{...testEnv,AUCTION_SAVED_CARD_REQUIRED:'false'});
 await saveCard(buyer);
 const view=await savedCardView(buyer.userId,1);assert.equal(view?.last4,'4242');assert.equal(view?.address?.postalCode,'55401');assert.ok(!('stripe_customer_id' in (view||{})),'the buyer view never carries Stripe IDs');
 await commerceBidCardGate(db,buyer,{listingId:listing.id},testEnv);
 const first=await commerceChargeAuctionWinners(db,testEnv);
 assert.equal(first.charged,1,JSON.stringify(first));
 const orderId=first.results![0].orderId!,order=await orderRow(orderId),snapshot=JSON.parse(order.snapshot);
 assert.equal(snapshot.autoCharge,true);assert.equal(snapshot.itemAmountCents,listing.price);assert.equal(snapshot.shippingAddress.postalCode,'55401');assert.equal(snapshot.totalCents,listing.price+listing.shipping);
 assert.ok(order.paymentIntentId&&order.chargeId,'paid: bound to the server-verified intent and charge');assert.equal(order.checkoutSessionId,null);
 assert.equal((await listingRow(listing.id)).status,'pending','paid auction listing shows Pending until delivery');
 assert.equal((await getPool().query('SELECT result FROM ch_web.marketplace_auction_terms WHERE listing_id=$1',[listing.id])).rows[0].result,'paid');
 // The signed webhook arriving afterwards is a harmless duplicate.
 await deliver('payment_intent.succeeded',stripe.intents.get(order.paymentIntentId!)!);
 {const after=await orderRow(orderId);assert.equal(after.status,order.status,'no second payment change');assert.equal(after.chargeId,order.chargeId);assert.equal(after.paymentIntentId,order.paymentIntentId)}
 const again=await commerceChargeAuctionWinners(db,testEnv);assert.equal(again.charged,0);
 assert.equal(stripe.requests.filter(r=>r.method==='POST'&&r.route==='/v1/payment_intents').length,1,'one charge, ever');
 const note=(await getPool().query("SELECT title FROM ch_web.notifications WHERE user_id=$1 AND title LIKE 'Charged for your auction win%'",[buyer.userId])).rows;assert.equal(note.length,1);
});
test('auctions: a declined saved card releases the hold, tells the winner, and they can still pay within 48 hours',async()=>{
 const {buyer,listing}=await wonAuction(),db=getDb();await saveCard(buyer);
 (globalThis as {declineCards?:boolean}).declineCards=true;
 try{
  const result=await commerceChargeAuctionWinners(db,testEnv);
  const mine=result.results!.find(r=>r.listingId===listing.id)!;assert.equal(mine.result,'failed');assert.equal(mine.reason,'card_declined');
  assert.equal((await orderRow(mine.orderId!)).status,'cancelled');
  assert.equal((await listingRow(listing.id)).status,'auction_won','back to the winner’s 48-hour window');
  const again=await commerceChargeAuctionWinners(db,testEnv);assert.ok(!again.results!.some(r=>r.listingId===listing.id),'a declined card is not retried automatically');
 }finally{(globalThis as {declineCards?:boolean}).declineCards=false}
 const note=(await getPool().query("SELECT body FROM ch_web.notifications WHERE user_id=$1 AND title LIKE 'Pay for your auction win%'",[buyer.userId])).rows;
 assert.equal(note.length,1);assert.match(String(note[0].body),/ending 4242/);
 const manual=await checkout(buyer,listing.id);assert.ok(manual.checkoutUrl,'the winner can still pay through normal checkout');
});
test('auctions: a winner without a saved card is left to the 48-hour window; nothing is charged',async()=>{
 const {buyer,listing}=await wonAuction(),before=stripe.requests.filter(r=>r.route==='/v1/payment_intents').length;
 const result=await commerceChargeAuctionWinners(getDb(),testEnv,{listingIds:[listing.id]});
 assert.equal(result.results![0].result,'skipped');assert.equal(result.results![0].reason,'no_saved_card');
 assert.equal(stripe.requests.filter(r=>r.route==='/v1/payment_intents').length,before);
 assert.equal((await listingRow(listing.id)).status,'auction_won');
 const manual=await checkout(buyer,listing.id);assert.ok(manual.checkoutUrl);
});

test('SafePurchase claim after the seller was paid: ComicHuddle refunds the buyer and the seller keeps the payout',async()=>{
 const db=getDb(),env={...testEnv,COMMERCE_PAYOUTS_ENABLED:'true',SAFEPURCHASE_ENABLED:'true',SAFEPURCHASE_INSPECTION_ADDRESS:'ComicHuddle Inspection Center, 100 Test Ave, Minneapolis, MN 55401'};
 const seller=await collector('spseller'),buyer=await collector('spbuyer');await onboard(seller,env);const listing=await offer(seller,150000);
 const started=await commerceCheckout(db,buyer,'buyer@example.test',{action:'checkout',listingId:listing.id,requestId:crypto.randomUUID(),sandboxAcknowledged:true,shippingAddress:address,safePurchaseOptIn:true},env),orderId=started.order.id,{session}=pay(await sessionOf(orderId));
 await deliver('checkout.session.completed',session,env);
 await commerceSubmitTracking(db,seller.userId,{action:'submit_tracking',orderId,carrier:'UPS',trackingNumber:'1Z999AA10123456784'},env);
 await commerceInspection(db,ownerAccountId,{action:'inspection',orderId,step:'receive'},env);
 await commerceInspection(db,ownerAccountId,{action:'inspection',orderId,step:'decide',result:'passed',requestId:crypto.randomUUID()},env);
 await commerceInspection(db,ownerAccountId,{action:'inspection',orderId,step:'ship',carrier:'UPS',trackingNumber:'1Z999AA10123456799'},env);
 const released=await commerceOwnerRelease(db,ownerAccountId,{action:'owner_release',orderId,requestId:crypto.randomUUID()},env);
 assert.equal(released.order.status,'transferred','Checked and shipped: the seller is paid');
 const spRefund=(requestId=crypto.randomUUID(),extra:Obj={})=>commerceSafePurchaseRefund(db,ownerAccountId,{action:'safepurchase_refund',orderId,requestId,...extra},env);
 await assert.rejects(spRefund(),(e:{status?:number})=>e.status===409,'No refund without a buyer claim');
 const claim=await commerceRequestRefund(db,buyer.userId,{action:'request_refund',orderId,requestId:crypto.randomUUID(),reason:'Spine split after delivery'});
 assert.match(String(claim.note),/ComicHuddle reviews SafePurchase problems/);
 await assert.rejects(commerceSafePurchaseRefund(db,buyer.userId,{action:'safepurchase_refund',orderId,requestId:crypto.randomUUID()},env),(e:{status?:number})=>e.status===403,'Buyers cannot approve their own claim');
 const total=JSON.parse((await orderRow(orderId)).state).order.totalCents as number;
 await assert.rejects(spRefund(crypto.randomUUID(),{amountCents:total+1}),(e:{status?:number})=>e.status===400,'Never more than the buyer paid');
 // The normal "approve refund" on a paid-out SafePurchase order takes the ComicHuddle path (no transfer reversal).
 const refunded=await commerceOwnerRefund(db,ownerAccountId,{action:'owner_refund',orderId,requestId:crypto.randomUUID(),approveIssue:true},env) as {order:Obj};
 assert.deepEqual(refunded.order.platformRefund,{amountCents:total,status:'succeeded',refundedAt:(refunded.order.platformRefund as Obj).refundedAt});
 assert.equal(refunded.order.status,'transferred','The seller transfer stays in place');
 const state=JSON.parse((await orderRow(orderId)).state);
 assert.deepEqual([state.financial.kind,!!state.financial.confirmedAt,state.issue.open,state.holdReason],['transfer',true,false,null]);
 assert.equal([...stripe.transfers.values()].filter(t=>(t.metadata as Obj).order_id===orderId&&t.reversed).length,0,'No transfer reversal');
 const refunds=[...stripe.refunds.values()].filter(r=>r.payment_intent===state.order.paymentIntentId);
 assert.deepEqual(refunds.map(r=>r.amount),[total],'One refund for the full amount');
 // Repeat approval and Stripe's own webhooks don't refund twice or put the order on hold.
 assert.equal(((await spRefund()) as {duplicate?:boolean}).duplicate,true);
 await deliver('refund.updated',refunds[0],env);
 await deliver('charge.refunded',stripe.charges.get(state.order.chargeId)!,env);
 const after=JSON.parse((await orderRow(orderId)).state);
 assert.deepEqual([after.holdReason,after.platformRefund.status,(await orderRow(orderId)).status],[null,'succeeded','transferred']);
 assert.equal([...stripe.refunds.values()].filter(r=>r.payment_intent===state.order.paymentIntentId).length,1);
 await assert.rejects(commerceRequestRefund(db,buyer.userId,{action:'request_refund',orderId,requestId:crypto.randomUUID(),reason:'Again'}),(e:{status?:number})=>e.status===409,'One ComicHuddle refund per order');
 const sellerView=commerceOrderDto(await orderRow(orderId),seller.userId) as Obj;
 assert.equal((sellerView.platformRefund as Obj).amountCents,total,'The seller sees ComicHuddle covered it');
 const revenue=await commerceOwnerRevenue(db,ownerAccountId,env);
 assert.ok(revenue.safePurchaseRefundsCents>=total,'Counted as a ComicHuddle cost');
});
