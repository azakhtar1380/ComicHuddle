'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowRight,BookOpen,Camera,ChevronRight,Gift,Lock,ScanLine,Search,ShieldCheck,ShoppingBag,Sparkles,Truck,Wallet,Wrench,X} from 'lucide-react';
import ResolvedComicCover from '../../../app/resolved-comic-cover';
import {DirectoryCard} from './DirectoryCard';
import type {ComicCardRecord,HomeFeed} from './types';
export type HomepageProps={feed:HomeFeed;loading?:boolean;search:(query:string,signal:AbortSignal)=>Promise<ComicCardRecord[]>;onOpenComic:(id:string)=>void;onScan:()=>void;onBrowseKeys:()=>void;onMarketplace:()=>void;onProfile:()=>void;onWorkshop:()=>void;onRegisterSpecialist:()=>void;safepurchaseEnabled?:boolean;rewardsEnabled?:boolean};

const heroCovers=['/covers/planet-12.jpg','/covers/planet-55.jpg','/covers/planet-27.jpg'];

export default function Homepage(p:HomepageProps){
 const [query,setQuery]=useState(''),[results,setResults]=useState<ComicCardRecord[]>([]),[searching,setSearching]=useState(false),[error,setError]=useState(''),[focused,setFocused]=useState(false),[active,setActive]=useState(-1);
 const id=useRef(0);
 useEffect(()=>{const q=query.trim();if(q.length<2){setResults([]);setError('');setSearching(false);return;}
  const version=++id.current,controller=new AbortController();setSearching(true);setError('');
  const timer=setTimeout(()=>{void p.search(q,controller.signal).then(records=>{if(id.current===version){setResults(records.slice(0,6));setActive(-1)}}).catch(()=>{if(!controller.signal.aborted&&id.current===version)setError('Search is temporarily unavailable. Please try again.')}).finally(()=>{if(id.current===version)setSearching(false)})},220);
  return()=>{clearTimeout(timer);controller.abort();id.current++};
 },[query,p.search]);
 const items=p.feed.items;
 function open(id:string){setFocused(false);setQuery('');p.onOpenComic(id)}
 const categories=[
  {title:'Shop the Marketplace',body:'Buy raw and graded books from collectors.',Icon:ShoppingBag,action:p.onMarketplace,tone:'red'},
  {title:'Scan a Comic',body:'Point your camera at the barcode to identify it.',Icon:ScanLine,action:p.onScan,tone:'yellow'},
  {title:'Comic Directory',body:`${p.feed.indexedCount>1000?Math.round(p.feed.indexedCount/1000).toLocaleString()+'K+':'Thousands of'} issues across every era.`,Icon:BookOpen,action:p.onBrowseKeys,tone:'blue'},
  {title:'Comic Workshop',body:'Pressing, cleaning & pre-grading pros.',Icon:Wrench,action:p.onWorkshop,tone:'ink'},
 ];
 return <div className="platform-v2 ch-home min-w-0">

  <section className="ch-hero" aria-labelledby="ch-hero-title">
   <div className="ch-hero-copy">
    <span className="ch-kicker"><Sparkles size={14}/> The collector&apos;s marketplace</span>
    <h1 id="ch-hero-title" className="v2-hero-title">Know the book.<br/><span>Own the story.</span></h1>
    <p className="ch-hero-lede">Buy, sell, scan and care for comics — from Golden Age grails to this week&apos;s new releases.</p>
    <div className="ch-hero-search">
     <div className="ch-hero-input"><Search size={20} aria-hidden="true"/><input role="combobox" aria-label="Search by comic, character or key term" aria-expanded={focused&&query.trim().length>=2} aria-controls="v2-search-results" aria-autocomplete="list" aria-activedescendant={active>=0?'v2-result-'+active:undefined} onFocus={()=>setFocused(true)} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Try “Amazing Spider-Man 300”" onKeyDown={e=>{if(e.key==='Escape'){setFocused(false);setActive(-1)}if(e.key==='ArrowDown'){e.preventDefault();setActive(v=>Math.min(v+1,results.length-1))}if(e.key==='ArrowUp'){e.preventDefault();setActive(v=>Math.max(v-1,0))}if(e.key==='Enter'){e.preventDefault();if(results[active])open(results[active].id);else if(query.trim())window.location.assign('/?'+new URLSearchParams({section:'Directory',q:query.trim()}))}}}/>{query&&<button type="button" onClick={()=>setQuery('')} aria-label="Clear search"><X size={17}/></button>}</div>
     {focused&&query.trim().length>=2&&<div id="v2-search-results" role="listbox" className="ch-search-results">{searching?<p role="status">Searching the directory…</p>:error?<p role="alert">{error}</p>:results.length?results.map((c,i)=><button key={c.id} id={'v2-result-'+i} role="option" aria-selected={active===i} onClick={()=>open(c.id)} className={active===i?'is-active':''}><span className="ch-result-cover"><ResolvedComicCover issueId={Number(c.id)} src={c.coverUrl} title={c.title} issue={c.issueNumber} publisher={c.publisher}/></span><span className="ch-result-copy"><strong>{c.title} #{c.issueNumber}</strong><small>{c.publisher}{c.variant?' · '+c.variant:''}</small></span><ChevronRight size={16}/></button>):<p>No matching issue yet. Try a shorter title.</p>}</div>}
    </div>
    <div className="ch-hero-ctas"><button type="button" className="ch-btn ch-btn-primary" onClick={p.onMarketplace}><ShoppingBag size={18}/> Shop now</button><button type="button" className="ch-btn ch-btn-ghost" onClick={p.onScan}><Camera size={18}/> Scan a comic</button></div>
   </div>
   <div className="ch-hero-art" aria-hidden="true">
    <div className="ch-burst"/>
    {heroCovers.map((url,i)=><img key={url} className={'ch-hero-book ch-hero-book-'+i} src={url} alt="" loading="eager" decoding="async"/>)}
    <span className="ch-pow">POW!</span>
   </div>
  </section>

  <ul className="ch-trust" aria-label="Why collectors choose ComicHuddle">
   <li><Lock size={20}/><div><strong>Secure checkout</strong><span>Payments processed by Stripe</span></div></li>
   <li><ShieldCheck size={20}/><div><strong>Order support</strong><span>Real people help resolve order issues</span></div></li>
   <li><Truck size={20}/><div><strong>Tracked shipping</strong><span>Sellers add tracking to every order</span></div></li>
   <li><Gift size={20}/><div><strong>Collector rewards</strong><span>Earn credit on purchases</span></div></li>
  </ul>

  <section className="ch-section" aria-labelledby="ch-cats-title">
   <div className="ch-section-head"><h2 id="ch-cats-title">Everything for your <span>longbox</span></h2></div>
   <div className="ch-categories">{categories.map(c=><button type="button" key={c.title} className={'ch-cat ch-cat-'+c.tone} onClick={c.action}><span className="ch-cat-icon"><c.Icon size={26}/></span><strong>{c.title}</strong><small>{c.body}</small><span className="ch-cat-go">Explore <ArrowRight size={15}/></span></button>)}</div>
  </section>

  <section className="ch-section" aria-labelledby="directory-glimpse-title">
   <div className="ch-section-head"><div><h2 id="directory-glimpse-title">Featured <span>issues</span></h2><p>Hand-picked books from across publishers and eras.</p></div><a href="/?section=Directory" className="ch-link">See the full directory <ArrowRight size={16}/></a></div>
   {p.loading?<div className="ch-card-grid" aria-busy="true">{Array.from({length:6},(_,i)=><div key={i} className="ch-skeleton"/>)}</div>:items.length?<div className="ch-card-grid">{items.slice(0,12).map(c=><DirectoryCard key={c.id} comic={c} onOpen={p.onOpenComic}/>)}</div>:<p>The directory preview could not load. <a href="/?section=Directory">Open the full directory</a>.</p>}
  </section>

  <section className="ch-duo">
   <article className="ch-panel ch-panel-ink"><span className="ch-kicker ch-kicker-light"><ShieldCheck size={15}/> SafePurchase</span><h2>Your grail.<br/><span>Protected.</span></h2><p>For high-value books, request independent inspection between seller and buyer before money changes hands.</p><div className="ch-flow"><span>Seller</span><ArrowRight size={14}/><span>Inspection</span><ArrowRight size={14}/><span>Buyer</span></div><a href="/safepurchase" className="ch-btn ch-btn-yellow">How SafePurchase works <ArrowRight size={16}/></a></article>
   <article className="ch-panel ch-panel-yellow"><span className="ch-kicker"><Gift size={15}/> Collector rewards</span><h2>Build your shelf.<br/><span>Earn more.</span></h2><p>Every eligible purchase earns points. 100 points = $1 in ComicHuddle store credit toward your next book.</p><div className="ch-mini-steps"><div><BookOpen size={20}/><strong>Collect</strong></div><div><Gift size={20}/><strong>Earn points</strong></div><div><Wallet size={20}/><strong>Redeem</strong></div></div><a href="/wallet" className="ch-btn ch-btn-dark">Open my wallet <ArrowRight size={16}/></a></article>
  </section>

  <section className="v2-workshop-spotlight ch-workshop" aria-labelledby="home-workshop-title">
   <div className="v2-specialist-intro"><span className="v2-specialist-eyebrow"><Wrench size={18}/> COMIC WORKSHOP</span><h2 id="home-workshop-title">Good books.<br/><span>Careful hands.</span></h2><p>Find independent specialists for pressing, cleaning and pre-grading review. Compare services, ask questions, and request a quote for your book.</p><div className="v2-specialist-actions"><button type="button" className="ch-btn ch-btn-primary" onClick={p.onWorkshop}>Find a specialist <ArrowRight size={17}/></button><button type="button" className="ch-btn ch-btn-outline" onClick={p.onRegisterSpecialist}>List your studio <Wrench size={16}/></button></div></div>
   <div className="v2-specialist-services">{[{title:'Comic pressing',body:'Remove bends, ripples and handling marks before grading.',Icon:Wrench},{title:'Dry cleaning',body:'Safe surface cleaning by experienced hands.',Icon:BookOpen},{title:'Pre-grading review',body:'Know what to expect before you submit to a grading company.',Icon:ShieldCheck}].map(service=><article key={service.title}><service.Icon size={23}/><div><h3>{service.title}</h3><p>{service.body}</p></div></article>)}</div>
  </section>
 </div>;
}
