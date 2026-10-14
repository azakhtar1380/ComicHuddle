// Actual Directory parent/local card hooks and controlled catalog responses.
// React static serialization checks escaping; CSS checks are source contracts.
// No browser layout, real provider request, camera or signed-in session is claimed.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createReporter,loadTypeScriptModule,plain} from '../architecture/postgres/tests/runtime.mjs';
import {createScannerFixture} from './scanner-hooks.mjs';

const report=createReporter('Compact Directory cards and catalog lifecycle');
const starter=plain(loadTypeScriptModule('lib/catalog.ts').catalog[24]);
const issue={...starter,note:'DETAIL_ONLY_NOTE',variant:'DETAIL_ONLY_PRINTING',writer:'DETAIL_ONLY_WRITER',
  artist:'DETAIL_ONLY_ARTIST',source:'https://metadata.example.test/DETAIL_ONLY_SOURCE'};
// This GCD-shaped identity is synthetic controlled input, not a live provider record.
const other={...issue,id:4000256114,gcdId:256114,title:'Exact other series',number:'7',publisher:'Other Press',
  year:2017,era:'Modern Age',kind:'DETAIL_ONLY_KIND',characters:['DETAIL_ONLY_CHARACTER'],cover:undefined};
const page=(issues=[issue,other],changes={})=>({issues,total:issues.length,limit:12,offset:0,hasMore:false,
  issueCount:43,scope:'starter',syncedIssueCount:0,lastSyncedAt:null,publishers:['Fiction House','Other Press'],...changes});
const fixture=options=>createScannerFixture({componentFile:'app/shared-directory.tsx',
  props:{onOpen(){},onWant(){assert.fail('Compact card cannot mutate wants');},
    onCollect(){assert.fail('Compact card cannot save inventory');},onFind(){assert.fail('Compact card cannot buy');},
    ownedIds:[24],wantedIds:[24],saving:false,...options?.props},...options});
const cards=f=>f.nodes().filter(node=>typeof node.type==='function'&&node.type.name==='DirectoryIssueCard');
const cardFixture=(record,callback=()=>{})=>createScannerFixture({componentFile:'app/shared-directory.tsx',
  componentLocal:'DirectoryIssueCard',props:{issue:record,onOpen:callback}});
async function respond(f,body,ok=true,index=f.calls.requests.length-1){
  f.calls.requests[index].resolve({ok,json:async()=>body});await f.flush();
}
async function loaded(body=page(),options={}){const f=fixture(options);await f.flush();await respond(f,body);return f;}
const normalized=value=>value.replace(/\s+/g,' ').trim();
function staticNode(node,index=0){
  if(Array.isArray(node))return node.map((child,key)=>staticNode(child,key));
  if(!node||typeof node!=='object')return node;
  if(typeof node.type==='function')return React.createElement('svg',{'aria-hidden':'true',key:index});
  const {children,key,ref,...props}=node.props;
  return React.createElement(node.type,{...props,key:key??index},staticNode(children));
}

