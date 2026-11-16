'use client';
// The My Profile page (Overview · Collection · Wishlist · Reviews). Used for your own profile and anyone else's.
// Data: CollectorProfile from /api/social plus `extras` (lib/profile-extras.ts). Text always sits on cream cards.
import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {ArrowLeft,ArrowRight,Camera,Flag,Link2,MessageCircle,MoreHorizontal,Palette,Pencil,Plus,Share2,Star,Wrench} from 'lucide-react';
import type {CollectorProfile,ShowcaseBook} from '../../lib/community';
import type {Issue} from '../../lib/catalog';
import {catalog} from '../../lib/catalog';
import {emptyExtras,profilePath,type ProfileExtras} from '../../lib/profile-page-types';
import {VerifiedBadge} from '../verified-badge';
import AdminBadge from '../admin-badge';
import HScroll from '../h-scroll';
import BusinessCard from './business-card';
import type {BusinessSummary} from './business-client';
import './profile-page.css';

export type ProfileView=CollectorProfile&Partial<BusinessSummary>&{extras?:ProfileExtras};
export type ProfileTab='overview'|'collection'|'wishlist'|'reviews';

/** Mr. Huddles, standing at the photo's bottom-right. Decorative only. */
export function HuddlesCutout({className=''}:{className?:string}){
 // eslint-disable-next-line @next/next/no-img-element
 return <img className={'pp-huddles '+className} src="/mascot/huddles-cutout.webp" alt="" aria-hidden="true" width={59} height={84} draggable={false}/>;
}
/** Profile photo in its frame, with the empty-state outline and Mr. Huddles. */
export function ProfilePhoto({url,name,frame='circle',children}:{url:string|null|undefined;name:string;frame?:string;children?:ReactNode}){
 return <div className={'pp-photo-wrap pp-frame-'+frame}>
  <span className="pp-ring" aria-hidden="true"/>
  <div className="pp-photo">{url
   // eslint-disable-next-line @next/next/no-img-element
   ?<img src={url} alt={name+'’s profile photo'} width={124} height={124}/>
   :<span className="pp-photo-empty" role="img" aria-label={name+' has no profile photo yet'}><svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true"><circle cx="32" cy="23" r="11" fill="none" stroke="currentColor" strokeWidth="3"/><path d="M12 56c2-11 10-17 20-17s18 6 20 17" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg></span>}
  </div>
  {children}
  <HuddlesCutout/>
 </div>;
}

function fileButton(label:string,onFile:(file:File)=>void,className:string,content:ReactNode,disabled:boolean){
 return <label className={className+(disabled?' is-disabled':'')} aria-label={label} title={label}>
  <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={disabled} onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)onFile(file)}}/>
  {content}
 </label>;
}
const issueLabel=(ref:{title:string;number:string;year:number|null})=>`${ref.title} #${ref.number}${ref.year?' ('+ref.year+')':''}`;

type Props={p:ProfileView;own:boolean;busy:boolean;wants:Record<number,Issue>;uploading:''|'photo'|'cover';
 onBack:()=>void;onEdit:()=>void;onBook:(b:ShowcaseBook)=>void;onIssue:(id:number)=>void;onReport:()=>void;onMessage:(context?:string)=>void;onShare:()=>void;onTheme:()=>void;onCollection:()=>void;
 onPhoto:(file:File)=>void;onCover:(file:File)=>void;onCopyLink:()=>void;
 art:(book:ShowcaseBook)=>ReactNode;collectionTab?:ReactNode;reviewsTab:ReactNode;ownerExtras?:ReactNode;trophyPreview?:ReactNode;theme?:{world?:string;frame?:string;sfx?:string;ink?:string}};

