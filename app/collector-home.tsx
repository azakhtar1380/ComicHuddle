'use client';
// Home: hero with search, what you can do, a glimpse of the directory, fresh listings (real only),
// SafePurchase (only when live), rewards, and a join band.
import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {ArrowRight,BookOpen,Plus,Search,Store,Users,Wallet,Wrench,X} from 'lucide-react';
import ListingCardActions from '../components/cards/listing-card-actions';
import {requestCollectOnOpen} from '../components/cards/collect-intent';
import Link from 'next/link';
import Image from 'next/image';
import CharacterCard,{type CharacterHit} from './characters/character-card';
import './characters/characters.css';
import {parseCatalogSearchPage} from '../lib/catalog-picker-client';
import type {Issue} from '../lib/catalog';
import type {Listing} from '../lib/community';
import HuddlesGuide,{HuddlesArt,type HuddlesPose} from '../components/huddles-guide';
import {ErrorState} from '../components/states';
import ResolvedComicCover from './resolved-comic-cover';
import SupportComicHuddle from '../components/support-comichuddle';
import './home.css';

type Props={go:(section:string,tab?:string)=>void;onScan:()=>void;onOpenComic:(id:string)=>void;signedIn:boolean;listings:Listing[];safePurchaseLive:boolean;onStartCollection:()=>void};
const featuredIds=[24,26,29,0,1,2,3,4,5,6,7,8];
const usd=(value:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:value%1?2:0}).format(value);

