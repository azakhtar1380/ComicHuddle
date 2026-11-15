'use client';
// Small shared pieces for Comic Workshop (cards, stars, studio mark, links). Styles live in app/pressing.css.
import {ArrowRight,Bookmark,MapPin,Star} from 'lucide-react';
import {careServices,type Provider} from '../../lib/pressing';

export const usd=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
export const day=(s:string)=>new Date(s).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
export const monthYear=(s:string)=>new Date(s).toLocaleDateString('en-US',{month:'long',year:'numeric'});
export const serviceName=(id:string)=>careServices.find(s=>s.id===id)?.name||id;
export const place=(p:Provider)=>p.locationCity?p.locationCity+', '+p.locationState:p.location;
export const media=(id:string)=>'/api/media?id='+encodeURIComponent(id);
/** Opens the one messaging system with this studio's context (handled by the Messages section). */
export const messageHref=(p:Pick<Provider,'id'|'profileId'>)=>'/?'+new URLSearchParams({section:'Messages',to:p.profileId,provider:p.id}).toString();
/** Shareable link that opens this studio's page inside Comic Workshop. */
export const studioHref=(id:string)=>'/?'+new URLSearchParams({section:'Comic Workshop',provider:id}).toString();
export function startingPrice(p:Provider){const prices=p.services.map(s=>p.prices[s]).filter((v):v is number=>typeof v==='number'&&v>0);return prices.length?Math.min(...prices):null}
export const coverPhoto=(p:Provider)=>p.portfolio[0]?.after||null;
export const initials=(name:string)=>name.split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase()||'CW';

export function Stars({value,size=14}:{value:number|null;size?:number}){
 const shown=value===null||!Number.isFinite(value)?null:value;
 return <span className="ws-stars" role="img" aria-label={shown===null?'No ratings yet':shown.toFixed(1)+' out of 5 stars'}>{[1,2,3,4,5].map(i=><Star key={i} size={size} aria-hidden="true" fill={shown!==null&&i<=Math.round(shown)?'currentColor':'none'}/>)}<b>{shown===null?'New':shown.toFixed(1)}</b></span>;
}

export function StudioMark({p,size='md'}:{p:Pick<Provider,'name'|'logoId'>;size?:'sm'|'md'|'lg'}){
 return <span className={'ws-mark ws-mark-'+size} aria-hidden="true">{p.logoId?<img src={media(p.logoId)} alt=""/>:initials(p.name)}</span>;
}

export function RatingLine({p}:{p:Provider}){
 return p.reviewCount>0?<p className="ws-meta ws-rating-line"><Stars value={p.rating}/><span>{p.reviewCount} verified {p.reviewCount===1?'review':'reviews'}</span></p>
  :<p className="ws-meta ws-rating-line ws-muted">No reviews yet</p>;
}

export function SaveButton({saved,name,onToggle,className=''}:{saved:boolean;name:string;onToggle:()=>void;className?:string}){
 return <button type="button" className={'ws-save '+(saved?'on ':'')+className} aria-pressed={saved} aria-label={(saved?'Remove ':'Save ')+name+(saved?' from saved studios':' to saved studios')} onClick={onToggle}><Bookmark size={18} aria-hidden="true" fill={saved?'currentColor':'none'}/></button>;
}

export function ProviderCard({p,mine,saved,onOpen,onSave,preview=false}:{p:Provider;mine?:boolean;saved?:boolean;onOpen:()=>void;onSave?:()=>void;preview?:boolean}){
 const cover=coverPhoto(p),from=startingPrice(p);
 return <article className={'ws-card'+(preview?' ws-card-preview':'')}>
  <div className={'ws-card-cover'+(cover?'':' ws-cover-plain')}>
   {cover?<img src={media(cover)} alt=""/>:<span className="ws-cover-word" aria-hidden="true">{initials(p.name)}</span>}
   <span className={'ws-pill '+(p.accepting?'ws-pill-open':'ws-pill-paused')}>{p.accepting?'Taking requests':'Paused'}</span>
   {onSave&&!mine&&<SaveButton saved={!!saved} name={p.name} onToggle={onSave}/>}
  </div>
  <div className="ws-card-body">
   <div className="ws-card-id"><StudioMark p={p}/><div><h3>{p.name||'Your studio name'}</h3><p className="ws-meta"><MapPin size={14} aria-hidden="true"/>{place(p)||'Location'}{typeof p.distanceMiles==='number'&&<span className="ws-distance">· ~{p.distanceMiles} mi</span>}</p></div></div>
   <RatingLine p={p}/>
   {p.services.length>0&&<ul className="ws-tags" aria-label="Services">{p.services.map(s=><li key={s}>{serviceName(s)}</li>)}</ul>}
   <div className="ws-card-foot">
    <p className="ws-price">{from!==null?<>From <b>{usd(from)}</b>/book</>:'Quote on request'}</p>
    {mine&&!preview&&<span className="ws-own">Your studio</span>}
    <button type="button" className="peek-inside" onClick={onOpen} aria-label={'Peek inside '+(p.name||'this studio')+': see the full studio page'} tabIndex={preview?-1:undefined}>Peek inside <ArrowRight size={14} aria-hidden="true"/></button>
   </div>
  </div>
 </article>;
}
