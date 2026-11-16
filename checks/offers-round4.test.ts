// Run: node --import tsx --test checks/offers-round4.test.ts
// Offers & trades (round 4): counters, expiry, accepted-offer checkout, seller delivery details,
// pickup-code expiry refunds and notifications. Fixture copied from marketplace-protection.test.ts.
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
import {profiles,collections,media,listings,listingInventory,commerceOrders,auctionBids,offers} from '../db/schema';
import {commerceDeliveryInfo,commerceOfferCheckout,commercePickupCodeOpen,commercePickupExpirySweep} from '../lib/commerce';
import {listOffersAndTrades,offerExpired,respondToOffer} from '../lib/offers';
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
 for(const name of readdirSync('db/postgres-migrations').filter(n=>n.endsWith('.sql')&&!skip.has(n)&&(n<'025'||n.startsWith('026_')||n.startsWith('042_'))).sort())await engine.exec(readFileSync('db/postgres-migrations/'+name,'utf8'));
 await engine.exec('COMMIT;SET search_path TO ch_web,public;');
 for(const name of ['036_notifications.sql','039_offer_terms.sql'])await engine.exec(readFileSync('db/postgres-migrations/'+name,'utf8'));
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


// ---------- Offers helper (round 4) ----------
async function makeOffer(buyer:Profile,listingId:string,amount:number){const id=crypto.randomUUID();await getDb().insert(offers).values({id,listingId,buyerId:buyer.id,amount,note:'QA offer',status:'pending',createdAt:new Date().toISOString()});return id}
const notes=async(userId:string)=>(await getPool().query<{kind:string;title:string}>('SELECT kind,title FROM ch_web.notifications WHERE user_id=$1 ORDER BY created_at',[userId])).rows;
const offerCheckout=(buyer:Profile,offerId:string,env:Obj=testEnv,extra:Obj={})=>commerceOfferCheckout(getDb(),buyer,'buyer@example.test',{action:'offer_checkout',offerId,requestId:crypto.randomUUID(),sandboxAcknowledged:true,...(extra.fulfillment==='pickup'?{}:{shippingAddress:address}),...extra},env);

test('offers: counter, accept and the accepted offer checkout at the agreed price; seller delivery details are server-gated',async()=>{
 const seller=await collector('ofseller'),buyer=await collector('ofbuyer'),outsider=await collector('ofoutsider');await onboard(seller);
 const listing=await offer(seller,{price:20000,shipping:900}),offerId=await makeOffer(buyer,listing.id,12000);
 await rejects(respondToOffer(getDb(),buyer,{action:'respond',offerId,decision:'accept',expectedStatus:'pending',expectedAmount:12000}),403,/turn/);
 await rejects(respondToOffer(getDb(),seller,{action:'respond',offerId,decision:'counter',expectedStatus:'pending',expectedAmount:12000,amount:11000}),400,/higher/);
 await rejects(respondToOffer(getDb(),seller,{action:'respond',offerId,decision:'counter',expectedStatus:'pending',expectedAmount:12000,amount:25000}),400,/listed price/);
 assert.equal((await respondToOffer(getDb(),seller,{action:'respond',offerId,decision:'counter',expectedStatus:'pending',expectedAmount:12000,amount:16000})).status,'countered');
 await rejects(offerCheckout(buyer,offerId),409,/accepted offer/);
 assert.equal((await respondToOffer(getDb(),buyer,{action:'respond',offerId,decision:'accept',expectedStatus:'countered',expectedAmount:16000})).status,'accepted');
 assert.ok((await notes(buyer.userId)).some(n=>n.kind==='offer_reply'&&/Counter-offer/.test(n.title)),'buyer told about the counter');
 assert.ok((await notes(seller.userId)).some(n=>n.kind==='offer_reply'&&/accepted/.test(n.title)),'seller told about the acceptance');
 const sent=(await listOffersAndTrades(buyer)).sent.find(r=>r.id===offerId)!;assert.equal(sent.status,'accepted');assert.equal(sent.actions.pay,true);assert.ok(sent.deadline,'48h payment window recorded');
 await rejects(offerCheckout(outsider,offerId),404);
 const started=await offerCheckout(buyer,offerId),orderId=started.order.id,row=await orderRow(orderId),snapshot=JSON.parse(row.snapshot);
 assert.equal(snapshot.itemAmountCents,16000,'charged the accepted counter, not the list price');assert.equal(snapshot.totalCents,16900);assert.equal(snapshot.offer.id,offerId);
 assert.equal((await listingRow(listing.id)).status,'checkout_reserved');
 assert.equal((await commerceDeliveryInfo(getDb(),seller.userId,orderId,testEnv)).hiddenReason,'awaiting_payment');
 await deliver('checkout.session.completed',pay(row.checkoutSessionId!));
 const info=await commerceDeliveryInfo(getDb(),seller.userId,orderId,testEnv);
 assert.equal(info.shipTo?.kind,'buyer');assert.equal((info.shipTo as {line1:string}).line1,address.line1);assert.ok(info.shipBy,'ship-by date');assert.equal(info.method.shippingCents,900);
 assert.equal((await commerceDeliveryInfo(getDb(),buyer.userId,orderId,testEnv)).shipTo,null);
 await rejects(commerceDeliveryInfo(getDb(),outsider.userId,orderId,testEnv),404);
 assert.ok((await notes(seller.userId)).some(n=>n.kind==='order'&&/Sold and paid/.test(n.title)),'seller told it is paid');
 assert.ok((await notes(buyer.userId)).some(n=>n.kind==='order'&&/Payment confirmed/.test(n.title)),'buyer told it is paid');
 assert.equal((await listOffersAndTrades(buyer)).sent.find(r=>r.id===offerId)!.status,'ordered');
 const state=JSON.parse((await orderRow(orderId)).state),stamp=new Date().toISOString();state.shipment={...state.shipment,carrier:'USPS',trackingNumber:'9400100000000000000000',submittedAt:stamp,validatedAt:stamp,acceptedAt:stamp,deliveredAt:stamp};
 await getDb().update(commerceOrders).set({state:JSON.stringify(state)}).where(eq(commerceOrders.id,orderId));
 assert.equal((await commerceDeliveryInfo(getDb(),seller.userId,orderId,testEnv)).hiddenReason,'delivered');
 assert.equal(((await commerceOverview(getDb(),seller.userId,testEnv,orderId)).order as Obj).shippingAddress,undefined,'seller loses the address after delivery');
 assert.ok(((await commerceOverview(getDb(),buyer.userId,testEnv,orderId)).order as Obj).shippingAddress,'buyer keeps their own address');
});

