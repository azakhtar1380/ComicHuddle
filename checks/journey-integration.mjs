// Run: node --experimental-vm-modules checks/journey-integration.mjs
// Actual route/Drizzle integrations with isolated SQLite, synthetic trusted identity and R2.
// This is not hosted browser E2E, OAuth, native signup, shipping or payment execution.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';

const root=process.cwd(),sqlite=new DatabaseSync(':memory:');
for(const file of (await readdir(path.join(root,'drizzle'))).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(await readFile(path.join(root,'drizzle',file),'utf8'));
let beforeExecute=null,beforeBatch=null;
class Statement{
 constructor(sql,params=[]){this.sql=sql;this.params=params}
 bind(...params){return new Statement(this.sql,params)}
 allSync(){beforeExecute?.(this.sql,this.params);return {results:sqlite.prepare(this.sql).all(...this.params),success:true,meta:{}}}
 async raw(){beforeExecute?.(this.sql,this.params);const stmt=sqlite.prepare(this.sql);stmt.setReturnArrays(true);return stmt.all(...this.params)}
 async all(){return this.allSync()}
 async run(){beforeExecute?.(this.sql,this.params);const result=sqlite.prepare(this.sql).run(...this.params);return {results:[],success:true,meta:{changes:result.changes,last_row_id:Number(result.lastInsertRowid)}}}
}
const db={prepare:sql=>new Statement(sql),async batch(statements){await beforeBatch?.(statements);sqlite.exec('BEGIN');try{const results=statements.map(s=>s.allSync());sqlite.exec('COMMIT');return results}catch(error){sqlite.exec('ROLLBACK');throw error}}};
const objects=new Map(),bucket={async put(k,b){objects.set(k,new Uint8Array(b))},async delete(keys){for(const key of typeof keys==='string'?[keys]:keys)objects.delete(key)},async get(k){const body=objects.get(k);return body?{body}:null}};
let activeUser=null;const context=vm.createContext({console,crypto:webcrypto,Request,Response,URL,URLSearchParams,AbortController,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,Error,Date,setTimeout,clearTimeout}),cache=new Map();
function synthetic(id,exports){return new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,value]of Object.entries(exports))this.setExport(key,value)},{context,identifier:id})}
async function moduleFor(spec,parent=''){
 if(spec==='cloudflare:workers'){if(!cache.has(spec))cache.set(spec,synthetic(spec,{env:{DB:db,BUCKET:bucket}}));return cache.get(spec)}
 if(!spec.startsWith('.')&&!spec.startsWith('/')){if(!cache.has(spec))cache.set(spec,synthetic(spec,await import(spec)));return cache.get(spec)}
 let file=path.resolve(parent?path.dirname(parent):root,spec);if(!path.extname(file)){try{await readFile(file+'.ts');file+='.ts'}catch{file=path.join(file,'index.ts')}}
 if(cache.has(file))return cache.get(file);
 if(file.endsWith('/app/chatgpt-auth.ts')){const mod=synthetic(file,{getChatGPTUser:async()=>activeUser});cache.set(file,mod);return mod}
 const code=ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText,mod=new vm.SourceTextModule(code,{context,identifier:file});cache.set(file,mod);return mod;
}
async function route(file){const m=await moduleFor(path.join(root,file));if(m.status==='unlinked')await m.link((s,p)=>moduleFor(s,p.identifier));if(m.status==='linked')await m.evaluate();return m.namespace}
const social=await route('app/api/social/route.ts'),vault=await route('app/api/vault/route.ts'),care=await route('app/api/pressing/route.ts'),media=await route('app/api/media/route.ts'),directory=await route('app/api/catalog/route.ts');
const catalog=(await route('lib/catalog.ts')).catalog,empty=(await route('lib/vault.ts')).emptyVault('Journey collector'),rules=(await route('lib/community.ts')).previewRulesVersion;
const {issueIdentity}=await route('lib/shared-catalog.ts');
const owner={userId:'d185d22d-62d4-475e-87ac-fa2039a5d360',email:'owner@example.test',displayName:'Owner'},photo=await readFile(path.join(root,'public/covers/planet-12.jpg'));
let sequence=0,passed=0;const failures=[];
async function test(name,run){try{await run();assert.equal(sqlite.prepare('SELECT count(*) AS n FROM operation_guard').get().n,0,'Transient transaction guards remain');passed++;console.log('PASS: '+name)}catch(error){failures.push({name,message:error.message});console.error('FAIL: '+name+' — '+error.message)}finally{beforeExecute=null;beforeBatch=null}}
async function call(r,method,user,body,query='',extraHeaders={}){
 activeUser=user;const headers=method==='POST'?{Origin:'https://comichuddle.test','Content-Type':'application/json',...extraHeaders}:extraHeaders;
 if(r===vault&&method==='POST'&&!headers['If-Match'])headers['If-Match']=(await vault.GET()).headers.get('etag');
 const res=await r[method](new Request('https://comichuddle.test/api/'+query,{method,headers,body:method==='POST'?JSON.stringify(body):undefined}));
 let data;try{data=await res.json()}catch{data=null}return {status:res.status,data,headers:res.headers};
}
const get=(u,q='')=>call(social,'GET',u,null,q),post=(u,b)=>call(social,'POST',u,b),careGet=(u,q='')=>call(care,'GET',u,null,q),carePost=(u,b)=>call(care,'POST',u,b);
const expectStatus=(r,status)=>assert.equal(r.status,status,JSON.stringify(r.data));
function identity(prefix){const n=++sequence;return {userId:'journey_'+prefix+'_'+n,email:prefix+n+'@example.test',displayName:prefix+' '+n}}
function profileFields(u,overrides={}){return {action:'profile',handle:'j_'+u.userId.split('_').at(-1)+'_'+u.userId.slice(8).split('_')[0].slice(0,16),name:u.displayName,bio:'My comic journey',tagline:'Every copy has a story.',location:'Test City, MN',favorite:'Saga',since:2020,color:'teal',featured:[],visible:true,dmOpen:true,accept:true,...overrides}}
async function actor(prefix){const u=identity(prefix);expectStatus(await post(u,profileFields(u)),200);return {u,p:(await get(u)).data.me}}
function book(id=webcrypto.randomUUID(),record=catalog[4],overrides={}){return {id,title:record.title,issue:'#'+record.number,grade:'Raw VF',price:12345.67,catalogId:record.id,...overrides}}
async function save(a,books){const r=await call(vault,'POST',a.u,{...empty,books});expectStatus(r,200);return r}
async function upload(a){activeUser=a.u;const r=await media.POST(new Request('https://comichuddle.test/api/media',{method:'POST',headers:{Origin:'https://comichuddle.test','Content-Type':'image/jpeg'},body:photo}));assert.equal(r.status,200);return (await r.json()).id}
function providerFields(overrides={}){return {action:'provider',name:'Journey Pressing Studio',bio:'Independent pressing and dry cleaning. Assess each copy first.',location:'Test City, MN',services:['pressing','dry_cleaning','assessment','cgc'],prices:{pressing:1500,dry_cleaning:500,assessment:null,cgc:null},specialties:'Modern comic books',experienceSince:2019,turnaroundMin:7,turnaroundMax:21,mailIn:true,dropoff:true,accepting:true,visible:true,submissionMode:'prepare_only',dealerReference:'',dealerAttest:false,website:'https://studio.example.test',logoId:null,portfolio:[],shippingAddress:'PRIVATE PROVIDER INTAKE ADDRESS',shippingNotes:'PRIVATE PROVIDER INTAKE NOTES',terms:'Written scope and agreed payment. No grade improvement guaranteed.',attest:true,...overrides}}
async function studio(prefix,fields={}){const a=await actor(prefix);expectStatus(await carePost(a.u,providerFields(fields)),200);return {...a,provider:(await careGet(a.u)).data.mine}}
const requestFields=(providerId,bookIds,overrides={})=>({action:'request',providerId,bookIds,declaredValues:Object.fromEntries(bookIds.map(id=>[id,25000])),services:['pressing'],notes:'Please assess the spine.',sendToCgc:false,method:'mail',scopeConsent:true,...overrides});
const quoteFields=(jobId,overrides={})=>({action:'quote',jobId,fee:1500,returnShipping:900,cgcEstimate:0,quoteDays:14,quoteNotes:'Press suitable bends only; no restoration. Arrange payment directly.',revision:0,...overrides});
const approvalFields=(jobId,overrides={})=>({action:'approve',jobId,revision:1,returnAddress:'PRIVATE COLLECTOR RETURN ADDRESS',riskConsent:true,termsConsent:true,cgcConsent:false,...overrides});
const stageFields=(jobId,status,overrides={})=>({action:'stage',jobId,status,note:'Accurate participant update.',photos:[],carrier:'USPS',tracking:'ISOLATED-TEST-ONLY',submissionRef:'',...overrides});
const detail=(a,id)=>careGet(a.u,'?kind=job&id='+id);
async function requested(prefix,options={}){const s=await studio(prefix+'press',options.studio),a=await actor(prefix+'read'),b=book();await save(a,[b]);const r=await carePost(a.u,requestFields(s.provider.id,[b.id],options.request));expectStatus(r,200);return {s,a,b,id:r.data.jobId,threadId:r.data.threadId}}
async function quoted(prefix,options={}){const flow=await requested(prefix,options);expectStatus(await carePost(flow.s.u,quoteFields(flow.id)),200);return flow}
async function approved(prefix,options={}){const flow=await quoted(prefix,options);expectStatus(await carePost(flow.a.u,approvalFields(flow.id)),200);return flow}
function eventFailure(){let hit=false;beforeExecute=q=>{if(/^insert\s+into\s+["`]?care_events["`]?\s/i.test(q)){beforeExecute=null;hit=true;throw Error('QA injected event storage failure')}};return ()=>assert.ok(hit,'Expected care timeline write was not reached')}

// Extract the actual form payload handlers. FormData/event are controlled input
// adapters; collection writes still cross the real vault API and Drizzle.
const formSource=await readFile('app/add-comic.tsx','utf8'),formAst=ts.createSourceFile('app/add-comic.tsx',formSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),submitters=new Map();
for(const declaration of formAst.statements){if(!ts.isFunctionDeclaration(declaration)||!declaration.name||!['AddComicForm','OwnedComicForm'].includes(declaration.name.text))continue;
 function find(node){if(ts.isJsxAttribute(node)&&node.name.getText(formAst)==='onSubmit'&&node.initializer&&ts.isJsxExpression(node.initializer)&&node.initializer.expression)submitters.set(declaration.name.text,node.initializer.expression.getText(formAst));ts.forEachChild(node,find)}find(declaration);
}
assert.equal(submitters.size,2,'Missing actual comic form handlers');
async function submitComic(a,kind,fields,options={}){
 const current=(await call(vault,'GET',a.u)).data||empty,formState={errors:[],saved:0,attempts:0,prevented:false,draft:null};
 class Inputs{constructor(record){this.record=record}get(key){return this.record[key]??null}}
 const ctx=vm.createContext({crypto:webcrypto,FormData:Inputs,issueIdentity,vault:current,selected:options.selected??null,manual:options.manual??false,listed:options.listed??false,copy:options.copy||current.books.find(b=>b.id===options.bookId),bookId:options.bookId,setError:value=>formState.errors.push(value),onSaved:()=>formState.saved++,commit:async draft=>{formState.attempts++;formState.draft=draft;return (await call(vault,'POST',a.u,draft,'',options.headers||{})).status===200}});
 vm.runInContext(ts.transpileModule('globalThis.submit = '+submitters.get(kind),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText,ctx);
 await ctx.submit({currentTarget:fields,preventDefault(){formState.prevented=true}});assert.ok(formState.prevented);return formState;
}

await test('A new signed-in collector sees an empty account and must create a profile before saving or registering a studio',async()=>{
 const u=identity('fresh');expectStatus(await get(u),200);assert.equal((await get(u)).data.me,null);assert.equal((await call(vault,'GET',u)).data,null);
 expectStatus(await call(vault,'POST',u,{...empty,books:[book()]}),403);expectStatus(await carePost(u,providerFields()),403);
 expectStatus(await post(u,profileFields(u,{accept:false})),400);expectStatus(await post(u,profileFields(u)),200);
 const d=(await get(u)).data;assert.equal(d.me.consent.version,rules);assert.ok(d.me.consent.acceptedAt);expectStatus(await call(vault,'POST',u,empty),200);
});
await test('Collector handles, consent receipts and featured ownership survive real create/edit/export requests',async()=>{
 const a=await actor('profile'),b=await actor('peer'),copy=book();await save(a,[copy]);expectStatus(await post(a.u,profileFields(a.u,{featured:[copy.id],accept:false})),200);
 expectStatus(await post(b.u,profileFields(b.u,{handle:a.p.handle})),409);expectStatus(await post(b.u,profileFields(b.u,{featured:[copy.id]})),400);
 const own=(await get(a.u)).data.me,other=(await get(b.u,'?kind=profile&handle='+own.handle)).data;assert.equal(own.showcase[0].price,undefined);assert.equal(other.consent,undefined);
 const exported=(await get(a.u,'?kind=export')).data;assert.equal(exported.collection.books[0].price,copy.price);assert.equal(exported.consent.version,rules);assert.ok(exported.consent.acceptedAt);
});
await test('Catalog search and exact selection preserve series, edition, key information and honest starter coverage',async()=>{
 const r=await call(directory,'GET',null,null,'?q=Saga%20%231&limit=12&offset=0');expectStatus(r,200);assert.equal(r.data.scope,'starter');assert.equal(r.data.issueCount,catalog.length);
 assert.ok(r.data.issues.length);for(const item of r.data.issues){assert.equal(item.series,item.title);assert.equal(item.issue,'#1');assert.ok(item.edition);assert.ok(item.keyInfo.kind);assert.equal(item.keyInfo.note,item.note);assert.ok(item.source);if(item.cover){assert.ok(item.coverSource);assert.ok(item.coverCredit)}}
 const found=r.data.issues[0],exact=await call(directory,'GET',null,null,'?id='+found.id);expectStatus(exact,200);assert.equal(exact.data.issues[0].id,found.id);
 const first=await call(directory,'GET',null,null,'?q=&limit=1&offset=0'),next=await call(directory,'GET',null,null,'?q=&limit=1&offset=1');expectStatus(first,200);assert.equal(first.data.hasMore,true);assert.notEqual(first.data.issues[0].id,next.data.issues[0].id);
});
await test('Malformed or conflicting catalog queries return controlled errors without silently selecting an issue',async()=>{
 for(const q of ['?q=a&q=b','?id=4&q=Saga','?id=not-a-number','?limit=0','?limit=31','?offset=-1','?offset=1.5','?q='+encodeURIComponent('x'.repeat(161))])expectStatus(await call(directory,'GET',null,null,q),400);
 expectStatus(await call(directory,'GET',null,null,'?id=999999'),404);const miss=await call(directory,'GET',null,null,'?q=nonexistent_journey_series');expectStatus(miss,200);assert.equal(miss.data.total,0);assert.deepEqual(miss.data.issues,[]);
});
await test('The actual picker client consumes the real catalog search route response before a collector selects a record',async()=>{
 const client=await route('lib/catalog-picker-client.ts'),session=client.createCatalogSearchSession(async url=>directory.GET(new Request('https://comichuddle.test'+url))),page=await session.search('Saga #1');assert.ok(page);assert.equal(page.scope,'starter');assert.equal(page.issueCount,catalog.length);assert.ok(page.issues.some(i=>i.id===4));assert.equal(page.issues.find(i=>i.id===4).variant,catalog[4].variant);session.cancel();
});
await test('Selected directory copies save canonical identity with private estimate, photo and version intact',async()=>{
 const a=await actor('selected'),id=await upload(a),record=catalog[10],copy=book('my-exact-copy',record,{title:record.title.toLowerCase(),issue:' '+record.number+' ',photoId:id}),r=await save(a,[copy]);assert.ok(r.headers.get('etag'));
 const loaded=await call(vault,'GET',a.u);assert.equal(loaded.headers.get('etag'),r.headers.get('etag'));assert.equal(loaded.data.books[0].title,record.title);assert.equal(loaded.data.books[0].issue,'#'+record.number);assert.equal(loaded.data.books[0].price,copy.price);assert.equal(loaded.data.books[0].photoId,id);assert.equal(loaded.data.books[0].id,copy.id);
});
await test('Mismatched or unknown directory selections fail without overwriting the collector’s existing save',async()=>{
 const a=await actor('wrongcopy'),copy=book();const saved=await save(a,[copy]);for(const candidate of [{...copy,title:'Wrong edition title'},{...copy,issue:'#99999'},{...copy,catalogId:999999}])expectStatus(await call(vault,'POST',a.u,{...empty,books:[candidate]}),400);
 const loaded=await call(vault,'GET',a.u);assert.equal(loaded.headers.get('etag'),saved.headers.get('etag'));assert.equal(loaded.data.books[0].catalogId,copy.catalogId);
});
await test('Legacy mismatched directory links remain readable but cannot create a false sale or reciprocal trade',async()=>{
 const a=await actor('legacyidentity'),b=await actor('legacytrade'),photoId=await upload(a),copy=book(),peer=book(undefined,catalog[24]);await save(a,[{...copy,photoId}]);expectStatus(await call(vault,'POST',b.u,{...empty,books:[peer],wants:[10],tradeBookIds:[peer.id]}),200);
 const legacy={...empty,books:[{...copy,photoId,catalogId:10}],wants:[24],tradeBookIds:[copy.id]};sqlite.prepare('UPDATE collections SET data=?,revision=? WHERE user_id=?').run(JSON.stringify(legacy),webcrypto.randomUUID(),a.u.userId);expectStatus(await call(vault,'GET',a.u),200);
 expectStatus(await post(a.u,{action:'listing',kind:'single',saleType:'fixed',bookIds:[copy.id],conditions:{[copy.id]:{mode:'Raw',grade:'8.0',label:'Raw',printing:'First printing'}},description:'Copy with a legacy link requiring correction.',price:2500,shipping:700,photos:[photoId],cert:'',attest:true,usaAttest:true}),400);
 expectStatus(await post(a.u,{action:'swipe',to:b.p.id,giveId:copy.id,getId:peer.id,direction:'like'}),400);assert.equal((await get(a.u)).data.listings.some(l=>l.sellerId===a.p.id),false);assert.equal((await get(a.u)).data.threads.length,0);
});
await test('Manual personal records remain unlinked, and physical duplicate issues have distinct owned-copy IDs',async()=>{
 const a=await actor('manual'),manual=book('manual-copy');delete manual.catalogId;const twins=[book('physical-one'),book('physical-two')];await save(a,[manual,...twins]);const data=(await call(vault,'GET',a.u)).data;assert.equal(data.books[0].catalogId,undefined);assert.equal(data.books.length,3);assert.notEqual(data.books[1].id,data.books[2].id);
 expectStatus(await call(vault,'POST',a.u,{...empty,books:[twins[0],twins[0]]}),400);
});
await test('Actual Add Comic selection submits one exact API issue and trade choice through a conditional vault save',async()=>{
 const a=await actor('formpick'),search=await call(directory,'GET',null,null,'?q=Saga%20%231'),selected=search.data.issues.find(i=>i.title==='Saga');assert.ok(selected);
 const result=await submitComic(a,'AddComicForm',{title:'Ignored free text',issue:'#999',grade:'Raw VF',price:'12.34',trade:'on'},{selected});assert.equal(result.saved,1);assert.equal(result.attempts,1);
 const stored=(await call(vault,'GET',a.u)).data;assert.equal(stored.books[0].catalogId,selected.id);assert.equal(stored.books[0].title,selected.title);assert.equal(stored.books[0].issue,'#'+selected.number);assert.equal(stored.books[0].price,12.34);assert.deepEqual(stored.tradeBookIds,[stored.books[0].id]);
});
await test('Actual manual Add Comic submits a personal record without inferring directory identity',async()=>{
 const a=await actor('formmanual'),result=await submitComic(a,'AddComicForm',{title:'  Saga  ',issue:' #1 second printing ',grade:'  Raw VF  ',price:'30.5'},{manual:true,selected:catalog[4]});assert.equal(result.saved,1);
 const stored=(await call(vault,'GET',a.u)).data.books[0];assert.equal(stored.catalogId,undefined);assert.equal(stored.title,'Saga');assert.equal(stored.issue,'#1 second printing');assert.equal(stored.grade,'Raw VF');
});
await test('Actual Add Comic refuses an empty directory selection before invoking storage',async()=>{
 const a=await actor('formempty'),result=await submitComic(a,'AddComicForm',{grade:'Raw',price:'0'});assert.equal(result.attempts,0);assert.equal(result.saved,0);assert.match(result.errors.at(-1),/Choose an issue/);assert.equal((await call(vault,'GET',a.u)).data,null);
});
await test('Actual Add Comic keeps its completion callback pending after a stale save conflict',async()=>{
 const a=await actor('formstale');await save(a,[]);const result=await submitComic(a,'AddComicForm',{grade:'Raw',price:'1'},{selected:catalog[4],headers:{'If-Match':'"empty"'}});assert.equal(result.attempts,1);assert.equal(result.saved,0);assert.equal((await call(vault,'GET',a.u)).data.books.length,0);
});
await test('Actual owned-copy directory edit retains copy/photo/price identity and updates the exact edition',async()=>{
 const a=await actor('formedit'),photoId=await upload(a),copy=book('edit-owned-copy',catalog[4],{photoId});await save(a,[copy]);const selected=catalog[24],result=await submitComic(a,'OwnedComicForm',{grade:'Raw VG',price:'40.25'},{bookId:copy.id,selected});assert.equal(result.saved,1);
 const saved=(await call(vault,'GET',a.u)).data.books[0];assert.equal(saved.id,copy.id);assert.equal(saved.photoId,photoId);assert.equal(saved.catalogId,selected.id);assert.equal(saved.title,selected.title);assert.equal(saved.price,40.25);
});
await test('Actual owned-copy manual edit removes an old directory link, and a listed copy is protected before storage',async()=>{
 const a=await actor('formunlink'),copy=book();await save(a,[copy]);const result=await submitComic(a,'OwnedComicForm',{title:'Saga',issue:'#1 variant unlisted',grade:'Raw VG',price:'20'},{bookId:copy.id,manual:true});assert.equal(result.saved,1);assert.equal((await call(vault,'GET',a.u)).data.books[0].catalogId,undefined);
 const prevented=await submitComic(a,'OwnedComicForm',{title:'Changed again',issue:'#999',grade:'Raw',price:'1'},{bookId:copy.id,manual:true,listed:true});assert.equal(prevented.attempts,0);assert.equal(prevented.saved,0);assert.match(prevented.errors.at(-1),/Withdraw or cancel/);
});
await test('Studio registration requires collector discovery and messages, then updates one owned listing',async()=>{
 const a=await actor('role');expectStatus(await post(a.u,profileFields(a.u,{dmOpen:false})),200);expectStatus(await carePost(a.u,providerFields()),400);
 expectStatus(await post(a.u,profileFields(a.u,{visible:false,dmOpen:true})),200);expectStatus(await carePost(a.u,providerFields()),400);
 expectStatus(await post(a.u,profileFields(a.u)),200);expectStatus(await carePost(a.u,providerFields()),200);const first=(await careGet(a.u)).data.mine;
 expectStatus(await carePost(a.u,providerFields({name:'Updated owned studio',prices:{pressing:1700,dry_cleaning:500,assessment:null,cgc:null}})),200);const own=(await careGet(a.u)).data.mine;assert.equal(own.id,first.id);assert.equal(own.name,'Updated owned studio');assert.equal((await careGet(a.u)).data.providers.filter(p=>p.profileId===a.p.id).length,1);
});
await test('Studio registration rejects invalid scope, intake, dealer claims and foreign portfolio photos',async()=>{
 const a=await actor('scope'),b=await actor('foreign'),foreignPhoto=await upload(b);
 for(const fields of [{turnaroundMin:21,turnaroundMax:7},{mailIn:false,dropoff:false},{shippingAddress:''},{submissionMode:'none'},{submissionMode:'dealer',dealerAttest:false},{prices:{unoffered:1000}}])expectStatus(await carePost(a.u,providerFields(fields)),400);
 expectStatus(await carePost(a.u,providerFields({logoId:foreignPhoto})),403);const own=await upload(a);expectStatus(await carePost(a.u,providerFields({logoId:own,portfolio:[{before:own,after:own,caption:'My authorized example'}]})),200);
});
await test('Paused and hidden studios preserve owned management while refusing new requests and private address disclosure',async()=>{
 const s=await studio('paused'),a=await actor('visitor'),copy=book();await save(a,[copy]);expectStatus(await carePost(s.u,providerFields({accepting:false})),200);
 const p=(await careGet(a.u)).data.providers.find(p=>p.id===s.provider.id);assert.equal(p.accepting,false);assert.equal(p.shippingAddress,undefined);assert.equal(p.shippingNotes,undefined);expectStatus(await carePost(a.u,requestFields(p.id,[copy.id])),400);
 expectStatus(await carePost(s.u,providerFields({visible:false})),200);assert.equal((await careGet(a.u)).data.providers.some(p=>p.id===s.provider.id),false);expectStatus(await careGet(a.u,'?kind=provider&id='+s.provider.id),404);expectStatus(await careGet(s.u,'?kind=provider&id='+s.provider.id),200);
});
await test('A quoted care request keeps provider intake details locked in both normal reads and account export',async()=>{
 const f=await quoted('privacy');const job=(await detail(f.a,f.id)).data.job;assert.equal(job.shippingAddress,'');assert.equal(job.shippingNotes,'');
 const exported=(await get(f.a.u,'?kind=export')).data,stored=exported.careJobs.find(j=>j.id===f.id);assert.equal(stored.shippingAddress,'','Unaccepted provider intake address escaped through account export');assert.equal(stored.shippingNotes,'');
});
await test('Mail-in care records freeze quote terms, unlock accepted addresses and complete with a private timeline',async()=>{
 const f=await approved('custody');expectStatus(await carePost(f.s.u,providerFields({terms:'New future terms; do not rewrite the accepted quote.'})),200);
 let result=(await detail(f.a,f.id)).data;assert.equal(result.job.shippingAddress,'PRIVATE PROVIDER INTAKE ADDRESS');assert.match(result.job.termsSnapshot,/Written scope/);assert.equal(result.job.returnAddress,'PRIVATE COLLECTOR RETURN ADDRESS');assert.equal(result.job.books[0].price,undefined);
 expectStatus(await carePost(f.a.u,stageFields(f.id,'in_transit')),200);expectStatus(await carePost(f.s.u,stageFields(f.id,'received')),200);expectStatus(await carePost(f.s.u,stageFields(f.id,'pressing')),200);expectStatus(await carePost(f.s.u,stageFields(f.id,'returning')),200);expectStatus(await carePost(f.a.u,stageFields(f.id,'completed')),200);
 result=(await detail(f.a,f.id)).data;assert.equal(result.job.status,'completed');assert.deepEqual(result.events.map(e=>e.status),['requested','quoted','approved','in_transit','received','pressing','returning','completed']);const stranger=await actor('outsider');expectStatus(await detail(stranger,f.id),404);
});
await test('Local drop-off skips carrier shipment and return charges without skipping collector receipt',async()=>{
 const f=await approved('dropoff',{request:{method:'dropoff'}});assert.equal((await detail(f.a,f.id)).data.job.returnShipping,0);expectStatus(await carePost(f.a.u,stageFields(f.id,'in_transit')),400);expectStatus(await carePost(f.s.u,stageFields(f.id,'received')),200);
 expectStatus(await carePost(f.s.u,stageFields(f.id,'returning',{note:'Assessment found fragile paper; agreed to return without pressing.',carrier:'',tracking:''})),200);expectStatus(await carePost(f.s.u,stageFields(f.id,'completed')),403);expectStatus(await carePost(f.a.u,stageFields(f.id,'completed')),200);
});
await test('Requests reject unavailable books, foreign copies, duplicate selections and unoffered service or intake',async()=>{
 const s=await studio('requestscope',{services:['pressing'],prices:{pressing:1000},submissionMode:'none',dropoff:false}),a=await actor('asker'),copy=book();await save(a,[copy]);
 for(const fields of [{bookIds:['not-owned']},{bookIds:[copy.id,copy.id]},{services:['dry_cleaning']},{method:'dropoff'},{services:['cgc'],sendToCgc:true}])expectStatus(await carePost(a.u,requestFields(s.provider.id,[copy.id],fields)),400);
});
await test('Review badges distinguish member experience from completed custody, edits remain one review and deletion belongs to the author',async()=>{
 const s=await studio('review'),a=await actor('reviewer'),other=await actor('reviewpeer'),review={action:'review',providerId:s.provider.id,rating:4,quality:4,communication:5,timeliness:3,title:'My independent experience',body:'I used the studio and am describing my own experience.',attest:true};
 expectStatus(await carePost(s.u,review),403);expectStatus(await carePost(a.u,review),200);expectStatus(await carePost(a.u,{...review,rating:5,title:'Updated experience'}),200);
 const result=(await careGet(a.u,'?kind=provider&id='+s.provider.id)).data;assert.equal(result.provider.reviewCount,1);assert.equal(result.provider.rank,null);assert.equal(result.reviews[0].completedRequest,false);assert.equal(result.reviews[0].rating,5);
 expectStatus(await carePost(other.u,{action:'delete_review',reviewId:result.reviews[0].id}),404);expectStatus(await carePost(a.u,{action:'delete_review',reviewId:result.reviews[0].id}),200);assert.equal((await careGet(a.u,'?kind=provider&id='+s.provider.id)).data.provider.reviewCount,0);
});
await test('Two simultaneous quote revisions preserve one current quote and one matching timeline receipt',async()=>{
 const f=await requested('quoterace');const results=await Promise.all([carePost(f.s.u,quoteFields(f.id,{fee:1700})),carePost(f.s.u,quoteFields(f.id,{fee:1800}))]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);const d=(await detail(f.a,f.id)).data;assert.equal(d.job.quoteRevision,1);assert.equal(d.events.filter(e=>e.status==='quoted').length,1);
});
await test('Accepting a quote while the provider revises it cannot accept stale terms or lose a successful revision',async()=>{
 const f=await quoted('approverace');const results=await Promise.all([carePost(f.a.u,approvalFields(f.id)),carePost(f.s.u,quoteFields(f.id,{revision:1,fee:3000}))]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);const d=(await detail(f.a,f.id)).data;
 if(d.job.status==='approved'){assert.equal(d.job.quoteRevision,1);assert.equal(d.job.fee,1500);assert.equal(d.events.filter(e=>e.status==='approved').length,1)}else{assert.equal(d.job.status,'quoted');assert.equal(d.job.quoteRevision,2);assert.equal(d.job.fee,3000);assert.equal(d.events.filter(e=>e.status==='approved').length,0)}
});
await test('Concurrent custody updates preserve one current stage and one matching event',async()=>{
 const f=await approved('stagerace');expectStatus(await carePost(f.s.u,stageFields(f.id,'received')),200);const results=await Promise.all([carePost(f.s.u,stageFields(f.id,'pressing')),carePost(f.s.u,stageFields(f.id,'returning',{note:'Assessment found fragile pages; returning without additional treatment.'}))]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);const d=(await detail(f.a,f.id)).data;assert.equal(d.events.filter(e=>['pressing','returning'].includes(e.status)).length,1);assert.equal(d.events.at(-1).status,d.job.status);
});
await test('Care-request storage failure cannot create an orphan job without its initial custody receipt',async()=>{
 const s=await studio('requestfault'),a=await actor('requestfaultread'),copy=book();await save(a,[copy]);const hit=eventFailure();const result=await carePost(a.u,requestFields(s.provider.id,[copy.id]));hit();assert.ok(result.status>=400);assert.equal((await careGet(a.u)).data.jobs.length,0,'Failed request left a committed job');assert.equal((await get(a.u)).data.threads.length,0,'Failed care request left a new orphan conversation');
});
for(const operation of ['quote','approve','stage'])await test('A '+operation+' timeline-write failure rolls back the associated custody change',async()=>{
 const f=operation==='quote'?await requested('failquote'):operation==='approve'?await quoted('failapprove'):await approved('failstage'),before=(await detail(f.a,f.id)).data;
 const hit=eventFailure(),result=await carePost(operation==='approve'?f.a.u:f.s.u,operation==='quote'?quoteFields(f.id):operation==='approve'?approvalFields(f.id):stageFields(f.id,'received'));hit();assert.ok(result.status>=400);
 const after=(await detail(f.a,f.id)).data;assert.equal(after.job.status,before.job.status,'Failed timeline write committed a new custody state');assert.equal(after.job.quoteRevision,before.job.quoteRevision);assert.equal(after.events.length,before.events.length);
});
for(const role of ['provider','collector'])await test('Account deletion for the '+role+' racing with quote acceptance preserves accepted custody and both participants',async()=>{
 const f=await quoted('deleterace'+role),deleting=role==='provider'?f.s:f.a;let fired=false;beforeBatch=async statements=>{if(!statements.some(s=>/^delete\s+from\s+["`]?profiles["`]?\s/i.test(s.sql)))return;beforeBatch=null;fired=true;expectStatus(await carePost(f.a.u,approvalFields(f.id)),200)};
 const removed=await post(deleting.u,{action:'delete_my_data',confirm:'DELETE'});assert.ok(fired,'Accepted-custody race was not injected');expectStatus(removed,409);assert.ok((await get(deleting.u)).data.me);const d=await detail(f.a,f.id);expectStatus(d,200);assert.equal(d.data.job.status,'approved');
});
await test('Provider deletion cleans a newly arriving unaccepted request and message even when preliminary reads were empty',async()=>{
 const s=await studio('latecleanup'),a=await actor('latecustomer'),copy=book();await save(a,[copy]);let raced=null;
 beforeBatch=async statements=>{if(!statements.some(s=>/^delete\s+from\s+["`]?profiles["`]?\s/i.test(s.sql)))return;beforeBatch=null;const asked=await carePost(a.u,requestFields(s.provider.id,[copy.id]));expectStatus(asked,200);raced=asked.data;expectStatus(await post(a.u,{action:'message',threadId:raced.threadId,body:'Private initial assessment question.'}),200)};
 expectStatus(await post(s.u,{action:'delete_my_data',confirm:'DELETE'}),200);assert.ok(raced,'Incoming-request race was not injected');
 const remaining={jobs:sqlite.prepare('SELECT COUNT(*) AS n FROM care_jobs WHERE id=?').get(raced.jobId).n,events:sqlite.prepare('SELECT COUNT(*) AS n FROM care_events WHERE job_id=?').get(raced.jobId).n,threads:sqlite.prepare('SELECT COUNT(*) AS n FROM threads WHERE id=?').get(raced.threadId).n,messages:sqlite.prepare('SELECT COUNT(*) AS n FROM messages WHERE thread_id=?').get(raced.threadId).n};assert.deepEqual(remaining,{jobs:0,events:0,threads:0,messages:0},'Deletion stranded private records written after its preliminary reads');
});
await test('An ordinary fixed-price sale supports offers and private messaging but cannot claim a paid purchase',async()=>{
 const s=await actor('fixedsale'),buyer=await actor('fixedbuyer'),copy=book(),photoId=await upload(s);await save(s,[{...copy,photoId}]);const listed=await post(s.u,{action:'listing',kind:'single',saleType:'fixed',bookIds:[copy.id],conditions:{[copy.id]:{mode:'Raw',grade:'8.0',label:'Raw',printing:'First printing'}},description:'Own physical copy; disclose all defects.',price:2500,shipping:700,photos:[photoId],cert:'',attest:true,usaAttest:true});expectStatus(listed,200);
 const id=listed.data.listingId,offered=await post(buyer.u,{action:'offer',listingId:id,amount:2300,note:'Please confirm the spine condition.'});expectStatus(offered,200);expectStatus(await post(buyer.u,{action:'message',threadId:offered.data.threadId,body:'Is the spine intact?'}),200);const pending=(await get(s.u)).data.offers.find(o=>o.listingId===id);expectStatus(await post(s.u,{action:'offer_response',offerId:pending.id,status:'accepted'}),200);
 const checkout=await post(buyer.u,{action:'buy',listingId:id});expectStatus(checkout,503);assert.equal(checkout.data.code,'payment_setup_required');assert.match(checkout.data.error,/No payment or order was created/);const record=(await get(s.u,'?kind=listing&id='+id)).data;assert.equal(record.status,'active');assert.equal(record.auction,null);expectStatus(await post(s.u,{action:'withdraw_listing',listingId:id}),200);
});
await test('A provider moderation hold removes discovery while preserving existing private custody and condition photos',async()=>{
 const f=await approved('providerhold'),photoId=await upload(f.s);expectStatus(await carePost(f.s.u,stageFields(f.id,'received',{photos:[photoId]})),200);const reporter=await actor('holdreport');expectStatus(await post(reporter.u,{action:'report',targetType:'care_provider',targetId:f.s.provider.id,reason:'Isolated provider moderation exercise'}),200);
 const report=(await get(owner,'?kind=reports')).data.reports.find(r=>r.targetId===f.s.provider.id);assert.ok(report);expectStatus(await post(owner,{action:'review_report',reportId:report.id,remove:true}),200);assert.equal((await careGet(f.a.u)).data.providers.some(p=>p.id===f.s.provider.id),false);expectStatus(await carePost(f.s.u,providerFields()),403);
 expectStatus(await carePost(f.s.u,stageFields(f.id,'returning',{note:'Returning the accepted customer property after the moderation hold.'})),200);expectStatus(await carePost(f.a.u,stageFields(f.id,'completed')),200);activeUser=f.a.u;assert.equal((await media.GET(new Request('https://comichuddle.test/api/media?id='+photoId))).status,200);expectStatus(await post(f.s.u,{action:'delete_my_data',confirm:'DELETE'}),200);
});

console.log('\nJourney integration results: '+passed+' passed, '+failures.length+' failed.');
if(failures.length){console.error(JSON.stringify(failures,null,2));process.exitCode=1}
