'use client';
// Admin audit log view (/admin/audit): who did what, when. Read-only; /api/admin/audit checks admin.
import {useEffect,useState} from 'react';
import './admin.css';

type Entry={id:string;adminName:string|null;founder:boolean;action:string;targetType:string;targetId:string;detail:Record<string,unknown>;createdAt:string};
type Data={ready:boolean;entries:Entry[];hasMore:boolean};
const stamp=(iso:string)=>new Date(iso).toLocaleString('en-US',{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit'});
function summary(detail:Record<string,unknown>){
 const parts:string[]=[];
 if(detail.ok===false)parts.push('Refused: '+String(detail.error||''));
 if(typeof detail.result==='string')parts.push('Result: '+detail.result);
 if(Array.isArray(detail.reasons)&&detail.reasons.length)parts.push('Findings: '+detail.reasons.join('; '));
 if(typeof detail.trackingNumber==='string')parts.push(`Tracking: ${detail.carrier} ${detail.trackingNumber}`);
 if(detail.internal===true)parts.push('Admins-only note');
 if(typeof detail.note==='string'&&detail.note)parts.push('Note: '+detail.note);
 if(typeof detail.photos==='number'&&detail.photos)parts.push(detail.photos+' photo(s)');
 return parts.join(' · ');
}

export default function AdminAuditLog(){
 const [offset,setOffset]=useState(0),[data,setData]=useState<Data|null>(null),[error,setError]=useState('');
 useEffect(()=>{
  let live=true;
  fetch('/api/admin/audit?offset='+offset,{credentials:'same-origin',cache:'no-store'}).then(async r=>{const body=await r.json().catch(()=>({}));if(!r.ok)throw Error(body.error||'Couldn’t load the audit log.');return body as Data})
   .then(value=>{if(live){setData(value);setError('')}}).catch(problem=>{if(live)setError(problem.message)});
  return()=>{live=false};
 },[offset]);
 if(error)return <p role="alert" className="ds-error">{error}</p>;
 if(!data)return <p role="status">Loading the audit log…</p>;
 if(!data.ready)return <p className="adm-warn" role="note">The audit log needs database migration 040. Until it’s applied, admin actions are refused.</p>;
 return <div className="adm-dash">
  {data.entries.length?<div className="adm-table-wrap"><table className="adm-table">
   <thead><tr><th scope="col">When</th><th scope="col">Admin</th><th scope="col">Action</th><th scope="col">Order</th><th scope="col">Details</th></tr></thead>
   <tbody>{data.entries.map(e=><tr key={e.id} className={e.detail.ok===false?'is-refused':''}>
    <td>{stamp(e.createdAt)}</td><td>{e.adminName||'Admin'}{e.founder?' (Founder)':''}</td><td><code>{e.action}</code></td>
    <td>{e.targetType==='order'?e.targetId.replace(/[^A-Za-z0-9]/g,'').slice(0,8).toUpperCase():e.targetId}</td><td>{summary(e.detail)}</td>
   </tr>)}</tbody></table></div>:<p className="adm-empty">No admin actions yet.</p>}
  {(offset>0||data.hasMore)&&<div className="adm-pages"><button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" disabled={offset===0} onClick={()=>setOffset(v=>Math.max(0,v-50))}>Newer</button><button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" disabled={!data.hasMore} onClick={()=>setOffset(v=>v+50)}>Older</button></div>}
 </div>;
}
