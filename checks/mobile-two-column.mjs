// Actual compact component callbacks plus a scoped source CSS cascade/box model.
// No browser/font layout, screenshot or physical device result is inferred.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createReporter,loadTypeScriptModule,plain} from '../architecture/postgres/tests/runtime.mjs';
import {createScannerFixture} from './scanner-hooks.mjs';
import {readCssRules,cssNode,cssAt,cssLength,horizontalBox} from './css-source-model.mjs';

const report=createReporter('Mobile two-column Directory source geometry');
const rules=readCssRules(['app/globals.css','app/shared-directory.css']);
const starter=plain(loadTypeScriptModule('lib/catalog.ts').catalog[24]);
const long={...starter,id:4000256114,gcdId:256114,title:'VeryLongUnbrokenSeriesTitle'.repeat(6),number:'A'.repeat(120),publisher:'LongPublisher'.repeat(8),cover:undefined};
const records=[starter,long],page={issues:records,total:2,limit:12,offset:0,hasMore:false,
  issueCount:44,scope:'shared',syncedIssueCount:0,gcdIssueCount:1,lastSyncedAt:null,lastGcdSyncedAt:null,publishers:[]};
const rows=[];
function pathTo(node,predicate,path=[]){
  if(Array.isArray(node)){for(const item of node){const found=pathTo(item,predicate,path);if(found)return found;}return null;}
  if(!node||typeof node!=='object')return null;
  const next=typeof node.type==='string'?[...path,cssNode(node.type,node.props)]:path;
  if(predicate(node))return next;
  return pathTo(node.props?.children,predicate,next);
}
async function directory(list){
  const opened=[],f=createScannerFixture({componentFile:'app/shared-directory.tsx',props:{onOpen:issue=>opened.push(issue)}});
  await f.flush();f.calls.requests[0].resolve({ok:true,json:async()=>page});await f.flush();
  if(list){f.find(node=>node.type==='button'&&node.props['aria-label']==='List view').props.onClick();await f.flush();}
  const tree=f.nodes()[0],card=f.find(node=>typeof node.type==='function'&&node.type.name==='DirectoryIssueCard');
  assert.ok(card);const path=pathTo(tree,node=>node===card);return {f,opened,path,card};
}
const style=(chain,width)=>cssAt(rules,chain,width);
const wrap=appView=>[cssNode('html',appView?{'data-app-view':'true'}:{}),cssNode('body'),cssNode('main',{id:'main-content'})];
const closeTo=(actual,expected,label)=>assert.ok(Math.abs(actual-expected)<0.001,label+': '+actual+' vs '+expected);

