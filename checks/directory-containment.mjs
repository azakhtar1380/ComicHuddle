// Independent regression of the actual compact Directory handlers/JSX and CSS
// cascade. Intrinsic text/font/select sizing requires the prepared browser cases.
// This source model does not claim to render the screenshot or a physical device.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createReporter,loadTypeScriptModule,plain} from '../architecture/postgres/tests/runtime.mjs';
import {createScannerFixture} from './scanner-hooks.mjs';
import {readCssRules,cssNode,cssAt,horizontalBox,cssLength} from './css-source-model.mjs';

const report=createReporter('Directory root containment and uncluttered mobile navigation');
const baseline=plain(loadTypeScriptModule('lib/catalog.ts').catalog[24]);
const publisher='ExtremelyLongUnbrokenPublisherName'.repeat(8);
const issue={...baseline,id:4000000202,gcdId:202,title:'UnbrokenComicTitle'.repeat(16),number:'V'.repeat(120),publisher,cover:undefined};
const page={issues:[baseline,issue],total:2,limit:12,offset:0,hasMore:false,issueCount:45,
 scope:'shared',syncedIssueCount:0,gcdIssueCount:2,lastSyncedAt:null,lastGcdSyncedAt:null,publishers:[publisher]};
const widths=[320,375,390,430,700,760];
const orders=[['app/globals.css','app/comic-picker.css','app/shared-directory.css'],
 ['app/globals.css','app/shared-directory.css','app/comic-picker.css']].map(readCssRules);
const wrap=()=>[cssNode('html',{'data-app-view':'true'}),cssNode('body'),cssNode('main',{id:'main-content'})];
function pathTo(node,predicate,path=[]){
 if(Array.isArray(node)){for(const child of node){const found=pathTo(child,predicate,path);if(found)return found;}return null;}
 if(!node||typeof node!=='object')return null;
 const next=typeof node.type==='string'?[...path,cssNode(node.type,node.props)]:path;
 if(predicate(node))return next;return pathTo(node.props?.children,predicate,next);
}
const pathFor=(f,predicate)=>{const found=pathTo(f.nodes()[0],predicate);assert.ok(found,'Actual JSX path must exist');return found};
async function loaded(){const f=createScannerFixture({componentFile:'app/shared-directory.tsx',props:{onOpen(){}}});await f.flush();f.calls.requests[0].resolve({ok:true,json:async()=>page});await f.flush();return f;}
const byClass=name=>node=>node.props?.className?.split(/\s/).includes(name);

