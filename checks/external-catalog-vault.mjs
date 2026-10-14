// Run: node --experimental-vm-modules checks/external-catalog-vault.mjs
// Actual vault/social/media handlers and SQLite. No hosted users or Metron account.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
const root=process.cwd(),sqlite=new DatabaseSync(':memory:');
for(const file of (await readdir('drizzle')).filter(v=>v.endsWith('.sql')).sort())sqlite.exec(await readFile(path.join('drizzle',file),'utf8'));
class Statement{
 constructor(sql,params=[]){this.sql=sql;this.params=params}bind(...params){return new Statement(this.sql,params)}
 async raw(){const s=sqlite.prepare(this.sql);s.setReturnArrays(true);return s.all(...this.params)}
 allSync(){return {results:sqlite.prepare(this.sql).all(...this.params),success:true,meta:{}}}async all(){return this.allSync()}
 async run(){const r=sqlite.prepare(this.sql).run(...this.params);return {results:[],success:true,meta:{changes:r.changes,last_row_id:Number(r.lastInsertRowid)}}}
}
const db={prepare:sql=>new Statement(sql),async batch(statements){sqlite.exec('BEGIN');try{const result=statements.map(s=>s.allSync());sqlite.exec('COMMIT');return result}catch(error){sqlite.exec('ROLLBACK');throw error}}};
const objects=new Map(),bucket={async put(id,value){objects.set(id,new Uint8Array(value))},async delete(ids){for(const id of typeof ids==='string'?[ids]:ids)objects.delete(id)},async get(id){return objects.has(id)?{body:objects.get(id)}:null}};
const env={DB:db,BUCKET:bucket};let activeUser=null;
const context=vm.createContext({console,crypto:webcrypto,Request,Response,Headers,URL,URLSearchParams,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,Error,Date,setTimeout,clearTimeout,fetch:async()=>{throw Error('External lookup forbidden in vault QA')}}),cache=new Map();
function synthetic(id,exports){return new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,value]of Object.entries(exports))this.setExport(key,value)},{context,identifier:id})}
async function moduleFor(spec,parent=''){
 if(spec==='cloudflare:workers'){if(!cache.has(spec))cache.set(spec,synthetic(spec,{env}));return cache.get(spec)}
 if(!spec.startsWith('.')&&!spec.startsWith('/')){if(!cache.has(spec))cache.set(spec,synthetic(spec,await import(spec)));return cache.get(spec)}
 let file=path.resolve(parent?path.dirname(parent):root,spec);if(!path.extname(file)){try{await readFile(file+'.ts');file+='.ts'}catch{file=path.join(file,'index.ts')}}if(cache.has(file))return cache.get(file);
 if(file.endsWith('/app/chatgpt-auth.ts')){const m=synthetic(file,{getChatGPTUser:async()=>activeUser});cache.set(file,m);return m}
 const code=ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText,m=new vm.SourceTextModule(code,{context,identifier:file});cache.set(file,m);return m;
}
async function route(file){const m=await moduleFor(path.join(root,file));if(m.status==='unlinked')await m.link((s,p)=>moduleFor(s,p.identifier));if(m.status==='linked')await m.evaluate();return m.namespace}
const vault=await route('app/api/vault/route.ts'),social=await route('app/api/social/route.ts'),media=await route('app/api/media/route.ts'),metron=await route('lib/metron-directory.ts');
const alice={userId:'external_alice',email:'external_alice@example.test',displayName:'External collector'},bob={userId:'external_bob',email:'external_bob@example.test',displayName:'Other collector'};
const empty={profile:'External collector',books:[],wants:[],posts:[],likes:[],tradeBookIds:[],clubs:[],watchlist:[],tradeDrafts:[]},plain=value=>JSON.parse(JSON.stringify(value));
const normalized=metron.sanitizeMetronIssue({id:321,series:{name:'External Series',year_began:2020,volume:1},number:'7',publisher:{name:'Independent'},credits:[]});assert.ok(normalized);
const book={id:'physical-copy-321',...plain(metron.metronPersonalEntry(normalized))};
function reset(){for(const {name}of sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()){assert.match(name,/^[a-z_0-9]+$/);sqlite.exec('DELETE FROM "'+name+'"')}objects.clear()}
async function call(api,method,user,body,query='',etag){activeUser=user;const headers=method==='POST'?{'Content-Type':'application/json',Origin:'https://comichuddle.test'}:{};if(etag)headers['If-Match']=etag;const response=await api[method](new Request('https://comichuddle.test/api/'+query,{method,headers,body:method==='POST'?JSON.stringify(body):undefined}));let data=null;try{data=await response.json()}catch{}return {status:response.status,data,etag:response.headers.get('etag')};}
async function profile(user){const r=await call(social,'POST',user,{action:'profile',handle:user.userId,name:user.displayName,bio:'Collector',tagline:'Comics',location:'Test City',favorite:'Comics',since:2020,color:'red',featured:[],visible:true,dmOpen:true,accept:true});assert.equal(r.status,200,JSON.stringify(r.data))}
async function save(value,user=alice,etag){const version=etag||(await call(vault,'GET',user)).etag;return call(vault,'POST',user,value,'',version)}
const stored=()=>sqlite.prepare('SELECT data,revision FROM collections WHERE user_id=?').get(alice.userId);
let passed=0,completed=false;const failures=[];
process.on('beforeExit',()=>{if(!completed){console.error('External-catalog vault suite did not finish');process.exitCode=1}});
async function test(name,run){reset();let timer;try{await Promise.race([run(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Case timed out after10 seconds')),10000)})]);passed++;console.log('PASS: '+name)}catch(error){failures.push({name,message:error.message});console.error('FAIL: '+name+' — '+error.message)}finally{clearTimeout(timer)}}
await test('Actual vault round-trip and account export preserve external provenance without inventing a local valuation link',async()=>{
 await profile(alice);await profile(bob);activeUser=alice;const upload=await media.POST(new Request('https://comichuddle.test/api/media',{method:'POST',headers:{Origin:'https://comichuddle.test','Content-Type':'image/jpeg'},body:await readFile('public/covers/planet-12.jpg')}));assert.equal(upload.status,200);const photoId=(await upload.json()).id;
 const ownCopy={...book,grade:'Raw VF (self reported)',price:250,photoId};const saved=await save({...empty,books:[ownCopy],tradeBookIds:[ownCopy.id]});assert.equal(saved.status,200,JSON.stringify(saved.data));const read=await call(vault,'GET',alice);assert.deepEqual(read.data.books,[ownCopy]);assert.equal(read.data.books[0].catalogId,undefined);assert.equal(read.etag,saved.etag);
 const exported=await call(social,'GET',alice,null,'?kind=export');assert.equal(exported.status,200);assert.deepEqual(exported.data.collection.books,[ownCopy]);assert.equal((await call(vault,'GET',bob)).data,null);
 const again=await save({...read.data,books:[{...read.data.books[0],price:300}]},alice,read.etag);assert.equal(again.status,200);assert.deepEqual((await call(vault,'GET',alice)).data.books[0].externalCatalog,book.externalCatalog);assert.equal((await call(vault,'GET',alice)).data.books[0].photoId,photoId);
});
await test('Actual vault rejects invalid external IDs, provider/license, source URLs and secret fields without replacing the saved collection',async()=>{
 await profile(alice);assert.equal((await save({...empty,books:[book]})).status,200);const before=stored();
 for(const change of [{id:0},{id:2147483648},{id:'321'},{provider:'ComicVine'},{license:'Unlicensed'},{sourceUrl:'https://evil.test/issue/321/'},{sourceUrl:'https://metron.cloud/issue/322/'},{sourceUrl:'https://metron.cloud:443/issue/321/'},{sourceUrl:'https://metron.cloud/issue/321/?token=secret'},{token:'secret'}]){const bad=await save({...empty,books:[{...book,externalCatalog:{...book.externalCatalog,...change}}]});assert.equal(bad.status,400,JSON.stringify(bad.data));assert.deepEqual(stored(),before)}
});
await test('Conflicting external and starter identities fail atomically while separate linked and manual copies remain compatible',async()=>{
 await profile(alice);const local={id:'local-copy',title:'Saga',issue:'#1',grade:'Raw VF',price:10,catalogId:4},unlinked={id:'manual-copy',title:'My independent comic',issue:'#2',grade:'Condition not recorded',price:0};assert.equal((await save({...empty,books:[book,local,unlinked]})).status,200);const before=stored();
 for(const conflicted of [{...book,catalogId:4},{...local,externalCatalog:book.externalCatalog}]){const bad=await save({...empty,books:[conflicted]});assert.equal(bad.status,400,JSON.stringify(bad.data));assert.deepEqual(stored(),before)}
 const read=await call(vault,'GET',alice);assert.equal(read.data.books[0].catalogId,undefined);assert.equal(read.data.books[1].externalCatalog,undefined);assert.equal(read.data.books[2].externalCatalog,undefined);assert.equal(read.data.books[2].catalogId,undefined);
});
completed=true;sqlite.close();console.log('\nExternal catalog vault results: '+passed+' passed, '+failures.length+' failed.');if(failures.length){console.error(JSON.stringify(failures,null,2));process.exitCode=1;}
