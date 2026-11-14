// AI cover identification with mocked Gemini responses (no network, no key).
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {Pool} from 'pg';
import sharp from 'sharp';
import {nativeGcdFixture} from './native-gcd-fixture';
import {getDb} from '../db';
import {seedStarterStatements} from '../lib/catalog-store';
import {identifyCover,visionAvailable,visionConfig,secondsUntilPacificMidnight} from '../lib/cover-vision';
import {catalogCandidatesFor} from '../lib/cover-identify';
import {extractComicHints,rankCatalogCandidates,similarity} from '../lib/cover-ocr';
import {catalog} from '../lib/catalog';
import {searchCatalog} from '../lib/catalog-search';
// The isolated DB has no searchable shared index, so search the starter catalog with the same query strings.
const starterSearch=async(q:string)=>searchCatalog(q,12,0).issues;

let engine:PGlite;const pool=new Pool(),db=getDb();
const KEY='AQ.test-only-'+'k'.repeat(30),env={SCANNER_AI_PROVIDER:'gemini',GEMINI_API_KEY:KEY};
let image:Buffer;
type Call={url:string;key:string|null;body:any};
function gemini(reply:(call:Call)=>{status?:number;body:unknown}){
 const calls:Call[]=[];
 const fetcher=(async(input:string|URL|Request,init?:RequestInit)=>{const call={url:String(input),key:new Headers(init?.headers).get('x-goog-api-key'),body:JSON.parse(String(init?.body))};calls.push(call);const r=reply(call);return new Response(JSON.stringify(r.body),{status:r.status||200,headers:{'content-type':'application/json'}})}) as typeof fetch;
 return {calls,fetcher};
}
const ok=(json:unknown)=>({body:{candidates:[{content:{parts:[{text:JSON.stringify(json)}]},finishReason:'STOP'}]}});
const spiderMan={is_comic:true,title:'Amazing Spider-Man',issue_number:'300',publisher:'Marvel',year:1988,variant_or_printing:'',cover_artist:'Todd McFarlane',confidence:'high',barcode_digits:null};
async function photo(seed:number){return sharp({create:{width:600,height:900,channels:3,background:{r:seed%255,g:40,b:90}}}).jpeg().toBuffer()}

before(async()=>{
 engine=new PGlite();await nativeGcdFixture(engine);await engine.exec('CREATE SCHEMA ch_web');
 for(const name of ['001_original_comichuddle.sql','002_runtime.sql','004_catalog_cover_references.sql','006_marketplace_wallet_safepurchase.sql','007_us_postal_centroids.sql','008_safepurchase_retention.sql','009_wallet_history_mode.sql','010_native_gcd_directory.sql','011_collector_rewards.sql','012_sourced_fmv.sql','013_native_directory_join.sql','014_preserve_incomplete_snapshot.sql','015_native_readiness_gate.sql','016_fast_catalog_fallback.sql','017_full_native_directory.sql','018_market_pulse_history.sql','019_native_read_state.sql','020_native_predicate_statistics.sql','021_catalog_recognition.sql','022_coordinated_enrichment.sql','023_launch_stabilization.sql','025_metron_identifiers_covers.sql','026_cover_vision_cache.sql'])await engine.exec(readFileSync('db/postgres-migrations/'+name,'utf8'));
 await engine.exec('SET search_path TO ch_web,gcd,public');
 const query=async(config:string|{text:string;rowMode?:string},values:unknown[]=[])=>{const r=await engine.query<Record<string,unknown>>(typeof config==='string'?config:config.text,values);return {...r,rowCount:r.affectedRows,command:'',rows:typeof config!=='string'&&config.rowMode==='array'?r.rows.map(row=>r.fields.map(field=>row[field.name])):r.rows}};
 Object.assign(pool,{query,connect:async()=>({query,release(){}})});(globalThis as typeof globalThis&{comicHuddlePool:Pool}).comicHuddlePool=pool;await db.batch(seedStarterStatements(db,new Date().toISOString()));
 image=await photo(1);
});
after(async()=>{await engine.close();delete(globalThis as typeof globalThis&{comicHuddlePool?:Pool}).comicHuddlePool});
const reset=()=>engine.exec("DELETE FROM ch_web.cover_vision_cache;DELETE FROM ch_web.provider_request_windows;DELETE FROM ch_web.enrichment_provider_limits WHERE provider='gemini-ai'");

test('provider none (default) and missing key never call anything',async()=>{
 const {calls,fetcher}=gemini(()=>ok(spiderMan));
 assert.equal(visionConfig({}).provider,'none');
 assert.equal((await identifyCover(db,image,{env:{},fetcher})).status,'disabled');
 assert.equal((await identifyCover(db,image,{env:{SCANNER_AI_PROVIDER:'gemini'},fetcher})).reason,'missing_api_key');
 assert.equal((await identifyCover(db,image,{env:{SCANNER_AI_PROVIDER:'claude',GEMINI_API_KEY:KEY},fetcher})).reason,'provider_not_implemented');
 assert.equal(calls.length,0);
});

