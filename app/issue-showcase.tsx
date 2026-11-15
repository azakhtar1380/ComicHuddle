'use client';
// Issue product page: cover, key-issue story, buy/collect/want actions and tabs for
// sales & value, characters and bibliographic details. Data: /api/issues/{id}/profile
// (characters, first appearances) and /api/issues/{id}/insights (sales & value).
import {useEffect,useState,type MouseEvent,type ReactNode} from 'react';
import {BookOpen,Bookmark,ChartNoAxesColumn,Heart,Info,ShieldCheck,ShoppingCart,Star,TrendingDown,TrendingUp,Users,Minus} from 'lucide-react';
import type {Issue} from '../lib/catalog';
import type {CollectionEntry} from '../lib/collection-entry';
import CollectionCopyDialog from '../architecture/postgres/ui/CollectionCopyDialog';
import {HuddlesPeek} from '../components/huddles-guide';
import './issue-showcase.css';

export type ProfileCharacter={characterId:number;name:string;portraitUrl:string|null;debut:boolean};
export type IssueProfile={issueId:number;metronId:number|null;status:'ready'|'pending'|'unavailable';keyIssue:boolean;keyReasons:string[];description:string|null;
 firstAppearances:{characterId:number;name:string;portraitUrl:string|null;source:'metron'|'wikidata'}[];characters:ProfileCharacter[];teams:string[];credits:{name:string;roles:string[]}[];attribution:string};
export type IssueInsights={issueId:number;currency:'USD';status:'available'|'limited'|'unavailable';
 headline:{value:number;low:number;high:number;grade:string|null;label:string|null;basis:string}|null;confidence:'high'|'medium'|'low'|null;
 lastSale:{amount:number;date:string;grade:string|null;label:string|null;venue:string;sourceUrl:string|null}|null;
 byGrade:{grade:string;label:string;mode:'Raw'|'CGC';value:number;low:number;high:number;sales:number;lastDate:string|null;source:string}[];
 recentSales:{date:string;amount:number;grade:string|null;label:string|null;venue:string;source:string;sourceUrl:string|null}[];
 asks:{count:number;low:number|null;median:number|null;high:number|null;source:string}[];auctions:{active:number;highestBid:number|null;endsAt:string|null};
 demand:{wants:number|null;collections:number|null};trend:{direction:'up'|'down'|'flat';changePct:number;windowDays:number}|null;coverPrice:string|null;
 insights:string[];sources:{name:string;url:string|null;note:string}[];missingSources:{name:string;setup:string}[];updatedAt:string};

type Tab='overview'|'sales'|'details';
/** Real character ids link to their page; placeholder ids (hand-entered names) do not. */
const characterLink=(c:{characterId:number;name:string},real:boolean)=>real?'/characters/'+c.characterId:null;
type Props={issue:Issue;cover:ReactNode;coverNote?:ReactNode;details:ReactNode;activeListingCount:number|null;marketplaceHref:string;onBuy:(event:MouseEvent<HTMLAnchorElement>)=>void;
 wanted:boolean;onWant:()=>void;ownedGrade:string|null;alreadyOwned:boolean;disabled?:boolean;beforeCollection:()=>boolean;onAddToCollection:(comicId:string,entry:CollectionEntry,requestId:string)=>Promise<void>};

const usd=(value:number)=>value.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:value>=100?0:2});
const day=(value:string)=>{const t=Date.parse(value);return Number.isFinite(t)?new Date(t).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):value};
const gradeText=(grade:string|null,label:string|null)=>grade?(label&&!/raw/i.test(label)?'CGC ':'')+grade:'Raw';
function joinNames(names:string[]){return names.length<2?names.join(''):names.slice(0,-1).join(', ')+' and '+names[names.length-1]}
/** Characters whose names start with "The" read naturally with the article ("the Joker"). */
function withArticle(name:string){return /^the /i.test(name)?'the '+name.slice(4):name}

