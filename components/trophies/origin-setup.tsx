'use client';
// "ORIGIN STORY #1": a comic-cover card that walks a member through the 5 panels of their origin story
// (profile photo, handle, cover photo, favorite character, grail + world). Data: /api/origin-story.
import {useEffect,useState} from 'react';
import {Check,Circle} from 'lucide-react';
import './origin-setup.css';

type Step={id:string;label:string;done:boolean};
type Data={handle:string|null;steps:Step[];snoozed:boolean;earned:boolean};
export default function OriginSetup(){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[note,setNote]=useState('');
 useEffect(()=>{let keep=true;void fetch('/api/origin-story',{credentials:'same-origin',cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);return d as Data}).then(d=>{if(keep)setData(d)}).catch(e=>{if(keep)setError(e instanceof Error&&e.message?e.message:'This page could not load.')});return()=>{keep=false}},[]);
 async function snooze(){try{const r=await fetch('/api/origin-story',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'snooze'})});if(!r.ok)throw Error();setNote('We’ll remind you after your next haul.');setData(d=>d&&{...d,snoozed:true})}catch{setNote('That didn’t save. Try again.')}}
 if(error)return <p className="os-note" role="alert">{error}</p>;
 if(!data)return <p className="os-note" role="status">Loading…</p>;
 const inked=data.steps.filter(s=>s.done).length,left=data.steps.length-inked;
 return <article className="os" aria-labelledby="os-title">
  <header className="os-mast"><p className="os-title" id="os-title">ORIGIN STORY <span>#1</span></p><span className="os-free">Issue #1<br/>FREE</span></header>
  <div className="os-art">
   {/* eslint-disable-next-line @next/next/no-img-element */}
   <img src="/mascot/huddles-14-profile.webp" alt="" aria-hidden="true" width={180} height={200}/>
   <p className="os-bubble">{data.earned||!left?'Your origin story is done. Every hero needs one, and now you have yours!':`Every hero needs an origin story. ${left} more ${left===1?'panel':'panels'} and yours is done!`}</p>
   <span className="os-stamp">1st appearance of @{data.handle||'you'}!</span>
  </div>
  <div className="os-body">
   <p className="os-progress-label"><span className="os-num">{inked}</span> of <span className="os-num">{data.steps.length}</span> inked</p>
   <span className="os-bar" role="progressbar" aria-label="Origin story progress" aria-valuemin={0} aria-valuemax={data.steps.length} aria-valuenow={inked}><i style={{width:inked/data.steps.length*100+'%'}}/></span>
   <ol className="os-steps">{data.steps.map(s=><li key={s.id} className={s.done?'is-done':''}>{s.done?<Check size={18} aria-hidden="true"/>:<Circle size={18} aria-hidden="true"/>}<span>{s.label}</span><span className="sr-only">{s.done?' (done)':' (to do)'}</span></li>)}</ol>
   <p className="os-unlocks">Unlocks the <b>Origin Story</b> trophy</p>
   <div className="os-actions">
    <a className="ds-btn ds-btn-primary" href={data.handle?'/@'+data.handle:'/?section=My%20Profile'}>Finish my origin story</a>
    {!data.earned&&left>0&&<button type="button" className="ds-link" onClick={()=>void snooze()} disabled={data.snoozed}>{data.snoozed?'Snoozed until your next haul':'Remind me after my next haul'}</button>}
   </div>
   {note&&<p className="os-note" role="status">{note}</p>}
  </div>
 </article>;
}
