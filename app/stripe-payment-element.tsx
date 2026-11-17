'use client';
// On-page payment (no redirects): Apple Pay / Google Pay buttons (Express Checkout) above a card-only form.
// - Google Pay is hidden on iPhone/iPad; Apple Pay is set to "always" so it can appear in Chrome, Edge and Firefox too.
// - Link, PayPal and pay-later are off (also excluded on the Checkout Session).
// - The card form uses the order's shipping address as the billing address when we have it (no extra address form).
// - On a computer, "Pay on your phone" shows a one-time QR code (10 minutes) that opens this same order on the phone.
import {useEffect,useMemo,useRef,useState} from 'react';
import qrcode from 'qrcode-generator';
import {loadStripe,type StripeExpressCheckoutElementConfirmEvent} from '@stripe/stripe-js';
import {CheckoutElementsProvider,PaymentElement,ExpressCheckoutElement,BillingAddressElement,useCheckoutElements} from '@stripe/react-stripe-js/checkout';

export type PaymentAddress={name:string;line1:string;line2?:string;city:string;state:string;postalCode:string};
const isAppleMobile=()=>typeof navigator!=='undefined'&&(/iPhone|iPad|iPod/i.test(navigator.userAgent)||navigator.userAgent.includes('Macintosh')&&navigator.maxTouchPoints>1);
const isPhone=()=>typeof navigator!=='undefined'&&(/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)||isAppleMobile());
const ordersUrl=(orderId:string)=>'/?section=Account&accountTab=Orders&checkout=return&order='+encodeURIComponent(orderId);

function PayOnPhone({orderId}:{orderId:string}){
 const [code,setCode]=useState<{url:string;expiresAt:number}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[now,setNow]=useState(0);
 // While the QR is shown, check the order every 3 seconds; once it's paid on the phone, go to Orders.
 useEffect(()=>{if(!code)return;const tick=setInterval(()=>{setNow(Date.now());void fetch('/api/commerce?order='+encodeURIComponent(orderId),{cache:'no-store',credentials:'same-origin'}).then(r=>r.ok?r.json():null).then(body=>{const status=body?.order?.status;if(status&&status!=='awaiting_payment')window.location.assign(ordersUrl(orderId))}).catch(()=>undefined)},3000);return()=>clearInterval(tick)},[code,orderId]);
 async function make(){
  setBusy(true);setError('');
  try{const response=await fetch('/api/commerce',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'payment_handoff',orderId})}),body=await response.json();if(!response.ok)throw Error(body.error||'Couldn’t make a code.');setCode({url:location.origin+'/pay/phone#t='+body.token,expiresAt:Date.parse(body.expiresAt)});setNow(Date.now())}
  catch(caught){setError(caught instanceof Error?caught.message:'Couldn’t make a code.')}finally{setBusy(false)}
 }
 const svg=useMemo(()=>{if(!code)return '';const q=qrcode(0,'M');q.addData(code.url);q.make();return q.createSvgTag({cellSize:4,margin:2,scalable:true})},[code]);
 const expired=!!code&&now>=code.expiresAt;
 return <div className="pay-phone">
  {!code||expired?<button type="button" className="button pay-phone-open" disabled={busy} onClick={()=>void make()}>{busy?'Making a code…':expired?'Code expired. Make a new one':'Pay on your phone'}</button>:
   <div className="pay-phone-code"><div className="pay-phone-qr" role="img" aria-label="QR code to pay on your phone" dangerouslySetInnerHTML={{__html:svg}}/><p><strong>Scan with your phone&rsquo;s camera.</strong> Sign in with the same account, then pay with Apple Pay, Google Pay or a card. This page updates when you&rsquo;re done. The code works once and expires in 10 minutes.</p></div>}
  {error&&<p role="alert" className="network-error">{error}</p>}
 </div>;
}

function PaymentForm({orderId,billing}:{orderId:string;billing?:PaymentAddress|null}){
 const state=useCheckoutElements(),[error,setError]=useState(''),[busy,setBusy]=useState(false),lock=useRef(false),[device]=useState(()=>typeof navigator==='undefined'?null:{apple:isAppleMobile(),phone:isPhone()});
 if(state.type==='loading'||!device)return <p role="status">Loading secure payment methods…</p>;
 if(state.type==='error')return <p role="alert">The secure payment form could not load. Reopen this order from Orders.</p>;
 const billingAddress=billing?{name:billing.name,address:{country:'US',line1:billing.line1,line2:billing.line2||null,city:billing.city,state:billing.state,postal_code:billing.postalCode}}:undefined;
 async function confirm(event?:StripeExpressCheckoutElementConfirmEvent){
  if(lock.current||state.type!=='success')return;lock.current=true;setBusy(true);setError('');
  try{
   // redirect:'if_required' keeps the buyer on ComicHuddle (cards and wallets never need a redirect).
   const result=await state.checkout.confirm(event?{expressCheckoutConfirmEvent:event,redirect:'if_required'}:{redirect:'if_required',...(billingAddress?{billingAddress}:{})});
   if(result.type==='error'){setError(result.error.message||'Payment was not confirmed.');return}
   window.location.assign(ordersUrl(orderId));
  }catch(caught){console.error('Stripe checkout confirm failed',caught);const detail=caught instanceof Error&&caught.message?' ('+caught.message.slice(0,160)+')':'';setError('We couldn’t confirm the payment. Check Orders before trying again'+detail+'.')}finally{lock.current=false;setBusy(false)}
 }
 const express={paymentMethods:{applePay:'always',googlePay:device.apple?'never':'auto',link:'never',paypal:'never',amazonPay:'never',klarna:'never'},buttonType:{applePay:'buy',googlePay:'buy'},buttonHeight:48,layout:{maxColumns:2,maxRows:1,overflow:'never'}} as const;
 return <div className="stripe-elements-form">
  <p className="stripe-payment-total">Amount due: <strong>{state.checkout.total.total.amount}</strong></p>
  <ExpressCheckoutElement options={express as never} onConfirm={event=>void confirm(event)}/>
  <p className="stripe-or" aria-hidden="true"><span>or pay with card</span></p>
  {!billingAddress&&<><h5 className="stripe-section-label">Billing address</h5>{/* The session requires a billing address; without one confirm() throws. */}<BillingAddressElement/></>}
  <PaymentElement options={{layout:'tabs',paymentMethodOrder:['card'],wallets:{applePay:'never',googlePay:'never',link:'never'}} as never}/>
  {error&&<p role="alert" className="network-error">{error}</p>}
  <button className="button red" type="button" disabled={busy} onClick={()=>void confirm()}>{busy?'Confirming payment…':'Pay securely'}</button>
  {!device.phone&&<PayOnPhone orderId={orderId}/>}
  <p className="data-caption">Stripe handles payment details. Orders update after the signed payment webhook is verified.</p>
 </div>;
}
export default function StripePaymentElement({publishableKey,clientSecret,orderId,billing}:{publishableKey:string;clientSecret:string;orderId:string;billing?:PaymentAddress|null}){
 const stripe=useMemo(()=>loadStripe(publishableKey),[publishableKey]),options=useMemo(()=>({clientSecret,elementsOptions:{appearance:{theme:'stripe' as const,variables:{colorPrimary:'#c83e30',borderRadius:'12px'}}}}),[clientSecret]);
 return <CheckoutElementsProvider stripe={stripe} options={options}><PaymentForm orderId={orderId} billing={billing}/></CheckoutElementsProvider>;
}
