'use client';
// "Your drafts" on the marketplace: listings a seller saved but hasn't published (lib/listing-drafts.ts).
import {useEffect,useState} from 'react';
import {FileText,Gavel,Trash2} from 'lucide-react';
import './listing-drafts.css';

export type DraftSummary={id:string;title:string;comics:number;photoId:string|null;saleType:'fixed'|'auction';step:number;updatedAt:string};
const steps=['Comics','Photos','Price & delivery'];
const when=(iso:string)=>new Date(iso).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});

export default function ListingDrafts({refreshKey,onOpen,highlight}:{refreshKey:number;onOpen:(draft:DraftSummary)=>void;highlight?:string|null}){
 const [drafts,setDrafts]=useState<DraftSummary[]|null>(null),[busy,setBusy]=useState<string|null>(null),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();void fetch('/api/listing-draft?list=1',{cache:'no-store',signal:controller.signal}).then(response=>response.ok?response.json():null).then(data=>{if(data&&Array.isArray(data.drafts))setDrafts(data.drafts)}).catch(()=>undefined);return()=>controller.abort()},[refreshKey]);
 async function remove(draft:DraftSummary){
  if(!window.confirm('Delete the draft “'+draft.title+'”? This can’t be undone.'))return;
  setBusy(draft.id);setError('');
  try{const response=await fetch('/api/listing-draft?id='+encodeURIComponent(draft.id),{method:'DELETE'});if(!response.ok)throw Error();setDrafts(list=>list?.filter(item=>item.id!==draft.id)||null);try{for(const key of Object.keys(localStorage))if(key.startsWith('comichuddle-listing-v2:')&&key.endsWith(':'+draft.id))localStorage.removeItem(key)}catch{}}
  catch{setError('That draft wasn’t deleted. Try again.')}finally{setBusy(null)}
 }
 if(!drafts?.length)return null;
 return <section className="ldrafts" aria-labelledby="ldrafts-title">
  <h2 id="ldrafts-title" className="ldrafts-title"><FileText size={19} aria-hidden/> Your drafts <span>{drafts.length}</span></h2>
  <ul className="ldrafts-list">{drafts.map(draft=><li key={draft.id} className={'ldrafts-item'+(highlight===draft.id?' is-new':'')}>
   <span className="ldrafts-thumb">{draft.photoId?/* eslint-disable-next-line @next/next/no-img-element */<img src={'/api/media?id='+encodeURIComponent(draft.photoId)+'&size=thumbnail'} alt="" loading="lazy"/>:<FileText size={22} aria-hidden/>}</span>
   <span className="ldrafts-text"><strong>{draft.title}</strong><small>{draft.saleType==='auction'?<><Gavel size={13} aria-hidden/> Auction · </>:''}{draft.comics?draft.comics+' comic'+(draft.comics===1?'':'s')+' · ':''}Next: {steps[Math.min(draft.step,2)]} · Saved {when(draft.updatedAt)}</small></span>
   <span className="ldrafts-actions"><button type="button" className="ds-btn ds-btn-primary ds-btn-sm" onClick={()=>onOpen(draft)} disabled={busy===draft.id}>Continue</button><button type="button" className="ds-btn ds-btn-ghost ds-btn-sm ldrafts-delete" onClick={()=>void remove(draft)} disabled={busy===draft.id} aria-label={'Delete draft '+draft.title}><Trash2 size={16} aria-hidden/></button></span>
  </li>)}</ul>
  {error&&<p role="alert" className="ds-error">{error}</p>}
 </section>;
}
