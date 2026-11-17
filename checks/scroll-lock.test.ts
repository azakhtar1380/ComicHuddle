// The shared scroll lock (lib/dialog-focus.ts): nested dialogs opened and closed in any order always leave the
// page unlocked at the end, and the scroll bar's width is padded while locked so nothing jumps sideways.
import {test} from 'node:test';
import assert from 'node:assert/strict';

type Listener=(event:unknown)=>void;
function fakeDom(){
 const listeners=new Map<string,Set<Listener>>();
 const body={style:{overflow:'',paddingRight:''} as Record<string,string>};
 const el=()=>({isConnected:true,focus(){},contains:()=>false,querySelectorAll:()=>[]});
 Object.assign(globalThis,{
  window:{innerWidth:1015},
  document:{body,documentElement:{clientWidth:1000},activeElement:null,addEventListener:(t:string,l:Listener)=>{if(!listeners.has(t))listeners.set(t,new Set());listeners.get(t)!.add(l)},removeEventListener:(t:string,l:Listener)=>listeners.get(t)?.delete(l)},
  requestAnimationFrame:(cb:()=>void)=>setTimeout(cb,0),
 });
 return {body,el,listeners};
}

test('nested dialogs in any order always unlock the page; the scroll bar width is padded while locked',async()=>{
 const {body,el,listeners}=fakeDom();
 const {activateDialog,lockedDialogs}=await import('../lib/dialog-focus');
 const orders=[[0,1,2],[2,1,0],[1,0,2],[1,2,0]];
 for(const order of orders){
  body.style.overflow='auto';body.style.paddingRight='';
  const release=[0,1,2].map(()=>activateDialog(el() as unknown as HTMLElement,()=>undefined)!);
  assert.equal(body.style.overflow,'hidden');assert.equal(body.style.paddingRight,'15px','pads by the scroll bar width');
  assert.equal(lockedDialogs(),3);
  for(const i of order){release[i]();release[i]()}           // closing twice is harmless
  assert.equal(body.style.overflow,'auto','restored after '+order.join(','));assert.equal(body.style.paddingRight,'');
  assert.equal(lockedDialogs(),0);
  assert.equal(listeners.get('keydown')?.size||0,0,'no key listeners left behind');
 }
});
