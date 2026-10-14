'use client';
import {useMemo,useRef,useState} from 'react';
import {loadStripe,type StripeExpressCheckoutElementConfirmEvent} from '@stripe/stripe-js';
import {CheckoutElementsProvider,PaymentElement,ExpressCheckoutElement,useCheckoutElements} from '@stripe/react-stripe-js/checkout';
function PaymentForm({orderId}:{orderId:string}){
 const state=useCheckoutElements(),[error,setError]=useState(''),[busy,setBusy]=useState(false),lock=useRef(false);
 if(state.type==='loading')return <p role="status">Loading secure payment methods…</p>;
 if(state.type==='error')return <p role="alert">The secure payment form could not load. Reopen this order from Orders.</p>;
 async function confirm(event?:StripeExpressCheckoutElementConfirmEvent){
  if(lock.current||state.type!=='success')return;lock.current=true;setBusy(true);setError('');
  try{const result=await state.checkout.confirm(event?{expressCheckoutConfirmEvent:event}:{});if(result.type==='error'){setError(result.error.message||'Payment was not confirmed.');return}window.location.assign('/?section=Orders&order='+encodeURIComponent(orderId))}catch{setError('Payment status needs a check. Open Orders before trying another payment.')}finally{lock.current=false;setBusy(false)}
 }
 return <div className="stripe-elements-form"><p className="stripe-payment-total">Amount due: <strong>{state.checkout.total.total.amount}</strong></p><ExpressCheckoutElement onConfirm={event=>void confirm(event)}/><PaymentElement options={{layout:'accordion'}}/>{error&&<p role="alert" className="network-error">{error}</p>}<button className="button red" type="button" disabled={busy} onClick={()=>void confirm()}>{busy?'Confirming payment…':'Pay securely'}</button><p className="data-caption">Stripe handles payment details. Orders update after the signed payment webhook is verified.</p></div>;
}
export default function StripePaymentElement({publishableKey,clientSecret,orderId}:{publishableKey:string;clientSecret:string;orderId:string}){
 const stripe=useMemo(()=>loadStripe(publishableKey),[publishableKey]),options=useMemo(()=>({clientSecret,elementsOptions:{appearance:{theme:'stripe' as const,variables:{colorPrimary:'#c83e30',borderRadius:'12px'}}}}),[clientSecret]);
 return <CheckoutElementsProvider stripe={stripe} options={options}><PaymentForm orderId={orderId}/></CheckoutElementsProvider>;
}
