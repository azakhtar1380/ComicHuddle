// Isolated PGlite + mocked Metron fetch. No real provider calls are made.
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {Pool} from 'pg';
import {nativeGcdFixture} from './native-gcd-fixture';
import {getDb} from '../db';
import {seedStarterStatements} from '../lib/catalog-store';
import {lookupComicIdentifier} from '../lib/catalog-identifiers';
import {parseComicIdentifier} from '../lib/comic-identifiers';
import {lookupMetronIdentifier,metronUpcBase,parseMetronIssue} from '../lib/metron-identifiers';
import {resolveCoverBatch,processCoverJob} from '../lib/cover-cache';
import {readyCachedCoverRows} from '../lib/cover-cache-read';
import {claimEnrichment} from '../lib/enrichment-jobs';
import {barcodeStripCrop} from '../lib/barcode-decoder-client';
import {CATALOG_DATA_CREDIT} from '../lib/data-credits';

let engine:PGlite;const pool=new Pool(),db=getDb();
const TOKEN='qa_token_'+'x'.repeat(30),env={METRON_API_TOKEN:TOKEN,METRON_UPC_ENABLED:'true'};
const IMAGE='https://static.metron.cloud/media/issue/2020/01/01/qa.jpg';
type Call={url:string;auth:string|null};
function metron(routes:(url:URL)=>{status?:number;body?:unknown;headers?:Record<string,string>}){
 const calls:Call[]=[];
 const fetcher=(async(input:string|URL|Request,init?:RequestInit)=>{const url=new URL(String(input));calls.push({url:url.pathname+url.search,auth:new Headers(init?.headers).get('authorization')});const r=routes(url);return new Response(r.body===undefined?'':JSON.stringify(r.body),{status:r.status||200,headers:{'content-type':'application/json',...r.headers}})}) as typeof fetch;
 return {calls,fetcher};
}
before(async()=>{
 engine=new PGlite();await nativeGcdFixture(engine);await engine.exec('CREATE SCHEMA ch_web');
 for(const name of ['001_original_comichuddle.sql','002_runtime.sql','004_catalog_cover_references.sql','006_marketplace_wallet_safepurchase.sql','007_us_postal_centroids.sql','008_safepurchase_retention.sql','009_wallet_history_mode.sql','010_native_gcd_directory.sql','011_collector_rewards.sql','012_sourced_fmv.sql','013_native_directory_join.sql','014_preserve_incomplete_snapshot.sql','015_native_readiness_gate.sql','016_fast_catalog_fallback.sql','017_full_native_directory.sql','018_market_pulse_history.sql','019_native_read_state.sql','020_native_predicate_statistics.sql','021_catalog_recognition.sql','022_coordinated_enrichment.sql','023_launch_stabilization.sql','025_metron_identifiers_covers.sql'])await engine.exec(readFileSync('db/postgres-migrations/'+name,'utf8'));
 await engine.exec('SET search_path TO ch_web,gcd,public');
 const query=async(config:string|{text:string;rowMode?:string},values:unknown[]=[])=>{const r=await engine.query<Record<string,unknown>>(typeof config==='string'?config:config.text,values);return {...r,rowCount:r.affectedRows,command:'',rows:typeof config!=='string'&&config.rowMode==='array'?r.rows.map(row=>r.fields.map(field=>row[field.name])):r.rows}};
 Object.assign(pool,{query,connect:async()=>({query,release(){}})});(globalThis as typeof globalThis&{comicHuddlePool:Pool}).comicHuddlePool=pool;await db.batch(seedStarterStatements(db,new Date().toISOString()));
 await engine.exec(`INSERT INTO gcd.gcd_publisher VALUES(78,'QA Publisher',0);INSERT INTO gcd.gcd_series VALUES(17,'Secret Wars',78,0);INSERT INTO gcd.gcd_issue(id,series_id,number,key_date,variant_name,deleted) VALUES(123,17,'1','1984-05-00','First printing',0),(124,17,'2','1984-06-00','First printing',0),(125,17,'3','1984-07-00','First printing',0)`);
});
// These tests cover catalog art, which is off unless CATALOG_ART_COVERS=on (lib/cover-policy.ts).
process.env.CATALOG_ART_COVERS='on';
after(async()=>{delete process.env.CATALOG_ART_COVERS;await engine.close();delete(globalThis as typeof globalThis&{comicHuddlePool?:Pool}).comicHuddlePool;for(const key of ['METRON_API_TOKEN','COVER_DIRECT_DISPLAY'])delete process.env[key]});

