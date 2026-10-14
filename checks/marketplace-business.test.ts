import {nativeGcdFixture} from './native-gcd-fixture';
import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {Pool} from 'pg';
import {eq,sql} from 'drizzle-orm';
import {getDb} from '../db';
import {profiles,collections,media,listings,listingInventory,careProviders,commerceOrders,commerceEvents,commerceMoneyRequests,blocks,messages} from '../db/schema';
import {seedStarterStatements} from '../lib/catalog-store';
import {emptyVault} from '../lib/vault';
import {previewRulesVersion} from '../lib/community';
import {createListing,checkMarketplaceDeletion,anonymizeMarketplaceHistory} from '../lib/marketplace';
import {markListingSold,requestSafePurchase} from '../lib/marketplace-sales';
import {marketplaceDirectory} from '../lib/marketplace-directory';
import {workshopDirectoryRows,studioVisibleFields} from '../lib/workshop-directory';
import {locationFilters,resolveLocation} from '../lib/location-search';
import {collectorWallet} from '../lib/collector-wallet';
import {createCommerceState,applyCommerceEvent,type CommerceState} from '../lib/commerce-policy';

let engine:PGlite;const pool=new Pool();
before(async()=>{
 engine=new PGlite();await nativeGcdFixture(engine);await engine.exec('CREATE SCHEMA ch_web;BEGIN;');
 for(const name of ['001_original_comichuddle.sql','002_runtime.sql','004_catalog_cover_references.sql','006_marketplace_wallet_safepurchase.sql','007_us_postal_centroids.sql','008_safepurchase_retention.sql','009_wallet_history_mode.sql','010_native_gcd_directory.sql','011_collector_rewards.sql'])await engine.exec(readFileSync('db/postgres-migrations/'+name,'utf8'));
 await engine.exec('COMMIT;SET search_path TO ch_web,public;');
 const query=async(config:string|{text:string;rowMode?:string},values:unknown[]=[])=>{
  const result=await engine.query<Record<string,unknown>>(typeof config==='string'?config:config.text,values);
  return {...result,rowCount:result.affectedRows,command:'',rows:typeof config!=='string'&&config.rowMode==='array'?result.rows.map(row=>result.fields.map(field=>row[field.name])):result.rows};
 };
 Object.assign(pool,{query,connect:async()=>({query,release(){}})});
 (globalThis as typeof globalThis&{comicHuddlePool:Pool}).comicHuddlePool=pool;
 await getDb().batch(seedStarterStatements(getDb(),new Date().toISOString()));
 const source=JSON.parse(readFileSync('db/us-postal-centroids.json','utf8'));
 assert.equal(source.records.length,40977);assert.equal(new Set(source.records.map((r:{zip:string})=>r.zip)).size,40977);
 assert.equal(source.license,'https://creativecommons.org/licenses/by/4.0/');
 const rows=source.records.filter((r:{zip:string})=>['55421','55401','90001','10001'].includes(r.zip));
 await pool.query(`INSERT INTO ch_web.us_postal_centroids(zip,city,state,latitude,longitude,accuracy,source_url,source_sha256,fetched_at)
  SELECT zip,city,state,latitude,longitude,accuracy,$2,$3,$4 FROM jsonb_to_recordset($1::jsonb) AS x(zip text,city text,state text,latitude double precision,longitude double precision,accuracy bigint)`,[JSON.stringify(rows),source.source,source.archiveSha256,source.fetchedAt]);
});
after(async()=>{await engine.close();delete (globalThis as typeof globalThis&{comicHuddlePool?:Pool}).comicHuddlePool});