await report.test('Breadcrumb navigation is absent before and after an exact long publisher filter; the mobile tree contributes no layout',async()=>{
 const f=await loaded();
 for(let state=0;state<2;state++){
  assert.equal(f.nodes().some(byClass('sd-breadcrumbs')),false);assert.equal(f.nodes().some(node=>node.type==='nav'&&/breadcrumb/i.test(node.props?.['aria-label']||'')),false);
  const directoryTree=f.find(node=>typeof node.type==='function'&&node.type.name==='DirectoryTree');assert.ok(directoryTree);
  const t=createScannerFixture({componentFile:'app/directory-tree.tsx',props:directoryTree.props});await t.flush();
  const treePath=[...wrap(),...pathFor(f,node=>node===directoryTree),...pathFor(t,byClass('sd-tree'))];
  for(const rules of orders)for(const width of widths)assert.equal(cssAt(rules,treePath,width).display,'none','Publisher/series strip must not generate mobile min-content width');
  t.unmount();
  if(!state){f.find(node=>node.type==='select'&&node.props['aria-label']==='Filter publisher').props.onChange({target:{value:publisher}});await f.flush();const request=f.calls.requests.at(-1);assert.equal(new URL(request.url,'https://test.example').searchParams.get('publisher'),publisher);request.resolve({ok:true,json:async()=>page});await f.flush();}
 }
 assert.ok(!readFileSync('app/shared-directory.tsx','utf8').includes('sd-breadcrumbs'));f.unmount();
});
await report.test('Actual filter grid, labels and native selects have shrinkable bounded widths for hostile publisher options',async()=>{
 const f=await loaded(),labelPath=pathFor(f,node=>node.type==='select'&&node.props['aria-label']==='Filter publisher'),select=f.find(node=>node.type==='select'&&node.props['aria-label']==='Filter publisher');
 assert.ok(f.snapshot().includes(publisher));assert.equal(select.props.children[1][0].props.value,publisher);
 for(const rules of orders)for(const width of widths){
  const chain=[...wrap(),...labelPath];let available=horizontalBox(cssAt(rules,wrap(),width),width).contentWidth;
  for(let index=wrap().length;index<chain.length;index++){
   const node=chain[index],style=cssAt(rules,chain.slice(0,index+1),width);
   if(node.classes.includes('sd-browser')){assert.equal(style['grid-template-columns'],'minmax(0,1fr)');assert.equal(style['min-width'],'0');}
   if(node.classes.includes('sd-filters')){assert.equal(style.display,'grid');assert.equal(style['grid-template-columns'],'repeat(2,minmax(0,1fr))');assert.equal(style['min-width'],'0');available=(horizontalBox(style,available).contentWidth-cssLength(style.gap,available))/2;}
   else available=horizontalBox(style,available).contentWidth;
   if(['label','select'].includes(node.tag)){assert.equal(style['min-width'],'0');assert.equal(style['max-width'],'100%');assert.equal(style.width,'100%');}
   if(node.tag==='select'){assert.equal(style['font-size'],'16px');assert.ok(available>60&&available<width/2);}
  }
 }
 f.unmount();
});
await report.test('Desktop publisher and series navigation still selects the full untruncated identity while every text/flex child can shrink',async()=>{
 const f=await loaded(),directoryTree=f.find(node=>typeof node.type==='function'&&node.type.name==='DirectoryTree'),selected=[];
 const t=createScannerFixture({componentFile:'app/directory-tree.tsx',props:{...directoryTree.props,onPublisher:name=>selected.push(name)}});await t.flush();
 const button=t.find(node=>node.type==='button'&&node.props.children?.[0]?.props?.children===publisher);assert.ok(button);button.props.onClick();assert.deepEqual(selected,[publisher]);
 const textPath=[...wrap(),...pathFor(f,node=>node===directoryTree),...pathFor(t,node=>node===button.props.children[0])];
 for(const rules of orders)for(const width of [761,1120,1440]){
  const tree=cssAt(rules,[...wrap(),...pathFor(f,node=>node===directoryTree),...pathFor(t,byClass('sd-tree'))],width);assert.notEqual(tree.display,'none');assert.equal(tree['min-width'],'0');assert.equal(tree['max-width'],'100%');
  for(let index=textPath.findIndex(node=>node.classes.includes('sd-publisher-list'));index<textPath.length;index++){
   const style=cssAt(rules,textPath.slice(0,index+1),width);assert.equal(style['min-width'],'0');assert.equal(style['max-width'],'100%');assert.equal(style['overflow-wrap'],'anywhere');assert.notEqual(style['white-space'],'nowrap');
  }
  const browser=cssAt(rules,[...wrap(),...pathFor(f,byClass('sd-browser'))],width);assert.match(browser['grid-template-columns'],/^minmax\(0,(190|220)px\) minmax\(0,1fr\)$/);
 }
 t.unmount();f.unmount();
});
await report.test('The actual quick search input uses flex shrinking inside its own bounded row rather than a global overflow mask',async()=>{
 const f=await loaded(),component=f.find(node=>typeof node.type==='function'&&node.type.name==='ComicPicker'),picker=createScannerFixture({componentFile:'app/comic-picker.tsx',props:component.props});await picker.flush();
 const input=picker.find(node=>node.type==='input'),chain=[...wrap(),...pathFor(f,node=>node===component),...pathFor(picker,node=>node===input)];
 for(const rules of orders)for(const width of widths){
  let available=horizontalBox(cssAt(rules,wrap(),width),width).contentWidth;
  for(let index=wrap().length;index<chain.length;index++){
   const node=chain[index],style=cssAt(rules,chain.slice(0,index+1),width);available=horizontalBox(style,available).contentWidth;
   if(node.classes.some(name=>['sd-quick-find','comic-picker','picker-input'].includes(name))){assert.equal(style['min-width'],'0');assert.equal(style['max-width'],'100%');}
   if(node.classes.includes('picker-input')){assert.equal(style.display,'flex');assert.ok(available>100);}
   if(node.tag==='input'){assert.equal(style['min-width'],'0');assert.equal(style.flex,'1');assert.equal(style['max-width'],'100%');assert.equal(style['font-size'],'16px');}
  }
  for(const target of [wrap().slice(0,1),wrap().slice(0,2),wrap(),[...wrap(),...pathFor(f,byClass('shared-directory'))]]){
   const style=cssAt(rules,target,width);assert.ok(!['hidden','clip'].includes(style['overflow-x']),'Horizontal containment cannot be supplied by hiding the root overflow');
  }
 }
 picker.unmount();f.unmount();
});
await report.test('Long title, issue and publisher in compact cards wrap within two minmax tracks for both Grid and existing desktop List state',async()=>{
 const f=await loaded();
 for(const list of [false,true]){
  if(list){f.find(node=>node.type==='button'&&node.props['aria-label']==='List view').props.onClick();await f.flush();}
  const component=f.find(node=>typeof node.type==='function'&&node.type.name==='DirectoryIssueCard'&&node.props.issue.id===issue.id),c=createScannerFixture({componentFile:'app/shared-directory.tsx',componentLocal:'DirectoryIssueCard',props:component.props});await c.flush();
  const chain=[...wrap(),...pathFor(f,node=>node===component)],publisherPath=[...chain,...pathFor(c,byClass('sd-publisher'))];
  for(const rules of orders)for(const width of widths){
   const grid=cssAt(rules,chain,width);assert.equal(grid['grid-template-columns'],'repeat(2,minmax(0,1fr))');assert.equal(grid['min-width'],'0');
   const text=cssAt(rules,publisherPath,width);assert.equal(text['overflow-wrap'],'anywhere');assert.equal(text['white-space'],'normal');assert.equal(text['max-width'],'100%');
   const card=cssAt(rules,[...chain,...pathFor(c,byClass('sd-card'))],width);assert.equal(card['min-width'],'0');assert.equal(card['max-width'],'100%');assert.equal(card['flex-direction'],'column');
  }
  c.unmount();
 }
 f.unmount();
});
report.finish({modeledViewportWidths:widths,cssLayout:'source cascade/box constraints; no font or browser intrinsic sizing',browserExecuted:false,genuineProviderRequests:0});
