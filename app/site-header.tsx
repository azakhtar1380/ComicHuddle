'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {BookOpen,Camera,ChevronDown,Clock3,Home,Lock,MessageCircle,ScanLine,ShieldCheck,ShoppingBag,User,Users,Wallet,Wrench} from 'lucide-react';
import MobileDock from './mobile-dock';
import HeaderSearch from './header-search';
import {publicSection} from '../lib/section-navigation';
import './site-header.css';

type Props={section?:string;name?:string;signedIn?:boolean;sessionKnown?:boolean;scanOpen?:boolean;drawerOpen?:boolean;messageCount?:number;onNavigate?:(section:string)=>void;onScan?:()=>void;onMessages?:()=>void;onAccount?:()=>void;standalone?:boolean};
const entries=[{id:'Home',label:'Home',Icon:Home},{id:'Marketplace',label:'Shop',Icon:ShoppingBag},{id:'Directory',label:'Comic Directory',Icon:BookOpen},{id:'Characters',label:'Characters',Icon:Users},{id:'Pressing',label:'Comic Workshop',Icon:Wrench},{id:'Wallet',label:'Wallet & Rewards',Icon:Wallet},{id:'Collectors',label:'My Collection',Icon:User}];
const destination=(section:string)=>section==='Home'?'/':section==='Wallet'?'/wallet':section==='Characters'?'/characters':'/?'+new URLSearchParams({section:publicSection(section)});

/** One professional storefront header shared by every page. */
export default function SiteHeader({section='Home',name='Collector',signedIn=false,sessionKnown=false,scanOpen=false,drawerOpen=false,messageCount=0,onNavigate,onScan,onMessages,onAccount,standalone=false}:Props){
 const [session,setSession]=useState({signedIn:false,name:'Collector'});
 useEffect(()=>{
  if(sessionKnown)return;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  void fetch('/api/account-summary',{credentials:'same-origin',cache:'no-store',signal:controller.signal}).then(async response=>response.ok?response.json():null).then(value=>{if(!controller.signal.aborted&&value&&typeof value.signedIn==='boolean')setSession({signedIn:value.signedIn,name:typeof value.name==='string'?value.name:'Collector'})}).catch(()=>undefined).finally(()=>clearTimeout(timer));
  return()=>{clearTimeout(timer);controller.abort()};
 },[sessionKnown]);
 const authenticated=sessionKnown?signedIn:session.signedIn,displayName=sessionKnown?name:session.name;
 const navigate=(next:string)=>{if(onNavigate)onNavigate(next);else window.location.assign(destination(next))};
 const brand=<img className="brand-artwork" src="/brand/comichuddle-hero-logo-compact.svg" width="1254" height="1010" alt="ComicHuddle" decoding="async"/>;
 const scan=onScan?<button type="button" className="ch-scan-button" aria-label="Scan a comic" aria-haspopup="dialog" aria-expanded={scanOpen} onClick={onScan}><ScanLine size={18}/><span>Scan</span></button>:<Link href="/?section=Scan" className="ch-scan-button" aria-label="Scan a comic"><ScanLine size={18}/><span>Scan</span></Link>;
 return <>
  {process.env.NEXT_PUBLIC_QA_ENV==='true'&&<div className="ch-qa-strip">QA SANDBOX · TEST DATA ONLY</div>}
  <div className="ch-utility" role="note"><div className="ch-wrap"><span><Lock size={13}/> Secure checkout powered by Stripe</span><span><Camera size={13}/> Scan any barcode to identify a comic</span><span><ShieldCheck size={13}/> Free collector profiles</span></div></div>
  <header className="site-header ch-header">
   <div className="ch-wrap ch-header-row">
    {onNavigate?<button type="button" className="brand" onClick={()=>navigate('Home')} aria-label="ComicHuddle home">{brand}</button>:<Link href="/" className="brand" aria-label="ComicHuddle home">{brand}</Link>}
    <HeaderSearch/>
    <div className="ch-actions">
     {scan}
     {onMessages?<button type="button" className="header-inbox ch-icon" aria-label="Open messages" onClick={onMessages}><MessageCircle size={20}/>{messageCount>0&&<span>{messageCount}</span>}</button>:<Link className="header-inbox ch-icon" href="/?section=Messages" aria-label="Open messages"><MessageCircle size={20}/></Link>}
     {authenticated
      ?(onAccount?<button type="button" className="account-button" aria-label="Open account menu" aria-expanded={drawerOpen} onClick={onAccount}><span className="avatar">{displayName.slice(0,1).toUpperCase()}</span><span className="ch-account-label"><small>Hello, {displayName.split(' ')[0]}</small>Account</span><ChevronDown size={15}/></button>:<Link className="account-button" href="/?section=Account" aria-label="Open account menu"><span className="avatar">{displayName.slice(0,1).toUpperCase()}</span><span className="ch-account-label"><small>Hello, {displayName.split(' ')[0]}</small>Account</span><ChevronDown size={15}/></Link>)
      :<><Link className="header-signin" href="/sign-in" prefetch><User size={18}/><span>Sign in</span></Link><Link className="header-signup" href="/sign-in?mode=register" prefetch>Join free</Link></>}
    </div>
   </div>
   <nav className="ch-nav" aria-label="Main navigation"><div className="ch-wrap">
    {entries.map(({id,label,Icon})=>{const active=section===id||(id==='Collectors'&&section==='My Profile'),className='site-nav-item'+(active?' nav-active':'');return onNavigate&&id!=='Wallet'&&id!=='Characters'?<button type="button" key={id} className={className} aria-current={active?'page':undefined} onClick={()=>navigate(id)}><Icon size={16}/><span>{label}</span></button>:<Link key={id} href={destination(id)} className={className} aria-current={active?'page':undefined}><Icon size={16}/><span>{label}</span></Link>})}
    <Link href="/upcoming" className={'site-nav-item'+(section==='Upcoming'?' nav-active':'')} aria-current={section==='Upcoming'?'page':undefined}><Clock3 size={16}/><span>Coming Soon</span></Link>
   </div></nav>
  </header>
  {standalone&&<MobileDock tab={section} scanOpen={false} onNavigate={navigate} onScan={()=>window.location.assign('/?section=Scan')}/>}
 </>;
}
