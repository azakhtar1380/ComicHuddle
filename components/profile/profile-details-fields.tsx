'use client';
// Profile tags inside the Edit profile form, saved through /api/profile-extras. The six favorites, favorite
// character, favorite comic and the WANTED grail are picked from the Directory on the profile itself.
import {useId,useState} from 'react';
import {MAX_PROFILE_TAGS,PROFILE_TAG_SUGGESTIONS,profileTagPattern,type ProfileExtras} from '../../lib/profile-page-types';
import './profile-details.css';

export type DetailsDraft={tags:string[]};
export const draftFromExtras=(x:ProfileExtras|undefined):DetailsDraft=>({tags:x?.tags||[]});
export const draftPayload=(d:DetailsDraft)=>({tags:d.tags});
export async function saveDetails(d:DetailsDraft){
 const r=await fetch('/api/profile-extras',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(draftPayload(d))});
 if(!r.ok)throw Error(((await r.json().catch(()=>({}))) as {error?:string}).error||'Your profile details could not be saved.');
}

export default function ProfileDetailsFields({value,onChange,disabled}:{value:DetailsDraft;onChange:(v:DetailsDraft)=>void;disabled:boolean}){
 const ids=useId(),[custom,setCustom]=useState('');
 const toggle=(tag:string)=>onChange({...value,tags:value.tags.includes(tag)?value.tags.filter(t=>t!==tag):value.tags.length>=MAX_PROFILE_TAGS?value.tags:[...value.tags,tag]});
 const addCustom=()=>{const tag=custom.trim();if(!profileTagPattern.test(tag)||value.tags.some(t=>t.toLowerCase()===tag.toLowerCase())||value.tags.length>=MAX_PROFILE_TAGS)return;onChange({...value,tags:[...value.tags,tag]});setCustom('')};
 return <fieldset className="pd">
  <legend>Tags</legend>
  <div className="pd-field"><span id={ids+'-tags'}>Tags <small>(up to {MAX_PROFILE_TAGS})</small></span>
   <ul className="pd-tags" aria-labelledby={ids+'-tags'}>{[...new Set([...PROFILE_TAG_SUGGESTIONS,...value.tags])].map(tag=><li key={tag}><button type="button" aria-pressed={value.tags.includes(tag)} disabled={disabled||(!value.tags.includes(tag)&&value.tags.length>=MAX_PROFILE_TAGS)} onClick={()=>toggle(tag)}>{tag}</button></li>)}</ul>
   <div className="pd-inline"><input aria-label="Your own tag" value={custom} maxLength={24} onChange={e=>setCustom(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addCustom()}}} placeholder="Your own tag" disabled={disabled||value.tags.length>=MAX_PROFILE_TAGS}/><button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" onClick={addCustom} disabled={disabled||!profileTagPattern.test(custom.trim())||value.tags.length>=MAX_PROFILE_TAGS}>Add tag</button></div>
  </div>
 </fieldset>;
}