export default function ProfilePage({p,own,busy,wants,uploading,onBack,onEdit,onBook,onIssue,onReport,onMessage,onShare,onTheme,onCollection,onPhoto,onCover,onCopyLink,art,collectionTab,reviewsTab,ownerExtras,trophyPreview,theme}:Props){
 const x=p.extras||emptyExtras,[tab,setTab]=useState<ProfileTab>('overview'),[menu,setMenu]=useState(false),menuRef=useRef<HTMLDivElement>(null),ids=useId();
 const biz:BusinessSummary={isBusiness:!!p.isBusiness,verified:!!p.verified,shopName:p.shopName??null,business:p.business};
 const tabs:{id:ProfileTab;label:string}[]=[{id:'overview',label:'Overview'},{id:'collection',label:'Collection'},{id:'wishlist',label:'Wishlist'},...(own||x.share.reviews?[{id:'reviews' as const,label:'Reviews'}]:[])];
 useEffect(()=>{if(!menu)return;const close=(event:MouseEvent|KeyboardEvent)=>{if(event instanceof KeyboardEvent?event.key==='Escape':!menuRef.current?.contains(event.target as Node))setMenu(false)};document.addEventListener('mousedown',close);document.addEventListener('keydown',close);return()=>{document.removeEventListener('mousedown',close);document.removeEventListener('keydown',close)}},[menu]);
 const favorites=p.showcase.slice(0,6),open=Math.max(0,6-favorites.length),wantList=p.wantIds.slice(0,24);
 const verifiedLabel=biz.verified?(biz.isBusiness?'Verified business':'Verified collector'):null;
 const select=(next:ProfileTab)=>{setTab(next);requestAnimationFrame(()=>document.getElementById(ids+'-tab-'+next)?.focus())};
 return <article className={'pp pp-world-'+(theme?.world||'classic')+' pp-ink-'+(theme?.ink||'golden')} aria-labelledby={ids+'-name'}>
  <div className="pp-topbar">
   <button type="button" className="pp-icon-btn" onClick={onBack} aria-label="Back"><ArrowLeft size={22} aria-hidden="true"/></button>
   <p className="pp-topbar-title">{own?'MY PROFILE':'PROFILE'}</p>
   <div className="pp-menu" ref={menuRef}>
    <button type="button" className="pp-icon-btn" aria-label="More profile options" aria-haspopup="menu" aria-expanded={menu} onClick={()=>setMenu(v=>!v)}><MoreHorizontal size={22} aria-hidden="true"/></button>
    {menu&&<div className="pp-menu-list" role="menu">
     {own&&<button type="button" role="menuitem" onClick={()=>{setMenu(false);onEdit()}}><Pencil size={16} aria-hidden="true"/> Edit profile</button>}
     {own&&<button type="button" role="menuitem" onClick={()=>{setMenu(false);onCollection()}}><Plus size={16} aria-hidden="true"/> My collection</button>}
     <button type="button" role="menuitem" onClick={()=>{setMenu(false);onCopyLink()}}><Link2 size={16} aria-hidden="true"/> Copy profile link</button>
     <button type="button" role="menuitem" onClick={()=>{setMenu(false);onShare()}}><Share2 size={16} aria-hidden="true"/> Share card</button>
     {!own&&<button type="button" role="menuitem" onClick={()=>{setMenu(false);onReport()}}><Flag size={16} aria-hidden="true"/> Report this profile</button>}
    </div>}
   </div>
  </div>

  <div className="pp-cover" style={x.coverUrl?{backgroundImage:`url(${x.coverUrl})`}:undefined}>
   {!x.coverUrl&&<span className="pp-cover-empty" aria-hidden="true"/>}
   {own&&fileButton(x.coverUrl?'Change cover photo':'Add a cover photo',onCover,'pp-cover-change',<><Camera size={16} aria-hidden="true"/> {uploading==='cover'?'Uploading…':'Change'}</>,busy||!!uploading)}
  </div>

  <div className="pp-avatar-row">
   <button type="button" className="pp-round pp-round-share" onClick={onShare}><Share2 size={22} aria-hidden="true"/><span>Share</span></button>
   <ProfilePhoto url={p.avatarUrl} name={p.name} frame={theme?.frame}>
    {own&&fileButton(p.avatarUrl?'Replace profile photo':'Upload a profile photo',onPhoto,'pp-photo-camera',<Camera size={18} aria-hidden="true"/>,busy||!!uploading)}
   </ProfilePhoto>
   <button type="button" className="pp-round pp-round-theme" onClick={onTheme}><Palette size={22} aria-hidden="true"/><span>Theme</span></button>
  </div>
  {p.staff?.founder&&<p className="pp-staff"><AdminBadge founder showLabel size={18}/></p>}
  {uploading==='photo'&&<p className="pp-uploading" role="status">Uploading your photo…</p>}

  <section className="pp-card pp-namecard">
   <h1 id={ids+'-name'} className="pp-name"><span>{p.name}</span>{verifiedLabel&&<VerifiedBadge size={24}/>}{biz.verified&&biz.isBusiness&&<span className="pp-shop-tag">Shop</span>}</h1>
   {verifiedLabel&&<p className="pp-verified-line">{verifiedLabel} · <a href="/verified">How we verify</a></p>}
   <p className="pp-meta"><b>@{p.handle}</b> · Collecting since <span className="pp-num">{p.since}</span>{p.location?<> · {p.location}</>:null}</p>
   {x.rating&&<p className="pp-rating">{x.rating.stars!==null?<><span className="pp-stars" aria-hidden="true">{[1,2,3,4,5].map(n=><Star key={n} size={16} fill={n<=Math.round(x.rating!.stars!)?'currentColor':'none'}/>)}</span><span className="pp-num">{x.rating.stars.toFixed(1)}</span><span className="sr-only">out of 5 stars</span></>:<span className="pp-num">{x.rating.percent}% positive</span>} · <span className="pp-num">{x.rating.count}</span> {x.rating.count===1?'review':'reviews'}</p>}
   {x.tags.length>0&&<ul className="pp-tags" aria-label="Collector tags">{x.tags.map(tag=><li key={tag}>{tag}</li>)}</ul>}
   {!own&&<div className="pp-actions"><button type="button" className="ds-btn ds-btn-primary" disabled={!p.dmOpen||busy} onClick={()=>onMessage()}><MessageCircle size={18} aria-hidden="true"/> {p.dmOpen?'Send a message':'Not taking messages'}</button></div>}
   {own&&!p.visible&&<p className="pp-hidden-note">Hidden. Only you can see this profile.</p>}
   {p.provider&&<a className="ds-link" href={'/?section=Pressing&provider='+p.provider.id}><Wrench size={16} aria-hidden="true"/> Comic Workshop pro · {p.provider.name}</a>}
  </section>

  {(p.bio||own)&&<div className="pp-origin"><p className="pp-caption-tag">Origin story</p><p className="pp-origin-text">{p.bio||'Tell collectors how you got into comics. Edit your profile to write your origin story.'}</p></div>}

  <dl className="pp-stats">
   <div><dt>Comics</dt><dd>{p.stats.comics.toLocaleString('en-US')}</dd></div>
   <div><dt>Keys</dt><dd>{x.keys.toLocaleString('en-US')}</dd></div>
   <div><dt>Wishlist</dt><dd>{p.stats.wants.toLocaleString('en-US')}</dd></div>
   <div><dt>Trades</dt><dd>{p.stats.trades.toLocaleString('en-US')}</dd></div>
  </dl>

  <HScroll as="div" className="pp-tabs" role="tablist" aria-label="Profile sections">
   {tabs.map((t,i)=><button key={t.id} id={ids+'-tab-'+t.id} type="button" role="tab" aria-selected={tab===t.id} aria-controls={ids+'-panel'} tabIndex={tab===t.id?0:-1} onClick={()=>setTab(t.id)} onKeyDown={event=>{if(event.key==='ArrowRight')select(tabs[(i+1)%tabs.length].id);if(event.key==='ArrowLeft')select(tabs[(i-1+tabs.length)%tabs.length].id)}}>{t.label}</button>)}
  </HScroll>

  <div id={ids+'-panel'} role="tabpanel" aria-labelledby={ids+'-tab-'+tab} className="pp-panel">
   {tab==='overview'&&<>
    {biz.isBusiness&&<BusinessCard summary={biz} own={own}/>}
    <section className="pp-card pp-block" aria-labelledby={ids+'-six'}>
     <div className="pp-block-head"><h2 id={ids+'-six'}><span className="pp-eyebrow">The six</span>Favorites</h2>{own&&<button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" onClick={onEdit}><Pencil size={16} aria-hidden="true"/> Pick favorites</button>}</div>
     {favorites.length||own?<ul className="nw-books nw-six" aria-label="Six favorites">
      {favorites.map((b,i)=><li key={b.id}><button type="button" className="nw-book" onClick={()=>onBook(b)} aria-label={'Peek inside '+b.title+' '+(/^#/.test(b.issue)||!b.issue?b.issue:'#'+b.issue)+': see full details'}><span className="nw-rank" aria-hidden="true">{i+1}</span>{art(b)}<strong>{b.title} {b.issue}</strong>{b.grade&&<small>{b.grade}</small>}<span className="peek-inside nw-peek" aria-hidden="true">Peek inside <ArrowRight size={14}/></span></button></li>)}
      {own&&Array.from({length:open},(_,i)=><li key={'open-'+i}><button type="button" className="nw-book nw-slot" onClick={onEdit}><span className="nw-slot-art"><Plus size={28} aria-hidden="true"/></span><strong>Add a favorite</strong></button></li>)}
     </ul>:<p className="nw-empty">No favorites picked yet.</p>}
    </section>

    <div className="pp-duo">
     <section className="pp-card pp-fav" aria-labelledby={ids+'-char'}>
      <h2 id={ids+'-char'} className="pp-eyebrow">Favorite character</h2>
      {x.favoriteCharacter?<a className="pp-fav-link" href={'/characters/'+x.favoriteCharacter.id}><span className="pp-fav-circle" aria-hidden="true">{x.favoriteCharacter.name.slice(0,1)}</span><span><strong>{x.favoriteCharacter.name}</strong><small>{x.favoriteCharacter.firstAppearance?'First appearance: '+issueLabel(x.favoriteCharacter.firstAppearance):'First appearance not verified yet'}</small></span></a>
      :<p className="pp-empty">{own?<button type="button" className="ds-link" onClick={onEdit}>Pick a favorite character</button>:'Not picked yet.'}</p>}
     </section>
     <section className="pp-card pp-fav" aria-labelledby={ids+'-comic'}>
      <h2 id={ids+'-comic'} className="pp-eyebrow">Favorite comic</h2>
      {x.favoriteComic?<button type="button" className="pp-fav-link" onClick={()=>onIssue(x.favoriteComic!.issueId)}><span className="pp-fav-circle pp-fav-square" aria-hidden="true">#{x.favoriteComic.number.slice(0,4)}</span><span><strong>{x.favoriteComic.title} #{x.favoriteComic.number}</strong><small>{[x.favoriteComic.year,x.favoriteComic.keyNote].filter(Boolean).join(' · ')||'Directory issue'}</small></span></button>
      :<p className="pp-empty">{own?<button type="button" className="ds-link" onClick={onEdit}>Pick a favorite comic</button>:'Not picked yet.'}</p>}
     </section>
    </div>

    {(x.grail||own)&&<section className="pp-wanted" aria-labelledby={ids+'-wanted'}>
     <p className="pp-wanted-head" id={ids+'-wanted'}>WANTED</p>
     {x.grail?<>
      <button type="button" className="pp-wanted-title" onClick={()=>onIssue(x.grail!.issueId)}>{issueLabel(x.grail)}</button>
      <p className="pp-wanted-reward">Reward: {x.grail.reward||'Make me an offer'}</p>
      {!own&&<button type="button" className="ds-btn ds-btn-primary" disabled={!p.dmOpen||busy} onClick={()=>onMessage('Grail: '+issueLabel(x.grail!))}>I have one — make an offer</button>}
     </>:<p className="pp-wanted-reward"><button type="button" className="ds-link" onClick={onEdit}>Put your grail on a wanted poster</button></p>}
    </section>}

    {p.favorite&&<div className="pp-bubble"><p className="pp-eyebrow">Now reading</p><p className="pp-bubble-text">{p.favorite}</p></div>}

    {trophyPreview}

    {x.latestReview&&<figure className="pp-card pp-quote"><blockquote>“{x.latestReview.text}”</blockquote><figcaption>Review from {x.latestReview.by}</figcaption></figure>}

    <div className="pp-linkbar"><span className="pp-linkbar-url"><Link2 size={16} aria-hidden="true"/> comichuddle.com{profilePath(p.handle)}</span><button type="button" className="ds-btn ds-btn-primary ds-btn-sm" onClick={onShare}><Share2 size={16} aria-hidden="true"/> Share</button></div>
    {ownerExtras}
   </>}
   {tab==='collection'&&(collectionTab||<p className="nw-empty">Nothing to show here yet.</p>)}
   {tab==='wishlist'&&<section className="pp-card pp-block" aria-label="Wishlist">
    {x.grail&&<p className="pp-wish-grail"><b>Grail:</b> {issueLabel(x.grail)}</p>}
    {wantList.length?<ul className="nw-wants">{wantList.map(id=>{const record=wants[id]||catalog[id];return <li key={id}><button type="button" className="nw-want" onClick={()=>onIssue(id)} aria-label={'Peek inside '+(record?record.title+' #'+record.number.replace(/^#/,''):'saved issue')+': see full details'}><span><strong>{record?record.title+' #'+record.number.replace(/^#/,''):'Loading…'}</strong>{record&&<small>{[record.publisher,record.year].filter(Boolean).join(' · ')}</small>}</span><ArrowRight size={16} aria-hidden="true"/></button></li>})}</ul>
    :<p className="nw-empty">{own?'No wants yet. Add them from any comic page.':x.share.wishlist?'No wants listed.':'This collector keeps their wishlist private.'}</p>}
    {p.wantIds.length>wantList.length&&<p className="pp-note">Showing {wantList.length} of {p.wantIds.length}.</p>}
   </section>}
   {tab==='reviews'&&reviewsTab}
  </div>
 </article>;
}