test('success: documented request shape, structured JSON parsed, cached by image hash, ranked catalog candidates',async()=>{
 await reset();const {calls,fetcher}=gemini(()=>ok(spiderMan));
 const result=await identifyCover(db,image,{env,fetcher});
 assert.equal(result.status,'ok');assert.equal(result.identification?.title,'Amazing Spider-Man');assert.equal(result.cached,false);
 const [call]=calls;assert.match(call.url,/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.6-flash:generateContent$/);
 assert.equal(call.key,KEY);const parts=call.body.contents[0].parts;assert.equal(parts[0].inline_data.mime_type,'image/jpeg');
 const sent=await sharp(Buffer.from(parts[0].inline_data.data,'base64')).metadata();assert.ok(Math.max(sent.width!,sent.height!)<=1024,'downscaled to <= 1024 px');
 assert.equal(call.body.generationConfig.responseFormat.text.mimeType,'APPLICATION_JSON');assert.deepEqual(call.body.generationConfig.responseFormat.text.schema.properties.confidence.enum,['high','medium','low']);
 const again=await identifyCover(db,image,{env,fetcher});assert.equal(again.cached,true);assert.equal(calls.length,1,'cache hit makes no request');
 const candidates=await catalogCandidatesFor(spiderMan,starterSearch);
 assert.ok(candidates.length>0);assert.equal(candidates[0].issue.title,'Amazing Spider-Man');assert.equal(candidates[0].issue.number,'300');assert.equal(candidates[0].numberMatch,true);
});

test('low confidence is returned as-is (the UI asks the user to choose instead of preselecting)',async()=>{
 await reset();const {fetcher}=gemini(()=>ok({...spiderMan,issue_number:'',confidence:'low'}));
 const result=await identifyCover(db,await photo(2),{env,fetcher});assert.equal(result.status,'ok');assert.equal(result.identification?.confidence,'low');
 const candidates=await catalogCandidatesFor(result.identification!,starterSearch);assert.ok(candidates.every(row=>!row.numberMatch));
});

test('quota 429 disables AI until Pacific midnight; later scans skip AI without calling Google',async()=>{
 await reset();const {calls,fetcher}=gemini(()=>({status:429,body:{error:{code:429,status:'RESOURCE_EXHAUSTED',message:'quota'}}}));
 const result=await identifyCover(db,await photo(3),{env,fetcher});assert.equal(result.status,'unavailable');assert.equal(result.reason,'quota');
 assert.equal(await visionAvailable(db,visionConfig(env)),false);
 const next=await identifyCover(db,await photo(4),{env,fetcher});assert.equal(next.status,'unavailable');assert.equal(calls.length,1,'no further requests today');
 const blocked=(await engine.query<{seconds:number}>("SELECT extract(epoch FROM blocked_until-now())::int AS seconds FROM ch_web.enrichment_provider_limits WHERE provider='gemini-ai'")).rows[0];
 assert.ok(Math.abs(blocked.seconds-secondsUntilPacificMidnight())<120);
});

test('billing/permission errors also disable for the day; malformed JSON is unavailable, not an error',async()=>{
 await reset();const denied=gemini(()=>({status:403,body:{error:{code:403,status:'PERMISSION_DENIED'}}}));
 assert.equal((await identifyCover(db,await photo(5),{env,fetcher:denied.fetcher})).reason,'access');assert.equal(await visionAvailable(db,visionConfig(env)),false);
 await reset();const broken=gemini(()=>({body:{candidates:[{content:{parts:[{text:'{"title": "Spider'}]},finishReason:'STOP'}]}}));
 const result=await identifyCover(db,await photo(6),{env,fetcher:broken.fetcher});assert.equal(result.status,'unavailable');assert.equal(result.reason,'malformed_response');
 assert.equal(await visionAvailable(db,visionConfig(env)),true,'a malformed reply does not disable AI');
});

test('global daily cap: never exceeds SCANNER_AI_DAILY_LIMIT and disables for the day at the cap',async()=>{
 await reset();const {calls,fetcher}=gemini(()=>ok(spiderMan)),capped={...env,SCANNER_AI_DAILY_LIMIT:'2'};
 for(let i=0;i<4;i++)await identifyCover(db,await photo(10+i),{env:capped,fetcher});
 assert.equal(calls.length,2,'third and fourth photos never reach Google');assert.equal(await visionAvailable(db,visionConfig(capped)),false);
});

test('OCR hint extraction and fuzzy ranking for the free path',()=>{
 const hints=extractComicHints([
  {text:'MARVEL COMICS GROUP',confidence:80,height:18,region:'masthead'},
  {text:'THE AMAZlNG',confidence:71,height:70,region:'masthead'},
  {text:'SPIDER-MAN',confidence:76,height:90,region:'masthead'},
  {text:'75¢ 300 MAY',confidence:62,height:14,region:'corner'},
  {text:'#300',confidence:70,height:20,region:'corner'},
  {text:'(c) 1988',confidence:60,height:10,region:'full'},
 ]);
 assert.equal(hints.number,'300');assert.equal(hints.publisher,'Marvel');assert.equal(hints.year,1988);
 assert.ok(hints.titles.some(title=>/spider man/.test(title)));assert.ok(hints.queries.some(query=>query.endsWith('#300')));
 const ranked=rankCatalogCandidates(hints,catalog);
 assert.equal(ranked[0].issue.title,'Amazing Spider-Man');assert.equal(ranked[0].issue.number,'300');
 assert.ok(similarity('AMAZlNG SPlDER MAN','Amazing Spider-Man')>.6);
});
