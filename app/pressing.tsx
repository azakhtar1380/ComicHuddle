'use client';
// Comic Workshop: a simple three-step customer flow (find → profile → quote) plus a
// provider desk (register studio → manage requests). All data comes from /api/pressing.
import LocationRadiusFilter from './location-radius-filter';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,ArrowUpRight,Check,Download,Flag,ImagePlus,Lock,MapPin,MessageCircle,Package,Plus,RefreshCw,Search,ShieldCheck,Star,Truck,Wrench,X} from 'lucide-react';
import {Modal,ComicArt,uploadPhoto,useCollectorNetwork} from './network';
import {careServices,careStatuses,careStages,canCareTransition,cgcLinks,emptyCare,filterWorkshopProviders,type Provider,type CareReview,type CareJob,type CareEvent,type CareService,type CareData} from '../lib/pressing';
import type {Vault} from '../lib/vault';
import type {CollectorProfile} from '../lib/community';
import PageHeader from '../components/page-header';
import {EmptyState,ErrorState,HowItWorks,LoadingState} from '../components/states';
import './pressing.css';

const usd=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
const day=(s:string)=>new Date(s).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
const label=(id:string)=>careServices.find(s=>s.id===id)?.name||id;
const amount=(f:FormData,key:string)=>Math.round(Number(f.get(key)||0)*100);
const place=(p:Provider)=>p.locationCity?p.locationCity+', '+p.locationState:p.location;
const rules=<a className="ws-rules" href="/?section=Rules" target="_blank" rel="noreferrer">rules</a>;
type Action={saved?:boolean;jobId?:string;threadId?:string};
type Props={tab:string;signedIn:boolean;net:ReturnType<typeof useCollectorNetwork>;vault:Vault;gate:()=>boolean;notice:(s:string)=>void;go:(s:string)=>void;openCollection:()=>void;onRegister:()=>void;onOpenThread:(id:string)=>Promise<void>;command:{id:number;view:string}};
type View='find'|'requests'|'studio';
type Detail={provider:Provider;reviews:CareReview[];canReview?:boolean};

export function Stars({value,size=14}:{value:number|null;size?:number}){
 const shown=value===null||!Number.isFinite(value)?null:value;
 return <span className="ws-stars" role="img" aria-label={shown===null?'No ratings yet':shown.toFixed(1)+' out of 5 stars'}>{[1,2,3,4,5].map(i=><Star key={i} size={size} aria-hidden="true" fill={shown!==null&&i<=Math.round(shown)?'currentColor':'none'}/>)}<b>{shown===null?'New':shown.toFixed(1)}</b></span>;
}
function startingPrice(p:Provider){const prices=p.services.map(s=>p.prices[s]).filter((v):v is number=>typeof v==='number'&&v>0);return prices.length?Math.min(...prices):null}

export function ProviderCard({p,mine,onOpen,onQuote}:{p:Provider;mine:boolean;onOpen:()=>void;onQuote:()=>void}){
 const photo=p.portfolio[0]?.after||p.logoId,from=startingPrice(p);
 return <article className="ds-card ws-card">
  {photo&&<button type="button" className="ws-card-media" onClick={onOpen} aria-label={'See '+p.name}><img src={'/api/media?id='+photo} alt=""/></button>}
  <div className="ws-card-body">
   <div className="ws-card-top"><span className={'ws-pill '+(p.accepting?'ws-pill-open':'ws-pill-paused')}>{p.accepting?'Taking requests':'Requests paused'}</span>{typeof p.distanceMiles==='number'&&<span className="ws-distance">~{p.distanceMiles} mi away</span>}</div>
   <h3><button type="button" onClick={onOpen}>{p.name}</button></h3>
   <p className="ws-meta"><MapPin size={15} aria-hidden="true"/>{place(p)}</p>
   <p className="ws-meta"><Stars value={p.rating}/><span>{p.reviewCount} {p.reviewCount===1?'review':'reviews'}</span></p>
   <ul className="ws-tags" aria-label="Services">{p.services.map(s=><li key={s}>{label(s)}</li>)}</ul>
   <p className="ws-price">{from!==null?<>From <b>{usd(from)}</b> a book</>:'Ask for a price'}</p>
   <div className="ws-card-actions">
    {mine?<span className="ws-own">Your studio</span>:<button type="button" className="ds-btn ds-btn-dark" disabled={!p.accepting} onClick={onQuote}>Request a quote <ArrowRight size={16} aria-hidden="true"/></button>}
    <button type="button" className="ds-link" onClick={onOpen}>See studio</button>
   </div>
  </div>
 </article>;
}

function Steps({step}:{step:1|2|3}){
 return <ol className="ds-steps ws-steps" aria-label="Your steps">{['Find a studio','See the studio','Request a quote'].map((name,i)=><li key={name} className={i+1===step?'current':i+1<step?'done':''} aria-current={i+1===step?'step':undefined}><span className="ws-step-num">{i+1<step?<Check size={14} aria-hidden="true"/>:i+1}</span>{name}</li>)}</ol>;
}

