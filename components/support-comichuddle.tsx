'use client';
// "Support ComicHuddle" (homepage and About us): one-time payments to ComicHuddle itself through Stripe Checkout.
// Not a charity: the disclosure below is shown wherever this appears.
import {useState} from 'react';
import {ArrowUpRight,Heart} from 'lucide-react';
import './support-comichuddle.css';

const PRESETS=[500,1000,2500];
const DISCLOSURE='Your support goes directly to ComicHuddle (Malik LLC) to keep the site running and improving. Contributions aren’t charitable donations and aren’t tax-deductible.';

export default function SupportComicHuddle({id='support'}:{id?:string}){
 const [amount,setAmount]=useState(1000),[custom,setCustom]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const customCents=custom?Math.round(Number(custom)*100):NaN,cents=custom?customCents:amount;
 const invalid=!Number.isSafeInteger(cents)||cents<100||cents>50000;
 async function pay(){
  if(busy||invalid)return;setBusy(true);setError('');
  try{
   const response=await fetch('/api/support',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({amountCents:cents}),signal:AbortSignal.timeout(20000)});
   const body=await response.json().catch(()=>({})) as {url?:string;error?:string};
   if(!response.ok||typeof body.url!=='string'||!body.url.startsWith('https://checkout.stripe.com/'))throw Error(body.error||'Checkout couldn’t start. Nothing was charged.');
   window.location.assign(body.url);
  }catch(problem){setError(problem instanceof Error?problem.message:'Checkout couldn’t start. Nothing was charged.');setBusy(false)}
 }
 return <section className="support-ch" id={id} aria-labelledby={id+'-title'}>
  <div className="support-ch-copy">
   <p className="ds-eyebrow"><Heart size={14} aria-hidden="true"/> Support ComicHuddle</p>
   <h2 id={id+'-title'}>Help us build a better <span>comic community.</span></h2>
   <p>ComicHuddle is built by a small team of collectors. If you like what we’re making, you can chip in to keep it growing: new features, better data and a fair place to buy and sell.</p>
  </div>
  <div className="support-ch-form">
   <div className="support-ch-amounts" role="group" aria-label="Choose an amount">
    {PRESETS.map(value=><button key={value} type="button" className={'support-ch-chip'+(!custom&&amount===value?' is-on':'')} aria-pressed={!custom&&amount===value} onClick={()=>{setAmount(value);setCustom('')}}>${value/100}</button>)}
    <label className="support-ch-custom"><span>Other</span><span className="support-ch-dollar" aria-hidden="true">$</span><input type="number" inputMode="decimal" min="1" max="500" step="1" value={custom} placeholder="1–500" aria-label="Custom amount in US dollars, $1 to $500" onChange={event=>setCustom(event.target.value)}/></label>
   </div>
   {custom&&invalid&&<p className="ds-error" role="status">Choose an amount between $1 and $500.</p>}
   <button type="button" className="ds-btn ds-btn-primary" disabled={busy||invalid} onClick={()=>void pay()}>{busy?'Opening secure checkout…':'Support with $'+(invalid?'—':(cents/100).toFixed(cents%100?2:0))} <ArrowUpRight size={16} aria-hidden="true"/></button>
   {error&&<p className="ds-error" role="alert">{error}</p>}
   <p className="support-ch-fine">{DISCLOSURE} One-time payment through Stripe. It doesn’t add store credit, points or wallet balance.</p>
  </div>
 </section>;
}
