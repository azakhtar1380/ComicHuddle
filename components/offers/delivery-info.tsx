'use client';
// Seller's delivery details for a paid order: who and where to ship to, the shipping paid for and the
// ship-by date. The server (/api/commerce?kind=delivery) decides what may be shown: the buyer's
// address only after Stripe confirms payment and only until delivery; SafePurchase orders ship to
// ComicHuddle instead.
import {useEffect,useState} from 'react';
import {Package,ShieldCheck,Truck} from 'lucide-react';
import './offers-ui.css';

type ShipTo={kind:'buyer';buyerName:string;name:string;line1:string;line2:string;city:string;state:string;postalCode:string;country:string}|{kind:'inspection';address:string|null;placeholder:boolean};
type Delivery={orderId:string;role:string;fulfillment:'shipping'|'pickup';paymentConfirmed:boolean;delivered:boolean;safePurchase:boolean;shipBy:string|null;handlingBusinessDays:number|null;method:{fulfillment:string;shippingCents:number;signatureRequired:boolean;insured:boolean};pickupCodeExpiresAt:string|null;shipTo:ShipTo|null;hiddenReason:string|null};
const dollars=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
const longDate=(iso:string)=>new Date(iso).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'});

/** Server-decided delivery view for one order (also carries the pickup-code expiry for both roles). */
export function useDelivery(orderId:string,enabled=true,refreshKey?:string){
 const [data,setData]=useState<Delivery|null>(null),[error,setError]=useState('');
 useEffect(()=>{if(!enabled)return;const controller=new AbortController();
  void fetch('/api/commerce?kind=delivery&order='+encodeURIComponent(orderId),{cache:'no-store',credentials:'same-origin',signal:controller.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(typeof d?.error==='string'?d.error:'Delivery details are unavailable.');if(d?.orderId!==orderId)throw Error('Delivery details could not be verified.');setData(d as Delivery);setError('')}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Delivery details are unavailable.')});
  return()=>controller.abort()},[orderId,enabled,refreshKey]);
 return {data,error};
}
export default function DeliveryInfo({orderId,refreshKey}:{orderId:string;refreshKey?:string}){
 const {data,error}=useDelivery(orderId,true,refreshKey);
 if(error)return <p className="ds-error" role="alert">{error}</p>;
 if(!data||data.role!=='seller'||data.fulfillment!=='shipping'||!data.paymentConfirmed)return null;
 if(data.hiddenReason==='delivered'||data.hiddenReason==='refunded'||data.hiddenReason==='received_at_inspection')return null;
 const to=data.shipTo,method=data.method;
 return <section className="delivery-info" aria-label="Delivery details">
  <h4><Truck size={17} aria-hidden="true"/> Ship this order</h4>
  <dl>
   {data.shipBy&&<div><dt>Ship by</dt><dd><b>{longDate(data.shipBy)}</b>{data.handlingBusinessDays?<small> · add tracking within {data.handlingBusinessDays} business days of payment</small>:null}</dd></div>}
   <div><dt>Shipping paid</dt><dd>{method.shippingCents?dollars(method.shippingCents):'Free shipping'}{method.signatureRequired||method.insured?<small> · {[method.insured?'insured for the full price':'',method.signatureRequired?'signature required':''].filter(Boolean).join(', ')}</small>:null}</dd></div>
   {to?.kind==='buyer'&&<div><dt>Ship to</dt><dd><address>{to.name}<br/>{to.line1}{to.line2&&<><br/>{to.line2}</>}<br/>{to.city}, {to.state} {to.postalCode}<br/>{to.country}</address>{to.buyerName&&to.buyerName!==to.name&&<small>Buyer: {to.buyerName}</small>}</dd></div>}
   {to?.kind==='inspection'&&<div><dt><ShieldCheck size={14} aria-hidden="true"/> Ship to ComicHuddle</dt><dd>{to.placeholder?<p className="delivery-placeholder" role="note"><b>ComicHuddle receiving address — set by the owner.</b> It isn’t set yet, so don’t ship until it appears here.</p>:<address>{to.address}</address>}<small>SafePurchase: we inspect it, then ship it to the buyer. You never need the buyer’s address.</small></dd></div>}
  </dl>
  <p className="data-caption"><Package size={13} aria-hidden="true"/> {to?.kind==='buyer'?'The address is private to this order and disappears once the carrier confirms delivery.':'Add tracking below once it’s on its way.'}</p>
 </section>;
}
