'use client';
// Account panel: "Get verified" for individual collectors. Asking puts the request in review (pending); we
// contact the collector to confirm they're a real person, and an admin turns the blue check on by hand.
// Business accounts are verified through their business details instead.
import {useEffect,useState} from 'react';
import {BadgeCheck} from 'lucide-react';
import {VerifiedBadge} from '../verified-badge';

type Status={status:'unverified'|'pending'|'verified'|'revoked';business:boolean};
export default function GetVerified(){
 const [s,setS]=useState<Status|null>(null),[open,setOpen]=useState(false),[contact,setContact]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let keep=true;void fetch('/api/verification',{credentials:'same-origin',cache:'no-store'}).then(r=>r.ok?r.json():null).then(d=>{if(keep&&d)setS(d)}).catch(()=>undefined);return()=>{keep=false}},[]);
 if(!s||s.business)return null;
 async function ask(){setBusy(true);setError('');try{const r=await fetch('/api/verification',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'request',contact})});const d=await r.json();if(!r.ok)throw Error(d.error);setS(v=>v&&{...v,status:d.status});setOpen(false)}catch(e){setError(e instanceof Error?e.message:'That didn’t send.')}finally{setBusy(false)}}
 return <div className="gv">
  {s.status==='verified'?<p className="gv-line"><VerifiedBadge kind="person" label/> You’re a verified collector.</p>
  :s.status==='pending'?<p className="gv-line"><BadgeCheck size={18} aria-hidden="true"/> Verification requested. We’ll contact you to confirm you’re a real person.</p>
  :open?<form className="gv-form" onSubmit={e=>{e.preventDefault();void ask()}}>
    <p>We’ll contact you to confirm you’re a real person, then an admin turns on the blue check. <a href="/verified">How we verify</a></p>
    <label className="ds-field"><span>Best way to reach you (optional)</span><input value={contact} maxLength={200} onChange={e=>setContact(e.target.value)} placeholder="The email on your account is fine"/></label>
    {error&&<p className="ds-error" role="alert">{error}</p>}
    <div className="ds-actions"><button type="submit" className="ds-btn ds-btn-primary ds-btn-sm" disabled={busy}>{busy?'Sending…':'Request verification'}</button><button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" onClick={()=>setOpen(false)}>Cancel</button></div>
   </form>
  :<button type="button" className="ds-btn ds-btn-secondary ds-btn-sm gv-start" onClick={()=>setOpen(true)}><BadgeCheck size={17} aria-hidden="true"/> Get verified</button>}
 </div>;
}
