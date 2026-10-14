// Execute actual Hub controls/current selector/detail JSX and real Card hooks.
// Responses and parent state are controlled; no browser, HTTP server or OAuth.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createReporter,loadTypeScriptModule,plain} from '../architecture/postgres/tests/runtime.mjs';
import {createScannerFixture} from './scanner-hooks.mjs';

const report=createReporter('Exact Hub issue details lifecycle');
const source=readFileSync('app/hub.tsx','utf8'),ast=ts.createSourceFile('app/hub.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),
  hub=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='Hub');assert.ok(hub);
const names=['openDirectoryIssue','openIssue','go'],controls=hub.body.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.includes(node.name?.text));
assert.equal(controls.length,names.length);
const current=hub.body.statements.filter(ts.isVariableStatement).flatMap(node=>node.declarationList.declarations).find(node=>node.name.getText(ast)==='current');assert.ok(current?.initializer);
let card,close,retry;
function walk(node){
  if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(ast)==='ComicProductCard'){assert.equal(card,undefined);card=node;}
  if(ts.isJsxOpeningElement(node)&&node.tagName.getText(ast)==='Dialog'&&node.attributes.properties.some(attribute=>ts.isJsxAttribute(attribute)&&attribute.name.getText(ast)==='label'&&attribute.initializer?.getText(ast)==='"Issue details"'))
    close=node.attributes.properties.find(attribute=>ts.isJsxAttribute(attribute)&&attribute.name.getText(ast)==='onClose').initializer.expression;
  if(ts.isJsxAttribute(node)&&node.name.getText(ast)==='onClick'&&node.initializer&&ts.isJsxExpression(node.initializer)&&node.initializer.expression?.getText(ast).includes('openDirectoryIssue(current)'))retry=node.initializer.expression;
  ts.forEachChild(node,walk);
}walk(hub);assert.ok(card);assert.ok(close);assert.ok(retry);
const compile=(code,jsx=false)=>ts.transpileModule(code,{fileName:jsx?'actual-hub-details.tsx':'actual-hub-controls.ts',
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:jsx?ts.JsxEmit.ReactJSX:undefined}}).outputText;
const catalog=loadTypeScriptModule('lib/catalog.ts').catalog,parser=loadTypeScriptModule('lib/catalog-picker-client.ts'),
  links=loadTypeScriptModule('lib/value-links.ts'),shared=loadTypeScriptModule('lib/shared-catalog.ts'),navigation=loadTypeScriptModule('lib/section-navigation.ts');
const bibliography={publicationDate:'November 2018',keyDate:'2018-00-00',onSaleDate:'2018-09-05',
  originalCoverPrice:{kind:'ORIGINAL_COVER_PRICE',text:'3.99 USD'},pageCount:'32',isbn:'9780000000000',barcode:'1234567890123',
  issueTitle:'Issue subtitle',volume:'1',variantOf:null,seriesProviderId:7,indiciaPublisher:'Synthetic Press',
  brandEmblem:'Synthetic imprint',rating:'Teen',indiciaFrequency:'Monthly',indiciaPrinter:'Synthetic printer',keywords:'Synthetic keyword',editing:'Synthetic editor',
  stories:[{type:'Comic story',title:'Synthetic detailed story',feature:'Synthetic feature',sequenceNumber:1,pageCount:'22',script:'Synthetic writer',
    pencils:'Synthetic penciller',inks:'Synthetic inker',colors:'Synthetic colorist',letters:'Synthetic letterer',editing:'Synthetic story editor',
    jobNumber:'JOB-50',genre:'Science fiction',firstLine:'Synthetic first line',characters:'Synthetic protagonist',
    synopsis:'Synthetic licensed synopsis.',notes:'Synthetic story notes.',keywords:'Synthetic story keywords'}]};
const summary=id=>({...plain(catalog[24]),id:4000000000+id,gcdId:id,title:'GCD Synthetic Series',number:String(id),cover:undefined,
  source:'https://www.comics.org/issue/'+id+'/',dataCredit:'Bibliographic data from the Grand Comics Database',dataLicense:'https://creativecommons.org/licenses/by-sa/4.0/'});
const full=id=>({...summary(id),bibliography:structuredClone(bibliography)});
const page=issue=>({issues:[issue],total:1,limit:1,offset:0,hasMore:false,issueCount:44,scope:'shared'});
const flush=async()=>{for(let round=0;round<24;round++)await Promise.resolve();};

