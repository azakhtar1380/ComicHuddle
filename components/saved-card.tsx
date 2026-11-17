'use client';
// Saved card + shipping address for auctions. The card is entered in Stripe's own form on this page (Apple Pay,
// Google Pay or a card; components/saved-card-elements.tsx), or on Stripe's page as a fallback; we keep only the
// brand and last 4 digits. Used in the Wallet and in front of the bid form (lib/saved-cards.ts).
import {useCallback,useEffect,useState,type FormEvent,type ReactNode} from 'react';
import dynamic from 'next/dynamic';
import {CreditCard,Lock,MapPin} from 'lucide-react';
import PayMarks from './pay-marks';
const SavedCardElements=dynamic(()=>import('./saved-card-elements'),{ssr:false,loading:()=><p className="scard-muted" role="status">Loading Apple Pay, Google Pay and card…</p>});
import './saved-card.css';

type Address={name:string;line1:string;line2:string;city:string;state:string;postalCode:string;country:'US'};
type Card={brand:string;last4:string;exp:string;address:Address|null;ready:boolean;pending:boolean};
type Status={card:Card|null;requiredForBids:boolean;sandbox:boolean};
const STATES='AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');
const brandName=(brand:string)=>({visa:'Visa',mastercard:'Mastercard',amex:'American Express',discover:'Discover',jcb:'JCB',diners:'Diners Club',unionpay:'UnionPay'} as Record<string,string>)[brand]||'Card';

async function post(body:Record<string,unknown>){
 const response=await fetch('/api/commerce/saved-card',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(typeof data.error==='string'?data.error:'That didn’t work. Please try again.');return data;
}

/** Loads the saved card, and finishes a card setup when the buyer comes back from Stripe. */
export function useSavedCard(enabled=true){
 const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(''),[confirming,setConfirming]=useState(false);
 const load=useCallback(async()=>{try{const response=await fetch('/api/commerce/saved-card',{cache:'no-store'});if(response.ok){setStatus(await response.json());return}}catch{}setStatus(s=>s||{card:null,requiredForBids:false,sandbox:false})},[]); // on failure the server still enforces the rule at bid time
 useEffect(()=>{if(!enabled)return;let cancelled=false;(async()=>{
  const url=new URL(window.location.href),result=url.searchParams.get('card'),session=url.searchParams.get('card_session');
  if(result){url.searchParams.delete('card');url.searchParams.delete('card_session');window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash)}
  if(result==='saved'&&session&&/^cs_(?:test|live)_[A-Za-z0-9]+$/.test(session)){setConfirming(true);try{await post({action:'confirm_card',sessionId:session})}catch(e){if(!cancelled)setError(e instanceof Error?e.message:'Your card couldn’t be confirmed.')}finally{if(!cancelled)setConfirming(false)}}
  if(!cancelled)await load();
 })();return()=>{cancelled=true}},[enabled,load]);
 return {status,setStatus,error,setError,confirming,reload:load};
}

