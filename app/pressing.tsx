'use client';
// Comic Workshop: discover studios → studio page → request a quote, plus "My requests" tracking and
// the studio desk (list a studio, answer and run requests). All data comes from /api/pressing.
// Contact goes through the one Messages system; saved/recently viewed studios live in this browser only.
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,ArrowUpRight,Check,Circle,Download,Eye,Flag,ImagePlus,Lock,MessageCircle,Package,Plus,RefreshCw,Search,ShieldCheck,Star,Truck,Wrench,X} from 'lucide-react';
import {Modal,ComicArt,uploadPhoto,useCollectorNetwork} from './network';
import {careClosed,careGuideFor,careNextStep,careProgress,careServices,careStatuses,careStages,canCareTransition,cgcLinks,emptyCare,studioCompleteness,type Provider,type CareReview,type CareJob,type CareEvent,type CareService,type CareData} from '../lib/pressing';
import type {Vault} from '../lib/vault';
import type {CollectorProfile} from '../lib/community';
import PageHeader from '../components/page-header';
import {EmptyState,ErrorState,HowItWorks,LoadingState} from '../components/states';
import WorkshopDiscover,{defaultFilters,type DirectoryFilters} from '../components/workshop/discover';
import StudioProfile,{type StudioDetail} from '../components/workshop/studio-profile';
import {ProviderCard,Stars,day,serviceName,usd} from '../components/workshop/ui';
import {useWorkshopMemory} from '../components/workshop/use-workshop-memory';
import './pressing.css';

export {ProviderCard,Stars};
const label=serviceName;
const amount=(f:FormData,key:string)=>Math.round(Number(f.get(key)||0)*100);
const rules=<a className="ws-rules" href="/?section=Rules" target="_blank" rel="noreferrer">rules</a>;
type Action={saved?:boolean;jobId?:string;threadId?:string};
type Props={tab:string;signedIn:boolean;net:ReturnType<typeof useCollectorNetwork>;vault:Vault;gate:()=>boolean;notice:(s:string)=>void;go:(s:string)=>void;openCollection:()=>void;onRegister:()=>void;onOpenThread:(id:string)=>Promise<void>;command:{id:number;view:string}};
type View='find'|'requests'|'studio';

/** Keeps ?provider=<id> in the address bar while a studio page is open, so it can be shared or reloaded. */
function syncStudioUrl(id:string|null,owned:{current:boolean}){
 try{
  const url=new URL(window.location.href);
  if(id){url.searchParams.set('provider',id);owned.current=true}
  else{if(!owned.current||!url.searchParams.has('provider'))return;url.searchParams.delete('provider');owned.current=false}
  window.history.replaceState(window.history.state,'',url.pathname+url.search);
 }catch{/* non-browser test harness */}
}

