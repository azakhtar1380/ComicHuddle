'use client';
// A studio's public page in Comic Workshop: a storefront built only from what the studio entered
// and from verified customer reviews. Missing details say "Not listed" instead of guessing.
import {useState} from 'react';
import {ArrowLeft,ArrowRight,ArrowUpRight,Check,Clock,Flag,Link2,MapPin,MessageCircle,Package,ShieldCheck,Star,Store,Wrench} from 'lucide-react';
import {careGuideFor,cgcLinks,ratingBreakdown,sortReviews,type CareReview,type Provider,type ReviewSort} from '../../lib/pressing';
import {HowItWorks} from '../states';
import {SaveButton,Stars,StudioMark,coverPhoto,day,media,messageHref,monthYear,place,serviceName,studioHref,usd} from './ui';

export type StudioDetail={provider:Provider;reviews:CareReview[];canReview?:boolean};

function Fact({icon,label,children,missing}:{icon:React.ReactNode;label:string;children?:React.ReactNode;missing?:boolean}){
 return <div className={'ws-fact'+(missing?' missing':'')}>{icon}<div><dt>{label}</dt><dd>{missing?'Not listed':children}</dd></div></div>;
}

export default function StudioProfile({detail,meId,busy,saved,onToggleSave,onBack,onQuote,onEdit,onReview,onReport,onDeleteReview,notice}:{detail:StudioDetail;meId?:string;busy:boolean;saved:boolean;onToggleSave:()=>void;onBack:()=>void;onQuote:()=>void;onEdit:()=>void;onReview:()=>void;onReport:(type:string,id:string)=>void;onDeleteReview:(id:string)=>Promise<void>;notice:(s:string)=>void}){
 const {provider:p,reviews}=detail,own=p.profileId===meId,cover=coverPhoto(p);
 const [sort,setSort]=useState<ReviewSort>('newest');
 const publicReviews=reviews.filter(r=>r.verified!==false),mineReview=reviews.some(r=>r.mine);
 const breakdown=ratingBreakdown(publicReviews),shown=sortReviews(reviews,sort);
 // "Doing this since" defaults to the sign-up year in the form, so only show it when it says more than that.
 const showSince=p.experienceSince<new Date(p.createdAt).getFullYear();
 const specialties=p.specialties.split(/[,;·]/).map(s=>s.trim()).filter(Boolean);
 async function share(){const url=new URL(studioHref(p.id),window.location.origin).toString();try{await navigator.clipboard.writeText(url);notice('Link copied.')}catch{notice('Copy this link: '+url)}}
 const contact=own?<button type="button" className="ds-btn ds-btn-primary" onClick={onEdit}><Wrench size={16} aria-hidden="true"/> Edit my studio</button>
  :<><button type="button" className="ds-btn ds-btn-primary" disabled={!p.accepting} onClick={onQuote}>Request a quote <ArrowRight size={16} aria-hidden="true"/></button><a className="ds-btn ds-btn-secondary" href={messageHref(p)}><MessageCircle size={16} aria-hidden="true"/> Message</a></>;

 return <article className="ws-store" aria-labelledby="ws-store-title">
  <button type="button" className="ds-link ws-back" onClick={onBack}><ArrowLeft size={16} aria-hidden="true"/> All studios</button>
  <header className="ws-store-hero">
   <div className={'ws-store-cover'+(cover?'':' ws-cover-plain')}>{cover&&<img src={media(cover)} alt=""/>}</div>
   <div className="ws-store-id">
    <StudioMark p={p} size="lg"/>
    <div className="ws-store-name">
     <p className="ws-store-eyebrow"><span className={'ws-pill '+(p.accepting?'ws-pill-open':'ws-pill-paused')}>{p.accepting?'Taking requests':'Requests paused'}</span><span>On ComicHuddle since {monthYear(p.createdAt)}</span></p>
     <h2 id="ws-store-title">{p.name}</h2>
     <p className="ws-meta"><MapPin size={15} aria-hidden="true"/>{place(p)}{typeof p.distanceMiles==='number'&&<> · ~{p.distanceMiles} mi away</>} · run by @{p.collector.handle||'collector'}</p>
     {p.reviewCount>0?<a className="ws-meta ws-rating-link" href="#ws-reviews"><Stars value={p.rating} size={16}/><span>{p.reviewCount} verified {p.reviewCount===1?'review':'reviews'}</span></a>:<p className="ws-meta ws-muted">No reviews yet</p>}
    </div>
   </div>
   <div className="ws-store-actions">{contact}{!own&&<SaveButton saved={saved} name={p.name} onToggle={onToggleSave} className="ws-save-inline"/>}<button type="button" className="ws-icon-pill" onClick={()=>void share()}><Link2 size={16} aria-hidden="true"/> Share</button>{p.website&&<a className="ws-icon-pill" href={p.website} target="_blank" rel="noreferrer">Website <ArrowUpRight size={15} aria-hidden="true"/></a>}</div>
   {!p.accepting&&!own&&<p className="ws-note">This studio isn’t taking new requests right now. You can still send a message.</p>}
  </header>

  <div className="ws-store-grid">
   <div className="ws-store-main">
    <section aria-labelledby="ws-about"><h3 id="ws-about" className="ws-subtitle">About</h3><p className="ws-bio">{p.bio}</p>
     {specialties.length>0&&<ul className="ws-tags ws-specialties" aria-label="Specialties">{specialties.map(s=><li key={s}>{s}</li>)}</ul>}
    </section>

    <section aria-labelledby="ws-services-title"><h3 id="ws-services-title" className="ws-subtitle">Services</h3>
     <ul className="ws-store-services">{p.services.map(s=>{const g=careGuideFor(s),price=p.prices[s];return <li key={s}>
      <div className="ws-svc-head"><b>{serviceName(s)}</b><span className={'ws-svc-price'+(typeof price==='number'?'':' quote')}>{typeof price==='number'?<>From {usd(price)}<small>/book</small></>:'Priced in your quote'}</span></div>
      {g&&<p>{g.what}</p>}
      {s==='cgc'&&<p className="ws-svc-note">{p.submissionMode==='dealer'?<>Submits to CGC for you through their dealer account (studio’s statement). <a href={cgcLinks.dealers} target="_blank" rel="noreferrer">Check CGC’s dealer list <ArrowUpRight size={13} aria-hidden="true"/></a></>:'Preps books; you send them to CGC yourself.'}</p>}
      {g&&<details><summary>What to tell them</summary><ul>{g.tell.map(t=><li key={t}>{t}</li>)}</ul></details>}
     </li>})}</ul>
     <p className="ws-help">The studio sets its prices. Your quote shows the final cost before anything ships.</p>
    </section>

    <section aria-labelledby="ws-gallery"><h3 id="ws-gallery" className="ws-subtitle">Before &amp; after</h3>
     {p.portfolio.length>0?<div className="ws-portfolio">{p.portfolio.map((pair,i)=><figure key={i}><div><span><img src={media(pair.before)} alt={'Before: '+pair.caption}/><small>Before</small></span><span><img src={media(pair.after)} alt={'After: '+pair.caption}/><small>After</small></span></div><figcaption>{pair.caption}</figcaption></figure>)}</div>
     :<p className="ws-empty-line">No before-and-after photos yet. Ask the studio for examples in Messages.</p>}
    </section>

    <section id="ws-reviews" aria-labelledby="ws-reviews-title" className="ws-reviews-block">
     <div className="ws-section-head"><h3 id="ws-reviews-title" className="ws-subtitle">Reviews</h3>{!own&&detail.canReview&&<button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" onClick={onReview}><Star size={15} aria-hidden="true"/> {mineReview?'Edit my review':'Write a review'}</button>}</div>
     {publicReviews.length>0?<div className="ws-review-summary">
      <div className="ws-review-score"><b>{p.rating!==null?p.rating.toFixed(1):'–'}</b><Stars value={p.rating} size={16}/><span>{p.reviewCount} verified {p.reviewCount===1?'review':'reviews'}{p.completedReviewCount>0?' · '+p.completedReviewCount+' after a finished job':''}</span></div>
      <ul className="ws-bars" aria-label="Rating breakdown">{breakdown.counts.map(({star,count})=><li key={star}><span>{star}★</span><span className="ws-bar"><i style={{width:(breakdown.total?count/breakdown.total*100:0)+'%'}}/></span><span>{count}</span></li>)}</ul>
      <dl className="ws-category">{([['quality','Quality'],['communication','Communication'],['timeliness','Timeliness']] as const).map(([k,name])=><div key={k}><dt>{name}</dt><dd>{p.categoryRatings[k]===null?'–':p.categoryRatings[k]!.toFixed(1)}</dd></div>)}</dl>
     </div>:<p className="ws-empty-line">No reviews yet. Only collectors who accepted a quote from this studio can review it.</p>}
     {reviews.length>1&&<label className="ws-select ws-review-sort"><span>Sort</span><select value={sort} onChange={e=>setSort(e.target.value as ReviewSort)}><option value="newest">Newest</option><option value="highest">Highest rated</option><option value="lowest">Lowest rated</option></select></label>}
     {reviews.length>0&&<ul className="ws-reviews">{shown.map(r=><li key={r.id}>
      <div className="ws-review-top"><Stars value={r.rating}/>{r.verified===false?<span className="ws-badge ws-badge-muted">Not verified · only you can see this</span>:<span className="ws-badge"><Check size={13} aria-hidden="true"/> Verified customer{r.completedRequest?' · job finished':''}</span>}</div>
      <h4>{r.title}</h4><p>{r.body}</p>
      <div className="ws-review-foot"><span>@{r.author.handle} · {day(r.updatedAt)}</span>{r.mine?<button type="button" disabled={busy} onClick={()=>void onDeleteReview(r.id)}>Delete my review</button>:<button type="button" onClick={()=>onReport('care_review',r.id)}><Flag size={14} aria-hidden="true"/> Report</button>}</div>
     </li>)}</ul>}
    </section>

    {p.terms&&<HowItWorks title="Studio terms"><p className="ws-pre">{p.terms}</p></HowItWorks>}
    {!own&&<p className="ws-report-line"><button type="button" className="ds-link" onClick={()=>onReport('care_provider',p.id)}><Flag size={14} aria-hidden="true"/> Report this studio</button></p>}
   </div>

   <aside className="ws-store-side" aria-label="Studio details">
    <div className="ws-side-panel">
     <h3 className="ws-side-title">At a glance</h3>
     <dl className="ws-facts">
      <Fact icon={<Clock size={18} aria-hidden="true"/>} label="Turnaround">{p.turnaroundMin===p.turnaroundMax?p.turnaroundMin:p.turnaroundMin+'–'+p.turnaroundMax} business days<small>Plus shipping and any grading time</small></Fact>
      <Fact icon={<Package size={18} aria-hidden="true"/>} label="How to send books" missing={!p.mailIn&&!p.dropoff}>{[p.mailIn&&'Mail-in',p.dropoff&&'Local drop-off'].filter(Boolean).join(' · ')}</Fact>
      <Fact icon={<ShieldCheck size={18} aria-hidden="true"/>} label="CGC submission">{p.submissionMode==='dealer'?'Submits for you':p.submissionMode==='prepare_only'?'Prep only':'Not offered'}</Fact>
      <Fact icon={<MapPin size={18} aria-hidden="true"/>} label="Location">{place(p)}</Fact>
      <Fact icon={<Store size={18} aria-hidden="true"/>} label="Doing this since" missing={!showSince}>{p.experienceSince}</Fact>
      <Fact icon={<Link2 size={18} aria-hidden="true"/>} label="Website" missing={!p.website}>{p.website&&<a href={p.website} target="_blank" rel="noreferrer">{p.website.replace(/^https:\/\/(www\.)?/,'').replace(/\/$/,'')}</a>}</Fact>
     </dl>
     <div className="ws-side-actions">{contact}</div>
    </div>
    <div className="ws-trust">
     <p><Check size={15} aria-hidden="true"/> Reviews come only from collectors who accepted a quote.</p>
     <p><Check size={15} aria-hidden="true"/> You pay the studio directly. ComicHuddle doesn’t charge you.</p>
     <p><Check size={15} aria-hidden="true"/> Studio details are written by the studio. Pressing can’t promise a grade.</p>
    </div>
   </aside>
  </div>
 </article>;
}