export function SavedCardPanel({returnTo,heading='Card for auctions',intro,state,compact=false}:{returnTo?:string;heading?:string;intro?:ReactNode;state?:ReturnType<typeof useSavedCard>;compact?:boolean}){
 const own=useSavedCard(!state),{status,setStatus,error,setError,confirming}=state||own;
 const [editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[pay,setPay]=useState<{publishableKey:string;clientSecret:string;done:string}|null>(null);
 const card=status?.card,ready=!!card?.ready,[opened,setOpened]=useState(!compact);
 const back=()=>returnTo||(typeof window==='undefined'?'/':window.location.pathname+window.location.search);
 const address=(form:HTMLFormElement):Address=>{const f=new FormData(form),v=(k:string)=>String(f.get(k)||'').trim();return {name:v('name'),line1:v('line1'),line2:v('line2'),city:v('city'),state:v('state'),postalCode:v('postalCode'),country:'US'}};
 async function saveCard(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError('');
  try{const data=await post({action:'save_card',shippingAddress:address(event.currentTarget),returnTo:back(),inPage:true});
   if(typeof data.clientSecret==='string'&&typeof data.publishableKey==='string'&&typeof data.done==='string'){setPay({publishableKey:data.publishableKey,clientSecret:data.clientSecret,done:data.done});setBusy(false);return}
   if(typeof data.url==='string'&&data.url.startsWith('https://checkout.stripe.com/'))window.location.assign(data.url);else throw new Error('Stripe didn’t open. Nothing was saved.')}
  catch(e){setError(e instanceof Error?e.message:'Nothing was saved.');setBusy(false)}}
 async function saveAddress(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError('');
  try{const data=await post({action:'save_address',shippingAddress:address(event.currentTarget)});setStatus(s=>s?{...s,card:data.card}:s);setEditing(false)}catch(e){setError(e instanceof Error?e.message:'Nothing was saved.')}finally{setBusy(false)}}
 async function remove(){if(!window.confirm('Remove this card? You’ll need to save a card again before your next auction bid.'))return;setBusy(true);setError('');
  try{const data=await post({action:'remove_card'});setStatus(s=>s?{...s,card:data.card}:s)}catch(e){setError(e instanceof Error?e.message:'The card wasn’t removed.')}finally{setBusy(false)}}
 const a=card?.address;
 const fields=<div className="scard-fields">
  <label className="ds-field scard-wide"><span>Full name</span><input name="name" autoComplete="name" defaultValue={a?.name} required maxLength={100}/></label>
  <label className="ds-field scard-wide"><span>Street address</span><input name="line1" autoComplete="address-line1" defaultValue={a?.line1} required maxLength={160}/></label>
  <label className="ds-field scard-wide"><span>Apt, suite (optional)</span><input name="line2" autoComplete="address-line2" defaultValue={a?.line2} maxLength={160}/></label>
  <label className="ds-field"><span>City</span><input name="city" autoComplete="address-level2" defaultValue={a?.city} required maxLength={100}/></label>
  <label className="ds-field"><span>State</span><select name="state" autoComplete="address-level1" defaultValue={a?.state||''} required><option value="" disabled>Choose</option>{STATES.map(s=><option key={s}>{s}</option>)}</select></label>
  <label className="ds-field"><span>ZIP code</span><input name="postalCode" autoComplete="postal-code" inputMode="numeric" defaultValue={a?.postalCode} required pattern="\d{5}(-\d{4})?"/></label>
 </div>;
 return <section className="scard" aria-labelledby="scard-title">
  <h3 id="scard-title" className="scard-title"><CreditCard size={19} aria-hidden/> {heading}</h3>
  {intro&&<div className="scard-intro">{intro}</div>}
  {compact&&!opened&&status&&!ready?<div className="scard-summary"><p className="scard-muted">No payment method saved yet. You only need one to bid in auctions.</p><div className="scard-actions"><button type="button" className="ds-btn ds-btn-secondary" onClick={()=>setOpened(true)}>Add Apple Pay, Google Pay or a card</button><PayMarks/></div></div>
  :pay?<SavedCardElements {...pay} onCancel={()=>setPay(null)}/>
  :!status&&!error?<p className="scard-muted">{confirming?'Confirming your card with Stripe…':'Loading…'}</p>
  :ready&&!editing?<>
   <p className="scard-card"><strong>{brandName(card!.brand)} ending {card!.last4}</strong>{card!.exp&&<span> · expires {card!.exp}</span>}</p>
   {a&&<p className="scard-address"><MapPin size={15} aria-hidden/> {a.name}, {a.line1}{a.line2?', '+a.line2:''}, {a.city}, {a.state} {a.postalCode}</p>}
   <p className="scard-muted">If you win an auction, we charge this card automatically, plus shipping to this address. If it’s declined, you get 48 hours to pay another way.</p>
   <div className="scard-actions"><button type="button" className="ds-btn ds-btn-secondary" onClick={()=>setEditing(true)} disabled={busy}>Change card or address</button><button type="button" className="ds-link" onClick={()=>void remove()} disabled={busy}>Remove card</button></div>
  </>
  :<>
   {ready&&<form className="scard-form" onSubmit={saveAddress}><p className="scard-muted">Update the address only, and keep your {brandName(card!.brand)} ending {card!.last4}:</p>{fields}<div className="scard-actions"><button className="ds-btn ds-btn-secondary" disabled={busy}>Save address</button><button type="button" className="ds-link" onClick={()=>setEditing(false)}>Cancel</button></div></form>}
   <form className="scard-form" onSubmit={saveCard}>
    {ready&&<p className="scard-muted">Or use a new card (we’ll save this address with it):</p>}
    {!ready&&<p className="scard-muted">Step 1: your shipping address. Step 2: Apple Pay, Google Pay or a card, in Stripe’s secure form. Nothing is charged now.</p>}
    {fields}
    <div className="scard-actions"><button className="ds-btn ds-btn-primary" disabled={busy||confirming}><Lock size={16} aria-hidden/> {busy?'Opening…':'Continue to payment'}</button><PayMarks/>{ready&&<button type="button" className="ds-link" onClick={()=>setEditing(false)}>Cancel</button>}</div>
    {status?.sandbox&&<p className="scard-muted">Test mode: use a Stripe test card such as 4242 4242 4242 4242.</p>}
   </form>
  </>}
  {error&&<p role="alert" className="ds-error">{error}</p>}
 </section>;
}

/** In front of a binding bid: blocks the bid form until a card and address are saved (when payments require it). */
export function useBidCardGate(active:boolean){
 const state=useSavedCard(active),required=!!state.status?.requiredForBids,ready=!!state.status?.card?.ready&&!!state.status.card.address;
 const blocked=active&&(!state.status?true:required&&!ready);
 const panel=blocked&&state.status?<SavedCardPanel state={state} heading="Add a payment method to bid" intro={<p>Before your first bid, add Apple Pay, Google Pay or a card, and your shipping address. If you win, we charge it automatically, so you don’t lose the comic to a missed payment.</p>}/>:blocked?<p className="scard-muted">Checking your saved card…</p>:null;
 return {blocked,panel};
}
