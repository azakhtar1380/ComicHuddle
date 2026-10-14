// Model offscreen focus scrolling to guard the animated account-drawer regression.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const listeners=new Set(),page={x:0,y:420};
const document={
 activeElement:null,body:{style:{overflow:'auto'}},
 addEventListener:(type,fn)=>{assert.equal(type,'keydown');listeners.add(fn)},
 removeEventListener:(type,fn)=>{assert.equal(type,'keydown');listeners.delete(fn)}
};
function target(rect){
 return {isConnected:true,focus(options){
  document.activeElement=this;
  if(!options?.preventScroll){const r=this.getBoundingClientRect();page.x=r.left;page.y=r.top}
 },getBoundingClientRect:()=>rect};
}
function dialog(){
 const element=target({left:600,top:100,bottom:500});
 element.scrollTop=0;element.clientTop=0;element.clientHeight=400;
 const first=target({}),last=target({});
 first.getBoundingClientRect=()=>({left:10,top:100-element.scrollTop,bottom:140-element.scrollTop});
 last.getBoundingClientRect=()=>({left:10,top:950-element.scrollTop,bottom:990-element.scrollTop});
 element.querySelectorAll=()=>[first,last];
 element.contains=node=>node===element||node===first||node===last;
 return {element,first,last};
}
const trigger=target({left:20,top:-80,bottom:-40});
document.activeElement=trigger;
const source=readFileSync('lib/dialog-focus.ts','utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const context={exports:{},document};vm.runInNewContext(compiled,context);
const {activateDialog}=context.exports;
function key(key,shiftKey=false,target=null){
 const event={key,shiftKey,target,prevented:false,preventDefault(){this.prevented=true}};
 for(const listener of listeners)listener(event);
 return event;
}
function staysPut(){assert.equal(page.x,0,'Offscreen drawer focus moved the page sideways');assert.equal(page.y,420,'Modal focus changed the page scroll position')}

const outer=dialog();let outerClosed=0;
const closeOuter=activateDialog(outer.element,()=>outerClosed++);
staysPut();assert.equal(document.activeElement,outer.element);assert.equal(document.body.style.overflow,'hidden');
assert(key('Tab',true).prevented);assert.equal(document.activeElement,outer.last);
assert.equal(outer.element.scrollTop,490,'Keyboard focus should scroll only the drawer to reveal its last control');staysPut();
assert(key('Tab').prevented);assert.equal(document.activeElement,outer.first);assert.equal(outer.element.scrollTop,0);staysPut();

const inner=dialog();let innerClosed=0;
const closeInner=activateDialog(inner.element,()=>innerClosed++);
key('Escape');assert.equal(innerClosed,1);assert.equal(outerClosed,0,'Covered dialogs must ignore Escape');
closeInner();assert.equal(document.body.style.overflow,'hidden','Closing a child dialog unlocked the page too early');
assert.equal(document.activeElement,outer.first);staysPut();
closeOuter();assert.equal(document.activeElement,trigger);assert.equal(document.body.style.overflow,'auto');staysPut();
closeOuter();assert.equal(listeners.size,0,'Dialog cleanup must be idempotent');

for(let i=0;i<10;i++){
 const next=dialog(),close=activateDialog(next.element,()=>{});staysPut();close();staysPut();
 assert.equal(document.activeElement,trigger);assert.equal(document.body.style.overflow,'auto');
}
const parent=dialog(),child=dialog();
const parentClose=activateDialog(parent.element,()=>{}),childClose=activateDialog(child.element,()=>{});
parent.element.isConnected=false;parentClose();
assert.equal(document.body.style.overflow,'hidden','Removing a covered dialog unlocked the active child');
childClose();assert.equal(document.body.style.overflow,'auto');staysPut();assert.equal(listeners.size,0);
const detail=dialog();let detailClosed=0;
const closeDetail=activateDialog(detail.element,()=>detailClosed++);
const nativeControl=target({left:50,top:200,bottom:240});
nativeControl.closest=selector=>{assert.equal(selector,'dialog[open]');return {nodeName:'DIALOG'};};
document.activeElement=nativeControl;
for(const [name,shift] of [['Escape',false],['Tab',false],['Tab',true]]){
 assert.equal(key(name,shift,nativeControl).prevented,false,'Outer issue detail intercepted native form keyboard handling');
 assert.equal(detailClosed,0,'Outer issue detail closed above a native collection dialog');
 assert.equal(document.activeElement,nativeControl,'Outer detail stole focus from the native form');
 assert.equal(document.body.style.overflow,'hidden');staysPut();
}
nativeControl.closest=()=>null;
assert.equal(key('Escape',false,nativeControl).prevented,true);assert.equal(detailClosed,1,'Outer Escape did not resume after native modal closure');
closeDetail();assert.equal(listeners.size,0);assert.equal(document.body.style.overflow,'auto');staysPut();
console.log('PASS: offscreen drawer open/close preserves page position; keyboard scrolling stays inside dialogs; nested custom/native dialogs retain focus and scroll locks.');
