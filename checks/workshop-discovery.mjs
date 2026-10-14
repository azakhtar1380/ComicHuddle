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
await test('Cards show each offered price separately and missing quotes never appear as zero',()=>{
 const {tree}=card(studio('custom','A, MN',{prices:{pressing:null,dry_cleaning:undefined}}));const value=text(tree);assert.match(value,/Pressing Custom quote/);assert.match(value,/Dry cleaning Custom quote/);assert.ok(!value.includes('$0.00'));const zero=text(card(studio('zero','A, MN',{prices:{pressing:0,dry_cleaning:500}})).tree);assert.match(zero,/From \$0\.00/);assert.match(zero,/From \$5\.00/);
});
await test('Card review badges count reviews and intake chips only show supported methods',()=>{
 const value=text(card(studio('mail','A, MN',{dropoff:false,reviewCount:4,completedReviewCount:2})).tree);assert.match(value,/4 member reviews · 2 receipt-confirmed/);assert.ok(!value.includes('completed requests'));assert.ok(!value.includes('Local drop-off'));assert.match(value,/Mail-in/);
});
await test('Real card controls open details, request quotes, message and toggle comparison',()=>{
 const {f,tree}=card(rows[0]);for(const caption of ['Request quote','Message','Compare']){const button=nodes(tree,n=>n.type==='button'&&text(n).trim().startsWith(caption))[0];assert.ok(button);button.props.onClick()}byLabel(tree,'Read 4 member reviews for North Star Press').props.onClick();assert.deepEqual(f.calls,['quote','message','compare','details']);
});
await test('Own studios avoid self-messaging while closed studios still support conversations',()=>{
 const own=card(rows[0],{mine:true});assert.ok(!nodes(own.tree,n=>n.type==='button'&&text(n).trim()==='Message').length);nodes(own.tree,n=>n.type==='button'&&text(n).trim().startsWith('My studio'))[0].props.onClick();assert.deepEqual(own.f.calls,['details']);const closed=card({...rows[0],accepting:false});assert.equal(nodes(closed.tree,n=>n.type==='button'&&text(n).trim().startsWith('Request quote'))[0].props.disabled,true);assert.equal(nodes(closed.tree,n=>n.type==='button'&&text(n).trim()==='Message')[0].props.disabled,undefined);
});
await test('Comparison prices distinguish custom quote, not offered and truthful receipt-confirmed review counts',()=>{
 const f=fixture(),providers=[studio('one','A, MN',{services:['pressing'],prices:{pressing:null}}),studio('two','B, MN',{prices:{pressing:2000,dry_cleaning:0},mailIn:false})];const tree=f.ui.WorkshopComparison({providers,onOpen:()=>{},onQuote:()=>{},onMessage:()=>{},onRemove:()=>{},onClear:()=>{},meId:'viewer'}),value=text(tree);assert.match(value,/Custom quote/);assert.match(value,/From \$20\.00/);assert.match(value,/From \$0\.00/);assert.match(value,/Not offered/);assert.match(value,/Drop-off \/ pickup by arrangement/);assert.match(value,/4 reviews · 1 receipt-confirmed/);assert.ok(!value.includes('completed requests'));
});
await test('Comparison callbacks preserve the selected studio identity and empty shortlists stay hidden',()=>{
 const f=fixture(),tree=f.ui.WorkshopComparison({providers:[rows[0]],onOpen:p=>f.calls.push(['details',p.id]),onQuote:p=>f.calls.push(['quote',p.id]),onMessage:p=>f.calls.push(['message',p.id]),onRemove:id=>f.calls.push(['remove',id]),onClear:()=>f.calls.push(['clear']),meId:'viewer'});nodes(tree,n=>n.type==='button'&&text(n).trim()==='Request quote')[0].props.onClick();nodes(tree,n=>n.type==='button'&&text(n).trim()==='Message')[0].props.onClick();byLabel(tree,'Remove North Star Press from comparison').props.onClick();assert.deepEqual(f.calls,[['quote','local-a'],['message','local-a'],['remove','local-a']]);assert.equal(f.ui.WorkshopComparison({providers:[]}),null);
});
await test('Actual city/state controls narrow both views and state changes clear a previous city',()=>{
 const f=fixture();let tree=f.render();byLabel(tree,'Filter workshops by state').props.onChange({target:{value:'MN'}});tree=f.render();byLabel(tree,'Filter workshops by city').props.onChange({target:{value:'minneapolis'}});tree=f.render();let cards=nodes(tree,n=>n.type?.name==='ProviderCard');assert.deepEqual(cards.map(n=>n.props.p.id),['new-local','local-b','local-a']);assert.equal(cards.find(n=>n.props.p.id==='local-b').props.p.rank,1);byLabel(tree,'Filter workshops by state').props.onChange({target:{value:'OR'}});assert.equal(f.states.city,'');tree=f.render();assert.deepEqual(nodes(tree,n=>n.type?.name==='ProviderCard').map(n=>n.props.p.id),['global-best']);
});
await test('Actual leaderboard search retains area rank instead of turning a searched studio into number one',()=>{
 const f=fixture({panel:'leaderboard',state:'MN',city:'minneapolis',query:'Casey Winters'}),tree=f.render(),cards=nodes(tree,n=>n.type?.name==='ProviderCard');assert.equal(cards.length,1);assert.equal(cards[0].props.p.id,'local-a');assert.equal(cards[0].props.p.rank,2);assert.match(text(nodes(tree,n=>n.props?.className==='care-rank-note')[0]),/Paid placement never changes rank/);
});
await test('Actual shortlist limits three studios, removes a selected studio and keeps messaging account-gated',async()=>{
 const f=fixture();let tree=f.render();for(const id of ['local-a','local-b','state-other','global-best'])nodes(tree,n=>n.type?.name==='ProviderCard'&&n.props.p.id===id)[0].props.onCompare();assert.equal(f.states.compareIds.length,3);tree=f.render();assert.equal(nodes(tree,n=>n.type?.name==='ProviderCard'&&n.props.p.id==='global-best')[0].props.compareFull,true);nodes(tree,n=>n.type?.name==='ProviderCard'&&n.props.p.id==='local-a')[0].props.onCompare();assert.equal(f.states.compareIds.length,2);f.props.gate=()=>false;tree=f.render();nodes(tree,n=>n.type?.name==='ProviderCard'&&n.props.p.id==='local-a')[0].props.onMessage();await Promise.resolve();assert.equal(f.calls.length,0);
});
await test('Guests see an account gate rather than fabricated empty provider totals or unsolicited reads',()=>{
 const f=fixture({data:{providers:[],mine:null,jobs:[]}});f.props.signedIn=false;f.props.net.data.me=null;const tree=f.render(),value=text(tree);assert.match(value,/Free account to browse/);assert.ok(!value.includes('0 studios'));assert.ok(!value.includes('FIRST GREAT PRESSERS'));assert.equal(nodes(tree,n=>n.type?.name==='ProviderCard').length,0);assert.equal(f.calls.length,0);
});
await test('A guest provider deep link remains available after sign-in instead of being consumed by the empty guest list',async()=>{
 const f=fixture();f.props.signedIn=false;f.props.net.data.me=null;f.render();const effect=()=>f.effects.find(fn=>String(fn).includes('deepLinked.current'));effect()();assert.equal(f.refs.deepLinked.current,false);f.props.signedIn=true;f.render();effect()();await Promise.resolve();assert.equal(f.refs.deepLinked.current,true);assert.equal(f.calls[0].fetch,'/api/pressing?kind=provider&id=local-a');
});
await test('The provider desk keeps the independent collector collection available',()=>{
 const f=fixture({panel:'provider',data:{providers:rows,mine:rows[0],jobs:[]}}),tree=f.render(),button=nodes(tree,n=>n.type==='button'&&text(n).trim()==='My collection')[0];assert.ok(button);button.props.onClick();assert.deepEqual(f.calls,['collection']);
});
console.log('\nWorkshop discovery results: '+passed+' passed, '+failures.length+' failed.');
if(failures.length){console.error(JSON.stringify(failures,null,2));process.exitCode=1}
