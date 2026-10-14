// Run: node --experimental-vm-modules checks/network-smoke.mjs
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
class Statement{
 constructor(sql,params=[]){this.sql=sql;this.params=params}
 bind(...args){return new Statement(this.sql,args)}
 async raw(){const s=sqlite.prepare(this.sql);s.setReturnArrays(true);return s.all(...this.params)}
 allSync(){const s=sqlite.prepare(this.sql);return {results:s.all(...this.params),success:true,meta:{}}}
 async all(){return this.allSync()}
 async run(){const r=sqlite.prepare(this.sql).run(...this.params);return {results:[],success:true,meta:{changes:r.changes,last_row_id:Number(r.lastInsertRowid)}}}
}
const objects=new Map();const bucket={async put(k,b){objects.set(k,new Uint8Array(b))},async delete(keys){for(const key of typeof keys==='string'?[keys]:keys)objects.delete(key)},async get(k){const v=objects.get(k);return v?{body:v}:null}};
const db={prepare:q=>new Statement(q),async batch(statements){sqlite.exec('BEGIN');try{const result=statements.map(s=>s.allSync());sqlite.exec('COMMIT');return result}catch(e){sqlite.exec('ROLLBACK');throw e}}};
let activeUser=null;const env={DB:db,BUCKET:bucket};
const context=vm.createContext({console,crypto:webcrypto,Request,Response,URL,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,Date,setTimeout,clearTimeout});const cache=new Map();
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
 activeUser=user;const headers=method==='POST'?{'Origin':origin,'Content-Type':'application/json'}:{};
 // Most fixtures model an ordinary save with its current version. Conflict tests bypass this helper.
 if(r===vault&&method==='POST'){const current=await vault.GET();headers['If-Match']=current.headers.get('etag')||'"empty"'}
 const req=new Request('https://comichuddle.test/api/'+query,{method,headers,body:method==='POST'?JSON.stringify(body):undefined});const res=await r[method](req);let data;try{data=await res.json()}catch{data=null}return {status:res.status,data,headers:Object.fromEntries(res.headers)};
}
const get=(user,query='')=>call(social,'GET',user,null,query);
const post=(user,body)=>call(social,'POST',user,body);
const makeProfile=(user,handle)=>post(user,{action:'profile',handle,name:user.displayName,bio:'Collector',tagline:'My shelf. My universe.',location:'Test City',favorite:'Comics',since:2020,color:'red',featured:[],visible:true,dmOpen:true,accept:true});
const empty={profile:'Collector',books:[],wants:[],posts:[],likes:[],tradeBookIds:[],clubs:[],watchlist:[],tradeDrafts:[]};
assert.equal((await get(null)).status,401);
assert.equal((await call(social,'POST',alice,{action:'profile'},'','https://evil.test')).status,403);
assert.equal((await post(alice,{action:'join',groupId:'key-hunters',join:true})).status,403);
assert.equal((await makeProfile(alice,'alice_grails')).status,200);assert.equal((await makeProfile(bob,'bob_grails')).status,200);assert.equal((await makeProfile(eve,'eve_grails')).status,200);
assert.equal((await makeProfile(eve,'alice_grails')).status,409);
const aBook={id:'a-saga',title:'Saga',issue:'#1',grade:'Raw VF',price:1,catalogId:4};const bBook={id:'b-planet',title:'Planet Comics',issue:'#12',grade:'Raw VG',price:100,catalogId:24};
assert.equal((await call(vault,'POST',alice,{...empty,books:[aBook],wants:[24],tradeBookIds:[aBook.id]})).status,200);
assert.equal((await call(vault,'POST',bob,{...empty,books:[bBook],wants:[4],tradeBookIds:[bBook.id]})).status,200);
assert.equal((await call(vault,'GET',eve)).data,null);
let a=(await get(alice)).data,b=(await get(bob)).data;assert.equal(a.me.stats.comics,1);assert.equal(a.groups.length,4);assert.equal(a.groups[0].members,0);
assert.equal(matcher.swipeCards(a.me,{...empty,books:[aBook],wants:[24],tradeBookIds:[aBook.id]},a.people,[]).length,1);
assert.equal((await post(alice,{action:'swipe',to:b.me.id,giveId:'not-owned',getId:bBook.id,direction:'like'})).status,409);
const first=await post(alice,{action:'swipe',to:b.me.id,giveId:aBook.id,getId:bBook.id,direction:'like'});assert.equal(first.data.matched,false);assert.equal((await get(alice)).data.threads.length,0);
const second=await post(bob,{action:'swipe',to:a.me.id,giveId:bBook.id,getId:aBook.id,direction:'like'});assert.equal(second.data.matched,true);assert.ok(second.data.threadId);
const threadId=second.data.threadId;
assert.equal((await post(alice,{action:'message',threadId,body:'Is the spine intact?'})).status,200);
assert.equal((await get(bob,'?kind=messages&thread='+threadId)).data.messages[0].body,'Is the spine intact?');
assert.equal((await get(eve,'?kind=messages&thread='+threadId)).status,404);assert.equal((await post(eve,{action:'message',threadId,body:'Intrusion'})).status,404);
assert.equal((await post(alice,{action:'post',groupId:'key-hunters',channel:'general',body:'My first grail'})).status,403);
assert.equal((await post(alice,{action:'join',groupId:'key-hunters',join:true})).status,200);
assert.equal((await post(alice,{action:'post',groupId:'key-hunters',channel:'showcase',body:'My first grail'})).status,200);
assert.equal((await get(bob,'?kind=posts&group=key-hunters&channel=showcase')).data.posts.length,0);
await post(bob,{action:'join',groupId:'key-hunters',join:true});const groupPosts=(await get(bob,'?kind=posts&group=key-hunters&channel=showcase')).data.posts;assert.equal(groupPosts.length,1);assert.equal(groupPosts[0].canDelete,false);
assert.equal((await post(bob,{action:'delete_post',postId:groupPosts[0].id})).status,403);
const photo=await readFile(path.join(root,'public/covers/planet-12.jpg'));activeUser=bob;let upload=await media.POST(new Request('https://comichuddle.test/api/media',{method:'POST',headers:{Origin:'https://comichuddle.test','Content-Type':'image/jpeg'},body:photo}));assert.equal(upload.status,200);const photoId=(await upload.json()).id;
activeUser=alice;assert.equal((await media.GET(new Request('https://comichuddle.test/api/media?id='+photoId))).status,404);
assert.equal((await call(vault,'POST',alice,{...empty,books:[{...aBook,photoId}]})).status,403);
const list=await post(bob,{action:'listing',bookId:bBook.id,description:'My own copy. Spine wear.',price:9500,shipping:800,photos:[photoId],cert:'',attest:true});assert.equal(list.status,200);const listingId=list.data.listingId;
activeUser=alice;assert.equal((await media.GET(new Request('https://comichuddle.test/api/media?id='+photoId))).status,200);
assert.equal((await post(alice,{action:'withdraw_listing',listingId})).status,404);
assert.equal((await post(bob,{action:'buy',listingId})).status,400);assert.equal((await post(alice,{action:'buy',listingId})).status,503);
assert.equal((await post(alice,{action:'offer',listingId,amount:9000,note:'Would you accept this?'})).status,200);const offer=(await get(bob)).data.offers[0];assert.equal(offer.mine,false);
assert.equal((await post(eve,{action:'offer_response',offerId:offer.id,status:'accepted'})).status,404);assert.equal((await post(bob,{action:'offer_response',offerId:offer.id,status:'accepted'})).status,200);
const msg=(await get(bob,'?kind=messages&thread='+threadId)).data.messages[0];await post(bob,{action:'report',targetType:'message',targetId:msg.id,reason:'Test report'});
assert.equal((await get(eve,'?kind=reports')).status,403);const reports=(await get(owner,'?kind=reports')).data.reports;assert.equal(reports.length,1);assert.equal(reports[0].content,'Is the spine intact?');assert.equal((await post(owner,{action:'review_report',reportId:reports[0].id,remove:false})).status,200);

