// Run: node checks/journey-client.mjs
// Execute actual client functions with delayed fetch responses. No DOM/browser E2E claim.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source=await readFile('app/pressing.tsx','utf8'),ast=ts.createSourceFile('app/pressing.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),functions=new Map();
let refreshCode,renderCode;
function walk(node){
 if(ts.isFunctionDeclaration(node)&&node.name&&['openProvider','openJob','selectProvider','selectJob','closeProvider','closeJob','clearCareSelection','act'].includes(node.name.text))functions.set(node.name.text,node.getText(ast));
 if(ts.isFunctionDeclaration(node)&&node.name?.text==='PressRoom')renderCode=node.body.statements.filter(statement=>(ts.isVariableStatement(statement)&&statement.declarationList.declarations.some(d=>d.name.getText(ast)==='selection'))||(ts.isIfStatement(statement)&&statement.expression.getText(ast).startsWith('currentCareSelection.current'))||(ts.isExpressionStatement(statement)&&statement.expression.getText(ast).startsWith('workshopVisible.current='))).map(s=>s.getText(ast)).join('\n');
 if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='refresh')refreshCode=node.initializer?.getText(ast);
 ts.forEachChild(node,walk);
}
walk(ast);for(const name of ['openProvider','openJob'])assert.ok(functions.has(name),'Missing actual care loader '+name);assert.ok(refreshCode);
const compile=code=>ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const pickerSource=await readFile('lib/catalog-picker-client.ts','utf8'),pickerContext=vm.createContext({exports:{},Error,AbortController,URLSearchParams,fetch:()=>{throw Error('Unexpected network request')}});
vm.runInContext(ts.transpileModule(pickerSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,pickerContext);
const {createCatalogSearchSession,parseCatalogSearchPage,nextPickerIndex}=pickerContext.exports;
const navigationSource=await readFile('lib/section-navigation.ts','utf8'),navigationContext=vm.createContext({exports:{}});
vm.runInContext(ts.transpileModule(navigationSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,navigationContext);
const navigation=navigationContext.exports;
const accountSource=await readFile('lib/account-intent.ts','utf8'),accountContext=vm.createContext({exports:{},URLSearchParams,require:specifier=>{assert.equal(specifier,'./section-navigation');return navigation}});
vm.runInContext(ts.transpileModule(accountSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,accountContext);
const account=accountContext.exports;
const networkSource=await readFile('app/network.tsx','utf8'),networkAst=ts.createSourceFile('app/network.tsx',networkSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),hook=networkAst.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='useCollectorNetwork');
assert.ok(hook);const networkRefresh=hook.body.statements.find(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>d.name.getText(networkAst)==='refresh')).declarationList.declarations[0].initializer.getText(networkAst),networkAct=hook.body.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='act').getText(networkAst),networkRender=hook.body.statements.find(node=>ts.isIfStatement(node)&&node.expression.getText(networkAst).startsWith('networkSignedIn.current')).getText(networkAst);
function networkFixture(){
 const requests=[],state={data:null,ready:false,error:'',busy:false,notices:[]},context=vm.createContext({Error,Promise,signedIn:true,networkRequest:{current:0},networkSession:{current:0},networkMounted:{current:true},networkSignedIn:{current:true},busyRef:{current:false},useCallback:fn=>fn,fetch:(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject})),setData:v=>state.data=v,setReady:v=>state.ready=v,setError:v=>state.error=v,setBusy:v=>state.busy=v,notify:v=>state.notices.push(v)});
 vm.runInContext(compile('globalThis.refresh = '+networkRefresh+'\n'+networkAct),context);
 return {context,state,requests,answer:(i,data,ok=true)=>requests[i].resolve({ok,json:async()=>data}),render:()=>vm.runInContext(compile(networkRender),context)};
}
const hubSource=await readFile('app/hub.tsx','utf8'),hubAst=ts.createSourceFile('app/hub.tsx',hubSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),hub=hubAst.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='Hub');
const hubFunctions=hub.body.statements.filter(node=>ts.isFunctionDeclaration(node)&&['pressingView','finishAccountIntent'].includes(node.name?.text)).map(node=>node.getText(hubAst));
const hubEffects=hub.body.statements.filter(node=>ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(hubAst)==='useEffect').map(node=>node.expression.arguments[0]).filter(node=>node.getText(hubAst).includes('readAccountIntent')||node.getText(hubAst).includes('const intent=pendingAccountIntent.current')).map(node=>node.getText(hubAst));assert.equal(hubEffects.length,2);
function intentFixture(signedIn,profile){
 const state={role:'collector',profileOpen:false,tab:'Home',command:{id:0,view:'directory'}},location={pathname:'/',search:'?view=app&join=provider&section=Comic+Workshop'},window={location,history:{state:null,replaceState(_s,_t,url){const parsed=new URL(url,'https://comichuddle.test');location.pathname=parsed.pathname;location.search=parsed.search}}};
 const context=vm.createContext({...account,...navigation,URLSearchParams,window,signedIn,isOwner:false,previewRulesVersion:'current-test-rules',net:{ready:true,error:'',data:{me:profile}},pendingAccountIntent:{current:null},accountIntentResumed:{current:false},navigation:navigation.activeNavigation,catalog:[],setPreferredRole:v=>state.role=v,setProfileOpen:v=>state.profileOpen=v,setPolicies:()=>{},setDrawerTab:()=>{},setDrawer:()=>{},go:v=>state.tab=v,setValueIssue:()=>{},setValueView:()=>{},setMarketIssue:()=>{},setDetail:()=>{},setPressingCommand:v=>state.command=typeof v==='function'?v(state.command):v});
 vm.runInContext(compile(hubFunctions.join('\n')+'\n globalThis.restoreIntent = '+hubEffects[0]+'; globalThis.resumeIntent = '+hubEffects[1]),context);return {context,state,location};
}
const issue={id:4,title:'Saga',number:'1',publisher:'Image Comics',year:2012,era:'Modern Age',writer:'Brian K. Vaughan',artist:'Fiona Staples',note:'The series begins.',kind:'First issue',variant:'First printing',source:'https://metadata.example.test/saga/1',characters:['Alana']};
const page=(id=4)=>({issues:[{...issue,id}],total:1,limit:12,offset:0,hasMore:false,issueCount:30,scope:'starter'});
function searchFixture(){const requests=[],session=createCatalogSearchSession((url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject})));return {session,requests,answer:(i,data,ok=true)=>requests[i].resolve({ok,json:async()=>data})}}
function fixture(){
 const requests=[],state={detail:null,job:null,data:null,ready:false,error:'',notices:[],providerForm:false,quoteProvider:null,reviewProvider:null,report:null,busy:false};
 const context=vm.createContext({console,Error,Promise,encodeURIComponent,tab:'Pressing',signedIn:true,me:null,active:{current:false},mounted:{current:true},workshopVisible:{current:true},providerRequest:{current:0},jobRequest:{current:0},careRequest:{current:0},careSession:{current:0},currentCareSelection:{current:'signed-in|Pressing'},currentProviderSelection:{current:''},currentJobSelection:{current:''},
  fetch:url=>new Promise((resolve,reject)=>requests.push({url,resolve,reject})),useCallback:fn=>fn,
  setDetail:v=>state.detail=v,setJob:v=>state.job=v,setData:v=>state.data=v,setReady:v=>state.ready=v,setError:v=>state.error=v,notice:v=>state.notices.push(v),setProviderForm:v=>state.providerForm=v,setQuoteProvider:v=>state.quoteProvider=v,setReviewProvider:v=>state.reviewProvider=v,setReport:v=>state.report=v,setBusy:v=>state.busy=v,
 });
 vm.runInContext(compile([...functions.values(),'globalThis.refresh = '+refreshCode].join('\n')),context);
 const answer=(i,payload,ok=true)=>requests[i].resolve({ok,json:async()=>payload});
 const render=()=>{assert.ok(renderCode,'Missing actual Workshop render identity guard');vm.runInContext(compile('{'+renderCode+'}'),context)};
 return {context,state,requests,answer,render};
}
let passed=0;const failures=[];
async function test(name,run){try{await run();passed++;console.log('PASS: '+name)}catch(error){failures.push({name,message:error.message});console.error('FAIL: '+name+' — '+error.message)}}
for(const kind of ['provider','job']){
 const fn=kind==='provider'?'openProvider':'openJob',argument=id=>kind==='provider'?{id}:id,payload=id=>kind==='provider'?{provider:{id,name:'Studio '+id},reviews:[]}:{job:{id,status:'requested'},events:[]};
 await test('Comic Workshop '+kind+': reverse responses preserve the latest chosen record',async()=>{
  const f=fixture(),old=f.context[fn](argument('old')),latest=f.context[fn](argument('latest'));f.answer(1,payload('latest'));await latest;f.answer(0,payload('old'));await old;assert.equal(f.state[kind==='provider'?'detail':'job'][kind].id,'latest');
 });
 await test('Comic Workshop '+kind+': a late failure cannot surface an error after a newer successful choice',async()=>{
  const f=fixture(),old=f.context[fn](argument('old')),latest=f.context[fn](argument('latest'));f.answer(1,payload('latest'));await latest;f.answer(0,{error:'Outdated old choice error'},false);await old;assert.deepEqual(f.state.notices,[]);
 });
}
await test('Comic Workshop refresh: reverse responses preserve the latest saved directory and jobs',async()=>{
 const f=fixture(),old=f.context.refresh(),latest=f.context.refresh();f.answer(1,{providers:[{id:'latest'}],mine:null,jobs:[{id:'latest'}]});await latest;f.answer(0,{providers:[{id:'old'}],mine:null,jobs:[{id:'old'}]});await old;assert.equal(f.state.data.jobs[0].id,'latest');
});
await test('Comic Workshop refresh: a stale failure cannot replace a newer successful connection',async()=>{
 const f=fixture(),old=f.context.refresh(),latest=f.context.refresh();f.answer(1,{providers:[],mine:null,jobs:[]});await latest;f.answer(0,{error:'Outdated directory failure'},false);await old;assert.equal(f.state.error,'');assert.equal(f.state.ready,true);
});
for(const kind of ['provider','job']){
 const fn=kind==='provider'?'openProvider':'openJob',argument=id=>kind==='provider'?{id}:id,payload=id=>kind==='provider'?{provider:{id,name:'Studio '+id},reviews:[]}:{job:{id,status:'requested'},events:[]},field=kind==='provider'?'detail':'job',close=kind==='provider'?'closeProvider':'closeJob';
 await test('Comic Workshop '+kind+': closing selection prevents a late result from reopening the modal',async()=>{const f=fixture(),pending=f.context[fn](argument('closed'));f.context[close]();f.answer(0,payload('closed'));await pending;assert.equal(f.state[field],null)});
 await test('Comic Workshop '+kind+': leaving and returning before effects invalidates the prior page request',async()=>{const f=fixture(),pending=f.context[fn](argument('oldpage'));f.context.tab='Marketplace';f.render();f.context.tab='Pressing';f.render();f.answer(0,payload('oldpage'));await pending;assert.equal(f.state[field],null)});
}
await test('Comic Workshop cross-selection cannot let a provider response overlap a newer care-job modal',async()=>{const f=fixture(),provider=f.context.openProvider({id:'provider'}),job=f.context.openJob('job');f.answer(1,{job:{id:'job'},events:[]});await job;f.answer(0,{provider:{id:'provider'},reviews:[]});await provider;assert.equal(f.state.detail,null);assert.equal(f.state.job.job.id,'job')});
await test('Comic Workshop account change discards an old private-job directory response before effects',async()=>{const f=fixture(),pending=f.context.refresh();f.context.me={id:'another-collector'};f.render();f.answer(0,{providers:[],mine:null,jobs:[{id:'old-private-job'}]});await pending;assert.equal(f.state.data,null)});
await test('Comic Workshop unmount ignores an outstanding response and its error',async()=>{const f=fixture(),pending=f.context.openJob('old');f.context.mounted.current=false;f.answer(0,{error:'Unmounted job failure'},false);await pending;assert.deepEqual(f.state.notices,[]);assert.equal(f.state.job,null)});
await test('Comic Workshop old mutation completion cannot reopen a record after leaving and returning',async()=>{const f=fixture(),pending=f.context.act({action:'request'});f.context.tab='Marketplace';f.render();f.context.tab='Pressing';f.render();f.answer(0,{saved:true,jobId:'old-created-job'});assert.equal(await pending,null);assert.equal(f.requests.length,1);assert.equal(f.context.active.current,false);assert.equal(f.state.busy,false)});
await test('Directory picker search: newer results survive a reversed old response even when abort is ignored',async()=>{
 const f=searchFixture(),old=f.session.search('old'),latest=f.session.search('latest');assert.equal(f.requests[0].options.signal.aborted,true);f.answer(1,page(5));assert.equal((await latest).issues[0].id,5);f.answer(0,page(4));assert.equal(await old,null);
});
await test('Directory picker search: obsolete errors cannot replace a successful newer selection',async()=>{
 const f=searchFixture(),old=f.session.search('old'),latest=f.session.search('latest');f.answer(1,page(5));assert.equal((await latest).issues[0].id,5);f.requests[0].reject(Error('Old network error'));assert.equal(await old,null);
});
await test('Directory picker cancellation prevents a late response from restoring a closed result list',async()=>{
 const f=searchFixture(),pending=f.session.search('Saga');f.session.cancel();assert.equal(f.requests[0].options.signal.aborted,true);f.answer(0,page());assert.equal(await pending,null);
});
await test('Directory picker current failures are surfaced, and a subsequent retry can recover',async()=>{
 const f=searchFixture(),bad=f.session.search('Saga');f.answer(0,{error:'Unavailable'},false);await assert.rejects(bad,/Directory request failed/);const retry=f.session.search('Saga');f.answer(1,page());assert.equal((await retry).issues[0].id,4);
});
await test('Directory picker requests encode the query and exact page offset without putting it in a route path',async()=>{
 const f=searchFixture(),pending=f.session.search('Saga #1 & variant',12),url=new URL(f.requests[0].url,'https://comichuddle.test');assert.equal(url.pathname,'/api/catalog');assert.equal(url.searchParams.get('q'),'Saga #1 & variant');assert.equal(url.searchParams.get('limit'),'12');assert.equal(url.searchParams.get('offset'),'12');f.answer(0,{...page(),issues:[],offset:12,total:1});assert.equal((await pending).issues.length,0);
});
await test('Directory picker rejects malformed pagination and duplicate comic identities before selection',async()=>{
 for(const candidate of [{...page(),hasMore:true},{...page(),issues:[issue,issue],total:2},{...page(),total:-1},{...page(),issues:[{...issue,id:'4'}]},{...page(),issues:[{...issue,characters:[5]}]},{...page(),issues:[{...issue,source:undefined}]}])assert.throws(()=>parseCatalogSearchPage(candidate),/Invalid/);
});
await test('Directory picker keyboard navigation wraps available results and leaves empty searches unselected',async()=>{
 assert.equal(nextPickerIndex('ArrowDown',-1,3),0);assert.equal(nextPickerIndex('ArrowDown',2,3),0);assert.equal(nextPickerIndex('ArrowUp',0,3),2);assert.equal(nextPickerIndex('ArrowUp',-1,3),2);assert.equal(nextPickerIndex('ArrowDown',0,0),-1);assert.equal(nextPickerIndex('Enter',1,3),1);
});
await test('Collector network refresh preserves newer account/listing data when initial responses resolve backwards',async()=>{const f=networkFixture(),old=f.context.refresh(),latest=f.context.refresh();f.answer(1,{me:{id:'latest'},listings:[{id:'saved-listing'}]});await latest;f.answer(0,{me:{id:'old'},listings:[]});await old;assert.equal(f.state.data.me.id,'latest');assert.equal(f.state.data.listings[0].id,'saved-listing')});
await test('Collector network stale failure cannot replace a successful mutation refresh',async()=>{const f=networkFixture(),old=f.context.refresh(),latest=f.context.refresh();f.answer(1,{me:{id:'latest'},listings:[]});await latest;f.answer(0,{error:'Old network failure'},false);await old;assert.equal(f.state.error,'');assert.equal(f.state.ready,true)});
await test('Collector network signout/relogin discards prior account reads and mutation completions',async()=>{const f=networkFixture(),read=f.context.refresh(),write=f.context.act({action:'profile'});f.context.signedIn=false;f.render();f.context.signedIn=true;f.render();f.answer(0,{me:{id:'old-account'}});f.answer(1,{saved:true});await read;assert.equal(await write,null);assert.equal(f.state.data,null);assert.deepEqual(f.state.notices,[]);assert.equal(f.requests.length,2)});
await test('Collector network unmount ignores a late read failure without updating connection state',async()=>{const f=networkFixture(),pending=f.context.refresh();f.context.networkMounted.current=false;f.answer(0,{error:'Unmounted failure'},false);await pending;assert.equal(f.state.error,'');assert.equal(f.state.ready,false)});
await test('Account sign-in return path preserves provider role, current section and app query context',async()=>{const url=new URL(account.accountSignInPath('/','?view=app&issue=4','provider','Pressing'),'https://comichuddle.test');assert.equal(url.pathname,'/signin-with-chatgpt');const restored=new URL(url.searchParams.get('return_to'),'https://comichuddle.test');assert.equal(restored.searchParams.get('view'),'app');assert.equal(restored.searchParams.get('issue'),'4');assert.equal(restored.searchParams.get('section'),'Comic Workshop');assert.equal(account.readAccountIntent(restored.search),'provider')});
await test('Account return paths stay local and reject unsupported roles or section intents',async()=>{for(const pathname of ['//evil.example','https://evil.example','/\\evil.example','/\n']){const returned=account.accountReturnPath(pathname,'','collector','Unknown section'),url=new URL(returned,'https://comichuddle.test');assert.equal(url.origin,'https://comichuddle.test');assert.equal(url.pathname,'/');assert.equal(url.searchParams.get('section'),'Home')}for(const search of ['?join=admin','?join=',''])assert.equal(account.readAccountIntent(search),null)});
await test('Consuming a completed account intent retains the original app, issue and selling query context',async()=>{const cleared=account.clearAccountIntent('/','?view=app&join=provider&issue=4&sell=collection'),url=new URL(cleared,'https://comichuddle.test');assert.equal(url.searchParams.has('join'),false);assert.equal(url.searchParams.get('view'),'app');assert.equal(url.searchParams.get('issue'),'4');assert.equal(url.searchParams.get('sell'),'collection')});
await test('Actual Hub restores signed-out provider intent into the free profile gate',async()=>{const f=intentFixture(false,null);f.context.restoreIntent();f.context.resumeIntent();assert.equal(f.state.role,'provider');assert.equal(f.state.profileOpen,true);assert.equal(f.state.tab,'Pressing');assert.equal(f.context.pendingAccountIntent.current,'provider');assert.equal(new URLSearchParams(f.location.search).get('join'),'provider')});
await test('Actual Hub resumes a valid signed-in provider into studio registration once and consumes the intent',async()=>{const f=intentFixture(true,{id:'collector',consent:{version:'current-test-rules'}});f.context.restoreIntent();f.context.resumeIntent();f.context.resumeIntent();assert.equal(f.state.profileOpen,false);assert.equal(f.state.tab,'Pressing');assert.equal(f.state.command.view,'register');assert.equal(f.state.command.id,1);assert.equal(new URLSearchParams(f.location.search).has('join'),false);assert.equal(f.context.pendingAccountIntent.current,null)});
console.log('\nJourney client results: '+passed+' passed, '+failures.length+' failed.');
if(failures.length){console.error(JSON.stringify(failures,null,2));process.exitCode=1}
