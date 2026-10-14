// Run: node --experimental-vm-modules checks/readiness-query-budget.mjs
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
let preparedQueries=0;
class Statement{
 constructor(sql,params=[]){this.sql=sql;this.params=params}
 bind(...args){return new Statement(this.sql,args)}
 async raw(){const s=sqlite.prepare(this.sql);s.setReturnArrays(true);return s.all(...this.params)}
 allSync(){const s=sqlite.prepare(this.sql);return {results:s.all(...this.params),success:true,meta:{}}}
 async all(){return this.allSync()}
 async run(){const r=sqlite.prepare(this.sql).run(...this.params);return {results:[],success:true,meta:{changes:r.changes,last_row_id:Number(r.lastInsertRowid)}}}
}
const objects=new Map();const bucket={async put(k,b){objects.set(k,new Uint8Array(b))},async delete(keys){for(const key of typeof keys==='string'?[keys]:keys)objects.delete(key)},async get(k){const v=objects.get(k);return v?{body:v}:null}};
const db={prepare:q=>{preparedQueries++;return new Statement(q)},async batch(statements){sqlite.exec('BEGIN');try{const result=statements.map(s=>s.allSync());sqlite.exec('COMMIT');return result}catch(e){sqlite.exec('ROLLBACK');throw e}}};
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