// Press Room: real registrations, reviews and private custody workflow.
const carePost=(user,body)=>call(care,'POST',user,body);
const careGet=(user,query='')=>call(care,'GET',user,null,query);
assert.equal((await careGet(null)).status,401);
assert.equal((await call(care,'POST',bob,{action:'provider'},'','https://evil.test')).status,403);
assert.equal((await careGet(alice)).data.providers.length,0);
const providerForm={action:'provider',name:'Bob Test Pressing',bio:'Independent care. Real test studio.',location:'Test City, MN',services:['pressing','dry_cleaning','cgc'],prices:{pressing:1500,dry_cleaning:500,cgc:null},specialties:'Modern books',experienceSince:2019,turnaroundMin:7,turnaroundMax:21,mailIn:true,dropoff:true,accepting:true,visible:true,submissionMode:'prepare_only',dealerReference:'',dealerAttest:false,website:'https://studio.example.test',logoId:photoId,portfolio:[],shippingAddress:'PRIVATE BOB INTAKE ADDRESS',shippingNotes:'Private packing instructions',terms:'No guaranteed grade. Confirm insurance and payment directly.',attest:true};
assert.equal((await carePost(bob,{...providerForm,submissionMode:'dealer'})).status,400);
assert.equal((await carePost(bob,{...providerForm,turnaroundMax:2})).status,400);
assert.equal((await carePost(alice,providerForm)).status,403); // Cannot attach someone else's logo.
assert.equal((await carePost(bob,providerForm)).status,200);
let careData=(await careGet(bob)).data;const providerId=careData.mine.id;
assert.equal(careData.mine.shippingAddress,'PRIVATE BOB INTAKE ADDRESS');
let publicProvider=(await careGet(alice)).data.providers[0];assert.equal(publicProvider.id,providerId);assert.equal(publicProvider.shippingAddress,undefined);assert.equal(publicProvider.shippingNotes,undefined);assert.equal(publicProvider.rating,null);assert.equal(publicProvider.rank,null);
assert.equal((await get(bob)).data.me.provider.id,providerId);
const request={action:'request',providerId,bookIds:[aBook.id],declaredValues:{[aBook.id]:10000},services:['pressing','dry_cleaning'],notes:'Check spine before care.',sendToCgc:false,method:'mail',scopeConsent:true};
assert.equal((await carePost(alice,{...request,services:['cgc'],sendToCgc:true})).status,400);
assert.equal((await carePost(alice,{...request,bookIds:['not-owned']})).status,400);
assert.equal((await carePost(bob,{...request,bookIds:[bBook.id]})).status,400);
const requested=await carePost(alice,request);assert.equal(requested.status,200);const jobId=requested.data.jobId;assert.equal(requested.data.threadId,threadId);
const jobGet=user=>careGet(user,'?kind=job&id='+jobId);
let job=(await jobGet(alice)).data.job;assert.equal(job.books[0].declaredValue,10000);assert.equal(job.books[0].price,undefined);assert.equal(job.shippingAddress,'');assert.equal((await jobGet(eve)).status,404);assert.equal((await careGet(eve)).data.jobs.length,0);
const quote={action:'quote',jobId,fee:2000,returnShipping:1500,cgcEstimate:0,quoteDays:10,quoteNotes:'Care only. Payment arranged directly.',revision:0};
assert.equal((await carePost(alice,quote)).status,403);assert.equal((await carePost(eve,quote)).status,404);assert.equal((await carePost(bob,quote)).status,200);
job=(await jobGet(alice)).data.job;assert.equal(job.status,'quoted');assert.equal(job.shippingAddress,'');assert.equal(job.quoteRevision,1);
assert.equal((await carePost(bob,{...quote,revision:0})).status,409);
assert.equal((await carePost(bob,{...quote,revision:1,fee:2500})).status,200);
const approval={action:'approve',jobId,revision:1,returnAddress:'PRIVATE ALICE RETURN ADDRESS',riskConsent:true,termsConsent:true,cgcConsent:false};
assert.equal((await carePost(alice,approval)).status,409);assert.equal((await carePost(alice,{...approval,revision:2})).status,200);
job=(await jobGet(alice)).data.job;assert.equal(job.shippingAddress,'PRIVATE BOB INTAKE ADDRESS');assert.equal(job.fee,2500);assert.equal((await jobGet(bob)).data.job.returnAddress,'PRIVATE ALICE RETURN ADDRESS');
assert.equal((await post(bob,{action:'delete_my_data',confirm:'DELETE'})).status,409);assert.ok((await get(bob)).data.me);
const stage={action:'stage',jobId,status:'in_transit',note:'Packed and shipped.',photos:[],carrier:'USPS',tracking:'INCOMING-TEST',submissionRef:''};
assert.equal((await carePost(bob,stage)).status,403);assert.equal((await carePost(alice,{...stage,tracking:''})).status,400);assert.equal((await carePost(alice,stage)).status,200);
assert.equal((await carePost(alice,{...stage,status:'received'})).status,403);
activeUser=bob;upload=await media.POST(new Request('https://comichuddle.test/api/media',{method:'POST',headers:{Origin:'https://comichuddle.test','Content-Type':'image/jpeg'},body:photo}));assert.equal(upload.status,200);const privateCarePhoto=(await upload.json()).id;
activeUser=alice;assert.equal((await media.GET(new Request('https://comichuddle.test/api/media?id='+privateCarePhoto))).status,404);
assert.equal((await carePost(bob,{...stage,status:'received',photos:[privateCarePhoto],note:'Contents and arrival condition documented.'})).status,200);
activeUser=alice;assert.equal((await media.GET(new Request('https://comichuddle.test/api/media?id='+privateCarePhoto))).status,200);
activeUser=eve;assert.equal((await media.GET(new Request('https://comichuddle.test/api/media?id='+privateCarePhoto))).status,404);
assert.equal((await carePost(bob,{...stage,status:'pressing'})).status,200);
assert.equal((await carePost(bob,{...stage,status:'at_grading',submissionRef:'INVALID'})).status,403); // No grading was authorized.
assert.equal((await carePost(bob,{...stage,status:'returning',tracking:'RETURN-TEST'})).status,200);
assert.equal((await carePost(bob,{...stage,status:'completed'})).status,403);
assert.equal((await carePost(alice,{...stage,status:'completed',note:'Books received.'})).status,200);
let timeline=(await jobGet(alice)).data.events;assert.equal(timeline.at(-1).status,'completed');assert.ok(timeline.some(e=>e.photos.includes(privateCarePhoto)));
const review={action:'review',providerId,rating:5,quality:5,communication:4,timeliness:4,title:'Careful communication',body:'My own experience with the care and return process.',attest:true};
assert.equal((await carePost(bob,review)).status,403);assert.equal((await carePost(alice,{...review,rating:0})).status,400);assert.equal((await carePost(alice,review)).status,200);
assert.equal((await carePost(alice,{...review,title:'Updated my experience',rating:4})).status,200);
let providerDetails=(await careGet(alice,'?kind=provider&id='+providerId)).data;assert.equal(providerDetails.provider.reviewCount,1);assert.equal(providerDetails.provider.rating,4);assert.equal(providerDetails.reviews[0].completedRequest,true);
assert.equal((await carePost(bob,{action:'delete_review',reviewId:providerDetails.reviews[0].id})).status,404);
assert.equal((await carePost(eve,{...review,rating:3})).status,200);assert.equal((await makeProfile(owner,'owner_test')).status,200);assert.equal((await carePost(owner,{...review,rating:5})).status,200);
publicProvider=(await careGet(alice)).data.providers[0];assert.equal(publicProvider.rank,1);assert.equal(publicProvider.reviewCount,3);assert.equal(publicProvider.rating,4);assert.equal(publicProvider.completedReviewCount,1);
const eveReview=(await careGet(eve,'?kind=provider&id='+providerId)).data.reviews.find(r=>r.mine);assert.equal(eveReview.completedRequest,false);
assert.equal((await post(alice,{action:'report',targetType:'care_review',targetId:eveReview.id,reason:'Owner moderation test'})).status,200);const careReport=(await get(owner,'?kind=reports')).data.reports[0];assert.match(careReport.content,/Careful communication/);assert.equal((await post(owner,{action:'review_report',reportId:careReport.id,remove:true})).status,200);assert.equal((await careGet(alice)).data.providers[0].rank,null);
// A real dealer submission requires explicit authorization and current provider eligibility.
assert.equal((await carePost(bob,{...providerForm,submissionMode:'dealer',dealerReference:'https://dealer.example.test',dealerAttest:true})).status,200);
const gradingRequest=await carePost(alice,{...request,services:['pressing','cgc'],sendToCgc:true});assert.equal(gradingRequest.status,200);const gradingId=gradingRequest.data.jobId;
assert.equal((await carePost(bob,{...quote,jobId:gradingId,cgcEstimate:7500})).status,200);
assert.equal((await carePost(alice,{...approval,jobId:gradingId,revision:1})).status,400);
assert.equal((await carePost(alice,{...approval,jobId:gradingId,revision:1,cgcConsent:true})).status,200);
assert.equal((await carePost(bob,{...stage,jobId:gradingId,status:'received'})).status,200);assert.equal((await carePost(bob,{...stage,jobId:gradingId,status:'pressing'})).status,200);
assert.equal((await carePost(bob,{...providerForm})).status,200); // Dealer eligibility removed.
assert.equal((await carePost(bob,{...stage,jobId:gradingId,status:'at_grading',submissionRef:'CGC-TEST'})).status,400);
assert.equal((await carePost(bob,{...providerForm,submissionMode:'dealer',dealerReference:'https://dealer.example.test',dealerAttest:true})).status,200);
assert.equal((await carePost(bob,{...stage,jobId:gradingId,status:'at_grading',submissionRef:''})).status,400);assert.equal((await carePost(bob,{...stage,jobId:gradingId,status:'at_grading',submissionRef:'CGC-TEST'})).status,200);
assert.equal((await carePost(bob,{...stage,jobId:gradingId,status:'returning'})).status,200);assert.equal((await carePost(alice,{...stage,jobId:gradingId,status:'completed'})).status,200);


