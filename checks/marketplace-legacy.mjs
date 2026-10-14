// Run: node --experimental-vm-modules checks/marketplace-legacy.mjs
// Tests real route code and Drizzle against in-memory SQLite; no hosted records are modified.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
const root=process.cwd(),sqlite=new DatabaseSync(':memory:'),repoRequire=createRequire(path.join(root,'package.json'));
for(const file of (await readdir(path.join(root,'drizzle'))).filter(f=>f.endsWith('.sql')&&f<'0006').sort())sqlite.exec(await readFile(path.join(root,'drizzle',file),'utf8'));
let beforeExecute=null,beforeBatch=null;
class Statement{
 constructor(sql,params=[]){this.sql=sql;this.params=params}
 bind(...args){return new Statement(this.sql,args)}
 async raw(){beforeExecute?.(this.sql,this.params);const s=sqlite.prepare(this.sql);s.setReturnArrays(true);return s.all(...this.params)}
 allSync(){beforeExecute?.(this.sql,this.params);const s=sqlite.prepare(this.sql);return {results:s.all(...this.params),success:true,meta:{}}}
 async all(){return this.allSync()}
 async run(){beforeExecute?.(this.sql,this.params);const r=sqlite.prepare(this.sql).run(...this.params);return {results:[],success:true,meta:{changes:r.changes,last_row_id:Number(r.lastInsertRowid)}}}
}
const objects=new Map();const bucket={async put(k,b){objects.set(k,new Uint8Array(b))},async delete(keys){for(const key of typeof keys==='string'?[keys]:keys)objects.delete(key)},async get(k){const v=objects.get(k);return v?{body:v}:null}};
const db={prepare:q=>new Statement(q),async batch(statements){beforeBatch?.(statements);sqlite.exec('BEGIN');try{const result=statements.map(s=>s.allSync());sqlite.exec('COMMIT');return result}catch(e){sqlite.exec('ROLLBACK');throw e}}};
let activeUser=null;const env={DB:db,BUCKET:bucket};
const clock={now:Date.now()};
class ServerDate extends Date{constructor(...args){super(...(args.length?args:[clock.now]))}static now(){return clock.now}}
const context=vm.createContext({console,crypto:webcrypto,Request,Response,URL,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,Error,Date:ServerDate,setTimeout,clearTimeout});const cache=new Map();
function synthetic(id,exports){const names=Object.keys(exports);return new vm.SyntheticModule(names,function(){for(const key of names)this.setExport(key,exports[key])},{context,identifier:id})}
async function moduleFor(spec,parent=''){
 if(spec==='cloudflare:workers'){if(!cache.has(spec))cache.set(spec,synthetic(spec,{env}));return cache.get(spec)}
 if(!spec.startsWith('.')&&!spec.startsWith('/')){if(!cache.has(spec))cache.set(spec,synthetic(spec,await import(repoRequire.resolve(spec))));return cache.get(spec)}
 let file=path.resolve(parent?path.dirname(parent):root,spec);if(!path.extname(file)){try{await readFile(file+'.ts');file+='.ts'}catch{file=path.join(file,'index.ts')}}
 if(cache.has(file))return cache.get(file);
 if(file.endsWith('/app/chatgpt-auth.ts')){const mod=synthetic(file,{getChatGPTUser:async()=>activeUser});cache.set(file,mod);return mod}
 const code=ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;const mod=new vm.SourceTextModule(code,{context,identifier:file});cache.set(file,mod);return mod;
}
async function route(file){const m=await moduleFor(path.join(root,file));if(m.status==='unlinked')await m.link((s,p)=>moduleFor(s,p.identifier));if(m.status==='linked')await m.evaluate();return m.namespace}
const social=await route('app/api/social/route.ts'),vault=await route('app/api/vault/route.ts'),media=await route('app/api/media/route.ts'),care=await route('app/api/pressing/route.ts');
const catalog=(await route('lib/catalog.ts')).catalog;const matcher=await route('lib/grailmatch.ts');
const alice={userId:'alice',email:'alice@example.test',displayName:'Alice'},bob={userId:'bob',email:'bob@example.test',displayName:'Bob'},eve={userId:'eve',email:'eve@example.test',displayName:'Eve'},owner={userId:'d185d22d-62d4-475e-87ac-fa2039a5d360',email:'owner@example.test',displayName:'Owner'};
async function call(r,method,user,body,query='',origin='https://comichuddle.test'){
 clock.now++;activeUser=user;const headers=method==='POST'?{'Origin':origin,'Content-Type':'application/json'}:{};
 // Most fixtures model an ordinary save with its current version. Conflict tests bypass this helper.
 if(r===vault&&method==='POST'){const current=await vault.GET();headers['If-Match']=current.headers.get('etag')||'"empty"'}
 const req=new Request('https://comichuddle.test/api/'+query,{method,headers,body:method==='POST'?JSON.stringify(body):undefined});const res=await r[method](req);let data;try{data=await res.json()}catch{data=null}return {status:res.status,data,headers:Object.fromEntries(res.headers)};
}
const get=(user,query='')=>call(social,'GET',user,null,query);
const post=(user,body)=>call(social,'POST',user,body);
const makeProfile=(user,handle)=>post(user,{action:'profile',handle,name:user.displayName,bio:'Collector',tagline:'My shelf. My universe.',location:'Test City',favorite:'Comics',since:2020,color:'red',featured:[],visible:true,dmOpen:true,accept:true});
const empty={profile:'Collector',books:[],wants:[],posts:[],likes:[],tradeBookIds:[],clubs:[],watchlist:[],tradeDrafts:[]};

