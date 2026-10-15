// Run: node checks/workshop-discovery.mjs
// Executes actual Workshop helpers and TSX callbacks with isolated records.
// These checks do not claim browser layout, real providers or courier verification.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const plain=value=>JSON.parse(JSON.stringify(value));
const compiled=code=>ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const helpers=vm.createContext({exports:{}});
vm.runInContext(compiled(await readFile('lib/pressing.ts','utf8')),helpers);
const care=helpers.exports;
const source=await readFile('app/pressing.tsx','utf8'),ast=ts.createSourceFile('app/pressing.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const component=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='PressRoom');
assert.ok(component);
function hookNames(hook){return component.body.statements.filter(ts.isVariableStatement).flatMap(statement=>[...statement.declarationList.declarations]).filter(node=>ts.isCallExpression(node.initializer)&&node.initializer.expression.getText(ast)===hook).map(node=>ts.isArrayBindingPattern(node.name)?node.name.elements[0].name.text:node.name.getText(ast))}
const stateNames=hookNames('useState'),refNames=hookNames('useRef');
const jsx=(type,props)=>({type,props:props||{}}),icons=new Proxy({},{get:(_target,name)=>props=>jsx('svg',{'data-icon':name,...props})});
function fixture(overrides={}){
 const states={data:{providers:rows,mine:null,jobs:[]},ready:true,...overrides},refs={},effects=[],calls=[],notices=[];
 let stateIndex=0,refIndex=0;
 const react={useState(initial){const name=stateNames[stateIndex++];if(!(name in states))states[name]=typeof initial==='function'?initial():initial;return [states[name],value=>{states[name]=typeof value==='function'?value(states[name]):value}]},useRef(initial){const name=refNames[refIndex++];return refs[name]??= {current:initial}},useCallback:fn=>fn,useEffect:fn=>effects.push(fn)};
 const props={tab:'Pressing',signedIn:true,net:{data:{me:{id:'viewer',name:'Test Collector',location:'Minneapolis, MN',visible:true,dmOpen:true}},act:async action=>{calls.push(action);return {threadId:'private-thread'}},refresh:async()=>{}},vault:{books:[]},gate:()=>true,notice:message=>notices.push(message),go:()=>{},openCollection:()=>calls.push('collection'),onRegister:()=>calls.push('register'),onOpenThread:async id=>calls.push({threadId:id}),command:{id:0,view:'directory'}};
 const context=vm.createContext({exports:{},FormData,URLSearchParams,URL,console,window:{location:{search:'?provider=local-a'}},document:{getElementById:()=>({scrollIntoView:()=>{}})},fetch:async url=>{calls.push({fetch:url});return {ok:true,json:async()=>({provider:rows[0],reviews:[]})}},require:specifier=>{
  if(specifier==='react')return react;
  if(specifier==='react/jsx-runtime')return {jsx,jsxs:jsx,Fragment:'fragment'};
  if(specifier==='lucide-react')return icons;
  if(specifier==='../lib/pressing')return care;
  if(specifier==='./location-radius-filter')return {default:props=>jsx('location-filter',props)};
  if(specifier==='../components/collector-search')return {default:props=>jsx('collector-search',props)};
  if(specifier==='./network')return {Modal:props=>jsx('dialog',props),ComicArt:props=>jsx('comic-art',props),uploadPhoto:()=>{throw Error('No external uploads in this test')}};
  if(specifier.endsWith('.css'))return {};
  throw Error('Unexpected client dependency '+specifier);
 }});
 vm.runInContext(compiled(source+'\nexport {ProviderCard, WorkshopComparison, ProviderForm};'),context);
 return {states,refs,effects,calls,notices,props,ui:context.exports,render(){stateIndex=0;refIndex=0;effects.length=0;return context.exports.default(props)}};
}
function nodes(tree,predicate){const found=[];function walk(node){if(Array.isArray(node)){node.forEach(walk);return}if(!node||typeof node!=='object')return;if(predicate(node))found.push(node);walk(node.props?.children)}walk(tree);return found}
function text(tree){let value;if(Array.isArray(tree))value=tree.map(text).join(' ');else if(tree===null||tree===undefined||tree===false)value='';else if(typeof tree!=='object')value=String(tree);else if(typeof tree.type==='function')value=text(tree.type(tree.props));else value=text(tree.props?.children);return value.replace(/\s+/g,' ').trim()}
const byLabel=(tree,label)=>nodes(tree,node=>node.props?.['aria-label']===label)[0];
const studio=(id,location,fields={})=>({id,profileId:'owner-'+id,name:'Studio '+id,bio:'Independent pressing and careful condition assessment.',location,services:['pressing','dry_cleaning'],prices:{pressing:2500,dry_cleaning:null},specialties:'Modern keys',experienceSince:2016,turnaroundMin:7,turnaroundMax:14,mailIn:true,dropoff:true,accepting:true,visible:true,submissionMode:'none',dealerReference:'',website:'',logoId:null,portfolio:[],terms:'Agreed privately.',createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',collector:{name:'Collector '+id,handle:'collector_'+id},rating:4.5,reviewCount:4,completedReviewCount:1,categoryRatings:{quality:4.5,communication:4.5,timeliness:4.5},rank:null,...fields});
const rows=[studio('local-a','Minneapolis, MN',{name:'North Star Press',collector:{name:'Casey Winters',handle:'casey_keys'},rating:4.6}),studio('local-b','Minneapolis, Minnesota · USA',{name:'Panel Care',rating:4.8,reviewCount:3}),studio('state-other','St. Paul, MN',{rating:4.9}),studio('global-best','Portland, OR',{rating:5}),studio('portland-east','Portland, ME',{rating:4.9}),studio('new-local','Minneapolis, MN',{rating:5,reviewCount:2,completedReviewCount:2}),studio('legacy','Austin',{rating:null,reviewCount:0})];
let passed=0;const failures=[];
async function test(name,run){try{await run();passed++;console.log('PASS: '+name)}catch(error){failures.push({name,message:error.message});console.error('FAIL: '+name+' — '+error.message)}}

await test('City/state parsing accepts canonical, full-state and legacy suffix records without guessing a state',()=>{
 for(const location of ['Minneapolis, MN · USA',' Minneapolis , Minnesota, United States ','Minneapolis MN'])assert.deepEqual(plain(care.workshopLocation(location)),{city:'Minneapolis',state:'MN',stateName:'Minnesota'});
 assert.deepEqual(plain(care.workshopLocation('Austin')),{city:'Austin',state:'',stateName:''});assert.deepEqual(plain(care.workshopLocation('USA')),{city:'',state:'',stateName:''});assert.deepEqual(plain(care.workshopLocation('New York')),{city:'New York',state:'',stateName:''});assert.deepEqual(plain(care.workshopLocation('MN')),{city:'',state:'MN',stateName:'Minnesota'});
});
await test('Ambiguous city names remain separate by exact state, and short state codes are not substring searches',()=>{
 assert.deepEqual(plain(care.filterWorkshopProviders(rows,{city:'Portland',state:'Maine'})).map(p=>p.id),['portland-east']);assert.deepEqual(plain(care.filterWorkshopProviders(rows,{city:'Portland',state:'OR'})).map(p=>p.id),['global-best']);assert.equal(care.filterWorkshopProviders(rows,{state:'IN'}).length,0);assert.equal(care.filterWorkshopProviders(rows,{city:'Minne'}).length,0);
});
await test('Studio and collector-name search supports punctuation, handles and multiple words',()=>{
 for(const query of ['North, star','Casey Winters','@casey_keys'])assert.deepEqual(plain(care.filterWorkshopProviders(rows,{query})).map(p=>p.id),['local-a']);assert.equal(care.filterWorkshopProviders(rows,{query:'North Casey'}).length,1);assert.equal(care.filterWorkshopProviders(rows,{query:'North missing'}).length,0);
});
await test('Area options deduplicate full/abbreviated states and contain only cities in the selected state',()=>{
 const options=plain(care.workshopAreaOptions(rows,'MN'));assert.deepEqual(options.cities.map(v=>v.label),['Minneapolis','St. Paul']);assert.equal(options.states.filter(v=>v.value==='MN').length,1);assert.equal(options.states.find(v=>v.value==='MN').label,'Minnesota');assert.ok(!options.cities.some(v=>v.label==='Portland'));
});
await test('Service, intake and availability filters combine without inventing local intake',()=>{
 const providers=[studio('mail','Chicago, IL',{dropoff:false,services:['pressing']}),studio('local','Chicago, IL',{mailIn:false,services:['dry_cleaning']}),studio('paused','Chicago, IL',{accepting:false})];assert.deepEqual(plain(care.filterWorkshopProviders(providers,{service:'pressing',method:'mail',accepting:true})).map(p=>p.id),['mail']);assert.deepEqual(plain(care.filterWorkshopProviders(providers,{method:'dropoff',accepting:true})).map(p=>p.id),['local']);
});
await test('Area ranks use three real reviews, never receipt counts, missing ratings or invalid ratings',()=>{
 const input=[studio('good','A, MN'),studio('not-yet','A, MN',{reviewCount:2,completedReviewCount:200,rating:5}),studio('missing','A, MN',{rating:null}),studio('invalid','A, MN',{rating:NaN}),studio('bad-score','A, MN',{rating:6})];const ranked=care.rankProviders(input);assert.equal(ranked[0].rank,1);assert.ok(ranked.slice(1).every(p=>p.rank===null));assert.ok(input.every(p=>p.rank===null));
});
await test('Changing area recomputes earned ranks without altering the public records or their review totals',()=>{
 const before=plain(rows),global=care.rankProviders(rows),local=care.rankProviders(care.filterWorkshopProviders(rows,{state:'MN',city:'Minneapolis'}));assert.equal(global.find(p=>p.id==='global-best').rank,1);assert.equal(local.find(p=>p.id==='local-b').rank,1);assert.equal(local.find(p=>p.id==='local-a').rank,2);assert.equal(local.find(p=>p.id==='new-local').rank,null);assert.deepEqual(plain(rows),before);assert.equal(local.find(p=>p.id==='local-b').reviewCount,3);
});
await test('Rating ties use review count and stable registration order, never price or a paid flag',()=>{
 const ranked=care.rankProviders([studio('z','A, MN',{createdAt:'2026-02-01',prices:{pressing:0},paid:true}),studio('b','A, MN'),studio('a','A, MN'),studio('more','A, MN',{reviewCount:5})]);assert.equal(ranked.find(p=>p.id==='more').rank,1);assert.equal(ranked.find(p=>p.id==='a').rank,2);assert.equal(ranked.find(p=>p.id==='b').rank,3);assert.equal(ranked.find(p=>p.id==='z').rank,4);
});
function card(p,extra={}){const f=fixture();return {f,tree:f.ui.ProviderCard({p,localRank:true,mine:false,compared:false,compareFull:false,onOpen:()=>f.calls.push('details'),onQuote:()=>f.calls.push('quote'),onMessage:()=>f.calls.push('message'),onCompare:()=>f.calls.push('compare'),...extra})}}
await test('Current specialist cards show real services, location, review count and quote-first actions',()=>{
 const {tree}=card(rows[0]),value=text(tree);assert.match(value,/North Star Press/);assert.match(value,/Minneapolis, MN/);assert.match(value,/4 reviews/);assert.match(value,/Comic pressing|Pressing/);assert.match(value,/Request a Quote/);assert.ok(!value.includes('$0.00'));assert.ok(!value.includes('receipt-confirmed'));
});
await test('Current specialist card controls retain exact studio identity for quotes, inquiries and comparison',()=>{
 const {f,tree}=card(rows[0]);for(const [caption,action] of [['Request a Quote','quote'],['Send Message / Inquire','message'],['Compare','compare'],['Services & reviews','details']]){const button=nodes(tree,n=>n.type==='button'&&text(n).trim().startsWith(caption))[0];assert.ok(button,caption);button.props.onClick();assert.equal(f.calls.at(-1),action)}
});
await test('Own studio cards avoid self-inquiries; closed studios still allow messages but disable new quote requests',()=>{
 const own=card(rows[0],{mine:true}),ownText=text(own.tree);assert.match(ownText,/My Studio/);assert.ok(!ownText.includes('Send Message / Inquire'));
 const closed=card({...rows[0],accepting:false});assert.equal(nodes(closed.tree,n=>n.type==='button'&&text(n).startsWith('Request a Quote'))[0].props.disabled,true);assert.ok(nodes(closed.tree,n=>n.type==='button'&&text(n).includes('Send Message / Inquire')).length);
});
await test('The studio comparison limit disables only a fourth unselected studio',()=>{
 const full=card(rows[0],{compareFull:true}),selected=card(rows[0],{compareFull:true,compared:true});
 assert.equal(nodes(full.tree,n=>n.type==='button'&&text(n).trim()==='Compare')[0].props.disabled,true);assert.equal(nodes(selected.tree,n=>n.type==='button'&&text(n).trim()==='Compare')[0].props.disabled,false);
});
console.log('\nWorkshop discovery results: '+passed+' passed, '+failures.length+' failed.');
if(failures.length){console.error(JSON.stringify(failures,null,2));process.exitCode=1}