async function collector(prefix:string){
 const db=getDb(),stamp=new Date().toISOString(),uuid=crypto.randomUUID();
 return (await db.insert(profiles).values({id:uuid,userId:crypto.randomUUID(),handle:prefix+'_'+uuid.slice(0,8),name:prefix,bio:'QA isolated fixture',tagline:'',location:'Minneapolis, MN',favorite:'',since:2026,color:'red',featured:'[]',visible:1,dmOpen:1,createdAt:stamp,rulesVersion:previewRulesVersion,rulesAcceptedAt:stamp}).returning())[0];
}
type Profile=Awaited<ReturnType<typeof collector>>;
async function offer(seller:Profile,options:Record<string,unknown>={}){
 const db=getDb(),photo=crypto.randomUUID(),bookId=crypto.randomUUID(),other=crypto.randomUUID();
 await db.insert(media).values({id:photo,userId:seller.userId,contentType:'image/jpeg',createdAt:new Date().toISOString()});
 const old=(await db.select().from(collections).where(eq(collections.userId,seller.userId)))[0];
 const vault=old?JSON.parse(old.data):emptyVault(seller.name);
 const books=[bookId,...(options.kind==='collection'?[other]:[])];
 books.forEach(id=>vault.books.push({id,title:'Amazing Spider-Man',issue:'#300',grade:'Raw 9.0',price:200,catalogId:0}));
 await db.insert(collections).values({userId:seller.userId,data:JSON.stringify(vault),revision:crypto.randomUUID()}).onConflictDoUpdate({target:collections.userId,set:{data:JSON.stringify(vault),revision:crypto.randomUUID()}});
 const result=await createListing(db,seller,{action:'listing',kind:'single',saleType:'fixed',bookIds:books,description:'Isolated QA owned-copy fixture.',price:60000,shipping:1500,photos:[photo],attest:true,usaAttest:true,...options});
 return (await db.select().from(listings).where(eq(listings.id,result.listingId)))[0];
}
const filter=(extra:Record<string,unknown>={})=>({location:'',radius:'nationwide' as const,view:'active',q:'',category:'all',issueId:null,offset:0,...extra});