test('supplement mismatch falls back to a base-only record; exact supplement still wins',async()=>{
 await engine.exec(`INSERT INTO ch_web.directory_identifiers(issue_id,source,identifier,lookup_key,supplement,kind) VALUES(4000000123,'GCD','036000291452','0036000291452','','UPC'),(4000000124,'GCD','03600029145200211','0036000291452','00211','UPC')`);
 const base=await lookupComicIdentifier('036000291452','00111','',{env:{}});
 assert.equal(base?.match,'base');assert.deepEqual(base?.issues.map(issue=>issue.id),[4000000123]);assert.match(base!.notice,/exact supplement/);
 const exact=await lookupComicIdentifier('036000291452','00211','',{env:{}});
 assert.equal(exact?.match,'exact');assert.deepEqual(exact?.issues.map(issue=>issue.id),[4000000124]);
 const noSupplement=await lookupComicIdentifier('036000291452','','',{env:{}});
 assert.deepEqual(noSupplement?.issues.map(issue=>issue.id).sort(),[4000000123,4000000124]);
 // Without a token the Metron fallback stays off and no request is made.
 const miss=await lookupComicIdentifier('012345678905','','',{env:{}});assert.equal(miss?.issues.length,0);assert.equal(miss?.metron.status,'disabled');
 await engine.exec('DELETE FROM ch_web.directory_identifiers');
});

test('Metron fallback maps gcd_id to the native record, stores the identifier and caches the barcode',async()=>{
 const {calls,fetcher}=metron(url=>{
  if(url.searchParams.get('upc')==='03600029145200311')return {body:{count:1,results:[{id:9001,series:{name:'Secret Wars',volume:1,year_began:1984},number:'3',cover_date:'1984-07-01',image:IMAGE}]}};
  if(url.pathname==='/api/issue/9001/')return {body:{id:9001,series:{name:'Secret Wars'},publisher:{id:1,name:'Marvel'},number:'3',cover_date:'1984-07-01',upc:'03600029145200311',gcd_id:125,image:IMAGE,resource_url:'https://metron.cloud/issue/secret-wars-1984-3/'}};
  return {body:{count:0,results:[]}};
 });
 const first=await lookupComicIdentifier('036000291452','00311','',{env,fetcher});
 assert.equal(first?.match,'metron');assert.deepEqual(first?.issues.map(issue=>issue.id),[4000000125]);assert.equal(first?.external.length,0);
 assert.deepEqual(calls.map(call=>call.url),['/api/issue/?upc=03600029145200311','/api/issue/9001/']);assert.ok(calls.every(call=>call.auth==='Bearer '+TOKEN));
 const stored=(await engine.query<{source:string;supplement:string}>("SELECT source,supplement FROM ch_web.directory_identifiers WHERE issue_id=4000000125")).rows;
 assert.deepEqual(stored,[{source:'METRON',supplement:'00311'}]);
 // Repeat scan: served from the local index; Metron is not called again.
 const again=await lookupComicIdentifier('036000291452','00311','',{env,fetcher});
 assert.equal(again?.match,'exact');assert.equal(calls.length,2);
});

test('unmapped Metron issue is returned as an external candidate; misses are negatively cached',async()=>{
 const {calls,fetcher}=metron(url=>{
  if(url.searchParams.get('upc_starts_with')==='075960608931')return {body:{count:1,results:[{id:777,series:{name:'Modern Book'},number:'5',cover_date:'2024-02-01',gcd_id:2400000,image:IMAGE,upc:'07596060893100511'}]}};
  return {body:{count:0,results:[]}};
 });
 const code=parseComicIdentifier('075960608931')!;assert.equal(metronUpcBase(code),'075960608931');
 const result=await lookupMetronIdentifier(db,code,{env,fetcher});
 assert.equal(result.status,'external');assert.equal(result.issues.length,0);assert.equal(result.external[0].title,'Modern Book');
 assert.equal(result.external[0].cover,null,'covers are withheld unless COVER_DIRECT_DISPLAY=metron');
 const shown=await lookupMetronIdentifier(db,code,{env:{...env,COVER_DIRECT_DISPLAY:'metron',CATALOG_ART_COVERS:'on'},fetcher});
 assert.equal(shown.cached,true);assert.equal(shown.external[0].cover,IMAGE);assert.equal(calls.length,1);
 const missCode=parseComicIdentifier('036000291452','00999')!;
 const missing=await lookupMetronIdentifier(db,missCode,{env,fetcher});assert.equal(missing.status,'not_found');
 const callsAfterMiss=calls.length;assert.equal((await lookupMetronIdentifier(db,missCode,{env,fetcher})).cached,true);assert.equal(calls.length,callsAfterMiss);
 assert.equal(parseMetronIssue({id:1,series:{name:'X'},image:'https://evil.example/x.jpg'})?.image,null);
});

