'use client';
// Settings: your name and showcase, the app, your data, and (for the owner) the studio tools.
import {Calculator,Check,Download,Layers,ShieldCheck,Smartphone,Sparkles,Trash2} from 'lucide-react';
import PageHeader from '../components/page-header';
import {EmptyState} from '../components/states';

type Props={signedIn:boolean;name:string;saving:boolean;isOwner:boolean;installed:boolean;exporting:boolean;
 onSaveName:(name:string)=>void;onEditShowcase:()=>void;onInstall:()=>void;onExportCollection:()=>void;onExportAccount:()=>void;onDelete:()=>void;onOwnerTool:(section:string)=>void};

export default function AccountSettings(p:Props){
 const header=<PageHeader eyebrow="Your account" title="Settings." lede="Your name, your showcase and your data." headingLevel={1}/>;
 if(!p.signedIn)return <section className="settings-page">{header}<EmptyState title="Sign in to change your settings." action={{label:'Sign in',href:'/sign-in?return_to=%2F%3Fsection%3DSettings'}}/></section>;
 return <section className="settings-page">
  {header}
  <div className="settings-grid">
   <section className="ds-card settings-block" aria-labelledby="settings-profile">
    <h2 id="settings-profile">Profile</h2>
    <form onSubmit={event=>{event.preventDefault();const value=String(new FormData(event.currentTarget).get('name')||'').trim();if(value)p.onSaveName(value)}}>
     <label className="ds-field"><span>Display name</span><input name="name" defaultValue={p.name} minLength={1} maxLength={80} required autoComplete="nickname"/><small>This is the name other collectors see.</small></label>
     <button className="ds-btn ds-btn-primary" disabled={p.saving}>Save name <Check size={16}/></button>
    </form>
    <button type="button" className="ds-btn ds-btn-secondary settings-wide" onClick={p.onEditShowcase}><Sparkles size={17}/> Edit my showcase</button>
   </section>
   <section className="ds-card settings-block" aria-labelledby="settings-app">
    <h2 id="settings-app">The app</h2>
    <p>Put ComicHuddle on your home screen. It uses the same account.</p>
    <button type="button" className="ds-btn ds-btn-secondary settings-wide" onClick={p.onInstall}><Smartphone size={17}/> {p.installed?'Home screen help':'Add to home screen'}</button>
   </section>
   <section className="ds-card settings-block" aria-labelledby="settings-data">
    <h2 id="settings-data">Your data</h2>
    <p>Download a copy any time. Keep the file private.</p>
    <button type="button" className="ds-btn ds-btn-secondary settings-wide" onClick={p.onExportCollection}><Download size={17}/> Export my collection</button>
    <button type="button" className="ds-btn ds-btn-secondary settings-wide" disabled={p.exporting} onClick={p.onExportAccount}><Download size={17}/> {p.exporting?'Preparing your file…':'Export all my account data'}</button>
    <hr/>
    <h3>Delete my data</h3>
    <p>This removes your collection, profile, photos and listings. It can&apos;t be undone.</p>
    <button type="button" className="ds-btn ds-btn-secondary settings-danger settings-wide" onClick={p.onDelete}><Trash2 size={17}/> Delete my ComicHuddle data</button>
   </section>
   {p.isOwner&&<section className="ds-card settings-block" aria-labelledby="settings-owner">
    <h2 id="settings-owner">Owner tools</h2>
    <button type="button" className="ds-btn ds-btn-secondary settings-wide" onClick={()=>p.onOwnerTool('Launch')}><Calculator size={17}/> Launch Studio</button>
    <button type="button" className="ds-btn ds-btn-secondary settings-wide" onClick={()=>p.onOwnerTool('Data')}><Layers size={17}/> Data Studio</button>
    <button type="button" className="ds-btn ds-btn-secondary settings-wide" onClick={()=>p.onOwnerTool('Trust')}><ShieldCheck size={17}/> Review reports</button>
    <button type="button" className="ds-btn ds-btn-secondary settings-wide" onClick={()=>p.onOwnerTool('Auctions')}><ShieldCheck size={17}/> Auctions</button>
   </section>}
  </div>
 </section>;
}
