'use client';
// Opens the order from a "Pay on your phone" QR code. The one-time code is in the URL fragment (never sent in a
// request URL or logged); it's kept in sessionStorage across sign-in, then used once.
import {useEffect,useState} from 'react';
import StripePaymentElement from '../../stripe-payment-element';

const KEY='ch-pay-handoff';
type Ready={clientSecret:string;publishableKey:string;order:{id:string}};
export default function PhonePayment(){
 const [state,setState]=useState<{kind:'loading'}|{kind:'signin'}|{kind:'error';message:string}|{kind:'ready';payment:Ready}>({kind:'loading'});
 useEffect(()=>{
  let token='';
  try{const fromHash=new URLSearchParams(location.hash.slice(1)).get('t');if(fromHash){sessionStorage.setItem(KEY,fromHash);history.replaceState(null,'',location.pathname)}token=sessionStorage.getItem(KEY)||''}catch{token=new URLSearchParams(location.hash.slice(1)).get('t')||''}
  if(!token){queueMicrotask(()=>setState({kind:'error',message:'This link is missing its code. Scan the QR code on your computer again.'}));return}
  void fetch('/api/commerce',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'redeem_handoff',token})}).then(async response=>{
   const body=await response.json().catch(()=>({}));
   if(response.status===401){setState({kind:'signin'});return}
   try{sessionStorage.removeItem(KEY)}catch{/* ignore */}
   if(!response.ok||!body.clientSecret||!body.publishableKey){setState({kind:'error',message:body.error||'This order can’t be paid here. Check Orders on your computer.'});return}
   setState({kind:'ready',payment:body as Ready});
  }).catch(()=>setState({kind:'error',message:'Couldn’t reach ComicHuddle. Check your connection and scan again.'}));
 },[]);
 if(state.kind==='loading')return <p role="status">Opening your order…</p>;
 if(state.kind==='signin')return <div className="pay-phone-signin"><p>Sign in with the same account you used on your computer.</p><a className="ds-btn ds-btn-primary" href="/sign-in?return_to=%2Fpay%2Fphone">Sign in</a></div>;
 if(state.kind==='error')return <p role="alert" className="network-error">{state.message}</p>;
 return <StripePaymentElement publishableKey={state.payment.publishableKey} clientSecret={state.payment.clientSecret} orderId={state.payment.order.id}/>;
}