function fixture(){
  const requests=[],context=vm.createContext({Error,Promise,catalog,parseCatalogSearchPage:parser.parseCatalogSearchPage,
    sharedProviderIdentity:shared.sharedProviderIdentity,...navigation,...links,
    directoryRecords:{current:new Map()},detailRequest:{current:0},sharedDetail:null,detail:null,detailState:'',drawer:true,tab:'Directory',
    vault:{books:[],wants:[]},saving:false,signedIn:false,isOwner:false,net:{ready:false,error:null},activeDirectoryCounts:{},
    setSharedDetail:value=>context.sharedDetail=value,setDetail:value=>context.detail=value,setDetailState:value=>context.detailState=value,setDrawer:value=>context.drawer=value,
    setMarketIssue:value=>context.marketIssue=value,setTab:value=>context.tab=value,setQuery(){},setPublisher(){},setEra(){},setKind(){},setPage(){},setMyProfileRequest(){},setNotice(){},
    gate:()=>true,collect:async()=>true,want(){},listingDirectoryId:shared.listingDirectoryId,
    window:{scrollTo(){},matchMedia:()=>({matches:true})},fetch:(url,options={})=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}))});
  vm.runInContext(compile(controls.map(node=>node.getText(ast)).join('\n')+'\nglobalThis.open=openDirectoryIssue;globalThis.navigate=go;globalThis.close='+close.getText(ast)+';'),context);
  function cardProps(){
    const jsx=(type,props,key)=>({type,props:{...props,key}});
    Object.assign(context,{exports:{},require:specifier=>{assert.equal(specifier,'react/jsx-runtime');return {jsx,jsxs:jsx,Fragment:'fragment'};},
      ComicProductCard:'actual-product-card',ArchiveCard:'actual-archive-card',Bookmark:'Bookmark'});
    vm.runInContext('(function(){'+compile('globalThis.current='+current.initializer.getText(ast)+';globalThis.detailCard='+card.getText(ast)+';',true)+'})()',context);
    return context.detailCard.props;
  }
  return {context,requests,open:context.open,navigate:context.navigate,close:context.close,cardProps,
    async respond(body,index=requests.length-1,ok=true){requests[index].resolve({ok,json:async()=>body});await flush();}};
}