export default function PressRoom({tab,signedIn,net,vault,gate:parentGate,notice,openCollection,onRegister,onOpenThread,command}:Props){
 const [data,setData]=useState<CareData>(emptyCare),[ready,setReady]=useState(false),[error,setError]=useState(''),[refreshing,setRefreshing]=useState(false),[busy,setBusy]=useState(false);
 const [view,setView]=useState<View>('find'),[filters,setFilterState]=useState<DirectoryFilters>(defaultFilters);
 const [detail,setDetail]=useState<StudioDetail|null>(null),[quoteFor,setQuoteFor]=useState<Provider|null>(null),[editing,setEditing]=useState(false),[reviewFor,setReviewFor]=useState<Provider|null>(null),[job,setJob]=useState<{job:CareJob;events:CareEvent[]}|null>(null),[report,setReport]=useState<{type:string;id:string}|null>(null);
 const request=useRef(0),selection=useRef(0),active=useRef(false),deepLinked=useRef(false),visible=useRef(false),urlOwned=useRef(false);
 const me=net.data.me;
 const memory=useWorkshopMemory(me?.id);
 visible.current=tab==='Pressing';
 const {location,radius}=filters;
 const setFilters=useCallback((next:Partial<DirectoryFilters>)=>setFilterState(current=>({...current,...next})),[]);
 const refresh=useCallback(async()=>{
  if(!visible.current)return;const ticket=++request.current;setRefreshing(true);setError('');
  try{const r=await fetch('/api/pressing?'+new URLSearchParams({location:location.trim(),radius:location.trim()?radius:'nationwide'}),{cache:'no-store'}),d=await r.json() as CareData&{error?:string};if(!r.ok)throw Error(d.error||'Couldn’t load studios. Try again.');if(ticket===request.current){setData(d);setError('')}}
  catch(e){if(ticket===request.current)setError(e instanceof Error?e.message:'Couldn’t load studios. Try again.')}
  finally{if(ticket===request.current){setReady(true);setRefreshing(false)}}
 },[location,radius]);
 useEffect(()=>{const requests=request;const timer=tab==='Pressing'&&signedIn?setTimeout(()=>void refresh(),0):undefined;return()=>{clearTimeout(timer);requests.current++}},[tab,signedIn,me?.id,refresh]);
 useEffect(()=>{if(tab!=='Pressing')syncStudioUrl(null,urlOwned)},[tab]);
 useEffect(()=>{if(tab!=='Pressing'||!signedIn||!ready||deepLinked.current)return;const target=new URLSearchParams(window.location.search).get('provider');if(target){deepLinked.current=true;urlOwned.current=true;void openProvider(target)}},[tab,signedIn,ready]);
 // Header/account shortcuts ("My requests", "List your studio"…) arrive as a numbered command from the hub.
 const [seenCommand,setSeenCommand]=useState(command.id);
 if(command.id!==seenCommand){setSeenCommand(command.id);setDetail(null);setQuoteFor(null);setJob(null);setReviewFor(null);setReport(null);setEditing(command.view==='register');setView(command.view==='register'||command.view==='provider'||command.view==='studio'?'studio':command.view==='requests'?'requests':'find')}
 useEffect(()=>{if(command.id){selection.current++;syncStudioUrl(null,urlOwned)}},[command.id]);
 function closeAll(){selection.current++;setDetail(null);setQuoteFor(null);setJob(null);setReviewFor(null);setReport(null);syncStudioUrl(null,urlOwned)}
 function gate(){if(parentGate())return true;closeAll();return false}
 async function act(a:Record<string,unknown>):Promise<Action|null>{
  if(active.current)return null;active.current=true;setBusy(true);
  try{const r=await fetch('/api/pressing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(a)}),d=await r.json() as Action&{error?:string};if(!r.ok)throw Error(d.error||'Couldn’t save that. Try again.');await refresh();return d}
  catch(e){notice(e instanceof Error?e.message:'Couldn’t save that. Try again.');return null}
  finally{active.current=false;setBusy(false)}
 }
 async function openProvider(id:string){
  const ticket=++selection.current;
  try{const r=await fetch('/api/pressing?kind=provider&id='+encodeURIComponent(id)),d=await r.json() as StudioDetail&{error?:string};if(!r.ok)throw Error(d.error||'Couldn’t open this studio. Try again.');if(ticket===selection.current){setQuoteFor(null);setView('find');setDetail(d);if(d.provider.profileId!==me?.id)memory.markViewed(d.provider.id);syncStudioUrl(d.provider.id,urlOwned);window.scrollTo?.({top:0,behavior:'smooth'})}}
  catch(e){if(ticket===selection.current){notice(e instanceof Error?e.message:'Couldn’t open this studio. Try again.');syncStudioUrl(null,urlOwned)}}
 }
 async function openJob(id:string){
  const ticket=++selection.current;
  try{const r=await fetch('/api/pressing?kind=job&id='+encodeURIComponent(id)),d=await r.json() as {job:CareJob;events:CareEvent[];error?:string};if(!r.ok)throw Error(d.error||'Couldn’t open this request. Try again.');if(ticket===selection.current)setJob(d)}
  catch(e){if(ticket===selection.current)notice(e instanceof Error?e.message:'Couldn’t open this request. Try again.')}
 }
 function startQuote(p:Provider){if(!gate())return;setDetail(null);setQuoteFor(p);window.scrollTo?.({top:0,behavior:'smooth'})}
 function registerStudio(){if(!me){onRegister();return}if(!gate())return;closeAll();setView('studio');setEditing(true)}
 function browse(){if(!signedIn){gate();return}closeAll();setEditing(false);setView('find');requestAnimationFrame(()=>document.getElementById('ws-results')?.scrollIntoView({behavior:'smooth',block:'start'}))}
 function backToDirectory(){selection.current++;setDetail(null);syncStudioUrl(null,urlOwned)}

 const customerJobs=data.jobs.filter(j=>!j.isProvider),providerJobs=data.jobs.filter(j=>j.isProvider);
 const openCount=(jobs:CareJob[])=>jobs.filter(j=>!careClosed(j.status)).length;
 const findStep=quoteFor?'quote':detail?'profile':'directory';
 if(tab!=='Pressing')return null;

 return <div className="ws">
  <PageHeader eyebrow="Comic Workshop" title="Good books." accent="Careful hands." lede="Find trusted studios to press, clean and prep your comics for grading. Free quotes, tracked start to finish." pose="workshop" line="Ask for a quote before you ship anything."
   actions={<><button type="button" className="ds-btn ds-btn-primary" onClick={browse}><Search size={17} aria-hidden="true"/> Find a studio</button><button type="button" className="ds-link" onClick={registerStudio}>{data.mine?'Manage my studio':'List your studio, free'}</button></>}/>
  <nav className="ws-tabs" aria-label="Comic Workshop">{([['find','Discover',Search,0],['requests','My requests',Package,openCount(customerJobs)],['studio','My studio',Wrench,openCount(providerJobs)]] as const).map(([id,name,Icon,count])=><button key={id} type="button" aria-current={view===id?'page':undefined} className={view===id?'active':''} onClick={()=>{closeAll();setEditing(false);setView(id)}}><Icon size={17} aria-hidden="true"/>{name}{count>0&&<b aria-label={count+' open'}>{count}</b>}</button>)}</nav>

  {!signedIn&&<SignedOutIntro onJoin={()=>{gate()}}/>}
  {signedIn&&error&&<div className="ws-error"><ErrorState compact message={error} action={{label:refreshing?'Trying again…':'Retry',onClick:()=>void refresh()}}/></div>}
  {signedIn&&!ready&&!error&&<LoadingState message="Loading studios…"/>}

  {signedIn&&ready&&view==='find'&&<>
   {findStep==='directory'&&<WorkshopDiscover providers={data.providers} hasMore={data.hasMore} refreshing={refreshing} filters={filters} setFilters={setFilters} memory={memory} meId={me?.id} meLocation={me?.location} hasStudio={!!data.mine} onOpen={id=>void openProvider(id)} onRegister={registerStudio}/>}
   {findStep==='profile'&&detail&&<StudioProfile detail={detail} meId={me?.id} busy={busy} saved={memory.isSaved(detail.provider.id)} onToggleSave={()=>memory.toggleSaved(detail.provider.id)} notice={notice} onBack={backToDirectory} onQuote={()=>startQuote(detail.provider)} onEdit={registerStudio}
     onReview={()=>{if(gate())setReviewFor(detail.provider)}} onReport={(type,id)=>{if(gate())setReport({type,id})}}
     onDeleteReview={async id=>{if(await act({action:'delete_review',reviewId:id})){notice('Your review was removed.');await openProvider(detail.provider.id)}}}/>}
   {findStep==='quote'&&quoteFor&&<QuoteRequest provider={quoteFor} vault={vault} busy={busy} openCollection={()=>{setQuoteFor(null);openCollection()}} onBack={()=>void openProvider(quoteFor.id)}
     onSave={async fields=>{const r=await act({action:'request',providerId:quoteFor.id,...fields});if(r?.jobId){setQuoteFor(null);syncStudioUrl(null,urlOwned);setView('requests');await openJob(r.jobId);notice('Quote request sent. The studio will reply in Messages.')}}}/>}
  </>}

  {signedIn&&ready&&view==='requests'&&<section className="ws-panel" aria-labelledby="ws-requests-title">
   <div className="ws-section-head"><div><h2 id="ws-requests-title" className="ws-section-title">My requests</h2><p className="ws-help">Quotes you asked for and books out for care.</p></div><button type="button" className="ds-link" disabled={refreshing} onClick={()=>void refresh()}><RefreshCw size={15} aria-hidden="true"/> Refresh</button></div>
   {!me?<ProfileNeeded onCreate={()=>gate()}/>:customerJobs.length?<GroupedJobs jobs={customerJobs} onOpen={id=>void openJob(id)}/>
   :<EmptyState title="No requests yet" message="Find a studio and ask for a free quote. Every step will be tracked here." action={{label:'Find a studio',onClick:()=>setView('find')}}/>}
  </section>}

  {signedIn&&ready&&view==='studio'&&<section className="ws-panel" aria-labelledby="ws-studio-title">
   {!me?<><h2 id="ws-studio-title" className="ws-section-title">My studio</h2><ProfileNeeded onCreate={onRegister}/></>
   :editing||!data.mine?<>
     <div className="ws-section-head"><div><h2 id="ws-studio-title" className="ws-section-title">{data.mine?'Edit my studio':'List your studio'}</h2><p className="ws-help">{data.mine?'Changes show on your public page as soon as you save.':'Free. About five minutes. Only the basics are required; add the rest any time.'}</p></div>{data.mine&&<button type="button" className="ds-link" onClick={()=>setEditing(false)}><ArrowLeft size={15} aria-hidden="true"/> Back to my studio</button>}</div>
     {!editing&&!data.mine?<StudioPitch onStart={()=>setEditing(true)}/>
     :<ProviderForm provider={data.mine} me={me} busy={busy} notice={notice} onCancel={()=>setEditing(false)} onSave={async fields=>{if(await act({action:'provider',...fields})){setEditing(false);await net.refresh();notice('Your studio is saved.')}}}/>}
   </>:<StudioDesk studio={data.mine} jobs={providerJobs} refreshing={refreshing} onRefresh={()=>void refresh()} onOpenJob={id=>void openJob(id)} onView={()=>void openProvider(data.mine!.id)} onEdit={()=>setEditing(true)}/>}
  </section>}

  <div className="ws-footnote">
   <p><ShieldCheck size={17} aria-hidden="true"/>Studios are independent. You pay them directly, and pressing can’t guarantee a grade.</p>
   <HowItWorks title="How the Workshop works">
    <p>Studios are independent businesses. You agree on price, payment and shipping with them. ComicHuddle doesn’t charge you.</p>
    <p>“Recommended” puts studios taking requests first, then nearest (if you add a city), then best reviewed. Nobody can pay to rank higher.</p>
    <p>Only collectors who accepted a quote can leave a review. “Job finished” means the collector confirmed their comics came back.</p>
    <p>Pressing can’t promise a higher grade. Fragile books carry some risk. <a href={cgcLinks.pressing} target="_blank" rel="noreferrer">Read CGC’s pressing guide <ArrowUpRight size={14} aria-hidden="true"/></a></p>
    <p>Request updates come from you and the studio. No carrier or CGC checks them. See the {rules}.</p>
   </HowItWorks>
  </div>

  {reviewFor&&<Modal label={'Review '+reviewFor.name} onClose={()=>setReviewFor(null)}><ReviewForm provider={reviewFor} busy={busy} onSave={async fields=>{if(await act({action:'review',providerId:reviewFor.id,...fields})){const id=reviewFor.id;setReviewFor(null);await openProvider(id);notice('Thanks! Your review is up.')}}}/></Modal>}
  {job&&<Modal label="Care request" wide onClose={()=>{selection.current++;setJob(null)}}><JobDetail key={job.job.id+'-'+job.job.status+'-'+job.job.quoteRevision} data={job} busy={busy} notice={notice}
    onAction={async fields=>{if(await act({jobId:job.job.id,...fields})){await openJob(job.job.id);notice('Request updated.')}}}
    onMessage={async()=>{const id=job.job.threadId;closeAll();await onOpenThread(id)}}
    onReview={()=>{const p=data.providers.find(p=>p.id===job.job.providerId);if(p){setJob(null);setReviewFor(p)}else notice('This studio isn’t listed anymore.')}}/></Modal>}
  {report&&<Modal label="Report to ComicHuddle" onClose={()=>setReport(null)}><form className="form-dialog ws-form" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);if(await net.act({action:'report',targetType:report.type,targetId:report.id,reason:String(f.get('reason'))})){setReport(null);notice('Thanks. We’ll take a look.')}}}><h2>Report a problem</h2><label>What’s wrong?<textarea required name="reason" maxLength={500}/><small className="ws-help">Tell us what you saw. Our team will review it.</small></label><button className="ds-btn ds-btn-primary" disabled={net.busy}><Flag size={16} aria-hidden="true"/> Send report</button></form></Modal>}
 </div>;
}