// Unsuitable books can be returned without inventing a care or grading stage.
const unsuitable=await carePost(alice,{...request,method:'dropoff'});assert.equal(unsuitable.status,200);const unsuitableId=unsuitable.data.jobId;
assert.equal((await carePost(bob,{...quote,jobId:unsuitableId})).status,200);assert.equal((await carePost(alice,{...approval,jobId:unsuitableId,revision:1,returnAddress:''})).status,200);
assert.equal((await careGet(alice,'?kind=job&id='+unsuitableId)).data.job.returnShipping,0);
assert.equal((await carePost(alice,{...stage,jobId:unsuitableId})).status,400);
assert.equal((await carePost(bob,{...stage,jobId:unsuitableId,status:'received'})).status,200);
assert.equal((await carePost(bob,{...stage,jobId:unsuitableId,status:'returning',note:''})).status,400);
assert.equal((await carePost(bob,{...stage,jobId:unsuitableId,status:'returning',note:'Inspection found brittle paper. Collector agreed to return without care.'})).status,200);
assert.equal((await carePost(alice,{...stage,jobId:unsuitableId,status:'completed'})).status,200);
const unsuitableEvents=(await careGet(alice,'?kind=job&id='+unsuitableId)).data.events;assert.equal(unsuitableEvents.some(e=>e.status==='pressing'),false);

