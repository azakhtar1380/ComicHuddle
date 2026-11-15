'use client';
// Comic detail card: prominent cover, buy/collect/want actions, then four plain sections —
// Comic information, Characters, Collector information and Market information — plus the full GCD
// record on demand. Every fact names its source (Metron, GCD, Wikidata, catalog entry, ComicHuddle
// community) and missing fields are hidden, never filled. Data: the issue record (props),
// /api/issues/{id}/profile (characters, verified first appearances, credits, description) and
// /api/issues/{id}/insights (recorded sales, listings, licensed values).
import {useEffect,useState,type MouseEvent,type ReactNode} from 'react';
import {ArrowUpRight,Bookmark,Heart,ShoppingCart,Star} from 'lucide-react';
import type {Issue} from '../lib/catalog';
import type {CollectionEntry} from '../lib/collection-entry';
import {catalogCharacters,catalogNote,detailCredits,editionInfo,gcdCharacterNames,gcdFirstAppearances,releaseInfo,type CreditLine,type Provenance} from '../lib/issue-insights-detail';
import {cgcSubmitUrl,goCollectIssueUrl} from '../lib/value-links';
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

type Props={issue:Issue;cover:ReactNode;coverNote?:ReactNode;
 /** @deprecated Not rendered: it duplicated the GoCollect/CGC links. The card renders the GCD record itself. */
 details?:ReactNode;
 /** Optional status line for the full-record fetch (e.g. "Loading…" / "Retry"), rendered in the GCD record section. */
 detailStatus?:ReactNode;
 activeListingCount:number|null;marketplaceHref:string;onBuy:(event:MouseEvent<HTMLAnchorElement>)=>void;
 wanted:boolean;onWant:()=>void;ownedGrade:string|null;alreadyOwned:boolean;disabled?:boolean;beforeCollection:()=>boolean;onAddToCollection:(comicId:string,entry:CollectionEntry,requestId:string)=>Promise<void>};

const usd=(value:number)=>value.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:value>=100?0:2});
const day=(value:string)=>{const t=Date.parse(value);return Number.isFinite(t)?new Date(t).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):value};
const gradeText=(grade:string|null,label:string|null)=>grade?(label&&!/raw/i.test(label)?'CGC ':'')+grade:'Raw';
const norm=(name:string)=>name.toLowerCase().replace(/^the /,'').replace(/[^a-z0-9]+/g,'');

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

/** Small provenance tag: "Verified · Metron", "Community", "Estimate", "Catalog entry". */
function Source({kind,children}:{kind:'verified'|'community'|'estimate'|'catalog';children:ReactNode}){
 return <span className={'is-prov is-prov-'+kind}>{children}</span>;
}
const sourceTag=(source:Provenance)=>source==='Catalog entry'?<Source kind="catalog">Catalog entry · not source-checked</Source>:<Source kind="verified">{source}</Source>;
function Credit({label,line}:{label:string;line:CreditLine|null}){
 if(!line)return null;
 const shown=line.names.slice(0,4),more=line.names.length-shown.length;
 return <div><dt>{label}</dt><dd>{shown.join(', ')}{more>0?' +'+more+' more':''}{line.note&&<small> · {line.note}</small>} {sourceTag(line.source)}</dd></div>;
}