function SignedOutIntro({onJoin}:{onJoin:()=>void}){
 return <section className="ws-guest" aria-labelledby="ws-guest-title">
  <h2 id="ws-guest-title" className="ws-section-title">How it works</h2>
  <ol className="ws-how-steps">
   <li><b>Find a studio</b><span>Search by service and distance. Read verified reviews and see before-and-after work.</span></li>
   <li><b>Ask for a free quote</b><span>Pick comics from your collection. The studio replies with a price and timeline.</span></li>
   <li><b>Track every step</b><span>Shipping, intake, care and return, with photos, in one private record.</span></li>
  </ol>
  <EmptyState compact title="Sign in to browse studios" message="It’s free. Search studios, read reviews and ask for quotes." action={{label:'Sign in or join free',onClick:onJoin}}/>
 </section>;
}

function ProfileNeeded({onCreate}:{onCreate:()=>void}){return <EmptyState title="Make your free profile first" message="You need one to ask for quotes or list a studio." action={{label:'Create my profile',onClick:onCreate}}/>}

function StudioPitch({onStart}:{onStart:()=>void}){
 return <div className="ws-pitch">
  <ul className="ws-how-steps">
   <li><b>Free to list</b><span>No listing fees. Collectors pay you directly on terms you set.</span></li>
   <li><b>Quotes come to you</b><span>Requests arrive with the exact comics and services, and open a conversation in Messages.</span></li>
   <li><b>Earn verified reviews</b><span>Only customers who accepted your quote can review you.</span></li>
  </ul>
  <div className="ws-actions"><button type="button" className="ds-btn ds-btn-primary" onClick={onStart}>Start my listing <ArrowRight size={16} aria-hidden="true"/></button><span className="ws-help">You can hide it or pause requests any time.</span></div>
 </div>;
}

function JobRow({j,onOpen}:{j:CareJob;onOpen:(id:string)=>void}){
 const progress=careProgress(j.status,j.sendToCgc),closed=careClosed(j.status),next=careNextStep(j);
 const yourMove=!closed&&/^(Send|Review|Ship|Drop|Confirm|Start|Return|Submit)/.test(next);
 return <li><button type="button" onClick={()=>onOpen(j.id)}>
  <div className="ws-job-main"><strong>{j.isProvider?j.requesterName:j.providerName}</strong><small>{j.books.length} {j.books.length===1?'comic':'comics'} · {j.services.map(label).join(', ')} · updated {day(j.updatedAt)}</small>
   {!closed&&<span className="ws-mini-progress" aria-label={'Step '+progress.step+' of '+progress.total}><i style={{width:progress.step/progress.total*100+'%'}}/></span>}
  </div>
  <div className="ws-job-state"><span className={'ws-status ws-status-'+j.status}>{careStatuses[j.status]||j.status}</span>{!closed&&<small className={yourMove?'ws-your-move':''}>{yourMove&&<Circle size={8} fill="currentColor" aria-hidden="true"/>}{next}</small>}</div>
  <ArrowRight size={18} aria-hidden="true"/>
 </button></li>;
}

function GroupedJobs({jobs,onOpen,needsReply=false}:{jobs:CareJob[];onOpen:(id:string)=>void;needsReply?:boolean}){
 const reply=needsReply?jobs.filter(j=>j.status==='requested'):[];
 const open=jobs.filter(j=>!careClosed(j.status)&&!reply.includes(j)),past=jobs.filter(j=>careClosed(j.status));
 return <div className="ws-job-groups">
  {reply.length>0&&<div><h3 className="ws-group-title">Needs your quote <b>{reply.length}</b></h3><ul className="ws-jobs">{reply.map(j=><JobRow key={j.id} j={j} onOpen={onOpen}/>)}</ul></div>}
  {open.length>0&&<div><h3 className="ws-group-title">In progress <b>{open.length}</b></h3><ul className="ws-jobs">{open.map(j=><JobRow key={j.id} j={j} onOpen={onOpen}/>)}</ul></div>}
  {past.length>0&&<details className="ws-past" open={!open.length&&!reply.length}><summary className="ws-group-title">Past requests <b>{past.length}</b></summary><ul className="ws-jobs">{past.map(j=><JobRow key={j.id} j={j} onOpen={onOpen}/>)}</ul></details>}
 </div>;
}

