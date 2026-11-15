'use client';
// Local pickup with a one-time code (paid in the app, money held). Buyer: 6-digit code + QR, its
// expiry, and "report a problem instead". Seller: type or scan the code at the hand-off. Both see the
// safe-meetup reminder. The server verifies the code, its expiry and wrong-guess limits.
import {useCallback,useState} from 'react';
// Expiry is judged when the panel mounts; Orders refreshes after every action.
import dynamic from 'next/dynamic';
import {AlertTriangle,MapPin,ScanLine} from 'lucide-react';
import PickupQr,{parsePickupPayload} from './pickup-qr';
import './offers-ui.css';

const PickupScanner=dynamic(()=>import('./pickup-scanner'),{ssr:false});
const longDate=(iso:string)=>new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric'})+' at '+new Date(iso).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});

export function SafeMeetup(){return <p className="safe-meetup" role="note"><MapPin size={15} aria-hidden="true"/> Meet in a safe public place, in daylight if you can. A police station lobby or a busy store works well. Check the comic before the code is shared.</p>}

export function BuyerPickupCode({orderId,code,expiresAt,safePurchase,onReportProblem}:{orderId:string;code:string;expiresAt:string|null;safePurchase:boolean;onReportProblem?:()=>void}){
 const [now]=useState(()=>Date.now()),expired=!!expiresAt&&Date.parse(expiresAt)<=now;
 return <div className="pickup-code pickup-code-panel">
  <div className="pickup-code-main"><span>Your pickup code</span><strong aria-label={'Pickup code '+code.split('').join(' ')}>{code}</strong>
   <small>{safePurchase?'Show this at the Inspection Center to collect your comic.':'Show the QR or read the code to the seller only once the comic is in your hands. Sharing it releases your payment to the seller.'}</small>
   {expiresAt&&<small className={expired?'pickup-expired':''}>{expired?'This code has expired. Your payment is being refunded.':'Expires '+longDate(expiresAt)+'. If it isn’t used by then, you’re refunded.'}</small>}</div>
  {!expired&&<PickupQr orderId={orderId} code={code}/>}
  {!safePurchase&&<SafeMeetup/>}
  {!safePurchase&&!expired&&onReportProblem&&<button type="button" className="inline-button pickup-problem" onClick={onReportProblem}><AlertTriangle size={14}/> Something wrong? Report a problem instead of sharing the code</button>}
 </div>;
}

export function SellerPickupEntry({orderId,busy,expiresAt,onSubmit}:{orderId:string;busy:boolean;expiresAt:string|null;onSubmit:(code:string)=>void}){
 const [scanning,setScanning]=useState(false),[value,setValue]=useState(''),[error,setError]=useState('');
 const [now]=useState(()=>Date.now()),expired=!!expiresAt&&Date.parse(expiresAt)<=now;
 const scanned=useCallback((code:string)=>{setScanning(false);setValue(code);setError('');onSubmit(code)},[onSubmit]);
 if(expired)return <p className="order-callout">The buyer’s pickup code expired on {longDate(expiresAt!)}. The buyer is refunded, so don’t hand the comic over.</p>;
 return <div className="pickup-seller">
  <SafeMeetup/>
  <form className="pickup-code-form" onSubmit={e=>{e.preventDefault();const parsed=parsePickupPayload(value,orderId);if('error'in parsed){setError('Enter the buyer’s 6-digit code.');return}setError('');onSubmit(parsed.code)}}>
   <label><span className="field-label">Confirm pickup with the buyer’s code<span className="required-mark" aria-hidden="true"> *</span></span>
    <input name="code" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" placeholder="6-digit code" value={value} onChange={e=>setValue(e.target.value.replace(/\D/g,'').slice(0,6))}/></label>
   <button className="button outline" disabled={busy}>Confirm pickup</button>
   <button type="button" className="button outline" disabled={busy} onClick={()=>setScanning(true)}><ScanLine size={15}/> Scan QR</button>
  </form>
  {error&&<p className="ds-error" role="alert">{error}</p>}
  {scanning&&<PickupScanner orderId={orderId} onCode={scanned} onClose={()=>setScanning(false)}/>}
  <small className="data-caption">Only enter it at the hand-off, after the buyer has checked the comic. Five wrong tries locks this for a while.{expiresAt?' The code expires '+longDate(expiresAt)+'.':''} Payment is released to you after the 72-hour review window.</small>
 </div>;
}
