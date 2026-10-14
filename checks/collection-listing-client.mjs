// Actual Hub save callback and Add Comic React hooks with controlled transport.
// This exercises client logic; it does not claim a signed-in browser session.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createReporter,loadTypeScriptModule,plain} from '../architecture/postgres/tests/runtime.mjs';
import {createScannerFixture} from './scanner-hooks.mjs';

const report=createReporter('Collection saving and multiple-comic listing regression');
const source=readFileSync('app/hub.tsx','utf8'),ast=ts.createSourceFile('app/hub.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const hub=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='Hub');
const commit=hub.body.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='commit');
const sync=loadTypeScriptModule('lib/vault-client.ts'),vaultModule=loadTypeScriptModule('lib/vault.ts');
const catalog=loadTypeScriptModule('lib/catalog.ts').catalog;
const copy=id=>({id,title:catalog[18].title,issue:'#'+catalog[18].number,grade:'Raw VF',price:0,catalogId:18});
function fixture({stale=false,offline=false}={}){
 const empty=plain(vaultModule.emptyVault('QA Collector')),state={vault:empty,loaded:!offline,status:'Connecting',notices:[],saving:false,refreshes:0};
 let server=empty,version='"old-version"',posted=0;
 const fetcher=async(url,options={})=>{
  assert.equal(url,'/api/vault');
  if(options.method!=='POST')return Response.json(server,{headers:{ETag:'W/'+version,[sync.vaultVersionHeader]:version}});
  posted++;if(stale&&posted===1){server={...server,books:[copy('other-device')]};version='"new-version"';return Response.json({error:'Stale revision'},{status:409});}
  assert.equal(new Headers(options.headers).get('If-Match'),version);
  server=JSON.parse(options.body);version='"saved-version"';return Response.json({saved:true},{headers:{ETag:'W/'+version,[sync.vaultVersionHeader]:version}});
 };
 const context=vm.createContext({console,Error,Promise,name:'QA Collector',vault:empty,gate:()=>true,vaultSchema:vaultModule.vaultSchema,
  savingRef:{current:false},vaultSnapshot:{current:offline?null:{data:empty,version}},VaultConflictError:sync.VaultConflictError,
  saveVaultChange:(...args)=>sync.saveVaultChange(...args,fetcher),net:{refresh:async()=>{state.refreshes++;}},
  setNotice:value=>state.notices.push(value),setLoaded:value=>state.loaded=value,setSaving:value=>state.saving=value,
  setStatus:value=>state.status=typeof value==='function'?value(state.status):value,setVault:value=>state.vault=value});
 vm.runInContext(ts.transpileModule(commit.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
 return {state,context,save:next=>context.commit(next),server:()=>server};
}
await report.test('Actual Hub save reconnects automatically instead of blocking on the offline flag',async()=>{
 const f=fixture({offline:true});assert.equal(await f.save({...f.context.vault,books:[copy('new')]}),true);
 assert.equal(f.state.loaded,true);assert.equal(f.state.status,'Synced to your account');assert.equal(f.state.saving,false);assert.equal(f.state.refreshes,1);
});
await report.test('Actual Hub stale-version save preserves another device copy and re-enables the account',async()=>{
 const f=fixture({stale:true});assert.equal(await f.save({...f.context.vault,books:[copy('new')]}),true);
 assert.deepEqual(f.state.vault.books.map(book=>book.id),['other-device','new']);assert.equal(f.state.loaded,true);assert.equal(f.context.savingRef.current,false);
});
await report.test('Save & add another accumulates two distinct directory comics before returning to the listing',async()=>{
 let saved=0;const writes=[],vault=plain(vaultModule.emptyVault('QA Collector'));
 const f=createScannerFixture({componentFile:'app/add-comic.tsx',props:{vault,allowMultiple:true,saving:false,onSaved:()=>saved++,commit:async next=>{writes.push(plain(next));f.setProps({vault:next});return true;}}});
 const select=async issue=>{f.find(node=>typeof node.type==='function'&&node.type.name==='ComicPicker').props.onChange(issue);await f.flush();};
 const submit=async another=>{let resets=0;await f.find(node=>node.type==='form').props.onSubmit({preventDefault(){},currentTarget:{grade:'Raw VF',price:'0',reset(){resets++;}},nativeEvent:{submitter:{getAttribute:()=>another?'another':null}}});await f.flush();return resets;};
 await f.flush();await select(catalog[18]);assert.equal(await submit(true),1);assert.equal(saved,0);assert.match(f.snapshot(),/1 comic saved/);
 await select(catalog[19]);assert.equal(await submit(false),0);assert.equal(saved,1);assert.equal(writes[1].books.length,2);
 assert.notEqual(writes[1].books[0].id,writes[1].books[1].id);assert.deepEqual(writes[1].books.map(book=>book.catalogId),[18,19]);f.unmount();
});
await report.test('A failed Add Comic retry retains its owned-copy ID without adding a duplicate',async()=>{
 const writes=[];let fail=true;const f=createScannerFixture({componentFile:'app/add-comic.tsx',props:{vault:plain(vaultModule.emptyVault('QA Collector')),saving:false,onSaved(){},commit:async next=>{writes.push(plain(next));return !fail;}}});
 await f.flush();f.find(node=>typeof node.type==='function'&&node.type.name==='ComicPicker').props.onChange(catalog[18]);await f.flush();
 const submit=()=>f.find(node=>node.type==='form').props.onSubmit({preventDefault(){},currentTarget:{grade:'Raw VF',price:'0'}});
 await submit();await f.flush();fail=false;await submit();await f.flush();assert.equal(writes.length,2);assert.equal(writes[0].books[0].id,writes[1].books[0].id);f.unmount();
});
await report.test('Listing choices exist before the empty collection branch and use plain user-facing labels',async()=>{
 const market=readFileSync('app/marketplace.tsx','utf8');assert.ok(market.indexOf('mp-editor-options')<market.indexOf('!vault.books.length'));
 assert.match(market,/Multiple comics \/ collection/);assert.match(market,/Add a listing/);assert.ok(!market.includes('Bring your longbox'));
 assert.ok(/nextKind==='collection'\?vault\.books\.map/.test(market),'Collection mode selects multiple owned copies');assert.ok(/bookIds:selected\.map/.test(market),'The complete selected manifest is submitted');
});
await report.test('Orders links close the drawer and open the main Orders destination; nav numbers are removed',async()=>{
 assert.match(source,/onClick=\{\(\)=>\{setDrawer\(false\);go\('Orders'\)\}\}/);
 assert.match(source,/tab==='Orders'&&<section className="orders-page"/);assert.ok(!source.includes('<small>0{i+1}</small>'));
 assert.equal(loadTypeScriptModule('lib/section-navigation.ts').resolveSection('Orders'),'Orders');
});
await report.test('Cover attribution stays in the cover column and only action buttons carry colored backgrounds',async()=>{
 const card=readFileSync('architecture/postgres/ui/ComicProductCard.tsx','utf8'),css=readFileSync('app/directory-product-card.css','utf8');
 assert.ok(card.indexOf('ch-cover-attribution')<card.indexOf('ch-card-details'));assert.match(css,/\.ch-card-details\{grid-column:2/);
 assert.match(css,/\.ch-add-collection\{background:#c83e30;color:#fff/);assert.match(css,/\.source-links a\{[^}]*border:0/);
 assert.ok(!css.includes('.ch-product-card button,.ch-product-card a{border-style:solid}'));
});
report.finish({coverage:'Actual Hub save function, Add Comic hooks, listing/order and CSS contracts',browserExecuted:false});
