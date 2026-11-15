'use client';
// Searchable list of every directory issue a character appears in (/api/catalog?character=).
import {useEffect,useState} from 'react';
import {ArrowRight,ChevronLeft,ChevronRight,Plus,Search,Star} from 'lucide-react';
import ResolvedComicCover from '../resolved-comic-cover';
import {collectHref} from '../../components/cards/collect-intent';

type Comic={id:number;title:string;number:string;publisher:string;year:number;cover?:string;coverCredit?:string};
type Page={issues:Comic[];total:number;offset:number;limit:number;hasMore:boolean};
const pageSize=12;

export default function CharacterComics({characterId,name,firstIssueId}:{characterId:number;name:string;firstIssueId:number|null}){
 const [query,setQuery]=useState(''),[debounced,setDebounced]=useState(''),[offset,setOffset]=useState(0),[sort,setSort]=useState('oldest');
 const [state,setState]=useState<{key:string;page:Page|null;error:string}>({key:'',page:null,error:''});
 useEffect(()=>{const timer=setTimeout(()=>{setDebounced(query.trim());setOffset(0)},300);return()=>clearTimeout(timer)},[query]);
 const key=[characterId,debounced,offset,sort].join('|');
 useEffect(()=>{
  const abort=new AbortController(),params=new URLSearchParams({character:String(characterId),q:debounced,limit:String(pageSize),offset:String(offset),sort});
  fetch('/api/catalog?'+params,{signal:abort.signal}).then(async response=>{const body=await response.json();if(!response.ok)throw Error(body?.error||'The comic list could not be loaded.');setState({key,page:body as Page,error:''})})
   .catch(problem=>{if(!abort.signal.aborted)setState({key,page:null,error:problem instanceof Error?problem.message:'The comic list could not be loaded.'})});
  return()=>abort.abort();
 },[characterId,debounced,offset,sort,key]);
 const loading=state.key!==key,page=loading?null:state.page;
 return <section className="cp-comics" aria-labelledby="cp-comics-title">
  <div className="cp-comics-head">
   <h2 id="cp-comics-title">Comics featuring {name}</h2>
   <div className="cp-tools">
    <label className="cp-search"><Search size={18} aria-hidden="true"/><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder={'Search '+name+' comics: series, issue, year…'} aria-label={'Search comics featuring '+name} maxLength={120}/></label>
    <label className="cp-sort"><span>Sort</span><select value={sort} onChange={event=>{setSort(event.target.value);setOffset(0)}}><option value="oldest">Oldest first</option><option value="newest">Newest first</option><option value="title">Title A–Z</option><option value="featured">Featured</option></select></label>
   </div>
  </div>
  <p className="cp-count" role="status">{loading?<><span className="is-spinner" aria-hidden="true"/> Loading comics…</>:state.error?state.error:page&&page.total?`Showing ${page.offset+1}–${page.offset+page.issues.length} of ${page.total.toLocaleString('en-US')} comics`:debounced?'No comics match that search.':'No comics are linked to this character yet. Appearances are still being gathered.'}</p>
  {page&&page.issues.length>0&&<div className="cp-grid">{page.issues.map(issue=><div key={issue.id} style={{display:'flex',flexDirection:'column',gap:6,minWidth:0}}><a className={'cp-card'+(issue.id===firstIssueId?' cp-card-first':'')} href={'/?section=Directory&issue='+issue.id} aria-label={'Peek inside '+issue.title+' #'+issue.number.replace(/^#/,'')+': see full details'}>
   <span className="cp-card-cover"><ResolvedComicCover issueId={issue.id} title={issue.title} issue={issue.number} publisher={issue.publisher} year={issue.year} src={issue.cover} credit={issue.coverCredit}/></span>
   {issue.id===firstIssueId&&<span className="cp-badge"><Star size={13} fill="currentColor"/> First appearance</span>}
   <strong>{issue.title} <span>#{issue.number.replace(/^#/,'')}</span></strong><small>{issue.publisher}{issue.year?' · '+issue.year:''}</small>
   <span className="peek-inside cp-peek" style={{alignSelf:'flex-start'}} aria-hidden="true">Peek inside <ArrowRight size={15}/></span>
  </a>
   {/* Directory card with no listing: Add to collection only. Opens the issue's detail card with the collection dialog (sign-in first for guests). */}
   <a className="ds-btn ds-btn-secondary ds-btn-sm" style={{marginTop:'auto',fontSize:13,padding:'4px 10px',lineHeight:1.15,whiteSpace:'normal',textAlign:'center',textDecoration:'none'}} href={collectHref(issue.id)} aria-label={'Add to collection: '+issue.title+' #'+issue.number.replace(/^#/,'')}><Plus size={15} aria-hidden="true"/> Add to collection</a>
  </div>)}</div>}
  {page&&page.total>pageSize&&<div className="cp-pager"><button type="button" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-pageSize))}><ChevronLeft size={18}/> Previous</button><span>Page {Math.floor(offset/pageSize)+1} of {Math.ceil(page.total/pageSize)}</span><button type="button" disabled={!page.hasMore} onClick={()=>setOffset(offset+pageSize)}>Next <ChevronRight size={18}/></button></div>}
 </section>;
}
