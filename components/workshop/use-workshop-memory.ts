'use client';
// Saved studios and recently viewed studios for Comic Workshop. Stored only in this browser
// (localStorage, per signed-in profile); every read and write is guarded so private mode still works.
import {useCallback,useSyncExternalStore} from 'react';

const listeners=new Set<()=>void>();
const cache=new Map<string,{raw:string|null;value:string[]}>();
const empty:string[]=[];
function read(key:string):string[]{
 let raw:string|null=null;
 try{raw=window.localStorage.getItem(key)}catch{return empty}
 const hit=cache.get(key);if(hit&&hit.raw===raw)return hit.value;
 let value:string[]=empty;
 try{const parsed=raw?JSON.parse(raw):[];value=Array.isArray(parsed)?parsed.filter((v):v is string=>typeof v==='string').slice(0,50):empty}catch{value=empty}
 cache.set(key,{raw,value});return value;
}
function write(key:string,value:string[]){try{window.localStorage.setItem(key,JSON.stringify(value))}catch{/* storage unavailable */}listeners.forEach(fn=>fn())}
function subscribe(fn:()=>void){listeners.add(fn);const onStorage=(e:StorageEvent)=>{if(e.key?.startsWith('ch-workshop-'))fn()};window.addEventListener('storage',onStorage);return()=>{listeners.delete(fn);window.removeEventListener('storage',onStorage)}}

export function useWorkshopMemory(owner:string|undefined){
 const scope=owner||'guest',savedKey='ch-workshop-saved:'+scope,recentKey='ch-workshop-recent:'+scope;
 const saved=useSyncExternalStore(subscribe,()=>read(savedKey),()=>empty);
 const recent=useSyncExternalStore(subscribe,()=>read(recentKey),()=>empty);
 const toggleSaved=useCallback((id:string)=>{const current=read(savedKey);write(savedKey,current.includes(id)?current.filter(v=>v!==id):[id,...current].slice(0,50))},[savedKey]);
 const markViewed=useCallback((id:string)=>{write(recentKey,[id,...read(recentKey).filter(v=>v!==id)].slice(0,8))},[recentKey]);
 const clearRecent=useCallback(()=>write(recentKey,[]),[recentKey]);
 return {saved,recent,toggleSaved,markViewed,clearRecent,isSaved:(id:string)=>saved.includes(id)};
}
export type WorkshopMemory=ReturnType<typeof useWorkshopMemory>;