function useJson<T>(url:string|null){
 const [state,setState]=useState<{url:string|null;data:T|null;failed:boolean}>({url:null,data:null,failed:false});
 useEffect(()=>{if(!url)return;const abort=new AbortController();
  fetch(url,{signal:abort.signal}).then(async response=>{if(!response.ok)throw Error();const data=await response.json() as T;setState({url,data,failed:false})}).catch(()=>{if(!abort.signal.aborted)setState({url,data:null,failed:true})});
  return()=>abort.abort()},[url]);
 return state.url===url?state:{url,data:null,failed:false};
}

export function Portrait({name,src,size='md'}:{name:string;src:string|null;size?:'sm'|'md'|'lg'|'xl'}){
 const [broken,setBroken]=useState(false);
 const initials=name.replace(/^the /i,'').split(/[\s-]+/).filter(Boolean).slice(0,2).map(word=>word[0]!.toUpperCase()).join('');
 return <span className={'is-portrait is-portrait-'+size} aria-hidden="true">{src&&!broken?<img src={src} alt="" loading="lazy" decoding="async" onError={()=>setBroken(true)}/>:<span className="is-monogram">{initials||'?'}</span>}</span>;
}

export default function IssueShowcase({issue,cover,coverNote,details,activeListingCount,marketplaceHref,onBuy,wanted,onWant,ownedGrade,alreadyOwned,disabled=false,beforeCollection,onAddToCollection}:Props){
 const [tab,setTab]=useState<Tab>('overview'),[collecting,setCollecting]=useState(false),[notice,setNotice]=useState('');
 const profile=useJson<IssueProfile>('/api/issues/'+issue.id+'/profile'),insights=useJson<IssueInsights>(tab==='sales'||tab==='overview'?'/api/issues/'+issue.id+'/insights':null);
 const p=profile.data,v=insights.data;
 // Curated issues carry hand-entered characters; use them until the profile answers.
 const fallbackCharacters:ProfileCharacter[]=(issue.characters||[]).map((name,index)=>({characterId:-1-index,name,portraitUrl:null,debut:false}));
 const characters=p?.characters.length?p.characters:fallbackCharacters;
 const debuts=p?.firstAppearances||[];
 const keyIssue=!!p?.keyIssue||debuts.length>0,realCharacters=!!p?.characters.length;
 const [showAll,setShowAll]=useState(false);
 const writers=(p?.credits||[]).filter(c=>c.roles.some(r=>/writer|script|story|plot/i.test(r))).map(c=>c.name).slice(0,3);
 const artists=(p?.credits||[]).filter(c=>c.roles.some(r=>/artist|pencil/i.test(r))).map(c=>c.name).slice(0,3);
 const coverArtists=(p?.credits||[]).filter(c=>c.roles.some(r=>/cover/i.test(r))).map(c=>c.name).slice(0,3);
 const keyLine=keyIssue?(p?.keyReasons.length?p.keyReasons.join(' · '):debuts.length?'First appearance of '+joinNames(debuts.map(d=>withArticle(d.name))):'Recorded as a key issue'):null;
 const description=p?.description||(debuts.length?(debuts.length===1?'A landmark issue: the debut of '+withArticle(debuts[0].name)+'.':'A landmark issue: the debut of '+joinNames(debuts.slice(0,4).map(d=>withArticle(d.name)))+'.'):issue.note&&!/^GCD bibliographic record/i.test(issue.note)?issue.note:null);
 const count=activeListingCount!==null&&Number.isSafeInteger(activeListingCount)&&activeListingCount>=0?activeListingCount:null;
 // Only real edition differences are named; GCD cover-notation notes (e.g. "Cover Number with Period") are not editions.
 const edition=/(variant|reprint|facsimile|second printing|\b[2-9](nd|rd|th) printing|newsstand|direct edition|price variant|virgin|incentive|1:\d+)/i.test(issue.variant||'')&&!/printing (must|to) be confirmed/i.test(issue.variant)?issue.variant:'Original issue';
 const tags=[issue.era&&issue.era!=='Date not recorded'?issue.era:null,debuts.length?(debuts.length===1?'First Appearance':'First Appearances'):null,issue.kind&&!/catalog issue/i.test(issue.kind)?issue.kind:null].filter((tag):tag is string=>!!tag);
 const tabs:[Tab,string,ReactNode][]=[['overview','Overview',null],['sales','Sales & Value',<ChartNoAxesColumn key="i" size={18}/>],['details','Details',<Info key="i" size={18}/>]];
 const snapshot=v?.headline?usd(v.headline.value)+(v.headline.grade?' · '+gradeText(v.headline.grade,v.headline.label):''):v?.lastSale?'Last sold '+usd(v.lastSale.amount):insights.data||insights.failed?'Sales data not available':'Checking sales…';
 return <article className="issue-showcase">
  <HuddlesPeek edge="top"/>
  <div className="is-hero">
   <div className="is-cover">{cover}{coverNote&&<div className="is-cover-note">{coverNote}</div>}</div>
   <div className="is-summary">
    <div className="is-meta">{keyIssue&&<span className="is-key"><Star size={16} fill="currentColor"/> Key Issue</span>}<span className="is-pub">{issue.publisher}{issue.year?<> <span aria-hidden="true">•</span> {issue.year}</>:null}</span></div>
    <h2 className="is-title">{issue.title} <span>#{issue.number.replace(/^#/,'')}</span></h2>
    {tags.length>0&&<div className="is-tags">{tags.map(tag=><span key={tag}>{tag}</span>)}</div>}
    {description&&<p className="is-description">{description}</p>}
    <div className="is-actions">
     <a href={marketplaceHref} onClick={onBuy} className="is-buy" aria-label={'Buy '+issue.title+' #'+issue.number}><ShoppingCart size={22}/><strong>Buy</strong><span>{count===null?'Check availability':count>0?count+(count===1?' copy':' copies')+' available':'No copies listed'}</span></a>
     <button type="button" className="is-collect" disabled={disabled} onClick={()=>{if(!beforeCollection())return;setNotice('');setCollecting(true)}}><Bookmark size={20}/>{alreadyOwned?'Add another copy':'Add to Collection'}</button>
     <button type="button" className={'is-want'+(wanted?' is-wanted':'')} disabled={disabled} aria-pressed={wanted} onClick={onWant}><Heart size={20} fill={wanted?'currentColor':'none'}/>{wanted?'On your want list':'Add to Wants'}</button>
    </div>
    {notice&&<p className="is-notice" role="status">{notice}</p>}
   </div>
  </div>

  <div className="is-tabs" role="tablist" aria-label="Issue information">{tabs.map(([id,label,icon])=><button key={id} type="button" role="tab" id={'is-tab-'+id} aria-selected={tab===id} aria-controls={'is-panel-'+id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{icon}{label}</button>)}</div>

  <div className="is-panel" role="tabpanel" id={'is-panel-'+tab} aria-labelledby={'is-tab-'+tab}>
   {tab==='overview'&&<>
    {debuts.length>0&&<section className="is-care"><h3><Star size={22} fill="currentColor"/> Why collectors care</h3><div className="is-care-grid">{debuts.slice(0,6).map(d=><a key={d.characterId} href={'/characters/'+d.characterId} className="is-care-card"><Portrait name={d.name} src={d.portraitUrl} size="lg"/><div><strong>{d.name}</strong><span>First appearance</span></div></a>)}</div></section>}
    <section className="is-inside" aria-labelledby="is-inside-title"><h3 id="is-inside-title"><BookOpen size={22}/> Inside this issue</h3>
     <div className={'is-keyline'+(keyIssue?' is-keyline-key':'')}>{keyIssue?<><Star size={18} fill="currentColor"/><span><strong>Key issue.</strong> {keyLine}.</span></>:p||profile.failed?<><Minus size={18}/><span><strong>Not a key issue.</strong> No first appearances or major events are recorded for this issue{p?.status==='pending'?' yet':''}.</span></>:<><span className="is-spinner" aria-hidden="true"/><span>Checking key-issue records…</span></>}</div>
     <div className="is-story"><h4>What happens</h4>{p?.description?<p>{p.description}</p>:!p&&!profile.failed?<p className="is-quiet"><span className="is-spinner" aria-hidden="true"/> Loading the story…</p>:description&&description!==p?.description?<p>{description}</p>:<p className="is-quiet">A story summary for this issue hasn&apos;t been gathered yet.</p>}</div>
     {(writers.length>0||artists.length>0||coverArtists.length>0)&&<dl className="is-crew">{writers.length>0&&<div><dt>Written by</dt><dd>{writers.join(', ')}</dd></div>}{artists.length>0&&<div><dt>Art by</dt><dd>{artists.join(', ')}</dd></div>}{coverArtists.length>0&&<div><dt>Cover by</dt><dd>{coverArtists.join(', ')}</dd></div>}</dl>}
     <h4>Characters{characters.length?' ('+characters.length+')':''}</h4>
     {characters.length>0?<div className="is-cast">{(showAll?characters:characters.slice(0,12)).map(c=>{const href=characterLink(c,realCharacters),body=<><Portrait name={c.name} src={c.portraitUrl}/><strong>{c.name}</strong>{c.debut&&<span>First appearance</span>}</>;return href?<a key={c.characterId+c.name} href={href} className={'is-castmember'+(c.debut?' debut':'')} aria-label={c.name+(c.debut?', first appearance':'')+' — open character page'}>{body}</a>:<div key={c.characterId+c.name} className={'is-castmember'+(c.debut?' debut':'')}>{body}</div>})}</div>
      :!p&&!profile.failed?<p className="is-loading" role="status"><span className="is-spinner" aria-hidden="true"/> Loading characters…</p>:<p className="is-quiet">{p?.status==='pending'?'The character list for this issue is being gathered. Check back soon.':'No character list is recorded for this issue yet.'}</p>}
     {characters.length>12&&<button type="button" className="is-more" onClick={()=>setShowAll(value=>!value)}>{showAll?'Show fewer characters':'Show all '+characters.length+' characters'}</button>}
     {p?.teams.length?<p className="is-teams"><strong>Teams:</strong> {p.teams.join(', ')}</p>:null}
     {p?.attribution&&<p className="is-source">{p.attribution}</p>}
    </section>
    <div className="is-stats">
     <button type="button" className="is-stat" onClick={()=>setTab('sales')}><ChartNoAxesColumn size={26}/><span><strong>Market Snapshot</strong><small>{snapshot}</small></span></button>
     <div className="is-stat"><ShieldCheck size={26}/><span><strong>Edition</strong><small>{edition}</small></span></div>
     <div className="is-stat"><Users size={26}/><span><strong>Collector Grade</strong><small>{ownedGrade||'Not specified'}</small></span></div>
    </div>
   </>}
   {tab==='sales'&&<SalesPanel state={insights}/>}
   {tab==='details'&&<section className="is-details">{p?.credits.length?<dl className="is-credits">{p.credits.slice(0,16).map(c=><div key={c.name}><dt>{c.roles.join(', ')}</dt><dd>{c.name}</dd></div>)}</dl>:null}{details}</section>}
  </div>
  <CollectionCopyDialog comicId={String(issue.id)} title={issue.title} issueNumber={issue.number} open={collecting} disabled={disabled} onClose={()=>setCollecting(false)} onSaved={setNotice} onAddToCollection={onAddToCollection}/>
 </article>;
}

function SalesPanel({state}:{state:{data:IssueInsights|null;failed:boolean}}){
 const v=state.data;
 if(!v)return state.failed?<p className="is-quiet">Sales and value data could not be loaded. Please retry in a moment.</p>:<p className="is-loading" role="status"><span className="is-spinner" aria-hidden="true"/> Gathering sales and value data…</p>;
 const Trend=v.trend?.direction==='up'?TrendingUp:v.trend?.direction==='down'?TrendingDown:Minus;
 return <section className="is-sales">
  <div className="is-value-head">
   <div className="is-value-main"><small>Typical value{v.headline?.grade?' · '+gradeText(v.headline.grade,v.headline.label):''}</small><strong>{v.headline?usd(v.headline.value):'—'}</strong>{v.headline&&<span>{usd(v.headline.low)} – {usd(v.headline.high)}</span>}{v.headline&&<em>{v.headline.basis}</em>}</div>
   <div className="is-value-facts">
    <div><small>Last sale</small><strong>{v.lastSale?usd(v.lastSale.amount):'None recorded'}</strong>{v.lastSale&&<span>{gradeText(v.lastSale.grade,v.lastSale.label)} · {day(v.lastSale.date)} · {v.lastSale.venue}</span>}</div>
    <div><small>Trend</small><strong className={'trend-'+(v.trend?.direction||'none')}><Trend size={18}/>{v.trend?(v.trend.changePct>0?'+':'')+v.trend.changePct.toFixed(0)+'%':'Not enough sales'}</strong>{v.trend&&<span>last {v.trend.windowDays} days</span>}</div>
    <div><small>Confidence</small><strong>{v.confidence?v.confidence[0].toUpperCase()+v.confidence.slice(1):'—'}</strong><span>{v.status==='available'?'Based on recorded sales':v.status==='limited'?'Limited data':'No recorded data yet'}</span></div>
   </div>
  </div>
  {v.insights.length>0&&<ul className="is-insights">{v.insights.map(text=><li key={text}>{text}</li>)}</ul>}
  {v.byGrade.length>0&&<div className="is-table-wrap"><table className="is-grade-table"><caption>Value by grade</caption><thead><tr><th scope="col">Grade</th><th scope="col">Value</th><th scope="col">Range</th><th scope="col">Sales</th><th scope="col">Source</th></tr></thead><tbody>{v.byGrade.map(row=><tr key={row.mode+row.grade+row.label}><th scope="row">{row.mode==='CGC'?'CGC '+row.grade+(row.label&&!/^(universal|label not specified)$/i.test(row.label)?' '+row.label:''):'Raw '+row.grade}</th><td>{usd(row.value)}</td><td>{usd(row.low)} – {usd(row.high)}</td><td>{row.sales}</td><td>{row.source}</td></tr>)}</tbody></table></div>}
  {v.recentSales.length>0&&<div className="is-table-wrap"><table className="is-grade-table"><caption>Recent sales</caption><thead><tr><th scope="col">Date</th><th scope="col">Price</th><th scope="col">Grade</th><th scope="col">Venue</th></tr></thead><tbody>{v.recentSales.map((sale,index)=><tr key={index}><th scope="row">{day(sale.date)}</th><td>{sale.sourceUrl?<a href={sale.sourceUrl} target="_blank" rel="noreferrer">{usd(sale.amount)}</a>:usd(sale.amount)}</td><td>{gradeText(sale.grade,sale.label)}</td><td>{sale.venue}</td></tr>)}</tbody></table></div>}
  <div className="is-market-grid">
   {v.asks.map(ask=><div key={ask.source}><small>{ask.source}</small><strong>{ask.count} listed</strong><span>{ask.low!==null?'From '+usd(ask.low)+(ask.median!==null?' · median '+usd(ask.median):''):'No asking prices'}</span></div>)}
   <div><small>Auctions</small><strong>{v.auctions.active} live</strong><span>{v.auctions.highestBid!==null?'High bid '+usd(v.auctions.highestBid):'No bids yet'}</span></div>
   <div><small>Demand</small><strong>{v.demand.wants??'—'} want it</strong><span>{v.demand.collections!==null?v.demand.collections+' in collections':'Collections not counted'}</span></div>
   {v.coverPrice&&<div><small>Original cover price</small><strong>{v.coverPrice}</strong><span>Publisher price at release</span></div>}
  </div>
  {(v.sources.length>0||v.missingSources.length>0)&&<p className="is-source">{v.sources.length>0&&<>Sources: {v.sources.map((s,i)=><span key={s.name}>{i?', ':''}{s.url?<a href={s.url} target="_blank" rel="noreferrer">{s.name}</a>:s.name}</span>)}. </>}Values are estimates for research, not appraisals. Updated {day(v.updatedAt)}.</p>}
 </section>;
}