// Dense fixtures bypass mutation quotas and never touch hosted data.
function insert(table,row){const columns=Object.keys(row);sqlite.prepare('INSERT INTO '+table+' ('+columns.join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')').run(...columns.map(k=>row[k]));}
const stamp=new Date().toISOString(),profileIds=Array.from({length:202},()=>crypto.randomUUID()),userIds=Array.from({length:202},(_,i)=>'dense-user-'+i),providerIds=Array.from({length:200},()=>crypto.randomUUID()),jobIds=Array.from({length:200},()=>crypto.randomUUID());
for(let i=0;i<202;i++){
 insert('profiles',{id:profileIds[i],user_id:userIds[i],handle:'densecollector'+i,name:'Dense Collector '+i,bio:'Seeded QA profile',tagline:'Collector universe',location:'Test City',favorite:'Comics',since:2020,color:'red',featured:JSON.stringify(['copy-'+i+'-1']),visible:1,dm_open:1,created_at:stamp,moderated:0,rules_version:'2026-10-09-preview-1',rules_accepted_at:stamp});
 insert('collections',{user_id:userIds[i],data:JSON.stringify({...empty,books:[{id:'copy-'+i+'-1',title:'Planet Comics',issue:'#12',grade:'Raw VG',price:123456.78,catalogId:24},{id:'copy-'+i+'-2',title:'Saga',issue:'#1',grade:'Raw VF',price:123456.78,catalogId:4}],wants:[24],tradeBookIds:['copy-'+i+'-2']}),revision:crypto.randomUUID()});
}
for(let i=0;i<100;i++){
 const groupId=crypto.randomUUID(),seller=i%50,listingId=crypto.randomUUID(),photoId=crypto.randomUUID(),peer=i+1,threadId=crypto.randomUUID();
 insert('groups',{id:groupId,owner_id:profileIds[seller],name:'Dense Group '+i,description:'Dense fixture',color:'red',created_at:stamp});
 insert('memberships',{group_id:groupId,profile_id:profileIds[0],joined_at:stamp});
 insert('memberships',{group_id:groupId,profile_id:profileIds[1],joined_at:stamp});
 insert('media',{id:photoId,user_id:userIds[seller],content_type:'image/jpeg',created_at:stamp});
 insert('listings',{id:listingId,seller_id:profileIds[seller],book_id:'dense-listing-copy-'+i,issue_id:24,title:'Planet Comics #12',grade:'Raw VG',description:'Dense listing fixture',price:9500,shipping:800,photos:JSON.stringify([photoId]),cert:'',status:'active',created_at:stamp});
 const [a,b]=[profileIds[0],profileIds[peer]].sort();
 insert('threads',{id:threadId,pair:a+':'+b,a,b,context:'Dense conversation '+i,created_at:stamp});
 insert('messages',{id:crypto.randomUUID(),thread_id:threadId,profile_id:profileIds[peer],body:'Participant-only message '+i,created_at:stamp});
}
insert('blocks',{from_id:profileIds[0],to_id:profileIds[2]});
for(let i=0;i<200;i++){
 const owner=i+1;
 insert('care_providers',{id:providerIds[i],profile_id:profileIds[owner],name:'Dense Studio '+i,bio:'Independent care fixture',location:'Test City',services:'["pressing"]',prices:'{"pressing":1500}',specialties:'Comics',experience_since:2019,turnaround_min:7,turnaround_max:21,mail_in:1,dropoff:1,accepting:1,visible:1,submission_mode:'none',dealer_reference:'',website:'',logo_id:null,portfolio:'[]',shipping_address:'PRIVATE STUDIO ADDRESS '+i,shipping_notes:'PRIVATE PACKING NOTES '+i,terms:'Confirm care directly',created_at:stamp,updated_at:stamp,moderated:0});
 insert('care_jobs',{id:jobIds[i],provider_id:providerIds[i],provider_profile_id:profileIds[owner],requester_id:profileIds[0],thread_id:crypto.randomUUID(),books:JSON.stringify([{id:'copy-0-1',title:'Planet Comics',issue:'#12',grade:'Raw VG',catalogId:24,declaredValue:10000}]),services:'["pressing"]',notes:'Private care fixture',send_to_cgc:0,status:'completed',method:'mail',fee:1500,return_shipping:1000,cgc_estimate:0,quote_notes:'Quote fixture',quote_days:10,quote_revision:1,terms_snapshot:'Private agreed terms',shipping_address:'PRIVATE STUDIO ADDRESS '+i,shipping_notes:'PRIVATE PACKING NOTES '+i,return_address:'PRIVATE COLLECTOR RETURN',incoming_carrier:'USPS',incoming_tracking:'INCOMING-'+i,outgoing_carrier:'USPS',outgoing_tracking:'RETURN-'+i,submission_ref:'',created_at:stamp,updated_at:stamp});
 insert('care_events',{id:crypto.randomUUID(),job_id:jobIds[i],actor_id:profileIds[owner],status:'completed',note:'Private care event',photos:'[]',created_at:stamp});
 for(const author of [0,owner%201+1,(owner+1)%201+1])insert('care_reviews',{id:crypto.randomUUID(),provider_id:providerIds[i],author_id:profileIds[author],job_id:author===0?jobIds[i]:null,rating:4,quality:4,communication:4,timeliness:4,title:'Dense review',body:'Fixture personal experience',created_at:stamp,updated_at:stamp});
}
const viewer={userId:userIds[0],email:'denseviewer@example.test',displayName:'Dense Collector 0'};
let count=preparedQueries;const socialResult=await get(viewer),socialQueries=preparedQueries-count;
assert.equal(socialResult.status,200);assert.ok(socialQueries<=40,'Social aggregate made '+socialQueries+' database queries; budget is 40');
assert.equal(socialResult.data.people.some(p=>p.id===profileIds[2]),false);assert.equal(socialResult.data.listings.some(l=>l.sellerId===profileIds[2]),false);
assert.ok(socialResult.data.people.length>=40);assert.equal(socialResult.data.groups.length,100);assert.equal(socialResult.data.listings.length,98);assert.equal(socialResult.data.threads.length,100);
for(const p of socialResult.data.people)for(const book of [...p.showcase,...p.tradeBooks])assert.equal(book.price,undefined);
for(const group of socialResult.data.groups){assert.equal(group.members,2);assert.equal(group.joined,true)}
count=preparedQueries;const careResult=await call(care,'GET',viewer),careQueries=preparedQueries-count;
assert.equal(careResult.status,200);assert.ok(careQueries<=40,'Workshop aggregate made '+careQueries+' database queries; budget is 40');
assert.equal(careResult.data.providers.length,199);assert.equal(careResult.data.jobs.length,200);assert.equal(careResult.data.providers.some(p=>p.profileId===profileIds[2]),false);
for(const provider of careResult.data.providers){assert.equal(provider.shippingAddress,undefined);assert.equal(provider.shippingNotes,undefined);assert.equal(provider.rating,4);assert.equal(provider.reviewCount,3)}
assert.ok(careResult.data.jobs.every(j=>j.requesterId===profileIds[0]));assert.ok(careResult.data.jobs.every(j=>j.returnAddress==='PRIVATE COLLECTOR RETURN'));
count=preparedQueries;const detail=await call(care,'GET',viewer,null,'?kind=job&id='+jobIds[0]),detailQueries=preparedQueries-count;
assert.equal(detail.status,200);assert.ok(detailQueries<=10,'Workshop job detail made '+detailQueries+' database queries; budget is 10');assert.equal(detail.data.events.length,1);assert.equal(detail.data.events[0].authorName,'Dense Collector 1');
const outsider={userId:userIds[201],email:'outsider@example.test',displayName:'Outside Collector'};assert.equal((await call(care,'GET',outsider,null,'?kind=job&id='+jobIds[0])).status,404);
console.log('PASS: dense fixture budgets: social '+socialQueries+'/40 queries (50 collectors, 100 groups/listings/threads); workshop '+careQueries+'/40 (200 studios and 200 private jobs); job detail '+detailQueries+'/10. Blocks, private costs, addresses and custody ownership preserved.');