await report.test('Starter and already-complete GCD clicks select exact stored details without another request',async()=>{
  const f=fixture();f.open(catalog[24]);assert.equal(f.context.detail,24);assert.equal(f.context.sharedDetail.id,24);assert.equal(f.context.drawer,false);assert.equal(f.requests.length,0);
  f.open(full(50));assert.equal(f.context.detail,4000000050);assert.equal(f.context.detailState,'');assert.equal(f.requests.length,0);
  const c=createScannerFixture({componentFile:'architecture/postgres/ui/ComicProductCard.tsx',props:f.cardProps()});await c.flush();
  assert.match(c.snapshot(),/Original cover price3\.99 USD/);assert.match(c.snapshot(),/publisher price, not FMV/);assert.match(c.snapshot(),/Stories & credits \(1\)/);
  for(const detail of ['November 2018','2018-09-05','9780000000000','1234567890123','Synthetic detailed story','Synthetic licensed synopsis.',
    'Synthetic story notes.','Synthetic penciller','Synthetic inker','Synthetic colorist','Synthetic letterer','JOB-50'])assert.ok(c.snapshot().includes(detail),detail);
  const value=c.find(node=>String(node.props?.className||'').startsWith('ch-fmv-badge'));assert.match(c.text(value),/Coming soon/);assert.ok(!c.text(value).includes('3.99'));
  await c.click('CGC 9.8 FMV');assert.match(c.text(c.find(node=>String(node.props?.className||'').startsWith('ch-fmv-badge'))),/Coming soon/);c.unmount();
});
await report.test('GCD summary click fetches one exact same-origin no-store record and retains validated full bibliography',async()=>{
  const f=fixture();f.open(summary(50));assert.equal(f.context.detail,4000000050);assert.match(f.context.detailState,/Loading/);assert.equal(f.requests.length,1);
  assert.equal(f.requests[0].url,'/api/catalog?id=4000000050');assert.equal(f.requests[0].options.credentials,'same-origin');assert.equal(f.requests[0].options.cache,'no-store');
  await f.respond(page(full(50)));assert.equal(f.context.detailState,'');assert.equal(f.context.sharedDetail.gcdId,50);
  assert.deepEqual(plain(f.context.sharedDetail.bibliography),bibliography);assert.equal(f.context.directoryRecords.current.get(4000000050).bibliography.originalCoverPrice.kind,'ORIGINAL_COVER_PRICE');
});
await report.test('Reversed GCD detail completion cannot replace the newer selected issue or its bibliography',async()=>{
  const f=fixture();f.open(summary(50));f.open(summary(51));assert.equal(f.requests.length,2);
  await f.respond(page(full(51)),1);assert.equal(f.context.sharedDetail.gcdId,51);assert.equal(f.context.detailState,'');
  await f.respond(page(full(50)),0);assert.equal(f.context.detail,4000000051);assert.equal(f.context.sharedDetail.gcdId,51);assert.equal(f.context.detailState,'');
  assert.equal(f.context.directoryRecords.current.get(4000000050).bibliography,undefined,'Obsolete detail response upgraded a superseded record');
});
await report.test('Failed, wrong-ID, missing and malformed bibliography responses retain the clicked issue and an actionable retry',async()=>{
  const invalid=[{body:{error:'Provider unavailable'},ok:false},{body:page(full(51)),ok:true},{body:page(summary(50)),ok:true},
    {body:page({...full(50),bibliography:{...bibliography,originalCoverPrice:{kind:'FMV',text:'9999 USD'}}}),ok:true}];
  for(const response of invalid){
    const f=fixture();f.open(summary(50));await f.respond(response.body,0,response.ok);
    assert.equal(f.context.detail,4000000050);assert.equal(f.context.sharedDetail.gcdId,50);assert.equal(f.context.sharedDetail.bibliography,undefined);
    assert.match(f.context.detailState,/could not load\. Please retry/);assert.ok(!f.context.detailState.includes('not in'));
    const c=createScannerFixture({componentFile:'architecture/postgres/ui/ComicProductCard.tsx',props:f.cardProps()});await c.flush();
    assert.ok(c.button('Retry details'));await c.click('Retry details');assert.equal(f.requests.length,2);assert.match(f.context.detailState,/Loading/);
    await f.respond(page(full(50)),1);assert.equal(f.context.detailState,'');assert.equal(f.context.sharedDetail.bibliography.originalCoverPrice.kind,'ORIGINAL_COVER_PRICE');
    c.setProps(f.cardProps());await c.flush();assert.ok(!c.snapshot().includes('Retry details'));assert.match(c.snapshot(),/Stories & credits \(1\)/);c.unmount();
  }
});
await report.test('Closing details or navigating away invalidates late success and failure without reopening the overlay',async()=>{
  for(const action of ['close','navigate'])for(const ok of [true,false]){
    const f=fixture();f.open(summary(50));const selected=f.context.sharedDetail;
    if(action==='close')f.close();else f.navigate('Marketplace');assert.equal(f.context.detail,null);
    await f.respond(ok?page(full(50)):{error:'Late error'},0,ok);assert.equal(f.context.detail,null);
    assert.equal(f.context.sharedDetail,selected);assert.ok(!f.context.detailState.includes('could not'));
    if(action==='navigate')assert.equal(f.context.tab,'Marketplace');
  }
});
await report.test('Opening a starter issue suppresses obsolete GCD failure and missing saved identities cannot change details',async()=>{
  const f=fixture();f.open(summary(50));f.open(catalog[10]);await f.respond({error:'Obsolete provider failure'},0,false);
  assert.equal(f.context.detail,10);assert.equal(f.context.sharedDetail.id,10);assert.equal(f.context.detailState,'');
  f.context.openIssue(3999999999);assert.equal(f.requests.length,1);assert.equal(f.context.detail,10);
  const props=f.cardProps();assert.equal(props.comic.id,'10');assert.equal(new URL(props.marketplaceHref,'https://comichuddle.test').searchParams.get('issue'),'10');
});
report.finish({genuineProviderRequests:0,browserExecuted:false,coverage:'Actual controls, parser, current selector, JSX and Card callbacks with controlled parent state'});