for(const width of [320,360,390,430,760])await report.test(width+'px global cascade keeps Grid and saved List at two bounded portrait cards',async()=>{
  let recorded;
  for(const list of [false,true]){
    const {f,opened,path,card}=await directory(list);
    for(const appView of [false,true]){
      const outer=wrap(appView),main=horizontalBox(style(outer,width),width);
      assert.equal(main.padding,width*.1,'Actual global main side padding is included');
      const parent=[...outer,...path];let contentWidth=main.contentWidth;
      for(let index=outer.length;index<parent.length;index++){
        const node=parent[index],nodeStyle=style(parent.slice(0,index+1),width);
        if(node.classes.includes('sd-browser'))assert.equal(nodeStyle['grid-template-columns'],'minmax(0,1fr)');
        if(node.classes.includes('sd-grid')||node.classes.includes('sd-list')){
          assert.equal(nodeStyle.display,'grid');assert.equal(nodeStyle['grid-template-columns'],'repeat(2,minmax(0,1fr))');
          const gap=cssLength(nodeStyle.gap,contentWidth);assert.equal(gap,12);
          contentWidth=(horizontalBox(nodeStyle,contentWidth).contentWidth-gap)/2;
        }else contentWidth=horizontalBox(nodeStyle,contentWidth).contentWidth;
      }
      const c=createScannerFixture({componentFile:'app/shared-directory.tsx',componentLocal:'DirectoryIssueCard',props:card.props});await c.flush();
      const root=c.nodes()[0],cardPath=pathTo(root,node=>node===root),cardStyle=style([...parent,...cardPath],width),box=horizontalBox(cardStyle,contentWidth);
      assert.equal(cardStyle.display,'flex');assert.equal(cardStyle['flex-direction'],'column');assert.equal(cardStyle['grid-template-columns'],'none');
      assert.equal(cardStyle['min-width'],'0');assert.equal(cardStyle['overflow'],'hidden');
      closeTo(box.width,(width*.9-12)/2,'Two cards exactly fill the available row');assert.equal(box.padding,0);assert.equal(box.border,2);
      const artPath=pathTo(root,node=>node.props?.className==='sd-art'),artStyle=style([...parent,...artPath],width),frame=horizontalBox(artStyle,box.contentWidth);
      assert.equal(artStyle['aspect-ratio'],'3/4');assert.equal(artStyle.height,'auto');assert.equal(artStyle['min-height'],'0');
      assert.equal(artStyle.position,'relative');assert.equal(artStyle['overflow'],'hidden');assert.equal(artStyle['flex-shrink'],'0');
      const height=Math.min(frame.width/(3/4),cssLength(artStyle['max-height'],frame.width,Infinity));
      closeTo(frame.width/height,.75,'Frame remains portrait at its actual cap');assert.ok(frame.width<=210&&height<=280);
      const imagePath=pathTo(root,node=>node.type==='img'),imageStyle=style([...parent,...imagePath],width);
      const imageWidth=cssLength(imageStyle.width,frame.contentWidth),imageHeight=cssLength(imageStyle.height,height);
      const boundedWidth=Math.min(imageWidth,cssLength(imageStyle['max-width'],frame.contentWidth,Infinity));
      const boundedHeight=Math.min(imageHeight,cssLength(imageStyle['max-height'],height,Infinity));
      assert.equal(imageStyle.position,'absolute');assert.equal(imageStyle.transform,'translate(-50%,-50%)');assert.equal(imageStyle['object-fit'],'contain');
      assert.ok(boundedWidth<=180&&boundedHeight<=252&&boundedWidth<=frame.width-20&&boundedHeight<=height-20);
      const info=style([...parent,...pathTo(root,node=>node.props?.className==='sd-info')],width);
      assert.equal(info['min-width'],'0');assert.equal(info['justify-content'],'flex-start');
      const title=style([...parent,...pathTo(root,node=>node.props?.className==='sd-title')],width);
      // JSX separates # and the value, so obtain the exact number span by parent.
      const actualNumber=c.find(node=>node.type==='span'&&Array.isArray(node.props?.children)&&node.props.children[0]==='#');
      assert.ok(actualNumber);const numberStyle=style([...parent,...pathTo(root,node=>node===actualNumber)],width);
      assert.equal(title['white-space'],'normal');assert.equal(title['overflow-wrap'],'anywhere');assert.equal(numberStyle['white-space'],'normal');assert.equal(numberStyle['overflow-wrap'],'anywhere');
      const togglePath=pathTo(f.nodes()[0],node=>node.props?.className==='sd-view-toggle');assert.equal(style([...outer,...togglePath],width).display,'none');
      recorded={viewportWidth:width,mainInnerWidth:main.contentWidth,cardWidth:box.width,frameWidth:frame.width,frameHeight:height,coverBoxWidth:boundedWidth,coverBoxHeight:boundedHeight};
      if(!appView)await c.click('More info');c.unmount();
    }
    assert.equal(opened.length,1);assert.equal(opened[0],starter);assert.equal(f.calls.requests.length,1);f.unmount();
  }
  rows.push(recorded);
});
await report.test('Desktop List remains a horizontal one-card row above the mobile breakpoint',async()=>{
  const {f,path}=await directory(true);
  for(const width of [761,1120,1440]){
    const chain=[...wrap(true),...path],grid=style(chain,width);assert.equal(grid.display,'grid');assert.notEqual(grid['grid-template-columns'],'repeat(2,minmax(0,1fr))');
    const c=createScannerFixture({componentFile:'app/shared-directory.tsx',componentLocal:'DirectoryIssueCard',props:{issue:starter,onOpen(){}}});await c.flush();
    const card=style([...chain,...pathTo(c.nodes()[0],node=>node.props?.className==='sd-card')],width);
    assert.equal(card.display,'grid');assert.equal(card['grid-template-columns'],'100px minmax(0,1fr)');
    const image=style([...chain,...pathTo(c.nodes()[0],node=>node.type==='img')],width);assert.equal(image.width,'64px');assert.equal(image.height,'92px');
    const toggle=style([...wrap(true),...pathTo(f.nodes()[0],node=>node.props?.className==='sd-view-toggle')],width);assert.equal(toggle.display,'flex');c.unmount();
  }f.unmount();
});
await report.test('Long title/issue/publisher and neutral art retain the exact selected identity and compact-only controls',async()=>{
  assert.match(readFileSync('app/hub.tsx','utf8'),/<main id="main-content"/);assert.match(readFileSync('app/layout.tsx','utf8'),/import ['"]\.\/globals\.css['"]/);
  const {f,path}=await directory(true),opened=[];
  const c=createScannerFixture({componentFile:'app/shared-directory.tsx',componentLocal:'DirectoryIssueCard',props:{issue:long,onOpen:value=>opened.push(value)}});await c.flush();
  assert.ok(c.snapshot().includes(long.title));assert.ok(c.snapshot().includes(long.number));assert.ok(c.snapshot().includes(long.publisher));
  assert.equal(c.nodes().filter(node=>node.type==='button').length,1);assert.equal(c.nodes().some(node=>['a','input','select','form','dialog'].includes(node.type)),false);
  for(const hidden of ['Add to Collection','Buy','FMV','GoCollect','Record source'])assert.equal(c.snapshot().includes(hidden),false);
  for(const width of [320,360,390,430,760]){
    const parent=[...wrap(true),...path],placeholder=style([...parent,...pathTo(c.nodes()[0],node=>node.props?.className==='sd-cover-empty')],width);
    assert.equal(placeholder.display,'grid');assert.equal(placeholder.position,'absolute');assert.equal(placeholder.width,'calc(100% - 20px)');assert.equal(placeholder['max-width'],'180px');assert.equal(placeholder['max-height'],'252px');
    const title=style([...parent,...pathTo(c.nodes()[0],node=>node.props?.className==='sd-title')],width);assert.equal(title['overflow-wrap'],'anywhere');assert.equal(title['max-width'],'100%');
  }
  await c.click('More info');assert.equal(opened.length,1);assert.equal(opened[0],long);assert.equal(opened[0].id,4000256114);c.unmount();f.unmount();
});
report.finish({geometry:rows,cssLayout:'source cascade and box model only',browserExecuted:false,genuineProviderRequests:0});