test('SafePurchase is optional at every price and works for complete collection listings',async()=>{
 const seller=await collector('optional');
 const high=await offer(seller);assert.equal(high.safePurchaseOptIn,0);assert.equal(high.safePurchaseVerifiedAt,null);
 const low=await offer(seller,{price:15000,safePurchaseOptIn:true,locationZip:'55421'});assert.equal(low.safePurchaseOptIn,1);assert.equal(low.safePurchaseVerifiedAt,null);assert.equal(low.locationState,'MN');
 const lot=await offer(seller,{kind:'collection',title:'QA whole longbox',safePurchaseOptIn:true,locationZip:'55421'});assert.equal(lot.itemCount,2);assert.equal(lot.safePurchaseOptIn,1);
 await assert.rejects(offer(seller,{safePurchaseVerifiedAt:new Date().toISOString()}));
});
test('real ZIP origins produce PostgreSQL distance filters and prioritize local pickups',async()=>{
 const seller=await collector('nearby'),buyer=await collector('localbuyer');
 const pickup=await offer(seller,{locationZip:'55421',fulfillment:'pickup',pickupCity:'Minneapolis',pickupState:'MN',shipping:0});
 const ship=await offer(seller,{locationZip:'55421'}),far=await offer(seller,{locationZip:'90001'}),unknown=await offer(seller);
 const origin=await resolveLocation(getDb(),'55421');assert.equal(origin?.state,'MN');
 const near=await marketplaceDirectory(getDb(),buyer,filter({location:'55421',radius:'5'}));
 const ids=near.listings.map(row=>row.id);assert.ok(ids.includes(pickup.id),JSON.stringify({pickup:pickup.id,coords:[pickup.latitude,pickup.longitude],origin,near}));assert.ok(ids.includes(ship.id));assert.ok(!ids.includes(far.id));assert.ok(!ids.includes(unknown.id));assert.ok(ids.indexOf(pickup.id)<ids.indexOf(ship.id));
 assert.equal(near.listings.find(row=>row.id===pickup.id)?.distanceMiles,0);
 const exact=await marketplaceDirectory(getDb(),buyer,{...filter({}),listingId:ship.id});assert.deepEqual(exact.listings.map(row=>row.id),[ship.id]);
 const nation=await marketplaceDirectory(getDb(),buyer,filter({location:'55421'}));assert.ok(nation.listings.some(row=>row.id===far.id&&row.distanceMiles!>1000));assert.ok(nation.listings.some(row=>row.id===unknown.id&&row.distanceMiles===null));
 assert.ok(!Object.hasOwn(near.listings[0],'latitude'));assert.ok(!Object.hasOwn(near.listings[0],'locationZip'));
 assert.throws(()=>locationFilters(new URL('https://test/api?radius=15')));assert.throws(()=>locationFilters(new URL('https://test/api?location=55421&radius=100')));
 await assert.rejects(resolveLocation(getDb(),'00000'));
});
test('seller-only cash sale is atomic, idempotent and immediately appears only in their Sold Items',async()=>{
 const seller=await collector('soldowner'),other=await collector('notowner'),listing=await offer(seller,{locationZip:'55421'});
 await assert.rejects(markListingSold(getDb(),other,{listingId:listing.id,soldVia:'cash_local'}),e=>(e as {status:number}).status===404);
 const saved=await markListingSold(getDb(),seller,{listingId:listing.id,soldVia:'cash_local'});assert.equal(saved.paymentVerified,false);
 const again=await markListingSold(getDb(),seller,{listingId:listing.id,soldVia:'cash_local'});assert.equal(again.duplicate,true);
 assert.equal((await getDb().select().from(listingInventory).where(eq(listingInventory.listingId,listing.id))).length,0);
 const active=await marketplaceDirectory(getDb(),other,filter());assert.ok(!active.listings.some(row=>row.id===listing.id));
 const sold=await marketplaceDirectory(getDb(),seller,filter({view:'sold'}));assert.ok(sold.listings.some(row=>row.id===listing.id));
 const privateSold=await marketplaceDirectory(getDb(),other,filter({view:'sold'}));assert.ok(!privateSold.listings.some(row=>row.id===listing.id));
 const sales=await pool.query('SELECT * FROM ch_web.marketplace_sales WHERE listing_id=$1',[listing.id]);assert.equal(sales.rows.length,1);assert.equal(sales.rows[0].payment_verified,0);
 const wallet=await collectorWallet(pool,seller.userId);assert.equal(wallet.live.availableCents,'0');assert.equal(wallet.sandbox.availableCents,'0');assert.equal(wallet.history.length,0);
});
test('manually reported platform sale cannot mint funds or completed-sales FMV comps',async()=>{
 const seller=await collector('manualplatform'),listing=await offer(seller);
 await markListingSold(getDb(),seller,{listingId:listing.id,soldVia:'platform'});
 const [sale]=(await pool.query('SELECT payment_verified,order_id FROM ch_web.marketplace_sales WHERE listing_id=$1',[listing.id])).rows;
 assert.equal(sale.payment_verified,0);assert.equal(sale.order_id,null);assert.equal((await collectorWallet(pool,seller.userId)).history.length,0);
});
test('an open order prevents manual sold changes without disturbing inventory',async()=>{
 const seller=await collector('reserved'),buyer=await collector('reservedbuyer'),listing=await offer(seller);
 const stamp=new Date().toISOString();
 await getDb().insert(commerceOrders).values({id:crypto.randomUUID(),buyerId:buyer.id,buyerUserId:buyer.userId,sellerId:seller.id,sellerUserId:seller.userId,listingId:listing.id,requestId:crypto.randomUUID(),status:'awaiting_payment',version:0,sandbox:1,snapshot:'{}',state:'{}',createdAt:stamp,updatedAt:stamp});
 await assert.rejects(markListingSold(getDb(),seller,{listingId:listing.id,soldVia:'cash_local'}),e=>(e as {status:number}).status===409);
 assert.equal((await getDb().select().from(listings).where(eq(listings.id,listing.id)))[0].status,'active');
 assert.equal((await getDb().select().from(listingInventory).where(eq(listingInventory.listingId,listing.id))).length,1);
});
test('SafePurchase requests persist one private conversation, deduplicate and honor blocks',async()=>{
 const seller=await collector('protected'),buyer=await collector('requester'),listing=await offer(seller,{safePurchaseOptIn:true});
 const first=await requestSafePurchase(getDb(),buyer,{listingId:listing.id}),second=await requestSafePurchase(getDb(),buyer,{listingId:listing.id});assert.equal(first.threadId,second.threadId);
 assert.equal((await getDb().select().from(messages).where(eq(messages.threadId,first.threadId!))).length,1);
 assert.equal((await pool.query('SELECT count(*) AS n FROM ch_web.safe_purchase_requests WHERE listing_id=$1',[listing.id])).rows[0].n,1);
 const blockedBuyer=await collector('blockedrequest');await getDb().insert(blocks).values({fromId:seller.id,toId:blockedBuyer.id});
 await assert.rejects(requestSafePurchase(getDb(),blockedBuyer,{listingId:listing.id}),e=>(e as {status:number}).status===403);
 await assert.rejects(requestSafePurchase(getDb(),seller,{listingId:listing.id}));
 const ordinary=await offer(seller);await assert.rejects(requestSafePurchase(getDb(),buyer,{listingId:ordinary.id}),e=>(e as {status:number}).status===409);
});
async function paidOrder(seller:Profile,buyer:Profile){
 const listing=await offer(seller),id=crypto.randomUUID(),stamp='2026-10-10T00:00:00.000Z';
 let state=createCommerceState({orderId:id,buyerId:buyer.id,sellerId:seller.id,sellerAccountId:'acct_qa',currency:'USD',totalCents:61500,sellerTransferCents:61500,createdAt:stamp,paymentIntentId:null,chargeId:null,paidAt:null});
 const result=applyCommerceEvent(state,{type:'payment_confirmed',eventId:'evt_'+id,orderId:id,buyerId:buyer.id,sellerId:seller.id,occurredAt:stamp,source:'stripe',verified:true,paymentIntentId:'pi_'+id,chargeId:'ch_'+id,currency:'USD',amountCents:61500},stamp);assert.equal(result.accepted,true);state=result.state;
 await getDb().insert(commerceOrders).values({id,buyerId:buyer.id,buyerUserId:buyer.userId,sellerId:seller.id,sellerUserId:seller.userId,listingId:listing.id,requestId:crypto.randomUUID(),status:state.status,version:0,sandbox:1,snapshot:JSON.stringify({currency:'USD',totalCents:61500,sellerTransferCents:61500}),state:JSON.stringify(state),paymentIntentId:state.order.paymentIntentId,chargeId:state.order.chargeId,createdAt:stamp,updatedAt:stamp});
 return {id,state,stamp};
}
async function confirmation(order:Awaited<ReturnType<typeof paidOrder>>,kind:'transfer'|'refund',receiptAmount=61500){
 const state:CommerceState={...order.state,status:kind==='transfer'?'transferred':'refunded',financial:{kind,requestId:'req_'+order.id,amountCents:61500,destinationAccountId:kind==='transfer'?'acct_qa':null,requestedAt:'2026-10-13T00:00:00.000Z',confirmedAt:'2026-10-13T00:01:00.000Z',processorId:(kind==='transfer'?'tr_':'re_')+order.id}};
 await getDb().insert(commerceMoneyRequests).values({id:state.financial!.requestId,orderId:order.id,kind,status:'succeeded',amountCents:receiptAmount,providerId:state.financial!.processorId,createdAt:order.stamp,updatedAt:order.stamp});
 await getDb().update(commerceOrders).set({state:JSON.stringify(state),status:state.status,version:1,transferId:kind==='transfer'?state.financial!.processorId:null}).where(eq(commerceOrders.id,order.id));
}
test('wallet ignores unverified payments and isolates every account and sandbox balance',async()=>{
 const seller=await collector('walletseller'),buyer=await collector('walletbuyer'),other=await collector('walletother'),order=await paidOrder(seller,buyer);
 let wallet=await collectorWallet(pool,seller.userId);assert.equal(wallet.sandbox.pendingCents,'0');
 await getDb().insert(commerceEvents).values({id:crypto.randomUUID(),orderId:order.id,providerEventId:'evt_'+order.id,type:'payment_confirmed',body:'{}',createdAt:order.stamp});
 wallet=await collectorWallet(pool,seller.userId);assert.equal(wallet.sandbox.pendingCents,'61500');assert.equal(wallet.live.pendingCents,'0');assert.equal(wallet.sandbox.availableCents,'0');
 assert.equal((await collectorWallet(pool,other.userId)).history.length,0);
 await confirmation(order,'transfer');wallet=await collectorWallet(pool,seller.userId);assert.equal(wallet.sandbox.pendingCents,'0');assert.equal(wallet.sandbox.availableCents,'61500');assert.equal(wallet.live.availableCents,'0');assert.equal(wallet.withdrawalEnabled,false);
 const again=await collectorWallet(pool,seller.userId);assert.equal(again.sandbox.availableCents,'61500');assert.equal(again.history.length,3);const liveOnly=await collectorWallet(pool,seller.userId,0,'live');assert.equal(liveOnly.history.length,0);const testOnly=await collectorWallet(pool,seller.userId,0,'sandbox');assert.equal(testOnly.history.length,3);assert.ok(testOnly.history.every(entry=>entry.mode==='sandbox'));
 const purchaser=await collectorWallet(pool,buyer.userId);assert.equal(purchaser.history.length,1);assert.equal(purchaser.history[0].amount_cents,'-61500');assert.equal(purchaser.sandbox.availableCents,'0');
});
test('confirmed refund clears pending proceeds while mismatched transfer amounts stay held',async()=>{
 const seller=await collector('refundseller'),buyer=await collector('refundbuyer'),order=await paidOrder(seller,buyer);
 await getDb().insert(commerceEvents).values({id:crypto.randomUUID(),orderId:order.id,providerEventId:'evt_'+order.id,type:'payment_confirmed',body:'{}',createdAt:order.stamp});
 await collectorWallet(pool,seller.userId);await confirmation(order,'refund');
 const sellerWallet=await collectorWallet(pool,seller.userId);assert.equal(sellerWallet.sandbox.pendingCents,'0');assert.equal(sellerWallet.sandbox.availableCents,'0');
 const buyerWallet=await collectorWallet(pool,buyer.userId);assert.equal(buyerWallet.history.reduce((sum,e)=>sum+Number(e.amount_cents),0),0);
 const wrong=await paidOrder(seller,buyer);await getDb().insert(commerceEvents).values({id:crypto.randomUUID(),orderId:wrong.id,providerEventId:'evt_'+wrong.id,type:'payment_confirmed',body:'{}',createdAt:wrong.stamp});await confirmation(wrong,'transfer',100);
 const held=await collectorWallet(pool,seller.userId);assert.equal(held.sandbox.availableCents,'0');assert.equal(held.sandbox.pendingCents,'61500');assert.equal(held.unreconciledOrders,1);
});
test('specialist distance search, visibility and public DTOs protect private intake addresses',async()=>{
 const local=await collector('localstudio'),remote=await collector('remotestudio'),viewer=await collector('studioviewer');
 async function studio(p:Profile,zip:string){const origin=await resolveLocation(getDb(),zip);return (await getDb().insert(careProviders).values({id:crypto.randomUUID(),profileId:p.id,name:p.name,bio:'QA specialist',location:origin!.city+', '+origin!.state,services:'["pressing","dry_cleaning"]',prices:'{}',specialties:'Modern comics',experienceSince:2020,turnaroundMin:7,turnaroundMax:14,mailIn:1,dropoff:1,accepting:1,visible:1,submissionMode:'none',dealerReference:'',website:'',logoId:null,portfolio:'[]',shippingAddress:'PRIVATE TEST INTAKE ADDRESS',shippingNotes:'PRIVATE TEST NOTES',terms:'QA test service terms',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),locationZip:zip,locationCity:origin!.city,locationState:origin!.state,latitude:origin!.latitude,longitude:origin!.longitude}).returning())[0]}
 const near=await studio(local,'55421'),far=await studio(remote,'90001');
 const result=await workshopDirectoryRows(getDb(),viewer.id,{location:'55421',radius:'15'});assert.deepEqual(result.rows.map(r=>r.provider.id),[near.id]);
 const fields=studioVisibleFields(near);for(const key of ['shippingAddress','shippingNotes','locationZip','latitude','longitude'])assert.ok(!Object.hasOwn(fields,key));assert.equal(studioVisibleFields(near,true).shippingAddress,'PRIVATE TEST INTAKE ADDRESS');
 await getDb().insert(blocks).values({fromId:viewer.id,toId:local.id});assert.equal((await workshopDirectoryRows(getDb(),viewer.id,{location:'55421',radius:'50'})).rows.length,0);
 assert.equal((await workshopDirectoryRows(getDb(),viewer.id,{location:'55421',radius:'nationwide'},far.id)).rows[0].provider.id,far.id);
});