export default function PressRoom({tab,signedIn,net,vault,gate:parentGate,notice,openCollection,onRegister,onOpenThread,command}:Props){
 const [data,setData]=useState<CareData>(emptyCare),[ready,setReady]=useState(false),[error,setError]=useState(''),[refreshing,setRefreshing]=useState(false),[busy,setBusy]=useState(false);
 const [view,setView]=useState<View>('find'),[query,setQuery]=useState(''),[service,setService]=useState<CareService|'all'>('all'),[accepting,setAccepting]=useState(false),[location,setLocation]=useState(''),[radius,setRadius]=useState('nationwide');
 const [detail,setDetail]=useState<Detail|null>(null),[quoteFor,setQuoteFor]=useState<Provider|null>(null),[editing,setEditing]=useState(false),[reviewFor,setReviewFor]=useState<Provider|null>(null),[job,setJob]=useState<{job:CareJob;events:CareEvent[]}|null>(null),[report,setReport]=useState<{type:string;id:string}|null>(null);
 const request=useRef(0),selection=useRef(0),active=useRef(false),deepLinked=useRef(false),visible=useRef(false);
 const me=net.data.me;
 visible.current=tab==='Pressing';
 const refresh=useCallback(async()=>{
  if(!visible.current)return;const ticket=++request.current;setRefreshing(true);setError('');
  try{const r=await fetch('/api/pressing?'+new URLSearchParams({location:location.trim(),radius:location.trim()?radius:'nationwide'}),{cache:'no-store'}),d=await r.json() as CareData&{error?:string};if(!r.ok)throw Error(d.error||'Couldn’t load studios. Try again.');if(ticket===request.current){setData(d);setError('')}}
  catch(e){if(ticket===request.current)setError(e instanceof Error?e.message:'Couldn’t load studios. Try again.')}
  finally{if(ticket===request.current){setReady(true);setRefreshing(false)}}
 },[location,radius]);
 useEffect(()=>{if(tab==='Pressing'&&signedIn)void refresh();else{setReady(!signedIn);setData(emptyCare)}return()=>{request.current++}},[tab,signedIn,me?.id,refresh]);
 useEffect(()=>{if(tab!=='Pressing'||!signedIn||!ready||deepLinked.current)return;const target=new URLSearchParams(window.location.search).get('provider');if(target){deepLinked.current=true;void openProvider(target)}},[tab,signedIn,ready]);
 useEffect(()=>{if(!command.id)return;closeAll();if(command.view==='register'){setView('studio');setEditing(true)}else if(command.view==='provider'||command.view==='studio')setView('studio');else if(command.view==='requests')setView('requests');else setView('find')},[command.id]);
 function closeAll(){selection.current++;setDetail(null);setQuoteFor(null);setJob(null);setReviewFor(null);setReport(null)}
 function gate(){if(parentGate())return true;closeAll();return false}
 async function act(a:Record<string,unknown>):Promise<Action|null>{
  if(active.current)return null;active.current=true;setBusy(true);
  try{const r=await fetch('/api/pressing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(a)}),d=await r.json() as Action&{error?:string};if(!r.ok)throw Error(d.error||'Couldn’t save that. Try again.');await refresh();return d}
  catch(e){notice(e instanceof Error?e.message:'Couldn’t save that. Try again.');return null}
  finally{active.current=false;setBusy(false)}
 }
 async function openProvider(id:string){
  const ticket=++selection.current;
  try{const r=await fetch('/api/pressing?kind=provider&id='+encodeURIComponent(id)),d=await r.json() as Detail&{error?:string};if(!r.ok)throw Error(d.error||'Couldn’t open this studio. Try again.');if(ticket===selection.current){setQuoteFor(null);setView('find');setDetail(d);window.scrollTo?.({top:0,behavior:'smooth'})}}
  catch(e){if(ticket===selection.current)notice(e instanceof Error?e.message:'Couldn’t open this studio. Try again.')}
 }
 async function openJob(id:string){
  const ticket=++selection.current;
  try{const r=await fetch('/api/pressing?kind=job&id='+encodeURIComponent(id)),d=await r.json() as {job:CareJob;events:CareEvent[];error?:string};if(!r.ok)throw Error(d.error||'Couldn’t open this request. Try again.');if(ticket===selection.current)setJob(d)}
  catch(e){if(ticket===selection.current)notice(e instanceof Error?e.message:'Couldn’t open this request. Try again.')}
 }
 async function messageProvider(p:Provider){if(!gate())return;const r=await net.act({action:'start_thread',to:p.profileId,context:'Comic Workshop · '+p.name});if(r?.threadId){closeAll();await onOpenThread(r.threadId)}}
 function startQuote(p:Provider){if(!gate())return;setDetail(null);setQuoteFor(p);window.scrollTo?.({top:0,behavior:'smooth'})}
 function registerStudio(){if(!me){onRegister();return}if(!gate())return;closeAll();setView('studio');setEditing(true)}
 function clearFilters(){setQuery('');setLocation('');setRadius('nationwide');setService('all');setAccepting(false)}
 function browse(){if(!signedIn){gate();return}closeAll();setEditing(false);setView('find');requestAnimationFrame(()=>document.getElementById('ws-find')?.scrollIntoView({behavior:'smooth',block:'start'}))}

 const results=filterWorkshopProviders(data.providers,{query,service,accepting}).sort((a,b)=>location?((a.distanceMiles??Infinity)-(b.distanceMiles??Infinity))||((b.rating??-1)-(a.rating??-1)):((b.rating??-1)-(a.rating??-1))||b.reviewCount-a.reviewCount||a.name.localeCompare(b.name));
 const hasFilters=Boolean(query||location||service!=='all'||accepting);
 const customerJobs=data.jobs.filter(j=>!j.isProvider),providerJobs=data.jobs.filter(j=>j.isProvider);
 const openCount=(jobs:CareJob[])=>jobs.filter(j=>!['completed','cancelled','declined'].includes(j.status)).length;
 const step:1|2|3=quoteFor?3:detail?2:1;
 if(tab!=='Pressing')return null;
 const headerRed=view==='find'&&step===1&&signedIn&&ready&&!error&&results.length>0;

 return <div className="ws">
  <PageHeader eyebrow="Comic Workshop" title="Good books." accent="Careful hands." lede="Find pros near you who press, clean and prep comics for grading." pose="workshop" caption="THE WORKSHOP" line="Find a pro near you."
   actions={<><button type="button" className={'ds-btn '+(headerRed?'ds-btn-primary':'ds-btn-secondary')} onClick={browse}><Search size={17} aria-hidden="true"/> Find a studio</button><button type="button" className="ds-link" onClick={registerStudio}>{data.mine?'Manage my studio':'List your studio'}</button></>}/>
  <nav className="ws-tabs" aria-label="Comic Workshop">{([['find','Find a studio',Search,0],['requests','My requests',Package,openCount(customerJobs)],['studio','My studio',Wrench,openCount(providerJobs)]] as const).map(([id,name,Icon,count])=><button key={id} type="button" aria-current={view===id?'page':undefined} className={view===id?'active':''} onClick={()=>{closeAll();setEditing(false);setView(id)}}><Icon size={17} aria-hidden="true"/>{name}{count>0&&<b aria-label={count+' open'}>{count}</b>}</button>)}</nav>

  {!signedIn&&<EmptyState title="Sign in to find a studio" message="It’s free. Search studios, read reviews and ask for quotes." action={{label:'Sign in or join free',onClick:()=>{gate()}}}/>}
  {signedIn&&error&&<div className="ws-error"><ErrorState compact message="Couldn’t load studios. Try again." action={{label:refreshing?'Trying again…':'Try again',onClick:()=>void refresh()}}/>{hasFilters&&<button type="button" className="ds-link" onClick={clearFilters}>Clear filters</button>}</div>}
  {signedIn&&!ready&&!error&&<LoadingState message="Loading studios…"/>}

  {signedIn&&ready&&view==='find'&&<>
   <Steps step={step}/>
   {step===1&&<section id="ws-find" className="ws-find" aria-labelledby="ws-find-title">
    <div className="ds-card ws-search">
     <h2 id="ws-find-title" className="ws-section-title">Find a studio near you</h2>
     <p className="ws-help">Start with your city or ZIP code.</p>
     <LocationRadiusFilter location={location} radius={radius} onChange={(value,next)=>{setLocation(value);setRadius(next)}}/>
     <div className="ws-filter-row">
      <label>Service<select value={service} onChange={e=>setService(e.target.value as CareService|'all')}><option value="all">All services</option>{careServices.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>Studio name<input type="search" value={query} maxLength={100} onChange={e=>setQuery(e.target.value)} placeholder="Name or specialty"/></label>
      <label className="ws-check"><input type="checkbox" checked={accepting} onChange={e=>setAccepting(e.target.checked)}/> Taking requests now</label>
     </div>
    </div>
    <div className="ws-count"><p role="status">{refreshing?'Updating results…':`${results.length} ${results.length===1?'studio':'studios'}${location?' near you':''}`}{data.hasMore?'. Showing the first 200. Try a smaller area.':''}</p>{hasFilters&&<button type="button" className="ds-link" onClick={clearFilters}><X size={15} aria-hidden="true"/> Clear filters</button>}</div>
    {results.length?<div className="ws-grid">{results.map(p=><ProviderCard key={p.id} p={p} mine={p.profileId===me?.id} onOpen={()=>void openProvider(p.id)} onQuote={()=>startQuote(p)}/>)}</div>
    :data.providers.length?<EmptyState title="No studios match" message="Try a wider distance or another service." action={hasFilters?{label:'Clear filters',onClick:clearFilters}:undefined}/>
    :<EmptyState title="No studios listed yet" message="Studios show up here once they sign up. Do you press or clean comics? List your studio." action={{label:data.mine?'Manage my studio':'List your studio',onClick:registerStudio}}/>}
   </section>}
   {step===2&&detail&&<ProviderProfile detail={detail} meId={me?.id} busy={busy} onBack={()=>setDetail(null)} onQuote={()=>startQuote(detail.provider)} onMessage={()=>void messageProvider(detail.provider)} onEdit={registerStudio}
     onReview={()=>{if(gate())setReviewFor(detail.provider)}} onReport={(type,id)=>{if(gate())setReport({type,id})}}
     onDeleteReview={async id=>{if(await act({action:'delete_review',reviewId:id})){notice('Your review was removed.');await openProvider(detail.provider.id)}}}/>}
   {step===3&&quoteFor&&<QuoteRequest provider={quoteFor} vault={vault} busy={busy} openCollection={()=>{setQuoteFor(null);openCollection()}} onBack={()=>void openProvider(quoteFor.id)}
     onSave={async fields=>{const r=await act({action:'request',providerId:quoteFor.id,...fields});if(r?.jobId){setQuoteFor(null);setView('requests');await openJob(r.jobId);notice('Quote request sent. The studio will reply in Messages.')}}}/>}
  </>}

  {signedIn&&ready&&view==='requests'&&<section className="ws-panel" aria-labelledby="ws-requests-title">
   <div className="ws-section-head"><h2 id="ws-requests-title" className="ws-section-title">My requests</h2><button type="button" className="ds-link" disabled={refreshing} onClick={()=>void refresh()}><RefreshCw size={15} aria-hidden="true"/> Refresh</button></div>
   {!me?<ProfileNeeded onCreate={()=>gate()}/>:customerJobs.length?<JobList jobs={customerJobs} onOpen={id=>void openJob(id)}/>
   :<EmptyState title="No requests yet" message="Find a studio and ask for a quote." action={{label:'Find a studio',onClick:()=>setView('find')}}/>}
  </section>}

  {signedIn&&ready&&view==='studio'&&<section className="ws-panel" aria-labelledby="ws-studio-title">
   {!me?<><h2 id="ws-studio-title" className="ws-section-title">My studio</h2><ProfileNeeded onCreate={onRegister}/></>
   :editing||!data.mine?<>
     <div className="ws-section-head"><div><h2 id="ws-studio-title" className="ws-section-title">{data.mine?'Edit my studio':'List your studio'}</h2>{!data.mine&&<p className="ws-help">Do you press or clean comics? List your studio. It’s free.</p>}</div>{data.mine&&<button type="button" className="ds-link" onClick={()=>setEditing(false)}><ArrowLeft size={15} aria-hidden="true"/> Back to requests</button>}</div>
     {!editing&&!data.mine?<EmptyState title="Do you press or clean comics?" message="List your studio for free. Collectors near you can find you, read reviews and ask for quotes." action={{label:'List your studio',onClick:()=>setEditing(true)}}/>
     :<ProviderForm provider={data.mine} me={me} busy={busy} notice={notice} onCancel={()=>setEditing(false)} onSave={async fields=>{if(await act({action:'provider',...fields})){setEditing(false);await net.refresh();notice('Your studio is saved.')}}}/>}
   </>:<>
     <div className="ws-section-head"><h2 id="ws-studio-title" className="ws-section-title">{data.mine.name}</h2><div className="ws-actions"><button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" onClick={()=>void openProvider(data.mine!.id)}>See public page <ArrowUpRight size={15} aria-hidden="true"/></button><button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" onClick={()=>setEditing(true)}>Edit studio <Wrench size={15} aria-hidden="true"/></button></div></div>
     <ul className="ws-summary"><li><span className={'ws-pill '+(data.mine.visible?'ws-pill-open':'ws-pill-paused')}>{data.mine.visible?'Listed':'Hidden'}</span></li><li>{data.mine.accepting?'Taking new requests':'New requests paused'}</li><li><Stars value={data.mine.rating}/> {data.mine.reviewCount} {data.mine.reviewCount===1?'review':'reviews'}</li></ul>
     <h3 className="ws-subtitle">Incoming requests</h3>
     {providerJobs.length?<JobList jobs={providerJobs} onOpen={id=>void openJob(id)}/>:<EmptyState compact title="No requests yet" message="New quote requests show up here and in Messages."/>}
   </>}
  </section>}

  <div className="ws-footnote">
   <p><ShieldCheck size={17} aria-hidden="true"/>Independent pros. You pay them directly. Pressing can’t guarantee a grade.</p>
   <HowItWorks title="How the Workshop works">
    <p>Studios are independent businesses. You agree on price, payment and shipping with them. ComicHuddle doesn’t charge you.</p>
    <p>Results are sorted by distance if you add a city, then by member reviews. Nobody can pay to rank higher.</p>
    <p>Only collectors who accepted a quote can leave a review. “Confirmed” means the collector got their comic back.</p>
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

function ProfileNeeded({onCreate}:{onCreate:()=>void}){return <EmptyState title="Make your free profile first" message="You need one to ask for quotes or list a studio." action={{label:'Create my profile',onClick:onCreate}}/>}

function JobList({jobs,onOpen}:{jobs:CareJob[];onOpen:(id:string)=>void}){
 return <ul className="ws-jobs">{jobs.map(j=><li key={j.id}><button type="button" onClick={()=>onOpen(j.id)}><div><strong>{j.isProvider?j.requesterName:j.providerName}</strong><small>{j.books.length} {j.books.length===1?'comic':'comics'} · {j.services.map(label).join(', ')} · updated {day(j.updatedAt)}</small></div><span className={'ws-status ws-status-'+j.status}>{careStatuses[j.status]||j.status}</span><ArrowRight size={18} aria-hidden="true"/></button></li>)}</ul>;
}

function ProviderProfile({detail,meId,busy,onBack,onQuote,onMessage,onEdit,onReview,onReport,onDeleteReview}:{detail:Detail;meId?:string;busy:boolean;onBack:()=>void;onQuote:()=>void;onMessage:()=>void;onEdit:()=>void;onReview:()=>void;onReport:(type:string,id:string)=>void;onDeleteReview:(id:string)=>Promise<void>}){
 const {provider:p,reviews}=detail,own=p.profileId===meId,mineReview=reviews.some(r=>r.mine),publicReviews=reviews.filter(r=>r.verified!==false);
 return <section className="ds-card ws-profile" aria-labelledby="ws-profile-title">
  <button type="button" className="ds-link ws-back" onClick={onBack}><ArrowLeft size={16} aria-hidden="true"/> Back to results</button>
  <div className="ws-profile-head">
   <div className="ws-avatar">{p.logoId?<img src={'/api/media?id='+p.logoId} alt=""/>:p.name.slice(0,2).toUpperCase()}</div>
   <div><h2 id="ws-profile-title">{p.name}</h2><p className="ws-meta"><MapPin size={15} aria-hidden="true"/>{place(p)} · run by @{p.collector.handle}</p><p className="ws-meta"><Stars value={p.rating} size={16}/><span>{p.reviewCount} verified {p.reviewCount===1?'review':'reviews'}</span></p></div>
  </div>
  <div className="ws-actions ws-profile-actions">{own?<button type="button" className="ds-btn ds-btn-primary" onClick={onEdit}>Edit my studio <Wrench size={16} aria-hidden="true"/></button>:<><button type="button" className="ds-btn ds-btn-primary" disabled={!p.accepting} onClick={onQuote}>Request a quote <ArrowRight size={16} aria-hidden="true"/></button><button type="button" className="ds-btn ds-btn-secondary" onClick={onMessage}><MessageCircle size={16} aria-hidden="true"/> Message</button></>}{p.website&&<a className="ds-link" href={p.website} target="_blank" rel="noreferrer">Website <ArrowUpRight size={15} aria-hidden="true"/></a>}</div>
  {!p.accepting&&!own&&<p className="ws-note">This studio isn’t taking new requests right now. You can still send a message.</p>}
  <div className="ws-profile-grid">
   <div>
    <h3 className="ws-subtitle">About</h3><p className="ws-bio">{p.bio}</p>
    {p.specialties&&<p><b>Specialties:</b> {p.specialties}</p>}
    <h3 className="ws-subtitle">Services &amp; prices</h3>
    <table className="ws-prices"><thead><tr><th scope="col">Service</th><th scope="col">Starts at</th></tr></thead><tbody>{p.services.map(s=><tr key={s}><th scope="row">{label(s)}<small>{careServices.find(v=>v.id===s)?.description}</small></th><td>{p.prices[s]!=null?usd(p.prices[s]!)+' a book':'Ask for a price'}</td></tr>)}</tbody></table>
    <p className="ws-help">The studio sets prices. Your quote shows the final cost.</p>
   </div>
   <aside className="ws-facts" aria-label="Studio details">
    <div><small>Turnaround</small><b>{p.turnaroundMin}–{p.turnaroundMax} business days</b><span>Not counting shipping or grading</span></div>
    <div><small>How to send books</small><b>{[p.mailIn&&'Mail-in',p.dropoff&&'Local drop-off'].filter(Boolean).join(' or ')||'Ask the studio'}</b></div>
    <div><small>CGC submission</small><b>{p.submissionMode==='dealer'?'Sends to CGC for you (dealer)':p.submissionMode==='prepare_only'?'Preps books, you send them':'Not offered'}</b>{p.submissionMode==='dealer'&&<span>The studio told us this. <a href={cgcLinks.dealers} target="_blank" rel="noreferrer">Check CGC’s dealer list</a></span>}</div>
    <div><small>Pressing since</small><b>{p.experienceSince}</b></div>
   </aside>
  </div>
  <h3 className="ws-subtitle">Before &amp; after</h3>
  {p.portfolio.length>0?<div className="ws-portfolio">{p.portfolio.map((pair,i)=><figure key={i}><div><img src={'/api/media?id='+pair.before} alt={'Before: '+pair.caption}/><img src={'/api/media?id='+pair.after} alt={'After: '+pair.caption}/></div><figcaption>{pair.caption}</figcaption></figure>)}</div>
  :<p className="ws-help">No before-and-after photos yet. Ask for examples first.</p>}
  {p.terms&&<HowItWorks title="Studio terms"><p className="ws-pre">{p.terms}</p></HowItWorks>}
  <div className="ws-section-head"><h3 className="ws-subtitle">Reviews</h3>{!own&&(detail.canReview?<button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" onClick={onReview}><Star size={15} aria-hidden="true"/> {mineReview?'Edit my review':'Write a review'}</button>:<span className="ws-help">Only collectors who accepted a quote can review.</span>)}</div>
  {publicReviews.length>0&&<dl className="ws-category">{([['quality','Quality of work'],['communication','Communication'],['timeliness','Timeliness']] as const).map(([k,name])=><div key={k}><dt>{name}</dt><dd>{p.categoryRatings[k]===null?'—':p.categoryRatings[k]!.toFixed(1)+' / 5'}</dd></div>)}</dl>}
  {reviews.length?<ul className="ws-reviews">{reviews.map(r=><li key={r.id}><div className="ws-review-top"><Stars value={r.rating}/>{r.verified===false?<span className="ws-badge ws-badge-muted">Not verified · only you can see this</span>:<span className="ws-badge"><Check size={13} aria-hidden="true"/> Verified customer{r.completedRequest?' · Confirmed':''}</span>}</div><h4>{r.title}</h4><p>{r.body}</p><div className="ws-review-foot"><span>@{r.author.handle} · {day(r.updatedAt)}</span>{r.mine?<button type="button" disabled={busy} onClick={()=>void onDeleteReview(r.id)}>Delete my review</button>:<button type="button" onClick={()=>onReport('care_review',r.id)}><Flag size={14} aria-hidden="true"/> Report</button>}</div></li>)}</ul>:<p className="ws-help">No reviews yet.</p>}
  {!own&&<p className="ws-report-line"><button type="button" className="ds-link" onClick={()=>onReport('care_provider',p.id)}><Flag size={14} aria-hidden="true"/> Report this studio</button></p>}
 </section>;
}

function QuoteRequest({provider:p,vault,busy,openCollection,onBack,onSave}:{provider:Provider;vault:Vault;busy:boolean;openCollection:()=>void;onBack:()=>void;onSave:(f:Record<string,unknown>)=>Promise<void>}){
 const [books,setBooks]=useState<string[]>([]),[selected,setSelected]=useState<CareService[]>(p.services.includes('pressing')?['pressing']:[p.services[0]]),[method,setMethod]=useState<'mail'|'dropoff'>(p.mailIn?'mail':'dropoff');
 const both=p.mailIn&&p.dropoff;
 return <section className="ds-card ws-quote" aria-labelledby="ws-quote-title">
  <button type="button" className="ds-link ws-back" onClick={onBack}><ArrowLeft size={16} aria-hidden="true"/> Back to {p.name}</button>
  <h2 id="ws-quote-title" className="ws-section-title">Request a quote from {p.name}</h2>
  <p className="ws-help">It’s free. The studio sends a price. Nothing happens until you accept.</p>
  {!vault.books.length?<EmptyState compact title="Add a comic first" message="Quotes are for comics in your collection." action={{label:'Open my collection',onClick:openCollection}}/>
  :<form className="ws-form" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await onSave({bookIds:books,declaredValues:{},services:selected,notes:String(f.get('notes')||''),sendToCgc:f.get('sendToCgc')==='on',method,scopeConsent:true})}}>
   <fieldset><legend><span className="ws-num">1</span> Pick your comics <small>({books.length} of 20)</small></legend><div className="ws-book-list">{vault.books.map(b=><label key={b.id} className={books.includes(b.id)?'selected':''}><input type="checkbox" checked={books.includes(b.id)} disabled={!books.includes(b.id)&&books.length>=20} onChange={()=>setBooks(v=>v.includes(b.id)?v.filter(id=>id!==b.id):[...v,b.id])}/><span><strong>{b.title} {b.issue}</strong>{b.grade&&<small>{b.grade}</small>}</span></label>)}</div></fieldset>
   <fieldset><legend><span className="ws-num">2</span> Pick services</legend><div className="ws-chips">{p.services.map(s=><label key={s}><input type="checkbox" checked={selected.includes(s)} onChange={()=>setSelected(v=>v.includes(s)?v.filter(x=>x!==s):[...v,s])}/><span>{label(s)}{p.prices[s]!=null&&<small> · from {usd(p.prices[s]!)}</small>}</span></label>)}</div>
    {selected.includes('cgc')&&(p.submissionMode==='dealer'?<label className="ws-check"><input name="sendToCgc" type="checkbox"/> Ask the studio to send my comics to CGC afterward</label>:<p className="ws-help">This studio preps books only. You send them to CGC yourself.</p>)}</fieldset>
   <fieldset><legend><span className="ws-num">3</span> How you’ll send them</legend>{both?<div className="ws-chips">{(['mail','dropoff'] as const).map(m=><label key={m}><input type="radio" name="method" checked={method===m} onChange={()=>setMethod(m)}/><span>{m==='mail'?'Mail them in':'Drop them off'}</span></label>)}</div>:<p className="ws-help">This studio takes {p.mailIn?'mail-in only':'local drop-off only'}.</p>}</fieldset>
   <fieldset><legend><span className="ws-num">4</span> Anything else?</legend>
    <label>Notes for the studio <span className="ws-optional">(optional)</span><textarea name="notes" maxLength={2000} placeholder="Condition worries, signatures, fragile covers or questions."/></label>
    <label className="ws-check"><input required type="checkbox"/> <span>This is for pressing, cleaning or a check-up, not restoration. See the {rules}.</span></label>
   </fieldset>
   <div className="ws-submit"><button className="ds-btn ds-btn-primary" disabled={busy||!books.length||!selected.length}>{busy?'Sending…':'Send quote request'} <ArrowRight size={16} aria-hidden="true"/></button>{!books.length&&<span className="ws-help">Pick at least one comic.</span>}</div>
  </form>}
 </section>;
}

const studioParts=['Your studio','Services & prices','Intake & turnaround','Terms','Extras','Publish'];
function Legend({n}:{n:number}){return <legend><span className="ws-num">{n}</span> {studioParts[n-1]}</legend>}

export function ProviderForm({provider:p,me,busy,notice,onSave,onCancel}:{provider:Provider|null;me:CollectorProfile;busy:boolean;notice:(s:string)=>void;onSave:(f:Record<string,unknown>)=>Promise<void>;onCancel:()=>void}){
 const [selected,setSelected]=useState<CareService[]>(p?.services||['pressing','dry_cleaning']),[mode,setMode]=useState<Provider['submissionMode']>(p?.submissionMode&&p.submissionMode!=='none'?p.submissionMode:'prepare_only'),[mailIn,setMailIn]=useState(p?.mailIn??true),[logo,setLogo]=useState(p?.logoId||null),[portfolio,setPortfolio]=useState(p?.portfolio||[]),[pending,setPending]=useState({before:'',after:'',caption:''}),[uploading,setUploading]=useState('');
 const year=new Date().getFullYear(),blocked=!me.visible||!me.dmOpen;
 async function photo(file:File|undefined,target:string){if(!file)return;setUploading(target);try{const id=await uploadPhoto(file);if(target==='logo')setLogo(id);else setPending(v=>({...v,[target]:id}))}catch(e){notice(e instanceof Error?e.message:'Photo didn’t upload. Try again.')}finally{setUploading('')}}
 const jump=(n:number)=>{const el=document.getElementById('ws-part-'+n);if(el instanceof HTMLDetailsElement)el.open=true;el?.scrollIntoView({behavior:'smooth',block:'start'})};
 return <form className="ws-form ws-studio-form" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);if(pending.before||pending.after){notice('Add or discard the unfinished before/after pair first.');return}const prices:Partial<Record<CareService,number|null>>={};selected.forEach(s=>prices[s]=f.get('price-'+s)===''?null:amount(f,'price-'+s));const zip=String(f.get('locationZip')||'').trim(),cgc=selected.includes('cgc');
  await onSave({name:String(f.get('name')),bio:String(f.get('bio')),location:String(f.get('location')),...(zip?{locationZip:zip}:{}),specialties:String(f.get('specialties')||''),experienceSince:Number(f.get('experienceSince')||year),turnaroundMin:Number(f.get('min')),turnaroundMax:Number(f.get('max')),mailIn,dropoff:f.get('dropoff')==='on',accepting:f.get('accepting')==='on',visible:f.get('visible')==='on',website:String(f.get('website')||''),services:selected,prices,submissionMode:cgc?mode:'none',dealerReference:cgc&&mode==='dealer'?String(f.get('dealerReference')||''):'',dealerAttest:f.get('dealerAttest')==='on',logoId:logo,portfolio,shippingAddress:mailIn?String(f.get('shippingAddress')||''):'',shippingNotes:String(f.get('shippingNotes')||''),terms:String(f.get('terms')),attest:true})}}>
  <ol className="ds-steps ws-form-steps" aria-label="Form sections">{studioParts.map((name,i)=><li key={name}><button type="button" onClick={()=>jump(i+1)}><span className="ws-num">{i+1}</span>{name}</button></li>)}</ol>
  {blocked&&<p className="ws-alert" role="alert">Make your profile public and turn on messages first (My Profile → Edit).</p>}
  <fieldset id="ws-part-1"><Legend n={1}/>
   <label>Studio name<input required name="name" maxLength={80} defaultValue={p?.name||''} placeholder="e.g. North Star Pressing"/></label>
   <div className="ws-row"><label>City, state<input required name="location" maxLength={100} defaultValue={p?.location||me.location} placeholder="Minneapolis, MN"/><small className="ws-help">City and state only, like Minneapolis, MN.</small></label><label>ZIP code <span className="ws-optional">(optional)</span><input name="locationZip" inputMode="numeric" pattern="[0-9]{5}" maxLength={5} defaultValue={p?.locationZip||''} placeholder="55401"/><small className="ws-help">Lets collectors find you by distance.</small></label></div>
   <label>About your work<textarea required name="bio" maxLength={1200} defaultValue={p?.bio||''} placeholder="Your experience and how you handle collectors’ books."/></label>
  </fieldset>
  <fieldset id="ws-part-2"><Legend n={2}/>
   <div className="ws-service-rows">{careServices.map(s=>{const on=selected.includes(s.id);return <div key={s.id} className={on?'on':''}><label className="ws-check"><input type="checkbox" checked={on} onChange={()=>setSelected(v=>on?v.filter(x=>x!==s.id):[...v,s.id])}/><span><strong>{s.name}</strong><small>{s.description}</small></span></label>{on&&<label className="ws-price-input">From ($ a book)<input name={'price-'+s.id} type="number" min="0" max="1000000" step="0.01" defaultValue={p?.prices[s.id]!=null?p.prices[s.id]!/100:''} placeholder="Blank = quote"/></label>}</div>})}</div>
   {!selected.length&&<p className="ds-error" role="alert">Pick at least one service.</p>}
   {selected.includes('cgc')&&<div className="ws-box"><label>CGC support<select value={mode} onChange={e=>setMode(e.target.value as Provider['submissionMode'])}><option value="prepare_only">I prep books; the customer sends them</option><option value="dealer">I send them for customers (CGC dealer)</option></select></label>{mode==='dealer'&&<><label>Link that shows your dealer status<input name="dealerReference" type="url" pattern="https://.*" required maxLength={500} defaultValue={p?.dealerReference||''} placeholder="https://"/></label><label className="ws-check"><input name="dealerAttest" type="checkbox" required/> <span>I’m a current CGC dealer. I’ll ask each customer before sending.</span></label></>}</div>}
  </fieldset>
  <fieldset id="ws-part-3"><Legend n={3}/>
   <div className="ws-row"><label>Fastest (business days)<input name="min" required type="number" min="1" max="365" defaultValue={p?.turnaroundMin||7}/></label><label>Slowest (business days)<input name="max" required type="number" min="1" max="365" defaultValue={p?.turnaroundMax||21}/></label></div>
   <label className="ws-check"><input type="checkbox" checked={mailIn} onChange={e=>setMailIn(e.target.checked)}/> Take books by mail</label>
   {mailIn&&<label>Mail-in address <span className="ws-optional">(private)</span><textarea required name="shippingAddress" maxLength={1000} defaultValue={p?.shippingAddress||''} placeholder="Name, street, city, state, ZIP"/><small className="ws-help"><Lock size={14} aria-hidden="true"/> Only shown after a customer accepts your quote.</small></label>}
   <label className="ws-check"><input name="dropoff" type="checkbox" defaultChecked={p?.dropoff??false}/> Offer local drop-off</label>
   <label>Packing or drop-off tips <span className="ws-optional">(optional, private)</span><textarea name="shippingNotes" maxLength={1500} defaultValue={p?.shippingNotes||''}/></label>
  </fieldset>
  <fieldset id="ws-part-4"><Legend n={4}/>
   <label>Your service terms<textarea required name="terms" maxLength={2000} defaultValue={p?.terms||'Pressing and dry cleaning only. No restoration. Payment, insurance and return shipping are agreed in each quote.'}/><small className="ws-help">Collectors see these before they accept a quote.</small></label>
  </fieldset>
  <details id="ws-part-5" className="ws-details"><summary><span className="ws-num">5</span> Extras <span className="ws-optional">(optional: specialties, website, logo, photos)</span></summary>
   <div className="ws-details-body">
   <div className="ws-row"><label>Specialties<input name="specialties" maxLength={300} defaultValue={p?.specialties||''} placeholder="Golden Age, modern keys…"/></label><label>Pressing since<input name="experienceSince" type="number" min={1930} max={year} defaultValue={p?.experienceSince||year}/></label></div>
   <label>Website<input type="url" name="website" pattern="https://.*" maxLength={500} defaultValue={p?.website||''} placeholder="https://"/></label>
   <div className="ws-upload">{logo?<img src={'/api/media?id='+logo} alt="Studio logo preview"/>:<Wrench size={26} aria-hidden="true"/>}<label className="ds-btn ds-btn-secondary ds-btn-sm">{uploading==='logo'?'Uploading…':logo?'Replace logo':'Upload logo'}<input type="file" hidden accept="image/jpeg,image/png,image/webp" disabled={!!uploading} onChange={e=>void photo(e.target.files?.[0],'logo')}/></label>{logo&&<button type="button" className="ds-link" onClick={()=>setLogo(null)}>Remove</button>}</div>
   {portfolio.length>0&&<div className="ws-portfolio">{portfolio.map((pair,i)=><figure key={i}><div><img src={'/api/media?id='+pair.before} alt="Before"/><img src={'/api/media?id='+pair.after} alt="After"/></div><figcaption>{pair.caption}<button type="button" aria-label={'Remove example '+(i+1)} onClick={()=>setPortfolio(v=>v.filter((_,n)=>n!==i))}><X size={16} aria-hidden="true"/></button></figcaption></figure>)}</div>}
   {portfolio.length<4&&<div className="ws-box"><p className="ws-help">Add up to 4 before-and-after pairs. Use your own photos.</p><div className="ws-row">{(['before','after'] as const).map(target=><label key={target} className="ws-photo-drop">{pending[target]?<img src={'/api/media?id='+pending[target]} alt={target+' preview'}/>:<ImagePlus size={24} aria-hidden="true"/>}<span>{uploading===target?'Uploading…':target==='before'?'Before photo':'After photo'}</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={!!uploading} onChange={e=>void photo(e.target.files?.[0],target)}/></label>)}</div><label>Caption<input value={pending.caption} maxLength={200} onChange={e=>setPending(v=>({...v,caption:e.target.value}))} placeholder="Which book and what you did"/></label><div className="ws-actions"><button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" disabled={!pending.before||!pending.after||!pending.caption.trim()} onClick={()=>{setPortfolio(v=>[...v,pending]);setPending({before:'',after:'',caption:''})}}><Plus size={15} aria-hidden="true"/> Add pair</button>{(pending.before||pending.after)&&<button type="button" className="ds-link" onClick={()=>setPending({before:'',after:'',caption:''})}>Discard</button>}</div></div>}
   </div>
  </details>
  <fieldset id="ws-part-6"><Legend n={6}/>
   <label className="ws-check"><input name="accepting" type="checkbox" defaultChecked={p?.accepting??true}/> Taking new quote requests</label>
   <label className="ws-check"><input name="visible" type="checkbox" defaultChecked={p?.visible??true}/> Show my studio in the Workshop</label>
   <label className="ws-check"><input type="checkbox" required/> <span>My details are true and the photos are mine. Pressing can’t promise a grade. See the {rules}.</span></label>
  </fieldset>
  <div className="ws-submit"><button className="ds-btn ds-btn-primary" disabled={busy||!!uploading||!selected.length||blocked}>{busy?'Saving…':p?'Save changes':'List my studio'} <Check size={16} aria-hidden="true"/></button><button type="button" className="ds-link" onClick={onCancel}>Cancel</button></div>
 </form>;
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
   {j.method==='mail'&&<label>Your return address <span className="ws-optional">(only this studio sees it)</span><textarea name="returnAddress" required maxLength={1000} placeholder="Name, street, city, state, ZIP"/></label>}
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
