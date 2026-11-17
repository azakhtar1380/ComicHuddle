'use client';
// Trophy case page, the unlock screen and the medal. Data: /api/trophies. No mascot on the unlock screen.
import {useCallback,useEffect,useId,useState} from 'react';
import Link from 'next/link';
import {Lock} from 'lucide-react';
import {TIER_NAMES,TROPHY_COUNT,type TierKey,type TrophyGroup,type TrophyStatus} from '../../lib/trophy-defs';
import './trophies.css';

const tierColor:Record<TierKey,string>={bronze:'#b06a32',silver:'#9aa4ad',golden:'#e2b33c',single:'#c83e30'};
export function Medal({tier,locked=false,size=56,label}:{tier:TierKey|null;locked?:boolean;size?:number;label?:string}){
 const color=locked||!tier?'#d8d3c8':tierColor[tier];
 return <svg width={size} height={size} viewBox="0 0 64 64" role={label?'img':undefined} aria-label={label} aria-hidden={label?undefined:true} className="tr-medal">
  <path d="M22 2h8l6 20h-8zM42 2h-8l-6 20h8z" fill={locked?'#efece4':'#345a6a'} stroke={locked?'#9a958a':'#20201f'} strokeWidth="2" strokeDasharray={locked?'3 3':undefined}/>
  <circle cx="32" cy="40" r="20" fill={color} stroke={locked?'#9a958a':'#20201f'} strokeWidth="3" strokeDasharray={locked?'4 4':undefined}/>
  {!locked&&<path d="M32 28l3.6 7.4 8.1 1.2-5.9 5.7 1.4 8.1-7.2-3.8-7.2 3.8 1.4-8.1-5.9-5.7 8.1-1.2z" fill="#fff" stroke="#20201f" strokeWidth="1.5" strokeLinejoin="round"/>}
 </svg>;
}
type Prefs={unlocks:boolean;almost:boolean;weekly:boolean};
const GROUPS:[TrophyGroup,string][]=[['collector','Collector'],['marketplace','Marketplace'],['community','Community']];
const best=(t:TrophyStatus)=>(['golden','silver','bronze','single'] as TierKey[]).find(k=>t.earned.some(e=>e.tier===k))||null;

export function TrophyCase(){
 const ids=useId(),[data,setData]=useState<{trophies:TrophyStatus[];prefs:Prefs;fairPlay:string[]}|null>(null),[error,setError]=useState(''),[saving,setSaving]=useState(false);
 useEffect(()=>{let keep=true;void fetch('/api/trophies',{credentials:'same-origin',cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);return d}).then(d=>{if(keep)setData(d)}).catch(e=>{if(keep)setError(e instanceof Error&&e.message?e.message:'Trophies could not load.')});return()=>{keep=false}},[]);
 async function setPref(key:keyof Prefs,value:boolean){if(!data)return;const prefs={...data.prefs,[key]:value};setData({...data,prefs});setSaving(true);
  try{const r=await fetch('/api/trophies',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'prefs',...prefs})});if(!r.ok)throw Error()}catch{setData(d=>d&&{...d,prefs:data.prefs})}finally{setSaving(false)}}
 if(error)return <p className="tr-note" role="alert">{error}</p>;
 if(!data)return <p className="tr-note" role="status">Loading your trophies…</p>;
 const earned=data.trophies.filter(t=>t.earned.length).length;
 return <div className="tr-page">
  <header className="tr-head"><h1><span className="tr-num">{earned}</span> of <span className="tr-num">{TROPHY_COUNT}</span> trophies earned</h1>
   <p className="tr-legend" aria-label="Tiers"><span><Medal tier="bronze" size={22}/> Bronze Age</span>→<span><Medal tier="silver" size={22}/> Silver Age</span>→<span><Medal tier="golden" size={22}/> Golden Age</span></p></header>
  {GROUPS.map(([group,label])=><section key={group} className="tr-group" aria-labelledby={ids+group}><h2 id={ids+group}>{label}</h2>
   <ul className="tr-cards">{data.trophies.filter(t=>t.group===group).map(t=>{const top=best(t),next=t.next;return <li key={t.id} className={'tr-card'+(top?' is-earned':'')}>
    <Medal tier={top} locked={!top} label={top?`${t.name}: ${TIER_NAMES[top]}`:`${t.name}: locked`}/>
    <div className="tr-card-text">
     <h3>{t.name} <span className={'tr-pill'+(top?' is-on':'')}>{top?TIER_NAMES[top]:'Locked'}</span></h3>
     <p>{t.rule}</p>
     {t.thresholds&&<ul className="tr-steps" aria-label="Tiers">{t.thresholds.map((n,i)=>{const tier=(['bronze','silver','golden'] as TierKey[])[i],on=t.earned.some(e=>e.tier===tier);return <li key={tier} className={on?'is-on':''}><span className="tr-num">{n.toLocaleString('en-US')}</span><span className="sr-only"> for {TIER_NAMES[tier]}{on?' (earned)':''}</span></li>})}</ul>}
     {next&&<div className="tr-progress"><span className="tr-bar" role="progressbar" aria-label={`${t.name} progress to ${TIER_NAMES[next.tier]}`} aria-valuemin={0} aria-valuemax={next.target} aria-valuenow={t.count}><i style={{width:Math.round(next.progress*100)+'%'}}/></span><small><span className="tr-num">{t.count.toLocaleString('en-US')}</span> / <span className="tr-num">{next.target.toLocaleString('en-US')}</span> to {TIER_NAMES[next.tier]}</small></div>}
    </div>
   </li>})}</ul>
  </section>)}
  <section className="tr-fair" aria-labelledby={ids+'fair'}><h2 id={ids+'fair'}>Fair play</h2><ul>{data.fairPlay.map(rule=><li key={rule}>{rule}</li>)}</ul></section>
  <fieldset className="tr-prefs"><legend>Trophy notifications</legend>
   {([['unlocks','Unlocks'],['almost','Almost there'],['weekly','Weekly recap']] as const).map(([key,label])=><label key={key} className="ps-switch"><span>{label}</span><input type="checkbox" role="switch" checked={data.prefs[key]} disabled={saving} onChange={e=>void setPref(key,e.currentTarget.checked)}/></label>)}
  </fieldset>
 </div>;
}

