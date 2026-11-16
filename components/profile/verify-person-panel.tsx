'use client';
// Admin-only: collectors who asked to be verified. After contacting them to confirm they're a real person,
// the admin turns the blue check on (or off) by hand. Every change is logged and the collector is notified.
import {useEffect,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {VerifiedBadge} from '../verified-badge';
import type {AdminPersonRow} from '../../lib/person-verification';

const label:Record<string,string>={unverified:'Not verified',pending:'Waiting for review',verified:'Verified',revoked:'Check removed'};
export default function VerifyPersonPanel(){
 const [status,setStatus]=useState('pending'),[rows,setRows]=useState<AdminPersonRow[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notes,setNotes]=useState<Record<string,string>>({}),[busy,setBusy]=useState(''),[reload,setReload]=useState(0);
 useEffect(()=>{const c=new AbortController();void fetch('/api/verification?'+new URLSearchParams({kind:'admin_list',status}),{credentials:'same-origin',cache:'no-store',signal:c.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);return d.people as AdminPersonRow[]}).then(list=>{setRows(list);setLoading(false);setError('')}).catch(e=>{if(!c.signal.aborted){setError(e instanceof Error?e.message:'Couldn’t load.');setLoading(false)}});return()=>c.abort()},[status,reload]);
 async function decide(row:AdminPersonRow,verified:boolean){
  const note=(notes[row.profileId]||'').trim();if(note.length<3){setError('Add a short note (how you confirmed it).');return}
  setBusy(row.profileId);setError('');
  try{const r=await fetch('/api/verification',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'decide',profileId:row.profileId,verified,note})});const d=await r.json();if(!r.ok)throw Error(d.error);setLoading(true);setReload(n=>n+1)}
  catch(e){setError(e instanceof Error?e.message:'That didn’t save.')}finally{setBusy('')}
 }
 return <div className="vp-panel">
  <p>Contact the collector to confirm they’re a real person, then turn the check on.</p>
  <div className="vp-filters"><label>Show <select value={status} onChange={e=>{setLoading(true);setStatus(e.target.value)}}>{['pending','verified','revoked','unverified','all'].map(s=><option key={s} value={s}>{s==='all'?'Everyone':label[s]}</option>)}</select></label>
   <button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" onClick={()=>{setLoading(true);setReload(n=>n+1)}}><RefreshCw size={15} aria-hidden="true"/> Refresh</button></div>
  {error&&<p className="ds-error" role="alert">{error}</p>}
  {loading?<p role="status">Loading…</p>:!rows.length?<p>No collectors here.</p>:<ul className="vp-list">{rows.map(row=><li key={row.profileId} className="vp-row">
   <div><strong>{row.name}</strong> <a href={'/@'+row.handle}>@{row.handle}</a> {row.status==='verified'&&<VerifiedBadge kind="person" size={15}/>}<br/><small>{label[row.status]}{row.requestedAt?' · asked '+new Date(row.requestedAt).toLocaleDateString('en-US'):''}</small>{row.contactNote&&<p className="vp-contact">“{row.contactNote}”</p>}</div>
   <label className="ds-field"><span>Note (how you confirmed)</span><input value={notes[row.profileId]||''} onChange={e=>setNotes(n=>({...n,[row.profileId]:e.target.value}))} maxLength={500}/></label>
   <div className="ds-actions">{row.status!=='verified'?<button type="button" className="ds-btn ds-btn-primary ds-btn-sm" disabled={busy===row.profileId} onClick={()=>void decide(row,true)}>Turn on the check</button>
    :<button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" disabled={busy===row.profileId} onClick={()=>void decide(row,false)}>Remove the check</button>}</div>
  </li>)}</ul>}
 </div>;
}
