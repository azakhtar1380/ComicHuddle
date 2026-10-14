'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {BookOpen,Check,ChevronLeft,ChevronRight,Search,X} from 'lucide-react';
import type {Issue} from '../lib/catalog';
import {createCatalogSearchSession,nextPickerIndex,type CatalogSearchPage} from '../lib/catalog-picker-client';
import './comic-picker.css';

function Cover({issue,selected=false}:{issue:Issue;selected?:boolean}){
 const [failed,setFailed]=useState(false);
 useEffect(()=>setFailed(false),[issue.cover]);
 return <span className={'picker-cover'+(selected?' selected-cover':'')}>
  {issue.cover&&!failed?<img src={issue.cover} alt={issue.title+' #'+issue.number+' cover'} loading="lazy" onError={()=>setFailed(true)}/>:<span className="picker-cover-missing" role="img" aria-label="Cover unavailable"><BookOpen size={20}/><small>No cover<br/>yet</small></span>}
 </span>;
}

export default function ComicPicker({value,onChange,disabled=false,initialQuery='',onQueryChange,label='Find your comic'}:{value:Issue|null;onChange:(issue:Issue|null)=>void;disabled?:boolean;initialQuery?:string;onQueryChange?:(value:string)=>void;label?:string}){
 const id=useId(),inputRef=useRef<HTMLInputElement>(null),session=useRef(createCatalogSearchSession());
  const [query,setQuery]=useState(value?value.title+' #'+value.number:initialQuery),[open,setOpen]=useState(false),[page,setPage]=useState(0),[active,setActive]=useState(-1),[retry,setRetry]=useState(0);
 const [results,setResults]=useState<CatalogSearchPage|null>(null),[pending,setPending]=useState(false),[error,setError]=useState('');
 const rows=results?.issues||[],listId=id+'-list',show=open&&!disabled;
 useEffect(()=>{
  if(!show)return;
  let current=true;setResults(null);setPending(true);setError('');setActive(-1);
  const timer=setTimeout(()=>{
   void session.current.search(query,page*12).then(data=>{if(!current||!data)return;setResults(data);setActive(data.issues.length?0:-1);setPending(false)}).catch(()=>{if(current){setError('The directory could not be loaded. Please retry.');setPending(false)}});
  },180);
  return()=>{current=false;clearTimeout(timer);session.current.cancel()};
 },[show,query,page,retry]);
 useEffect(()=>{
  if(!show||active<0)return;
  const list=document.getElementById(listId),option=document.getElementById(listId+'-'+active);
  if(!list||!option)return;
  const frame=list.getBoundingClientRect(),row=option.getBoundingClientRect();
  if(row.top<frame.top)list.scrollTop+=row.top-frame.top;
  else if(row.bottom>frame.bottom)list.scrollTop+=row.bottom-frame.bottom;
 },[active,show,listId]);
 function choose(issue:Issue){onChange(issue);setQuery(issue.title+' #'+issue.number);setOpen(false);setResults(null);setPage(0);setError('')}
  function clear(){onChange(null);onQueryChange?.('');setQuery('');setPage(0);setResults(null);setOpen(true);inputRef.current?.focus({preventScroll:true})}
 const summary=pending?'Searching the directory…':(error||results)?(error||results!.total+' matching '+(results!.total===1?'issue':'issues')):'';
 return <div className="comic-picker" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setOpen(false)}}>
   <label htmlFor={id}>{label}</label>
  <div className="picker-input"><Search size={18}/><input ref={inputRef} id={id} role="combobox" aria-autocomplete="list" aria-expanded={show} aria-controls={show?listId:undefined} aria-activedescendant={show&&active>=0&&rows[active]?listId+'-'+active:undefined} aria-describedby={id+'-help'} autoComplete="off" maxLength={160} disabled={disabled} value={query} placeholder="Try Amazing Spider-Man #300…" onFocus={()=>{if(!value)setOpen(true)}} onChange={event=>{onChange(null);onQueryChange?.(event.target.value);setQuery(event.target.value);setPage(0);setResults(null);setOpen(true)}} onKeyDown={event=>{
   if(event.key==='Escape'&&show){event.preventDefault();event.stopPropagation();setOpen(false);return}
   if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();if(!show)setOpen(true);else if(!pending&&!error)setActive(index=>nextPickerIndex(event.key,index,rows.length));return}
   if(event.key==='Enter'){event.preventDefault();if(show&&!pending&&!error&&active>=0&&rows[active])choose(rows[active])}
  }}/>{query&&<button type="button" disabled={disabled} onClick={clear} aria-label="Clear selected comic and search"><X size={18}/></button>}</div>
  <small id={id+'-help'} className="picker-help">Search series, issue, year, publisher or character. Choose the exact issue and edition.</small>
  {show&&<div className="picker-dropdown">
   <div className="picker-results-state" role="status" aria-live="polite">{summary}</div>
   <div id={listId} role="listbox" aria-label="Matching comic issues" aria-busy={pending} className="picker-results">
    {!pending&&!error&&rows.map((issue,index)=><div id={listId+'-'+index} role="option" aria-selected={active===index} key={issue.id} className={'picker-option'+(active===index?' active':'')} onMouseDown={event=>event.preventDefault()} onMouseEnter={()=>setActive(index)} onClick={()=>choose(issue)}>
     <Cover issue={issue}/><span className="picker-option-copy"><strong>{issue.title} <span>#{issue.number}</span></strong><small>{issue.publisher} · {issue.year}</small><span>{issue.kind} · {issue.note}</span></span><Check size={15} className="picker-option-check"/>
    </div>)}
   </div>
   {!pending&&error&&<button type="button" className="picker-retry" onClick={()=>setRetry(value=>value+1)}>Retry directory search</button>}
   {!pending&&!error&&results&&!rows.length&&<p className="picker-empty">No matching issue in the current {results.issueCount}-issue catalog. Try another spelling, or add an unlisted comic below.</p>}
   {!pending&&!error&&results&&(page>0||results.hasMore)&&<div className="picker-pagination"><button type="button" aria-label="Previous comic search results" disabled={!page} onClick={()=>{setPage(index=>Math.max(0,index-1));inputRef.current?.focus({preventScroll:true})}}><ChevronLeft size={16}/></button><span>Page {page+1} · {results.total} results</span><button type="button" aria-label="Next comic search results" disabled={!results.hasMore} onClick={()=>{setPage(index=>index+1);inputRef.current?.focus({preventScroll:true})}}><ChevronRight size={16}/></button></div>}
   <p className="picker-scope">Searches ComicHuddle’s saved directory. Cover images appear where display rights are available.</p>
  </div>}
  {value&&<div className="picker-selected"><Cover issue={value} selected/><div><span className="picker-picked-label"><Check size={13}/> DIRECTORY ISSUE SELECTED</span><strong>{value.title} #{value.number}</strong><small>{value.publisher} · {value.year} · {value.era}</small><p>{value.variant}</p><p>{value.note}</p><a href={value.source} target="_blank" rel="noreferrer">Issue source ↗</a></div>{value.coverCredit&&<small className="picker-cover-credit">{value.coverCredit}</small>}</div>}
 </div>;
}
