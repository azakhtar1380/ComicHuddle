'use client';
// Comic Workshop landing + directory: what the Workshop is, search and filters, real-data rails
// (saved, recently viewed, top rated, near you, new) and a short service guide.
import {useMemo,type ReactNode} from 'react';
import {ArrowRight,ClipboardCheck,Droplets,Layers,MessageCircle,Search,ShieldCheck,Sparkles,Wrench,X} from 'lucide-react';
import LocationRadiusFilter from '../../app/location-radius-filter';
import {careServiceGuide,careServices,filterWorkshopProviders,recentlyAddedProviders,serviceCounts,sortWorkshopProviders,topRatedProviders,workshopAreaOptions,workshopLocation,type CareService,type Provider,type WorkshopSort} from '../../lib/pressing';
import {EmptyState} from '../states';
import {ProviderCard,serviceName} from './ui';
import type {WorkshopMemory} from './use-workshop-memory';

export type DirectoryFilters={query:string;service:CareService|'all';accepting:boolean;location:string;radius:string;state:string;sort:WorkshopSort};
export const defaultFilters:DirectoryFilters={query:'',service:'all',accepting:false,location:'',radius:'nationwide',state:'',sort:'recommended'};
export const hasActiveFilters=(f:DirectoryFilters)=>Boolean(f.query.trim()||f.service!=='all'||f.accepting||f.location||f.state);

const serviceIcon:Record<CareService,typeof Layers>={pressing:Layers,dry_cleaning:Droplets,assessment:ClipboardCheck,cgc:ShieldCheck};

function Rail({id,title,note,action,children}:{id:string;title:string;note?:string;action?:ReactNode;children:ReactNode}){
 return <section className="ws-rail" aria-labelledby={id}><div className="ws-rail-head"><div><h2 id={id} className="ws-rail-title">{title}</h2>{note&&<p className="ws-help">{note}</p>}</div>{action}</div>{children}</section>;
}

