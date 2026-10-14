import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {Pool} from 'pg';
import {getDb} from '../db';
import {nativeGcdFixture} from './native-gcd-fixture';
import {catalogIssue,catalogOverview,searchSharedCatalog,seedStarterStatements} from '../lib/catalog-store';
import {rollingMedian,importSoldComps,type SoldComp} from '../lib/sold-comps';
import {collectorRewards,convertPoints} from '../lib/collector-rewards';
import {profiles,commerceOrders,commerceEvents,commerceMoneyRequests} from '../db/schema';
import {previewRulesVersion} from '../lib/community';
let engine:PGlite;const pool=new Pool();
before(async()=>{
 engine=new PGlite();await nativeGcdFixture(engine);await engine.exec('CREATE SCHEMA ch_web');
 for(const file of ['001_original_comichuddle.sql','002_runtime.sql','004_catalog_cover_references.sql','006_marketplace_wallet_safepurchase.sql','007_us_postal_centroids.sql','008_safepurchase_retention.sql','009_wallet_history_mode.sql','010_native_gcd_directory.sql','011_collector_rewards.sql','012_sourced_fmv.sql'])await engine.exec(readFileSync('db/postgres-migrations/'+file,'utf8'));
 await engine.exec('SET search_path TO ch_web,gcd,public;');
 const query=async(config:string|{text:string;rowMode?:string},values:unknown[]=[])=>{const result=await engine.query<Record<string,unknown>>(typeof config==='string'?config:config.text,values);return {...result,rowCount:result.affectedRows,command:'',rows:typeof config!=='string'&&config.rowMode==='array'?result.rows.map(row=>result.fields.map(field=>row[field.name])):result.rows}};
 Object.assign(pool,{query,connect:async()=>({query,release(){}})});(globalThis as typeof globalThis&{comicHuddlePool:Pool}).comicHuddlePool=pool;await getDb().batch(seedStarterStatements(getDb(),new Date().toISOString()));
 await engine.exec(`INSERT INTO gcd.gcd_publisher VALUES(78,'QA Publisher',0);INSERT INTO gcd.gcd_series VALUES(17,'Exact Native Comic',78,0);INSERT INTO gcd.gcd_issue(id,series_id,number,publication_date,key_date,price,title,variant_name,modified,deleted) VALUES(123,17,'7','May 2020','2020-05-00','$3.99','Native issue title','Retailer variant','2026-10-14T00:00:00Z',0),(124,17,'8','June 2020','2020-06-00','$3.99','','','2026-10-14T00:00:00Z',0),(125,17,'9','','','',NULL,NULL,'2026-10-14T00:00:00Z',1)`);
});
after(async()=>{await engine.close();delete(globalThis as typeof globalThis&{comicHuddlePool?:Pool}).comicHuddlePool});
test('native snapshot is queried directly, preserves canonical IDs and excludes deleted records',async()=>{
 const meta=await catalogOverview(getDb());assert.equal(meta.gcdIssueCount,2);assert.equal(meta.catalogSchema,'gcd');assert.equal(meta.issueCount,45);
 const page=await searchSharedCatalog(getDb(),{q:'Exact Native #7',limit:12,offset:0});assert.equal(page.total,1);assert.equal(page.issues[0].id,4000000123);assert.equal(page.issues[0].publisher,'QA Publisher');assert.equal(page.issues[0].cover,undefined);
 const detail=await catalogIssue(getDb(),4000000123);assert.equal(detail?.bibliography?.originalCoverPrice.text,'$3.99');assert.equal(detail?.variant,'Retailer variant');assert.equal((await engine.query('SELECT id FROM ch_web.catalog_issues WHERE gcd_id=123')).rows.length,0);
});
const comp=(price:number,extra:Partial<SoldComp>={}):SoldComp=>({issueId:4000000123,source:'authorized_ebay',sourceReference:'sale-'+price,sourceUrl:'https://www.ebay.com/itm/123456789',mode:'Raw',grade:'Unspecified',label:'Raw',printing:'First printing',soldAt:new Date().toISOString(),priceCents:price,currency:'USD',bestOfferAccepted:false,actualPriceConfirmed:true,...extra});
test('rolling median excludes duplicates, stale/unknown best-offer prices and outliers',()=>{
 const values=[1000,1100,1200,1300,1400,90000].map(price=>comp(price));values.push(comp(1000),comp(3000,{actualPriceConfirmed:false,bestOfferAccepted:true}),comp(2000,{soldAt:'2020-01-01T00:00:00.000Z'}));
 assert.deepEqual(rollingMedian(values),{fmvCents:1200,lowCents:1000,highCents:1400,sampleSize:5,windowDays:90,method:'ROLLING_MEDIAN_IQR'});assert.equal(rollingMedian(values.slice(0,2)),null);
});
test('sourced FMV uses an actual native issue identity; imports dedupe and enforce redistribution rights',async()=>{
 const sales=[1000,1100,1200,1300,1400].map(price=>comp(price)),expires=new Date(Date.now()+86400000).toISOString();const result=await importSoldComps(getDb(),sales,'QA synthetic redistribution permission',expires);assert.equal(result.updated,1);await importSoldComps(getDb(),sales,'QA synthetic redistribution permission',expires);
 const rows=(await engine.query('SELECT * FROM gcd.fmv_records WHERE issue_id=4000000123')).rows;assert.equal(rows.length,1);assert.equal(Number(rows[0].fmv_price),12);assert.equal(rows[0].sample_size,5);assert.equal((await engine.query('SELECT COUNT(*) AS n FROM gcd.sales_comps')).rows[0].n,5);
 await assert.rejects(importSoldComps(getDb(),sales,'none','2020-01-01T00:00:00Z'));await assert.rejects(importSoldComps(getDb(),[comp(1500,{issueId:4000999999})],'QA synthetic permission',expires));
});
async function profile(name:string){const id=crypto.randomUUID(),stamp=new Date().toISOString();return(await getDb().insert(profiles).values({id,userId:crypto.randomUUID(),handle:name+'_'+id.slice(0,8),name,bio:'',tagline:'',location:'Minneapolis, MN',favorite:'',since:2026,color:'red',featured:'[]',visible:1,dmOpen:1,createdAt:stamp,rulesVersion:previewRulesVersion,rulesAcceptedAt:stamp}).returning())[0]}
async function order(user:string,points=200,credit=0){const id=crypto.randomUUID(),stamp=new Date().toISOString();await getDb().insert(commerceOrders).values({id,buyerId:user,buyerUserId:user,sellerId:'seller',sellerUserId:'seller',listingId:'synthetic-'+id,requestId:crypto.randomUUID(),status:'awaiting_payment',version:0,sandbox:1,snapshot:JSON.stringify({itemAmountCents:points*100+credit,totalCents:points*100,storeCreditCents:credit}),state:'{}',createdAt:stamp,updatedAt:stamp});return id}
async function pay(id:string){await engine.query("UPDATE ch_web.commerce_orders SET payment_intent_id=$2,charge_id=$3,status='awaiting_shipment' WHERE id=$1",[id,'pi_'+id,'ch_'+id]);await getDb().insert(commerceEvents).values({id:crypto.randomUUID(),orderId:id,providerEventId:'evt_'+id,type:'payment_confirmed',body:'{}',createdAt:new Date().toISOString()});await pool.query('SELECT ch_web.reconcile_order_rewards($1)',[id])}
test('unverified orders earn no rewards; confirmed purchase rewards dedupe and remain sandbox-only',async()=>{
 const user=await profile('rewards');const id=await order(user.userId);await pool.query('SELECT ch_web.reconcile_order_rewards($1)',[id]);let rewards=await collectorRewards(pool,user.userId);assert.equal(rewards.balances.sandbox.points,0);await pay(id);await pool.query('SELECT ch_web.reconcile_order_rewards($1)',[id]);rewards=await collectorRewards(pool,user.userId,'sandbox');assert.equal(rewards.balances.sandbox.points,200);assert.equal(rewards.balances.live.points,0);assert.equal(rewards.history.length,1);assert.equal(rewards.cashOutEnabled,false);
});
test('point conversion is atomic, request-bound, closed-loop and isolated between users',async()=>{
 const user=await profile('convert'),other=await profile('other'),id=await order(user.userId);await pay(id);const request=crypto.randomUUID();await convertPoints(pool,user.userId,'sandbox',request,100);await convertPoints(pool,user.userId,'sandbox',request,100);const result=await collectorRewards(pool,user.userId);assert.equal(result.balances.sandbox.points,100);assert.equal(result.balances.sandbox.availableCreditCents,100);
 await assert.rejects(convertPoints(pool,user.userId,'sandbox',request,200));await assert.rejects(convertPoints(pool,user.userId,'live',crypto.randomUUID(),100));await assert.rejects(convertPoints(pool,other.userId,'sandbox',crypto.randomUUID(),100));await assert.rejects(convertPoints(pool,user.userId,'sandbox',crypto.randomUUID(),99));
});
test('reserved credit cannot be spent twice, verified payment consumes it once, full refund restores it once',async()=>{
 const user=await profile('reserve'),first=await order(user.userId);await pay(first);await convertPoints(pool,user.userId,'sandbox',crypto.randomUUID(),200);const second=await order(user.userId,10,150),third=await order(user.userId,10,100);
 await pool.query('SELECT ch_web.reserve_store_credit($1,$2,$3,$4)',[second,user.userId,'sandbox',150]);await pool.query('SELECT ch_web.reserve_store_credit($1,$2,$3,$4)',[second,user.userId,'sandbox',150]);await assert.rejects(pool.query('SELECT ch_web.reserve_store_credit($1,$2,$3,$4)',[third,user.userId,'sandbox',100]));assert.equal((await collectorRewards(pool,user.userId)).balances.sandbox.availableCreditCents,50);
 await pay(second);await pool.query('SELECT ch_web.reconcile_order_rewards($1)',[second]);let wallet=await collectorRewards(pool,user.userId);assert.equal(wallet.balances.sandbox.availableCreditCents,50);assert.equal(wallet.balances.sandbox.reservedCreditCents,0);assert.equal(wallet.balances.sandbox.points,10);
 await getDb().insert(commerceMoneyRequests).values({id:crypto.randomUUID(),orderId:second,kind:'refund',status:'succeeded',amountCents:1000,providerId:'re_'+second,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});await pool.query('SELECT ch_web.reconcile_order_rewards($1)',[second]);await pool.query('SELECT ch_web.reconcile_order_rewards($1)',[second]);wallet=await collectorRewards(pool,user.userId);assert.equal(wallet.balances.sandbox.availableCreditCents,200);assert.equal(wallet.balances.sandbox.points,0);
});
test('expired unpaid orders release their credit reservation without points or spend entries',async()=>{
 const user=await profile('expire'),first=await order(user.userId);await pay(first);await convertPoints(pool,user.userId,'sandbox',crypto.randomUUID(),100);const second=await order(user.userId,10,100);await pool.query('SELECT ch_web.reserve_store_credit($1,$2,$3,100)',[second,user.userId,'sandbox']);await engine.query("UPDATE ch_web.commerce_orders SET status='checkout_expired' WHERE id=$1",[second]);await pool.query('SELECT ch_web.reconcile_order_rewards($1)',[second]);const result=await collectorRewards(pool,user.userId);assert.equal(result.balances.sandbox.availableCreditCents,100);assert.equal(result.balances.sandbox.points,100);
});