test('429 Retry-After blocks further Metron requests; budget is enforced',async()=>{
 const {calls,fetcher}=metron(()=>({status:429,headers:{'Retry-After':'120'}}));
 const result=await lookupMetronIdentifier(db,parseComicIdentifier('012345678905')!,{env,fetcher});
 assert.equal(result.status,'busy');assert.equal(calls.length,1);
 assert.equal((await lookupMetronIdentifier(db,parseComicIdentifier('036000291452','00888')!,{env,fetcher})).status,'busy');assert.equal(calls.length,1);
 await engine.exec("DELETE FROM ch_web.enrichment_provider_limits WHERE provider='metron-api'");
 const tight=metron(()=>({body:{count:0,results:[]}}));
 await engine.exec("DELETE FROM ch_web.provider_request_windows");
 await lookupMetronIdentifier(db,parseComicIdentifier('036000291452','00777')!,{env:{...env,METRON_MINUTE_BUDGET:'1'},fetcher:tight.fetcher});
 assert.equal(tight.calls.length,1,'second list request refused by the per-minute budget');
 await engine.exec("DELETE FROM ch_web.provider_request_windows");
});

test('COVER_DIRECT_DISPLAY=metron resolves, caches and serves the Metron image URL',async()=>{
 Object.assign(process.env,{METRON_API_TOKEN:TOKEN,COVER_DIRECT_DISPLAY:'metron'});
 const pending=await resolveCoverBatch(db,[4000000123]);assert.equal(pending[0].status,'PENDING');
 assert.equal((await engine.query<{n:number}>("SELECT count(*)::int AS n FROM ch_web.enrichment_jobs WHERE job_key='metron:4000000123'")).rows[0].n,1);
 const job=await claimEnrichment(db,'cover');assert.ok(job);
 const {calls,fetcher}=metron(url=>url.searchParams.get('gcd_id')==='123'?{body:{count:1,results:[{id:55,series:{name:'Secret Wars'},number:'1',gcd_id:123,image:IMAGE}]}}:{body:{count:0,results:[]}});
 await processCoverJob(db,job!,{metronFetcher:fetcher});assert.deepEqual(calls.map(call=>call.url),['/api/issue/?gcd_id=123']);
 const ready=await resolveCoverBatch(db,[4000000123]);assert.equal(ready[0].status,'CACHED');assert.equal(ready[0].url,IMAGE);assert.match(ready[0].attribution,/Metron/);
 assert.equal((await readyCachedCoverRows(db,[4000000123])).get(4000000123)?.url,IMAGE);
 // Turning the owner switch off withdraws direct display immediately.
 delete process.env.COVER_DIRECT_DISPLAY;
 assert.equal((await readyCachedCoverRows(db,[4000000123])).size,0);assert.equal((await resolveCoverBatch(db,[4000000123]))[0].url,null);
});

test('barcode strip crop maps the on-screen strip into video pixels; credit constant exists',()=>{
 const crop=barcodeStripCrop(1080,1920,320,420);
 assert.ok(crop.x>=0&&crop.y>=0&&crop.x+crop.width<=1080&&crop.y+crop.height<=1920);
 assert.ok(crop.width>crop.height,'strip is horizontal');assert.ok(crop.width>600,'full-resolution ROI, not a downscaled preview');
 assert.match(CATALOG_DATA_CREDIT,/CC BY-SA 4\.0/);assert.match(CATALOG_DATA_CREDIT,/Metron/);assert.match(CATALOG_DATA_CREDIT,/Grand Comics Database/);
});
