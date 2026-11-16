'use client';
// SafePurchase badge for listing cards, listing detail and checkout.
// It reads the public protection settings (/api/commerce?kind=setup) once per page, so it only says
// "SafePurchase" when the Inspection Center is switched on (SAFEPURCHASE_ENABLED + address) and otherwise
// "SafePurchase coming soon". It never claims an inspection happened.
//
// Usage: <SafePurchaseBadge priceCents={listing.price} />   (shows at or above the threshold)
//        <SafePurchaseBadge priceCents={price} sellerOptIn />  (seller offers it below the threshold)
//        <SafePurchaseBadge always compact />                  (just the mark, e.g. in a dense card)
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {safePurchaseRecommended} from '../lib/safepurchase-steps';
import './safepurchase-badge.css';

export type SafePurchaseSetup={enabled:boolean;thresholdCents:number};
let cached:Promise<SafePurchaseSetup|null>|null=null;
function loadSetup(){
  cached||=fetch('/api/commerce?kind=setup',{credentials:'same-origin'}).then(r=>r.ok?r.json():null).then(body=>{
    const p=body?.protection;return p&&typeof p.safePurchaseThresholdCents==='number'?{enabled:p.safePurchaseEnabled===true,thresholdCents:p.safePurchaseThresholdCents}:null;
  }).catch(()=>{cached=null;return null});
  return cached;
}
/** Public SafePurchase settings, or null while loading / unavailable. */
export function useSafePurchaseSetup(){
  const [setup,setSetup]=useState<SafePurchaseSetup|null>(null);
  useEffect(()=>{let live=true;void loadSetup().then(value=>{if(live)setSetup(value)});return()=>{live=false}},[]);
  return setup;
}

export default function SafePurchaseBadge({priceCents,sellerOptIn=false,always=false,compact=false,link=true,setup:given,onlyWhenEnabled=false,label}:{priceCents?:number|null;sellerOptIn?:boolean;always?:boolean;compact?:boolean;link?:boolean;setup?:SafePurchaseSetup|null;onlyWhenEnabled?:boolean;label?:string}){
  const loaded=useSafePurchaseSetup(),setup=given===undefined?loaded:given;
  if(!setup||onlyWhenEnabled&&!setup.enabled)return null;
  if(!always&&!sellerOptIn&&!safePurchaseRecommended(priceCents??null,setup.thresholdCents))return null;
  const text=setup.enabled?label||'SafePurchase':'SafePurchase coming soon';
  const hint=setup.enabled?'We check this comic before it ships to you. Tap to learn how SafePurchase works.':'SafePurchase inspection isn’t open yet. This order would get Standard Protection.';
  const body=<><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.2 4 5.2v6.1c0 5 3.4 9.3 8 10.5 4.6-1.2 8-5.5 8-10.5V5.2l-8-3Z" fill="currentColor"/><path d="m8.2 12.1 2.6 2.6 5-5.2" fill="none" stroke="var(--sp-badge-tick,#fff)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>{!compact&&<span>{text}</span>}</>;
  const className='ch-sp-badge'+(setup.enabled?'':' is-soon')+(compact?' is-compact':'');
  return link?<Link href="/safepurchase" className={className} title={hint} aria-label={text+'. '+hint}>{body}</Link>:<span className={className} title={hint} aria-label={text}>{body}</span>;
}
