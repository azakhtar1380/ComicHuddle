'use client';
// Admin-only: look up a member's trophies and revoke or restore a tier. Every change goes in the audit log.
import {useState} from 'react';
import {Search} from 'lucide-react';
import {TIER_NAMES,trophyById,type TierKey} from '../../lib/trophy-defs';

type Row={trophy:string;tier:TierKey;earnedAt:string;revoked:boolean;byAdmin:boolean};
export default function AdminTrophiesPanel(){
 const [handle,setHandle]=useState(''),[data,setData]=useState<{handle:string;name:string;trophies:Row[]}|null>(null),[error,setError]=useState(''),[note,setNote]=useState(''),[busy,setBusy]=useState('');
 async function load(h=handle){setError('');try{const r=await fetch('/api/admin/trophies?handle='+encodeURIComponent(h.replace(/^@/,'')),{credentials:'same-origin',cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error);setData(d)}catch(e){setData(null);setError(e instanceof Error?e.message:'Couldn’t load.')}}
 async function change(row:Row,revoke:boolean){
  if(!data)return;if(note.trim().length<3){setError('Add a short note explaining why.');return}
  setBusy(row.trophy+row.tier);setError('');
  try{const r=await fetch('/api/admin/trophies',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({handle:data.handle,trophy:row.trophy,tier:row.tier,revoke,note})});const d=await r.json();if(!r.ok)throw Error(d.error);await load(data.handle)}
  catch(e){setError(e instanceof Error?e.message:'That change didn’t save.')}finally{setBusy('')}
 }
 return <div className="vp-panel">
  <p>Revoke a tier earned unfairly, or restore one. Members aren’t notified; the change is logged.</p>
  <form className="vp-filters" onSubmit={e=>{e.preventDefault();void load()}}><label className="ds-field"><span>Member handle</span><input value={handle} onChange={e=>setHandle(e.target.value)} placeholder="@handle"/></label><button type="submit" className="ds-btn ds-btn-secondary ds-btn-sm"><Search size={15} aria-hidden="true"/> Look up</button></form>
  <label className="ds-field"><span>Note for the audit log</span><input value={note} onChange={e=>setNote(e.target.value)} maxLength={500} placeholder="Why this changed"/></label>
  {error&&<p className="ds-error" role="alert">{error}</p>}
  {data&&(data.trophies.length?<ul className="vp-list">{data.trophies.map(row=><li key={row.trophy+row.tier} className="vp-row">
   <div><strong>{trophyById(row.trophy)?.name||row.trophy}</strong> · {TIER_NAMES[row.tier]}<br/><small>Earned {new Date(row.earnedAt).toLocaleDateString('en-US')}{row.revoked?(row.byAdmin?' · revoked by an admin':' · count dropped'):''}</small></div>
   {row.revoked&&row.byAdmin?<button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" disabled={!!busy} onClick={()=>void change(row,false)}>Restore</button>
    :!row.revoked?<button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" disabled={!!busy} onClick={()=>void change(row,true)}>Revoke</button>:null}
  </li>)}</ul>:<p>{data.name} hasn’t earned any trophies yet.</p>)}
 </div>;
}