assert.equal((await post(alice,{action:'block',to:b.me.id})).status,200);assert.equal((await post(bob,{action:'message',threadId,body:'Blocked message'})).status,403);assert.equal((await get(alice)).data.people.some(p=>p.id===b.me.id),false);
assert.equal((await get(alice,'?kind=profile&handle=bob_grails')).status,404);
assert.equal((await careGet(alice)).data.providers.length,0);assert.equal((await carePost(alice,request)).status,400);assert.equal((await jobGet(alice)).status,200); // Existing private records remain available.
activeUser=alice;assert.equal((await media.GET(new Request('https://comichuddle.test/api/media?id='+privateCarePhoto))).status,200);
assert.equal((await media.GET(new Request('https://comichuddle.test/api/media?id='+photoId))).status,404);
activeUser=eve;assert.equal((await media.GET(new Request('https://comichuddle.test/api/media?id='+privateCarePhoto))).status,404);
assert.equal((await post(bob,{action:'delete_my_data',confirm:'WRONG'})).status,400);assert.equal((await post(bob,{action:'delete_my_data',confirm:'DELETE'})).status,200);
assert.equal((await get(alice)).data.listings.length,0);assert.equal((await call(vault,'GET',bob)).data,null);assert.equal(objects.size,0);assert.equal((await get(alice)).data.threads.length,0);
assert.equal((await careGet(alice)).data.jobs.length,0);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM care_events').get().n,0);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM care_reviews').get().n,0);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM care_providers').get().n,0);
assert.equal(catalog.length,43);assert.equal(catalog[24].number,'12');assert.equal(catalog[30].title,'Fantastic Four');assert.equal(catalog[33].year,1963);assert.equal(catalog[38].number,'5');assert.equal(catalog[41].title,'Daredevil');
// Owner imports preserve rights provenance and cannot manufacture current market coverage.
const values=await route('app/api/values/route.ts');
const valueRow={issueId:10,mode:'CGC',grade:'9.8',label:'Universal',printing:'First printing',fmv:120,low:100,high:140,sales:3,windowDays:90,updatedAt:new Date(Date.now()-10000).toISOString(),sourceName:'Test licensed provider',sourceUrl:'https://values.example.test/book/10'};
const dataset={currency:'USD',rightsConfirmed:true,licenseReference:'TEST-CONTRACT-ONLY',rightsExpiresAt:new Date(Date.now()+86400000).toISOString(),rows:[valueRow]};
assert.equal((await call(values,'GET',alice)).data.connected,false);
assert.equal((await call(values,'POST',null,dataset)).status,401);
assert.equal((await call(values,'POST',alice,dataset)).status,403);
assert.equal((await call(values,'POST',owner,dataset,'','https://evil.test')).status,403);
assert.equal((await call(values,'POST',owner,{...dataset,rightsConfirmed:false})).status,400);
assert.equal((await call(values,'POST',owner,{...dataset,rightsExpiresAt:'2020-01-01T00:00:00.000Z'})).status,400);
assert.equal((await call(values,'POST',owner,{...dataset,rows:[{...valueRow,low:130}]})).status,400);
assert.equal((await call(values,'POST',owner,{...dataset,rows:[{...valueRow,issueId:catalog.length}]})).status,400);
assert.equal((await call(values,'POST',owner,{...dataset,rows:[{...valueRow,updatedAt:new Date(Date.now()+86400000).toISOString()}]})).status,400);
assert.equal((await call(values,'POST',owner,{...dataset,rows:[{...valueRow,mode:'Raw'}]})).status,400);
assert.equal((await call(values,'POST',owner,{...dataset,rows:[{...valueRow,sourceUrl:'javascript:alert(1)'}]})).status,400);
assert.equal((await call(values,'POST',owner,{...dataset,rows:[valueRow,valueRow]})).status,400);
assert.equal((await call(values,'POST',owner,dataset)).data.saved,1);
let prices=(await call(values,'GET',alice)).data;assert.equal(prices.connected,true);assert.equal(prices.rows[0].fmv,120);assert.equal(prices.rows[0].licenseReference,undefined);assert.equal(prices.rows[0].rightsExpiresAt,undefined);
assert.equal(sqlite.prepare('SELECT license_reference FROM market_values').get().license_reference,'TEST-CONTRACT-ONLY');
assert.equal((await call(values,'POST',owner,{...dataset,rows:[{...valueRow,fmv:130}]})).status,200);assert.equal((await call(values,'GET',alice)).data.rows.length,1);
assert.equal((await call(values,'POST',owner,{...dataset,rows:[{...valueRow,updatedAt:'2020-01-01T00:00:00.000Z'}]})).status,200);
prices=(await call(values,'GET',alice)).data;assert.equal(prices.connected,false);assert.equal(prices.rows[0].fresh,false);
sqlite.exec("UPDATE market_values SET rights_expires_at='2020-01-01T00:00:00.000Z'");assert.equal((await call(values,'GET',alice)).data.rows.length,0);
const sales=(await route('lib/reported-sales.ts')).reportedSales;assert.equal(sales.length,30);for(const sale of sales){assert.ok(catalog[sale.issueId]);assert.ok(sale.amount>0);assert.ok(sale.source.startsWith('https://www.cgcgrading.com/'));assert.ok(sale.date<new Date().toISOString());if(sale.dateEnd)assert.ok(sale.dateEnd>=sale.date)}
console.log('PASS: migrations; identity and origin; profile uniqueness; private vault and photos; group membership; reciprocal swipes; mutual match; private messaging; listings and offers; unavailable checkout; owner moderation; blocks; account deletion; catalog identity; pressing registration; private addresses and photos; quote revisions; role-restricted care stages; dealer-only CGC authorization; member reviews and leaderboard; care moderation and deletion.');