function StudioDesk({studio,jobs,refreshing,onRefresh,onOpenJob,onView,onEdit}:{studio:Provider;jobs:CareJob[];refreshing:boolean;onRefresh:()=>void;onOpenJob:(id:string)=>void;onView:()=>void;onEdit:()=>void}){
 const completeness=studioCompleteness(studio),todo=completeness.items.filter(i=>!i.done);
 const waiting=jobs.filter(j=>j.status==='requested').length,active=jobs.filter(j=>!careClosed(j.status)&&j.status!=='requested').length,done=jobs.filter(j=>j.status==='completed').length;
 return <>
  <div className="ws-section-head"><div><p className="ds-eyebrow">My studio</p><h2 id="ws-studio-title" className="ws-section-title">{studio.name}</h2></div><div className="ws-actions"><button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" onClick={onView}><Eye size={15} aria-hidden="true"/> View public page</button><button type="button" className="ds-btn ds-btn-dark ds-btn-sm" onClick={onEdit}><Wrench size={15} aria-hidden="true"/> Edit studio</button></div></div>
  <ul className="ws-desk-stats">
   <li><small>Listing</small><b>{studio.visible?'Visible':'Hidden'}</b><span>{studio.accepting?'Taking requests':'Requests paused'}</span></li>
   <li><small>Needs your quote</small><b>{waiting}</b><span>{waiting?'Collectors are waiting':'All caught up'}</span></li>
   <li><small>In progress</small><b>{active}</b><span>{done} finished</span></li>
   <li><small>Reviews</small><b>{studio.reviewCount?studio.rating?.toFixed(1):'–'}</b><span>{studio.reviewCount} verified</span></li>
  </ul>
  {todo.length>0&&<section className="ws-improve" aria-labelledby="ws-improve-title"><div><h3 id="ws-improve-title">Make your page stand out</h3><p className="ws-help">{completeness.done} of {completeness.total} extras done. Collectors are more likely to ask for a quote when they can see your work.</p></div><ul>{todo.map(i=><li key={i.id}><Plus size={14} aria-hidden="true"/>{i.label}</li>)}</ul><button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" onClick={onEdit}>Add details</button></section>}
  <div className="ws-section-head"><h3 className="ws-subtitle">Requests</h3><button type="button" className="ds-link" disabled={refreshing} onClick={onRefresh}><RefreshCw size={15} aria-hidden="true"/> Refresh</button></div>
  {jobs.length?<GroupedJobs jobs={jobs} onOpen={onOpenJob} needsReply/>:<EmptyState compact title="No requests yet" message="New quote requests show up here and in Messages."/>}
 </>;
}

function QuoteRequest({provider:p,vault,busy,openCollection,onBack,onSave}:{provider:Provider;vault:Vault;busy:boolean;openCollection:()=>void;onBack:()=>void;onSave:(f:Record<string,unknown>)=>Promise<void>}){
 const [books,setBooks]=useState<string[]>([]),[selected,setSelected]=useState<CareService[]>(p.services.includes('pressing')?['pressing']:[p.services[0]]),[method,setMethod]=useState<'mail'|'dropoff'>(p.mailIn?'mail':'dropoff'),[find,setFind]=useState('');
 const both=p.mailIn&&p.dropoff;
 const shownBooks=useMemo(()=>{const q=find.trim().toLowerCase();return q?vault.books.filter(b=>books.includes(b.id)||(b.title+' '+b.issue).toLowerCase().includes(q)):vault.books},[find,vault.books,books]);
 const tips=selected.flatMap(s=>careGuideFor(s)?.tell||[]);
 return <section className="ws-quote" aria-labelledby="ws-quote-title">
  <button type="button" className="ds-link ws-back" onClick={onBack}><ArrowLeft size={16} aria-hidden="true"/> Back to {p.name}</button>
  <div className="ws-quote-head"><p className="ds-eyebrow">Free quote request</p><h2 id="ws-quote-title" className="ws-section-title">Ask {p.name} for a quote</h2><p className="ws-help">The studio replies with a price and timeline. Nothing ships and nothing is charged until you accept.</p></div>
  {!vault.books.length?<EmptyState compact title="Add a comic first" message="Quotes are for comics in your collection." action={{label:'Open my collection',onClick:openCollection}}/>
  :<form className="ws-form" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await onSave({bookIds:books,declaredValues:{},services:selected,notes:String(f.get('notes')||''),sendToCgc:f.get('sendToCgc')==='on',method,scopeConsent:true})}}>
   <fieldset><legend><span className="ws-num">1</span> Pick your comics <small>({books.length} of 20)</small></legend>
    {vault.books.length>8&&<div className="ws-search-field"><Search size={18} aria-hidden="true"/><input type="search" aria-label="Find a comic in your collection" value={find} onChange={e=>setFind(e.target.value)} placeholder="Find a comic"/></div>}
    <div className="ws-book-list">{shownBooks.map(b=><label key={b.id} className={books.includes(b.id)?'selected':''}><input type="checkbox" checked={books.includes(b.id)} disabled={!books.includes(b.id)&&books.length>=20} onChange={()=>setBooks(v=>v.includes(b.id)?v.filter(id=>id!==b.id):[...v,b.id])}/><span><strong>{b.title} {b.issue}</strong>{b.grade&&<small>{b.grade}</small>}</span></label>)}{!shownBooks.length&&<p className="ws-help">No comics match.</p>}</div></fieldset>
   <fieldset><legend><span className="ws-num">2</span> Pick services</legend><div className="ws-chips">{p.services.map(s=><label key={s}><input type="checkbox" checked={selected.includes(s)} onChange={()=>setSelected(v=>v.includes(s)?v.filter(x=>x!==s):[...v,s])}/><span>{label(s)}{p.prices[s]!=null&&<small> · from {usd(p.prices[s]!)}</small>}</span></label>)}</div>
    {selected.includes('cgc')&&(p.submissionMode==='dealer'?<label className="ws-check"><input name="sendToCgc" type="checkbox"/> Ask the studio to send my comics to CGC afterward</label>:<p className="ws-help">This studio preps books only. You send them to CGC yourself.</p>)}</fieldset>
   <fieldset><legend><span className="ws-num">3</span> How you’ll send them</legend>{both?<div className="ws-chips">{(['mail','dropoff'] as const).map(m=><label key={m}><input type="radio" name="method" checked={method===m} onChange={()=>setMethod(m)}/><span>{m==='mail'?'Mail them in':'Drop them off'}</span></label>)}</div>:<p className="ws-help">This studio takes {p.mailIn?'mail-in only':'local drop-off only'}.</p>}</fieldset>
   <fieldset><legend><span className="ws-num">4</span> Tell the studio</legend>
    {tips.length>0&&<div className="ws-tell"><b>Helpful to mention</b><ul>{[...new Set(tips)].map(t=><li key={t}>{t}</li>)}</ul></div>}
    <label><span>Notes for the studio <span className="ws-optional">(optional)</span></span><textarea name="notes" maxLength={2000} placeholder="Defects to address, signatures, fragile covers, your goal for each book."/></label>
    <label className="ws-check"><input required type="checkbox"/> <span>This is for pressing, cleaning or a check-up, not restoration. See the {rules}.</span></label>
   </fieldset>
   <div className="ws-submit"><button className="ds-btn ds-btn-primary" disabled={busy||!books.length||!selected.length}>{busy?'Sending…':'Send quote request'} <ArrowRight size={16} aria-hidden="true"/></button>{!books.length&&<span className="ws-help">Pick at least one comic.</span>}</div>
  </form>}
 </section>;
}

type Draft={name:string;location:string;zip:string;website:string;bio:string;specialties:string;accepting:boolean;prices:Partial<Record<CareService,number|null>>};
function readDraft(form:HTMLFormElement,services:CareService[]):Draft{
 const f=new FormData(form),prices:Partial<Record<CareService,number|null>>={};
 services.forEach(s=>{const raw=f.get('price-'+s);prices[s]=raw===null||raw===''?null:amount(f,'price-'+s)});
 return {name:String(f.get('name')||''),location:String(f.get('location')||''),zip:String(f.get('locationZip')||''),website:String(f.get('website')||''),bio:String(f.get('bio')||''),specialties:String(f.get('specialties')||''),accepting:f.get('accepting')==='on',prices};
}

