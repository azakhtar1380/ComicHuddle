'use client';
// Product card buttons: Buy (or Bid on an auction) as the main button, then Add to cart, Trade, Make offer
// and Add to collection in a compact row. On phones (≤760px) the compact row folds behind a "⋯" button.
// Only what the listing allows is shown: auctions take bids only (the server rejects offers and trades on
// auctions), the seller sees no buy buttons on their own listing, and examples / closed listings show none.
// Cards either hand the action to the marketplace (onAction) or link to it (hrefs, e.g. from Home).
import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {Gavel,HandCoins,Ellipsis,Plus,Repeat2,ShoppingBag} from 'lucide-react';
import type {Listing} from '../../lib/community';
import AddToCartButton from '../cart/add-to-cart-button';
import {collectHref} from './collect-intent';
import './card-actions.css';

export type ListingCardAction='buy'|'bid'|'offer'|'trade'|'collect';
type Caps={buy:boolean;bid:boolean;offer:boolean;trade:boolean;cart:boolean};

/** What a viewer may do with a listing from a card. Mirrors the listing detail and the server checks. */
export function listingCaps(listing:Pick<Listing,'status'|'saleType'|'sellerId'|'example'>,viewerId?:string|null):Caps{
 const open=listing.status==='active'&&!listing.example&&(!viewerId||listing.sellerId!==viewerId),fixed=listing.saleType==='fixed';
 return {buy:open&&fixed,bid:open&&!fixed,offer:open&&fixed,trade:open&&fixed,cart:open&&fixed};
}
/** Marketplace deep link that opens a listing with one of its flows ready (guests see the sign-in prompt there). */
export function listingActionHref(listingId:string,action:Exclude<ListingCardAction,'collect'>){
 const params=new URLSearchParams({section:'Marketplace',listing:listingId});
 if(action==='buy')params.set('checkout','1');else params.set('intent',action);
 return '/?'+params;
}

type Props={listing:Listing;viewerId?:string|null;/** Directory issue this copy points at; enables "Add to collection". */issueId:number|null;
 /** In-app handler. Without it the buttons are links into the marketplace. */onAction?:(action:ListingCardAction)=>void};

export default function ListingCardActions({listing,viewerId,issueId,onAction}:Props){
 const caps=listingCaps(listing,viewerId),[open,setOpen]=useState(false),menuId=useId(),root=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!open)return;
  const away=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false)};
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);root.current?.querySelector<HTMLElement>('.cc-toggle')?.focus()}};
  document.addEventListener('pointerdown',away);document.addEventListener('keydown',key);
  return()=>{document.removeEventListener('pointerdown',away);document.removeEventListener('keydown',key)}},[open]);
 const collect=issueId!==null&&!listing.example;
 const primary:ListingCardAction|null=caps.buy?'buy':caps.bid?'bid':null;
 const extras:{action:ListingCardAction;label:string;icon:ReactNode}[]=[
  ...(caps.trade?[{action:'trade' as const,label:'Trade',icon:<Repeat2 size={16} aria-hidden="true"/>}]:[]),
  ...(caps.offer?[{action:'offer' as const,label:'Make offer',icon:<HandCoins size={16} aria-hidden="true"/>}]:[]),
  ...(collect?[{action:'collect' as const,label:'Add to collection',icon:<Plus size={16} aria-hidden="true"/>}]:[]),
 ];
 if(!primary&&!extras.length)return null;
 const name=listing.title;
 const control=(action:ListingCardAction,className:string,body:ReactNode,label:string)=>{
  const aria=label+': '+name;
  if(onAction)return <button type="button" className={className} aria-label={aria} onClick={()=>{setOpen(false);onAction(action)}}>{body}</button>;
  const href=action==='collect'?collectHref(issueId!):listingActionHref(listing.id,action);
  return <a className={className} href={href} aria-label={aria}>{body}</a>;
 };
 const hasMore=extras.length>0||caps.cart;
 return <div className="cc-actions" ref={root}>
  <div className="cc-main">
   {primary==='buy'&&control('buy','ds-btn ds-btn-primary ds-btn-sm cc-primary',<><ShoppingBag size={16} aria-hidden="true"/> Buy</>,listing.kind==='collection'?'Buy the set':'Buy')}
   {primary==='bid'&&control('bid','ds-btn ds-btn-primary ds-btn-sm cc-primary',<><Gavel size={16} aria-hidden="true"/> Bid</>,'Place a bid')}
   {hasMore&&<button type="button" className="ds-btn ds-btn-secondary ds-btn-sm cc-toggle" aria-expanded={open} aria-controls={menuId} aria-label={'More actions for '+name} onClick={()=>setOpen(value=>!value)}><Ellipsis size={18} aria-hidden="true"/></button>}
  </div>
  {hasMore&&<div id={menuId} className={'cc-more'+(open?' open':'')} role="group" aria-label={'More actions for '+name}>
   {caps.cart&&<span className="cc-cart"><AddToCartButton listingId={listing.id} compact/></span>}
   {extras.map(item=><span key={item.action} className="cc-item">{control(item.action,'ds-btn ds-btn-secondary ds-btn-sm cc-secondary',<>{item.icon} {item.label}</>,item.label)}</span>)}
  </div>}
 </div>;
}
