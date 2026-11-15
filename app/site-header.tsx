'use client';
// One header for every page. A solid ink band (like a store app): logo, search and your account on top,
// then a row of pill links. Phones put search on its own full-width row and scroll the pills sideways.
import Link from 'next/link';
import {useEffect,useState,type ComponentType} from 'react';
import {BookOpen,ChevronDown,Home,MessageCircle,ScanLine,ShieldCheck,ShoppingBag,UserRound,Users,Wrench} from 'lucide-react';
import MobileDock from './mobile-dock';
import HeaderSearch from './header-search';
import UserAvatar from '../components/user-avatar';
import {CartButton} from '../components/cart/cart-button';
import {NotificationBell} from '../components/notifications/bell';
import {publicSection} from '../lib/section-navigation';
import './site-header.css';

type Props={section?:string;name?:string;signedIn?:boolean;sessionKnown?:boolean;avatarUrl?:string|null;scanOpen?:boolean;drawerOpen?:boolean;messageCount?:number;onNavigate?:(section:string,tab?:string)=>void;onScan?:()=>void;onMessages?:()=>void;onAccount?:()=>void;standalone?:boolean};
type NavIcon=ComponentType<{size?:number;'aria-hidden'?:boolean}>;
/** The main destinations, shown as pills under the search bar. Everything personal is in the account panel. */
const entries:{id:string;label:string;Icon:NavIcon}[]=[
 {id:'Home',label:'Home',Icon:Home},
 {id:'Directory',label:'Directory',Icon:BookOpen},
 {id:'Characters',label:'Characters',Icon:Users},
 {id:'Marketplace',label:'Marketplace',Icon:ShoppingBag},
 {id:'Pressing',label:'Comic Workshop',Icon:Wrench},
 {id:'SafePurchase',label:'SafePurchase',Icon:ShieldCheck},
 {id:'About',label:'Meet Huddles',Icon:HuddlesHeadIcon},
];
function HuddlesHeadIcon(){return <img className="chx-huddles-head" src="/mascot/huddles-head.webp" alt="" width={20} height={20}/>}
const pageLinks:Record<string,string>={Home:'/',Wallet:'/wallet',Characters:'/characters',SafePurchase:'/safepurchase',About:'/about-huddles',Scan:'/?section=Scan'};
/** URL for a section, for pages outside the main app (and for real links). */
export function destination(section:string,tab?:string){
 if(pageLinks[section])return pageLinks[section];
 const params=new URLSearchParams({section:publicSection(section)});
 if(section==='Collection'&&tab)params.set('tab',tab);
 return '/?'+params;
}
/** Sections that are separate pages, not views inside the main app. */
export const isPageSection=(section:string)=>section in pageLinks&&section!=='Home'&&section!=='Scan';

export default function SiteHeader({section='Home',name='Collector',signedIn=false,sessionKnown=false,avatarUrl=null,scanOpen=false,drawerOpen=false,messageCount=0,onNavigate,onScan,onMessages,onAccount,standalone=false}:Props){
 const [session,setSession]=useState<{signedIn:boolean;name:string;avatarUrl:string|null}>({signedIn:false,name:'Collector',avatarUrl:null});
 useEffect(()=>{
  if(sessionKnown)return;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  void fetch('/api/account-summary',{credentials:'same-origin',cache:'no-store',signal:controller.signal}).then(async response=>response.ok?response.json():null).then(value=>{if(!controller.signal.aborted&&value&&typeof value.signedIn==='boolean')setSession({signedIn:value.signedIn,name:typeof value.name==='string'?value.name:'Collector',avatarUrl:typeof value.avatarUrl==='string'?value.avatarUrl:null})}).catch(()=>undefined).finally(()=>clearTimeout(timer));
  return()=>{clearTimeout(timer);controller.abort()};
 },[sessionKnown]);
 const authenticated=sessionKnown?signedIn:session.signedIn,displayName=sessionKnown?name:session.name,picture=sessionKnown?avatarUrl:session.avatarUrl;
 const navigate=(next:string,tab?:string)=>{if(onNavigate&&!isPageSection(next))onNavigate(next,tab);else window.location.assign(destination(next,tab))};
 const brand=<img className="chx-logo" src="/brand/comichuddle-logo-cutout.webp" width="297" height="240" alt="ComicHuddle" decoding="async"/>;
 const scan=onScan?<button type="button" className="chx-scan" aria-label="Scan a comic" aria-haspopup="dialog" aria-expanded={scanOpen} onClick={onScan}><ScanLine size={18}/><span>Scan</span></button>:<Link href="/?section=Scan" className="chx-scan" aria-label="Scan a comic"><ScanLine size={18}/><span>Scan</span></Link>;
 const badge=messageCount>0&&<span className="chx-badge">{messageCount>99?'99+':messageCount}</span>;
 const messages=onMessages?<button type="button" className="chx-icon" aria-label={'Messages'+(messageCount?` (${messageCount} unread)`:'')} onClick={onMessages}><MessageCircle size={22}/>{badge}<span className="chx-icon-label">Messages</span></button>:<Link className="chx-icon" href="/?section=Messages" aria-label="Messages"><MessageCircle size={22}/><span className="chx-icon-label">Messages</span></Link>;
 const account=<><UserAvatar name={displayName} src={picture} size={34}/><span className="chx-account-text"><small>Hi, {displayName.split(' ')[0]}</small>Account</span><ChevronDown size={16} className="chx-account-chev"/></>;
 return <>
  {process.env.NEXT_PUBLIC_QA_ENV==='true'&&<div className="ch-qa-strip">TEST SITE · TEST DATA ONLY</div>}
  <header className="chx">
   <div className="chx-wrap chx-top">
    {onNavigate?<button type="button" className="chx-brand" onClick={()=>navigate('Home')} aria-label="ComicHuddle home">{brand}</button>:<Link href="/" className="chx-brand" aria-label="ComicHuddle home">{brand}</Link>}
    <div className="chx-search chx-search-desktop"><HeaderSearch/></div>
    <div className="chx-actions">
     {scan}
     {messages}
     {authenticated&&<NotificationBell variant="header"/>}
     <CartButton variant="header"/>
     {authenticated
      ?(onAccount?<button type="button" className="chx-account" aria-label="Open your account" aria-haspopup="dialog" aria-expanded={drawerOpen} onClick={onAccount}>{account}</button>:<Link className="chx-account" href="/?section=Account" aria-label="Open your account">{account}</Link>)
      :<><Link className="chx-signin" href="/sign-in" prefetch><UserRound size={22}/><span>Sign in</span></Link><Link className="chx-join" href="/sign-in?mode=register" prefetch>Join free</Link></>}
    </div>
   </div>
   <div className="chx-wrap chx-search chx-search-mobile"><HeaderSearch/></div>
   <nav className="chx-pills" aria-label="Main navigation"><div className="chx-wrap chx-pill-row">
    {entries.map(({id,label,Icon})=>{const active=section===id,className='chx-pill'+(id==='Home'?' chx-pill-home':'')+(active?' is-on':'');const inner=<><Icon size={16} aria-hidden/><span>{label}</span></>;return onNavigate&&!isPageSection(id)?<button type="button" key={id} className={className} aria-current={active?'page':undefined} onClick={()=>navigate(id)}>{inner}</button>:<Link key={id} href={destination(id)} className={className} aria-current={active?'page':undefined}>{inner}</Link>})}
   </div></nav>
  </header>
  {standalone&&<MobileDock tab={section} scanOpen={false} onNavigate={navigate} onScan={()=>window.location.assign('/?section=Scan')}/>}
 </>;
}
