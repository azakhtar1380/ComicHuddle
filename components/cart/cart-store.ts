'use client';
// One shared, tiny client store for the cart count and which listings are in the cart, so every
// Add-to-cart button and the header/dock icon share a single request. Anything that changes the cart
// dispatches `ch:cart-changed` on window; the store refetches on that event.
// Guests keep a small cart in this browser (localStorage); it is merged into the account after sign-in.
import {useEffect,useSyncExternalStore} from 'react';

export const CART_CHANGED_EVENT='ch:cart-changed';
const GUEST_KEY='ch:guest-cart';
const GUEST_MAX=50;

export type CartState={loaded:boolean;signedIn:boolean;count:number;listingIds:string[];savedIds:string[];holds:number};
const initial:CartState={loaded:false,signedIn:false,count:0,listingIds:[],savedIds:[],holds:0};
let state:CartState=initial,inflight:Promise<void>|null=null,queued=false,lastFetch=0;
const listeners=new Set<()=>void>();
function emit(next:CartState){state=next;for(const listener of listeners)listener()}

export function readGuestCart():string[]{
 try{const value=JSON.parse(window.localStorage.getItem(GUEST_KEY)||'[]') as unknown;return Array.isArray(value)?value.filter((id):id is string=>typeof id==='string'&&id.length>0&&id.length<=100).slice(0,GUEST_MAX):[]}catch{return []}
}
function writeGuestCart(ids:string[]){try{if(ids.length)window.localStorage.setItem(GUEST_KEY,JSON.stringify(ids.slice(0,GUEST_MAX)));else window.localStorage.removeItem(GUEST_KEY)}catch{/* storage blocked */}}
export function addToGuestCart(listingId:string){const ids=readGuestCart();if(!ids.includes(listingId))writeGuestCart([listingId,...ids]);notifyCartChanged()}
export function removeFromGuestCart(listingId:string){writeGuestCart(readGuestCart().filter(id=>id!==listingId));notifyCartChanged()}

/** Tell every cart button (and the header/dock count) that the cart changed. */
export function notifyCartChanged(){if(typeof window!=='undefined')window.dispatchEvent(new Event(CART_CHANGED_EVENT))}

async function load(){
 lastFetch=Date.now();
 try{
  const response=await fetch('/api/cart?kind=count',{credentials:'same-origin',cache:'no-store'});if(!response.ok)return;
  const body=await response.json() as Partial<CartState>&{unavailable?:boolean};
  const ids=(value:unknown)=>Array.isArray(value)?value.filter((id):id is string=>typeof id==='string'):[];
  if(!body.signedIn){const guest=readGuestCart();emit({loaded:true,signedIn:false,count:guest.length,listingIds:guest,savedIds:[],holds:0});return}
  emit({loaded:true,signedIn:true,count:Number(body.count)||0,listingIds:ids(body.listingIds),savedIds:ids(body.savedIds),holds:Number(body.holds)||0});
  // Just signed in with comics saved as a guest: move them into the account cart once.
  const guest=readGuestCart();
  if(guest.length&&!body.unavailable){
   const merged=await fetch('/api/cart',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'merge',listingIds:guest})});
   if(merged.ok){writeGuestCart([]);const next=await merged.json() as Partial<CartState>;emit({loaded:true,signedIn:true,count:Number(next.count)||0,listingIds:ids(next.listingIds),savedIds:ids(next.savedIds),holds:Number(next.holds)||0})}
  }
 }catch{/* offline: keep the last known count */}
}
export function refreshCart(){
 if(typeof window==='undefined')return Promise.resolve();
 if(inflight){queued=true;return inflight}
 inflight=load().finally(()=>{inflight=null;if(queued){queued=false;void refreshCart()}});
 return inflight;
}
const onChanged=()=>void refreshCart();
const onVisible=()=>{if(document.visibilityState==='visible'&&Date.now()-lastFetch>30_000)void refreshCart()};
const onStorage=(event:StorageEvent)=>{if(event.key===GUEST_KEY)void refreshCart()};
function subscribe(listener:()=>void){
 listeners.add(listener);
 if(listeners.size===1){window.addEventListener(CART_CHANGED_EVENT,onChanged);window.addEventListener('storage',onStorage);document.addEventListener('visibilitychange',onVisible)}
 return()=>{listeners.delete(listener);if(!listeners.size){window.removeEventListener(CART_CHANGED_EVENT,onChanged);window.removeEventListener('storage',onStorage);document.removeEventListener('visibilitychange',onVisible)}};
}
/** Live cart state (count, listing ids in the cart, saved ids). */
export function useCartState(){
 const value=useSyncExternalStore(subscribe,()=>state,()=>initial);
 useEffect(()=>{if(!state.loaded&&!inflight)void refreshCart()},[]);
 return value;
}
/** Number shown on the cart icon: comics in the cart plus comics held for you awaiting payment. */
export function useCartCount(){return useCartState().count}
/** Apply a server response from a cart write without waiting for a refetch. */
export function applyCartResponse(body:unknown){
 if(!body||typeof body!=='object')return;const value=body as Partial<CartState>;
 if(typeof value.count!=='number')return;
 const ids=(list:unknown)=>Array.isArray(list)?list.filter((id):id is string=>typeof id==='string'):[];
 emit({loaded:true,signedIn:true,count:value.count,listingIds:ids(value.listingIds),savedIds:ids(value.savedIds),holds:Number(value.holds)||0});
}