test('offers: 48-hour expiry is enforced on replies and on the payment window',async()=>{
 const seller=await collector('exseller'),buyer=await collector('exbuyer');await onboard(seller);
 const listing=await offer(seller,{price:9000}),offerId=await makeOffer(buyer,listing.id,7000);
 await getDb().update(offers).set({createdAt:ago(49*hour)}).where(eq(offers.id,offerId));
 assert.equal(await offerExpired(offerId,'pending',ago(49*hour)),true);
 await rejects(respondToOffer(getDb(),seller,{action:'respond',offerId,decision:'accept',expectedStatus:'pending',expectedAmount:7000}),409,/expired/);
 assert.equal((await listOffersAndTrades(seller)).received.find(r=>r.id===offerId)!.status,'expired');
 const fresh=await makeOffer(buyer,listing.id,8000);
 await respondToOffer(getDb(),seller,{action:'respond',offerId:fresh,decision:'accept',expectedStatus:'pending',expectedAmount:8000});
 await getPool().query("UPDATE ch_web.offer_terms SET expires_at=now()-interval '1 minute' WHERE offer_id=$1",[fresh]);
 await rejects(offerCheckout(buyer,fresh),409,/payment window/);
});

test('SafePurchase delivery details point the seller at ComicHuddle, with a marked placeholder when the address is unset',async()=>{
 const seller=await collector('spdseller'),buyer=await collector('spdbuyer');await onboard(seller);
 const listing=await offer(seller,{price:60000}),orderId=await paid(buyer,listing.id,spEnv);
 const configured=await commerceDeliveryInfo(getDb(),seller.userId,orderId,spEnv);
 assert.equal(configured.shipTo?.kind,'inspection');assert.equal((configured.shipTo as {placeholder:boolean}).placeholder,false);
 assert.deepEqual((await commerceDeliveryInfo(getDb(),seller.userId,orderId,testEnv)).shipTo,{kind:'inspection',address:null,placeholder:true});
 assert.equal(((await commerceOverview(getDb(),seller.userId,spEnv,orderId)).order as Obj).shippingAddress,undefined,'SafePurchase seller never gets the buyer address');
});

test('pickup code: refused after 7 days, and the owner sweep refunds the unused code',async()=>{
 const seller=await collector('pxseller'),buyer=await collector('pxbuyer');await onboard(seller);
 const listing=await offer(seller,{price:3000,fulfillment:'pickup'}),orderId=await paid(buyer,listing.id,testEnv,{fulfillment:'pickup'});
 await commercePickupCodeOpen(getDb(),seller.userId,orderId,testEnv);
 assert.ok((await commerceDeliveryInfo(getDb(),buyer.userId,orderId,testEnv)).pickupCodeExpiresAt);
 await backdate(orderId,8*24*hour);
 await rejects(commercePickupCodeOpen(getDb(),seller.userId,orderId,testEnv),409,/expired/);
 await rejects(commercePickupExpirySweep(getDb(),seller.userId,{action:'pickup_expiry_sweep',sandboxAcknowledged:true},testEnv),403);
 const swept=await commercePickupExpirySweep(getDb(),ownerAccountId,{action:'pickup_expiry_sweep',sandboxAcknowledged:true},testEnv);
 const result=swept.results.find(r=>r.orderId===orderId);assert.ok(result,'order swept');assert.equal(result.result,'refunded');
 assert.equal((await orderRow(orderId)).status,'refunded');
 assert.ok((await notes(buyer.userId)).some(n=>/Pickup code expired/.test(n.title)));
});