const values=await route('app/api/values/route.ts');
const failures=[];let passed=0,sequence=0;
async function test(name,run){try{await run();if(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='operation_guard'").get())assert.equal(sqlite.prepare('SELECT count(*) AS n FROM operation_guard').get().n,0);passed++;console.log('PASS: '+name)}catch(error){failures.push({name,message:error.message});console.error('FAIL: '+name+' — '+error.message)}finally{beforeExecute=null;beforeBatch=null}}
const statusIn=(r,expected)=>assert.ok(expected.includes(r.status),'Expected '+expected.join('/')+', received '+r.status+': '+JSON.stringify(r.data));
async function collector(prefix){sequence++;const u={userId:'market_'+prefix+'_'+sequence,email:prefix+sequence+'@example.test',displayName:'Market '+prefix};assert.equal((await makeProfile(u,prefix+sequence)).status,200);return {u,p:(await get(u)).data.me}}
const photo=await readFile(path.join(root,'public/covers/planet-12.jpg'));
async function upload(u){activeUser=u;const r=await media.POST(new Request('https://comichuddle.test/api/media',{method:'POST',headers:{Origin:'https://comichuddle.test','Content-Type':'image/jpeg'},body:photo}));assert.equal(r.status,200);return (await r.json()).id}
const cgc={mode:'CGC',grade:'9.8',label:'Universal',printing:'First printing'};
const raw={mode:'Raw',grade:'8.0',label:'Raw',printing:'First printing'};
function copy(id,issueId=10,condition=cgc,photoId){const issue=catalog[issueId];return {id,title:issue.title,issue:'#'+issue.number,grade:condition?.mode==='Raw'?'Raw VF':'CGC 9.8',price:765432.1,catalogId:issueId,...(condition?{condition}:{}),...(photoId?{photoId}:{})}}
async function save(u,books){const r=await call(vault,'POST',u,{...empty,books});assert.equal(r.status,200,JSON.stringify(r.data))}
async function seller(prefix,books){const actor=await collector(prefix),photoId=await upload(actor.u);const actual=books?books.map(b=>({...b,photoId})): [copy(crypto.randomUUID(),10,cgc,photoId)];await save(actor.u,actual);return {...actor,photoId,books:actual}}
// Structured conditions belong to the listing, while identity/title/photo ownership comes from the saved vault.
async function create(s,options={}){const bookIds=options.bookIds||[s.books[0].id],conditions=Object.fromEntries(s.books.filter(b=>bookIds.includes(b.id)&&b.condition).map(b=>[b.id,b.condition]));return post(s.u,{action:'listing',kind:'single',saleType:'fixed',bookIds,conditions,description:'Actual owned copies, honestly described.',price:10000,shipping:800,photos:[s.photoId],cert:'',attest:true,usaAttest:true,...options})}
async function published(s,options={}){const r=await create(s,options);assert.equal(r.status,200,JSON.stringify(r.data));assert.ok(r.data.listingId);return r.data.listingId}
async function item(u,id){const r=await get(u);assert.equal(r.status,200,JSON.stringify(r.data));const l=r.data.listings.find(l=>l.id===id);assert.ok(l,'Listing not returned: '+id);return l}
const bid=(u,listingId,amount,options={})=>post(u,{action:'bid',listingId,amount,requestId:crypto.randomUUID(),nonbindingConsent:true,...options});
const retract=(u,listingId,bidId,options={})=>post(u,{action:'retract_bid',listingId,bidId,nonbindingConsent:true,...options});
function noPrivateFields(value){if(!value||typeof value!=='object')return;for(const [key,v]of Object.entries(value)){assert.ok(!['licenseReference','license_reference','rightsExpiresAt','rights_expires_at','requestId','request_id','bidderId','bidder_id','leaderId','leader_id'].includes(key),'Private field escaped: '+key);noPrivateFields(v)}}
async function imports(){const updatedAt=new Date(clock.now-1000).toISOString(),rightsExpiresAt=new Date(clock.now+365*86400000).toISOString();const rows=[{issueId:10,...cgc,fmv:120,low:100,high:140,sales:3,windowDays:90,updatedAt,sourceName:'QA licensed price feed',sourceUrl:'https://prices.example.test/issue/10'},{issueId:24,...raw,fmv:20,low:10,high:30,sales:4,windowDays:90,updatedAt,sourceName:'QA raw price feed',sourceUrl:'https://prices.example.test/issue/24'}];const r=await call(values,'POST',owner,{currency:'USD',rightsConfirmed:true,licenseReference:'QA-FIXTURE-NOT-A-REAL-CONTRACT',rightsExpiresAt,rows});assert.equal(r.status,200,JSON.stringify(r.data));return rows}
// Run actual pure marketplace functions. This checks price semantics, not DOM rendering.
const marketplaceSource=await readFile(path.join(root,'app/marketplace.tsx'),'utf8'),marketplaceAst=ts.createSourceFile('app/marketplace.tsx',marketplaceSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const helperNames=['cleanCondition','matchingValue','summarize','remaining'],helperCode=[];
for(const node of marketplaceAst.statements){
 if(ts.isFunctionDeclaration(node)&&node.name&&helperNames.includes(node.name.text))helperCode.push(node.getText(marketplaceAst));
 if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>d.name.getText(marketplaceAst)==='labels'))helperCode.push(node.getText(marketplaceAst));
}
const marketData=await route('lib/market-data.ts'),helperContext=vm.createContext({Date:ServerDate,grades:(await route('lib/catalog.ts')).grades,marketKey:marketData.marketKey,freshValue:marketData.freshValue});
vm.runInContext(ts.transpileModule(helperCode.join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText,helperContext);
for(const name of helperNames)assert.equal(typeof helperContext[name],'function','Missing actual marketplace helper '+name);
const helperResult=value=>JSON.parse(JSON.stringify(value));
function insert(table,row){const keys=Object.keys(row);sqlite.prepare('INSERT INTO '+table+' ('+keys.join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').run(...keys.map(key=>row[key]))}
const ruleVersion=(await route('lib/community.ts')).previewRulesVersion;
const legacyUser={userId:'legacy-owner',displayName:'Legacy Owner',email:'legacy@example.test'},peerUser={userId:'legacy-peer',displayName:'Legacy Peer',email:'peer@example.test'};
const legacyProfile=crypto.randomUUID(),peerProfile=crypto.randomUUID(),legacyPhoto=crypto.randomUUID(),peerPhoto=crypto.randomUUID();
for(const [u,p,h]of [[legacyUser,legacyProfile,'legacyowner'],[peerUser,peerProfile,'legacypeer']])insert('profiles',{id:p,user_id:u.userId,handle:h,name:u.displayName,bio:'Fixture',tagline:'Fixture collection',location:'Test',favorite:'Comics',since:2020,color:'red',featured:'[]',visible:1,dm_open:1,created_at:'2020-01-01T00:00:00Z',moderated:0,rules_version:ruleVersion,rules_accepted_at:'2026-10-09T00:00:00Z'});
for(const [u,id]of [[legacyUser,legacyPhoto],[peerUser,peerPhoto]]){insert('media',{id,user_id:u.userId,content_type:'image/jpeg',created_at:'2020-01-01T00:00:00Z'});objects.set('photos/'+id,new Uint8Array(photo))}
const legacyBooks=[copy('legacy-copy-a',10,null,legacyPhoto),copy('legacy-copy-b',11,null,legacyPhoto)],peerBooks=[copy('legacy-copy-a',10,null,peerPhoto)];
for(const [u,books]of [[legacyUser,legacyBooks],[peerUser,peerBooks]])insert('collections',{user_id:u.userId,data:JSON.stringify({...empty,books}),revision:crypto.randomUUID()});
const oldest=crypto.randomUUID(),duplicate=crypto.randomUUID(),withdrawn=crypto.randomUUID(),pending=crypto.randomUUID();
function legacyRow(id,bookId,status,stamp){return {id,seller_id:legacyProfile,book_id:bookId,issue_id:10,title:'Original legacy listing',grade:'CGC 9.8',description:'Legacy fixture',price:10000,shipping:500,photos:JSON.stringify([legacyPhoto]),cert:'',status,created_at:stamp}}
insert('listings',legacyRow(oldest,'legacy-copy-a','active','2020-01-01T00:00:00Z'));
insert('listings',legacyRow(duplicate,'legacy-copy-a','active','2021-01-01T00:00:00Z'));
insert('listings',legacyRow(withdrawn,'legacy-copy-b','withdrawn','2019-01-01T00:00:00Z'));
insert('offers',{id:pending,listing_id:duplicate,buyer_id:peerProfile,amount:9500,note:'Duplicate offer fixture',status:'pending',created_at:'2021-01-02T00:00:00Z'});
const before=JSON.stringify(sqlite.prepare('SELECT id,status FROM listings ORDER BY id').all());
const migration=await readFile(path.join(root,'drizzle/0006_marketplace_preview.sql'),'utf8');
await test('Migration6 physical lines are complete, schema-only and provide the CHECK guard without triggers',async()=>{
 const lines=migration.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);assert.ok(lines.length>0);
 for(const line of lines){assert.ok(/^(CREATE (?:TABLE|INDEX|UNIQUE INDEX|TRIGGER)|ALTER TABLE)\b/i.test(line),'Migration contains a data-write or incomplete statement: '+line.slice(0,90));sqlite.exec(line)}
 const triggers=sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name").all().map(row=>row.name);
 assert.deepEqual(triggers,[]);
 const guard=sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='operation_guard'").get();assert.ok(guard);assert.match(guard.sql,/operation_guard_valid/);assert.throws(()=>sqlite.prepare('INSERT INTO operation_guard(id,valid) VALUES (?,?)').run('invalid-fixture',0),/CHECK constraint failed/i);assert.equal(sqlite.prepare('SELECT count(*) AS n FROM operation_guard').get().n,0);
 assert.equal(JSON.stringify(sqlite.prepare('SELECT id,status FROM listings ORDER BY id').all()),before);assert.equal(sqlite.prepare('SELECT count(*) AS n FROM listing_inventory').get().n,0);
 console.log('Migration6: '+lines.length+' complete schema statements, '+triggers.length+' triggers.');
});
// Keep the actual pre6 transition above. Current handlers also require every
// later schema migration (including the sandbox ledger used by inventory guards).
for(const file of (await readdir(path.join(root,'drizzle'))).filter(f=>f.endsWith('.sql')&&f>'0006_marketplace_preview.sql').sort())sqlite.exec(await readFile(path.join(root,'drizzle',file),'utf8'));
const legacySeller={u:legacyUser,p:{id:legacyProfile,handle:'legacyowner'},photoId:legacyPhoto,books:legacyBooks},peerSeller={u:peerUser,p:{id:peerProfile,handle:'legacypeer'},photoId:peerPhoto,books:peerBooks};
await test('Atomic guard rejects legacy overlap appearing after initialization but before publication',async()=>{
 const a=await collector('racelegacy'),photoId=await upload(a.u),books=[copy('legacy-race-copy',10,null,photoId)];await save(a.u,books);
 const existing=crypto.randomUUID();insert('listings',{...legacyRow(existing,books[0].id,'withdrawn','2020-01-01T00:00:00Z'),seller_id:a.p.id,photos:JSON.stringify([photoId])});let fired=false;
 beforeBatch=statements=>{if(!statements.some(statement=>/^insert\s+into\s+["`]?listings["`]?\s/i.test(statement.sql)))return;beforeBatch=null;fired=true;sqlite.prepare('UPDATE listings SET status=? WHERE id=?').run('active',existing)};
 const r=await create({...a,books,photoId});assert.ok(fired);assert.equal(r.status,409,JSON.stringify(r.data));
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM listings WHERE seller_id=?').get(a.p.id).n,1);assert.equal(sqlite.prepare('SELECT count(*) AS n FROM listing_inventory WHERE seller_id=?').get(a.p.id).n,0);assert.equal(sqlite.prepare('SELECT count(*) AS n FROM operation_guard').get().n,0);
});
await test('Legacy overlap is seller-scoped and never blocks another owner’s copy identifier',async()=>{
 const id=await published(peerSeller);const row=await get(peerUser,'?kind=listing&id='+id);assert.equal(row.status,200);assert.equal(row.data.items[0].bookId,'legacy-copy-a');assert.equal(row.data.sellerId,peerProfile);
 assert.equal(sqlite.prepare('SELECT items FROM listings WHERE id=?').get(oldest).items,'[]','Another seller initialized or rewrote the legacy owner’s rows');
});
await test('Owned lazy initialization safely snapshots legacy rows and closes the later duplicate',async()=>{
 assert.equal((await create(legacySeller,{bookIds:['legacy-copy-a']})).status,409);
 const rows=sqlite.prepare('SELECT id,status,items FROM listings WHERE seller_id=? ORDER BY created_at').all(legacyProfile);
 assert.equal(rows.find(row=>row.id===oldest).status,'active');assert.equal(rows.find(row=>row.id===duplicate).status,'withdrawn');assert.equal(rows.find(row=>row.id===withdrawn).status,'withdrawn');
 assert.equal(sqlite.prepare('SELECT status FROM offers WHERE id=?').get(pending).status,'closed');
 const winner=sqlite.prepare('SELECT listing_id FROM listing_inventory WHERE seller_id=? AND book_id=?').get(legacyProfile,'legacy-copy-a');assert.equal(winner.listing_id,oldest);
 const items=JSON.parse(rows.find(row=>row.id===oldest).items);assert.equal(items.length,1);assert.equal(items[0].catalogId,10);assert.equal(items[0].issue,legacyBooks[0].issue);assert.equal(items[0].photoId,legacyPhoto);assert.equal(items[0].price,undefined);
 const returned=await get(peerUser,'?kind=listing&id='+oldest);assert.equal(returned.status,200);assert.equal(returned.data.valuation.total,null);assert.equal(returned.data.valuation.knownTotal,null);assert.equal(JSON.stringify(returned.data).includes('765432.1'),false);
 const fresh=await published(legacySeller,{bookIds:['legacy-copy-b']});assert.ok(fresh);assert.equal(sqlite.prepare('SELECT count(*) AS n FROM listing_inventory WHERE seller_id=?').get(legacyProfile).n,2);
});
await test('Lazy initialization is idempotent and published legacy contents remain frozen after vault edits',async()=>{
 const snapshot=sqlite.prepare('SELECT items FROM listings WHERE id=?').get(oldest).items;
 await save(legacyUser,legacyBooks.map(b=>{const {catalogId,...personal}=b;void catalogId;return {...personal,title:'Later private edit'}}));
 assert.equal((await create(legacySeller,{bookIds:['legacy-copy-a']})).status,409);
 assert.equal(sqlite.prepare('SELECT items FROM listings WHERE id=?').get(oldest).items,snapshot);
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM listing_inventory WHERE seller_id=?').get(legacyProfile).n,2);
});


await test('Owned initialization processes25 rows and protects overlap outside that batch',async()=>{
 const a=await collector('boundedlegacy'),photoId=await upload(a.u),books=Array.from({length:26},(_,n)=>copy('bounded-'+String(n).padStart(2,'0'),10,null,photoId));await save(a.u,books);
 for(let n=0;n<26;n++){const row={...legacyRow(crypto.randomUUID(),books[n].id,'withdrawn',new Date(Date.parse('2020-01-01T00:00:00Z')+n).toISOString()),seller_id:a.p.id,photos:JSON.stringify([photoId])};insert('listings',row);sqlite.prepare('UPDATE listings SET status=? WHERE id=?').run('active',row.id)}
 const s={...a,photoId,books};let maxBinds=0;
 beforeExecute=(query,params)=>{maxBinds=Math.max(maxBinds,params.length)};
 assert.equal((await create(s,{bookIds:[books[25].id]})).status,409);beforeExecute=null;
 assert.equal(sqlite.prepare("SELECT count(*) AS n FROM listings WHERE seller_id=? AND items!='[]'").get(a.p.id).n,25);
 assert.equal(sqlite.prepare("SELECT count(*) AS n FROM listings WHERE seller_id=? AND items='[]'").get(a.p.id).n,1);
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM listing_inventory WHERE seller_id=?').get(a.p.id).n,25);assert.ok(maxBinds<=100);
 assert.equal((await create(s,{bookIds:[books[25].id]})).status,409);
 assert.equal(sqlite.prepare("SELECT count(*) AS n FROM listings WHERE seller_id=? AND items='[]'").get(a.p.id).n,0);
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM listing_inventory WHERE seller_id=?').get(a.p.id).n,26);
 console.log('Full25-row initialization: maximum '+maxBinds+' SQL bindings; uninitialized26th copy remained protected.');
});
console.log('Migration delta results: '+passed+' passed, '+failures.length+' failed.');if(failures.length)process.exitCode=1;
