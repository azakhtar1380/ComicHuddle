'use client';
// Profile page details inside the Edit profile form: tags, favorite character (Character Directory),
// favorite comic and grail (Directory) with a reward line. Saved through /api/profile-extras.
import {useEffect,useId,useRef,useState} from 'react';
import {X} from 'lucide-react';
import ComicPicker from '../../app/comic-picker';
import type {Issue} from '../../lib/catalog';
import {MAX_PROFILE_TAGS,PROFILE_TAG_SUGGESTIONS,profileTagPattern,type ProfileExtras} from '../../lib/profile-page-types';
import './profile-details.css';

export type PickedIssue={issueId:number;label:string};
export type DetailsDraft={tags:string[];character:{id:number;name:string}|null;comic:PickedIssue|null;grail:PickedIssue|null;reward:string};
export const draftFromExtras=(x:ProfileExtras|undefined):DetailsDraft=>({tags:x?.tags||[],character:x?.favoriteCharacter?{id:x.favoriteCharacter.id,name:x.favoriteCharacter.name}:null,
 comic:x?.favoriteComic?{issueId:x.favoriteComic.issueId,label:`${x.favoriteComic.title} #${x.favoriteComic.number}`}:null,grail:x?.grail?{issueId:x.grail.issueId,label:`${x.grail.title} #${x.grail.number}`}:null,reward:x?.grail?.reward||''});
export const draftPayload=(d:DetailsDraft)=>({tags:d.tags,favoriteCharacterId:d.character?.id??null,favoriteIssueId:d.comic?.issueId??null,grailIssueId:d.grail?.issueId??null,grailReward:d.reward.trim()});
export async function saveDetails(d:DetailsDraft){
 const r=await fetch('/api/profile-extras',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(draftPayload(d))});
 if(!r.ok)throw Error(((await r.json().catch(()=>({}))) as {error?:string}).error||'Your profile details could not be saved.');
}
const pick=(issue:Issue):PickedIssue=>({issueId:issue.id,label:`${issue.title} #${issue.number.replace(/^#/,'')}`});

function CharacterSearch({value,onChange,disabled}:{value:DetailsDraft['character'];onChange:(v:DetailsDraft['character'])=>void;disabled:boolean}){
 const id=useId(),[q,setQ]=useState(''),[results,setResults]=useState<{characterId:number;name:string;firstAppearance:{title:string;number:string;year:number|null}|null}[]>([]),[error,setError]=useState(''),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 useEffect(()=>{if(timer.current)clearTimeout(timer.current);if(q.trim().length<2)return;const controller=new AbortController();timer.current=setTimeout(()=>{void fetch('/api/characters/search?'+new URLSearchParams({q:q.trim(),limit:'6'}),{signal:controller.signal}).then(async r=>{if(!r.ok)throw Error();return r.json() as Promise<{characters:typeof results}>}).then(d=>{setResults(d.characters);setError('')}).catch(()=>{if(!controller.signal.aborted)setError('Character search isn’t available right now.')})},250);return()=>controller.abort()},[q]);
 return <div className="pd-field">
  <label htmlFor={id}>Favorite character</label>
  {value?<p className="pd-chosen"><span>{value.name}</span><button type="button" className="pd-remove" onClick={()=>onChange(null)} disabled={disabled} aria-label={'Remove '+value.name}><X size={16} aria-hidden="true"/></button></p>
  :<><input id={id} type="search" value={q} onChange={e=>setQ(e.target.value)} placeholder="Search the Character Directory" disabled={disabled} autoComplete="off"/>
   {q.trim().length>=2&&results.length>0&&<ul className="pd-results" aria-label="Characters">{results.map(c=><li key={c.characterId}><button type="button" onClick={()=>{onChange({id:c.characterId,name:c.name});setQ('');setResults([])}}><strong>{c.name}</strong>{c.firstAppearance&&<small>First appearance: {c.firstAppearance.title} #{c.firstAppearance.number}{c.firstAppearance.year?' ('+c.firstAppearance.year+')':''}</small>}</button></li>)}</ul>}
   {error&&<small className="pd-error">{error}</small>}</>}
 </div>;
}

export default function ProfileDetailsFields({value,onChange,disabled}:{value:DetailsDraft;onChange:(v:DetailsDraft)=>void;disabled:boolean}){
 const ids=useId(),[custom,setCustom]=useState('');
 const toggle=(tag:string)=>onChange({...value,tags:value.tags.includes(tag)?value.tags.filter(t=>t!==tag):value.tags.length>=MAX_PROFILE_TAGS?value.tags:[...value.tags,tag]});
 const addCustom=()=>{const tag=custom.trim();if(!profileTagPattern.test(tag)||value.tags.some(t=>t.toLowerCase()===tag.toLowerCase())||value.tags.length>=MAX_PROFILE_TAGS)return;onChange({...value,tags:[...value.tags,tag]});setCustom('')};
 return <fieldset className="pd">
  <legend>Your profile page</legend>
  <div className="pd-field"><span id={ids+'-tags'}>Tags <small>(up to {MAX_PROFILE_TAGS})</small></span>
   <ul className="pd-tags" aria-labelledby={ids+'-tags'}>{[...new Set([...PROFILE_TAG_SUGGESTIONS,...value.tags])].map(tag=><li key={tag}><button type="button" aria-pressed={value.tags.includes(tag)} disabled={disabled||(!value.tags.includes(tag)&&value.tags.length>=MAX_PROFILE_TAGS)} onClick={()=>toggle(tag)}>{tag}</button></li>)}</ul>
   <div className="pd-inline"><input aria-label="Your own tag" value={custom} maxLength={24} onChange={e=>setCustom(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addCustom()}}} placeholder="Your own tag" disabled={disabled||value.tags.length>=MAX_PROFILE_TAGS}/><button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" onClick={addCustom} disabled={disabled||!profileTagPattern.test(custom.trim())||value.tags.length>=MAX_PROFILE_TAGS}>Add tag</button></div>
  </div>
  <CharacterSearch value={value.character} onChange={character=>onChange({...value,character})} disabled={disabled}/>
  <div className="pd-field">{value.comic?<><span>Favorite comic</span><p className="pd-chosen"><span>{value.comic.label}</span><button type="button" className="pd-remove" onClick={()=>onChange({...value,comic:null})} disabled={disabled} aria-label={'Remove '+value.comic.label}><X size={16} aria-hidden="true"/></button></p></>
   :<ComicPicker value={null} onChange={issue=>{if(issue)onChange({...value,comic:pick(issue)})}} disabled={disabled} clearOnChoose label="Favorite comic"/>}</div>
  <div className="pd-field">{value.grail?<><span>Your grail (the WANTED poster)</span><p className="pd-chosen"><span>{value.grail.label}</span><button type="button" className="pd-remove" onClick={()=>onChange({...value,grail:null})} disabled={disabled} aria-label={'Remove '+value.grail.label}><X size={16} aria-hidden="true"/></button></p></>
   :<ComicPicker value={null} onChange={issue=>{if(issue)onChange({...value,grail:pick(issue)})}} disabled={disabled} clearOnChoose label="Your grail (the WANTED poster)"/>}</div>
  <label className="pd-field"><span>Reward line</span><input value={value.reward} maxLength={80} onChange={e=>onChange({...value,reward:e.target.value})} placeholder="Reward: top dollar or a fair trade" disabled={disabled}/></label>
 </fieldset>;
}
