// Server-only admin page shell. adminPageUser() 404s for anyone who isn't an admin, so non-admins never
// learn these pages exist. Every admin API route checks admin again on its own.
import Link from 'next/link';
import type {ReactNode} from 'react';
import {notFound} from 'next/navigation';
import SiteHeader from '../site-header';
import SiteFooter from '../site-footer';
import AdminBadge from '../../components/admin-badge';
import {getChatGPTUser} from '../chatgpt-auth';
import {isAdmin,isFounder} from '../../lib/admin';
import '../../components/admin/admin.css';

export async function adminPageUser(){
  const user=await getChatGPTUser();
  if(!user||!isAdmin(user))notFound();
  return user;
}

const links=[{href:'/admin',label:'Overview'},{href:'/admin/safepurchase',label:'SafePurchase'},{href:'/admin/covers',label:'Cover photos'},{href:'/admin/audit',label:'Audit log'}];
export default function AdminShell({current,title,accent,lede,founder,children}:{current:string;title:string;accent?:string;lede?:string;founder:boolean;children:ReactNode}){
  return <div className="adm-page">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <SiteHeader section="Admin" standalone/>
    <main id="main-content" tabIndex={-1} className="ds-wrap adm-main">
      <h1 className="adm-title">{title}{accent&&<span>{accent}</span>}<AdminBadge founder={founder} size={22} showLabel/></h1>
      {lede&&<p className="adm-lede">{lede}</p>}
      <nav className="adm-nav" aria-label="Admin">{links.map(link=><Link key={link.href} href={link.href} aria-current={current===link.href?'page':undefined}>{link.label}</Link>)}</nav>
      {children}
    </main>
    <SiteFooter/>
  </div>;
}
export {isFounder};
