'use client';
// Character index: search (/api/characters/search) or browse popular / A–Z (/api/characters/browse).
import {useEffect,useState} from 'react';
import {Search,Star} from 'lucide-react';
import {Portrait} from '../issue-showcase';

type Hit={characterId:number;name:string;portraitUrl:string|null;issueCount:number|null;firstAppearance:{issueId:number;title:string;number:string;year:number|null}|null};
const letters=['#',...'abcdefghijklmnopqrstuvwxyz'];
const pageSize=36;

export default function CharacterBrowser(){
 const [query,setQuery]=useState(''),[debounced,setDebounced]=useState(''),[letter,setLetter]=useState<string|null>(null),[sort,setSort]=useState<'popular'|'az'>('popular');
 const [items,setItems]=useState<{key:string;list:Hit[];total:number;error:string;loadingMore:boolean}>({key:'',list:[],total:0,error:'',loadingMore:false});
 const [offset,setOffset]=useState(0);
 useEffect(()=>{const timer=setTimeout(()=>{setDebounced(query.trim());setOffset(0)},250);return()=>clearTimeout(timer)},[query]);
 const searching=debounced.length>=2,key=searching?'q|'+debounced:'b|'+(letter||'')+'|'+sort;
 useEffect(()=>{
  const abort=new AbortController();
  const url=searching?'/api/characters/search?'+new URLSearchParams({q:debounced,limit:'20'}):'/api/characters/browse?'+new URLSearchParams({...(letter?{letter}:{}),sort,offset:String(offset),limit:String(pageSize)});
  fetch(url,{signal:abort.signal}).then(async response=>{const body=await response.json();if(!response.ok)throw Error(body?.error||'Characters could not be loaded.');
   const list=(body.characters||[]) as Hit[];
   setItems(previous=>({key,list:!searching&&offset>0&&previous.key===key?[...previous.list,...list]:list,total:searching?list.length:Number(body.total||0),error:'',loadingMore:false}))})
   .catch(problem=>{if(!abort.signal.aborted)setItems({key,list:[],total:0,error:problem instanceof Error?problem.message:'Characters could not be loaded.',loadingMore:false})});
  return()=>abort.abort();
 },[key,searching,debounced,letter,sort,offset]);
 const fresh=items.key===key,loading=!fresh||items.loadingMore;
 const chooseLetter=(next:string|null)=>{setLetter(next);setOffset(0);setQuery('');setDebounced('')};
 return <section className="cp-browser" aria-label="Browse characters">
  <div className="cp-browser-tools">
   <label className="cp-search cp-search-lg"><Search size={20} aria-hidden="true"/><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search characters: Spider-Man, Joker, Storm…" aria-label="Search characters" maxLength={80}/></label>
   {!searching&&<label className="cp-sort"><span>Sort</span><select value={sort} onChange={event=>{setSort(event.target.value as 'popular'|'az');setOffset(0)}}><option value="popular">Most popular</option><option value="az">A–Z</option></select></label>}
  </div>
  {!searching&&<nav className="cp-letters" aria-label="Browse by first letter"><button type="button" className={letter===null?'active':''} aria-pressed={letter===null} onClick={()=>chooseLetter(null)}>All</button>{letters.map(l=><button type="button" key={l} className={letter===l?'active':''} aria-pressed={letter===l} onClick={()=>chooseLetter(l)}>{l.toUpperCase()}</button>)}</nav>}
  <p className="cp-count" role="status">{!fresh?<><span className="is-spinner" aria-hidden="true"/> Loading characters…</>:items.error?items.error:searching?(items.list.length?`${items.list.length} character${items.list.length===1?'':'s'} match “${debounced}”`:`No characters match “${debounced}”.`):`${items.total.toLocaleString('en-US')} characters${letter?' starting with '+letter.toUpperCase():''}`}</p>
  {fresh&&items.list.length>0&&<div className="cp-people">{items.list.map(hit=><a key={hit.characterId} href={'/characters/'+hit.characterId} className="cp-person">
   <Portrait name={hit.name} src={hit.portraitUrl} size="lg"/>
   <strong>{hit.name}</strong>
   {hit.firstAppearance?<small><Star size={12} fill="currentColor"/> {hit.firstAppearance.title} #{hit.firstAppearance.number}{hit.firstAppearance.year?' ('+hit.firstAppearance.year+')':''}</small>:hit.issueCount?<small>{hit.issueCount.toLocaleString('en-US')} comics</small>:<small className="cp-faint">Details on the way</small>}
  </a>)}</div>}
  {fresh&&!searching&&items.list.length<items.total&&<div className="cp-pager"><button type="button" disabled={loading} onClick={()=>{setItems(previous=>({...previous,loadingMore:true}));setOffset(items.list.length)}}>{loading?'Loading…':'Show more characters'}</button></div>}
  <p className="cp-source">Character data: Metron (metron.cloud) · Wikidata (CC0). New characters and portraits are added daily.</p>
 </section>;
}
