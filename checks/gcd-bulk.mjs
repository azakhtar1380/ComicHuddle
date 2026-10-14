// Run: node --experimental-vm-modules checks/gcd-bulk.mjs
// Actual D1-schema SQLite, bulk routes and offline files; synthetic supplier HTTP,
// owner identities and clock. Genuine GCD access is recorded separately.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
import {mkdtemp,writeFile,rm,stat} from 'node:fs/promises';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {convertGcdJsonl} from '../scripts/gcd_bulk_convert.mjs';
import {uploadGcdCsv,createBulkClient} from '../scripts/gcd_bulk_upload.mjs';
import {preflightCsv} from '../scripts/gcd_bulk_codec.mjs';

const root=process.cwd(),sqlite=new DatabaseSync(':memory:');
const migrations=(await readdir('drizzle')).filter(n=>n.endsWith('.sql')).sort();
for(const name of migrations)sqlite.exec(await readFile(path.join('drizzle',name),'utf8'));
sqlite.exec('PRAGMA foreign_keys=ON');
let prepared=0,maxBinds=0,failBatch=null,beforeBatch=null;
class Statement{
 constructor(sql,params=[]){this.sql=sql;this.params=params}
 bind(...params){maxBinds=Math.max(maxBinds,params.length);assert.ok(params.length<=100,'D1 bound parameter limit');return new Statement(this.sql,params)}
 async raw(){const s=sqlite.prepare(this.sql);s.setReturnArrays(true);return s.all(...this.params)}
 allSync(){return {results:sqlite.prepare(this.sql).all(...this.params),success:true,meta:{}}}
 async all(){return this.allSync()}
 async run(){const r=sqlite.prepare(this.sql).run(...this.params);return {results:[],success:true,meta:{changes:r.changes,last_row_id:Number(r.lastInsertRowid)}}}
}
const db={prepare(sql){prepared++;return new Statement(sql)},async batch(statements){
 if(beforeBatch){const hook=beforeBatch;beforeBatch=null;await hook(statements)}
 sqlite.exec('BEGIN');try{const rows=statements.map(s=>{if(failBatch&&failBatch(s)){failBatch=null;throw Error('Synthetic atomic storage failure')}return s.allSync()});sqlite.exec('COMMIT');return rows}catch(e){sqlite.exec('ROLLBACK');throw e}
}};
const INITIAL_TIME=Date.parse('2026-10-13T12:00:00Z'),TOKEN='SYNTHETIC_METRON_SECRET_NEVER_SENT_TO_GCD';
let now=INITIAL_TIME,activeUser=null,providerHandler=null,requests=[];
class ServerDate extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
const env={DB:db,METRON_API_TOKEN:TOKEN,METRON_SYNC_ENABLED:'true'};
async function providerFetch(url,options){
 const u=new URL(url),headers=new Headers(options?.headers);requests.push({url:u.href,authorization:headers.get('Authorization'),accept:headers.get('Accept'),redirect:options?.redirect});
 assert.equal(u.origin,'https://www.comics.org');assert.equal(u.searchParams.has('format'),false);
 assert.equal(headers.get('Authorization'),null);assert.equal(headers.get('Accept'),'application/json');assert.equal(options?.redirect,'manual');
 assert.ok(!JSON.stringify({url,headers:[...headers]}).includes(TOKEN));assert.ok(providerHandler,'Unexpected supplier request');return providerHandler(u,options);
}
const context=vm.createContext({console,crypto:webcrypto,Request,Response,Headers,URL,URLSearchParams,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,Error,Date:ServerDate,AbortController,ReadableStream,setTimeout,clearTimeout,setInterval,clearInterval,fetch:providerFetch});
const cache=new Map();
function synthetic(id,exports){return new vm.SyntheticModule(Object.keys(exports),function(){for(const [k,v] of Object.entries(exports))this.setExport(k,v)},{context,identifier:id})}
async function moduleFor(specifier,parent=''){
 if(specifier==='cloudflare:workers'){if(!cache.has(specifier))cache.set(specifier,synthetic(specifier,{env}));return cache.get(specifier)}
 if(!specifier.startsWith('.')&&!specifier.startsWith('/')){if(!cache.has(specifier))cache.set(specifier,synthetic(specifier,await import(specifier)));return cache.get(specifier)}
 let file=path.resolve(parent?path.dirname(parent):root,specifier);if(!path.extname(file)){try{await readFile(file+'.ts');file+='.ts'}catch{file=path.join(file,'index.ts')}}
 if(cache.has(file))return cache.get(file);
 if(file.endsWith('/app/chatgpt-auth.ts')){const m=synthetic(file,{getChatGPTUser:async()=>activeUser});cache.set(file,m);return m}
 const code=ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
 const m=new vm.SourceTextModule(code,{context,identifier:file});cache.set(file,m);return m;
}
async function load(file){const m=await moduleFor(path.join(root,file));if(m.status==='unlinked')await m.link((s,p)=>moduleFor(s,p.identifier));if(m.status==='linked')await m.evaluate();return m.namespace}
const route=await load('app/api/gcd-sync/route.ts'),catalogRoute=await load('app/api/catalog/route.ts');
const gcd=await load('lib/gcd-catalog.ts'),shared=await load('lib/shared-catalog.ts'),picker=await load('lib/catalog-picker-client.ts');
const store=await load('lib/catalog-store.ts'),database=(await load('db/index.ts')).getDb();
const owner={userId:'d185d22d-62d4-475e-87ac-fa2039a5d360'},member={userId:'test-member'};
const plain=v=>JSON.parse(JSON.stringify(v));
const state=()=>{const r=sqlite.prepare('SELECT * FROM catalog_sync WHERE id=?').get('gcd');return r?{...r,value:JSON.parse(r.state)}:null};
const count=()=>Number(sqlite.prepare('SELECT count(*) n FROM catalog_issues WHERE gcd_id IS NOT NULL').get().n);
function setState(mutator){const r=state();assert.ok(r);mutator(r.value);sqlite.prepare('UPDATE catalog_sync SET state=? WHERE id=?').run(JSON.stringify(r.value),'gcd')}
function reset(){
 sqlite.exec('PRAGMA foreign_keys=OFF');for(const {name} of sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()){assert.match(name,/^[a-z_0-9]+$/);sqlite.exec('DELETE FROM "'+name+'"')}sqlite.exec('PRAGMA foreign_keys=ON');
 now=INITIAL_TIME;activeUser=null;providerHandler=null;requests=[];failBatch=null;beforeBatch=null;prepared=0;env.METRON_API_TOKEN=TOKEN;env.METRON_SYNC_ENABLED='true';delete env.METRON_PRIVATE_SERVICE_ENABLED;
}
async function call(api=route,method='GET',user=owner,body,query='',options={}){
 activeUser=user;const headers=new Headers(method==='POST'?{'Content-Type':'application/json',Origin:'https://comichuddle.test'}:{});
 for(const [k,v] of Object.entries(options.headers||{})){if(v===null)headers.delete(k);else headers.set(k,v)}
 const response=await api[method](new Request('https://comichuddle.test/api/gcd-sync'+query,{method,headers,body:method==='POST'?(options.rawBody??JSON.stringify(body)):undefined}));
 return {status:response.status,data:await response.json(),headers:response.headers};
}
const action=(name,options)=>call(route,'POST',owner,{action:name},'',options);
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json',...headers}});
const link=(kind,id)=>'https://www.comics.org/api/'+kind+'/'+id+'/';
function record(id,seriesId=700,options={}){
 return {api_url:link('issue',id),series:link('series',seriesId),series_name:'Synthetic Heroes (1999 series)',number:String(id),descriptor:String(id),variant_of:null,variant_name:'',key_date:'1999-00-00',publication_date:'Winter 1999',on_sale_date:'1999-02-03',price:'$2.95',page_count:'32',isbn:'9780000000000',barcode:'000000000000',volume:'2',title:'A recorded issue title',indicia_publisher:'Synthetic Publishing',brand_emblem:'Recorded Brand',rating:'All ages',indicia_frequency:'Monthly',indicia_printer:'Recorded Printer',keywords:'hero; adventure',editing:'E. Editor',notes:'<p>Recorded bibliographic description.</p>',cover:'https://excluded.test/cover.jpg',fmv:999,
 story_set:[{type:'cover',sequence_number:0,title:'Cover',pencils:'Cover Artist',characters:'Hero'},{type:'comic story',sequence_number:1,title:'A story',feature:'Hero',page_count:'22',script:'<b>A. Writer</b>',pencils:'B. Artist',inks:'C. Inker',colors:'D. Colorist',letters:'F. Letterer',editing:'E. Editor',job_number:'job01',genre:'Superhero',first_line:'Recorded first line',characters:'Hero; Friend',synopsis:'<p>Recorded story synopsis.</p>',notes:'Story notes',keywords:'adventure'}],...options};
}
const series=(id,issues,options={})=>({api_url:link('series',id),name:'Synthetic Series '+id,year_began:1999,year_ended:null,country:'US',language:'en',publisher:link('publisher',45),active_issues:issues.map(i=>link('issue',i)),...options});
function provider(records,{current=records.map(r=>r.api_url),previous=[],pageSize=2,seriesRows=[],listResponse,detailResponse,seriesResponse,summarySeries=false,seriesDetailResponse}={}){
 const byId=new Map(records.map(r=>[gcd.gcdProviderId(r.api_url,'issue'),r]));
 return async u=>{
  const match=u.pathname.match(/^\/api\/issue\/([1-9]\d*)\/$/);if(match){const id=Number(match[1]),r=byId.get(id);return detailResponse?detailResponse(r,u):r?json(r):json({detail:'Not found'},404)}
  const seriesMatch=u.pathname.match(/^\/api\/series\/([1-9]\d*)\/$/);if(seriesMatch){const r=seriesRows.find(s=>gcd.gcdProviderId(s.api_url,'series')===Number(seriesMatch[1]));return seriesDetailResponse?seriesDetailResponse(r,u):r?json(r):json({},404)}
  const page=Number(u.searchParams.get('page')||1);let values;
  if(u.pathname==='/api/series/')values=summarySeries?seriesRows.map(r=>({api_url:r.api_url,name:r.name})):seriesRows;
  else{assert.match(u.pathname,/^\/api\/issue\/on_sale_weekly\/\d{4}\/week\/\d+\/$/);const w=gcd.isoWeek(INITIAL_TIME),path=gcd.weeklyPath(w);const links=u.pathname===path?current:previous;values=links.map(h=>{const id=gcd.gcdProviderId(h,'issue'),r=byId.get(id);return {api_url:h,series:r?.series||link('series',700)}})}
  const chunk=values.slice((page-1)*pageSize,page*pageSize),next=page*pageSize<values.length?new URL(u):null;if(next)next.searchParams.set('page',String(page+1));
  const body={count:values.length,next:next?.href||null,previous:null,results:chunk};return u.pathname==='/api/series/'&&seriesResponse?seriesResponse(body,u):listResponse?listResponse(body,u):json(body);
 };
}
async function step(mode='daily_step'){
 const before=requests.length,old=state()?.value;const r=await action(mode);
 assert.ok(requests.length-before<=gcd.GCD_BOUNDS.callsPerStep,'External calls exceed step cap');
 if(old&&r.status===200){const key=mode==='daily_step'?'daily':'backfill',field=key==='daily'?'checked':'checkedIssues';assert.ok(state().value[key][field]-old[key][field]<=gcd.GCD_BOUNDS.recordsPerStep,'Record cap exceeded')}
 assert.equal(sqlite.prepare('SELECT count(*) n FROM operation_guard').get().n,0);return r;
}
async function complete(mode='daily_step',max=80){
 for(let i=0;i<max;i++){const r=await step(mode);assert.equal(r.status,200,JSON.stringify(r.data));const key=mode==='daily_step'?'daily':'backfill';if(r.data[key].stage===(key==='daily'?'complete':'pass_complete'))return r;now+=60000}assert.fail('Checkpoint did not finish in bounded fixture steps');
}
async function install(r,stamp=new ServerDate().toISOString()){await database.batch(gcd.gcdRecordStatements(database,gcd.normalizeGcdIssue(r,stamp)))}
let passed=0,completed=false;const failures=[];
process.on('beforeExit',()=>{if(!completed){console.error('GCD suite did not finish');process.exitCode=1}});
async function test(name,run){reset();let timer;console.log('RUN: '+name);try{await Promise.race([run(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Case exceeded20 seconds')),20000)})]);passed++;console.log('PASS: '+name)}catch(e){failures.push({name,message:e.message});console.error('FAIL: '+name+' — '+e.stack)}finally{clearTimeout(timer)}}
const bulkRoute=await load('app/api/gcd-bulk/route.ts'),bulkFormat=await load('lib/gcd-bulk-format.ts');
const SNAPSHOT='2026-10-01T00:00:00.000Z';
const bulkCall=(body,user=owner,options={})=>call(bulkRoute,'POST',user,body,'',options);
const bulkStatus=id=>call(bulkRoute,'GET',owner,undefined,'?importId='+id);
const gcdRow=()=>sqlite.prepare('SELECT state,minute_start,minute_requests,day_start,day_requests,retry_at FROM catalog_sync WHERE id=?').get('gcd');
async function manifestFor(records,overrides={}){let chain=bulkFormat.GCD_EMPTY_CHAIN;for(const raw of records)chain=await bulkFormat.appendGcdRecordChain(chain,bulkFormat.sanitizeGcdBulkRecord(raw,SNAPSHOT));return {schemaVersion:'gcd-bulk/v1',sourceUrl:'https://www.comics.org/download/',sourceSha256:await bulkFormat.sha256('Synthetic authorized export fixture'),exportSha256:await bulkFormat.sha256('Synthetic CSV fixture'),recordsSha256:chain,snapshotAt:SNAPSHOT,expectedRecords:records.length,licenseUrl:'https://creativecommons.org/licenses/by-sa/4.0/',licenseAcknowledged:true,...overrides}}
async function startBulk(records,overrides){const manifest=await manifestFor(records,overrides),r=await bulkCall({action:'start',manifest});assert.equal(r.status,200,JSON.stringify(r.data));return {manifest,id:r.data.importId,status:r.data}}
const batch=(id,index,records)=>bulkCall({action:'batch',importId:id,batchIndex:index,records});

await test('Additive bulk migration works through physical lines and enforces receipt/count constraints',async()=>{
 const check=new DatabaseSync(':memory:');try{for(const name of migrations.filter(n=>n<'0013_gcd_bulk_ingest.sql'))check.exec(await readFile(path.join('drizzle',name),'utf8'));for(const line of (await readFile('drizzle/0013_gcd_bulk_ingest.sql','utf8')).split(/\r?\n/).filter(l=>l.trim()))check.exec(line);assert.equal(check.prepare("SELECT count(*) n FROM sqlite_master WHERE name IN('catalog_gcd_bulk_runs','catalog_gcd_bulk_batches')").get().n,2)}finally{check.close()}
 assert.throws(()=>sqlite.prepare('INSERT INTO catalog_gcd_bulk_runs(id,manifest,expected_records,record_chain_sha256,created_at) VALUES(?,?,?,?,?)').run('bad','{}',0,'0'.repeat(64),'2026-01-01'),/CHECK/);
});
await test('Bulk owner, private service, Origin, strict JSON and actual byte limits fail without catalog writes',async()=>{
 const m=await manifestFor([record(1)]);for(const [user,headers,expected] of [[null,{},401],[member,{},403],[owner,{Origin:null},403],[owner,{Origin:'https://evil.test'},403]])assert.equal((await bulkCall({action:'start',manifest:m},user,{headers})).status,expected);
 for(const [body,headers,rawBody,expected] of [[{action:'start',manifest:m,token:TOKEN},{},undefined,400],[{action:'start',manifest:m},{'Content-Type':'text/plain'},undefined,415],[{}, {},'{',400],[{action:'start',manifest:m},{'Content-Length':'1'},'x'.repeat(1600001),413]])assert.equal((await bulkCall(body,owner,{headers,rawBody})).status,expected);
 assert.equal(sqlite.prepare('SELECT count(*) n FROM catalog_issues').get().n,0);assert.equal(state(),null);assert.equal(requests.length,0);
 const svc={'x-comichuddle-catalog-run':'owner-private-service',Origin:null};env.METRON_PRIVATE_SERVICE_ENABLED='true';assert.equal((await bulkCall({action:'start',manifest:m},null,{headers:svc})).status,200);assert.equal((await bulkCall({action:'start',manifest:m},member,{headers:svc})).status,403);assert.equal((await bulkCall({action:'start',manifest:m},null,{headers:{...svc,Origin:''}})).status,401);
});
await test('Complete ordered export preserves starters, exact GCD detail and provenance without supplier quota or Metron mutation',async()=>{
 await action('pause');const before=gcdRow();sqlite.prepare('INSERT INTO catalog_sync(id,state) VALUES(?,?)').run('metron','{"source":"prior"}');const records=[record(1),record(2,700,{indicia_publisher:null,publisher_name:'Recorded series publisher'})],{id}=await startBulk(records);let r=await batch(id,0,records);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.acceptedRecords,2);assert.equal(r.data.writtenRecords,2);assert.equal(r.data.nextBatch,1);r=await bulkCall({action:'finish',importId:id});assert.equal(r.status,200);assert.equal(r.data.stage,'COMPLETED');assert.equal(r.data.historicalCoverageComplete,false);assert.equal(count(),2);assert.equal(sqlite.prepare('SELECT count(*) n FROM catalog_issues WHERE id BETWEEN 0 AND 42').get().n,43);assert.deepEqual(gcdRow(),before);assert.equal(sqlite.prepare('SELECT state FROM catalog_sync WHERE id=?').get('metron').state,'{"source":"prior"}');assert.equal(env.METRON_API_TOKEN,TOKEN);assert.equal(requests.length,0);
 const detail=await call(catalogRoute,'GET',null,undefined,'?id=4000000002');assert.equal(detail.data.issues[0].publisher,'Recorded series publisher');assert.equal(detail.data.issues[0].bibliography.indiciaPublisher,'');assert.equal(detail.data.issues[0].bibliography.originalCoverPrice.kind,'ORIGINAL_COVER_PRICE');assert.ok(!JSON.stringify(detail.data).includes('excluded.test'));const stored=sqlite.prepare('SELECT fetched_at,raw_metadata FROM catalog_issues WHERE gcd_id=2').get();assert.equal(stored.fetched_at,SNAPSHOT);assert.equal(JSON.parse(stored.raw_metadata).bulkProvenance.importId,id);assert.ok(!stored.raw_metadata.includes('"fmv"'));assert.match((await bulkStatus(id)).headers.get('Cache-Control'),/no-store/);
});
await test('Exact receipt replay is stable while changed metadata at a committed index is rejected',async()=>{
 const records=[record(1)],{id}=await startBulk(records);const first=await batch(id,0,records);assert.equal(first.status,200);const replay=await batch(id,0,records);assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);assert.deepEqual(replay.data.receipt,first.data.receipt);assert.equal((await batch(id,0,[record(1,700,{notes:'Changed content'})])).status,409);assert.equal((await bulkStatus(id)).data.acceptedRecords,1);assert.equal(count(),1);assert.equal((await bulkCall({action:'finish',importId:id})).status,200);assert.equal((await batch(id,0,records)).status,200);assert.equal((await bulkCall({action:'finish',importId:id})).data.replayed,true);
});
await test('Every record validates before batch writes; invalid, duplicate, unordered and excessive batches leave cursor untouched',async()=>{
 const {id}=await startBulk([record(1),record(2)]);for(const [rows,status] of [[[record(1),record(2,700,{series:'https://evil.test/api/series/700/'})],400],[[record(1),record(1)],400],[[record(2),record(1)],400],[Array.from({length:9},(_,i)=>record(i+1)),400]]){assert.equal((await batch(id,0,rows)).status,status);assert.equal(count(),0);assert.equal((await bulkStatus(id)).data.nextBatch,0)}assert.equal((await batch(id,1,[record(1)])).status,409);assert.equal((await batch(id,0,[record(1)])).status,200);assert.equal((await batch(id,1,[record(1)])).status,409);
});
await test('Late receipt storage failure rolls back every catalog row and cursor, then exact retry succeeds',async()=>{
 const records=[record(1),record(2)],{id}=await startBulk(records);failBatch=s=>s.sql.startsWith('insert into "catalog_gcd_bulk_batches"');assert.equal((await batch(id,0,records)).status,503);assert.equal(count(),0);assert.equal((await bulkStatus(id)).data.nextBatch,0);assert.equal(sqlite.prepare('SELECT count(*) n FROM catalog_gcd_bulk_batches').get().n,0);assert.equal((await batch(id,0,records)).status,200);assert.equal((await bulkCall({action:'finish',importId:id})).status,200);
});
await test('Old and equal snapshot imports retain complete existing API records with stable directory IDs',async()=>{
 await install(record(1,700,{notes:'Fresh API metadata'}),new ServerDate().toISOString());await install(record(2,700,{notes:'Equal timestamp API metadata'}),SNAPSHOT);const originals=sqlite.prepare('SELECT * FROM catalog_issues WHERE gcd_id IS NOT NULL ORDER BY id').all().map(plain);const records=[record(1,700,{notes:'Old archive metadata'}),record(2,700,{notes:'Reconverted equal metadata'}),record(3)],{id}=await startBulk(records);const r=await batch(id,0,records);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.writtenRecords,1);assert.equal(r.data.retainedNewerRecords,2);assert.deepEqual(sqlite.prepare('SELECT * FROM catalog_issues WHERE gcd_id IN(1,2) ORDER BY id').all().map(plain),originals);assert.equal((await bulkCall({action:'finish',importId:id})).status,200);
});
await test('Busy or stolen GCD lease blocks the upload and never releases another operator lease',async()=>{
 const records=[record(1)],{id}=await startBulk(records);sqlite.prepare('UPDATE catalog_sync SET lease_id=?,lease_until=? WHERE id=?').run('busy',now+120000,'gcd');assert.equal((await batch(id,0,records)).status,409);assert.equal(count(),0);sqlite.prepare('UPDATE catalog_sync SET lease_id=?,lease_until=? WHERE id=?').run('',0,'gcd');beforeBatch=()=>sqlite.prepare('UPDATE catalog_sync SET lease_id=?,lease_until=? WHERE id=?').run('stolen',now+120000,'gcd');assert.equal((await batch(id,0,records)).status,409);assert.equal(count(),0);assert.equal(state().lease_id,'stolen');assert.equal((await bulkStatus(id)).data.acceptedRecords,0);
});
await test('Cancellation retains committed rows and receipts but rejects new batches; incomplete checksums never certify completion',async()=>{
 const records=[record(1),record(2)],{id}=await startBulk(records);assert.equal((await batch(id,0,[records[0]])).status,200);assert.equal((await bulkCall({action:'cancel',importId:id})).status,200);assert.equal((await batch(id,1,[records[1]])).status,409);assert.equal((await batch(id,0,[records[0]])).status,200);assert.equal((await bulkCall({action:'finish',importId:id})).status,409);assert.equal(count(),1);
 const second=await startBulk([record(3)],{recordsSha256:'0'.repeat(64)});assert.equal((await batch(second.id,0,[record(3)])).status,200);assert.equal((await bulkCall({action:'finish',importId:second.id})).status,409);assert.equal((await bulkStatus(second.id)).data.stage,'OPEN');
});
await test('Offline JSONL converter sorts unique IDs, protects spreadsheet fields and streams an exact manifest for the actual route uploader',async()=>{
 const temporary=await mkdtemp(path.join(os.tmpdir(),'gcd-codec-test-'));try{const input=path.join(temporary,'input.jsonl'),csv=path.join(temporary,'issues.csv'),manifest=path.join(temporary,'manifest.json');await writeFile(input,[record(2,700,{series_name:'=Formula title',notes:'Grüße <b>recorded</b>'}),record(1)].map(r=>JSON.stringify(r)).join('\n')+'\n');const result=await convertGcdJsonl({input,output:csv,manifest,'snapshot-at':SNAPSHOT,'source-url':'https://www.comics.org/download/','license-acknowledged':'true'});assert.equal(result.records,2);const bytes=await readFile(csv,'utf8');assert.ok(bytes.includes("'=Formula title"));assert.ok(!bytes.includes('excluded.test'));assert.ok(!bytes.includes('"fmv"'));const m=JSON.parse(await readFile(manifest,'utf8'));assert.equal((await preflightCsv(csv,m)).count,2);
  const client=async body=>{const r=await bulkCall(body);return {status:r.status,data:r.data}};const uploaded=await uploadGcdCsv({csv,manifest,action:'upload'},client);assert.equal(uploaded.stage,'COMPLETED');assert.equal(uploaded.acceptedRecords,2);assert.equal(count(),2);assert.equal(uploaded.historicalCoverageComplete,false);
 }finally{await rm(temporary,{recursive:true,force:true})}
});
await test('Converter rejects duplicate/invalid source rows without a partial export and uploader validates the entire CSV before starting',async()=>{
 const temporary=await mkdtemp(path.join(os.tmpdir(),'gcd-invalid-test-'));try{const input=path.join(temporary,'input.jsonl'),csv=path.join(temporary,'issues.csv'),manifest=path.join(temporary,'manifest.json'),opts={input,output:csv,manifest,'snapshot-at':SNAPSHOT,'license-acknowledged':'true'};await writeFile(input,[record(1),record(1)].map(r=>JSON.stringify(r)).join('\n'));await assert.rejects(convertGcdJsonl(opts),/Duplicate/);await assert.rejects(stat(csv));await writeFile(input,JSON.stringify(record(1)));await convertGcdJsonl(opts);await writeFile(csv,(await readFile(csv,'utf8'))+'invalid\n');let called=false;await assert.rejects(uploadGcdCsv({csv,manifest},async()=>{called=true;return {status:200,data:{}}}));assert.equal(called,false);assert.equal(count(),0);
 }finally{await rm(temporary,{recursive:true,force:true})}
});
await test('Bounded CSV upload resumes exact committed batches after its run budget',async()=>{
 const temporary=await mkdtemp(path.join(os.tmpdir(),'gcd-resume-test-'));try{const input=path.join(temporary,'input.jsonl'),csv=path.join(temporary,'issues.csv'),manifest=path.join(temporary,'manifest.json');await writeFile(input,Array.from({length:10},(_,i)=>JSON.stringify(record(i+1))).join('\n'));await convertGcdJsonl({input,output:csv,manifest,'snapshot-at':SNAPSHOT,'license-acknowledged':'true'});const client=async body=>{const r=await bulkCall(body);return {status:r.status,data:r.data}};const partial=await uploadGcdCsv({csv,manifest,'max-batches':'1'},client);assert.equal(partial.acceptedRecords,8);assert.equal(partial.outcome,'run-budget-checkpoint-retained');const complete=await uploadGcdCsv({csv,manifest},client);assert.equal(complete.stage,'COMPLETED');assert.equal(complete.acceptedRecords,10);assert.equal(count(),10);
 }finally{await rm(temporary,{recursive:true,force:true})}
});
await test('Real read-only SQLite CLI to JSONL, CSV and bulk route reconciles active identities and exact catalog detail',async()=>{
 const temporary=await mkdtemp(path.join(os.tmpdir(),'gcd-sqlite-route-test-'));
 try{
  const archive=path.join(temporary,'authorized-fixture.sqlite'),input=path.join(temporary,'issues.jsonl'),adapterReport=path.join(temporary,'adapter-report.json'),csv=path.join(temporary,'issues.csv'),manifest=path.join(temporary,'manifest.json');
  // This is a tiny synthetic supplier-schema archive, never the complete GCD archive.
  const schema=`import sqlite3,sys
db=sqlite3.connect(sys.argv[1])
db.executescript("""
CREATE TABLE gcd_publisher(id INTEGER PRIMARY KEY,name TEXT);
CREATE TABLE gcd_series(id INTEGER PRIMARY KEY,name TEXT,year_began INTEGER,publisher_id INTEGER);
CREATE TABLE gcd_issue(id INTEGER PRIMARY KEY,number TEXT,series_id INTEGER,deleted BOOLEAN,variant_of_id INTEGER,variant_name TEXT,price TEXT,isbn TEXT,publication_date TEXT,cover_image TEXT,fmv_cents INTEGER,owner_email TEXT);
CREATE TABLE gcd_story_type(id INTEGER PRIMARY KEY,name TEXT);
CREATE TABLE gcd_story(id INTEGER PRIMARY KEY,issue_id INTEGER,sequence_number DECIMAL,type_id INTEGER,deleted BOOLEAN,title TEXT,script TEXT,characters TEXT,synopsis TEXT);
INSERT INTO gcd_publisher VALUES(20,'Fixture Publisher');
INSERT INTO gcd_series VALUES(30,'Fixture Series',1998,20);
INSERT INTO gcd_story_type VALUES(40,'comic story');
INSERT INTO gcd_issue VALUES(202,'1B',30,0,101,'Variant B','2.95 USD','9781234567897','October 1998','https://excluded.test/cover.jpg',999999,'PRIVATE_ARCHIVE_SENTINEL');
INSERT INTO gcd_issue VALUES(101,'1',30,0,NULL,'','2.95 USD','9781234567897','October 1998',NULL,999999,'PRIVATE_ARCHIVE_SENTINEL');
INSERT INTO gcd_issue VALUES(303,'2',30,1,NULL,'','2.95 USD',NULL,NULL,NULL,999999,'PRIVATE_ARCHIVE_SENTINEL');
INSERT INTO gcd_story VALUES(1,101,0,40,0,'Archive story','Archive Writer','Archive Hero','Archive synopsis');
INSERT INTO gcd_story VALUES(2,101,1,40,1,'DELETED_STORY','Deleted Writer','Deleted Hero','DELETED_SYNOPSIS');
""")
db.commit();db.close()
`;
  const created=spawnSync('python',['-c',schema,archive],{encoding:'utf8'});assert.equal(created.status,0,created.stderr);
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),before=hash(await readFile(archive));
  const adapted=spawnSync('python',['scripts/gcd_sqlite_to_jsonl.py','--input',archive,'--output',input,'--report',adapterReport,'--snapshot-at',SNAPSHOT],{encoding:'utf8'});assert.equal(adapted.status,0,adapted.stderr||adapted.stdout);
  const evidence=JSON.parse(await readFile(adapterReport,'utf8'));assert.equal(evidence.exportedIssueCount,2);assert.equal(evidence.activeIssueCount,2);assert.equal(evidence.allActiveIssueIdentitiesExported,true);assert.equal(evidence.allBibliographicFieldsExported,false);assert.equal(evidence.fullHistoricalCoverageClaimed,false);assert.equal(evidence.inputModified,false);assert.equal(evidence.inputSha256,before);assert.equal(hash(await readFile(archive)),before);
  const rows=(await readFile(input,'utf8')).trim().split('\n').map(JSON.parse);assert.deepEqual(rows.map(r=>r.api_url),[link('issue',101),link('issue',202)]);assert.equal(rows[1].variant_of,link('issue',101));assert.equal(rows[0].story_set.length,1);
  const converted=await convertGcdJsonl({input,output:csv,manifest,'snapshot-at':SNAPSHOT,'source-sha256':evidence.inputSha256,'license-acknowledged':'true'});assert.equal(converted.records,2);assert.equal(converted.sourceSha256,before);
  const transport=await readFile(csv,'utf8');for(const excluded of ['excluded.test','PRIVATE_ARCHIVE_SENTINEL','DELETED_STORY','DELETED_SYNOPSIS','fmv_cents'])assert.ok(!transport.includes(excluded),excluded);
  await action('pause');const checkpoint=gcdRow();sqlite.prepare('INSERT INTO catalog_sync(id,state) VALUES(?,?)').run('metron','{"ownerPaused":true}');
  const uploaded=await uploadGcdCsv({csv,manifest,action:'upload'},async body=>{const response=await bulkCall(body);return {status:response.status,data:response.data}});
  assert.equal(uploaded.stage,'COMPLETED');assert.equal(uploaded.acceptedRecords,2);assert.equal(uploaded.writtenRecords,2);assert.equal(count(),2);assert.deepEqual(gcdRow(),checkpoint);assert.equal(sqlite.prepare('SELECT state FROM catalog_sync WHERE id=?').get('metron').state,'{"ownerPaused":true}');assert.equal(requests.length,0);
  const overview=(await call(catalogRoute,'GET',null,undefined,'?limit=12&offset=0')).data;assert.equal(overview.issueCount,45);assert.equal(overview.gcdIssueCount,2);
  const search=(await call(catalogRoute,'GET',null,undefined,'?q=Fixture%20Series&limit=12&offset=0')).data;assert.equal(search.total,2);assert.deepEqual(search.issues.map(i=>i.id).sort((a,b)=>a-b),[4000000101,4000000202]);
  const exact=(await call(catalogRoute,'GET',null,undefined,'?id=4000000202')).data.issues[0];assert.equal(exact.id,4000000202);assert.equal(exact.gcdId,202);assert.equal(exact.publisher,'Fixture Publisher');assert.equal(exact.bibliography.variantOf,101);assert.equal(exact.bibliography.originalCoverPrice.text,'2.95 USD');assert.equal(exact.bibliography.originalCoverPrice.kind,'ORIGINAL_COVER_PRICE');assert.equal(exact.cover,undefined);
  const story=(await call(catalogRoute,'GET',null,undefined,'?id=4000000101')).data.issues[0].bibliography.stories[0];assert.equal(story.script,'Archive Writer');assert.equal(story.characters,'Archive Hero');assert.equal(story.synopsis,'Archive synopsis');
 }finally{await rm(temporary,{recursive:true,force:true})}
});
await test('CSV uploader recovers a genuinely committed batch whose response was lost without writing duplicates',async()=>{
 const temporary=await mkdtemp(path.join(os.tmpdir(),'gcd-response-loss-test-'));
 try{
  const input=path.join(temporary,'issues.jsonl'),csv=path.join(temporary,'issues.csv'),manifest=path.join(temporary,'manifest.json');await writeFile(input,Array.from({length:10},(_,i)=>JSON.stringify(record(i+1))).join('\n'));await convertGcdJsonl({input,output:csv,manifest,'snapshot-at':SNAPSHOT,'license-acknowledged':'true'});
  let lost=false;const calls=[];const client=async body=>{calls.push({action:body.action,batchIndex:body.batchIndex});const r=await bulkCall(body);if(body.action==='batch'&&!lost){lost=true;assert.equal(r.status,200);throw Error('Controlled response loss after commit')}return {status:r.status,data:r.data}};
  await assert.rejects(uploadGcdCsv({csv,manifest},client),/response loss/);assert.equal(count(),8);const accepted=sqlite.prepare('SELECT accepted_records,next_batch FROM catalog_gcd_bulk_runs').get();assert.equal(accepted.accepted_records,8);assert.equal(accepted.next_batch,1);
  const recovered=await uploadGcdCsv({csv,manifest},client);assert.equal(recovered.stage,'COMPLETED');assert.equal(recovered.acceptedRecords,10);assert.equal(count(),10);assert.deepEqual(calls.filter(c=>c.action==='batch').map(c=>c.batchIndex),[0,1]);assert.equal(sqlite.prepare('SELECT count(*) n FROM catalog_gcd_bulk_batches').get().n,2);assert.equal(requests.length,0);
 }finally{await rm(temporary,{recursive:true,force:true})}
});
await test('Conflicting provider identity cannot be overwritten by bulk CSV data and leaves its receipt cursor unchanged',async()=>{
 const records=[record(11)],{id}=await startBulk(records);await install(records[0]);sqlite.prepare('UPDATE catalog_issues SET metron_id=? WHERE gcd_id=?').run(11,11);const prior=plain(sqlite.prepare('SELECT * FROM catalog_issues WHERE gcd_id=11').get());
 assert.equal((await batch(id,0,records)).status,409);assert.deepEqual(plain(sqlite.prepare('SELECT * FROM catalog_issues WHERE gcd_id=11').get()),prior);assert.equal((await bulkStatus(id)).data.nextBatch,0);assert.equal((await bulkStatus(id)).data.acceptedRecords,0);assert.equal(sqlite.prepare('SELECT count(*) n FROM catalog_gcd_bulk_batches').get().n,0);assert.equal(requests.length,0);
});
await test('Private upload client sends no Origin/supplier auth, rejects redirects and bounds response bytes without leaking its service credential',async()=>{
 const token='SYNTHETIC_PRIVATE_SITE_TOKEN';let observed;const client=createBulkClient(token,async(url,o)=>{observed={url,o};return json({stage:'OPEN'})});await client({action:'cancel',importId:'0'.repeat(64)});assert.equal(observed.url,'https://comichuddle.aztooeasy.chatgpt.site/api/gcd-bulk');const headers=new Headers(observed.o.headers);assert.equal(headers.get('OAI-Sites-Authorization'),'Bearer '+token);assert.equal(headers.get('Origin'),null);assert.equal(observed.o.redirect,'manual');assert.equal(headers.get('Authorization'),null);await assert.rejects(createBulkClient(token,async()=>new Response('',{status:302,headers:{Location:'https://evil.test/'}}))({action:'cancel',importId:'0'.repeat(64)}));await assert.rejects(createBulkClient(token,async()=>json({},200,{'Content-Length':'65537'}))({action:'cancel',importId:'0'.repeat(64)}));assert.throws(()=>createBulkClient(token,fetch,'https://evil.test'));
});

completed=true;sqlite.close();console.log('GCD bulk catalog results: '+passed+' passed, '+failures.length+' failed');console.log('QA_RESULT '+JSON.stringify({suite:'gcd-bulk',passed,failed:failures.length,maxBinds,genuineProviderRequests:0,failures}));if(failures.length)process.exitCode=1;