test('account cleanup removes pending requests and manual-sale records while active custody requires review',async()=>{
 const seller=await collector('cleanup'),buyer=await collector('cleanupbuyer'),listing=await offer(seller,{safePurchaseOptIn:true,locationZip:'55421'});
 await requestSafePurchase(getDb(),buyer,{listingId:listing.id});
 await pool.query("UPDATE ch_web.safe_purchase_requests SET status='received_at_vault' WHERE listing_id=$1",[listing.id]);
 await assert.rejects(checkMarketplaceDeletion(getDb(),seller),e=>(e as {status:number}).status===409);
 await assert.rejects(markListingSold(getDb(),seller,{listingId:listing.id,soldVia:'cash_local'}),e=>(e as {status:number}).status===409);
 await pool.query("UPDATE ch_web.safe_purchase_requests SET status='requested' WHERE listing_id=$1",[listing.id]);
 await markListingSold(getDb(),seller,{listingId:listing.id,soldVia:'cash_local'});await checkMarketplaceDeletion(getDb(),seller);
 const clean=anonymizeMarketplaceHistory(getDb(),seller);await getDb().batch([...clean.checks,...clean.before,getDb().delete(listings).where(eq(listings.sellerId,seller.id)),...clean.after]);
 assert.equal((await pool.query('SELECT count(*) AS n FROM ch_web.safe_purchase_requests WHERE listing_id=$1',[listing.id])).rows[0].n,0);
 assert.equal((await pool.query('SELECT count(*) AS n FROM ch_web.marketplace_sales WHERE listing_id=$1',[listing.id])).rows[0].n,0);
});
