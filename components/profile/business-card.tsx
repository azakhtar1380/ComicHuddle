// Public shop block on a Business profile: logo, shop name + verified tick, city/state, website, policies.
// Shows only what the business entered; missing fields are hidden.
import {ArrowUpRight,MapPin,Store} from 'lucide-react';
import {VerifiedBadge} from '../verified-badge';
import type {BusinessSummary} from './business-client';
import './profile.css';

const host=(url:string)=>{try{return new URL(url).hostname.replace(/^www\./,'')}catch{return ''}};

export default function BusinessCard({summary,own=false}:{summary:BusinessSummary;own?:boolean}){
 const b=summary.business;if(!summary.isBusiness||!b)return null;
 const site=b.website&&/^https?:\/\//i.test(b.website)?b.website:'',where=[b.city,b.state].filter(Boolean).join(', ');
 return <section className="pf-shop ds-card" aria-labelledby="pf-shop-name">
  <div className="pf-shop-head">
   <span className="pf-logo pf-logo-lg" aria-hidden="true">{b.logoUrl?<img src={b.logoUrl+'&size=thumbnail'} alt="" width={72} height={72}/>:<Store size={30}/>}</span>
   <div>
    <p className="ds-eyebrow">{b.kind==='dealer'?'Comic dealer':'Comic shop'}</p>
    <h2 id="pf-shop-name" className="pf-shop-name">{b.shopName}{summary.verified&&<> <VerifiedBadge size={20} link/></>}</h2>
    <p className="pf-shop-meta">{where&&<span><MapPin size={15} aria-hidden="true"/> {where}</span>}{site&&<a className="ds-link" href={site} target="_blank" rel="noopener noreferrer nofollow ugc">{host(site)} <ArrowUpRight size={14} aria-hidden="true"/></a>}</p>
    {!summary.verified&&own&&<p className="pf-hint">Not verified yet. <a className="ds-link" href="/verified">How the verified tick works</a></p>}
   </div>
  </div>
  {(b.shippingPolicy||b.returnsPolicy)&&<dl className="pf-policies">
   {b.shippingPolicy&&<div><dt>Shipping</dt><dd>{b.shippingPolicy}</dd></div>}
   {b.returnsPolicy&&<div><dt>Returns</dt><dd>{b.returnsPolicy}</dd></div>}
  </dl>}
  <p className="pf-hint">Shop details come from what this business entered.{summary.verified?' The verified tick means a ComicHuddle admin checked this business.':''}</p>
 </section>;
}
