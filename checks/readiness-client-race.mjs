// Run: node checks/readiness-client-race.mjs
// Execute the actual client loaders with controlled delayed responses; no browser or hosted records.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(process.argv[2]||'app/network.tsx','utf8');
const ast=ts.createSourceFile('app/network.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const functions=new Map();let chatEffect;
function walk(node){
 if(ts.isFunctionDeclaration(node)&&node.name&&['loadChat','loadPosts','loadProfile','selectProfile'].includes(node.name.text))functions.set(node.name.text,node.getText(ast));
 if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect'&&node.arguments[0]&&node.arguments[1]?.getText(ast)==='[threadId,tab]')chatEffect=node.arguments[0].getText(ast);
 ts.forEachChild(node,walk);
}
walk(ast);assert.ok(functions.has('loadChat'));assert.ok(functions.has('loadPosts'));assert.ok(chatEffect);
const compile=code=>ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
function fixture(){
 const requests=[],state={profile:null,profileLoading:false,tabs:[],chat:[],posts:[],chatBlocked:false,chatError:'',message:'Draft for old peer',chatLoading:false,postsLoading:false,notices:[]};
 const context=vm.createContext({console,encodeURIComponent,Error,Promise,tab:'Messages',threadId:'a',selectedGroup:'g1',channel:'general',group:{joined:true},profileRequest:{current:0},currentProfileSelection:{current:''},chatRequest:{current:0},postsRequest:{current:0},currentChatSelection:{current:''},currentPostSelection:{current:''},setInterval:()=>1,clearInterval:()=>{},
 fetch:url=>new Promise((resolve,reject)=>requests.push({url,resolve,reject})),
 go:v=>{state.tabs.push(v);context.tab=v;if(v!=='Collectors')context.currentProfileSelection.current=''},setProfile:v=>state.profile=v,setProfileLoading:v=>state.profileLoading=v,setChat:v=>state.chat=v,setPosts:v=>state.posts=v,setChatBlocked:v=>state.chatBlocked=v,setChatError:v=>state.chatError=v,setMessage:v=>state.message=v,setChatLoading:v=>state.chatLoading=v,setPostsLoading:v=>state.postsLoading=v,notice:v=>state.notices.push(v)});
 vm.runInContext(compile([...functions.values()].join('\n')+'\nconst qaChatEffect = '+chatEffect+';'),context);
 function select(kind,id,channel='general'){
  if(kind==='chat'){context.tab='Messages';context.threadId=id;context.currentChatSelection.current=id;}
  else{context.tab='Community';context.selectedGroup=id;context.channel=channel;context.group={joined:true};context.currentPostSelection.current=id+'|'+channel;}
 }
 function response(index,data,ok=true){requests[index].resolve({ok,json:async()=>data})}
 return {context,state,requests,select,response,profile:handle=>{context.qaHandle=handle;return vm.runInContext('loadProfile(qaHandle)',context)},load:kind=>vm.runInContext(kind==='chat'?'loadChat()':'loadPosts()',context),effect:()=>vm.runInContext('qaChatEffect()',context)};
}
let passed=0;const failures=[];
async function test(name,run){try{await run();passed++;console.log('PASS: '+name)}catch(e){failures.push({name,message:e.message});console.error('FAIL: '+name+' — '+e.message)}}
for(const kind of ['chat','posts']){
 const field=kind==='chat'?'chat':'posts',payload=values=>kind==='chat'?{messages:values,blocked:false}:{posts:values};
 await test(kind+': an old selection cannot overwrite a new selection',async()=>{const f=fixture();f.select(kind,'a');const first=f.load(kind);f.select(kind,'b');const second=f.load(kind);f.response(1,payload(['new']));await second;f.response(0,payload(['old']));await first;assert.deepEqual(Array.from(f.state[field]),['new']);});
 await test(kind+': render selection changes invalidate results before the next effect',async()=>{const f=fixture();f.select(kind,'a');const first=f.load(kind);f.select(kind,'b');f.response(0,payload(['old']));await first;assert.equal(f.state[field].length,0);});
 await test(kind+': reverse-order refreshes keep the most recent response',async()=>{const f=fixture();f.select(kind,'a');const first=f.load(kind),second=f.load(kind);f.response(1,payload(['new']));await second;f.response(0,payload(['old']));await first;assert.deepEqual(Array.from(f.state[field]),['new']);});
 await test(kind+': a late failure cannot replace a newer successful state',async()=>{const f=fixture();f.select(kind,'a');const first=f.load(kind),second=f.load(kind);f.response(1,payload(['new']));await second;f.requests[0].reject(new Error('Old request failed'));await first;assert.deepEqual(Array.from(f.state[field]),['new']);assert.equal(f.state.chatError,'');assert.deepEqual(f.state.notices,[]);});
}
await test('Conversation selection clears a draft addressed to the previous peer',async()=>{const f=fixture();f.select('chat','b');const cleanup=f.effect();assert.equal(f.state.message,'');f.response(0,{messages:[],blocked:false});if(typeof cleanup==='function')cleanup();await Promise.resolve();await Promise.resolve();});
await test('Conversation effect cleanup invalidates its outstanding request',async()=>{const f=fixture();f.select('chat','a');const cleanup=f.effect();assert.equal(typeof cleanup,'function');cleanup();f.response(0,{messages:['old'],blocked:false});for(let i=0;i<8;i++)await Promise.resolve();assert.equal(f.state.chat.length,0);});

for(const kind of ['chat','posts']){
 await test(kind+': stale finalizers cannot stop the latest loading state',async()=>{const f=fixture();f.select(kind,'a');const first=kind==='chat'?vm.runInContext('loadChat(true)',f.context):f.load(kind),second=kind==='chat'?vm.runInContext('loadChat(true)',f.context):f.load(kind);f.response(0,kind==='chat'?{messages:['old'],blocked:false}:{posts:['old']});await first;assert.equal(f.state[kind==='chat'?'chatLoading':'postsLoading'],true);f.response(1,kind==='chat'?{messages:['new'],blocked:false}:{posts:['new']});await second;assert.equal(f.state[kind==='chat'?'chatLoading':'postsLoading'],false)});
 await test(kind+': the current failure is surfaced and loading stops',async()=>{const f=fixture();f.select(kind,'a');const pending=kind==='chat'?vm.runInContext('loadChat(true)',f.context):f.load(kind);f.response(0,{error:'Current request failed'},false);await pending;assert.equal(f.state[kind==='chat'?'chatLoading':'postsLoading'],false);if(kind==='chat')assert.equal(f.state.chatError,'Current request failed');else assert.deepEqual(f.state.notices,['Current request failed'])});
}

await test('Opening a collector profile accepts its first response after entering Collectors',async()=>{const f=fixture(),pending=f.profile('a_grails');assert.deepEqual(f.state.tabs,['Collectors']);assert.equal(f.state.profileLoading,true);f.response(0,{handle:'a_grails',name:'Collector A'});await pending;assert.equal(f.state.profile.handle,'a_grails');assert.equal(f.state.profileLoading,false)});
await test('Rapid profile choices keep the most recently selected collector',async()=>{const f=fixture(),first=f.profile('a_grails'),second=f.profile('b_grails');f.response(1,{handle:'b_grails'});await second;f.response(0,{handle:'a_grails'});await first;assert.equal(f.state.profile.handle,'b_grails');assert.equal(f.state.profileLoading,false)});
await test('A late profile error cannot replace a newer collector result',async()=>{const f=fixture(),first=f.profile('a_grails'),second=f.profile('b_grails');f.response(1,{handle:'b_grails'});await second;f.requests[0].reject(new Error('Old collector failed'));await first;assert.equal(f.state.profile.handle,'b_grails');assert.deepEqual(f.state.notices,[])});
await test('Leaving Collectors prevents late profile results from changing the screen',async()=>{const f=fixture(),pending=f.profile('a_grails');f.context.go('Home');f.context.setProfile(null);f.context.setProfileLoading(false);f.response(0,{handle:'a_grails'});await pending;assert.equal(f.context.tab,'Home');assert.equal(f.state.profile,null);assert.equal(f.state.profileLoading,false);assert.deepEqual(f.state.tabs,['Collectors','Home'])});

await test('A direct collector card choice cancels an outstanding profile lookup',async()=>{const f=fixture(),pending=f.profile('a_grails');f.context.qaProfileValue={handle:'b_grails'};vm.runInContext('selectProfile(qaProfileValue)',f.context);f.response(0,{handle:'a_grails'});await pending;assert.equal(f.state.profile.handle,'b_grails');assert.equal(f.state.profileLoading,false)});
await test('Returning to my showcase cancels an outstanding profile lookup',async()=>{const f=fixture(),pending=f.profile('a_grails');vm.runInContext('selectProfile(null)',f.context);f.response(0,{handle:'a_grails'});await pending;assert.equal(f.state.profile,null);assert.equal(f.state.profileLoading,false)});
const hubSource=await readFile('app/hub.tsx','utf8'),hubAst=ts.createSourceFile('app/hub.tsx',hubSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let commitSource,bootstrapSource;
function hubWalk(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='commit')commitSource=node.getText(hubAst);if(ts.isCallExpression(node)&&node.expression.getText(hubAst)==='useEffect'&&node.arguments[0]?.getText(hubAst).includes("fetch('/api/vault')"))bootstrapSource=node.arguments[0].getText(hubAst);ts.forEachChild(node,hubWalk)}
hubWalk(hubAst);assert.ok(commitSource);assert.ok(bootstrapSource);
function vaultFixture(){
 const original={profile:'QA Collector',books:[],wants:[],posts:[],likes:[],tradeBookIds:[],clubs:[],watchlist:[],tradeDrafts:[]};
 const state={vault:original,status:'Synced to your account',saving:false,notice:'',loaded:true,refreshes:0};const requests=[];
 const context=vm.createContext({Error,Promise,JSON,name:'QA Collector',signedIn:true,loaded:true,vault:original,vaultEtag:{current:'"v1"'},savingRef:{current:false},gate:()=>true,vaultSchema:{safeParse:v=>({success:true,data:v}),parse:v=>{if(v===null)throw Error('Null is not a stored collection');return v}},emptyVault:name=>({...original,profile:name}),refreshValues:async()=>{},net:{refresh:async()=>{state.refreshes++}},
 fetch:(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject})),setVault:v=>{state.vault=v;context.vault=v},setStatus:v=>{state.status=typeof v==='function'?v(state.status):v},setSaving:v=>state.saving=v,setNotice:v=>state.notice=v,setLoaded:v=>{state.loaded=v;context.loaded=v}});
 vm.runInContext(compile(commitSource+'\nconst qaVaultBootstrap = '+bootstrapSource+';'),context);
 function resolve(index,{status=200,body={saved:true},etag='"v2"'}={}){requests[index].resolve({ok:status>=200&&status<300,status,json:async()=>body,headers:{get:name=>name.toLowerCase()==='etag'?etag:null}})}
 return {context,state,requests,original,resolve,commit:data=>{context.qaNextVault=data;return vm.runInContext('commit(qaNextVault)',context)},bootstrap:()=>vm.runInContext('qaVaultBootstrap()',context)};
}
async function flush(){for(let i=0;i<12;i++)await Promise.resolve()}
await test('A new collector loads null as an empty collection and can perform the first conditional save',async()=>{const f=vaultFixture();f.context.loaded=false;f.context.vaultEtag.current=null;f.bootstrap();f.resolve(0,{body:null,etag:'"empty"'});await flush();assert.equal(f.state.loaded,true);assert.equal(f.state.vault.books.length,0);assert.equal(f.context.vaultEtag.current,'"empty"');const next={...f.state.vault,books:[{id:'first',title:'First book',issue:'#1',grade:'Raw',price:0}]},saved=f.commit(next);assert.equal(f.requests[1].options.headers['If-Match'],'"empty"');f.resolve(1,{etag:'"created"'});assert.equal(await saved,true);assert.equal(f.context.vaultEtag.current,'"created"')});
await test('Collection saves send and advance the server version',async()=>{const f=vaultFixture(),next={...f.original,books:[{id:'a'}]},pending=f.commit(next);assert.equal(f.requests[0].options.headers['If-Match'],'"v1"');assert.deepEqual(JSON.parse(f.requests[0].options.body),next);f.resolve(0,{etag:'"v2"'});assert.equal(await pending,true);assert.equal(f.context.vaultEtag.current,'"v2"');const second=f.commit({...next,wants:[2]});assert.equal(f.requests[1].options.headers['If-Match'],'"v2"');f.resolve(1,{etag:'"v3"'});assert.equal(await second,true);assert.equal(f.context.vaultEtag.current,'"v3"');assert.equal(f.state.saving,false)});
await test('A stale collection save rolls back and disables writes until reconnected',async()=>{const f=vaultFixture(),pending=f.commit({...f.original,books:[{id:'unsaved'}]});f.resolve(0,{status:409,body:{error:'Collection changed in another tab.'},etag:null});assert.equal(await pending,false);assert.deepEqual(f.state.vault,f.original);assert.equal(f.state.loaded,false);assert.equal(f.context.vaultEtag.current,null);assert.equal(f.state.saving,false);assert.match(f.state.status,/Collection changed/);assert.equal(await f.commit({...f.original,wants:[3]}),false);assert.equal(f.requests.length,1)});
await test('An in-flight collection save cannot enqueue a second write',async()=>{const f=vaultFixture(),pending=f.commit({...f.original,wants:[1]});assert.equal(await f.commit({...f.original,wants:[2]}),false);assert.equal(f.requests.length,1);f.resolve(0);assert.equal(await pending,true);assert.equal(f.state.saving,false)});
await test('Collection network failure rolls back optimistic content',async()=>{const f=vaultFixture(),pending=f.commit({...f.original,wants:[1]});f.requests[0].reject(new Error('Network interrupted'));assert.equal(await pending,false);assert.deepEqual(f.state.vault,f.original);assert.equal(f.state.saving,false);assert.match(f.state.notice,/Network interrupted/)});
await test('Collection bootstrap cleanup ignores a late account response',async()=>{const f=vaultFixture();f.context.loaded=false;f.context.vaultEtag.current=null;const cleanup=f.bootstrap();cleanup();f.resolve(0,{body:{...f.original,wants:[8]},etag:'"late"'});await flush();assert.equal(f.context.vaultEtag.current,null);assert.deepEqual(f.state.vault,f.original)});
console.log('\nClient response-order results: '+passed+' passed, '+failures.length+' failed.');
if(failures.length){console.error(JSON.stringify(failures,null,2));process.exitCode=1;}
