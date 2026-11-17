'use client';
// Owner edits for the profile Overview, each picked from the Directory and saved right away:
// the six favorites (reorder, remove), favorite character, favorite comic, and the WANTED grail + reward.
// This is the only place these are set.
import {useEffect,useId,useRef,useState} from 'react';
import {ArrowDown,ArrowUp,GripVertical,X} from 'lucide-react';
import Sheet from '../sheet';
import ComicMultiPicker from '../../app/comic-multi-picker';
import type {Issue} from '../../lib/catalog';
import './directory-pickers.css';

async function save(body:Record<string,unknown>){
 const r=await fetch('/api/profile-extras',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 if(!r.ok)throw Error(((await r.json().catch(()=>({}))) as {error?:string}).error||'That didn’t save. Try again.');
}
type Done={onClose:()=>void;onSaved:(message:string)=>void};
function Footer({busy,error,onCancel,onSave,disabled=false}:{busy:boolean;error:string;onCancel:()=>void;onSave:()=>void;disabled?:boolean}){
 return <>{error&&<p className="ds-error dp-error" role="alert">{error}</p>}<button type="button" className="ds-btn ds-btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button><button type="button" className="ds-btn ds-btn-primary" onClick={onSave} disabled={busy||disabled}>{busy?'Saving…':'Save'}</button></>;
}

/** One of the six: a Directory issue ("directory:<id>") or a copy you own (its vault id, so its photo shows). */
export type Favorite={key:string;issueId:number|null;label:string};
/** The six favorites: up to 6 picks from the Directory, drag (or arrow buttons) to reorder, × to remove. */
export function FavoritesSheet({initial,onClose,onSaved}:Done&{initial:Favorite[]}){
 const [list,setList]=useState<Favorite[]>(initial.slice(0,6)),[busy,setBusy]=useState(false),[error,setError]=useState(''),drag=useRef<number|null>(null);
 const move=(from:number,to:number)=>setList(l=>{if(to<0||to>=l.length)return l;const n=[...l];const [x]=n.splice(from,1);n.splice(to,0,x);return n});
 function add(issue:Issue|undefined){if(!issue)return;setList(l=>l.some(f=>f.issueId===issue.id)||l.length>=6?l:[...l,{key:'directory:'+issue.id,issueId:issue.id,label:issue.title+' #'+issue.number.replace(/^#/,'')}])}
 async function submit(){setBusy(true);setError('');try{await save({featured:list.map(f=>f.key)});onSaved('Favorites saved.');onClose()}catch(e){setError(e instanceof Error?e.message:'That didn’t save.')}finally{setBusy(false)}}
 return <Sheet title="The six" onClose={onClose} footer={<Footer busy={busy} error={error} onCancel={onClose} onSave={()=>void submit()}/>}>
  <p className="dp-help">Pick up to six comics from the Directory. You don’t need to own them.</p>
  {list.length<6&&<ComicMultiPicker value={[]} onChange={next=>add(next[0])} multiple={false} label="Add a favorite"/>}
  <ol className="dp-order" aria-label="Your six, in order">{list.map((fav,i)=><li key={fav.key} draggable onDragStart={()=>{drag.current=i}} onDragOver={e=>e.preventDefault()} onDrop={()=>{if(drag.current!==null)move(drag.current,i);drag.current=null}}>
   <GripVertical size={18} aria-hidden="true" className="dp-grip"/><span className="dp-rank">{i+1}</span><span className="dp-name">{fav.label}</span>
   <button type="button" aria-label={'Move '+fav.label+' up'} disabled={!i} onClick={()=>move(i,i-1)}><ArrowUp size={16} aria-hidden="true"/></button>
   <button type="button" aria-label={'Move '+fav.label+' down'} disabled={i===list.length-1} onClick={()=>move(i,i+1)}><ArrowDown size={16} aria-hidden="true"/></button>
   <button type="button" aria-label={'Remove '+fav.label} onClick={()=>setList(l=>l.filter(x=>x.key!==fav.key))}><X size={16} aria-hidden="true"/></button>
  </li>)}</ol>
  {!list.length&&<p className="dp-help">No favorites yet.</p>}
 </Sheet>;
}

type CharacterHit={characterId:number;name:string;firstAppearance:{title:string;number:string;year:number|null}|null};
/** Favorite character from the Character Directory. */
export function CharacterSheet({onClose,onSaved,current}:Done&{current:{id:number;name:string}|null}){
 const id=useId(),[q,setQ]=useState(''),[hits,setHits]=useState<CharacterHit[]>([]),[picked,setPicked]=useState<{id:number;name:string}|null>(current),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{const term=q.trim();if(term.length<2)return;const c=new AbortController(),t=setTimeout(()=>{void fetch('/api/characters/search?'+new URLSearchParams({q:term,limit:'8'}),{signal:c.signal}).then(r=>r.ok?r.json():{characters:[]}).then(d=>setHits(d.characters||[])).catch(()=>undefined)},250);return()=>{clearTimeout(t);c.abort()}},[q]);
 async function submit(){setBusy(true);setError('');try{await save({favoriteCharacterId:picked?.id??null});onSaved(picked?'Favorite character saved.':'Favorite character removed.');onClose()}catch(e){setError(e instanceof Error?e.message:'That didn’t save.')}finally{setBusy(false)}}
 return <Sheet title="Favorite character" onClose={onClose} footer={<Footer busy={busy} error={error} onCancel={onClose} onSave={()=>void submit()} disabled={picked?.id===current?.id}/>}>
  {picked&&<p className="dp-chosen"><span>{picked.name}</span><button type="button" aria-label={'Remove '+picked.name} onClick={()=>setPicked(null)}><X size={16} aria-hidden="true"/></button></p>}
  <label className="dp-field" htmlFor={id}>Search the Character Directory</label>
  <input id={id} className="dp-input" type="search" value={q} onChange={e=>setQ(e.target.value)} placeholder="Wolverine, Storm, Spawn…" autoComplete="off"/>
  {q.trim().length>=2&&<ul className="dp-hits" aria-label="Characters">{hits.map(h=><li key={h.characterId}><button type="button" aria-pressed={picked?.id===h.characterId} onClick={()=>setPicked({id:h.characterId,name:h.name})}><strong>{h.name}</strong>{h.firstAppearance&&<small>First appearance: {h.firstAppearance.title} #{h.firstAppearance.number}{h.firstAppearance.year?' ('+h.firstAppearance.year+')':''}</small>}</button></li>)}</ul>}
 </Sheet>;
}

/** Favorite comic, or the WANTED grail with a short reward line. */
export function IssueSheet({kind,current,reward:initialReward='',onClose,onSaved}:Done&{kind:'comic'|'grail';current:Issue|null;reward?:string}){
 const [picked,setPicked]=useState<Issue[]>(current?[current]:[]),[reward,setReward]=useState(initialReward),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function submit(){setBusy(true);setError('');try{
  const issueId=picked[0]?.id??null;
  await save(kind==='comic'?{favoriteIssueId:issueId}:{grailIssueId:issueId,grailReward:issueId===null?'':reward.trim()});
  onSaved(kind==='comic'?(issueId===null?'Favorite comic removed.':'Favorite comic saved.'):(issueId===null?'Wanted poster cleared.':'Wanted poster saved.'));onClose()}
  catch(e){setError(e instanceof Error?e.message:'That didn’t save.')}finally{setBusy(false)}}
 return <Sheet title={kind==='comic'?'Favorite comic':'WANTED'} onClose={onClose} footer={<Footer busy={busy} error={error} onCancel={onClose} onSave={()=>void submit()}/>}>
  <ComicMultiPicker value={picked} onChange={setPicked} multiple={false} label={kind==='comic'?'Find your favorite comic':'Find your grail'}/>
  {kind==='grail'&&<label className="dp-field">Reward <small>(optional, {60-reward.length} left)</small><input className="dp-input" value={reward} maxLength={60} onChange={e=>setReward(e.target.value)} placeholder="Top dollar or a fair trade"/></label>}
 </Sheet>;
}
