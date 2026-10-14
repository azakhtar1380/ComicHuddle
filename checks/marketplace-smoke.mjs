// Run: node --experimental-vm-modules checks/marketplace-smoke.mjs
// Tests real route code and Drizzle against in-memory SQLite; no hosted records are modified.
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
 if(!spec.startsWith('.')&&!spec.startsWith('/')){if(!cache.has(spec))cache.set(spec,synthetic(spec,await import(spec)));return cache.get(spec)}
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
async function test(name,run){try{await run();if(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='operation_guard'").get())assert.equal(sqlite.prepare('SELECT count(*) AS n FROM operation_guard').get().n,0,'Atomic guard rows were not cleaned up');passed++;console.log('PASS: '+name)}catch(error){failures.push({name,message:error.message});console.error('FAIL: '+name+' — '+error.message)}finally{beforeExecute=null;beforeBatch=null}}
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
const marketData=await route('lib/market-data.ts'),helperContext=vm.createContext({Date:ServerDate,grades:(await route('lib/catalog.ts')).grades,marketKey:marketData.marketKey,freshValue:marketData.freshValue,linkedCatalogIssue:(await route('lib/catalog-search.ts')).linkedCatalogIssue});
vm.runInContext(ts.transpileModule(helperCode.join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText,helperContext);
for(const name of helperNames)assert.equal(typeof helperContext[name],'function','Missing actual marketplace helper '+name);
const helperResult=value=>JSON.parse(JSON.stringify(value));
await imports();
await test('Marketplace mutations require identity and the correct origin',async()=>{assert.equal((await post(null,{action:'bid'})).status,401);const a=await collector('origin');assert.equal((await call(social,'POST',a.u,{action:'bid'},'','https://evil.test')).status,403);assert.equal((await post(a.u,{action:'bid'})).status,400)});
await test('A single listing snapshots its owned copy and exact licensed FMV without private costs',async()=>{const s=await seller('single'),id=await published(s),l=await item(s.u,id);assert.equal(l.kind,'single');assert.equal(l.saleType,'fixed');assert.equal(l.itemCount,1);assert.equal(l.items.length,1);assert.equal(l.items[0].bookId,s.books[0].id);assert.equal(l.items[0].price,undefined);assert.equal(l.items[0].catalogId,10);assert.deepEqual(l.items[0].condition,cgc);assert.deepEqual(l.valuation,{total:12000,knownTotal:12000,pricedCount:1,totalCount:1,status:'complete',asOf:l.valuation.asOf,sourceNames:['QA licensed price feed']});assert.ok(l.valuation.asOf);assert.equal(l.auction,null);noPrivateFields(l)});
await test('A collection listing snapshots every selected physical copy and totals quantity correctly',async()=>{const books=[copy('lot-a'),copy('lot-b'),copy('lot-c',24,raw)],s=await seller('collection',books),id=await published(s,{kind:'collection',bookIds:s.books.map(b=>b.id),title:'My entire longbox'}),l=await item(s.u,id);assert.equal(l.kind,'collection');assert.equal(l.itemCount,3);assert.equal(new Set(l.items.map(i=>i.bookId)).size,3);assert.equal(l.valuation.total,26000);assert.equal(l.valuation.knownTotal,26000);assert.equal(l.valuation.pricedCount,3);assert.equal(l.valuation.status,'complete');assert.deepEqual(new Set(l.valuation.sourceNames),new Set(['QA licensed price feed','QA raw price feed']));for(const i of l.items)assert.equal(i.price,undefined);noPrivateFields(l)});
await test('A mixed collection displays only covered FMV and never presents a partial total as complete',async()=>{const books=[copy('known-a'),copy('known-b'),copy('known-raw',24,raw),copy('unknown',11,cgc)],s=await seller('partial',books),id=await published(s,{kind:'collection',bookIds:s.books.map(b=>b.id)}),l=await item(s.u,id);assert.equal(l.valuation.total,null);assert.equal(l.valuation.knownTotal,26000);assert.equal(l.valuation.pricedCount,3);assert.equal(l.valuation.totalCount,4);assert.equal(l.valuation.status,'partial')});
await test('Unstructured, inferred-catalog, wrong-grade, wrong-label and wrong-printing copies have unavailable FMV',async()=>{for(const [prefix,book]of [['unstructured',copy('copy',10,null)],['inferred',(()=>{const b=copy('copy');delete b.catalogId;return b})()],['wronggrade',copy('copy',10,{...cgc,grade:'9.6'})],['wronglabel',copy('copy',10,{...cgc,label:'Signature Series'})],['wrongprint',copy('copy',10,{...cgc,printing:'Later printing'})]]){const s=await seller(prefix,[book]),id=await published(s),l=await item(s.u,id);assert.equal(l.valuation.total,null,prefix);assert.equal(l.valuation.knownTotal,null,prefix);assert.equal(l.valuation.pricedCount,0,prefix);assert.equal(l.valuation.status,'unavailable',prefix)}});
await test('Stale or expired licensed estimates disappear from listing FMV immediately',async()=>{const s=await seller('freshness'),id=await published(s);assert.equal((await item(s.u,id)).valuation.total,12000);sqlite.prepare("UPDATE market_values SET updated_at=? WHERE issue_id=10 AND mode='CGC'").run(new Date(clock.now-31*86400000).toISOString());assert.equal((await item(s.u,id)).valuation.total,null);await imports();sqlite.prepare("UPDATE market_values SET rights_expires_at=? WHERE issue_id=10 AND mode='CGC'").run(new Date(clock.now-1).toISOString());const expired=await item(s.u,id);assert.equal(expired.valuation.total,null);assert.equal(expired.valuation.knownTotal,null);noPrivateFields(expired);await imports()});
await test('Published copy snapshots and authorized item photos survive later private-vault edits',async()=>{const s=await seller('snapshot',[copy('original-a'),copy('original-b',24,raw)]),id=await published(s,{kind:'collection',bookIds:s.books.map(b=>b.id)});const {catalogId,...personalCopy}=s.books[0];void catalogId;await save(s.u,[{...personalCopy,title:'Edited private title',price:1}]);const viewer=await collector('snapshotview'),l=await item(viewer.u,id);assert.equal(l.items.length,2);assert.notEqual(l.items[0].title,'Edited private title');assert.equal(l.valuation.total,14000);activeUser=viewer.u;assert.equal((await media.GET(new Request('https://comichuddle.test/api/media?id='+s.photoId))).status,200)});
await test('Creation rejects unowned, duplicate, empty and conflicting selections and foreign photos',async()=>{const s=await seller('ownership',[copy('owned-a'),copy('owned-b')]),other=await seller('foreign');statusIn(await create(s,{bookIds:['not-owned']}),[400,403]);assert.equal((await create(s,{kind:'collection',bookIds:[]})).status,400);assert.equal((await create(s,{kind:'collection',bookIds:['owned-a','owned-a']})).status,400);assert.equal((await create(s,{kind:'single',bookIds:['owned-a','owned-b']})).status,400);assert.equal((await create(s,{photos:[other.photoId]})).status,403);assert.equal((await create(s,{usaAttest:false})).status,400)});
await test('Physical copies cannot be duplicated across active singles and collection lots',async()=>{const s=await seller('duplicate',[copy('dup-a'),copy('dup-b')]),single=await published(s,{bookIds:['dup-a']});assert.equal((await create(s,{kind:'collection',bookIds:['dup-a','dup-b']})).status,409);assert.equal((await post(s.u,{action:'withdraw_listing',listingId:single})).status,200);const lot=await published(s,{kind:'collection',bookIds:['dup-a','dup-b']});assert.equal((await create(s,{bookIds:['dup-b']})).status,409);assert.equal((await post(s.u,{action:'withdraw_listing',listingId:lot})).status,200);assert.equal((await create(s,{bookIds:['dup-b']})).status,200)});
await test('Concurrent lot publication reserves every copy once or rolls back completely',async()=>{const s=await seller('lotrace',[copy('race-a'),copy('race-b')]),options={kind:'collection',bookIds:s.books.map(b=>b.id)};const outcomes=await Promise.all([create(s,options),create(s,options)]);assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);const id=outcomes.find(r=>r.status===200).data.listingId,active=(await get(s.u)).data.listings.filter(l=>l.sellerId===s.p.id);assert.equal(active.length,1);assert.equal(active[0].items.length,2);assert.equal((await post(s.u,{action:'withdraw_listing',listingId:id})).status,200);assert.equal((await create(s,{bookIds:['race-a']})).status,200);assert.equal((await create(s,{bookIds:['race-b']})).status,200);
 const fault=await seller('rollbacklot',[copy('fault-a'),copy('fault-b')]);let fired=false;
 beforeExecute=(query)=>{if(!/^insert\s+into\s+["`]?listing_inventory["`]?\s/i.test(query))return;beforeExecute=null;fired=true;
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM listings WHERE seller_id=?').get(fault.p.id).n,1,'Fault did not occur after the listing write');
  sqlite.prepare('INSERT INTO operation_guard(id,valid) VALUES (?,?)').run(crypto.randomUUID(),0);
 };
 assert.equal((await create(fault,{kind:'collection',bookIds:fault.books.map(b=>b.id)})).status,409);assert.ok(fired);
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM listings WHERE seller_id=?').get(fault.p.id).n,0);assert.equal(sqlite.prepare('SELECT count(*) AS n FROM listing_inventory WHERE seller_id=?').get(fault.p.id).n,0);assert.equal(sqlite.prepare('SELECT count(*) AS n FROM operation_guard').get().n,0);
 assert.equal((await create(fault,{kind:'collection',bookIds:fault.books.map(b=>b.id)})).status,200);
});
await test('A full 1000-copy collection uses bounded large payloads and preserves every snapshot',async()=>{const books=Array.from({length:1000},()=>copy(crypto.randomUUID())),s=await seller('fullsize',books),request={kind:'collection',bookIds:s.books.map(b=>b.id),title:'Entire 1000-copy collection'};assert.ok(JSON.stringify(request).length>25000);const id=await published(s,request),l=await item(s.u,id);assert.equal(l.itemCount,1000);assert.equal(l.items.length,1000);assert.equal(new Set(l.items.map(i=>i.bookId)).size,1000);assert.equal(l.valuation.pricedCount,1000);assert.equal(l.valuation.total,12000000);assert.equal(l.items.some(i=>'price' in i),false)});
await test('Oversized listing and nonlisting bodies fail before publication',async()=>{const s=await seller('bodylimit');assert.equal((await create(s,{description:'x'.repeat(1048577)})).status,413);assert.equal((await post(s.u,{action:'profile',payload:'x'.repeat(25001)})).status,413);assert.equal((await post(s.u,{action:'post',payload:'x'.repeat(25001)})).status,413);assert.equal((await get(s.u)).data.listings.some(l=>l.sellerId===s.p.id),false)});
await test('Auction cards keep opening ask and current FMV separate and use server time',async()=>{const s=await seller('auctioncard'),before=clock.now,id=await published(s,{saleType:'auction',durationHours:1,bidIncrement:500}),l=await item(s.u,id);assert.equal(l.price,10000);assert.equal(l.valuation.total,12000);assert.equal(l.saleType,'auction');assert.equal(l.auction.currentBid,null);assert.equal(l.auction.minNextBid,10000);assert.equal(l.auction.bidCount,0);assert.equal(l.auction.nonbinding,true);assert.equal(l.auction.ended,false);assert.ok(Date.parse(l.auction.endAt)>=before+3600000);assert.ok(Date.parse(l.auction.endAt)<=clock.now+3600000);noPrivateFields(l)});
await test('Auctions reject self bids, missing consent, fractional amounts, low bids and fixed-price actions',async()=>{const s=await seller('bidrules'),buyer=await collector('bidbuyer'),id=await published(s,{saleType:'auction',durationHours:1,bidIncrement:500});statusIn(await bid(s.u,id,10000),[400,403]);assert.equal((await bid(buyer.u,id,10000,{nonbindingConsent:false})).status,400);assert.equal((await bid(buyer.u,id,10000.5)).status,400);statusIn(await bid(buyer.u,id,9999),[400,409]);assert.equal((await bid(buyer.u,id,10000)).status,200);let l=await item(buyer.u,id);assert.equal(l.auction.currentBid,10000);assert.equal(l.auction.minNextBid,10500);assert.equal(l.auction.leading,true);assert.equal(l.auction.yourBid,10000);assert.equal(l.auction.yourBidStatus,'leading');assert.ok(l.auction.yourBidId);statusIn(await bid(buyer.u,id,10499),[400,409]);statusIn(await post(buyer.u,{action:'offer',listingId:id,amount:12000,note:''}),[400,409]);statusIn(await post(buyer.u,{action:'buy',listingId:id}),[400,409]);l=await item(s.u,id);assert.equal(l.auction.leading,false);assert.equal(l.auction.yourBid,null);assert.equal(l.auction.yourBidId,null);noPrivateFields(l)});
await test('Bidder identity and request receipts stay private to each collector',async()=>{const s=await seller('bidprivacy'),a=await collector('privbidder'),b=await collector('bidobserver'),id=await published(s,{saleType:'auction'}),requestId=crypto.randomUUID();assert.equal((await bid(a.u,id,10000,{requestId})).status,200);const publicCard=await item(b.u,id);assert.equal(publicCard.auction.yourBid,null);assert.equal(publicCard.auction.yourBidId,null);assert.equal(publicCard.auction.leading,false);noPrivateFields(publicCard);assert.equal(JSON.stringify(publicCard).includes(requestId),false);assert.equal(JSON.stringify(publicCard).includes(a.p.id),false);const exported=(await get(a.u,'?kind=export')).data;assert.ok(exported.bids.some(v=>v.listingId===id));const observer=(await get(b.u,'?kind=export')).data;assert.equal(observer.bids.some(v=>v.listingId===id),false)});
await test('Bid request IDs are idempotent per bidder and cannot be reused with different payloads',async()=>{const s=await seller('idempotent'),a=await collector('retrybidder'),b=await collector('scopebidder'),id=await published(s,{saleType:'auction',durationHours:1,bidIncrement:500}),requestId=crypto.randomUUID();let r=await bid(a.u,id,10000,{requestId});assert.equal(r.status,200);assert.equal(r.data.duplicate,false);r=await bid(a.u,id,10000,{requestId});assert.equal(r.status,200);assert.equal(r.data.duplicate,true);assert.equal(r.data.auction.bidCount,1);assert.equal((await bid(a.u,id,10500,{requestId})).status,409);assert.equal((await bid(b.u,id,10500,{requestId})).status,200);const secondSeller=await seller('idempotentother'),second=await published(secondSeller,{saleType:'auction'});assert.equal((await bid(a.u,second,10000,{requestId})).status,409);const l=await item(a.u,id);clock.now=Date.parse(l.auction.endAt);r=await bid(a.u,id,10000,{requestId});assert.equal(r.status,200);assert.equal(r.data.duplicate,true);assert.equal(r.data.auction.ended,true);assert.equal(r.data.auction.bidCount,2);const receipts=(await get(a.u,'?kind=export')).data.bids.filter(v=>v.listingId===id);assert.equal(receipts.length,1)});
await test('Concurrent equal bids record exactly one leading proposal',async()=>{const s=await seller('bidrace'),a=await collector('racebiddera'),b=await collector('racebidderb'),id=await published(s,{saleType:'auction',durationHours:1,bidIncrement:500}),outcomes=await Promise.all([bid(a.u,id,10000),bid(b.u,id,10000)]);assert.equal(outcomes.filter(r=>r.status===200).length,1);assert.equal(outcomes.filter(r=>[400,409].includes(r.status)).length,1);const l=await item(s.u,id);assert.equal(l.auction.bidCount,1);assert.equal(l.auction.currentBid,10000);const aRecords=(await get(a.u,'?kind=export')).data.bids.filter(v=>v.listingId===id),bRecords=(await get(b.u,'?kind=export')).data.bids.filter(v=>v.listingId===id);assert.equal(aRecords.length+bRecords.length,1);assert.equal((await item(a.u,id)).auction.leading,outcomes[0].status===200);assert.equal((await item(b.u,id)).auction.leading,outcomes[1].status===200)});
await test('Blocked, hidden and restricted collectors cannot place new bids',async()=>{const s=await seller('bidaccess'),blockedBuyer=await collector('blockedbid'),hiddenBuyer=await collector('hiddenbid'),heldBuyer=await collector('heldbid'),reporter=await collector('bidreporter'),id=await published(s,{saleType:'auction'});assert.equal((await post(s.u,{action:'block',to:blockedBuyer.p.id})).status,200);statusIn(await bid(blockedBuyer.u,id,10000),[400,403,404]);const hiddenForm={action:'profile',handle:hiddenBuyer.p.handle,name:hiddenBuyer.p.name,bio:'Collector',tagline:'Hidden',location:'Test',favorite:'Comics',since:2020,color:'red',featured:[],visible:false,dmOpen:true,accept:true};assert.equal((await post(hiddenBuyer.u,hiddenForm)).status,200);statusIn(await bid(hiddenBuyer.u,id,10000),[400,403]);assert.equal((await post(reporter.u,{action:'report',targetType:'profile',targetId:heldBuyer.p.id,reason:'Auction restriction fixture'})).status,200);const report=(await get(owner,'?kind=reports')).data.reports.find(v=>v.targetId===heldBuyer.p.id);assert.equal((await post(owner,{action:'review_report',reportId:report.id,remove:true})).status,200);assert.equal((await bid(heldBuyer.u,id,10000)).status,403);assert.equal((await item(s.u,id)).auction.bidCount,0)});
await test('Server-time cutoff rejects bids and retractions at the exact auction end',async()=>{const s=await seller('bidcutoff'),a=await collector('cutoffbidder'),id=await published(s,{saleType:'auction',durationHours:1,bidIncrement:500});let l=await item(a.u,id);clock.now=Date.parse(l.auction.endAt)-2;assert.equal((await bid(a.u,id,10000)).status,200);l=await item(a.u,id);const bidId=l.auction.yourBidId;clock.now=Date.parse(l.auction.endAt)-1;statusIn(await bid(a.u,id,10500),[400,409]);statusIn(await retract(a.u,id,bidId),[400,409]);assert.equal((await item(a.u,id)).auction.ended,true);assert.equal((await item(a.u,id)).auction.bidCount,1)});
await test('Only the submitting collector can retract a live nonbinding proposal',async()=>{const s=await seller('retractown'),a=await collector('retractbidder'),b=await collector('retractintruder'),id=await published(s,{saleType:'auction'});assert.equal((await bid(a.u,id,10000)).status,200);const first=await item(a.u,id),bidId=first.auction.yourBidId;statusIn(await retract(b.u,id,bidId),[403,404]);assert.equal((await retract(a.u,id,bidId,{nonbindingConsent:false})).status,400);assert.equal((await retract(a.u,id,bidId)).status,200);const l=await item(a.u,id);assert.equal(l.auction.currentBid,null);assert.equal(l.auction.minNextBid,10000);assert.equal(l.auction.leading,false);assert.equal(l.auction.yourBid,null);assert.equal(l.auction.bidCount,1);assert.equal((await post(s.u,{action:'withdraw_listing',listingId:id})).status,409)});
await test('Leader retraction never silently promotes a prior outbid proposal',async()=>{const s=await seller('nopromotion'),a=await collector('priorbidder'),b=await collector('leadbidder'),id=await published(s,{saleType:'auction',bidIncrement:500});assert.equal((await bid(a.u,id,10000)).status,200);assert.equal((await bid(b.u,id,10500)).status,200);let l=await item(b.u,id);assert.equal((await retract(b.u,id,l.auction.yourBidId)).status,200);l=await item(a.u,id);assert.equal(l.auction.currentBid,null);assert.equal(l.auction.minNextBid,10000);assert.equal(l.auction.leading,false);assert.equal(l.auction.yourBidStatus,'outbid');assert.equal(l.auction.bidCount,2);assert.equal((await bid(a.u,id,10000)).status,200);assert.equal((await item(a.u,id)).auction.leading,true)});
await test('Retracting an outbid proposal preserves the current leader',async()=>{const s=await seller('outbidretract'),a=await collector('oldbidder'),b=await collector('newbidder'),id=await published(s,{saleType:'auction',bidIncrement:500});assert.equal((await bid(a.u,id,10000)).status,200);const old=(await item(a.u,id)).auction.yourBidId;assert.equal((await bid(b.u,id,10500)).status,200);assert.equal((await retract(a.u,id,old)).status,200);const l=await item(b.u,id);assert.equal(l.auction.currentBid,10500);assert.equal(l.auction.leading,true);assert.equal(l.auction.minNextBid,11000);assert.equal(l.auction.bidCount,2)});
await test('Seller withdrawal is available before bidding and blocked after bid activity',async()=>{const s=await seller('withdrawauc',[copy('withdraw-a'),copy('withdraw-b')]),noBids=await published(s,{saleType:'auction',bookIds:['withdraw-a']}),buyer=await collector('withdrawbidder');assert.equal((await post(s.u,{action:'withdraw_listing',listingId:noBids})).status,200);assert.equal((await create(s,{bookIds:['withdraw-a']})).status,200);const hasBids=await published(s,{saleType:'auction',bookIds:['withdraw-b']});assert.equal((await bid(buyer.u,hasBids,10000)).status,200);assert.equal((await post(s.u,{action:'withdraw_listing',listingId:hasBids})).status,409);assert.equal((await create(s,{bookIds:['withdraw-b']})).status,409)});
await test('Owner cancellation releases inventory and safely permits participant account deletion',async()=>{const s=await seller('cancelauc'),a=await collector('cancelbidder'),reporter=await collector('cancelreporter'),id=await published(s,{saleType:'auction'});assert.equal((await bid(a.u,id,10000)).status,200);assert.equal((await post(s.u,{action:'delete_my_data',confirm:'DELETE'})).status,409);assert.equal((await post(a.u,{action:'delete_my_data',confirm:'DELETE'})).status,409);assert.equal((await post(reporter.u,{action:'report',targetType:'listing',targetId:id,reason:'Owner cancellation fixture'})).status,200);const report=(await get(owner,'?kind=reports')).data.reports.find(v=>v.targetId===id);assert.equal((await post(owner,{action:'review_report',reportId:report.id,remove:true})).status,200);assert.equal((await get(s.u)).data.listings.some(v=>v.id===id),false);assert.equal((await create(s)).status,200);assert.equal((await post(a.u,{action:'delete_my_data',confirm:'DELETE'})).status,200);assert.equal((await post(s.u,{action:'delete_my_data',confirm:'DELETE'})).status,200)});
await test('Ended auction sellers need owner cancellation while bidder deletion anonymizes history',async()=>{const s=await seller('expiredhold'),a=await collector('expiredbidder'),id=await published(s,{saleType:'auction',durationHours:1});assert.equal((await bid(a.u,id,10000)).status,200);const l=await item(a.u,id),receipt=(await get(a.u,'?kind=export')).data.bids.find(b=>b.listingId===id);clock.now=Date.parse(l.auction.endAt);assert.equal((await item(s.u,id)).auction.ended,true);assert.equal((await post(s.u,{action:'delete_my_data',confirm:'DELETE'})).status,409);assert.equal((await post(a.u,{action:'delete_my_data',confirm:'DELETE'})).status,200);const retained=sqlite.prepare('SELECT * FROM auction_bids WHERE id=?').get(receipt.id);assert.ok(retained);assert.equal(retained.amount,10000);assert.equal(retained.created_at,receipt.createdAt);assert.notEqual(retained.bidder_id,a.p.id);assert.notEqual(retained.request_id,receipt.requestId);assert.equal((await post(s.u,{action:'withdraw_listing',listingId:id})).status,409)});
await test('Fixed-price listings cannot receive nonbinding auction proposals',async()=>{
 const s=await seller('fixedbid'),a=await collector('fixedbidder'),id=await published(s);
 statusIn(await bid(a.u,id,10000),[400,404,409]);
 assert.equal((await item(a.u,id)).auction,null);
 assert.equal((await get(a.u,'?kind=export')).data.bids.some(b=>b.listingId===id),false);
});
await test('An older own proposal cannot be retracted after a newer own proposal',async()=>{
 const s=await seller('latestretract'),a=await collector('samebidder'),id=await published(s,{saleType:'auction'});
 assert.equal((await bid(a.u,id,10000)).status,200);
 const earlier=(await item(a.u,id)).auction.yourBidId;
 assert.equal((await bid(a.u,id,10500)).status,200);
 statusIn(await retract(a.u,id,earlier),[400,404,409]);
 const l=await item(a.u,id);
 assert.equal(l.auction.currentBid,10500);assert.equal(l.auction.leading,true);assert.notEqual(l.auction.yourBidId,earlier);assert.equal(l.auction.bidCount,2);
});
await test('Auction collection reservations conflict with fixed-price singles and lots',async()=>{
 const s=await seller('auctionlocks',[copy('locked-a'),copy('locked-b')]);
 const id=await published(s,{kind:'collection',saleType:'auction',bookIds:s.books.map(b=>b.id)});
 assert.equal((await create(s,{bookIds:['locked-a']})).status,409);
 assert.equal((await create(s,{kind:'collection',bookIds:['locked-b']})).status,409);
 assert.equal((await post(s.u,{action:'withdraw_listing',listingId:id})).status,200);
 assert.equal((await create(s,{bookIds:['locked-a']})).status,200);
 assert.equal((await create(s,{bookIds:['locked-b']})).status,200);
});
await test('Exports include only owned inventory reservations and owned bid receipts',async()=>{
 const s=await seller('exportlocks',[copy('export-a'),copy('export-b')]),a=await collector('exportbidder'),observer=await collector('exportobserver');
 const id=await published(s,{kind:'collection',saleType:'auction',bookIds:s.books.map(b=>b.id)}),requestId=crypto.randomUUID();
 assert.equal((await bid(a.u,id,10000,{requestId})).status,200);
 const own=(await get(s.u,'?kind=export')).data,buyer=(await get(a.u,'?kind=export')).data,foreign=(await get(observer.u,'?kind=export')).data;
 assert.equal(own.reservations.length,2);assert.ok(own.reservations.every(r=>r.listingId===id&&r.sellerId===s.p.id));assert.equal(own.bids.length,0);
 assert.equal(buyer.reservations.length,0);assert.equal(buyer.bids.length,1);assert.equal(buyer.bids[0].listingId,id);
 assert.equal(foreign.reservations.length,0);assert.equal(foreign.bids.length,0);
 assert.equal(JSON.stringify(own.listings).includes(a.p.id),false,'Seller export revealed another collector’s bidder identity');
 assert.equal(JSON.stringify(own.listings).includes(requestId),false,'Seller export revealed another collector’s request receipt');
});
await test('Account restriction withdraws listings and releases reservations only for restored reuse',async()=>{
 const s=await seller('heldinventory',[copy('held-a'),copy('held-b'),copy('held-c')]),reporter=await collector('inventoryreporter'),buyer=await collector('heldauctionbid');
 const id=await published(s,{kind:'collection',bookIds:['held-a','held-b']}),auction=await published(s,{saleType:'auction',bookIds:['held-c']});
 assert.equal((await bid(buyer.u,auction,10000)).status,200);
 assert.equal((await post(reporter.u,{action:'report',targetType:'profile',targetId:s.p.id,reason:'Inventory restriction fixture'})).status,200);
 const report=(await get(owner,'?kind=reports')).data.reports.find(r=>r.targetId===s.p.id);
 assert.equal((await post(owner,{action:'review_report',reportId:report.id,remove:true})).status,200);
 assert.equal((await get(reporter.u)).data.listings.some(l=>l.id===id),false);
 assert.equal((await get(reporter.u)).data.listings.some(l=>l.id===auction),false);
 assert.equal((await get(buyer.u,'?kind=export')).data.bids.find(b=>b.listingId===auction).status,'cancelled');
 assert.equal((await create(s)).status,403);
 assert.equal((await get(s.u,'?kind=export')).data.reservations.length,0);
 assert.equal((await post(owner,{action:'review_restriction',userId:s.u.userId,scope:'account',restore:true})).status,200);
 assert.equal((await makeProfile(s.u,s.p.handle)).status,200);
 assert.equal((await create(s,{bookIds:['held-a']})).status,200);
 assert.equal((await create(s,{bookIds:['held-b']})).status,200);
 assert.equal((await create(s,{bookIds:['held-c']})).status,200);
});
await test('Mixed license expiry preserves a clearly labeled covered subtotal',async()=>{
 const s=await seller('mixedexpiry',[copy('exp-cgc'),copy('valid-raw',24,raw)]),id=await published(s,{kind:'collection',bookIds:s.books.map(b=>b.id)});
 sqlite.prepare("UPDATE market_values SET rights_expires_at=? WHERE issue_id=10 AND mode='CGC'").run(new Date(clock.now-1).toISOString());
 const l=await item(s.u,id);
 assert.equal(l.valuation.total,null);assert.equal(l.valuation.knownTotal,2000);assert.equal(l.valuation.pricedCount,1);assert.equal(l.valuation.totalCount,2);assert.equal(l.valuation.status,'partial');assert.deepEqual(l.valuation.sourceNames,['QA raw price feed']);
 await imports();
});
await test('Ended auction inventory can be relisted without creating an order or erasing bid history',async()=>{
 const s=await seller('expiredrelist',[copy('expired-a'),copy('expired-b')]),a=await collector('relistbidder'),id=await published(s,{kind:'collection',saleType:'auction',bookIds:s.books.map(b=>b.id),durationHours:1});
 assert.equal((await bid(a.u,id,10000)).status,200);
 const l=await item(s.u,id);clock.now=Date.parse(l.auction.endAt);
 const replacement=await published(s,{kind:'collection',bookIds:s.books.map(b=>b.id)});
 assert.notEqual(replacement,id);assert.equal((await item(s.u,replacement)).saleType,'fixed');
 assert.equal((await get(a.u,'?kind=export')).data.bids.filter(b=>b.listingId===id).length,1);
 assert.equal((await post(s.u,{action:'delete_my_data',confirm:'DELETE'})).status,409);
 assert.equal((await post(a.u,{action:'delete_my_data',confirm:'DELETE'})).status,200);
 assert.equal((await get(a.u)).data.checkoutEnabled,false);
});
await test('Retracted live proposals permit bidder deletion and preserve private anonymous history',async()=>{
 const s=await seller('retractdelete'),a=await collector('retractdeleter'),id=await published(s,{saleType:'auction'});
 assert.equal((await bid(a.u,id,10000)).status,200);
 const before=await item(a.u,id),receipt=(await get(a.u,'?kind=export')).data.bids.find(b=>b.listingId===id);
 assert.equal((await post(a.u,{action:'delete_my_data',confirm:'DELETE'})).status,409);
 assert.equal((await retract(a.u,id,before.auction.yourBidId)).status,200);
 assert.equal((await post(a.u,{action:'delete_my_data',confirm:'DELETE'})).status,200);
 const retained=sqlite.prepare('SELECT * FROM auction_bids WHERE id=?').get(receipt.id);
 assert.ok(retained);assert.equal(retained.amount,10000);assert.equal(retained.created_at,receipt.createdAt);assert.notEqual(retained.bidder_id,a.p.id);assert.notEqual(retained.request_id,receipt.requestId);
 const after=await item(s.u,id);assert.equal(after.auction.currentBid,null);assert.equal(after.auction.bidCount,1);
 assert.equal((await post(s.u,{action:'delete_my_data',confirm:'DELETE'})).status,409);
});
await test('Client valuation requires explicit catalog identity and complete exact conditions',async()=>{
 const row={issueId:10,...cgc,fmv:120,updatedAt:new Date(clock.now).toISOString(),sourceName:'Fixture',sourceUrl:'https://prices.example.test/10',fresh:true};
 assert.equal(helperContext.matchingValue({id:'inferred',bookId:'inferred',title:catalog[10].title,issue:'#'+catalog[10].number,grade:'CGC 9.8',condition:cgc},[row]),undefined);
 const exact=copy('client-match',10,cgc);
 for(const condition of [{...cgc,grade:'9.6'},{...cgc,label:'Signature Series'},{...cgc,printing:'Later printing'}])assert.equal(helperContext.matchingValue({...exact,condition},[row]),undefined);
 assert.equal(helperContext.matchingValue(exact,[row]),row);
 assert.equal(helperContext.matchingValue({...exact,title:'Wrong legacy series'},[row]),undefined);
 assert.equal(helperContext.matchingValue({...exact,issue:'#99999'},[row]),undefined);
 assert.equal(helperContext.cleanCondition({mode:'CGC',grade:'9.8',label:'Raw',printing:'First printing'}),undefined);
 assert.equal(helperContext.cleanCondition({mode:'CGC',grade:'9.8',label:'Universal',printing:''}),undefined);
 assert.deepEqual(helperResult(helperContext.cleanCondition({...raw,label:''})),raw);
});
await test('Client subtotals count physical copies and never fill missing FMV with zero',async()=>{
 const rows=[{issueId:10,...cgc,fmv:120,updatedAt:new Date(clock.now).toISOString(),sourceName:'CGC fixture',fresh:true},{issueId:24,...raw,fmv:20,updatedAt:new Date(clock.now).toISOString(),sourceName:'Raw fixture',fresh:true}],known=[copy('subtotal-one',10,cgc),copy('subtotal-two',10,cgc),copy('subtotal-three',24,raw)];
 const complete=helperResult(helperContext.summarize(known,rows));assert.equal(complete.total,26000);assert.equal(complete.pricedCount,3);assert.equal(complete.status,'complete');
 const partial=helperResult(helperContext.summarize([...known,copy('unknown-subtotal',11,cgc)],rows));assert.equal(partial.total,null);assert.equal(partial.knownTotal,26000);assert.equal(partial.pricedCount,3);assert.equal(partial.totalCount,4);assert.equal(partial.status,'partial');
 const none=helperResult(helperContext.summarize([copy('unknown-total',11,cgc)],rows));assert.equal(none.total,null);assert.equal(none.knownTotal,null);assert.equal(none.status,'unavailable');
});
await test('Client current values expire precisely at the age boundary and reject future estimates',async()=>{
 const row={issueId:10,...cgc,fmv:120,sourceName:'Fixture',fresh:true},item=copy('client-expiry',10,cgc);
 assert.ok(helperContext.matchingValue(item,[{...row,updatedAt:new Date(clock.now-30*86400000).toISOString()}]));
 assert.equal(helperContext.matchingValue(item,[{...row,updatedAt:new Date(clock.now-30*86400000-1).toISOString()}]),undefined);
 assert.equal(helperContext.matchingValue(item,[{...row,updatedAt:new Date(clock.now+1).toISOString()}]),undefined);
 assert.equal(helperContext.matchingValue(item,[{...row,updatedAt:new Date(clock.now).toISOString(),fresh:false}]),undefined);
});
await test('The countdown formats a server-provided end without choosing a winner',async()=>{
 assert.equal(helperContext.remaining(new Date(clock.now).toISOString(),clock.now),'Ending / refresh');
 assert.equal(helperContext.remaining(new Date(clock.now-1).toISOString(),clock.now),'Ending / refresh');
 assert.equal(helperContext.remaining(new Date(clock.now+1).toISOString(),clock.now),'0h 00m 01s');
 assert.equal(helperContext.remaining(new Date(clock.now+3600000).toISOString(),clock.now),'1h 00m 00s');
 assert.equal(helperContext.remaining(new Date(clock.now+86400000).toISOString(),clock.now),'1d 0h 0m');
});
await test('The vault rejects payloads above 1MB before replacing the current collection',async()=>{
 const s=await seller('vaultlimit');
 const r=await call(vault,'POST',s.u,{...empty,books:s.books,padding:'x'.repeat(1048577)});
 assert.equal(r.status,413);
 const saved=await call(vault,'GET',s.u);
 assert.equal(saved.status,200);assert.equal(saved.data.books.length,1);assert.equal(saved.data.books[0].id,s.books[0].id);
});
await test('Individual listing retrieval respects identity, blocks, seller visibility and withdrawal',async()=>{
 const s=await seller('listinglookup'),a=await collector('lookupviewer'),id=await published(s);
 let r=await get(a.u,'?kind=listing&id='+id);assert.equal(r.status,200);assert.equal(r.data.id,id);assert.equal(r.data.valuation.total,12000);noPrivateFields(r.data);
 assert.equal((await get(a.u,'?kind=listing&id='+crypto.randomUUID())).status,404);
 assert.equal((await post(a.u,{action:'block',to:s.p.id})).status,200);
 assert.equal((await get(a.u,'?kind=listing&id='+id)).status,404);
 assert.equal((await get(s.u,'?kind=listing&id='+id)).status,200);
 const b=await collector('unblockedview');
 assert.equal((await post(s.u,{action:'profile',handle:s.p.handle,name:s.p.name,bio:'Collector',tagline:'Private now',location:'Test',favorite:'Comics',since:2020,color:'red',featured:[],visible:false,dmOpen:true,accept:true})).status,200);
 assert.equal((await get(b.u,'?kind=listing&id='+id)).status,404);
 assert.equal((await makeProfile(s.u,s.p.handle)).status,200);
 assert.equal((await post(s.u,{action:'withdraw_listing',listingId:id})).status,200);
 assert.equal((await get(b.u,'?kind=listing&id='+id)).status,404);
});
await test('Only the owner can cancel an auction, after which bids end and inventory is reusable',async()=>{
 const s=await seller('ownercancel'),a=await collector('ownercancelbid'),id=await published(s,{saleType:'auction'});
 assert.equal((await bid(a.u,id,10000)).status,200);
 assert.equal((await post(s.u,{action:'cancel_auction',listingId:id})).status,403);
 assert.equal((await post(a.u,{action:'cancel_auction',listingId:id})).status,403);
 assert.equal((await post(owner,{action:'cancel_auction',listingId:id})).status,200);
 assert.equal((await get(a.u,'?kind=listing&id='+id)).status,404);
 const own=await get(s.u,'?kind=listing&id='+id);assert.equal(own.status,200);assert.equal(own.data.status,'cancelled');assert.equal(own.data.auction.ended,true);assert.equal(own.data.auction.minNextBid,null);
 statusIn(await bid(a.u,id,10500),[400,404,409]);
 assert.equal((await create(s)).status,200);
 assert.equal((await post(a.u,{action:'delete_my_data',confirm:'DELETE'})).status,200);
 assert.equal((await post(s.u,{action:'delete_my_data',confirm:'DELETE'})).status,200);
});
await test('Auction support summaries require owner identity and reject malformed exact lookup IDs',async()=>{
 const a=await collector('adminviewer');
 assert.equal((await get(null,'?kind=auctions_admin')).status,401);
 assert.equal((await get(a.u,'?kind=auctions_admin')).status,403);
 assert.equal((await get(a.u,'?kind=auctions_admin&id='+crypto.randomUUID())).status,403);
 assert.equal((await get(owner,'?kind=auctions_admin&id=not-a-uuid')).status,400);
 const missing=await get(owner,'?kind=auctions_admin&id='+crypto.randomUUID());assert.equal(missing.status,200);assert.deepEqual(missing.data.auctions,[]);
});
await test('Exact support lookup finds an older hidden auction outside the recent100 and exposes only safe summary fields',async()=>{
 const s=await seller('oldadmin'),a=await collector('oldadminbid'),id=await published(s,{saleType:'auction'});
 assert.equal((await bid(a.u,id,10000)).status,200);
 assert.equal((await post(s.u,{action:'profile',handle:s.p.handle,name:s.p.name,bio:'Collector',tagline:'Hidden seller',location:'Test',favorite:'Comics',since:2020,color:'red',featured:[],visible:false,dmOpen:false,accept:true})).status,200);
 // Direct fixtures isolate the support pagination rule, without bypassing any production mutation path.
 sqlite.prepare('UPDATE listings SET created_at=? WHERE id=?').run('2020-01-01T00:00:00Z',id);
 const seed=sqlite.prepare("INSERT INTO listings (id,seller_id,book_id,title,grade,description,price,shipping,photos,cert,status,created_at,sale_type,end_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
 for(let n=0;n<101;n++)seed.run(crypto.randomUUID(),s.p.id,'admin-fixture-'+n,'Recent cancelled preview '+n,'Raw','Safe support fixture',10000,0,'[]','','cancelled',new Date(clock.now+n).toISOString(),'auction',new Date(clock.now+86400000).toISOString());
 const recent=await get(owner,'?kind=auctions_admin');assert.equal(recent.status,200);assert.equal(recent.data.auctions.length,100);assert.equal(recent.data.auctions.some(row=>row.id===id),false);
 let exact=await get(owner,'?kind=auctions_admin&id='+id);assert.equal(exact.status,200);assert.equal(exact.data.auctions.length,1);
 const summary=exact.data.auctions[0];assert.equal(summary.id,id);assert.equal(summary.bidCount,1);assert.equal(summary.currentBid,10000);
 assert.deepEqual(Object.keys(summary).sort(),['bidCount','currentBid','endAt','id','price','seller','status','title'].sort());assert.deepEqual(Object.keys(summary.seller).sort(),['handle','name']);
 noPrivateFields(summary);assert.equal(JSON.stringify(summary).includes(a.p.id),false);assert.equal(JSON.stringify(summary).includes(s.photoId),false);
 assert.equal((await post(owner,{action:'cancel_auction',listingId:id})).status,200);
 exact=await get(owner,'?kind=auctions_admin&id='+id);assert.equal(exact.data.auctions[0].status,'cancelled');
 assert.equal((await post(s.u,{action:'delete_my_data',confirm:'DELETE'})).status,200);
});
await test('Private thread overview previews use each thread’s own latest message',async()=>{
 const a=await collector('chatpreviewa'),b=await collector('chatpreviewb'),c=await collector('chatpreviewc');
 const first=await post(a.u,{action:'start_thread',to:b.p.id,context:'Comic questions'}),second=await post(a.u,{action:'start_thread',to:c.p.id,context:'Collection questions'});
 assert.equal(first.status,200);assert.equal(second.status,200);assert.notEqual(first.data.threadId,second.data.threadId);
 assert.equal((await post(a.u,{action:'message',threadId:first.data.threadId,body:'Earlier first-thread question'})).status,200);
 assert.equal((await post(b.u,{action:'message',threadId:first.data.threadId,body:'Latest first-thread answer'})).status,200);
 assert.equal((await post(c.u,{action:'message',threadId:second.data.threadId,body:'Separate collection-thread answer'})).status,200);
 const overview=(await get(a.u)).data;
 assert.equal(overview.threads.find(t=>t.id===first.data.threadId).latest,'Latest first-thread answer');
 assert.equal(overview.threads.find(t=>t.id===second.data.threadId).latest,'Separate collection-thread answer');
 assert.equal((await get(b.u)).data.threads.some(t=>t.id===second.data.threadId),false);
});
await test('A vault edit after listing reads cannot publish a stale collection snapshot',async()=>{
 const s=await seller('revisionrace',[copy('revision-a'),copy('revision-b')]);let fired=false;
 beforeBatch=(statements)=>{if(!statements.some(statement=>/^insert\s+into\s+["`]?listings["`]?\s/i.test(statement.sql)))return;beforeBatch=null;fired=true;
  const stored=sqlite.prepare('SELECT data FROM collections WHERE user_id=?').get(s.u.userId),changed=JSON.parse(stored.data);changed.books[0].title='Updated before publication';delete changed.books[0].catalogId;
  sqlite.prepare('UPDATE collections SET data=?, revision=? WHERE user_id=?').run(JSON.stringify(changed),crypto.randomUUID(),s.u.userId);
 };
 const rejected=await create(s,{kind:'collection',bookIds:s.books.map(b=>b.id)});assert.ok(fired,'Publication injection point did not run');assert.equal(rejected.status,409);
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM listings WHERE seller_id=?').get(s.p.id).n,0);assert.equal(sqlite.prepare('SELECT count(*) AS n FROM listing_inventory WHERE seller_id=?').get(s.p.id).n,0);
 const id=await published(s,{kind:'collection',bookIds:s.books.map(b=>b.id)});assert.equal((await item(s.u,id)).items[0].title,'Updated before publication');
});
await test('A newly blocked bidder is rejected atomically after preliminary eligibility reads',async()=>{
 const s=await seller('eligibilityrace'),a=await collector('lateblockedbid'),id=await published(s,{saleType:'auction'});let fired=false;
 beforeBatch=(statements)=>{if(!statements.some(statement=>/^insert\s+into\s+["`]?auction_bids["`]?\s/i.test(statement.sql)))return;beforeBatch=null;fired=true;sqlite.prepare('INSERT INTO blocks (from_id,to_id) VALUES (?,?)').run(s.p.id,a.p.id)};
 const rejected=await bid(a.u,id,10000);assert.ok(fired,'Bid injection point did not run');assert.equal(rejected.status,409);
 const l=await item(s.u,id);assert.equal(l.auction.currentBid,null);assert.equal(l.auction.bidCount,0);assert.equal(sqlite.prepare('SELECT count(*) AS n FROM auction_bids WHERE listing_id=?').get(id).n,0);
});
await test('Concurrent retries of one request return one accepted receipt and one duplicate success',async()=>{
 const s=await seller('parallelretry'),a=await collector('parallelbidder'),id=await published(s,{saleType:'auction'}),requestId=crypto.randomUUID();
 const responses=await Promise.all([bid(a.u,id,10000,{requestId}),bid(a.u,id,10000,{requestId})]);
 assert.ok(responses.every(r=>r.status===200));assert.deepEqual(responses.map(r=>r.data.duplicate).sort(),[false,true]);
 const l=await item(a.u,id);assert.equal(l.auction.bidCount,1);assert.equal(l.auction.currentBid,10000);assert.ok(l.auction.yourBidId);
 assert.equal((await get(a.u,'?kind=export')).data.bids.filter(b=>b.listingId===id).length,1);
});
for(const role of ['seller','bidder'])await test('Account deletion racing with an accepted proposal rolls back for the '+role,async()=>{
 const s=await seller('deleterace'+role),a=await collector('deletionbid'+role),id=await published(s,{saleType:'auction'}),deleting=role==='seller'?s:a,receiptId=crypto.randomUUID();let fired=false;
 const rulesVersion=(await route('lib/community.ts')).previewRulesVersion;
 beforeBatch=(statements)=>{if(!statements.some(statement=>statement.sql.includes('deletion_started_at')))return;beforeBatch=null;fired=true;
  // This proposal commits immediately before the deletion transaction begins.
  sqlite.exec('BEGIN');
  sqlite.prepare('INSERT INTO auction_bids (id,listing_id,bidder_id,request_id,amount,status,sequence,created_at,rules_version) VALUES (?,?,?,?,?,?,?,?,?)').run(receiptId,id,a.p.id,crypto.randomUUID(),10000,'leading',1,new Date(clock.now).toISOString(),rulesVersion);
  sqlite.prepare('UPDATE listings SET current_bid=?,leader_id=?,leading_bid_id=?,bid_count=?,auction_version=? WHERE id=?').run(10000,a.p.id,receiptId,1,1,id);
  sqlite.exec('COMMIT');
 };
 const rejected=await post(deleting.u,{action:'delete_my_data',confirm:'DELETE'});assert.ok(fired,'Deletion injection point did not run');assert.equal(rejected.status,409,JSON.stringify(rejected.data));
 const profile=sqlite.prepare('SELECT visible,deletion_started_at FROM profiles WHERE id=?').get(deleting.p.id);assert.ok(profile);assert.equal(profile.visible,1);assert.equal(profile.deletion_started_at,null);
 const kept=sqlite.prepare('SELECT bidder_id,amount FROM auction_bids WHERE id=?').get(receiptId);assert.equal(kept.bidder_id,a.p.id);assert.equal(kept.amount,10000);
 const l=await item(s.u,id);assert.equal(l.auction.bidCount,1);assert.equal(l.auction.currentBid,10000);
 activeUser=s.u;assert.equal((await media.GET(new Request('https://comichuddle.test/api/media?id='+s.photoId))).status,200);
});
await test('A malformed stored auction deadline fails closed for bids and retractions',async()=>{
 const s=await seller('baddeadline'),a=await collector('deadlinebidder'),id=await published(s,{saleType:'auction'});
 assert.equal((await bid(a.u,id,10000)).status,200);const first=await item(a.u,id);
 sqlite.prepare('UPDATE listings SET end_at=? WHERE id=?').run('not-a-date',id);
 const invalid=await get(s.u,'?kind=listing&id='+id);assert.equal(invalid.status,200);assert.equal(invalid.data.auction.ended,true);assert.equal(invalid.data.auction.minNextBid,null);assert.equal(invalid.data.status,'ended');
 assert.equal((await bid(a.u,id,10500)).status,409);assert.equal((await retract(a.u,id,first.auction.yourBidId)).status,409);
 assert.equal(sqlite.prepare('SELECT bid_count FROM listings WHERE id=?').get(id).bid_count,1);
});
console.log('\nMarketplace route results: '+passed+' passed, '+failures.length+' failed.');
if(failures.length){console.error(JSON.stringify(failures,null,2));process.exitCode=1;}