export function ProviderForm({provider:p,me,busy,notice,onSave,onCancel}:{provider:Provider|null;me:CollectorProfile;busy:boolean;notice:(s:string)=>void;onSave:(f:Record<string,unknown>)=>Promise<void>;onCancel:()=>void}){
 const [selected,setSelected]=useState<CareService[]>(p?.services||['pressing','dry_cleaning']),[mode,setMode]=useState<Provider['submissionMode']>(p?.submissionMode&&p.submissionMode!=='none'?p.submissionMode:'prepare_only'),[mailIn,setMailIn]=useState(p?.mailIn??true),[logo,setLogo]=useState(p?.logoId||null),[portfolio,setPortfolio]=useState(p?.portfolio||[]),[pending,setPending]=useState({before:'',after:'',caption:''}),[uploading,setUploading]=useState('');
 const [draft,setDraft]=useState<Draft>({name:p?.name||'',location:p?.location||me.location||'',zip:p?.locationZip||'',website:p?.website||'',bio:p?.bio||'',specialties:p?.specialties||'',accepting:p?.accepting??true,prices:p?.prices||{}});
 const formRef=useRef<HTMLFormElement>(null);
 const year=new Date().getFullYear(),blocked=!me.visible||!me.dmOpen;
 const sync=()=>{if(formRef.current)setDraft(readDraft(formRef.current,selected))};
 useEffect(()=>{if(formRef.current)setDraft(readDraft(formRef.current,selected))},[selected]);
 async function photo(file:File|undefined,target:string){if(!file)return;setUploading(target);try{const id=await uploadPhoto(file);if(target==='logo')setLogo(id);else setPending(v=>({...v,[target]:id}))}catch(e){notice(e instanceof Error?e.message:'Photo didn’t upload. Try again.')}finally{setUploading('')}}
 const preview:Provider={id:p?.id||'preview',profileId:me.id,name:draft.name.trim(),bio:draft.bio,location:draft.location.trim(),locationZip:/^d{5}$/.test(draft.zip)?draft.zip:undefined,services:selected,prices:draft.prices,specialties:draft.specialties,experienceSince:p?.experienceSince||year,turnaroundMin:p?.turnaroundMin||7,turnaroundMax:p?.turnaroundMax||21,mailIn,dropoff:p?.dropoff??false,accepting:draft.accepting,visible:true,submissionMode:'none',dealerReference:'',website:draft.website,logoId:logo,portfolio,terms:'',createdAt:p?.createdAt||new Date().toISOString(),updatedAt:'',collector:{name:me.name,handle:''},rating:p?.rating??null,reviewCount:p?.reviewCount??0,completedReviewCount:p?.completedReviewCount??0,categoryRatings:{quality:null,communication:null,timeliness:null},rank:null};
 const tag=(required:boolean)=><span className={'ws-req '+(required?'required':'optional')}>{required?'Required':'Optional'}</span>;
 return <div className="ws-onboard">
 <form ref={formRef} className="ws-form ws-studio-form" onInput={sync} onChange={sync} onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);if(pending.before||pending.after){notice('Add or discard the unfinished before/after pair first.');return}const prices:Partial<Record<CareService,number|null>>={};selected.forEach(s=>prices[s]=f.get('price-'+s)===''||f.get('price-'+s)===null?null:amount(f,'price-'+s));const zip=String(f.get('locationZip')||'').trim(),cgc=selected.includes('cgc'),since=Number(f.get('experienceSince')||0);
  await onSave({name:String(f.get('name')),bio:String(f.get('bio')),location:String(f.get('location')),...(zip?{locationZip:zip}:{}),specialties:String(f.get('specialties')||''),experienceSince:since>=1930&&since<=year?since:year,turnaroundMin:Number(f.get('min')),turnaroundMax:Number(f.get('max')),mailIn,dropoff:f.get('dropoff')==='on',accepting:f.get('accepting')==='on',visible:f.get('visible')==='on',website:String(f.get('website')||''),services:selected,prices,submissionMode:cgc?mode:'none',dealerReference:cgc&&mode==='dealer'?String(f.get('dealerReference')||''):'',dealerAttest:f.get('dealerAttest')==='on',logoId:logo,portfolio,shippingAddress:mailIn?String(f.get('shippingAddress')||''):'',shippingNotes:String(f.get('shippingNotes')||''),terms:String(f.get('terms')),attest:true})}}>
  {blocked&&<p className="ws-alert" role="alert">Make your profile public and turn on messages first (My Profile → Edit). Collectors contact studios through Messages.</p>}
  <fieldset><legend><span className="ws-num">1</span> The basics {tag(true)}</legend>
   <label>Studio name<input required name="name" maxLength={80} defaultValue={p?.name||''} placeholder="e.g. North Star Pressing"/></label>
   <div className="ws-row"><label>City, state<input required name="location" maxLength={100} defaultValue={p?.location||me.location} placeholder="Minneapolis, MN"/></label><label><span>ZIP code <span className="ws-optional">(recommended)</span></span><input name="locationZip" inputMode="numeric" pattern="[0-9]{5}" maxLength={5} defaultValue={p?.locationZip||''} placeholder="55401"/><small className="ws-help">Lets nearby collectors find you by distance. Never shown.</small></label></div>
   <label>About your work<textarea required name="bio" maxLength={1200} defaultValue={p?.bio||''} placeholder="How long you’ve pressed or cleaned books, your process, and how you handle collectors’ comics."/></label>
  </fieldset>
  <fieldset><legend><span className="ws-num">2</span> Services {tag(true)}</legend>
   <div className="ws-service-rows">{careServices.map(s=>{const on=selected.includes(s.id);return <div key={s.id} className={on?'on':''}><label className="ws-check"><input type="checkbox" checked={on} onChange={()=>setSelected(v=>on?v.filter(x=>x!==s.id):[...v,s.id])}/><span><strong>{s.name}</strong><small>{careGuideFor(s.id)?.short||s.description}</small></span></label>{on&&<label className="ws-price-input"><span>Starting price <span className="ws-optional">(optional, $/book)</span></span><input name={'price-'+s.id} type="number" min="0" max="1000000" step="0.01" defaultValue={p?.prices[s.id]!=null?p.prices[s.id]!/100:''} placeholder="Blank = quote"/></label>}</div>})}</div>
   {!selected.length&&<p className="ds-error" role="alert">Pick at least one service.</p>}
   {selected.includes('cgc')&&<div className="ws-box"><label>CGC support<select value={mode} onChange={e=>setMode(e.target.value as Provider['submissionMode'])}><option value="prepare_only">I prep books; the customer sends them</option><option value="dealer">I send them for customers (CGC dealer)</option></select></label>{mode==='dealer'&&<><label>Link that shows your dealer status<input name="dealerReference" type="url" pattern="https://.*" required maxLength={500} defaultValue={p?.dealerReference||''} placeholder="https://"/></label><label className="ws-check"><input name="dealerAttest" type="checkbox" required/> <span>I’m a current CGC dealer. I’ll ask each customer before sending.</span></label></>}</div>}
  </fieldset>
  <fieldset><legend><span className="ws-num">3</span> Turnaround &amp; intake {tag(true)}</legend>
   <div className="ws-row"><label>Fastest (business days)<input name="min" required type="number" min="1" max="365" defaultValue={p?.turnaroundMin||7}/></label><label>Slowest (business days)<input name="max" required type="number" min="1" max="365" defaultValue={p?.turnaroundMax||21}/></label></div>
   <label className="ws-check"><input type="checkbox" checked={mailIn} onChange={e=>setMailIn(e.target.checked)}/> Take books by mail</label>
   {mailIn&&<label><span>Mail-in address <span className="ws-optional">(private)</span></span><textarea required name="shippingAddress" maxLength={1000} defaultValue={p?.shippingAddress||''} placeholder="Name, street, city, state, ZIP"/><small className="ws-help"><Lock size={14} aria-hidden="true"/> Only shown to a customer after they accept your quote.</small></label>}
   <label className="ws-check"><input name="dropoff" type="checkbox" defaultChecked={p?.dropoff??false}/> Offer local drop-off</label>
   <label>Your service terms<textarea required name="terms" maxLength={2000} defaultValue={p?.terms||'Pressing and dry cleaning only. No restoration. Payment, insurance and return shipping are agreed in each quote.'}/><small className="ws-help">We filled in a starting point. Collectors see these before they accept a quote.</small></label>
  </fieldset>
  <details className="ws-details" open={!!p}><summary><span className="ws-num">4</span> Make your page stand out {tag(false)}</summary>
   <div className="ws-details-body">
   <p className="ws-help">All optional. Add them now or later from My studio.</p>
   <div className="ws-row"><label>Specialties<input name="specialties" maxLength={300} defaultValue={p?.specialties||''} placeholder="Golden Age, modern keys, newsstand…"/><small className="ws-help">Separate with commas.</small></label><label>Doing this since<input name="experienceSince" type="number" min={1930} max={year} defaultValue={p&&p.experienceSince<new Date(p.createdAt).getFullYear()?p.experienceSince:''} placeholder={String(year)}/></label></div>
   <label>Website<input type="url" name="website" pattern="https://.*" maxLength={500} defaultValue={p?.website||''} placeholder="https://"/></label>
   <div className="ws-upload">{logo?<img src={'/api/media?id='+logo} alt="Studio logo preview"/>:<span className="ws-upload-empty"><Wrench size={22} aria-hidden="true"/></span>}<label className="ds-btn ds-btn-secondary ds-btn-sm">{uploading==='logo'?'Uploading…':logo?'Replace logo':'Upload logo'}<input type="file" hidden accept="image/jpeg,image/png,image/webp" disabled={!!uploading} onChange={e=>void photo(e.target.files?.[0],'logo')}/></label>{logo&&<button type="button" className="ds-link" onClick={()=>setLogo(null)}>Remove</button>}</div>
   {portfolio.length>0&&<div className="ws-portfolio">{portfolio.map((pair,i)=><figure key={i}><div><span><img src={'/api/media?id='+pair.before} alt="Before"/><small>Before</small></span><span><img src={'/api/media?id='+pair.after} alt="After"/><small>After</small></span></div><figcaption>{pair.caption}<button type="button" aria-label={'Remove example '+(i+1)} onClick={()=>setPortfolio(v=>v.filter((_,n)=>n!==i))}><X size={16} aria-hidden="true"/></button></figcaption></figure>)}</div>}
   {portfolio.length<4&&<div className="ws-box"><p className="ws-help">Before-and-after pairs (up to 4). Your first “after” photo becomes your cover image. Use your own photos.</p><div className="ws-row">{(['before','after'] as const).map(target=><label key={target} className="ws-photo-drop">{pending[target]?<img src={'/api/media?id='+pending[target]} alt={target+' preview'}/>:<ImagePlus size={24} aria-hidden="true"/>}<span>{uploading===target?'Uploading…':target==='before'?'Before photo':'After photo'}</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={!!uploading} onChange={e=>void photo(e.target.files?.[0],target)}/></label>)}</div><label>Caption<input value={pending.caption} maxLength={200} onChange={e=>setPending(v=>({...v,caption:e.target.value}))} placeholder="Which book and what you did"/></label><div className="ws-actions"><button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" disabled={!pending.before||!pending.after||!pending.caption.trim()} onClick={()=>{setPortfolio(v=>[...v,pending]);setPending({before:'',after:'',caption:''})}}><Plus size={15} aria-hidden="true"/> Add pair</button>{(pending.before||pending.after)&&<button type="button" className="ds-link" onClick={()=>setPending({before:'',after:'',caption:''})}>Discard</button>}</div></div>}
   <label><span>Packing or drop-off tips <span className="ws-optional">(private, shown after a quote is accepted)</span></span><textarea name="shippingNotes" maxLength={1500} defaultValue={p?.shippingNotes||''}/></label>
   </div>
  </details>
  <fieldset><legend><span className="ws-num">5</span> Publish</legend>
   <label className="ws-check"><input name="accepting" type="checkbox" defaultChecked={p?.accepting??true}/> Taking new quote requests</label>
   <label className="ws-check"><input name="visible" type="checkbox" defaultChecked={p?.visible??true}/> Show my studio in the Workshop</label>
   <label className="ws-check"><input type="checkbox" required/> <span>My details are true and the photos are mine. Pressing can’t promise a grade. See the {rules}.</span></label>
  </fieldset>
  <div className="ws-submit"><button className="ds-btn ds-btn-primary" disabled={busy||!!uploading||!selected.length||blocked}>{busy?'Saving…':p?'Save changes':'Publish my studio'} <Check size={16} aria-hidden="true"/></button><button type="button" className="ds-link" onClick={onCancel}>Cancel</button></div>
 </form>
 <aside className="ws-preview" aria-label="Live preview of your studio card">
  <details open><summary>Live preview</summary>
   <p className="ws-help">This is how collectors see you in the directory.</p>
   <ProviderCard p={preview} preview onOpen={()=>{}}/>
   <ul className="ws-checklist">{studioCompleteness(preview).items.map(i=><li key={i.id} className={i.done?'done':''}>{i.done?<Check size={14} aria-hidden="true"/>:<Circle size={10} aria-hidden="true"/>}{i.label.replace(/^Add (a |an |your )?|^List a /,'').replace(/^./,c=>c.toUpperCase())}</li>)}</ul>
  </details>
 </aside>
 </div>;
}

