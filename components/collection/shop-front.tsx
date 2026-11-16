'use client';
// My Collection as "your comic shop": awning, sign, search, section chips, New arrivals rack, glass case,
// trade bin, runs wall, back-issue bins, the register (hidden value) and the shop window setting.
// Every section opens the existing list views (sort, filter, select, ⋯ menu, grid/list) through callbacks.
import {useId,useState,type CSSProperties,type ReactNode} from 'react';
import {Eye,EyeOff,Lock,Plus,Store,Trash2} from 'lucide-react';
import HScroll from '../h-scroll';
import type {Vault} from '../../lib/vault';
import type {Issue} from '../../lib/catalog';
import type {CollectionRun} from '../../lib/collection-runs';
import type {ShopWindow} from '../../lib/collection-shop';
import './shop-front.css';

type Book=Vault['books'][number];
export type ShopData={keys:Record<string,{note:string;reasons:string[]}>;added:Record<string,{addedAt:string;backfilled:boolean}>;runs:CollectionRun[];window:ShopWindow};
type Props={name:string;since:number;books:Book[];tradeIds:Set<string>;shop:ShopData|null;record:(book:Book)=>Issue|undefined;directoryId:(book:Book)=>number|null;
 art:(book:Book,small?:boolean)=>ReactNode;addMenu:ReactNode;busy:boolean;
 onSearch:(q:string)=>void;onSeeAll:()=>void;onOpenBook:(id:string)=>void;onOpenTrade:()=>void;onOpenBin:(publisher:string)=>void;
 onNewRun:()=>void;onDeleteRun:(id:string)=>void;onAddMissing:(run:CollectionRun)=>void;onWindow:(w:ShopWindow)=>void};
const SECTIONS=[['arrivals','New arrivals'],['glass','Glass case'],['trade','Trade bin'],['runs','Runs wall'],['bins','Back issues']] as const;
const shortDate=(iso:string)=>new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric'});
const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(cents/100);
const missingLabel=(missing:number[])=>{if(!missing.length)return 'Complete!';const shown=missing.slice(0,6).map(n=>'#'+n).join(', ');return 'Missing '+shown+(missing.length>6?` +${missing.length-6} more`:'')};

