'use client';
// Theme screen ("Worlds"): live preview, ten worlds (all free), ink styles, avatar frames and a signature sound
// effect. Definitions live in lib/profile-worlds.ts. Saves to the profile through /api/profile-extras.
import {useId,useState,type CSSProperties} from 'react';
import {Check} from 'lucide-react';
import {FRAMES,INKS,SFX,WORLDS,lookStyle,type ProfileLook} from '../../lib/profile-worlds';
import {ProfilePhoto} from './profile-page';
import './theme-screen.css';

export default function ThemeScreen({name,avatarUrl,initial,onCancel,onSaved,notice}:{name:string;avatarUrl:string|null;initial:ProfileLook;onCancel:()=>void;onSaved:(look:ProfileLook)=>void;notice:(s:string)=>void}){
 const ids=useId(),[look,setLook]=useState<ProfileLook>(initial),[saving,setSaving]=useState(false);
 const set=(patch:Partial<ProfileLook>)=>setLook(previous=>({...previous,...patch}));
 async function save(){
  setSaving(true);
  try{const r=await fetch('/api/profile-extras',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(look)});if(!r.ok)throw Error(((await r.json().catch(()=>({}))) as {error?:string}).error||'Your world didn’t save.');notice('Your world is saved.');onSaved(look)}
  catch(error){notice(error instanceof Error?error.message:'Your world didn’t save.')}finally{setSaving(false)}
 }
 return <div className="ts">
  <p className="ds-eyebrow">Theme</p><h2 className="ts-title">Pick your <span>world.</span></h2>
  <div className={'ts-preview pp pp-world-'+look.world+' pp-ink-'+look.ink} style={lookStyle(look) as CSSProperties} aria-label="Preview of your profile" role="img">
   <span className="ts-sfx" aria-hidden="true">{look.sfx}</span>
   <ProfilePhoto url={avatarUrl} name={name} frame={look.frame}/>
   <span className="ts-banner">{name}</span>
  </div>
  <fieldset className="ts-group"><legend>Worlds <span className="ts-free">All free</span></legend>
   <div className="ts-worlds">{WORLDS.map(w=><label key={w.id} className={'ts-world'+(look.world===w.id?' is-on':'')}>
    <input type="radio" name={ids+'-world'} value={w.id} checked={look.world===w.id} onChange={()=>set({world:w.id})}/>
    <span className="ts-swatch" style={{background:`${w.skyline} bottom/100% 45% no-repeat,${w.pattern},linear-gradient(180deg,${w.sky[0]},${w.sky[1]})`}} aria-hidden="true"/>
    <span className="ts-world-name">{w.name}{look.world===w.id&&<Check size={16} aria-hidden="true"/>}</span><small>{w.blurb}</small>
   </label>)}</div>
  </fieldset>
  <fieldset className="ts-group"><legend>Ink style</legend>
   <div className="ts-list">{INKS.map(i=><label key={i.id} className={'ts-ink'+(look.ink===i.id?' is-on':'')}>
    <input type="radio" name={ids+'-ink'} value={i.id} checked={look.ink===i.id} onChange={()=>set({ink:i.id})}/>
    <span className="ts-ink-chip" aria-hidden="true"><i style={{background:i.a}}/><i style={{background:i.b}}/></span>{i.name}
   </label>)}</div>
  </fieldset>
  <fieldset className="ts-group"><legend>Avatar frame</legend>
   <div className="ts-row">{FRAMES.map(f=><label key={f.id} className={'ts-pill'+(look.frame===f.id?' is-on':'')}><input type="radio" name={ids+'-frame'} value={f.id} checked={look.frame===f.id} onChange={()=>set({frame:f.id})}/>{f.name}</label>)}</div>
  </fieldset>
  <fieldset className="ts-group"><legend>Signature sound effect</legend>
   <div className="ts-row">{SFX.map(s=><label key={s} className={'ts-pill ts-sfx-pill'+(look.sfx===s?' is-on':'')}><input type="radio" name={ids+'-sfx'} value={s} checked={look.sfx===s} onChange={()=>set({sfx:s})}/>{s}</label>)}</div>
  </fieldset>
  <div className="ts-actions"><button type="button" className="ds-btn ds-btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button><button type="button" className="ds-btn ds-btn-primary" onClick={()=>void save()} disabled={saving}>{saving?'Saving…':'Save my world'}</button></div>
 </div>;
}