function StarInput({name,legend,initial}:{name:string;legend:string;initial?:number}){
 const [value,setValue]=useState(initial||0);
 return <fieldset className="ws-star-input"><legend>{legend}</legend><div>{[1,2,3,4,5].map(n=><label key={n} title={n+' of 5'}><input type="radio" name={name} value={n} required checked={value===n} onChange={()=>setValue(n)}/><Star size={24} aria-hidden="true" fill={n<=value?'currentColor':'none'}/><span className="ws-sr">{n} {n===1?'star':'stars'}</span></label>)}</div></fieldset>;
}

function ReviewForm({provider:p,busy,onSave}:{provider:Provider;busy:boolean;onSave:(f:Record<string,unknown>)=>Promise<void>}){
 const [previous,setPrevious]=useState<CareReview|null>(null),[loaded,setLoaded]=useState(false);
 useEffect(()=>{let keep=true;void fetch('/api/pressing?kind=provider&id='+encodeURIComponent(p.id)).then(r=>r.json() as Promise<{reviews?:CareReview[]}>).then(d=>{if(keep){setPrevious(d.reviews?.find(r=>r.mine)||null);setLoaded(true)}}).catch(()=>{if(keep)setLoaded(true)});return()=>{keep=false}},[p.id]);
 if(!loaded)return <LoadingState compact message="Loading…"/>;
 return <form key={previous?.id||'new'} className="form-dialog ws-form" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await onSave({rating:Number(f.get('rating')),quality:Number(f.get('quality')),communication:Number(f.get('communication')),timeliness:Number(f.get('timeliness')),title:String(f.get('title')),body:String(f.get('body')),attest:true})}}>
  <h2>{previous?'Edit your review':'Review '+p.name}</h2>
  <p className="ws-help">One review per collector. Only people who accepted a quote from this studio can review it.</p>
  <StarInput name="rating" legend="Overall" initial={previous?.rating}/>
  <div className="ws-row"><StarInput name="quality" legend="Quality of work" initial={previous?.quality}/><StarInput name="communication" legend="Communication" initial={previous?.communication}/><StarInput name="timeliness" legend="Timeliness" initial={previous?.timeliness}/></div>
  <label>Headline<input required name="title" maxLength={100} defaultValue={previous?.title||''} placeholder="Sum it up in a few words"/></label>
  <label>Your review<textarea required name="body" maxLength={2000} defaultValue={previous?.body||''} placeholder="What did they do? How did your books come back?"/><small className="ws-help">Don’t include addresses or tracking numbers.</small></label>
  <label className="ws-check"><input required type="checkbox"/> This is my own honest experience.</label>
  <button className="ds-btn ds-btn-primary" disabled={busy}>{busy?'Saving…':previous?'Update review':'Post review'} <Star size={16} aria-hidden="true"/></button>
 </form>;
}

