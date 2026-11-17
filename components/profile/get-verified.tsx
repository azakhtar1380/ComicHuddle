'use client';
// "Get verified" for individual collectors, on My Profile (under the name) and in the Account panel. Step 1 is the
// verification fee (Stripe Checkout, refunded in full if we decline). Once it's paid the request is in review
// (pending); we contact the collector to confirm they're a real person, and an admin turns the blue check on by hand.
// Business accounts are verified through their business details instead (onBusiness opens them).
import {useEffect,useState} from 'react';
import {BadgeCheck} from 'lucide-react';
import {VerifiedBadge} from '../verified-badge';
import Sheet from '../sheet';
import './get-verified.css';

type Status={status:'unverified'|'pending'|'verified'|'revoked';business:boolean;feeCents?:number};
const money=(c:number)=>'$'+(c/100).toFixed(c%100?2:0);
export default function GetVerified({variant='panel',onBusiness}:{variant?:'panel'|'profile';onBusiness?:()=>void}){
 const [s,setS]=useState<Status|null>(null),[open,setOpen]=useState(false),[contact,setContact]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let keep=true;void fetch('/api/verification',{credentials:'same-origin',cache:'no-store'}).then(r=>r.ok?r.json():null).then(d=>{if(keep&&d)setS(d)}).catch(()=>undefined);return()=>{keep=false}},[]);
 if(!s)return null;
 async function ask(){setBusy(true);setError('');try{const r=await fetch('/api/verification',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'request',contact})});const d=await r.json();if(!r.ok)throw Error(d.error);if(typeof d.checkoutUrl==='string'&&/^https:\/\/checkout\.stripe\.com\//.test(d.checkoutUrl)){window.location.assign(d.checkoutUrl);return}setS(v=>v&&{...v,status:d.status});setOpen(false)}catch(e){setError(e instanceof Error?e.message:'That didn’t send.')}finally{setBusy(false)}}
 const fee=s.feeCents?money(s.feeCents):'';
 const explain=<p className="gv-explain">{fee?<>Verification costs <b>{fee}</b>, paid first. </>:null}We’ll contact you to confirm you’re a real person, then an admin turns on the blue check.{fee?' If we decline, the fee is refunded in full.':''} <a href="/verified">How we verify</a></p>;
 const field=<label className="ds-field"><span>Best way to reach you (optional)</span><input value={contact} maxLength={200} onChange={e=>setContact(e.target.value)} placeholder="The email on your account is fine"/></label>;
 const submitLabel=busy?'Starting…':fee?'Pay '+fee+' and request':'Request verification';

 if(variant==='profile'){
  if(s.business)return onBusiness?<div className="gv-profile"><button type="button" className="gv-cta" onClick={onBusiness}><BadgeCheck size={18} aria-hidden="true"/> Get verified</button><p className="gv-why">Show buyers you’re a real shop.</p></div>:null;
  if(s.status==='verified')return null;
  if(s.status==='pending')return <p className="gv-pill" role="status"><BadgeCheck size={16} aria-hidden="true"/> Verification pending · we’ll contact you</p>;
  return <div className="gv-profile">
   <button type="button" className="gv-cta" onClick={()=>setOpen(true)} aria-haspopup="dialog"><BadgeCheck size={18} aria-hidden="true"/> Get verified{fee?' ('+fee+')':''}</button>
   <p className="gv-why">Show buyers you’re a real collector.</p>
   {open&&<Sheet title="Get verified" onClose={()=>setOpen(false)} footer={<>{error&&<p className="ds-error gv-error" role="alert">{error}</p>}<button type="button" className="ds-btn ds-btn-secondary" onClick={()=>setOpen(false)} disabled={busy}>Cancel</button><button type="button" className="ds-btn ds-btn-primary" onClick={()=>void ask()} disabled={busy}>{submitLabel}</button></>}>
    {explain}{field}
   </Sheet>}
  </div>;
 }

 if(s.business)return null;
 return <div className="gv">
  {s.status==='verified'?<p className="gv-line"><VerifiedBadge kind="person" label/> You’re a verified collector.</p>
  :s.status==='pending'?<p className="gv-line"><BadgeCheck size={18} aria-hidden="true"/> Verification requested. We’ll contact you to confirm you’re a real person.{fee?' If we decline, your fee is refunded in full.':''}</p>
  :open?<form className="gv-form" onSubmit={e=>{e.preventDefault();void ask()}}>
    {explain}{field}
    {error&&<p className="ds-error" role="alert">{error}</p>}
    <div className="ds-actions"><button type="submit" className="ds-btn ds-btn-primary ds-btn-sm" disabled={busy}>{submitLabel}</button><button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" onClick={()=>setOpen(false)}>Cancel</button></div>
   </form>
  :<button type="button" className="ds-btn ds-btn-secondary ds-btn-sm gv-start" onClick={()=>setOpen(true)}><BadgeCheck size={17} aria-hidden="true"/> Get verified</button>}
 </div>;
}