export default function CollectorHome({go,onScan,onOpenComic,signedIn,listings,safePurchaseLive,onStartCollection}:Props){
 const [issues,setIssues]=useState<Issue[]|null>(null),[error,setError]=useState(false),[query,setQuery]=useState('');
 const load=useCallback((signal?:AbortSignal)=>{

  fetch('/api/catalog?'+new URLSearchParams({ids:featuredIds.join(',')}),{signal,cache:'no-store'})
   .then(async response=>{if(!response.ok)throw Error();const page=parseCatalogSearchPage(await response.json());if(!signal?.aborted)setIssues([...page.issues].sort((a,b)=>Number(!!b.cover?.startsWith('/covers/'))-Number(!!a.cover?.startsWith('/covers/'))||a.id-b.id))})
   .catch(()=>{if(!signal?.aborted){setError(true);setIssues([])}});
 },[]);
 useEffect(()=>{const abort=new AbortController();load(abort.signal);return()=>abort.abort()},[load]);
 const [characters,setCharacters]=useState<CharacterHit[]>([]);
 useEffect(()=>{const abort=new AbortController();fetch('/api/characters/browse?'+new URLSearchParams({sort:'popular',offset:'0',limit:'8'}),{signal:abort.signal}).then(r=>r.ok?r.json():null).then(body=>{if(Array.isArray(body?.characters))setCharacters((body.characters as CharacterHit[]).slice(0,8))}).catch(()=>undefined);return()=>abort.abort()},[]);
 const search=(event:FormEvent)=>{event.preventDefault();const q=query.trim();window.location.assign('/?'+new URLSearchParams(q?{section:'Directory',q}:{section:'Directory'}))};
 const fresh=listings.filter(listing=>listing.status==='active'&&!listing.example).slice(0,4);
 const doors:{pose:HuddlesPose;title:string;body:string;cta:string;action:()=>void}[]=[
  {pose:'directory',title:'Find any issue',body:'Search millions of comics by title, issue, character or creator.',cta:'Open the directory',action:()=>go('Directory')},
  {pose:'scanner',title:'Scan & add your comics',body:'Point your phone at the barcode or cover. We find the issue.',cta:'Scan a comic',action:onScan},
  {pose:'marketplace',title:'Buy, sell & trade',body:'One grail or the whole longbox, with real collectors.',cta:'Go to the marketplace',action:()=>go('Marketplace')},
  {pose:'workshop',title:'Get your comics pressed',body:'Find pros near you who press, clean and prep for grading.',cta:'Find a pro',action:()=>go('Pressing')},
 ];
 return <div className="home ds-wrap">
  <section className="home-hero" aria-labelledby="home-title">
   <div className="home-hero-copy">
    <p className="ds-eyebrow">The comic book marketplace &amp; collector community</p>
    <h1 id="home-title" className="ds-title home-title">Buy, sell, refine &amp; collect<br/><span>comic books.</span></h1>
    <p className="ds-lede">Look up any issue in our comic directory, keep track of the comics you own, buy, sell or trade with other collectors, and find pros to press and clean your books. Free to join.</p>
    <form className="home-search" role="search" onSubmit={search}>
     <Search size={22} aria-hidden="true"/>
     <input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search any comic, character or creator…" aria-label="Search any comic, character or creator" enterKeyHint="search" maxLength={120}/>
     {query&&<button type="button" className="home-search-clear" aria-label="Clear search" onClick={()=>setQuery('')}><X size={18}/></button>}
     <button type="submit" className="ds-btn ds-btn-dark">Search</button>
    </form>
    <nav className="home-hunt" aria-labelledby="home-hunt-title">
     <p id="home-hunt-title" className="home-hunt-title">Get started</p>
     <div className="home-hunt-chips">
      <button type="button" className="home-chip" onClick={()=>go('Directory')}><BookOpen size={18} aria-hidden="true"/> Directory</button>
      <Link className="home-chip" href="/characters"><Users size={18} aria-hidden="true"/> Characters</Link>
      <button type="button" className="home-chip" onClick={()=>go('Marketplace')}><Store size={18} aria-hidden="true"/> Marketplace</button>
      <button type="button" className="home-chip" onClick={()=>go('Pressing')}><Wrench size={18} aria-hidden="true"/> Comic Workshop</button>
      <button type="button" className="home-chip" onClick={()=>go('Wallet')}><Wallet size={18} aria-hidden="true"/> Wallet</button>
     </div>
    </nav>
    <div className="ds-actions home-hero-actions">
     <button type="button" className="ds-btn ds-btn-primary" onClick={onStartCollection}><span className="home-long">{signedIn?'Add your next comic':'Start your collection'}</span><span className="home-short">{signedIn?'Add a comic':'Start collecting'}</span> <ArrowRight size={18}/></button>
     <button type="button" className="ds-btn ds-btn-primary" onClick={()=>go('Marketplace')}><span className="home-long">Browse the marketplace</span><span className="home-short">Marketplace</span> <ArrowRight size={18}/></button>
    </div>
    <Link className="home-meet" href="/about-huddles"><Image src="/mascot/huddles-head.webp" width={28} height={28} alt="" unoptimized/> <span className="home-meet-ask">Who&apos;s this guy?</span> <strong>Meet Huddles →</strong></Link>
   </div>
   <HuddlesGuide pose="home" size="xl" className="home-hero-art"/>
  </section>

  <section className="ds-section home-doors" aria-labelledby="home-doors-title">
   <div className="ds-section-head"><h2 id="home-doors-title">What you can <span>do here</span></h2></div>
   <div className="ds-grid ds-grid-4">{doors.map(door=><button type="button" key={door.title} className="ds-card interactive home-door" onClick={door.action}>
    <HuddlesArt pose={door.pose} size="md" decorative className="home-door-art"/>
    <h3>{door.title}</h3><p>{door.body}</p><span className="home-door-go">{door.cta} <ArrowRight size={16}/></span>
   </button>)}</div>
  </section>


  <section className="ds-section" aria-labelledby="home-directory-title">
   <div className="ds-section-head"><div><h2 id="home-directory-title">A glimpse of the <span>directory</span></h2><p>Real issues from the directory. Tap one for the story, the characters and the credits.</p></div><button type="button" className="ds-link" onClick={()=>go('Directory')}>Explore all 2 million+ issues <ArrowRight size={16}/></button></div>
   {error?<ErrorState compact message="Couldn't load the directory. Try again." action={{label:'Try again',onClick:()=>{setError(false);setIssues(null);load()}}}/>
    :<div className="home-covers" aria-busy={issues===null}>{(issues||Array.from({length:6},()=>null)).slice(0,12).map((issue,index)=>issue?<div key={issue.id} className="home-cover-card"><button type="button" className="home-cover" onClick={()=>onOpenComic(String(issue.id))} aria-label={'Peek inside '+issue.title+' #'+issue.number+': see full details'}>
     <span className="home-cover-art"><ResolvedComicCover issueId={issue.id} title={issue.title} issue={issue.number} publisher={issue.publisher} year={issue.year||undefined} src={issue.cover||null} credit={issue.coverCredit||undefined}/></span>
     <strong>{issue.title} <span>#{issue.number}</span></strong><small>{issue.publisher}{issue.year?' · '+issue.year:''}</small>
     <span className="peek-inside home-peek" aria-hidden="true">Peek inside <ArrowRight size={15}/></span>
    </button>
     {/* Directory card with no listing: Add to collection only (opens the detail card's collection dialog, after the account gate). */}
     <button type="button" className="ds-btn ds-btn-secondary ds-btn-sm home-cover-collect" aria-label={'Add to collection: '+issue.title+' #'+issue.number} onClick={()=>{requestCollectOnOpen(issue.id);onOpenComic(String(issue.id))}}><Plus size={15} aria-hidden="true"/> Add to collection</button>
    </div>:<span key={index} className="home-cover home-skeleton" aria-hidden="true"/>)}</div>}
  </section>

  {characters.length>0&&<section className="ds-section home-chars" aria-labelledby="home-chars-title">
   <div className="home-chars-head">
    <div className="ds-section-head"><div><h2 id="home-chars-title">Every hero.<br/><span>Every villain.</span></h2><p>See where they first appeared and every issue they&apos;re in.</p></div><Link className="ds-link" href="/characters">Browse all characters <ArrowRight size={16}/></Link></div>
    <HuddlesGuide pose="characters" size="md" tone="blue" className="home-chars-art"/>
   </div>
   <div className="home-chars-row cp-people">{characters.map(hit=><CharacterCard key={hit.characterId} hit={hit}/>)}</div>
  </section>}

  {fresh.length>0&&<section className="ds-section" aria-labelledby="home-fresh-title">
   <div className="ds-section-head"><h2 id="home-fresh-title">Fresh in the <span>marketplace</span></h2><button type="button" className="ds-link" onClick={()=>go('Marketplace')}>See every listing <ArrowRight size={16}/></button></div>
   <div className="ds-grid ds-grid-4">{fresh.map(listing=><article key={listing.id} className="ds-card home-listing-card"><a className="home-listing" href={'/?'+new URLSearchParams({section:'Marketplace',listing:listing.id})}>
    <span className="home-listing-art">{listing.photos[0]?<img src={'/api/media?id='+encodeURIComponent(listing.photos[0])+'&size=thumbnail'} alt="" loading="lazy"/>:<HuddlesArt pose="marketplace" size="sm" decorative/>}</span>
    <strong>{listing.title}</strong>
    <small>{listing.kind==='collection'?listing.itemCount+' comics':listing.grade}</small>
    <span className="home-listing-price">{listing.saleType==='auction'?'Auction':usd(listing.price)}</span>
   </a>
    <ListingCardActions listing={listing} issueId={listing.kind==='single'&&listing.itemCount===1&&listing.issueId!==null&&Number.isSafeInteger(listing.issueId)?listing.issueId:null}/>
   </article>)}</div>
  </section>}

  {safePurchaseLive&&<section className="ds-section home-strip home-strip-safe" aria-labelledby="home-safe-title">
   <HuddlesArt pose="safepurchase" size="md" className="home-strip-art"/>
   <div><p className="ds-eyebrow">SafePurchase</p><h2 id="home-safe-title">A careful path for a <span>valuable book.</span></h2>
    <ol className="home-steps"><li><b>1</b> You buy</li><li><b>2</b> We check the book</li><li><b>3</b> It ships to you</li></ol>
    <a className="ds-link" href="/safepurchase">Learn how it works <ArrowRight size={16}/></a></div>
  </section>}

  <SupportComicHuddle id="support"/>

  <section className="ds-section home-strip home-strip-rewards" aria-labelledby="home-rewards-title">
   <HuddlesArt pose="wallet" size="md" className="home-strip-art"/>
   <div><p className="ds-eyebrow">Collector rewards</p><h2 id="home-rewards-title">Earn while you <span>collect.</span></h2><p>Earn 1 point for every $1. 100 points = $1 credit.</p>
    <a className="ds-link" href="/wallet">Open your wallet <ArrowRight size={16}/></a></div>
  </section>

  <section className="home-join" aria-labelledby="home-join-title">
   <HuddlesArt pose="sign-in" size="md" className="home-join-art"/>
   {signedIn?<div><h2 id="home-join-title">Add your <span>next comic.</span></h2><p>Scan it, search it or add it by hand. It takes a minute.</p><div className="ds-actions"><button type="button" className="ds-btn ds-btn-yellow" onClick={onStartCollection}>Add a comic</button><button type="button" className="ds-btn home-join-ghost" onClick={onScan}>Scan a comic</button></div></div>
    :<div><h2 id="home-join-title">Join free.</h2><p>Your collection, your showcase, your people.</p><div className="ds-actions"><a className="ds-btn ds-btn-yellow" href="/sign-in?mode=register">Join free</a><a className="ds-btn home-join-ghost" href="/sign-in">Sign in</a></div></div>}
  </section>
 </div>;
}
