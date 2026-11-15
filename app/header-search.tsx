'use client';
// Header search with live suggestions: characters (→ every issue they appear in) and comics
// (→ the issue page). Enter with nothing highlighted runs the full directory search.
import {useEffect,useId,useRef,useState,type FormEvent,type KeyboardEvent} from 'react';
import {Search} from 'lucide-react';
import {Portrait} from './issue-showcase';
import './header-search.css';

type CharacterHit={characterId:number;name:string;portraitUrl:string|null;issueCount:number|null;firstAppearance:{issueId:number;title:string;number:string;year:number|null}|null};
type ComicHit={id:number;title:string;number:string;publisher:string;year:number|null};
type Option={kind:'character';hit:CharacterHit;href:string}|{kind:'comic';hit:ComicHit;href:string};

export const characterHref=(hit:{characterId:number;name:string})=>'/?'+new URLSearchParams({section:'Directory',character:String(hit.characterId),cname:hit.name});
const comicHref=(hit:ComicHit)=>'/?'+new URLSearchParams({section:'Directory',issue:String(hit.id)});

export default function HeaderSearch(){
 const [query,setQuery]=useState(''),[open,setOpen]=useState(false),[active,setActive]=useState(-1);
 const [results,setResults]=useState<{q:string;characters:CharacterHit[];comics:ComicHit[];loading:boolean}>({q:'',characters:[],comics:[],loading:false});
 const listId=useId(),box=useRef<HTMLFormElement>(null);
 const q=query.trim();
 useEffect(()=>{
  if(q.length<2)return;
  const abort=new AbortController(),timer=setTimeout(()=>{
   setResults(previous=>({...previous,q,loading:true}));
   const characters=fetch('/api/characters/search?'+new URLSearchParams({q,limit:'4'}),{signal:abort.signal}).then(r=>r.ok?r.json():{characters:[]}).then(body=>Array.isArray(body?.characters)?body.characters as CharacterHit[]:[]).catch(()=>[] as CharacterHit[]);
   const comics=fetch('/api/catalog?'+new URLSearchParams({q,limit:'5',offset:'0',sort:'featured'}),{signal:abort.signal}).then(r=>r.ok?r.json():{issues:[]}).then(body=>Array.isArray(body?.issues)?(body.issues as ComicHit[]).map(i=>({id:i.id,title:i.title,number:i.number,publisher:i.publisher,year:i.year||null})):[]).catch(()=>[] as ComicHit[]);
   void Promise.all([characters,comics]).then(([c,m])=>{if(!abort.signal.aborted){setResults({q,characters:c,comics:m,loading:false});setActive(-1)}});
  },220);
  return()=>{clearTimeout(timer);abort.abort()};
 },[q]);
 useEffect(()=>{const close=(event:PointerEvent)=>{if(box.current&&!box.current.contains(event.target as Node))setOpen(false)};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[]);
 const fresh=results.q===q&&q.length>=2;
 const options:Option[]=fresh?[...results.characters.map(hit=>({kind:'character' as const,hit,href:characterHref(hit)})),...results.comics.map(hit=>({kind:'comic' as const,hit,href:comicHref(hit)}))]:[];
 const showList=open&&q.length>=2&&(options.length>0||results.loading||fresh);
 const submit=(event:FormEvent)=>{event.preventDefault();const chosen=options[active];window.location.assign(chosen?chosen.href:'/?'+new URLSearchParams(q?{section:'Directory',q}:{section:'Directory'}))};
 const key=(event:KeyboardEvent<HTMLInputElement>)=>{
  if(event.key==='ArrowDown'&&options.length){event.preventDefault();setOpen(true);setActive(i=>(i+1)%options.length)}
  else if(event.key==='ArrowUp'&&options.length){event.preventDefault();setActive(i=>i<=0?options.length-1:i-1)}
  else if(event.key==='Escape'){setOpen(false);setActive(-1)}
 };
 const optionId=(index:number)=>listId+'-o'+index;
 let index=-1;
 const row=(option:Option)=>{index++;const i=index;return <li key={option.kind+(option.kind==='character'?option.hit.characterId:option.hit.id)} id={optionId(i)} role="option" aria-selected={active===i}><a href={option.href} className={active===i?'active':''} onMouseEnter={()=>setActive(i)}>
  {option.kind==='character'?<><Portrait name={option.hit.name} src={option.hit.portraitUrl} size="sm"/><span><strong>{option.hit.name}</strong><small>{option.hit.firstAppearance?'First appearance: '+option.hit.firstAppearance.title+' #'+option.hit.firstAppearance.number+(option.hit.firstAppearance.year?' ('+option.hit.firstAppearance.year+')':''):option.hit.issueCount?option.hit.issueCount.toLocaleString('en-US')+' issues':'Character'}</small></span></>
  :<><span className="hs-book" aria-hidden="true">#{option.hit.number.replace(/^#/,'').slice(0,4)}</span><span><strong>{option.hit.title} #{option.hit.number.replace(/^#/,'')}</strong><small>{option.hit.publisher}{option.hit.year?' · '+option.hit.year:''}</small></span></>}
 </a></li>};
 return <form ref={box} className="ch-search hs-search" role="search" onSubmit={submit}>
  <Search size={18} aria-hidden="true"/>
  <input type="search" value={query} onChange={e=>{setQuery(e.target.value);setOpen(true)}} onFocus={()=>setOpen(true)} onKeyDown={key} placeholder="Search titles, characters, issues…" aria-label="Search comics and characters" enterKeyHint="search" maxLength={120}
   role="combobox" aria-autocomplete="list" aria-expanded={showList} aria-controls={listId} aria-activedescendant={active>=0?optionId(active):undefined}/>
  <button type="submit">Search</button>
  {showList&&<div className="hs-panel">
   <ul id={listId} role="listbox" aria-label="Search suggestions">
    {fresh&&results.characters.length>0&&<li role="presentation" className="hs-group">Characters</li>}
    {options.filter(o=>o.kind==='character').map(row)}
    {fresh&&results.comics.length>0&&<li role="presentation" className="hs-group">Comics</li>}
    {options.filter(o=>o.kind==='comic').map(row)}
   </ul>
   {results.loading&&<p className="hs-status" role="status"><span className="is-spinner" aria-hidden="true"/> Searching…</p>}
   {!results.loading&&fresh&&!options.length&&<p className="hs-status">No quick matches. Press Search to look through the whole directory.</p>}
   <a className="hs-all" href={'/?'+new URLSearchParams({section:'Directory',q})}>See all results for “{q}”</a>
  </div>}
 </form>;
}