export default function WorkshopDiscover({providers,hasMore,refreshing,filters,setFilters,memory,meId,meLocation,hasStudio,onOpen,onRegister}:{providers:Provider[];hasMore?:boolean;refreshing:boolean;filters:DirectoryFilters;setFilters:(next:Partial<DirectoryFilters>)=>void;memory:WorkshopMemory;meId?:string;meLocation?:string;hasStudio:boolean;onOpen:(id:string)=>void;onRegister:()=>void}){
 const active=hasActiveFilters(filters);
 const results=useMemo(()=>sortWorkshopProviders(filterWorkshopProviders(providers,{query:filters.query,service:filters.service,accepting:filters.accepting,state:filters.state}),filters.sort==='distance'&&!filters.location?'recommended':filters.sort),[providers,filters]);
 const areas=useMemo(()=>workshopAreaOptions(providers),[providers]);
 const counts=useMemo(()=>new Map(serviceCounts(providers).map(s=>[s.id,s.count])),[providers]);
 const byId=useMemo(()=>new Map(providers.map(p=>[p.id,p])),[providers]);
 const pick=(ids:string[])=>ids.map(id=>byId.get(id)).filter((p):p is Provider=>!!p);
 const saved=pick(memory.saved),recent=pick(memory.recent).slice(0,4);
 const many=providers.length>6;
 const top=many?topRatedProviders(providers,3):[],fresh=many?recentlyAddedProviders(providers):[];
 const home=meLocation?workshopLocation(meLocation):null;
 const nearby=home?.state&&!filters.location&&many?providers.filter(p=>workshopLocation(p.location).state===home.state).slice(0,3):[];
 const card=(p:Provider)=><ProviderCard key={p.id} p={p} mine={p.profileId===meId} saved={memory.isSaved(p.id)} onSave={()=>memory.toggleSaved(p.id)} onOpen={()=>onOpen(p.id)}/>;
 const toResults=()=>requestAnimationFrame(()=>document.getElementById('ws-results')?.scrollIntoView({behavior:'smooth',block:'start'}));
 const chips:{label:string;clear:Partial<DirectoryFilters>}[]=[
  ...(filters.query.trim()?[{label:'“'+filters.query.trim()+'”',clear:{query:''}}]:[]),
  ...(filters.service!=='all'?[{label:serviceName(filters.service),clear:{service:'all' as const}}]:[]),
  ...(filters.state?[{label:areas.states.find(s=>s.value===filters.state)?.label||filters.state,clear:{state:''}}]:[]),
  ...(filters.location?[{label:'Near '+filters.location+(filters.radius!=='nationwide'?' · '+filters.radius+' mi':''),clear:{location:'',radius:'nationwide'}}]:[]),
  ...(filters.accepting?[{label:'Taking requests',clear:{accepting:false}}]:[])];

 return <div className="ws-discover">
  <ul className="ws-promise" aria-label="Why use Comic Workshop">
   <li><Wrench size={20} aria-hidden="true"/><span><b>Independent studios</b>Pressing, cleaning and CGC prep from pros who list their own work and terms.</span></li>
   <li><MessageCircle size={20} aria-hidden="true"/><span><b>Free quotes, your call</b>Ask in one form. Nothing ships until you accept a price.</span></li>
   <li><ShieldCheck size={20} aria-hidden="true"/><span><b>Tracked start to finish</b>Every step, photo and tracking number in one private record.</span></li>
  </ul>

  <section className="ws-finder" aria-label="Search studios">
   <div className="ws-search-field ws-search-main"><Search size={20} aria-hidden="true"/><input type="search" aria-label="Search studios by name, specialty or town" value={filters.query} maxLength={100} onChange={e=>setFilters({query:e.target.value})} placeholder="Search studios, specialties or towns"/>{filters.query&&<button type="button" className="ws-search-clear" aria-label="Clear search" onClick={()=>setFilters({query:''})}><X size={16}/></button>}</div>
   <div className="ws-filter-bar">
    <label className="ws-select"><span className="ws-sr">Service</span><select aria-label="Filter by care service" value={filters.service} onChange={e=>setFilters({service:e.target.value as CareService|'all'})}><option value="all">All services</option>{careServices.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    {areas.states.length>1&&<label className="ws-select"><span className="ws-sr">State</span><select aria-label="Filter by state" value={filters.state} onChange={e=>setFilters({state:e.target.value})}><option value="">All states</option>{areas.states.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}</select></label>}
    <label className="ws-select"><span className="ws-sr">Sort</span><select aria-label="Sort studios" value={filters.sort} onChange={e=>setFilters({sort:e.target.value as WorkshopSort})}><option value="recommended">Recommended</option><option value="rating">Best rated</option>{filters.location&&<option value="distance">Nearest</option>}<option value="newest">Newest</option><option value="name">Name A–Z</option></select></label>
    <label className="ws-toggle"><input type="checkbox" checked={filters.accepting} onChange={e=>setFilters({accepting:e.target.checked})}/><span>Taking requests</span></label>
   </div>
   <details className="ws-near" open={!!filters.location}>
    <summary>Near a city or ZIP{filters.location?': '+filters.location:''}</summary>
    <LocationRadiusFilter location={filters.location} radius={filters.radius} onChange={(location,radius)=>setFilters({location,radius,sort:location?'distance':filters.sort==='distance'?'recommended':filters.sort})}/>
   </details>
   {chips.length>0&&<div className="ws-chip-row" aria-label="Active filters">{chips.map(c=><button key={c.label} type="button" className="ws-chip on" onClick={()=>setFilters(c.clear)} aria-label={'Remove filter '+c.label}>{c.label}<X size={14} aria-hidden="true"/></button>)}<button type="button" className="ds-link" onClick={()=>setFilters(defaultFilters)}>Clear all</button></div>}
  </section>

  {!active&&<>
   {saved.length>0&&<Rail id="ws-saved" title="Saved studios" note="Only you can see these."><div className="ws-grid">{saved.map(card)}</div></Rail>}
   {recent.length>0&&<Rail id="ws-recent" title="Recently viewed" action={<button type="button" className="ds-link" onClick={memory.clearRecent}>Clear</button>}><div className="ws-grid">{recent.map(card)}</div></Rail>}
   {top.length>0&&<Rail id="ws-top" title="Top rated" note="Ranked by verified customer reviews (3 or more). Nobody can pay to rank higher."><div className="ws-grid">{top.map(card)}</div></Rail>}
   {nearby.length>0&&<Rail id="ws-nearby" title={'In '+home!.stateName} note="Based on the location in your profile."><div className="ws-grid">{nearby.map(card)}</div></Rail>}
   {fresh.length>0&&<Rail id="ws-new" title="New to the Workshop"><div className="ws-grid">{fresh.map(card)}</div></Rail>}
   <Rail id="ws-services" title="Browse by service">
    <ul className="ws-service-tiles">{careServiceGuide.map(g=>{const Icon=serviceIcon[g.id],n=counts.get(g.id)||0;return <li key={g.id}><button type="button" onClick={()=>{setFilters({service:g.id});toResults()}}><Icon size={22} aria-hidden="true"/><b>{serviceName(g.id)}</b><span>{g.short}</span><small>{n?n+' '+(n===1?'studio':'studios'):'No studios yet'} <ArrowRight size={14} aria-hidden="true"/></small></button></li>})}</ul>
   </Rail>
  </>}

  <section id="ws-results" className="ws-rail ws-results" aria-labelledby="ws-results-title">
   <div className="ws-rail-head"><h2 id="ws-results-title" className="ws-rail-title">{active?'Results':'All studios'}</h2><p className="ws-count" role="status">{refreshing?'Updating…':results.length+' '+(results.length===1?'studio':'studios')}{hasMore?' · showing the first 200, narrow your area to see more':''}</p></div>
   {results.length?<div className="ws-grid">{results.map(card)}</div>
   :providers.length?<EmptyState compact title="No studios match" message="Try another service, a wider distance or fewer filters." action={{label:'Clear filters',onClick:()=>setFilters(defaultFilters)}}/>
   :<EmptyState title="The first studios are setting up" message={filters.location?'No studios listed in this area yet. Try nationwide.':'No studios are listed yet. Check back soon, or list yours.'} action={filters.location?{label:'Search nationwide',onClick:()=>setFilters({location:'',radius:'nationwide'})}:{label:hasStudio?'Manage my studio':'List your studio',onClick:onRegister}}/>}
  </section>

  <section className="ws-guide" aria-labelledby="ws-guide-title">
   <div className="ws-rail-head"><div><h2 id="ws-guide-title" className="ws-rail-title">Know what to ask for</h2><p className="ws-help">A quick guide to each service, and what to tell the studio.</p></div></div>
   <div className="ws-guide-list">{careServiceGuide.map(g=>{const Icon=serviceIcon[g.id];return <details key={g.id}><summary><Icon size={20} aria-hidden="true"/><span><b>{serviceName(g.id)}</b><small>{g.short}</small></span></summary><div className="ws-guide-body"><p><b>What it is.</b> {g.what}</p><p><b>Why you’d want it.</b> {g.why}</p><p><b>Tell the studio:</b></p><ul>{g.tell.map(t=><li key={t}>{t}</li>)}</ul><button type="button" className="ds-link" onClick={()=>{setFilters({service:g.id});toResults()}}>See studios offering {serviceName(g.id).toLowerCase()} <ArrowRight size={14} aria-hidden="true"/></button></div></details>})}</div>
  </section>

  {!hasStudio&&<section className="ws-pro-band" aria-labelledby="ws-pro-title"><Sparkles size={22} aria-hidden="true"/><div><h2 id="ws-pro-title">Press, clean or prep books?</h2><p>List your studio free in a few minutes. Collectors find you, ask for quotes and message you here.</p></div><button type="button" className="ds-btn ds-btn-yellow" onClick={onRegister}>List your studio <ArrowRight size={16} aria-hidden="true"/></button></section>}
 </div>;
}