export default function IssueShowcase({issue,cover,coverNote,detailStatus,activeListingCount,marketplaceHref,onBuy,wanted,onWant,ownedGrade,alreadyOwned,disabled=false,beforeCollection,onAddToCollection}:Props){
 const [collecting,setCollecting]=useState(false),[notice,setNotice]=useState(''),[showAll,setShowAll]=useState(false);
 const profile=useJson<IssueProfile>('/api/issues/'+issue.id+'/profile'),insights=useJson<IssueInsights>('/api/issues/'+issue.id+'/insights');
 const p=profile.data,profileLoading=!p&&!profile.failed;
 const number=issue.number.replace(/^#/,'');

 // ---- Comic information ----
 const credits=detailCredits(issue,p?.credits||[]);
 const release=releaseInfo(issue);
 const edition=editionInfo(issue);
 const publisher=issue.publisher&&!/not recorded/i.test(issue.publisher)?issue.publisher:null;
 const title=/^series metadata pending/i.test(issue.title)?null:issue.title;
 const gcdStory=(issue.bibliography?.stories||[]).find(s=>!/cover/i.test(s.type)&&s.synopsis);
 const summary:{text:string;source:Provenance}|null=p?.description?{text:p.description,source:'Metron'}:gcdStory?{text:gcdStory.synopsis,source:'GCD'}:catalogNote(issue)?{text:catalogNote(issue)!,source:'Catalog entry'}:null;

 // ---- Characters: Metron/Wikidata profile, else GCD character list, else curated entry ----
 const profileCharacters=p?.characters||[];
 const gcdNames=profileCharacters.length?[]:gcdCharacterNames(issue.bibliography);
 const curatedNames=profileCharacters.length||gcdNames.length?[]:catalogCharacters(issue);

 // ---- Collector information: first appearances only when a source states them ----
 const verifiedFirsts=p?.firstAppearances||[];
 const gcdFirsts=gcdFirstAppearances(issue.bibliography).filter(g=>!verifiedFirsts.some(v=>norm(v.name)===norm(g.name)));
 const firstCount=verifiedFirsts.length+gcdFirsts.length;
 const count=activeListingCount!==null&&Number.isSafeInteger(activeListingCount)&&activeListingCount>=0?activeListingCount:null;

 return <article className="issue-showcase">
  <HuddlesPeek edge="top"/>
  <div className="is-hero">
   <div className="is-cover">{cover}{coverNote&&<div className="is-cover-note">{coverNote}</div>}</div>
   <div className="is-summary">
    <p className="is-eyebrow">{[publisher,issue.year>0?String(issue.year):null].filter(Boolean).join(' · ')||'Comic issue'}</p>
    <h2 className="is-title">{title||'Untitled series'} <span>#{number}</span></h2>
    {firstCount>0&&<p className="is-key"><Star size={15} fill="currentColor" aria-hidden="true"/> First appearance{firstCount>1?'s':''}: {[...verifiedFirsts.map(f=>f.name),...gcdFirsts.map(f=>f.name)].slice(0,3).join(', ')}{firstCount>3?' +'+(firstCount-3):''}</p>}
    {summary&&<p className="is-description">{summary.text} {sourceTag(summary.source)}</p>}
    <div className="is-actions">
     <a href={marketplaceHref} onClick={onBuy} className="is-buy" aria-label={'Buy '+issue.title+' #'+number}><ShoppingCart size={20} aria-hidden="true"/><strong>Buy</strong><span>{count===null?'Check availability':count>0?count+(count===1?' copy':' copies')+' listed':'No copies listed'}</span></a>
     <button type="button" className="is-collect" disabled={disabled} onClick={()=>{if(!beforeCollection())return;setNotice('');setCollecting(true)}}><Bookmark size={18} aria-hidden="true"/>{alreadyOwned?'Add another copy':'Add to collection'}</button>
     <button type="button" className={'is-want'+(wanted?' is-wanted':'')} disabled={disabled} aria-pressed={wanted} onClick={onWant}><Heart size={18} fill={wanted?'currentColor':'none'} aria-hidden="true"/>{wanted?'On your want list':'Add to wants'}</button>
    </div>
    {ownedGrade&&<p className="is-owned">In your collection · {ownedGrade}</p>}
    {notice&&<p className="is-notice" role="status">{notice}</p>}
   </div>
  </div>

  <section className="is-section" aria-labelledby="is-info-title">
   <h3 id="is-info-title">Comic information</h3>
   <dl className="is-facts">
    {title&&<div><dt>Series</dt><dd>{title}</dd></div>}
    <div><dt>Issue</dt><dd>#{number}</dd></div>
    {publisher&&<div><dt>Publisher</dt><dd>{publisher}</dd></div>}
    {release.onSale&&<div><dt>On sale</dt><dd>{release.onSale} {sourceTag('GCD')}</dd></div>}
    {release.coverDate&&<div><dt>Cover date</dt><dd>{release.coverDate} {!release.onSale&&sourceTag('GCD')}</dd></div>}
    {release.year&&<div><dt>Year</dt><dd>{release.year}</dd></div>}
    <Credit label="Writer" line={credits.writers}/>
    <Credit label="Artist" line={credits.artists}/>
    <Credit label="Cover artist" line={credits.covers}/>
    {issue.bibliography?.originalCoverPrice?.text&&<div><dt>Cover price</dt><dd>{issue.bibliography.originalCoverPrice.text}</dd></div>}
   </dl>
   {profileLoading&&!credits.writers&&<p className="is-quiet" role="status"><span className="is-spinner" aria-hidden="true"/> Checking Metron credits…</p>}
  </section>

  <section className="is-section" aria-labelledby="is-chars-title">
   <h3 id="is-chars-title">Characters{profileCharacters.length?<small>{profileCharacters.length}</small>:null}</h3>
   {profileCharacters.length>0?<>
    <div className="is-cast">{(showAll?profileCharacters:profileCharacters.slice(0,12)).map(c=><a key={c.characterId} href={'/characters/'+c.characterId} className={'is-castmember'+(c.debut?' debut':'')} aria-label={c.name+(c.debut?', first appearance':'')+': open character page'}>
     <Portrait name={c.name} src={c.portraitUrl}/><strong>{c.name}</strong>{c.debut&&<span>First appearance</span>}</a>)}</div>
    {profileCharacters.length>12&&<button type="button" className="is-more" onClick={()=>setShowAll(value=>!value)}>{showAll?'Show fewer':'Show all '+profileCharacters.length+' characters'}</button>}
    {p?.teams.length?<p className="is-teams">Teams: {p.teams.join(', ')}</p>:null}
    <p className="is-source">{p?.attribution||'Character data: Metron (metron.cloud) · Wikidata (CC0)'}</p>
   </>:profileLoading?<p className="is-quiet" role="status"><span className="is-spinner" aria-hidden="true"/> Loading characters…</p>
   :gcdNames.length?<><p className="is-names">{gcdNames.join(' · ')}</p><p className="is-source">Character list: Grand Comics Database. Not yet matched to character pages.</p></>
   :curatedNames.length?<><p className="is-names">{curatedNames.join(' · ')}</p><p className="is-source">{sourceTag('Catalog entry')}</p></>
   :<p className="is-quiet">{p?.status==='pending'?'The character list for this issue is still being gathered.':'Not listed.'}</p>}
  </section>

  <section className="is-section" aria-labelledby="is-collector-title">
   <h3 id="is-collector-title">Collector information</h3>
   {firstCount>0?<ul className="is-firsts">
    {verifiedFirsts.map(f=><li key={'v'+f.characterId}><a href={'/characters/'+f.characterId}><Portrait name={f.name} src={f.portraitUrl} size="sm"/><span><strong>{f.name}</strong> first appearance</span></a><Source kind="verified">{f.source==='metron'?'Metron':'Wikidata'}</Source></li>)}
    {gcdFirsts.map(f=><li key={'g'+f.name}><span className="is-first-plain"><strong>{f.name}</strong> {f.qualifier}</span><Source kind="verified">GCD</Source></li>)}
   </ul>:profileLoading?<p className="is-quiet" role="status"><span className="is-spinner" aria-hidden="true"/> Checking first-appearance records…</p>
   :p?.status==='ready'?<p className="is-quiet">No first appearance is recorded for this issue.</p>:null}
   {edition&&<p className="is-edition"><strong>Edition</strong> {edition.label}{edition.variantOfUrl&&<> · <a href={edition.variantOfUrl} target="_blank" rel="noreferrer">Main issue on GCD</a></>}</p>}
   <a className="is-outlink" href={cgcSubmitUrl} target="_blank" rel="noopener noreferrer" aria-label="Submit to CGC: how to submit a comic for grading (opens cgccomics.com in a new tab)">Submit to CGC <ArrowUpRight size={16} aria-hidden="true"/></a>
  </section>

  <section className="is-section" aria-labelledby="is-market-title">
   <h3 id="is-market-title">Market information</h3>
   <MarketPanel state={insights}/>
   <a className="is-outlink" href={goCollectIssueUrl(issue)} target="_blank" rel="noopener noreferrer" aria-label={'View values on GoCollect for '+(title||'this series')+' #'+number+' (opens gocollect.com in a new tab)'}>View values on GoCollect <ArrowUpRight size={16} aria-hidden="true"/></a>
  </section>

  {(issue.bibliography||detailStatus||issue.dataCredit)&&<details className="is-record">
   <summary>Full publication record</summary>
   {detailStatus}
   {issue.bibliography&&<GcdRecord issue={issue}/>}
   {issue.dataCredit&&<p className="is-source">{issue.dataCredit}.{issue.dataLicense&&<> <a href={issue.dataLicense} target="_blank" rel="noreferrer">CC BY-SA 4.0</a>.</>} {issue.source&&/comics\.org/.test(issue.source)&&<a href={issue.source} target="_blank" rel="noreferrer">GCD record</a>}</p>}
  </details>}
  <CollectionCopyDialog comicId={String(issue.id)} title={issue.title} issueNumber={issue.number} open={collecting} disabled={disabled} onClose={()=>setCollecting(false)} onSaved={setNotice} onAddToCollection={onAddToCollection}/>
 </article>;
}

function GcdRecord({issue}:{issue:Issue}){
 const b=issue.bibliography!;
 const rows=([['Publication date',b.publicationDate],['Pages',b.pageCount],['Issue title',b.issueTitle],['Volume',b.volume],['ISBN',b.isbn],['Barcode',b.barcode],['Rating',b.rating],['Frequency',b.indiciaFrequency],['Editor',b.editing]] as [string,string][]).filter(([,v])=>v&&v.trim());
 return <>
  {rows.length>0&&<dl className="is-facts is-facts-compact">{rows.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
  {b.stories.map((s,i)=>{const lines=([['Writer',s.script],['Pencils',s.pencils],['Inks',s.inks],['Colors',s.colors],['Letters',s.letters],['Characters',s.characters]] as [string,string][]).filter(([,v])=>v&&v.trim());
   return <div className="is-story" key={i}><strong>{s.title||s.feature||s.type||'Story '+(i+1)}</strong>{s.type&&<small> · {s.type}{s.pageCount?' · '+s.pageCount+' pages':''}</small>}
    {lines.length>0&&<dl>{lines.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}{s.synopsis&&<p>{s.synopsis}</p>}</div>})}
 </>;
}

function MarketPanel({state}:{state:{data:IssueInsights|null;failed:boolean}}){
 const v=state.data;
 if(!v)return state.failed?<p className="is-quiet">Market data could not be loaded right now.</p>:<p className="is-quiet" role="status"><span className="is-spinner" aria-hidden="true"/> Checking recorded sales…</p>;
 const asks=v.asks.filter(a=>a.count>0),community=v.sources.some(s=>/seller-reported/i.test(s.note)||/seller-reported/i.test(s.name));
 const hasData=!!(v.headline||v.lastSale||v.byGrade.length||v.recentSales.length||asks.length||v.auctions.active||v.demand.wants||v.demand.collections);
 if(!hasData)return <p className="is-quiet">No recorded sales or licensed values for this issue yet.</p>;
 return <div className="is-market">
  {(v.headline||v.lastSale)&&<dl className="is-facts">
   {v.headline&&<div className="is-value"><dt>Typical value{v.headline.grade?' · '+gradeText(v.headline.grade,v.headline.label):''}</dt><dd><strong>{usd(v.headline.value)}</strong> <span>{usd(v.headline.low)}–{usd(v.headline.high)}</span> <Source kind="estimate">Estimate · {v.headline.basis}</Source></dd></div>}
   {v.lastSale&&<div><dt>Last recorded sale</dt><dd><strong>{v.lastSale.sourceUrl?<a href={v.lastSale.sourceUrl} target="_blank" rel="noreferrer">{usd(v.lastSale.amount)}</a>:usd(v.lastSale.amount)}</strong> <span>{gradeText(v.lastSale.grade,v.lastSale.label)} · {day(v.lastSale.date)} · {v.lastSale.venue}</span></dd></div>}
   {v.trend&&<div><dt>Trend · last {v.trend.windowDays} days</dt><dd>{(v.trend.changePct>0?'+':'')+v.trend.changePct.toFixed(0)}%</dd></div>}
  </dl>}
  {v.recentSales.length>0&&<div className="is-table-wrap"><table className="is-grade-table"><caption>Recorded sales</caption><thead><tr><th scope="col">Date</th><th scope="col">Price</th><th scope="col">Grade</th><th scope="col">Venue</th></tr></thead><tbody>{v.recentSales.slice(0,8).map((sale,index)=><tr key={index}><th scope="row">{day(sale.date)}</th><td>{sale.sourceUrl?<a href={sale.sourceUrl} target="_blank" rel="noreferrer">{usd(sale.amount)}</a>:usd(sale.amount)}</td><td>{gradeText(sale.grade,sale.label)}</td><td>{sale.venue}</td></tr>)}</tbody></table></div>}
  {v.byGrade.length>0&&<div className="is-table-wrap"><table className="is-grade-table"><caption>Value by grade</caption><thead><tr><th scope="col">Grade</th><th scope="col">Value</th><th scope="col">Range</th><th scope="col">Sales</th></tr></thead><tbody>{v.byGrade.map(row=><tr key={row.mode+row.grade+row.label}><th scope="row">{row.mode==='CGC'?'CGC '+row.grade:'Raw '+row.grade}</th><td>{usd(row.value)}</td><td>{usd(row.low)}–{usd(row.high)}</td><td>{row.sales}</td></tr>)}</tbody></table></div>}
  <dl className="is-facts is-facts-compact">
   {asks.map(ask=><div key={ask.source}><dt>{ask.source}</dt><dd>{ask.count} listed{ask.low!==null?' · from '+usd(ask.low):''}</dd></div>)}
   {v.auctions.active>0&&<div><dt>Live auctions</dt><dd>{v.auctions.active}{v.auctions.highestBid!==null?' · high bid '+usd(v.auctions.highestBid):''}</dd></div>}
   {!!v.demand.wants&&<div><dt>On want lists</dt><dd>{v.demand.wants} <Source kind="community">ComicHuddle</Source></dd></div>}
   {!!v.demand.collections&&<div><dt>In collections</dt><dd>{v.demand.collections} <Source kind="community">ComicHuddle</Source></dd></div>}
  </dl>
  {v.sources.length>0&&<p className="is-source">Sources: {v.sources.map((s,i)=><span key={s.name}>{i?', ':''}{s.url?<a href={s.url} target="_blank" rel="noreferrer">{s.name}</a>:s.name}</span>)}.{community&&' Seller-reported sales are community-contributed and weighted lower.'} Values are estimates for research, not appraisals. Updated {day(v.updatedAt)}.</p>}
 </div>;
}
