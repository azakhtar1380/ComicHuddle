'use client';
// Saving a card for auctions, right on the page: Apple Pay and Google Pay (Stripe's Express Checkout, shown on
// devices and browsers that support them, once the site's domain is registered with Stripe) and Stripe's card
// form. Stripe draws the official buttons and card fields; card numbers never touch our servers. Nothing is charged.
import {useMemo,useRef,useState} from 'react';
import {loadStripe,type StripeExpressCheckoutElementConfirmEvent} from '@stripe/stripe-js';
import {CheckoutElementsProvider,ExpressCheckoutElement,PaymentElement,useCheckoutElements} from '@stripe/react-stripe-js/checkout';
import {Lock} from 'lucide-react';

function SetupForm({done,onCancel}:{done:string;onCancel:()=>void}){
 const state=useCheckoutElements(),[error,setError]=useState(''),[busy,setBusy]=useState(false),lock=useRef(false);
 if(state.type==='loading')return <p className="scard-muted" role="status">Loading Apple Pay, Google Pay and card…</p>;
 if(state.type==='error')return <p className="ds-error" role="alert">The secure card form couldn’t load. Refresh the page and try again.</p>;
 async function confirm(event?:StripeExpressCheckoutElementConfirmEvent){
  if(lock.current||state.type!=='success')return;lock.current=true;setBusy(true);setError('');
  try{const result=await state.checkout.confirm(event?{expressCheckoutConfirmEvent:event}:{});if(result.type==='error'){setError(result.error.message||'Your card wasn’t saved.');return}window.location.assign(done)}
  catch(caught){setError(caught instanceof Error&&caught.message?caught.message:'Your card wasn’t saved. Try again.')}
  finally{lock.current=false;setBusy(false)}
 }
 return <div className="scard-pay">
  <p className="scard-pay-label">Pay with Apple Pay or Google Pay</p>
  <ExpressCheckoutElement onConfirm={event=>void confirm(event)}/>
  <p className="scard-or"><span>or enter a card</span></p>
  <PaymentElement options={{layout:'tabs'}}/>
  {error&&<p className="ds-error" role="alert">{error}</p>}
  <div className="scard-actions"><button type="button" className="ds-btn ds-btn-primary" disabled={busy} onClick={()=>void confirm()}><Lock size={16} aria-hidden/> {busy?'Saving…':'Save card'}</button><button type="button" className="ds-link" onClick={onCancel} disabled={busy}>Back</button></div>
  <p className="scard-muted">Nothing is charged now. If you win, we charge this card for the comic and shipping.</p>
 </div>;
}

export default function SavedCardElements({publishableKey,clientSecret,done,onCancel}:{publishableKey:string;clientSecret:string;done:string;onCancel:()=>void}){
 const stripe=useMemo(()=>loadStripe(publishableKey),[publishableKey]);
 const options=useMemo(()=>({clientSecret,elementsOptions:{appearance:{theme:'stripe' as const,variables:{colorPrimary:'#c83e30',borderRadius:'12px',fontFamily:'DM Sans, Arial, sans-serif'}}}}),[clientSecret]);
 return <CheckoutElementsProvider stripe={stripe} options={options}><SetupForm done={done} onCancel={onCancel}/></CheckoutElementsProvider>;
}
