'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {BookOpen,Camera,ChevronDown,Home,MessageCircle,ShoppingBag,User,Wallet,Wrench} from 'lucide-react';
import MobileDock from './mobile-dock';
import {publicSection} from '../lib/section-navigation';
import './site-header.css';

type Props={section?:string;name?:string;signedIn?:boolean;sessionKnown?:boolean;scanOpen?:boolean;drawerOpen?:boolean;messageCount?:number;onNavigate?:(section:string)=>void;onScan?:()=>void;onMessages?:()=>void;onAccount?:()=>void;standalone?:boolean};
const entries=[{id:'Home',label:'Home',Icon:Home},{id:'Directory',label:'Directory',Icon:BookOpen},{id:'Marketplace',label:'Marketplace',Icon:ShoppingBag},{id:'Pressing',label:'Comic Workshop',Icon:Wrench},{id:'Wallet',label:'My Wallet',Icon:Wallet},{id:'Collectors',label:'My Profile',Icon:User}];
const destination=(section:string)=>section==='Home'?'/':section==='Wallet'?'/wallet':'/?'+new URLSearchParams({section:publicSection(section)});

/** Home and the information pages share the same markup, labels and typography. */
export default function SiteHeader({section='Home',name='Collector',signedIn=false,sessionKnown=false,scanOpen=false,drawerOpen=false,messageCount=0,onNavigate,onScan,onMessages,onAccount,standalone=false}:Props){
 const [session,setSession]=useState({signedIn:false,name:'Collector'});
 useEffect(()=>{
  if(sessionKnown)return;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  void fetch('/api/account-summary',{credentials:'same-origin',cache:'no-store',signal:controller.signal}).then(async response=>response.ok?response.json():null).then(value=>{if(!controller.signal.aborted&&value&&typeof value.signedIn==='boolean')setSession({signedIn:value.signedIn,name:typeof value.name==='string'?value.name:'Collector'})}).catch(()=>undefined).finally(()=>clearTimeout(timer));
  return()=>{clearTimeout(timer);controller.abort()};
 },[sessionKnown]);
 const authenticated=sessionKnown?signedIn:session.signedIn,displayName=sessionKnown?name:session.name;
 const navigate=(next:string)=>{if(onNavigate)onNavigate(next);else window.location.assign(destination(next))};
 return <>
  <div className="preview-strip"><span>PUBLIC PREVIEW</span><span>Comic directory · Collect, buy &amp; care · Preview</span></div>
  <header className="site-header">
   {onNavigate?<button type="button" className="brand" onClick={()=>navigate('Home')} aria-label="ComicHuddle home"><img className="brand-artwork" src="/brand/comichuddle-hero-logo-compact.svg" width="1254" height="1010" alt="ComicHuddle" decoding="async"/></button>:<Link href="/" className="brand" aria-label="ComicHuddle home"><img className="brand-artwork" src="/brand/comichuddle-hero-logo-compact.svg" width="1254" height="1010" alt="ComicHuddle" decoding="async"/></Link>}
   <nav aria-label="Main navigation">
    {entries.map(({id,label,Icon})=>{const active=section===id,className='site-nav-item'+(active?' nav-active':'')+(id==='Wallet'?' nav-wallet':'');return onNavigate&&id!=='Wallet'?<button type="button" key={id} className={className} aria-current={active?'page':undefined} onClick={()=>navigate(id)}><Icon size={16}/><span>{label}</span></button>:<Link key={id} href={destination(id)} className={className} aria-current={active?'page':undefined}><Icon size={16}/><span>{label}</span></Link>})}
    {onScan?<button type="button" className="header-scan nav-scan" aria-label="Scan / Lens" aria-haspopup="dialog" aria-expanded={scanOpen} onClick={onScan}><Camera size={22}/><span>Scan / Lens</span></button>:<Link href="/?section=Scan" className="header-scan nav-scan" aria-label="Scan / Lens"><Camera size={22}/><span>Scan / Lens</span></Link>}
   </nav>
   {!authenticated&&<Link className="header-signin" href="/sign-in" prefetch><User size={16}/> Sign in</Link>}
   {onMessages?<button type="button" className="header-inbox" aria-label="Open messages" onClick={onMessages}><MessageCircle size={20}/>{messageCount>0&&<span>{messageCount}</span>}</button>:<Link className="header-inbox" href="/?section=Messages" aria-label="Open messages"><MessageCircle size={20}/></Link>}
   {!authenticated&&<Link className="header-signup" href="/sign-in?mode=register" prefetch>Join free</Link>}
   {onAccount?<button type="button" className="account-button" aria-label="Open account drawer" aria-expanded={drawerOpen} onClick={onAccount}><span className="avatar">{displayName.slice(0,1).toUpperCase()}</span><ChevronDown size={15}/></button>:<Link className="account-button" href="/?section=Account" aria-label="Open account drawer"><span className="avatar">{displayName.slice(0,1).toUpperCase()}</span><ChevronDown size={15}/></Link>}
  </header>
  {standalone&&<MobileDock tab={section} scanOpen={false} onNavigate={navigate} onScan={()=>window.location.assign('/?section=Scan')}/>}
 </>;
}