type Unlock={trophy:string;name:string;tier:TierKey;tierName:string;reason:string;percent:number|null;next:{name:string;tierName:string;left:number;unit:string}|null};
/** Shown once per unseen unlock, on the next page load. Mount once in the app shell. */
export function TrophyUnlock({signedIn,onBrag}:{signedIn:boolean;onBrag?:(t:{name:string;tier:string})=>void}){
 const ids=useId(),[unlock,setUnlock]=useState<Unlock|null>(null);
 useEffect(()=>{if(!signedIn)return;const c=new AbortController();void fetch('/api/trophies?unseen=1',{credentials:'same-origin',cache:'no-store',signal:c.signal}).then(r=>r.ok?r.json():null).then(d=>{if(d?.unlock)setUnlock(d.unlock)}).catch(()=>undefined);return()=>c.abort()},[signedIn]);
 const close=useCallback(()=>{if(!unlock)return;void fetch('/api/trophies',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'seen',trophy:unlock.trophy,tier:unlock.tier}),keepalive:true});setUnlock(null)},[unlock]);
 useEffect(()=>{if(!unlock)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape')close()};document.addEventListener('keydown',key);document.getElementById(ids+'-title')?.focus();return()=>document.removeEventListener('keydown',key)},[unlock,close,ids]);
 if(!unlock)return null;
 return <div className="tu" role="dialog" aria-modal="true" aria-labelledby={ids+'-title'}>
  <div className="tu-burst" aria-hidden="true"/>
  <div className="tu-body">
   <p className="tu-banner">Trophy unlocked!</p>
   <div className="tu-medal"><span className="tu-red" aria-hidden="true"/><Medal tier={unlock.tier} size={120}/></div>
   <h2 id={ids+'-title'} tabIndex={-1} className="tu-name">{unlock.name}</h2>
   <p className="tu-tier"><span className="tr-pill is-on">{unlock.tierName}</span></p>
   <p className="tu-reason">{unlock.reason}</p>
   {unlock.percent!==null&&<p className="tu-stat"><span className="tr-num">{unlock.percent}%</span> of collectors have this tier.</p>}
   {unlock.next&&<p className="tu-next">Next up: {unlock.next.left.toLocaleString('en-US')} more {unlock.next.unit} for {unlock.next.name}, {unlock.next.tierName}.</p>}
   <div className="tu-actions">
    <button type="button" className="ds-btn ds-btn-primary" onClick={()=>{const t={name:unlock.name,tier:unlock.tierName};close();if(onBrag)onBrag(t);else window.location.assign('/?section=My%20Profile&share=1&trophy='+encodeURIComponent(t.name+'|'+t.tier))}}>Brag about it</button>
    <Link className="ds-btn ds-btn-secondary" href="/trophies" onClick={close}>All trophies</Link>
    <button type="button" className="ds-link tu-close" onClick={close}>Close</button>
   </div>
  </div>
 </div>;
}
/** Profile overview preview: the 4 highest tiers earned plus "X of 15 · See all". */
export function TrophyPreview({handle,own}:{handle:string;own:boolean}){
 const [data,setData]=useState<{top:{trophy:string;name:string;tier:TierKey}[];earned:number;total:number}|null>(null);
 useEffect(()=>{let keep=true;void fetch('/api/trophies?handle='+encodeURIComponent(handle),{credentials:'same-origin',cache:'no-store'}).then(r=>r.ok?r.json():null).then(d=>{if(keep&&d)setData(d)}).catch(()=>undefined);return()=>{keep=false}},[handle]);
 if(!data)return null;
 return <section className="pp-card tr-preview" aria-label="Trophy case">
  <div className="tr-preview-head"><h2 className="pp-eyebrow">Trophy case</h2><p><span className="tr-num">{data.earned}</span> of <span className="tr-num">{data.total}</span>{own&&<> · <Link href="/trophies">See all</Link></>}</p></div>
  {data.top.length?<ul className="tr-preview-list">{data.top.map(t=><li key={t.trophy}><Medal tier={t.tier} size={44}/><span><strong>{t.name}</strong><small>{TIER_NAMES[t.tier]}</small></span></li>)}</ul>
  :<p className="tr-note"><Lock size={14} aria-hidden="true"/> No trophies yet.</p>}
 </section>;
}
