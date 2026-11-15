'use client';
// "Thank you for your purchase" — shown on the Orders view after Stripe sends the buyer back
// (?checkout=return&order=…). The return URL alone proves nothing: we only say "Thank you" once
// GET /api/commerce?order=… reports paymentConfirmed, which the server sets only after a
// signature-verified Stripe webhook whose Checkout Session Stripe reports as paid.
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {ArrowRight,RefreshCw} from 'lucide-react';
import HuddlesGuide from '../components/huddles-guide';
import {LoadingState} from '../components/states';
import './order-thank-you.css';

// The hub rewrites the URL (dropping checkout/order) before the Orders view mounts, so the return
// marker is read once when this module first loads on the page.
let pendingReturn:string|null=null;
if(typeof window!=='undefined'){
 const params=new URLSearchParams(window.location.search),id=params.get('order');
 if(params.get('checkout')==='return'&&id&&/^[A-Za-z0-9_-]{1,100}$/.test(id))pendingReturn=id;
}
/** The order id Stripe just returned the buyer for on this page load (idempotent, so safe in a state initializer). */
export function checkoutReturnOrder(){return pendingReturn}
/** Forget the return marker so the screen isn't shown again when the buyer comes back to Orders. */
export function clearCheckoutReturn(){pendingReturn=null}

type ReturnedOrder={id:string;role:string;status:string;title:string;totalCents:number;itemCount:number;paymentConfirmed?:boolean};
type Phase={kind:'checking'}|{kind:'confirmed';order:ReturnedOrder}|{kind:'failed'}|{kind:'pending'};
const failedStatuses=new Set(['cancelled','checkout_expired']);
const notThankable=new Set(['cancelled','checkout_expired','refunded','refund_pending']);
// Webhooks usually land within a few seconds; back off over roughly 25 seconds before giving up.
const delays=[0,1500,2500,4000,6000,9000];
const dollars=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);

function readOrder(value:unknown,orderId:string):ReturnedOrder|null{
 if(!value||typeof value!=='object')return null;const order=(value as {order?:unknown}).order;
 if(!order||typeof order!=='object')return null;const o=order as Record<string,unknown>;
 if(o.id!==orderId||typeof o.status!=='string'||typeof o.title!=='string'||typeof o.totalCents!=='number')return null;
 return {id:o.id,role:String(o.role),status:o.status,title:o.title,totalCents:o.totalCents,itemCount:typeof o.itemCount==='number'?o.itemCount:1,paymentConfirmed:o.paymentConfirmed===true};
}

export default function OrderThankYou({orderId,onConfirmed,onViewOrder}:{orderId:string;onConfirmed?:()=>void;onViewOrder:(orderId:string)=>void}){
 const [phase,setPhase]=useState<Phase>({kind:'checking'}),run=useRef(0),headingRef=useRef<HTMLHeadingElement>(null),confirmedRef=useRef(onConfirmed);
 useEffect(()=>{confirmedRef.current=onConfirmed},[onConfirmed]);
 const check=useCallback(async()=>{
  const id=++run.current;
  for(const wait of delays){
   if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
   if(run.current!==id)return;
   try{
    const response=await fetch('/api/commerce?order='+encodeURIComponent(orderId),{cache:'no-store',credentials:'same-origin'});
    if(run.current!==id)return;
    if(!response.ok)continue;
    const order=readOrder(await response.json(),orderId);if(run.current!==id)return;
    if(!order||order.role!=='buyer')continue;
    if(order.paymentConfirmed&&!notThankable.has(order.status)){setPhase({kind:'confirmed',order});confirmedRef.current?.();return}
    // Stripe confirmed the session ended unpaid (expired, or a delayed payment failed): no money was taken.
    if(!order.paymentConfirmed&&failedStatuses.has(order.status)){setPhase({kind:'failed'});return}
   }catch{/* network hiccup: keep polling */}
  }
  if(run.current===id)setPhase({kind:'pending'});
 },[orderId]);
 useEffect(()=>{void check();const current=run;return()=>{current.current++}},[check]);
 useEffect(()=>{if(phase.kind==='confirmed')headingRef.current?.focus()},[phase.kind]);

 if(phase.kind==='checking')return <section className="oty oty-checking" aria-label="Payment confirmation"><LoadingState message="Confirming your payment…"/></section>;
 if(phase.kind!=='confirmed')return <section className="oty oty-problem" role="alert" aria-label="Payment confirmation">
  <p className="oty-problem-text">{phase.kind==='failed'?'We couldn’t confirm your payment. You haven’t been charged.':'We couldn’t confirm your payment yet. Check Orders in a minute.'}</p>
  <div className="oty-actions">
   {phase.kind==='pending'&&<button type="button" className="ds-btn ds-btn-primary" onClick={()=>{setPhase({kind:'checking'});void check()}}><RefreshCw size={16} aria-hidden="true"/> Try again</button>}
   <Link className="ds-btn ds-btn-secondary" href="/?section=Marketplace">Back to the Marketplace</Link>
  </div>
 </section>;
 const {order}=phase;
 return <section className="oty" aria-labelledby="oty-title">
  <HuddlesGuide pose="thank-you" size="lg" className="oty-huddles"/>
  <div className="oty-copy">
   <p className="ds-eyebrow">Order confirmed</p>
   <h2 id="oty-title" ref={headingRef} tabIndex={-1} className="oty-title">THANK YOU!<span>YOUR COMIC IS ON ITS WAY.</span></h2>
   <p className="oty-lede">We’ve got your order. You can follow it anytime in Orders.</p>
   <dl className="oty-card">
    <div><dt>Order number</dt><dd className="oty-order-id">{order.id}</dd></div>
    <div><dt>{order.itemCount>1?order.itemCount+' comics':'Comic'}</dt><dd>{order.title}</dd></div>
    <div className="oty-total"><dt>Total paid</dt><dd>{dollars(order.totalCents)}</dd></div>
   </dl>
   <div className="oty-actions">
    <button type="button" className="ds-btn ds-btn-primary" onClick={()=>onViewOrder(order.id)}>View my order <ArrowRight size={16} aria-hidden="true"/></button>
    <Link className="ds-btn ds-btn-secondary" href="/?section=Marketplace">Keep browsing</Link>
   </div>
  </div>
 </section>;
}
