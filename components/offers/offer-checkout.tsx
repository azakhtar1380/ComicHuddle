'use client';
// Accepted offer → its own checkout (never the cart). The server prices it at the accepted offer,
// re-checks the offer inside the reservation and applies the normal protection rules (SafePurchase
// automatically at the threshold, or when the buyer adds it). Payment happens on Stripe's page.
import {useEffect,useState} from 'react';
import {Lock,ShieldCheck} from 'lucide-react';
import './offers-ui.css';

type Setup={setup:{checkoutEnabled:boolean;mode?:string};protection?:{safePurchaseEnabled:boolean;safePurchaseThresholdCents:number;safePurchaseFeeCents:number;handlingBusinessDays:number}};
const STATES='AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' ');
const dollars=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
function stripeUrl(value:unknown){if(typeof value!=='string')return null;try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.hostname==='checkout.stripe.com'?u.href:null}catch{return null}}

export default function OfferCheckout({offerId,title,amountCents,shippingCents,fulfillment,onClose}:{offerId:string;title:string;amountCents:number;shippingCents:number;fulfillment:string;onClose:()=>void}){
 const [setup,setSetup]=useState<Setup|null>(null),[mode,setMode]=useState<'shipping'|'pickup'>(fulfillment==='pickup'?'pickup':'shipping'),[addSp,setAddSp]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[note,setNote]=useState(''),[requestId]=useState(()=>crypto.randomUUID());
 useEffect(()=>{const controller=new AbortController();void fetch('/api/commerce?kind=setup',{cache:'no-store',signal:controller.signal}).then(r=>r.json()).then(d=>{if(d&&typeof d==='object'&&d.setup)setSetup(d as Setup)}).catch(()=>undefined);return()=>controller.abort()},[]);
 const sp=setup?.protection,spOn=!!sp?.safePurchaseEnabled,auto=spOn&&amountCents>=(sp?.safePurchaseThresholdCents??Infinity),spApplies=auto||spOn&&addSp,fee=spApplies?sp?.safePurchaseFeeCents??0:0;
 const ship=mode==='pickup'?0:shippingCents,total=amountCents+ship+fee,enabled=!!setup?.setup.checkoutEnabled;
 async function submit(form:HTMLFormElement){
  setBusy(true);setError('');setNote('');
  try{
   const f=new FormData(form),address=mode==='shipping'?{name:String(f.get('name')||'').trim(),line1:String(f.get('line1')||'').trim(),line2:String(f.get('line2')||'').trim(),city:String(f.get('city')||'').trim(),state:String(f.get('state')||''),postalCode:String(f.get('postalCode')||'').trim(),country:'US'}:undefined;
   const r=await fetch('/api/offers',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({action:'offer_checkout',offerId,requestId,sandboxAcknowledged:true,fulfillment:mode,...(address?{shippingAddress:address}:{}),checkoutUiMode:'hosted_page',safePurchaseOptIn:spOn&&addSp&&!auto})});
   const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(typeof d?.error==='string'?d.error:'Checkout could not start. Nothing was charged.');
   const url=stripeUrl(d.checkoutUrl);if(url){window.location.assign(url);return}
   setNote(typeof d.note==='string'?d.note:'This checkout is no longer open. Check Orders.');
  }catch(e){setError(e instanceof Error?e.message:'Checkout could not start. Nothing was charged.')}finally{setBusy(false)}
 }
 return <form className="offer-checkout" onSubmit={e=>{e.preventDefault();void submit(e.currentTarget)}} aria-label={'Checkout for '+title}>
  <h3><Lock size={16} aria-hidden="true"/> Checkout at your accepted price</h3>
  {fulfillment==='both'&&<fieldset className="offer-checkout-mode"><legend>How do you want it?</legend>
   <label><input type="radio" name="mode" checked={mode==='shipping'} onChange={()=>setMode('shipping')}/> Ship it to me ({shippingCents?dollars(shippingCents):'free'})</label>
   <label><input type="radio" name="mode" checked={mode==='pickup'} onChange={()=>setMode('pickup')}/> Local pickup (pay now, get a pickup code)</label></fieldset>}
  {mode==='shipping'?<div className="offer-checkout-address">
   <label className="span-2">Full name<input name="name" required maxLength={100} autoComplete="name"/></label>
   <label className="span-2">Street address<input name="line1" required maxLength={160} autoComplete="address-line1"/></label>
   <label className="span-2">Apt, suite (optional)<input name="line2" maxLength={160} autoComplete="address-line2"/></label>
   <label>City<input name="city" required maxLength={100} autoComplete="address-level2"/></label>
   <label>State<select name="state" required defaultValue="" autoComplete="address-level1"><option value="" disabled>Choose</option>{STATES.map(s=><option key={s}>{s}</option>)}</select></label>
   <label>ZIP code<input name="postalCode" required inputMode="numeric" pattern="\d{5}(-\d{4})?" maxLength={10} autoComplete="postal-code"/></label>
   <small className="data-caption span-2">USA addresses only. The seller sees it only after payment is confirmed, and only until delivery.</small>
  </div>:<p className="data-caption">{spApplies?'With SafePurchase you collect it at the ComicHuddle Inspection Center with a one-time pickup code, after it passes inspection.':'After you pay, your order shows a one-time pickup code (number and QR). Share it with the seller only once the comic is in your hands. Unused codes expire after 7 days and you’re refunded.'}</p>}
  {spOn&&(auto?<p className="offer-checkout-sp"><ShieldCheck size={15} aria-hidden="true"/> SafePurchase is included: we inspect it before it reaches you.</p>:<label className="offer-checkout-sp"><input type="checkbox" checked={addSp} onChange={e=>setAddSp(e.target.checked)}/> Add SafePurchase{sp?.safePurchaseFeeCents?' ('+dollars(sp.safePurchaseFeeCents)+')':''}: we inspect it before it reaches you</label>)}
  <dl className="offer-checkout-total"><div><dt>Accepted offer</dt><dd>{dollars(amountCents)}</dd></div><div><dt>{mode==='pickup'?'Local pickup':'Shipping'}</dt><dd>{ship?dollars(ship):'Free'}</dd></div>{fee>0&&<div><dt>SafePurchase</dt><dd>{dollars(fee)}</dd></div>}<div className="is-total"><dt>Total</dt><dd>{dollars(total)}</dd></div></dl>
  {setup&&setup.setup.mode!=='live'&&<p className="data-caption">Test mode: use Stripe test cards. No real money moves.</p>}
  {setup&&!enabled&&<p className="ds-error" role="alert">Checkout is unavailable right now. Nothing was charged.</p>}
  {error&&<p className="ds-error" role="alert">{error}</p>}{note&&<p role="status">{note}</p>}
  <div className="offer-actions"><button className="ds-btn ds-btn-primary" disabled={busy||!enabled}>{busy?'Opening secure payment…':'Pay '+dollars(total)}</button><button type="button" className="ds-btn ds-btn-secondary" disabled={busy} onClick={onClose}>Not now</button></div>
 </form>;
}