const stageLabel:Record<string,string>={requested:'Requested',approved:'Accepted',received:'Received',pressing:'Care',at_grading:'CGC',returning:'Returning',completed:'Done'};
const actionLabel=(s:string,mail:boolean)=>({in_transit:'I shipped my books',received:'Confirm books received',pressing:'Start care work',at_grading:'Record CGC submission',returning:mail?'Record return shipment':'Ready for pickup',completed:'I got my books back',cancelled:'Cancel request',declined:'Decline request'} as Record<string,string>)[s]||careStatuses[s]||s;

function JobDetail({data:{job:j,events},busy,notice,onAction,onMessage,onReview}:{data:{job:CareJob;events:CareEvent[]};busy:boolean;notice:(s:string)=>void;onAction:(f:Record<string,unknown>)=>Promise<void>;onMessage:()=>Promise<void>;onReview:()=>void}){
 const [action,setAction]=useState(''),[photos,setPhotos]=useState<string[]>([]),[uploading,setUploading]=useState(false);
 const stages=careStages.filter(s=>s!=='at_grading'||j.sendToCgc),total=(j.fee||0)+(j.returnShipping||0)+(j.cgcEstimate||0);
 const actions=Object.keys(careStatuses).filter(s=>canCareTransition(j.status,s,j.isProvider,j.sendToCgc)&&!(j.method==='dropoff'&&s==='in_transit'));
 const needsTracking=j.method==='mail'&&['in_transit','returning'].includes(action),needsReason=action==='returning'&&(j.status==='received'||j.status==='pressing'&&j.sendToCgc);
 return <div className="ws-job">
  <p className="ds-eyebrow ws-job-eyebrow"><Lock size={14} aria-hidden="true"/> Private request · #{j.id.slice(0,8).toUpperCase()}</p>
  <div className="ws-job-head"><div><h2>{j.isProvider?j.requesterName:j.providerName}</h2><p className="ws-help">{j.books.length} {j.books.length===1?'comic':'comics'} · {j.method==='mail'?'Mail-in':'Local drop-off'} · {j.services.map(label).join(', ')}</p></div><span className={'ws-status ws-status-'+j.status}>{careStatuses[j.status]||j.status}</span></div>
  {!careClosed(j.status)&&<p className="ws-next-hint"><ArrowRight size={15} aria-hidden="true"/> Next: <b>{careNextStep(j)}</b></p>}
  <div className="ws-actions"><button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" onClick={()=>void onMessage()}><MessageCircle size={16} aria-hidden="true"/> Message {j.isProvider?'collector':'studio'}</button>{j.status==='completed'&&!j.isProvider&&<button type="button" className="ds-btn ds-btn-primary ds-btn-sm" onClick={onReview}><Star size={16} aria-hidden="true"/> Review this studio</button>}<button type="button" className="ds-link" onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({exportedAt:new Date().toISOString(),job:j,events},null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='comichuddle-request-'+j.id.slice(0,8)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}}><Download size={15} aria-hidden="true"/> Download record</button></div>
  <ol className="ws-progress" aria-label="Request progress">{stages.map(s=>{const recorded=events.some(e=>e.status===s),skipped=['returning','completed'].includes(j.status)&&['pressing','at_grading'].includes(s)&&!recorded;return <li key={s} className={recorded?'done':skipped?'skipped':''}><span aria-hidden="true">{recorded?<Check size={14}/>:skipped?'–':''}</span>{stageLabel[s]}{skipped?' (skipped)':''}</li>})}</ol>
  <ul className="ws-job-books">{j.books.map(b=><li key={b.id}><ComicArt book={b} small/><div><strong>{b.title} {b.issue}</strong>{b.grade&&<small>{b.grade}</small>}<small>Value you listed: {usd(b.declaredValue)}</small></div></li>)}</ul>
  {j.notes&&<div className="ws-box"><strong>Collector’s notes</strong><p>{j.notes}</p></div>}
  {j.quoteRevision>0&&<div className="ws-quote-box"><h3>Quote{j.quoteRevision>1?' (update '+j.quoteRevision+')':''}</h3><dl><div><dt>Care work</dt><dd>{usd(j.fee||0)}</dd></div>{j.method==='mail'&&<div><dt>Return shipping</dt><dd>{usd(j.returnShipping||0)}</dd></div>}{j.sendToCgc&&<div><dt>CGC fees (estimate)</dt><dd>{usd(j.cgcEstimate||0)}</dd></div>}<div className="total"><dt>Total</dt><dd>{usd(total)}</dd></div></dl>{j.quoteNotes&&<p>{j.quoteNotes}</p>}<p className="ws-help">About {j.quoteDays} business days. You pay the studio directly. ComicHuddle doesn’t charge you.</p>{j.termsSnapshot&&<HowItWorks title="Studio terms for this quote"><p className="ws-pre">{j.termsSnapshot}</p></HowItWorks>}</div>}
  {j.isProvider&&['requested','quoted'].includes(j.status)&&<form className="ws-form ws-box" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await onAction({action:'quote',revision:j.quoteRevision,fee:amount(f,'fee'),returnShipping:amount(f,'returnShipping'),cgcEstimate:amount(f,'cgcEstimate'),quoteDays:Number(f.get('quoteDays')),quoteNotes:String(f.get('quoteNotes'))})}}>
   <h3>{j.status==='quoted'?'Update your quote':'Send a quote'}</h3>
   <div className="ws-row"><label>Care work ($)<input required type="number" step="0.01" min="0" max="1000000" name="fee" defaultValue={j.fee!==null?j.fee/100:''}/></label>{j.method==='mail'&&<label>Return shipping ($)<input required type="number" step="0.01" min="0" max="1000000" name="returnShipping" defaultValue={j.returnShipping!==null?j.returnShipping/100:''}/></label>}{j.sendToCgc&&<label>CGC fees estimate ($)<input required type="number" step="0.01" min="0" max="1000000" name="cgcEstimate" defaultValue={j.cgcEstimate!==null?j.cgcEstimate/100:''}/></label>}<label>Business days<input required type="number" min="1" max="365" name="quoteDays" defaultValue={j.quoteDays||14}/></label></div>
   <label>What’s included and how to pay<textarea required maxLength={2000} name="quoteNotes" defaultValue={j.quoteNotes} placeholder="The work, anything left out, how they pay you and how books come back."/></label>
   <button className="ds-btn ds-btn-primary" disabled={busy}>{busy?'Sending…':j.status==='quoted'?'Send updated quote':'Send quote'} <ArrowRight size={16} aria-hidden="true"/></button>
  </form>}
  {!j.isProvider&&j.status==='quoted'&&<form className="ws-form ws-box" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await onAction({action:'approve',revision:j.quoteRevision,returnAddress:String(f.get('returnAddress')||''),riskConsent:true,termsConsent:true,cgcConsent:f.get('cgcConsent')==='on'})}}>
   <h3>Accept this quote</h3>
   {j.method==='mail'&&<label><span>Your return address <span className="ws-optional">(only this studio sees it)</span></span><textarea name="returnAddress" required maxLength={1000} placeholder="Name, street, city, state, ZIP"/></label>}
   <label className="ws-check"><input required type="checkbox"/> <span>I’ve read the quote and terms. Pressing can’t promise a grade, and fragile books carry some risk. See the {rules}.</span></label>
   {j.sendToCgc&&<label className="ws-check"><input required name="cgcConsent" type="checkbox"/> <span>This studio can send my comics to CGC. (<a href={cgcLinks.dealers} target="_blank" rel="noreferrer">Check their dealer status</a>)</span></label>}
   <button className="ds-btn ds-btn-primary" disabled={busy}>{busy?'Saving…':'Accept quote'} <Check size={16} aria-hidden="true"/></button>
   <p className="ws-help">Next you’ll see where to send your comics. You won’t be charged here.</p>
  </form>}
  {j.shippingAddress&&<div className="ws-box ws-address"><div><h3>{j.method==='mail'?'Ship your books to':'Drop-off details'}</h3><address>{j.shippingAddress}</address>{j.shippingNotes&&<p>{j.shippingNotes}</p>}{j.method==='mail'&&<a href={cgcLinks.packing} target="_blank" rel="noreferrer">How to pack comics safely <ArrowUpRight size={14} aria-hidden="true"/></a>}</div>{j.returnAddress&&<div><h3>Return to</h3><address>{j.returnAddress}</address></div>}</div>}
  {(j.incomingTracking||j.outgoingTracking||j.submissionRef)&&<ul className="ws-tracking">{j.incomingTracking&&<li><Truck size={16} aria-hidden="true"/> To studio: {j.incomingCarrier} <b>{j.incomingTracking}</b></li>}{j.submissionRef&&<li><ShieldCheck size={16} aria-hidden="true"/> CGC reference: <b>{j.submissionRef}</b></li>}{j.outgoingTracking&&<li><Package size={16} aria-hidden="true"/> Return: {j.outgoingCarrier} <b>{j.outgoingTracking}</b></li>}</ul>}
  {actions.length>0&&<div className="ws-next"><h3>Next step</h3><div className="ws-actions">{actions.map(s=><button type="button" className={'ds-btn ds-btn-sm '+(['cancelled','declined'].includes(s)?'ds-btn-secondary':'ds-btn-dark')} key={s} disabled={busy} aria-pressed={action===s} onClick={()=>setAction(s)}>{actionLabel(s,j.method==='mail')}</button>)}</div>
   {action&&<form className="ws-form ws-box" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await onAction({action:'stage',status:action,note:String(f.get('note')||''),photos,carrier:String(f.get('carrier')||''),tracking:String(f.get('tracking')||''),submissionRef:String(f.get('submissionRef')||'')})}}>
    <div className="ws-section-head"><h3>{actionLabel(action,j.method==='mail')}</h3><button type="button" className="ws-icon-btn" aria-label="Close" onClick={()=>setAction('')}><X size={18} aria-hidden="true"/></button></div>
    {needsTracking&&<div className="ws-row"><label>Carrier<input required name="carrier" maxLength={80} placeholder="USPS, UPS, FedEx…"/></label><label>Tracking number<input required name="tracking" maxLength={100}/></label></div>}
    {action==='at_grading'&&<label>CGC submission number<input required name="submissionRef" maxLength={100}/></label>}
    <label>{needsReason?'Why are you skipping care? (required)':'Note'} {!needsReason&&<span className="ws-optional">(optional)</span>}<textarea name="note" required={needsReason} minLength={needsReason?20:undefined} maxLength={2000} placeholder={action==='received'?'Condition when it arrived.':action==='completed'?'Condition when it came back.':'Anything the other person should know.'}/>{needsReason&&<small className="ws-help">At least 20 characters.</small>}</label>
    <div className="ws-photo-row">{photos.map((id,i)=><div key={id}><img src={'/api/media?id='+id} alt={'Condition photo '+(i+1)}/><button type="button" aria-label={'Remove photo '+(i+1)} onClick={()=>setPhotos(v=>v.filter(x=>x!==id))}><X size={14} aria-hidden="true"/></button></div>)}{photos.length<6&&<label className="ds-btn ds-btn-secondary ds-btn-sm"><ImagePlus size={15} aria-hidden="true"/>{uploading?'Uploading…':'Add photo'}<input hidden type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={async e=>{const file=e.target.files?.[0];if(!file)return;setUploading(true);try{const id=await uploadPhoto(file);setPhotos(v=>[...v,id])}catch(e){notice(e instanceof Error?e.message:'Photo didn’t upload. Try again.')}finally{setUploading(false)}}}/></label>}</div>
    <button className="ds-btn ds-btn-primary" disabled={busy||uploading}>Save update <Check size={16} aria-hidden="true"/></button>
   </form>}
  </div>}
  <div className="ws-timeline"><h3>History</h3><ol>{events.map(e=><li key={e.id}><div><strong>{careStatuses[e.status]||e.status}</strong><small>{e.authorName} · {day(e.createdAt)}</small></div>{e.note&&<p>{e.note}</p>}{e.photos.length>0&&<div className="ws-photo-row">{e.photos.map((id,i)=><a href={'/api/media?id='+id} target="_blank" rel="noreferrer" key={id}><img src={'/api/media?id='+id} alt={'Condition photo '+(i+1)}/></a>)}</div>}</li>)}</ol></div>
  <p className="ws-help ws-private"><Lock size={14} aria-hidden="true"/> Only you two can see this. Updates come from you and the studio, not a carrier or CGC.</p>
 </div>;
}
