'use client';
// eBay-style order progress: Paid → Label created → Shipped → Out for delivery → Delivered (shipping), or
// Paid → Ready for pickup → Picked up (local pickup). Dates come from the server's forward-only milestones.
// Step names and states are real text (and aria-current), so screen readers don't depend on colour.
import type {ReactNode} from 'react';
import {AlertTriangle,Check} from 'lucide-react';
import {orderTimeline,type TimelineInput} from '../lib/marketplace-order-progress';
import './order-progress-bar.css';

const stamp=(iso:string|null)=>iso?new Date(iso).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'';
const day=(iso:string|null)=>iso?new Date(iso).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}):'';

export default function OrderProgressBar({order,compact=false,readySlot,onReportProblem}:{order:TimelineInput;compact?:boolean;readySlot?:ReactNode;onReportProblem?:()=>void}){
 const model=orderTimeline(order);
 const current=model.steps.find(step=>step.state==='current'),last=model.steps[model.reached];
 const summary=model.reached===model.steps.length-1?last.label+' '+stamp(last.at):(last?last.label:'Waiting for payment')+(current?' · next: '+current.label:'');
 if(compact)return <p className={'opb-compact'+(model.alert?' is-'+model.alert.tone:'')}><span className="sr-only">Order progress: </span>{model.alert?model.alert.title+' · ':''}{summary}</p>;
 return <section className="opb" aria-label="Order progress">
  {model.alert&&<div className={'opb-alert is-'+model.alert.tone} role="alert"><AlertTriangle size={18} aria-hidden="true"/><div><strong>{model.alert.title}</strong><p>{model.alert.message}</p>
   {onReportProblem&&<button type="button" className="ds-link" onClick={onReportProblem}>Report a problem</button>}</div></div>}
  <ol className={'opb-steps opb-'+model.kind}>
   {model.steps.map((step,index)=><li key={step.key} className={'opb-step is-'+step.state} aria-current={step.state==='current'?'step':undefined}>
    <span className="opb-dot" aria-hidden="true">{step.state==='done'?<Check size={14}/>:index+1}</span>
    <span className="opb-text"><strong>{step.label}</strong>
     <small>{step.state==='done'?(step.at?stamp(step.at):'Done'):step.state==='current'?'Up next':'Not yet'}</small>
     <span className="sr-only">{step.state==='done'?' (completed)':step.state==='current'?' (in progress)':' (not started)'}</span></span>

   </li>)}
  </ol>
  {model.kind==='pickup'&&model.reached===1&&readySlot&&<div className="opb-slot" aria-label="Ready for pickup">
   {model.pinExpiresAt&&<p className={'opb-pin-expiry'+(model.pinExpiringSoon?' is-amber':'')}>PIN expires {stamp(model.pinExpiresAt)}{model.pinExpiringSoon?' · less than 24 hours left':''}</p>}
   {readySlot}</div>}
  {model.estDeliveryDate&&<p className="opb-eta">Estimated delivery: <b>{day(model.estDeliveryDate)}</b></p>}
  {model.checkpoints.length>0&&<details className="opb-scans"><summary>Tracking history ({model.checkpoints.length})</summary>
   <ol>{model.checkpoints.map(point=><li key={point.at+point.status+point.message}><time dateTime={point.at}>{stamp(point.at)}</time><span>{point.message||point.status.replaceAll('_',' ')}</span>{point.location&&<small>{point.location}</small>}</li>)}</ol>
  </details>}
 </section>;
}