export default function ShopFront(p:Props){
 const ids=useId(),[q,setQ]=useState(''),[till,setTill]=useState(false);
 const keyOf=(book:Book)=>{const id=p.directoryId(book);return id===null?null:p.shop?.keys[String(id)]||null};
 const graded=(book:Book)=>book.ownership?.format==='GRADED'||/^CGC\b/i.test(book.grade);
 const gradeOf=(book:Book)=>book.ownership?.format==='GRADED'&&book.ownership.grade?book.ownership.grade:/^CGC\s*(\d{1,2}(?:\.\d)?)/i.exec(book.grade)?.[1]||'RAW';
 const order=new Map(p.books.map((book,i)=>[book.id,i]));
 const arrivals=[...p.books].sort((a,b)=>{const ta=p.shop?.added[a.id]?.addedAt||'',tb=p.shop?.added[b.id]?.addedAt||'';return tb.localeCompare(ta)||(order.get(b.id)||0)-(order.get(a.id)||0)}).slice(0,14);
 const glass=p.books.filter(book=>graded(book)||keyOf(book)),slabs=glass.filter(graded).length,keys=p.books.filter(book=>keyOf(book)).length;
 const trade=p.books.filter(book=>p.tradeIds.has(book.id));
 const bins=new Map<string,number>();for(const book of p.books){const pub=p.record(book)?.publisher||'Other';bins.set(pub,(bins.get(pub)||0)+1)}
 const binList=[...bins].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
 // The register only adds up existing Directory estimates (low–high). It never invents a number.
 let low=0,high=0,priced=0;for(const book of p.books){const e=p.record(book)?.estimatedValue;if(e&&e.lowCents!==null&&e.highCents!==null){low+=e.lowCents;high+=e.highCents;priced++}}
 return <div className="sf">
  <div className="sf-awning" aria-hidden="true"/>
  <section className="sf-sign" aria-labelledby={ids+'-name'}>
   <p className="sf-staff"><Lock size={14} aria-hidden="true"/> PRIVATE · STAFF ONLY</p>
   <h1 id={ids+'-name'} className="sf-name">{p.name}’s Comics</h1>
   <p className="sf-est">Est. <span className="sf-num">{p.since}</span> · <span className="sf-num">{p.books.length.toLocaleString('en-US')}</span> in stock</p>
   <div className="sf-stock">{p.addMenu}</div>
  </section>
  <form className="sf-search" role="search" onSubmit={event=>{event.preventDefault();p.onSearch(q)}}>
   <label htmlFor={ids+'-q'} className="sr-only">Search the shop</label>
   <input id={ids+'-q'} type="search" value={q} onChange={event=>setQ(event.target.value)} placeholder="Search the shop: title, character, creator"/>
   <button type="submit" className="ds-btn ds-btn-primary ds-btn-sm">Search</button>
  </form>
  <HScroll as="nav" className="sf-chips" aria-label="Shop sections">{SECTIONS.map(([id,label])=><a key={id} href={'#'+ids+'-'+id} className="sf-chip">{label}</a>)}</HScroll>

  <section id={ids+'-arrivals'} className="sf-section" aria-labelledby={ids+'-arrivals-h'}>
   <div className="sf-head"><h2 id={ids+'-arrivals-h'}>New arrivals</h2>{p.books.length>0&&<button type="button" className="ds-link" onClick={p.onSeeAll}>See all</button>}</div>
   {arrivals.length?<HScroll className="sf-rack" role="list" aria-label="Recently added comics">{arrivals.map(book=>{const added=p.shop?.added[book.id];return <div role="listitem" key={book.id} className="sf-rack-item">
    <button type="button" className="sf-rack-book" onClick={()=>p.onOpenBook(book.id)} aria-label={`${book.title} ${book.issue}${added&&!added.backfilled?', added '+shortDate(added.addedAt):''}`}>
     <span className="sf-new" aria-hidden="true">NEW</span>{p.art(book,true)}<strong>{book.title} {book.issue}</strong>
     <small>{added&&!added.backfilled?'Added '+shortDate(added.addedAt):'In stock'}</small>
    </button></div>})}</HScroll>
   :<p className="sf-empty">No comics in stock yet. Use “Stock comics” to add your first one.</p>}
  </section>

  <section id={ids+'-glass'} className="sf-section sf-glass" aria-labelledby={ids+'-glass-h'}>
   <div className="sf-head"><h2 id={ids+'-glass-h'}>The glass case</h2><p className="sf-count"><span className="sf-num">{slabs}</span> slabs · <span className="sf-num">{keys}</span> keys</p></div>
   {glass.length?<ul className="sf-slabs">{glass.slice(0,60).map(book=>{const k=keyOf(book);return <li key={book.id}><button type="button" className="sf-slab" onClick={()=>p.onOpenBook(book.id)}>
    <span className="sf-slab-label"><b className="sf-num">{graded(book)?gradeOf(book):'RAW'}</b>{k&&<em>{/^1st /.test(k.note)?'1ST':'KEY'}</em>}</span>
    <span className="sf-slab-art">{p.art(book,true)}</span>
    <span className="sf-slab-title">{book.title} {book.issue}</span>{k&&<small>{k.note}</small>}
   </button></li>})}</ul>
   :<p className="sf-empty">Graded copies and key issues go in the case. None yet.</p>}
  </section>

  <section id={ids+'-trade'} className="sf-section" aria-labelledby={ids+'-trade-h'}>
   <div className="sf-head"><h2 id={ids+'-trade-h'}>Trade bin</h2></div>
   <div className="sf-crate">
    <div className="sf-fan" aria-hidden="true">{trade.slice(0,5).map((book,i)=><span key={book.id} style={{'--i':i} as CSSProperties}>{p.art(book,true)}</span>)}</div>
    <p className="sf-crate-sign">Make me an offer</p>
    <button type="button" className="ds-btn ds-btn-primary" onClick={p.onOpenTrade}>Open bin ({trade.length})</button>
   </div>
  </section>

  <section id={ids+'-runs'} className="sf-section" aria-labelledby={ids+'-runs-h'}>
   <div className="sf-head"><h2 id={ids+'-runs-h'}>Runs wall</h2><button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" onClick={p.onNewRun}><Plus size={16} aria-hidden="true"/> New run</button></div>
   {p.shop?.runs.length?<ul className="sf-pegboard">{p.shop.runs.map(run=><li key={run.id} className={'sf-run'+(run.complete?' is-complete':'')}>
    <strong>{run.title}</strong>
    <span className="sf-run-count"><span className="sf-num">{run.owned.length}</span>/<span className="sf-num">{run.total}</span></span>
    <span className="sf-bar" role="progressbar" aria-label={run.title+' progress'} aria-valuemin={0} aria-valuemax={run.total} aria-valuenow={run.owned.length}><i style={{width:Math.round(run.owned.length/Math.max(1,run.total)*100)+'%'}}/></span>
    <small>{missingLabel(run.missing)}</small>
    <span className="sf-run-actions">{!run.complete&&<button type="button" className="ds-link" disabled={p.busy} onClick={()=>p.onAddMissing(run)}>Add missing to wishlist</button>}<button type="button" className="sf-icon" aria-label={'Delete run '+run.title} disabled={p.busy} onClick={()=>p.onDeleteRun(run.id)}><Trash2 size={16} aria-hidden="true"/></button></span>
   </li>)}</ul>:<p className="sf-empty">Track a series you’re completing. Owned and missing issues update from your collection.</p>}
  </section>

  <section id={ids+'-bins'} className="sf-section" aria-labelledby={ids+'-bins-h'}>
   <div className="sf-head"><h2 id={ids+'-bins-h'}>Back issue bins</h2></div>
   {binList.length?<HScroll className="sf-bins" role="list" aria-label="Bins by publisher">{binList.map(([pub,n])=><div role="listitem" key={pub}><button type="button" className="sf-bin" onClick={()=>p.onOpenBin(pub==='Other'?'':pub)}><span className="sf-divider">{pub}</span><span className="sf-num">{n}</span></button></div>)}</HScroll>
   :<p className="sf-empty">Bins fill up as you stock comics.</p>}
  </section>

  <section className="sf-section sf-register" aria-labelledby={ids+'-till-h'}>
   <h2 id={ids+'-till-h'}>The register</h2>
   <button type="button" className="sf-till" aria-expanded={till} onClick={()=>setTill(v=>!v)}>
    {till?<EyeOff size={18} aria-hidden="true"/>:<Eye size={18} aria-hidden="true"/>}
    {till?(priced?<span><b className="sf-num">{money(low)}–{money(high)}</b> estimated for {priced} of {p.books.length} comics</span>:<span>No value estimates yet for your comics.</span>)
     :<span><b className="sf-num">$ • • • •</b> Tap to open the till</span>}
   </button>
   <p className="sf-note"><Lock size={13} aria-hidden="true"/> Only you can see this. It is never shown on your profile.</p>
  </section>

  <fieldset className="sf-section sf-window">
   <legend><Store size={18} aria-hidden="true"/> Shop window</legend>
   <p className="sf-note">What people see on your profile’s Collection tab.</p>
   {([['open','Open shop','Every comic in your collection.'],['window','Window display','Glass case, runs and favorites only.'],['closed','Closed','The Collection tab is hidden.']] as const).map(([value,label,help])=><label key={value} className={'sf-window-option'+(p.shop?.window===value?' is-on':'')}>
    <input type="radio" name={ids+'-window'} value={value} checked={(p.shop?.window||'window')===value} disabled={p.busy||!p.shop} onChange={()=>p.onWindow(value)}/>
    <span><strong>{label}</strong><small>{help}</small></span>
   </label>)}
  </fieldset>
 </div>;
}
