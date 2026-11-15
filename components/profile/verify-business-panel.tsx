'use client';
// Admin-only: grant or remove the verified-business tick by hand. Mount inside /admin (already admin-gated):
//   import VerifyBusinessPanel from '../../components/profile/verify-business-panel';
//   <VerifyBusinessPanel/>
// The API checks requireAdmin() itself, so a non-admin who reaches this sees "Admin access required."
// Every change is recorded (who/when/note) in ch_web.business_verification_events and the business is notified.
import {useEffect,useState} from 'react';
import {ArrowUpRight,RefreshCw,Search} from 'lucide-react';
import {VerifiedBadge} from '../verified-badge';
import type {AdminBusinessRow,VerificationStatus} from '../../lib/business-profile';
import './profile.css';

const statusLabel:Record<VerificationStatus,string>={unverified:'Not verified',pending:'Waiting for review',verified:'Verified',revoked:'Tick removed'};
async function fetchBusinesses(status:string,q:string,signal:AbortSignal){
 const r=await fetch('/api/business?'+new URLSearchParams({kind:'admin_list',status,q}),{credentials:'same-origin',cache:'no-store',signal});
 const d=await r.json().catch(()=>({})) as {businesses?:AdminBusinessRow[];error?:string};
 if(!r.ok)throw Error(d.error||'Couldn’t load businesses.');return d.businesses||[];
}
const when=(iso:string|null)=>iso?new Date(iso).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'}):'';

export default function VerifyBusinessPanel(){
 const [status,setStatus]=useState<'all'|VerificationStatus>('all'),[q,setQ]=useState(''),[query,setQuery]=useState('');
 const [rows,setRows]=useState<AdminBusinessRow[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(''),[notes,setNotes]=useState<Record<string,string>>({}),[done,setDone]=useState('');
 const [reload,setReload]=useState(0);
 const refresh=()=>{setLoading(true);setError('');setReload(n=>n+1)};
 useEffect(()=>{const c=new AbortController();
  fetchBusinesses(status,query,c.signal).then(list=>{if(!c.signal.aborted){setRows(list);setLoading(false)}}).catch(e=>{if(!c.signal.aborted){setError(e instanceof Error?e.message:'Couldn’t load businesses.');setLoading(false)}});
  return()=>c.abort()},[status,query,reload]);
 async function decide(row:AdminBusinessRow,verified:boolean){
  setBusy(row.profileId);setError('');setDone('');
  try{const r=await fetch('/api/business',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'set_verified',profileId:row.profileId,verified,note:(notes[row.profileId]||'').trim()})});const d=await r.json().catch(()=>({})) as {error?:string;changed?:boolean};if(!r.ok)throw Error(d.error||'Couldn’t save that.');setDone(d.changed?(verified?row.shopName+' is now verified. They were notified.':'Removed the tick from '+row.shopName+'. They were notified.'):'Nothing changed. '+row.shopName+' was already '+(verified?'verified.':'not verified.'));setNotes(n=>({...n,[row.profileId]:''}));refresh()}
  catch(e){setError(e instanceof Error?e.message:'Couldn’t save that.')}
  finally{setBusy('')}
 }
 return <section className="pf-admin" aria-labelledby="pf-admin-title">
  <div className="pf-admin-head"><div><p className="ds-eyebrow">Admin</p><h2 id="pf-admin-title">Verified businesses</h2><p className="pf-hint">Check a shop or dealer by hand (website, storefront, public records) before granting the tick. Every change is logged with your account and the time.</p></div>
   <button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" onClick={refresh} disabled={loading}><RefreshCw size={16} aria-hidden="true"/> Refresh</button></div>
  <form className="pf-admin-filters" role="search" onSubmit={e=>{e.preventDefault();if(q.trim()!==query){setLoading(true);setError('')}setQuery(q.trim())}}>
   <label className="ds-field"><span>Status</span><select value={status} onChange={e=>{setLoading(true);setError('');setStatus(e.target.value as 'all'|VerificationStatus)}}><option value="all">All businesses</option>{(Object.keys(statusLabel) as VerificationStatus[]).map(s=><option key={s} value={s}>{statusLabel[s]}</option>)}</select></label>
   <label className="ds-field"><span>Search</span><input type="search" value={q} onChange={e=>setQ(e.target.value)} placeholder="Shop name or handle" maxLength={60}/></label>
   <button type="submit" className="ds-btn ds-btn-secondary ds-btn-sm"><Search size={16} aria-hidden="true"/> Search</button>
  </form>
  {error&&<p className="ds-error" role="alert">{error}</p>}
  {done&&<p className="pf-ok" role="status">{done}</p>}
  {loading?<p className="pf-hint" role="status">Loading businesses…</p>:!rows.length?<p className="pf-hint">No business profiles{status!=='all'?' with this status':''} yet.</p>:
  <ul className="pf-admin-list">{rows.map(row=><li key={row.profileId} className="pf-admin-row ds-card">
   <div className="pf-admin-who">
    <strong>{row.shopName||'Unnamed shop'}{row.verificationStatus==='verified'&&<> <VerifiedBadge/></>}</strong>
    <small>{row.kind==='dealer'?'Dealer':'Comic shop'} · {[row.city,row.state].filter(Boolean).join(', ')||'No location'} · <a className="ds-link" href={'/?collector='+encodeURIComponent(row.handle)} target="_blank" rel="noreferrer">@{row.handle} <ArrowUpRight size={13} aria-hidden="true"/></a>{row.website&&<> · <a className="ds-link" href={row.website} target="_blank" rel="noopener noreferrer nofollow">{row.website.replace(/^https?:\/\//,'').replace(/\/$/,'')}</a></>}</small>
    <small>Status: <b>{statusLabel[row.verificationStatus]}</b>{row.verificationSource?' · source: '+row.verificationSource:''}{row.statusChangedAt?' · changed '+when(row.statusChangedAt):''}{row.verifiedAt?' · verified '+when(row.verifiedAt):''}</small>
   </div>
   <label className="ds-field"><span>Note (optional, saved in the log{row.verificationStatus==='verified'?' and sent to the business if you remove the tick':''})</span><input value={notes[row.profileId]||''} maxLength={300} onChange={e=>setNotes(n=>({...n,[row.profileId]:e.target.value}))} placeholder="How you checked, or why it was removed"/></label>
   <div className="ds-actions">
    {row.verificationStatus==='verified'
     ?<button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" disabled={!!busy} onClick={()=>void decide(row,false)}>{busy===row.profileId?'Saving…':'Remove tick'}</button>
     :<button type="button" className="ds-btn ds-btn-primary ds-btn-sm" disabled={!!busy} onClick={()=>void decide(row,true)}>{busy===row.profileId?'Saving…':'Grant verified tick'}</button>}
   </div>
   {row.events.length>0&&<details className="pf-admin-log"><summary>History ({row.events.length})</summary><ul>{row.events.map((e,i)=><li key={i}>{when(e.createdAt)}: {e.action} → {e.status} ({e.source}){e.actorUserId?' by '+e.actorUserId.slice(0,8)+'…':''}{e.note?' · “'+e.note+'”':''}</li>)}</ul></details>}
  </li>)}</ul>}
 </section>;
}