await report.test('Actual grid returns only compact local cards with exact full issue records and no side-effect actions',async()=>{
  const opened=[],f=await loaded(page(),{props:{onOpen:record=>opened.push(record)}});
  assert.equal(cards(f).length,2);assert.equal(f.find(node=>node.props?.className==='sd-grid')!==undefined,true);
  assert.equal(f.nodes().some(node=>typeof node.type==='function'&&node.type.name==='ComicProductCard'),false);
  assert.equal(f.calls.requests.length,1);
  for(const node of cards(f)){
    const c=cardFixture(node.props.issue,node.props.onOpen);await c.flush();
    const label=node.props.issue.title+' #'+node.props.issue.number+node.props.issue.publisher+'More info';
    assert.ok(normalized(c.snapshot()).endsWith(label));
    if(node.props.issue.cover)assert.match(c.snapshot(),/Cover: Wikimedia Commons · US public domain/);
    assert.equal(c.nodes().filter(child=>child.type==='button').length,1);
    assert.equal(c.nodes().some(child=>['a','input','select','form','dialog'].includes(child.type)),false);
    assert.equal(c.find(child=>child.type==='button').props['aria-haspopup'],'dialog');
    assert.match(c.find(child=>child.type==='button').props['aria-label'],/More info about/);
    for(const hidden of ['DETAIL_ONLY_NOTE','DETAIL_ONLY_PRINTING','DETAIL_ONLY_WRITER','DETAIL_ONLY_ARTIST',
      'DETAIL_ONLY_SOURCE','DETAIL_ONLY_KIND','DETAIL_ONLY_CHARACTER','Add to Collection','FMV','Buy','Want'])
      assert.equal(c.snapshot().includes(hidden),false,hidden);
    await c.click('More info');c.unmount();
  }
  assert.deepEqual(plain(opened),plain([issue,other]));assert.equal(opened[0],issue);assert.equal(opened[1],other);f.unmount();
});
await report.test('List view preserves the same compact controls and issue identity without another catalog fetch',async()=>{
  const opened=[],f=await loaded(page(),{props:{onOpen:record=>opened.push(record)}});
  f.find(node=>node.type==='button'&&node.props['aria-label']==='List view').props.onClick();await f.flush();assert.ok(f.find(node=>node.props?.className==='sd-list'));
  assert.equal(f.calls.requests.length,1);assert.deepEqual(cards(f).map(node=>node.props.issue.id),[24,4000256114]);
  const c=cardFixture(cards(f)[1].props.issue,cards(f)[1].props.onOpen);await c.flush();await c.click('More info');
  assert.equal(opened[0].id,4000256114);assert.equal(opened[0].gcdId,256114);c.unmount();
  f.find(node=>node.type==='button'&&node.props['aria-label']==='Grid view').props.onClick();await f.flush();assert.ok(f.find(node=>node.props?.className==='sd-grid'));assert.equal(f.calls.requests.length,1);f.unmount();
});
await report.test('Missing or failed covers use a neutral placeholder and a replacement cover can load',async()=>{
  const c=cardFixture(other);await c.flush();assert.equal(c.find(node=>node.type==='img'),undefined);
  assert.equal(c.find(node=>node.props?.role==='img').props['aria-label'],'Cover unavailable');
  c.setProps({issue});await c.flush();const image=c.find(node=>node.type==='img');assert.equal(image.props.src,starter.cover);
  assert.equal(image.props.loading,'lazy');assert.equal(image.props.decoding,'async');
  image.props.onError();await c.flush();assert.equal(c.find(node=>node.type==='img'),undefined);
  c.setProps({issue:{...issue,cover:'/covers/planet-21.jpg'}});await c.flush();
  assert.equal(c.find(node=>node.type==='img').props.src,'/covers/planet-21.jpg');c.unmount();
});
await report.test('Untrusted issue text is escaped by React serialization and cannot add markup or controls',async()=>{
  const hostile={...issue,title:'<img src=x onerror=alert(1)>',publisher:'<script>secret</script>'},c=cardFixture(hostile);await c.flush();
  const html=renderToStaticMarkup(staticNode(c.nodes()[0]));assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('&lt;script&gt;secret&lt;/script&gt;'));assert.equal((html.match(/<button\b/g)||[]).length,1);
  assert.equal((html.match(/<img\b/g)||[]).length,1);assert.ok(!html.includes('<script>'));c.unmount();
});
await report.test('Cover CSS bounds grid and list artwork with containment and visible keyboard focus',async()=>{
  const css=readFileSync('app/shared-directory.css','utf8');
  const declarations=selector=>css.split('}').filter(rule=>rule.slice(0,rule.indexOf('{')).split(',').some(value=>value.trim()===selector))
    .map(rule=>rule.slice(rule.indexOf('{')+1)).join(';');
  const grid=declarations('.shared-directory .sd-art>img');assert.match(grid,/object-fit:contain/);
  assert.match(grid,/max-width:142px/);assert.match(grid,/max-height:186px/);assert.match(grid,/max-width:124px/);
  assert.match(css,/\.sd-list \.sd-art>img[^}]*max-width:64px/);assert.match(css,/\.sd-list \.sd-art>img[^}]*max-height:92px/);
  assert.match(css,/\.sd-card:focus-visible\{[^}]*outline:3px/);
  assert.match(css,/\.sd-art\{[^}]*overflow:hidden/);
});
await report.test('Typing invalidates immediately, aborts old work and only the latest debounced response creates cards',async()=>{
  const f=fixture();await f.flush();const old=f.calls.requests[0];
  const picker=f.find(node=>typeof node.type==='function'&&node.type.name==='ComicPicker');assert.ok(picker);
  picker.props.onQueryChange('Exact other series #7');await f.flush();assert.equal(old.options.signal.aborted,true);
  assert.equal(f.calls.requests.length,1);await respond(f,page([issue]),true,0);assert.equal(cards(f).length,0);
  await f.advance(299);assert.equal(f.calls.requests.length,1);await f.advance(1);assert.equal(f.calls.requests.length,2);
  const current=f.calls.requests[1],params=new URL(current.url,'https://qa.example.test').searchParams;
  assert.equal(params.get('q'),'Exact other series #7');assert.equal(params.get('limit'),'12');assert.equal(params.get('offset'),'0');
  assert.equal(current.options.cache,'no-store');assert.equal(current.options.credentials,'same-origin');
  await respond(f,page([other]));assert.deepEqual(cards(f).map(node=>node.props.issue.id),[4000256114]);f.unmount();
});
await report.test('Publisher, series and page changes issue bounded exact requests and keep the matching page identity',async()=>{
  const f=await loaded(page([issue],{total:25,hasMore:true}));
  await f.click('Next');let query=new URL(f.calls.requests.at(-1).url,'https://qa.example.test').searchParams;assert.equal(query.get('offset'),'12');
  await respond(f,page([other],{total:25,offset:12,hasMore:true}));assert.equal(cards(f)[0].props.issue.id,4000256114);
  const tree=f.find(node=>typeof node.type==='function'&&node.type.name==='DirectoryTree');assert.ok(tree);
  tree.props.onPublisher('Other Press');await f.flush();query=new URL(f.calls.requests.at(-1).url,'https://qa.example.test').searchParams;
  assert.equal(query.get('publisher'),'Other Press');assert.equal(query.get('offset'),'0');assert.equal(query.get('q'),'');
  await respond(f,page([other]));f.find(node=>typeof node.type==='function'&&node.type.name==='DirectoryTree').props.onSeries('Exact other series');await f.flush();
  query=new URL(f.calls.requests.at(-1).url,'https://qa.example.test').searchParams;
  assert.equal(query.get('series'),'Exact other series');assert.equal(query.get('publisher'),'Other Press');assert.equal(query.get('limit'),'12');
  f.unmount();assert.equal(f.calls.requests.at(-1).options.signal.aborted,true);
});
await report.test('HTTP failures, malformed rows and wrong-page responses stay errors until a valid retry succeeds',async()=>{
  const f=fixture();await f.flush();await respond(f,{error:'Controlled service failure'},false);
  assert.match(f.status(),/Controlled service failure/);assert.equal(cards(f).length,0);await f.click('Retry directory');
  await respond(f,page([{...issue,id:NaN}]));assert.match(f.status(),/incomplete response/);assert.equal(cards(f).length,0);
  await f.click('Retry directory');await respond(f,page([issue],{offset:12}));assert.match(f.status(),/another page/);
  await f.click('Retry directory');await respond(f,page([issue]));assert.equal(cards(f).length,1);assert.ok(!f.status().includes('unavailable'));f.unmount();
});
await report.test('Coverage reports partial GCD imports and attribution outside cards while old response versions remain usable',async()=>{
  const f=await loaded(page([other],{scope:'shared',issueCount:44,gcdIssueCount:1,lastGcdSyncedAt:'2026-10-13T10:00:00.000Z'}));
  assert.match(f.snapshot(),/1 imported from GCD/);assert.match(f.snapshot(),/not a complete comic catalog/);assert.match(f.snapshot(),/Grand Comics Database/);
  const c=cardFixture(cards(f)[0].props.issue);await c.flush();assert.equal(c.snapshot().includes('GCD'),false);c.unmount();f.unmount();
  const old=await loaded(page([issue]));assert.equal(cards(old).length,1);assert.ok(!old.snapshot().includes('undefined'));old.unmount();
});
await report.test('A selected exact picker result opens once and unmount cancels its pending catalog response',async()=>{
  const opened=[],f=fixture({props:{onOpen:record=>opened.push(record)}});await f.flush();
  const picker=f.find(node=>typeof node.type==='function'&&node.type.name==='ComicPicker');picker.props.onChange(other);await f.flush();
  assert.equal(opened.length,1);assert.equal(opened[0].id,4000256114);const pending=f.calls.requests[0],before=f.snapshot();
  f.unmount();assert.equal(pending.options.signal.aborted,true);await respond(f,page());assert.equal(f.snapshot(),before);
});
report.finish({genuineProviderRequests:0,browserExecuted:false,cssLayout:'source contracts only'});
