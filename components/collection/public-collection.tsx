'use client';
// The Collection tab on a profile. Follows the member's Shop window: Open shop (every comic), Window display
// (glass case, runs, favorites) or Closed. Never shows value, purchase price, notes, certs or private photos.
import {useEffect,useMemo,useState} from 'react';
import {MessageCircle,Plus} from 'lucide-react';
import HScroll from '../h-scroll';
import type {PublicCollection,PublicCopy} from '../../lib/collection-shop';
import type {CollectionRun} from '../../lib/collection-runs';
import './public-collection.css';

type Filter='all'|'keys'|'graded'|'trade'|`era:${string}`|`pub:${string}`;
function Cover({copy}:{copy:PublicCopy}){
 // eslint-disable-next-line @next/next/no-img-element
 return <span className="pc-cover">{copy.cover?<img src={copy.cover} alt="" loading="lazy"/>:<span className="pc-cover-empty" aria-hidden="true">{copy.title.slice(0,1)}</span>}</span>;
}
function CopyCard({copy,onIssue}:{copy:PublicCopy;onIssue:(id:number)=>void}){
 const body=<><Cover copy={copy}/><span className="pc-copy-text">
  <strong>{copy.title} {copy.issue}</strong>
  {copy.key&&<span className="pc-key"><em>{copy.key.tag}</em> {copy.key.note}</span>}
  {copy.creators.length>0&&<small>{copy.creators.join(', ')}</small>}
  {copy.characters.length>0&&<small>With {copy.characters.slice(0,3).join(', ')}</small>}
  <small className="pc-yours">Their copy: {copy.grade}</small>
  {copy.openToTrade&&<span className="pc-trade">Open to trade</span>}
 </span></>;
 return copy.directoryIssueId!==null?<button type="button" className="pc-copy" onClick={()=>onIssue(copy.directoryIssueId!)}>{body}</button>:<div className="pc-copy">{body}</div>;
}
export default function PublicCollectionTab({handle,own,dmOpen,signedIn,onIssue,onMessage,onAddToWishlist,favorites}:{handle:string;own:boolean;dmOpen:boolean;signedIn:boolean;onIssue:(id:number)=>void;onMessage:(context:string)=>void;onAddToWishlist:(run:CollectionRun)=>void;favorites:React.ReactNode}){
 const [data,setData]=useState<PublicCollection|null>(null),[error,setError]=useState(''),[filter,setFilter]=useState<Filter>('all');
 useEffect(()=>{let keep=true;void fetch('/api/collection-shop?handle='+encodeURIComponent(handle),{credentials:'same-origin',cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);return d as PublicCollection}).then(d=>{if(keep)setData(d)}).catch(e=>{if(keep)setError(e instanceof Error&&e.message?e.message:'This collection could not load.')});return()=>{keep=false}},[handle]);
 const pool=data?(data.window==='open'?data.comics:data.glass):[];
 const chips=useMemo(()=>{const eras=[...new Set(pool.map(c=>c.era).filter(Boolean))].sort(),pubs=[...new Set(pool.map(c=>c.publisher).filter(Boolean))].sort();
  return [['all','All'],['keys','Keys'],['graded','Graded'],...(data?.window==='open'?[['trade','Open to trade']]:[]),...eras.map(e=>['era:'+e,e]),...pubs.map(p=>['pub:'+p,p])] as [Filter,string][]},[pool,data?.window]);
 const shown=pool.filter(c=>filter==='all'||(filter==='keys'&&!!c.key)||(filter==='graded'&&c.graded)||(filter==='trade'&&c.openToTrade)||(filter.startsWith('era:')&&c.era===filter.slice(4))||(filter.startsWith('pub:')&&c.publisher===filter.slice(4)));
 if(error)return <p className="nw-empty" role="alert">{error}</p>;
 if(!data)return <p className="nw-empty" role="status">Loading the collection…</p>;
 if(data.window==='closed')return <section className="pp-card pc"><p className="nw-empty">{own?'Your shop window is closed, so visitors don’t see this tab. Change it in My Collection.':'This collector keeps their collection private.'}</p></section>;
 return <section className="pp-card pc" aria-label="Collection">
  <p className="pc-window">{data.window==='open'?'Open shop':'Window display'} · <span className="pc-num">{data.counts.comics.toLocaleString('en-US')}</span> comics · <span className="pc-num">{data.counts.keys}</span> keys · <span className="pc-num">{data.counts.graded}</span> graded</p>
  {pool.length>0&&<HScroll className="pc-chips" role="toolbar" aria-label="Filter comics">{chips.map(([id,label])=><button key={id} type="button" aria-pressed={filter===id} onClick={()=>setFilter(id)}>{label}</button>)}</HScroll>}
  {data.runs.length>0&&<div className="pc-block"><h3>Runs I’m building</h3><ul className="pc-runs">{data.runs.map(run=><li key={run.id} className="pc-run">
   <strong>{run.title}</strong><span className="pc-run-count"><span className="pc-num">{run.owned.length}</span>/<span className="pc-num">{run.total}</span></span>
   <span className="pc-grid" role="img" aria-label={`${run.owned.length} of ${run.total} issues owned`}>{Array.from({length:Math.min(run.total,120)},(_,i)=>{const n=run.from+i;return <i key={n} className={run.owned.includes(n)?'on':''}/>})}</span>
   <small>{run.missing.length?'Missing: '+run.missing.slice(0,8).map(n=>'#'+n).join(', ')+(run.missing.length>8?` +${run.missing.length-8}`:''):'Complete!'}</small>
   {!own&&run.missing.length>0&&<span className="pc-run-actions">
    {signedIn&&<button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" onClick={()=>onAddToWishlist(run)}><Plus size={15} aria-hidden="true"/> Add to wishlist</button>}
    <button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" disabled={!dmOpen} onClick={()=>onMessage('Run: '+run.title)}><MessageCircle size={15} aria-hidden="true"/> I have some</button>
   </span>}
  </li>)}</ul></div>}
  {data.window==='window'&&<div className="pc-block">{favorites}</div>}
  <div className="pc-block"><h3>{data.window==='open'?'In stock':'The glass case'}</h3>
   {shown.length?<ul className="pc-copies">{shown.slice(0,300).map(copy=><li key={copy.id}><CopyCard copy={copy} onIssue={onIssue}/></li>)}</ul>:<p className="nw-empty">{pool.length?'No comics match that filter.':data.window==='open'?'No comics yet.':'Nothing in the glass case yet.'}</p>}
   {shown.length>300&&<p className="pc-note">Showing 300 of {shown.length}.</p>}
  </div>
 </section>;
}
