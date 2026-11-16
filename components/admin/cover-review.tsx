'use client';
// Admin cover photos (/admin/covers): approve suggestions, keep or remove reported photos, remove any upload.
// /api/admin/covers checks admin on every request and writes each action to the audit log.
import {useEffect,useState} from 'react';
import './admin.css';

type Cover={mediaId:string;issueId:number;title:string;status:string;reportCount:number;uploader:string;createdAt:string;url:string};
type View='review'|'recent';
const statusLabel:Record<string,string>={pending:'Waiting for approval',hidden:'Hidden after reports',approved:'Live',rejected:'Removed'};
const day=(iso:string)=>new Date(iso).toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'});

export default function AdminCoverReview(){
 const [view,setView]=useState<View>('review'),[covers,setCovers]=useState<Cover[]|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(''),[note,setNote]=useState(''),[version,setVersion]=useState(0);
 useEffect(()=>{
  let live=true;
  fetch('/api/admin/covers?view='+view,{credentials:'same-origin',cache:'no-store'}).then(async r=>{const body=await r.json().catch(()=>({}));if(!r.ok)throw Error(body.error||'Couldn’t load cover photos.');return body.covers as Cover[]})
   .then(value=>{if(live){setCovers(value);setError('')}}).catch(problem=>{if(live)setError((problem as Error).message)});
  return()=>{live=false};
 },[view,version]);
 async function act(cover:Cover,action:'approve'|'remove'){
  if(action==='remove'&&!window.confirm('Remove this cover photo for '+cover.title+'?'))return;
  setBusy(cover.mediaId);setNote('');
  try{const r=await fetch('/api/admin/covers',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,mediaId:cover.mediaId})}),body=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(body.error||'That change could not be saved.');
   setNote((action==='approve'?'Approved: ':'Removed: ')+cover.title);setVersion(n=>n+1)}
  catch(problem){setNote((problem as Error).message)}
  finally{setBusy('')}
 }
 return <section className="adm-panel" aria-labelledby="adm-covers-head">
  <div className="adm-panel-head"><h2 id="adm-covers-head">Cover photos</h2>
   <div className="adm-filters" aria-label="Which photos">
    {(['review','recent'] as const).map(v=><button key={v} type="button" aria-pressed={view===v} onClick={()=>{if(v!==view){setCovers(null);setView(v)}}}>{v==='review'?'Needs review':'All recent uploads'}</button>)}
   </div>
  </div>
  <p className="adm-hint">Members add photos where an issue has none, and suggest better ones where it has one. Only admins approve suggestions and remove photos. Marketplace listing photos are never used as directory covers.</p>
  {note&&<p role="status" className="adm-ok">{note}</p>}
  {error?<p role="alert" className="ds-error">{error}</p>:!covers?<p role="status">Loading cover photos…</p>:!covers.length?<p className="adm-empty">{view==='review'?'Nothing needs review right now.':'No cover photos have been uploaded yet.'}</p>:
  <ul className="adm-cover-grid">{covers.map(cover=><li key={cover.mediaId} className="adm-cover">
   <a href={'/?section=Directory&issue='+cover.issueId} target="_blank" rel="noreferrer"><img src={cover.url+'&size=thumbnail'} alt={'Cover photo for '+cover.title} loading="lazy"/></a>
   <div><strong>{cover.title}</strong>
    <small>{statusLabel[cover.status]||cover.status}{cover.reportCount?' · '+cover.reportCount+' report'+(cover.reportCount===1?'':'s'):''}</small>
    <small>By {cover.uploader} · {day(cover.createdAt)}</small></div>
   <div className="adm-actions">
    {cover.status!=='approved'||cover.reportCount?<button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" disabled={!!busy} onClick={()=>void act(cover,'approve')}>{cover.status==='approved'?'Keep':'Approve'}</button>:null}
    {cover.status!=='rejected'&&<button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" disabled={!!busy} onClick={()=>void act(cover,'remove')}>Remove</button>}
   </div>
  </li>)}</ul>}
 </section>;
}
