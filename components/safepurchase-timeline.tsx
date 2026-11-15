'use client';
// The SafePurchase step-by-step timeline. Buyer, seller and admins see the same steps:
// Paid → Seller shipped → Received → Checked → Shipped to buyer → Delivered → Done.
// Every step comes from a real event on the order (payment, seller tracking, our check, carrier delivery,
// seller payout); admins add notes, tracking numbers and photos. Internal admin notes reach admins only.
//
// Orders page: <SafePurchaseOrderTimeline orderId={order.id}/> for orders where order.protection?.tier==='safepurchase'.
// Admin dashboard: <SafePurchaseTimelineView timeline={timeline}/> with data it already loaded.
import {useEffect,useState} from 'react';
import {Check,Circle,CircleDot,X,Minus,ImageIcon,Lock} from 'lucide-react';
import {RECEIVING_ADDRESS_PLACEHOLDER,type SafePurchaseTimeline,type TimelineStep} from '../lib/safepurchase-steps';
import './safepurchase-timeline.css';

const when=(iso:string|null)=>iso?new Date(iso).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):null;
const icons={done:Check,current:CircleDot,upcoming:Circle,failed:X,skipped:Minus};
const stateText={done:'Done',current:'In progress',upcoming:'Not yet',failed:'Did not pass',skipped:'Skipped'};

function StepBody({step}:{step:TimelineStep}){
  return <>
    {step.detail&&<p className="sp-tl-detail">{step.detail}</p>}
    {step.tracking&&<p className="sp-tl-tracking">Tracking: {step.tracking.carrier} <strong>{step.tracking.number}</strong></p>}
    {step.updates.length>0&&<ul className="sp-tl-updates">{step.updates.map(update=><li key={update.id} className={update.internal?'is-internal':''}>
      {update.internal&&<span className="sp-tl-internal"><Lock size={12} aria-hidden="true"/> Admins only</span>}
      {update.kind==='return_shipped'&&<b>Returned to the seller. </b>}
      {update.note&&<span>{update.note}</span>}
      {update.trackingNumber&&step.tracking?.number!==update.trackingNumber&&<span className="sp-tl-tracking"> Tracking: {update.carrier} <strong>{update.trackingNumber}</strong></span>}
      {update.photoIds.length>0&&<span className="sp-tl-photos">{update.photoIds.map((photo,index)=><a key={photo} href={`/safepurchase/photo?update=${update.id}&photo=${photo}`} target="_blank" rel="noopener noreferrer" aria-label={`Photo ${index+1} (opens in a new tab)`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- private, permission-checked photo route */}
        <img src={`/safepurchase/photo?update=${update.id}&photo=${photo}&size=thumbnail`} alt="" loading="lazy" width={56} height={56}/>
      </a>)}</span>}
      <small>{when(update.createdAt)}</small>
    </li>)}</ul>}
  </>;
}

export function SafePurchaseTimelineView({timeline,heading=true}:{timeline:SafePurchaseTimeline;heading?:boolean}){
  return <section className="sp-tl" aria-label={'SafePurchase progress for order '+timeline.orderNumber}>
    {heading&&<header className="sp-tl-head"><h3>SafePurchase</h3><span>Order {timeline.orderNumber}</span>{timeline.sandbox&&<span className="sp-tl-test">Test order</span>}</header>}
    {timeline.outcomeNote&&timeline.outcome!=='in_progress'&&<p className={'sp-tl-outcome is-'+timeline.outcome} role="status">{timeline.outcomeNote}</p>}
    {timeline.receiving&&timeline.role!=='buyer'&&<div className="sp-tl-receiving">
      <b>{timeline.role==='seller'?'Ship the comic to ComicHuddle':'Seller ships to'}</b>
      {timeline.receiving.address?<address>{timeline.receiving.address}</address>:<p className="sp-tl-placeholder" role="note">{RECEIVING_ADDRESS_PLACEHOLDER}. Don’t ship yet. We’ll message you once it’s set.</p>}
      {timeline.receiving.address&&timeline.role==='seller'&&<small>Insure it for the full price and add tracking in Orders within 48 hours.</small>}
    </div>}
    <ol className="sp-tl-steps">{timeline.steps.map(step=>{const Icon=icons[step.state];return <li key={step.step} className={'is-'+step.state} aria-current={step.state==='current'?'step':undefined}>
      <span className="sp-tl-dot" aria-hidden="true"><Icon size={14} strokeWidth={3}/></span>
      <div className="sp-tl-body">
        <p className="sp-tl-title"><strong>{step.label}</strong><span className="sp-tl-sr">{' — '+stateText[step.state]}</span>{step.at&&<time dateTime={step.at}>{when(step.at)}</time>}</p>
        <StepBody step={step}/>
      </div>
    </li>})}</ol>
    {!timeline.updatesAvailable&&timeline.role==='admin'&&<p className="sp-tl-note"><ImageIcon size={14} aria-hidden="true"/> Notes and photos need database migration 040.</p>}
  </section>;
}

/** Self-loading timeline for one order the signed-in user bought or sold (or any order, for an admin). */
export default function SafePurchaseOrderTimeline({orderId,heading=true}:{orderId:string;heading?:boolean}){
  const [timeline,setTimeline]=useState<SafePurchaseTimeline|null>(null),[error,setError]=useState('');
  useEffect(()=>{
    let live=true;const abort=new AbortController();
    fetch('/safepurchase/timeline?order='+encodeURIComponent(orderId),{credentials:'same-origin',cache:'no-store',signal:abort.signal})
      .then(async r=>{const body=await r.json().catch(()=>({}));if(!r.ok)throw Error(body.error||'Couldn’t load the SafePurchase steps.');return body.timeline as SafePurchaseTimeline})
      .then(value=>{if(live){setTimeline(value);setError('')}})
      .catch(problem=>{if(live&&!abort.signal.aborted)setError(problem instanceof Error?problem.message:'Couldn’t load the SafePurchase steps.')});
    return()=>{live=false;abort.abort()};
  },[orderId]);
  if(error)return <p className="sp-tl-error" role="alert">{error}</p>;
  if(!timeline)return <p className="sp-tl-loading" role="status">Loading SafePurchase steps…</p>;
  return <SafePurchaseTimelineView timeline={timeline} heading={heading}/>;
}
