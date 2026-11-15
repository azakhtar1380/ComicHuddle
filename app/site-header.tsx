'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {BookOpen,ChevronDown,MessageCircle,ScanLine,ShieldCheck,ShoppingBag,User,Users,Wrench} from 'lucide-react';
import MobileDock from './mobile-dock';
import HeaderSearch from './header-search';
import {publicSection} from '../lib/section-navigation';
import './site-header.css';

type Props={section?:string;name?:string;signedIn?:boolean;sessionKnown?:boolean;scanOpen?:boolean;drawerOpen?:boolean;messageCount?:number;onNavigate?:(section:string,tab?:string)=>void;onScan?:()=>void;onMessages?:()=>void;onAccount?:()=>void;standalone?:boolean};
/** Five main destinations. Everything personal lives in the account panel. */
const entries=[
 {id:'Directory',label:'Directory',Icon:BookOpen},
 {id:'Characters',label:'Characters',Icon:Users},
 {id:'Marketplace',label:'Marketplace',Icon:ShoppingBag},
 {id:'Pressing',label:'Workshop',Icon:Wrench},
 {id:'SafePurchase',label:'SafePurchase',Icon:ShieldCheck},
];
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

/** One storefront header shared by every page. */
export default function SiteHeader({section='Home',name='Collector',signedIn=false,sessionKnown=false,scanOpen=false,drawerOpen=false,messageCount=0,onNavigate,onScan,onMessages,onAccount,standalone=false}:Props){
 const [session,setSession]=useState({signedIn:false,name:'Collector'});
 useEffect(()=>{
  if(sessionKnown)return;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  void fetch('/api/account-summary',{credentials:'same-origin',cache:'no-store',signal:controller.signal}).then(async response=>response.ok?response.json():null).then(value=>{if(!controller.signal.aborted&&value&&typeof value.signedIn==='boolean')setSession({signedIn:value.signedIn,name:typeof value.name==='string'?value.name:'Collector'})}).catch(()=>undefined).finally(()=>clearTimeout(timer));
  return()=>{clearTimeout(timer);controller.abort()};
 },[sessionKnown]);
 const authenticated=sessionKnown?signedIn:session.signedIn,displayName=sessionKnown?name:session.name;
 const navigate=(next:string,tab?:string)=>{if(onNavigate&&!isPageSection(next))onNavigate(next,tab);else window.location.assign(destination(next,tab))};
 const brand=<img className="brand-artwork" src="/brand/comichuddle-logo-cutout.webp" width="297" height="240" alt="ComicHuddle" decoding="async"/>;
 const scan=onScan?<button type="button" className="ch-scan-button" aria-label="Scan a comic" aria-haspopup="dialog" aria-expanded={scanOpen} onClick={onScan}><ScanLine size={18}/><span>Scan</span></button>:<Link href="/?section=Scan" className="ch-scan-button" aria-label="Scan a comic"><ScanLine size={18}/><span>Scan</span></Link>;
 const avatar=<><span className="avatar">{displayName.slice(0,1).toUpperCase()}</span><span className="ch-account-label"><small>Hi, {displayName.split(' ')[0]}</small>Account</span><ChevronDown size={15}/></>;
 return <>
  {process.env.NEXT_PUBLIC_QA_ENV==='true'&&<div className="ch-qa-strip">TEST SITE · TEST DATA ONLY</div>}
  <header className="site-header ch-header">
   <div className="ch-wrap ch-header-row">
    {onNavigate?<button type="button" className="brand" onClick={()=>navigate('Home')} aria-label="ComicHuddle home">{brand}</button>:<Link href="/" className="brand" aria-label="ComicHuddle home">{brand}</Link>}
    <HeaderSearch/>
    <div className="ch-actions">
     {scan}
     {onMessages?<button type="button" className="header-inbox ch-icon" aria-label={'Messages'+(messageCount?` (${messageCount})`:'')} onClick={onMessages}><MessageCircle size={20}/>{messageCount>0&&<span>{messageCount>99?'99+':messageCount}</span>}</button>:<Link className="header-inbox ch-icon" href="/?section=Messages" aria-label="Messages"><MessageCircle size={20}/></Link>}
     {authenticated
      ?(onAccount?<button type="button" className="account-button" aria-label="Open account menu" aria-haspopup="dialog" aria-expanded={drawerOpen} onClick={onAccount}>{avatar}</button>:<Link className="account-button" href="/?section=Account" aria-label="Open account menu">{avatar}</Link>)
      :<><Link className="header-signin" href="/sign-in" prefetch><User size={18}/><span>Sign in</span></Link><Link className="header-signup" href="/sign-in?mode=register" prefetch>Join free</Link></>}
    </div>
   </div>
   <nav className="ch-nav" aria-label="Main navigation"><div className="ch-wrap">
    {entries.map(({id,label,Icon})=>{const active=section===id,className='site-nav-item'+(active?' nav-active':'');return onNavigate&&!isPageSection(id)?<button type="button" key={id} className={className} aria-current={active?'page':undefined} onClick={()=>navigate(id)}><Icon size={16}/><span>{label}</span></button>:<Link key={id} href={destination(id)} className={className} aria-current={active?'page':undefined}><Icon size={16}/><span>{label}</span></Link>})}
   </div></nav>
  </header>
  {standalone&&<MobileDock tab={section} scanOpen={false} onNavigate={navigate} onScan={()=>window.location.assign('/?section=Scan')}/>}
 </>;
}
