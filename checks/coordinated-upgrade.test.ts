import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {Pool} from 'pg';
import sharp from 'sharp';
import {sql} from 'drizzle-orm';
import {nativeGcdFixture} from './native-gcd-fixture';
import {getDb} from '../db';
import {catalogIssue,searchSharedCatalog,seedStarterStatements} from '../lib/catalog-store';
import {combineEstimates,unavailableEstimate,type EstimateSnapshot} from '../lib/estimated-fmv-types';
import {canonicalEstimateTarget,valuationTargetKey,evidenceRange,readEstimates,processValuationJob,combinedListingEstimate,type ValuationEvidence} from '../lib/estimated-fmv';
import {enqueueEnrichment,claimEnrichment,finishEnrichment,retryDelay} from '../lib/enrichment-jobs';
import {resolveCoverBatch,processCoverJob,parseGcdCoverResponse,optimizeCover,revokeCoverProvider} from '../lib/cover-cache';
import {readyCachedCoverRows} from '../lib/cover-cache-read';
import {CoverSourceError,publicSourceAddress} from '../lib/cover-source-fetch';
import {listingDraftSchema,emptyListingDraft,resizeCopyIds,completeDraftCondition} from '../lib/listing-draft';
import {rankVisionDirectory,type CoverObservations} from '../lib/vision-directory-match';
import {activityChange,qualifyingPlatformSale,readMarketPulseSnapshot} from '../lib/market-pulse-snapshot';
import {createListing} from '../lib/marketplace';
import {emptyVault} from '../lib/vault';
import {profiles,collections,media} from '../db/schema';
import {previewRulesVersion,type ListingItem} from '../lib/community';
let engine:PGlite;const pool=new Pool(),db=getDb();
const condition={mode:'Raw' as const,grade:'8.0',label:'Raw',printing:'First printing'};
before(async()=>{
 engine=new PGlite();await nativeGcdFixture(engine);await engine.exec('CREATE SCHEMA ch_web');
 for(const name of ['001_original_comichuddle.sql','002_runtime.sql','004_catalog_cover_references.sql','006_marketplace_wallet_safepurchase.sql','007_us_postal_centroids.sql','008_safepurchase_retention.sql','009_wallet_history_mode.sql','010_native_gcd_directory.sql','011_collector_rewards.sql','012_sourced_fmv.sql','013_native_directory_join.sql','014_preserve_incomplete_snapshot.sql','015_native_readiness_gate.sql','016_fast_catalog_fallback.sql','017_full_native_directory.sql','018_market_pulse_history.sql','019_native_read_state.sql','020_native_predicate_statistics.sql','021_catalog_recognition.sql','022_coordinated_enrichment.sql'])await engine.exec(readFileSync('db/postgres-migrations/'+name,'utf8'));
 await engine.exec('SET search_path TO ch_web,gcd,public');
 const query=async(config:string|{text:string;rowMode?:string},values:unknown[]=[])=>{const r=await engine.query<Record<string,unknown>>(typeof config==='string'?config:config.text,values);return {...r,rowCount:r.affectedRows,command:'',rows:typeof config!=='string'&&config.rowMode==='array'?r.rows.map(row=>r.fields.map(field=>row[field.name])):r.rows}};
 Object.assign(pool,{query,connect:async()=>({query,release(){}})});(globalThis as typeof globalThis&{comicHuddlePool:Pool}).comicHuddlePool=pool;await db.batch(seedStarterStatements(db,new Date().toISOString()));
 await engine.exec(`INSERT INTO gcd.gcd_publisher VALUES(78,'QA Publisher',0);INSERT INTO gcd.gcd_series VALUES(17,'Secret Wars',78,0);INSERT INTO gcd.gcd_issue(id,series_id,number,key_date,variant_name,deleted) VALUES(123,17,'1','1984-05-00','First printing',0),(124,17,'1','1984-05-00','Facsimile',0),(125,17,'1AU','2020-01-00','First printing',0)`);
 process.env.ENRICHMENT_AI_ENABLED='false';
});
after(async()=>{await engine.close();delete(globalThis as typeof globalThis&{comicHuddlePool?:Pool}).comicHuddlePool;for(const key of ['ENRICHMENT_AI_ENABLED','ENRICHMENT_COVERS_ENABLED','COVER_STORAGE_BUCKET','COVER_CDN_BASE_URL','COVER_CLOUDFRONT_DISTRIBUTION_ID','COVER_STORAGE_REVIEWED','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY'])delete process.env[key]});
const quote=(low:number,high:number):EstimateSnapshot=>({...unavailableEstimate(null),id:randomUUID(),status:'available',lowCents:low,highCents:high,calculatedAt:new Date().toISOString()});
test('integer-cent bundle math preserves quantities and explicit partial coverage',()=>{
 const components=[{id:'a',title:'A',quantity:2,request:null,snapshot:quote(1000,2000)},{id:'b',title:'B',quantity:1,request:null,snapshot:quote(3000,4000)}];
 const complete=combineEstimates(components,'same');assert.equal(complete.lowCents,5000);assert.equal(complete.highCents,8000);assert.equal(complete.pricedCopies,3);assert.equal(complete.status,'complete');
 const partial=combineEstimates([...components,{id:'c',title:'Unknown',quantity:1,request:null,snapshot:unavailableEstimate(null)}],'partial');assert.equal(partial.lowCents,5000);assert.equal(partial.totalCopies,4);assert.equal(partial.pricedCopies,3);assert.equal(partial.status,'partial');assert.equal(combineEstimates([{id:'c',title:'Unknown',quantity:1,request:null,snapshot:unavailableEstimate(null)}],'none').lowCents,null);assert.throws(()=>combineEstimates([{...components[0],quantity:1.5}],'bad'));
});
test('valuation keys preserve exact edition and copy condition; certificate and asking price are not price anchors',async()=>{
 const issue=(await catalogIssue(db,4000000123))!,target=canonicalEstimateTarget(issue,{issueId:issue.id,condition}),key=valuationTargetKey(target);
 assert.equal(key,valuationTargetKey({...target,reference:true}));assert.notEqual(key,valuationTargetKey({...target,condition:{...condition,printing:'Facsimile'}}));assert.notEqual(key,valuationTargetKey({...target,condition:{...condition,grade:'6.0'}}));assert.notEqual(key,valuationTargetKey({...target,language:'French'}));assert.equal(key,valuationTargetKey(canonicalEstimateTarget(issue,{issueId:issue.id,condition:{...condition,certificationNumber:'test-serial'}})));
});
test('external evidence needs independent recent observations; duplicate, stale, future and concentrated rows fail',()=>{
 const now=Date.now(),e=(id:number):ValuationEvidence=>({id:String(id),kind:'sale',low:1000+id*100,high:1000+id*100,observedAt:new Date(now-id*86400000).toISOString(),entity:'seller-'+id,provider:'original-auction',reference:'isolated QA transaction'}),rows=[1,2,3,4,5].map(e);
 assert.ok(evidenceRange(rows,now));assert.equal(evidenceRange([rows[0],rows[0],rows[1]],now),null);assert.equal(evidenceRange(rows.map(r=>({...r,entity:'same-seller'})),now),null);assert.equal(evidenceRange(rows.map(r=>({...r,observedAt:'2020-01-01T00:00:00Z'})),now),null);assert.equal(evidenceRange(rows.map(r=>({...r,observedAt:new Date(now+86400000).toISOString()})),now),null);
 assert.equal(evidenceRange([{...rows[0],kind:'reviewed_baseline',observedAt:'2020-01-01T00:00:00Z'}],now),null);
});
test('display-driven duplicate requests create one durable target/job, unavailable evidence never fabricates a number',async()=>{
 const request={issueId:4000000123,condition};const first=await readEstimates(db,[request,request]);assert.equal(first[0].lowCents,null);await readEstimates(db,[request]);assert.equal((await engine.query('SELECT count(*) AS n FROM ch_web.enrichment_jobs WHERE kind=\'valuation\'')).rows[0].n,1);
 const job=await claimEnrichment(db,'valuation');assert.ok(job);await processValuationJob(db,job);const snapshot=(await readEstimates(db,[request]))[0];assert.equal(snapshot.status,'insufficient_evidence');assert.equal(snapshot.lowCents,null);assert.ok(snapshot.id);assert.equal((await engine.query('SELECT count(*) AS n FROM ch_web.enrichment_ai_usage')).rows[0].n,0);
});
test('seller and buyer use the same eligible snapshot and composition version independently of asking price',async()=>{
 await engine.exec(`INSERT INTO ch_web.source_permissions(provider,enabled,access_allowed,cache_allowed,display_allowed,ai_allowed,valuation_allowed,evidence_reference,attribution,valid_until) VALUES('isolated-QA',true,true,true,true,true,true,'isolated test rights only','QA only',now()+interval '1 day')`);
 const issue=(await catalogIssue(db,4000000123))!,target=canonicalEstimateTarget(issue,{issueId:issue.id,condition}),key=valuationTargetKey(target),id=randomUUID();
 await engine.query(`INSERT INTO ch_web.valuation_snapshots(id,target_key,target,status,low_cents,high_cents,evidence,evidence_kind,sample_count,independent_count,expires_at,model,methodology,explanation) VALUES($1,$2,$3,'available',1000,2000,'{"providers":["isolated-QA"],"sources":[{"label":"Isolated QA, not live evidence"}]}','sales',5,5,now()+interval '1 hour','test-only','test-only','Isolated fixture, never production')`,[id,key,JSON.stringify(target)]);await engine.query('UPDATE ch_web.valuation_targets SET snapshot_id=$1 WHERE target_key=$2',[id,key]);
 const items:ListingItem[]=['owned-a','owned-b'].map(copy=>({id:copy,bookId:copy,title:issue.title,issue:'#1',grade:'Raw 8.0',externalCatalog:{provider:'GCD',id:123,sourceUrl:'https://www.comics.org/issue/123/',license:'CC BY-SA 4.0'},condition}));
 const seller=await combinedListingEstimate(db,items),buyer=await combinedListingEstimate(db,structuredClone(items));assert.equal(seller.compositionVersion,buyer.compositionVersion);assert.equal(seller.lowCents,2000);assert.equal(seller.highCents,4000);assert.equal(buyer.components[0].snapshot.id,id);assert.equal(seller.components.length,1);assert.equal(seller.components[0].quantity,2);
 await engine.exec("UPDATE ch_web.source_permissions SET enabled=false WHERE provider='isolated-QA'");assert.equal((await combinedListingEstimate(db,items)).lowCents,null);
});
test('durable worker leases deduplicate claims, recover interrupted work, and honor Retry-After',async()=>{
 await enqueueEnrichment(db,'cover','lease-test',{issueId:4000000123});const first=await claimEnrichment(db,'cover');assert.ok(first);assert.equal(await claimEnrichment(db,'cover'),null);await engine.query("UPDATE ch_web.enrichment_jobs SET lease_expires_at=now()-interval '1 minute' WHERE id=$1",[first.id]);const recovered=await claimEnrichment(db,'cover');assert.equal(recovered?.id,first.id);assert.notEqual(recovered?.lease_token,first.lease_token);assert.equal(retryDelay(1,'120',Date.now(),()=>0),120);await finishEnrichment(db,recovered!,'PENDING','provider_wait',120);assert.equal((await engine.query('SELECT attempts FROM ch_web.enrichment_jobs WHERE id=$1',[first.id])).rows[0].attempts,1);await engine.query("UPDATE ch_web.enrichment_jobs SET status='DONE' WHERE id=$1",[first.id]);
});
function storage(){Object.assign(process.env,{ENRICHMENT_COVERS_ENABLED:'true',COVER_STORAGE_BUCKET:'isolated-test-bucket',COVER_CDN_BASE_URL:'https://qa-cdn.example.com',COVER_CLOUDFRONT_DISTRIBUTION_ID:'TESTONLY',COVER_STORAGE_REVIEWED:'true',AWS_ACCESS_KEY_ID:'TESTONLY',AWS_SECRET_ACCESS_KEY:'TESTONLY'})}
async function coverGrant(){await engine.exec(`INSERT INTO ch_web.source_permissions(provider,enabled,access_allowed,cache_allowed,display_allowed,ai_allowed,valuation_allowed,evidence_reference,attribution,approved_hosts,valid_until) VALUES('GCD',true,true,true,true,false,false,'isolated cover permission fixture','Cover image source: isolated QA fixture','["www.comics.org"]',now()+interval '1 day') ON CONFLICT(provider) DO UPDATE SET enabled=true,revoked_at=NULL`)}
test('cold cover misses dedupe; validated renditions become stable CDN hits without a second source call',async()=>{
 storage();await coverGrant();await resolveCoverBatch(db,[4000000123]);await resolveCoverBatch(db,[4000000123]);assert.equal((await engine.query("SELECT count(*) AS n FROM ch_web.enrichment_jobs WHERE job_key='4000000123' AND kind='cover'")).rows[0].n,1);
 const job=await claimEnrichment(db,'cover');assert.ok(job);const bytes=await sharp({create:{width:160,height:240,channels:3,background:'#f2cd4a'}}).png().toBuffer();let fetched=0,written=0;
 await processCoverJob(db,job,{fetchSource:async url=>{fetched++;return {url,status:200,headers:{'content-type':url.includes('/api/')?'application/json':'image/png'},bytes:url.includes('/api/')?Buffer.from(JSON.stringify({api_url:'https://www.comics.org/api/issue/123/',covers:[{id:77,issue_id:123,url:'https://www.comics.org/test-only.png'}]})):bytes}},writeRendition:async()=>{written++}});
 assert.equal(fetched,2);assert.equal(written,3);const ready=await resolveCoverBatch(db,[4000000123]);assert.equal(ready[0].status,'CACHED');assert.match(ready[0].url!,/^https:\/\/qa-cdn\.example\.com\/comic-covers\/GCD\/123\/77\//);assert.equal((await readyCachedCoverRows(db,[4000000123])).size,1);assert.equal(fetched,2);assert.equal((await engine.query('SELECT width FROM ch_web.cover_cache WHERE issue_id=4000000123')).rows[0].width,160);
});
test('unapproved hosts, private addresses, unknown metadata and wrong variant associations cannot become covers',async()=>{
 for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.0.1','::1','::ffff:127.0.0.1','fc00::1','2001:db8::1'])assert.equal(publicSourceAddress(address),false,address);assert.equal(publicSourceAddress('8.8.8.8'),true);assert.equal(publicSourceAddress('2606:4700:4700::1111'),true);
 assert.throws(()=>parseGcdCoverResponse({api_url:'https://www.comics.org/api/issue/124/',cover_url:null},123));assert.throws(()=>parseGcdCoverResponse({api_url:'https://www.comics.org/api/issue/123/',covers:[{issue_id:124,url:'https://www.comics.org/another.png'}]},123));assert.throws(()=>parseGcdCoverResponse({api_url:'https://www.comics.org/api/issue/123/'},123));assert.equal(parseGcdCoverResponse({api_url:'https://www.comics.org/api/issue/123/',cover_url:null},123).confirmedAbsent,true);await assert.rejects(optimizeCover(Buffer.from('<html>denied</html>'),'text/html'));
});
test('403/HTML access denials trip the circuit rather than being called a missing scan',async()=>{
 await engine.exec("DELETE FROM ch_web.enrichment_provider_limits WHERE provider='GCD-covers'");await resolveCoverBatch(db,[4000000124]);const job=await claimEnrichment(db,'cover');assert.ok(job);await processCoverJob(db,job,{fetchSource:async()=>{throw new CoverSourceError('source_access_denied',403)}});const row=(await engine.query("SELECT status,sanitized_error_code FROM ch_web.cover_cache WHERE issue_id=4000000124")).rows[0];assert.equal(row.status,'BLOCKED');assert.equal(row.sanitized_error_code,'source_access_denied');assert.equal((await engine.query("SELECT status FROM ch_web.enrichment_jobs WHERE id=$1",[job.id])).rows[0].status,'BLOCKED');
});
test('source revocation immediately suppresses cached art and enqueues a durable purge',async()=>{
 await revokeCoverProvider(db,'GCD');assert.equal((await readyCachedCoverRows(db,[4000000123])).size,0);assert.equal((await resolveCoverBatch(db,[4000000123]))[0].url,null);assert.equal((await engine.query("SELECT count(*) AS n FROM ch_web.enrichment_jobs WHERE job_key='purge:GCD'")).rows[0].n,1);
});
test('draft quantities are stable, certified copies stay separate, and stale revisions cannot overwrite saved drafts',async()=>{
 const ids=resizeCopyIds(['physical-a'],3,randomUUID);assert.equal(ids[0],'physical-a');assert.equal(new Set(ids).size,3);assert.deepEqual(resizeCopyIds(ids,1,randomUUID),['physical-a']);const row={id:'row',issueId:4000000123,title:'Secret Wars',issue:'#1',publisher:'QA',year:1984,variant:'First printing',copyIds:ids,condition};const draft={...emptyListingDraft(),rows:[row]};assert.ok(listingDraftSchema.safeParse(draft).success);assert.equal(listingDraftSchema.safeParse({...draft,rows:[{...row,condition:{...condition,certificationNumber:'serial'}}]}).success,false);assert.equal(completeDraftCondition({mode:'Raw'}),undefined);
 const revision=randomUUID();await engine.query('INSERT INTO ch_web.collector_listing_drafts(user_id,revision,data) VALUES($1,$2,$3)',['draft-user',revision,JSON.stringify(draft)]);const fresh=randomUUID();assert.equal((await engine.query('UPDATE ch_web.collector_listing_drafts SET revision=$1 WHERE user_id=$2 AND revision=$3 RETURNING user_id',[fresh,'draft-user',revision])).rows.length,1);assert.equal((await engine.query('UPDATE ch_web.collector_listing_drafts SET revision=$1 WHERE user_id=$2 AND revision=$3 RETURNING user_id',[randomUUID(),'draft-user',revision])).rows.length,0);
});
test('scanner only ranks retrieved actual editions and preserves alphanumeric issue identifiers',async()=>{
 const issues=(await Promise.all([123,124,125].map(id=>catalogIssue(db,4000000000+id)))).filter(Boolean) as NonNullable<Awaited<ReturnType<typeof catalogIssue>>>[];const observed:CoverObservations={title:'Secret Wars',number:'1',publisher:'QA Publisher',dateText:'1984',coverPriceText:null,barcode:null,printingClues:[],labelText:null,quality:'clear'};
 assert.equal(rankVisionDirectory(observed,issues).length,2);assert.equal(rankVisionDirectory({...observed,number:'1AU'},issues)[0].issue.id,4000000125);assert.equal(rankVisionDirectory({...observed,title:'Nonexistent Book'},issues).length,0);assert.equal(rankVisionDirectory({...observed,quality:'poor_photo'},issues).length,0);const original=rankVisionDirectory({...observed,printingClues:['facsimile']},[issues[0]])[0];assert.equal(original.needsEditionPhoto,true);
});
test('test orders and manual sold rows are not sales rankings; zero denominators never invent growth',async()=>{
 assert.equal(qualifyingPlatformSale({id:'qa',sandbox:1,buyer_user_id:'buyer',seller_user_id:'seller',state:'{}',snapshot:'{}'},Date.now()),null);assert.equal(qualifyingPlatformSale({id:'qa',sandbox:0,buyer_user_id:'buyer',seller_user_id:'seller',state:'{}',snapshot:'{}'},Date.now()),null);assert.equal(activityChange(7,0),null);assert.equal(activityChange(6,3),100);const pulse=await readMarketPulseSnapshot(db);assert.equal(pulse.topSold.length,0);assert.equal(pulse.notable.length,0);assert.equal(pulse.timezone,'America/Chicago');assert.ok(pulse.spotlight.length>0);assert.ok(pulse.spotlight.every(row=>row.value===null&&row.changePercent===null));
});
test('multiple actual owned native GCD copies publish while cover/AI providers are unavailable',async()=>{
 const user=randomUUID(),id=randomUUID(),stamp=new Date().toISOString(),seller=(await db.insert(profiles).values({id,userId:user,handle:'qa_'+id.slice(0,8),name:'Isolated upgrade QA',bio:'',tagline:'',location:'Minneapolis, MN',favorite:'',since:2026,color:'red',featured:'[]',visible:1,dmOpen:1,createdAt:stamp,rulesVersion:previewRulesVersion,rulesAcceptedAt:stamp}).returning())[0],photo=randomUUID(),vault=emptyVault('Isolated QA');vault.books=[123,124].map(gcdId=>({id:randomUUID(),title:'Secret Wars',issue:'#1',grade:'Raw 8.0',price:0,externalCatalog:{provider:'GCD' as const,id:gcdId,sourceUrl:'https://www.comics.org/issue/'+gcdId+'/',license:'CC BY-SA 4.0' as const}}));
 await db.insert(collections).values({userId:user,data:JSON.stringify(vault),revision:randomUUID()});await db.insert(media).values({id:photo,userId:user,contentType:'image/jpeg',createdAt:stamp});const result=await createListing(db,seller,{action:'listing',kind:'collection',saleType:'fixed',title:'Two exact editions',bookIds:vault.books.map(copy=>copy.id),conditions:Object.fromEntries(vault.books.map(copy=>[copy.id,condition])),description:'Two owned physical copies with actual listing photos.',price:5000,shipping:100,photos:[photo],attest:true,usaAttest:true});assert.ok(result.listingId);const listing=(await engine.query('SELECT items,item_count FROM ch_web.listings WHERE id=$1',[result.listingId])).rows[0];assert.equal(listing.item_count,2);assert.equal(JSON.parse(String(listing.items)).length,2);await assert.rejects(createListing(db,seller,{action:'listing',kind:'collection',saleType:'fixed',title:'Duplicate',bookIds:vault.books.map(copy=>copy.id),description:'Same copies are already reserved.',price:5000,shipping:100,photos:[photo],attest:true,usaAttest:true}));
});

test('native directory supports explicit year and publisher terms without treating 2000 AD as a date',async()=>{
 const {catalogQueryParts}=await import('../lib/catalog-search');assert.deepEqual(catalogQueryParts('2000 AD #1').words,['2000','ad']);assert.deepEqual(catalogQueryParts('Secret Wars #1 1984').years,[1984]);
 const page=await searchSharedCatalog(db,{q:'QA Publisher Secret Wars #1 (1984)',limit:12,offset:0});assert.equal(page.total,2);assert.ok(page.issues.every(issue=>issue.year===1984&&issue.number==='1'));
});
