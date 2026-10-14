// Run: node --experimental-vm-modules checks/gcd-sync.mjs
// Actual D1-schema SQLite, Drizzle, route and importer; synthetic supplier HTTP,
// owner identities and clock. Genuine GCD access is recorded separately.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';

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

await test('Migration is additive, installs through hosted physical lines and preserves legacy provider IDs',async()=>{
 const name='0012_gcd_central_catalog.sql',check=new DatabaseSync(':memory:');try{for(const prior of migrations.filter(m=>m<name))check.exec(await readFile(path.join('drizzle',prior),'utf8'));check.prepare('INSERT INTO catalog_issues(id,metron_id,title,number,publisher,year,era,kind,search_text,data,fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(1000000050,50,'Prior','1','Prior',2000,'Modern','Comic','prior','{}','2020-01-01T00:00:00Z');for(const line of (await readFile(path.join('drizzle',name),'utf8')).split(/\r?\n/).filter(l=>l.trim()))check.exec(line);assert.equal(check.prepare('SELECT metron_id FROM catalog_issues WHERE id=1000000050').get().metron_id,50);assert.equal(check.prepare('SELECT gcd_id FROM catalog_issues WHERE id=1000000050').get().gcd_id,null)}finally{check.close()}
 const {readMigrationFiles}=await import('drizzle-orm/migrator');assert.ok(readMigrationFiles({migrationsFolder:'drizzle'}).at(12).sql.every(s=>s.trim()));
 assert.notEqual(shared.gcdDirectoryId(50),shared.metronDirectoryId(50));assert.equal(shared.sharedProviderIdentity(4000000050).provider,'GCD');assert.equal(shared.sharedProviderIdentity(1000000050).provider,'Metron');assert.equal(shared.sharedProviderIdentity(42),null);
});
await test('Owner and private service authorization, Origin, JSON and bounded body fail before supplier writes',async()=>{
 for(const [method,user,headers,status] of [['GET',null,{},401],['GET',member,{},403],['POST',member,{},403],['POST',owner,{Origin:null},403],['POST',owner,{Origin:'https://evil.test'},403]])assert.equal((await call(route,method,user,{action:'daily_step'},'',{headers})).status,status);
 for(const [body,query,headers,rawBody,status] of [[{action:'daily_step',token:TOKEN},'',{},undefined,400],[{action:'x'},'',{},undefined,400],[{action:'daily_step'},'?x=1',{},undefined,400],[{action:'daily_step'},'',{'Content-Type':'text/plain'},undefined,415],[null,'',{},'null',400],[{},'',{},'{',400],[{},'',{'Content-Length':'1'},'x'.repeat(2001),413]])assert.equal((await call(route,'POST',owner,body,query,{headers,rawBody})).status,status);
 assert.equal(state(),null);assert.equal(requests.length,0);
 const svc={'x-comichuddle-catalog-run':'owner-private-service',Origin:null};assert.equal((await call(route,'POST',null,{action:'pause'},'',{headers:svc})).status,401);env.METRON_PRIVATE_SERVICE_ENABLED='true';assert.equal((await call(route,'POST',null,{action:'pause'},'',{headers:svc})).status,200);assert.equal((await call(route,'POST',null,{action:'pause'},'',{headers:{...svc,Origin:''}})).status,401);assert.equal((await call(route,'POST',member,{action:'resume'},'',{headers:svc})).status,403);
 const status=await call();assert.match(status.headers.get('Cache-Control'),/no-store/);assert.ok(!JSON.stringify(status.data).includes(TOKEN));assert.equal(status.data.historicalCoverageComplete,false);
});
await test('Known and unknown bibliographic dates, stories and original face prices retain attribution without artwork or FMV',async()=>{
 const normalized=gcd.normalizeGcdIssue(record(50),new ServerDate().toISOString());assert.equal(normalized.issue.id,4000000050);assert.equal(normalized.issue.year,1999);assert.equal(normalized.issue.bibliography.keyDate,'1999-00-00');assert.equal(normalized.issue.bibliography.originalCoverPrice.kind,'ORIGINAL_COVER_PRICE');assert.equal(normalized.issue.bibliography.stories[1].synopsis,'Recorded story synopsis.');assert.equal(normalized.issue.writer,'A. Writer');assert.equal(normalized.issue.coverArtist,'Cover Artist');assert.ok(!JSON.stringify(normalized).includes('excluded.test'));assert.ok(!('fmv' in normalized.issue));assert.equal(gcd.gcdYear('unknown'),0);assert.equal(gcd.normalizeGcdIssue(record(51,700,{key_date:null,indicia_publisher:null}),new ServerDate().toISOString()).issue.publisher,'Publisher not recorded');
 await install(record(50));const detail=await call(catalogRoute,'GET',null,undefined,'?id=4000000050');assert.equal(detail.status,200);assert.equal(picker.parseCatalogSearchPage(detail.data).issues[0].bibliography.stories[1].synopsis,'Recorded story synopsis.');const search=await call(catalogRoute,'GET',null,undefined,'?q=Synthetic&limit=12');assert.equal(search.status,200);assert.equal(search.data.issues[0].bibliography,undefined);assert.equal(search.data.gcdIssueCount,1);assert.equal(search.data.syncedIssueCount,0);assert.match(search.data.gcdCoverage,/Partial/);assert.equal(requests.length,0);
});
await test('Two-week paginated release import is resumable, bounded, exact and has no publisher/series fanout',async()=>{
 const records=[1,2,3,4].map(id=>record(id));providerHandler=provider(records,{current:records.slice(0,3).map(r=>r.api_url),previous:records.slice(2).map(r=>r.api_url)});
 const final=await complete();assert.equal(final.data.daily.checked,5);assert.equal(final.data.importedIssueCount,4);assert.deepEqual(plain(final.data.daily.expectedCounts),[3,2]);assert.equal(requests.length,7);assert.ok(requests.every(r=>!new URL(r.url).pathname.startsWith('/api/series/')));assert.equal(state().lease_id,'');assert.equal(state().value.requestTimes.length,7);assert.equal(env.METRON_API_TOKEN,TOKEN);assert.equal(env.METRON_SYNC_ENABLED,'true');
 assert.deepEqual(sqlite.prepare('SELECT id,gcd_id,metron_id FROM catalog_issues WHERE gcd_id IS NOT NULL ORDER BY gcd_id').all().map(plain),records.map((r,i)=>({id:4000000001+i,gcd_id:1+i,metron_id:null})));const before=requests.length;assert.equal((await step()).data.daily.stage,'complete');assert.equal(requests.length,before,'Completed daily run refetched on the same UTC day');
});
await test('First GCD import preserves all 43 starter IDs and keeps both catalogs searchable without Metron initialization',async()=>{
 providerHandler=provider([record(1)]);await complete();const starters=sqlite.prepare('SELECT id,data,fetched_at FROM catalog_issues WHERE id BETWEEN 0 AND 42 ORDER BY id').all().map(plain);assert.deepEqual(starters.map(r=>r.id),Array.from({length:43},(_,i)=>i));assert.equal(sqlite.prepare('SELECT count(*) n FROM catalog_issues').get().n,44);assert.equal(sqlite.prepare('SELECT count(*) n FROM catalog_sync WHERE id=?').get('metron').n,0);assert.equal(env.METRON_API_TOKEN,TOKEN);assert.equal(env.METRON_SYNC_ENABLED,'true');
 const old=await call(catalogRoute,'GET',null,undefined,'?q=Spider-Man%20%23300&limit=12'),fresh=await call(catalogRoute,'GET',null,undefined,'?q=Synthetic&limit=12');assert.equal(old.status,200);assert.ok(old.data.issues.some(i=>i.id<43&&i.number==='300'));assert.equal(fresh.status,200);assert.equal(fresh.data.issues[0].id,4000000001);assert.equal(fresh.data.issueCount,44);assert.equal(fresh.data.gcdIssueCount,1);assert.equal(fresh.data.syncedIssueCount,0);
 now+=86400000;await complete();assert.deepEqual(sqlite.prepare('SELECT id,data,fetched_at FROM catalog_issues WHERE id BETWEEN 0 AND 42 ORDER BY id').all().map(plain),starters);assert.equal(sqlite.prepare('SELECT count(*) n FROM catalog_issues').get().n,44);
});
await test('Next-day recent release checks update existing metadata without changing directory IDs',async()=>{
 providerHandler=provider([record(1)]);await complete();const old=sqlite.prepare('SELECT id,fetched_at FROM catalog_issues WHERE gcd_id=1').get();now+=86400000;providerHandler=provider([record(1,700,{notes:'Corrected source description'})]);await complete();const updated=sqlite.prepare('SELECT id,fetched_at,data FROM catalog_issues WHERE gcd_id=1').get();assert.equal(updated.id,old.id);assert.ok(updated.fetched_at>old.fetched_at);assert.equal(JSON.parse(updated.data).note,'Corrected source description');assert.equal(count(),1);
});
await test('Pause and explicit resume preserve the checkpoint and never consume supplier budget while paused',async()=>{
 providerHandler=provider([record(1)]);await action('pause');const before=state().value;const r=await step();assert.equal(r.data.pausedByOwner,true);assert.equal(requests.length,0);assert.deepEqual(state().value,before);await action('resume');await complete();assert.equal(count(),1);
});
await test('Provider 429 reserves the attempted call and preserves numeric and date Retry-After across invocations',async()=>{
 providerHandler=()=>json({detail:'Throttled'},429,{'Retry-After':'120'});let r=await step();assert.equal(r.status,429);assert.equal(r.headers.get('Retry-After'),'120');assert.equal(state().value.requestTimes.length,1);assert.equal(state().value.daily.page,1);r=await step();assert.equal(r.status,429);assert.equal(requests.length,1);now+=121000;providerHandler=()=>json({},429,{'Retry-After':new ServerDate(now+300000).toUTCString()});r=await step();assert.equal(r.status,429);assert.equal(r.headers.get('Retry-After'),'300');assert.equal(requests.length,2);now+=301000;providerHandler=provider([]);await complete();assert.equal(state().value.error,null);
});
await test('Rolling shared 26-per-hour budget stops before supplier throttle and survives clock boundaries',async()=>{
 providerHandler=provider([record(1)]);await action('pause');await action('resume');setState(s=>{s.requestTimes=Array.from({length:26},(_,i)=>now-1000+i)});let r=await step();assert.equal(r.status,429);assert.equal(requests.length,0);assert.ok(Number(r.headers.get('Retry-After'))>=3599);now+=3601001;r=await step();assert.equal(r.status,200,JSON.stringify(r.data));assert.ok(requests.length<=3);assert.ok(state().value.requestTimes.length<=3);
});
await test('Anonymous access refusal fails closed without a token fallback or credential disclosure',async()=>{
 providerHandler=()=>json({detail:TOKEN},403);const r=await step();assert.equal(r.status,424);assert.equal(count(),0);assert.equal(state().value.daily.stage,'importing');assert.equal(state().value.daily.page,1);assert.equal(requests.length,1);assert.ok(!JSON.stringify(r.data).includes(TOKEN));assert.ok(!JSON.stringify(state()).includes(TOKEN));
});
await test('Supplier redirects, HTML, malformed UTF-8 and schema drift keep the pending checkpoint unchanged',async()=>{
 for(const response of [()=>new Response('',{status:302,headers:{Location:'https://evil.test/'}}),()=>new Response('<html>blocked</html>',{headers:{'Content-Type':'text/html'}}),()=>new Response(new Uint8Array([255]),{headers:{'Content-Type':'application/json'}}),()=>json({count:1,next:null,results:[{api_url:link('issue',1),series:'https://evil.test/api/series/700/'}]})]){providerHandler=response;const r=await step();assert.ok([502,503].includes(r.status));assert.equal(count(),0);assert.equal(state().value.daily.page,1);assert.equal(state().value.daily.pending.length,0);now+=60000}
});
await test('Provider identities and pagination cannot change origin, accept format overrides or skip pages',async()=>{
 for(const unsafe of ['https://evil.test/api/issue/1/','https://www.comics.org/api/issue/1/?format=json','https://user@www.comics.org/api/issue/1/','https://www.comics.org/api/issue/0/','https://www.comics.org/api/issue/2147483648/'])assert.throws(()=>gcd.gcdProviderId(unsafe,'issue'));
 providerHandler=provider([]);await complete();
 for(const next of ['https://evil.test/api/series/?page=2','https://www.comics.org/api/series/?page=3','https://www.comics.org/api/series/?page=2&format=json','https://www.comics.org/api/issue/?page=2']){providerHandler=provider([],{seriesRows:[series(700,[])],seriesResponse:b=>json({...b,count:2,next})});const r=await step('backfill_step');assert.equal(r.status,502);assert.equal(sqlite.prepare('SELECT count(*) n FROM catalog_gcd_series').get().n,0);assert.equal(state().value.backfill.page,1);now+=60000}
 assert.deepEqual(plain(gcd.isoWeek(Date.parse('2021-01-01T12:00:00Z'))),{year:2020,week:53});assert.deepEqual(plain(gcd.isoWeek(Date.parse('2026-12-31T12:00:00Z'))),{year:2026,week:53});
});
await test('Declared and actual response byte bounds reject oversized provider streams before catalog writes',async()=>{
 providerHandler=()=>json({},200,{'Content-Length':String(gcd.GCD_BOUNDS.responseBytes+1)});assert.equal((await step()).status,502);assert.equal(count(),0);now+=60000;let canceled=false;providerHandler=()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(gcd.GCD_BOUNDS.responseBytes));c.enqueue(new Uint8Array(1))},cancel(){canceled=true}}),{headers:{'Content-Type':'application/json','Content-Length':'1'}});assert.equal((await step()).status,502);assert.equal(canceled,true);assert.equal(count(),0);
});
await test('Atomic catalog batch failure rolls back the issue and consumed cursor; retry uses the same identity',async()=>{
 providerHandler=provider([record(1)]);failBatch=s=>s.sql.startsWith('insert into "catalog_issues"')&&s.params.includes(4000000001);let r=await step();assert.equal(r.status,503);assert.equal(count(),0);assert.equal(state().value.daily.pending[0].id,1);assert.equal(state().value.daily.checked,0);assert.equal(sqlite.prepare('SELECT count(*) n FROM catalog_gcd_seen WHERE kind=?').get('issue').n,0);now+=60000;await complete();assert.equal(count(),1);assert.equal(sqlite.prepare('SELECT id FROM catalog_issues WHERE gcd_id=1').get().id,4000000001);
});
await test('Lease theft rejects catalog writes atomically and cannot release the other operator lease',async()=>{
 providerHandler=provider([record(1)],{detailResponse:r=>{beforeBatch=()=>sqlite.prepare('UPDATE catalog_sync SET lease_id=?,lease_until=? WHERE id=?').run('other-owner-lease',now+120000,'gcd');return json(r)}});const r=await step();assert.equal(r.status,409);assert.equal(count(),0);assert.equal(state().lease_id,'other-owner-lease');assert.equal(state().value.daily.checked,0);assert.equal(state().value.daily.pending[0].id,1);assert.equal((await action('resume')).status,409);
});
await test('Historical series-to-issue backfill pages and its unique manifest remain separate from daily and Metron state',async()=>{
 const records=[record(1,700),record(2,700),record(3,701)];providerHandler=provider(records,{current:[link('issue',1)],seriesRows:[series(700,[1,2]),series(701,[3]),series(702,[])],pageSize:2});
 await complete();const dailyRun=state().value.daily.runId;sqlite.prepare('INSERT INTO catalog_sync(id,state) VALUES(?,?)').run('metron','{"legacy":"unchanged"}');const final=await complete('backfill_step');assert.equal(final.data.backfill.expectedSeriesCount,3);assert.equal(final.data.backfill.observedSeriesCount,3);assert.equal(final.data.backfill.processedSeriesCount,3);assert.equal(final.data.backfill.checkedIssues,3);assert.equal(count(),3);assert.equal(final.data.historicalCoverageComplete,false);assert.equal(final.data.artworkImported,false);assert.equal(final.data.valuationImported,false);assert.equal(sqlite.prepare('SELECT state FROM catalog_sync WHERE id=?').get('metron').state,'{"legacy":"unchanged"}');assert.equal(state().value.daily.runId,dailyRun);
 const backfillRun=state().value.backfill.runId;now+=86400000;await complete();assert.equal(sqlite.prepare('SELECT count(*) n FROM catalog_gcd_seen WHERE run_id=? AND kind=?').get(backfillRun,'series').n,3);assert.equal(sqlite.prepare('SELECT count(*) n FROM catalog_gcd_seen WHERE run_id=? AND kind=?').get(backfillRun,'issue').n,3);
});
await test('Empty series cannot create unbounded SQL work in a single historical step',async()=>{
 providerHandler=provider([],{seriesRows:Array.from({length:50},(_,i)=>series(i+1,[])),pageSize:50});await complete();const before=prepared,external=requests.length,r=await step('backfill_step');assert.equal(r.status,200);assert.equal(requests.length-external,1);assert.equal(r.data.backfill.observedSeriesCount,50);assert.ok(r.data.backfill.processedSeriesCount<=gcd.GCD_BOUNDS.progressPerStep);assert.ok(prepared-before<200,'Empty series caused unbounded query work');await complete('backfill_step');assert.equal(count(),0);
});
await test('A removed upstream issue is counted unavailable and retains earlier imported metadata without fabricated replacement',async()=>{
 await install(record(1),'2020-01-01T00:00:00Z');providerHandler=provider([],{current:[link('issue',1)]});const final=await complete();assert.equal(final.data.daily.unavailable,1);assert.equal(final.data.importedIssueCount,1);assert.equal(sqlite.prepare('SELECT fetched_at FROM catalog_issues WHERE gcd_id=1').get().fetched_at,'2020-01-01T00:00:00.000Z');assert.equal(final.data.historicalCoverageComplete,false);
});
await test('Weekly count mismatch reconciles only that manifest and preserves validated catalog data',async()=>{
 providerHandler=provider([record(1)],{listResponse:b=>json({...b,count:2})});let r=await step();assert.equal(r.status,502);assert.equal(count(),1);assert.equal(state().value.daily.weekIndex,0);assert.equal(state().value.daily.page,1);assert.equal(state().value.daily.pending.length,0);assert.equal(sqlite.prepare('SELECT count(*) n FROM catalog_gcd_seen').get().n,0);providerHandler=provider([record(1)]);await complete();assert.equal(count(),1);
});
await test('Historical count mismatch starts a reconciled pass while preserving imported records',async()=>{
 providerHandler=provider([record(1)],{current:[],seriesRows:[series(700,[1])],seriesResponse:b=>json({...b,count:2})});await complete();const first=await step('backfill_step');assert.equal(first.status,502);assert.equal(count(),1);const next=state().value.backfill;assert.equal(next.page,1);assert.equal(next.stage,'importing');assert.equal(next.checkedIssues,0);assert.equal(sqlite.prepare('SELECT count(*) n FROM catalog_gcd_seen').get().n,0);providerHandler=provider([record(1)],{seriesRows:[series(700,[1])]});const final=await complete('backfill_step');assert.equal(final.data.backfill.processedSeriesCount,1);assert.equal(final.data.historicalCoverageComplete,false);
});
await test('Recent daily refresh receives priority and historical work yields until the current sweep completes',async()=>{
 providerHandler=provider([record(1)]);let r=await step('backfill_step');assert.equal(r.data.backfill.deferredForRecentRefresh,true);assert.equal(requests.length,0);assert.equal(state().value.backfill.stage,'idle');await complete();r=await step('backfill_step');assert.equal(r.data.backfill.deferredForRecentRefresh,false);now+=86400000;const before=requests.length;r=await step('backfill_step');assert.equal(r.data.backfill.deferredForRecentRefresh,true);assert.equal(requests.length,before);
});
await test('Summary series pages fetch one exact series detail and resume its issue offset under the same call budget',async()=>{
 providerHandler=provider([record(1),record(2)],{current:[],seriesRows:[series(700,[1,2])],summarySeries:true});await complete();const before=requests.length,first=await step('backfill_step');assert.equal(first.status,200,JSON.stringify(first.data));assert.equal(requests.length-before,3);assert.equal(count(),1);assert.equal(first.data.backfill.currentSeries,700);assert.equal(first.data.backfill.issueOffset,1);const final=await complete('backfill_step');assert.equal(final.data.backfill.processedSeriesCount,1);assert.equal(final.data.backfill.checkedIssues,2);assert.equal(requests.filter(r=>new URL(r.url).pathname==='/api/series/700/').length,1);assert.equal(count(),2);
});
await test('Returned issue IDs and series IDs must match the queued identity before a central upsert',async()=>{
 providerHandler=provider([record(1)],{detailResponse:()=>json(record(2))});assert.equal((await step()).status,502);assert.equal(count(),0);assert.equal(state().value.daily.pending[0].id,1);now+=60000;providerHandler=provider([record(1)],{detailResponse:()=>json(record(1,999))});assert.equal((await step()).status,502);assert.equal(count(),0);assert.equal(state().value.daily.pending[0].seriesId,700);
});

completed=true;sqlite.close();console.log('GCD central catalog results: '+passed+' passed, '+failures.length+' failed');console.log('QA_RESULT '+JSON.stringify({suite:'gcd-sync',passed,failed:failures.length,maxBinds,genuineProviderRequests:0,failures}));if(failures.length)process.exitCode=1;
