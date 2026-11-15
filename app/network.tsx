'use client';
import {SellerFeedback} from './community-feedback';
import CollectorWallet from './collector-wallet';
import ResolvedComicCover from './resolved-comic-cover';
import {accountSignInPath} from '../lib/account-intent';
import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {ArrowLeft,ArrowRight,ArrowUpRight,Check,Download,Flag,Layers,MessageCircle,Pencil,Plus,RefreshCw,Search,Share2,Wrench,X} from 'lucide-react';
import ComicPicker from './comic-picker';
import {SelectedComicList} from './comic-multi-picker';
import {parseCatalogSearchPage} from '../lib/catalog-picker-client';
import {directoryGrail,featuredIssueId} from '../lib/profile-grails';
import {listingDirectoryId} from '../lib/shared-catalog';
import {catalog,type Issue} from '../lib/catalog';
import {bookIssue} from '../lib/trades';
import {activateDialog} from '../lib/dialog-focus';
import {emptyHub,previewRulesVersion,type HubData,type CollectorProfile,type ChatMessage,type ShowcaseBook} from '../lib/community';
import Marketplace from './marketplace';
import TradeTerms from './trade-terms';
import PageHeader from '../components/page-header';
import HuddlesGuide,{HuddlesArt} from '../components/huddles-guide';
import {LoadingState} from '../components/states';
import type {Vault} from '../lib/vault';
import './network.css';

type ActionResult={threadId?:string;groupId?:string;matched?:boolean;note?:string;saved?:boolean;listingId?:string;profile?:CollectorProfile};
export function useCollectorNetwork(signedIn:boolean,notify:(s:string)=>void){
 const [data,setData]=useState<HubData>(emptyHub),[ready,setReady]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[actionError,setActionError]=useState('');const busyRef=useRef(false),readController=useRef<AbortController|null>(null);
 const networkRequest=useRef(0),networkSession=useRef(0),networkMounted=useRef(true),networkSignedIn=useRef(signedIn);
 if(networkSignedIn.current!==signedIn){networkSignedIn.current=signedIn;networkSession.current++;networkRequest.current++}
 const clearActionError=useCallback(()=>setActionError(''),[]);
 const refresh=useCallback(async()=>{
  if(!networkMounted.current||!networkSignedIn.current)return null;const request=++networkRequest.current,session=networkSession.current,current=()=>networkMounted.current&&networkSignedIn.current&&request===networkRequest.current&&session===networkSession.current;
  readController.current?.abort();const controller=new AbortController();readController.current=controller;const timer=setTimeout(()=>controller.abort(),30000);
  try{const r=await fetch('/api/social',{credentials:'same-origin',cache:'no-store',signal:controller.signal});const d=await r.json() as HubData&{error?:string};if(!r.ok)throw Error(d.error);if(!current())return null;setData(d);setReady(true);setError('');return d as HubData}
  catch(e){if(current()&&!controller.signal.aborted)setError(e instanceof Error&&e.message?e.message:'Couldn’t load your messages and profile. Try again.');return null}
  finally{clearTimeout(timer);if(readController.current===controller)readController.current=null}
 },[]);
 useEffect(()=>{networkMounted.current=true;return()=>{networkMounted.current=false;networkRequest.current++;networkSession.current++;readController.current?.abort()}},[]);
 useEffect(()=>{
  setData(emptyHub);setError('');setReady(!signedIn);if(!signedIn)return;
  const request=++networkRequest.current,session=networkSession.current,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000),current=()=>networkMounted.current&&networkSignedIn.current&&request===networkRequest.current&&session===networkSession.current;
  void fetch('/api/social?kind=account',{credentials:'same-origin',cache:'no-store',signal:controller.signal}).then(async response=>{if(!response.ok)throw Error('Couldn’t load your profile.');return response.json() as Promise<{me:CollectorProfile|null}>}).then(account=>{if(current()){setData(previous=>({...previous,me:account.me}));setReady(true);setError('')}}).catch(()=>undefined).finally(()=>{clearTimeout(timer);if(current())void refresh()});
  return()=>{clearTimeout(timer);controller.abort();networkRequest.current++};
 },[signedIn,refresh]);
 async function act(action:Record<string,unknown>):Promise<ActionResult|null>{
  if(busyRef.current)return null;busyRef.current=true;setBusy(true);setActionError('');const session=networkSession.current,current=()=>networkMounted.current&&networkSignedIn.current&&session===networkSession.current,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),40000);
  try{
   const r=await fetch('/api/social',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(action),signal:controller.signal});const d=await r.json() as ActionResult&{error?:string};if(!r.ok)throw Error(d.error||'Couldn’t save that. Try again.');if(!current())return null;
   if(action.action==='profile'||action.action==='listing'){
    networkRequest.current++;readController.current?.abort();
    if(d.profile)setData(previous=>({...previous,me:d.profile!}));
    setReady(true);setError('');void refresh();return d;
   }
   await refresh();return current()?d:null;
  }catch(e){if(current()){const message=controller.signal.aborted?'We’re not sure that saved. Your choices are still here. Check before trying again.':e instanceof Error&&e.message?e.message:'Couldn’t save that. Try again.';setActionError(message);notify(message)}return null}
  finally{clearTimeout(timer);busyRef.current=false;if(networkMounted.current)setBusy(false)}
 }
 return {data,ready,error,busy,actionError,clearActionError,refresh,act};
}
type Net=ReturnType<typeof useCollectorNetwork>;
export function Modal({children,label,onClose,wide=false}:{children:ReactNode;label:string;onClose:()=>void;wide?:boolean}){
 const ref=useRef<HTMLDivElement>(null),close=useRef(onClose);close.current=onClose;
 useEffect(()=>activateDialog(ref.current,()=>close.current()),[]);
 return <div className="overlay" onClick={onClose}><div className={'dialog network-dialog '+(wide?'wide-dialog':'')} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={ref} onClick={e=>e.stopPropagation()}><button className="close" aria-label={'Close '+label} onClick={onClose}><X size={22}/></button>{children}</div></div>;
}
export function ComicArt({issue,book,small=false}:{issue?:Issue;book?:ShowcaseBook;small?:boolean}){
 const record=issue||(book?bookIssue(book):undefined),url=book?.photoId?'/api/media?id='+book.photoId+(small?'&size=thumbnail':''):book?.cover||record?.cover,id=record?.id??book?.directoryIssueId??(book?listingDirectoryId(book):null);
 return <div className={'comic-photo '+(small?'small':'')}><ResolvedComicCover issueId={id} title={book?.title||record?.title||'Comic'} issue={record?.number||book?.issue} publisher={record?.publisher} year={record?.year} src={url} actualPhoto={!!book?.photoId} credit={record?.coverCredit||book?.coverCredit}/></div>;
}

/** Chat timestamps in the viewer's own time zone: time today, otherwise date + time. */
const chatStamp=(s:string)=>{const d=new Date(s);if(Number.isNaN(d.getTime()))return '';const today=new Date().toDateString()===d.toDateString();return today?d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}):d.toLocaleString('en-US',{month:'short',day:'numeric',...(d.getFullYear()!==new Date().getFullYear()?{year:'numeric'}:{}),hour:'numeric',minute:'2-digit'})};
/** Per-device "last read" markers for conversations. Unread = the newest message is from the other collector and arrived after the marker. */
const seenKey='comichuddle:chat-seen';
function readSeen():Record<string,string>{try{const v=JSON.parse(localStorage.getItem(seenKey)||'{}');return v&&typeof v==='object'?v:{}}catch{return {}}}
function writeSeen(next:Record<string,string>){try{localStorage.setItem(seenKey,JSON.stringify(next))}catch{}}
export async function uploadPhoto(file:File){
 if(!/^image\/(jpeg|png|webp)$/.test(file.type))throw Error('Pick a JPEG, PNG or WebP photo.');if(file.size>20000000)throw Error('That photo is over 20 MB. Try a smaller one.');
 const bitmap=await createImageBitmap(file),ratio=Math.min(1,1800/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*ratio);canvas.height=Math.round(bitmap.height*ratio);const ctx=canvas.getContext('2d');if(!ctx){bitmap.close();throw Error('Couldn’t prepare this photo. Try another.')};ctx.fillStyle='#f5f1e7';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const blob=await new Promise<Blob|null>(res=>canvas.toBlob(res,'image/jpeg',.88));if(!blob)throw Error('Couldn’t prepare this photo. Try another.');const r=await fetch('/api/media',{method:'POST',headers:{'Content-Type':'image/jpeg'},body:blob}),d=await r.json() as {error?:string;id:string};if(!r.ok)throw Error(d.error);return d.id as string;
}
function xml(s:string){return s.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!))}
function storySvg(p:CollectorProfile){
 const lines=p.showcase.slice(0,6).map((b,i)=>`<g transform="translate(65 ${725+i*107})"><rect width="950" height="90" fill="#f5f1e7" stroke="#20201f" stroke-width="4"/><text x="22" y="34" font-family="Arial" font-size="23" font-weight="bold">${xml((b.title+' '+b.issue).slice(0,60))}</text><text x="22" y="65" font-family="Arial" font-size="18" fill="#635f56">${xml(b.grade.slice(0,70))}</text><text x="895" y="60" font-family="Impact,Arial" font-size="48">0${i+1}</text></g>`).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920"><defs><pattern id="dots" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.5" fill="#20201f" opacity=".15"/></pattern></defs><rect width="1080" height="1920" fill="#efd369"/><rect width="1080" height="1920" fill="url(#dots)"/><rect x="35" y="35" width="1010" height="1850" fill="none" stroke="#20201f" stroke-width="8"/><rect x="65" y="65" width="950" height="90" fill="#20201f"/><text x="88" y="127" font-family="Impact,Arial" font-size="50" fill="#f5f1e7">COMICHUDDLE / MY SHELF</text><text x="65" y="215" font-family="Arial" font-size="28" font-weight="bold">@${xml(p.handle)}</text><text x="65" y="315" font-family="Impact,Arial" font-size="85">${xml(p.name.toUpperCase().slice(0,19))}</text><text x="65" y="384" font-family="Arial" font-size="25">${xml(p.tagline.slice(0,58))}</text><path d="M65 425h950" stroke="#20201f" stroke-width="6"/><text x="65" y="520" font-family="Impact,Arial" font-size="80">${p.stats.comics} COMICS.</text><text x="65" y="610" font-family="Impact,Arial" font-size="70" fill="#c83e30">ONE SHELF.</text><text x="65" y="685" font-family="Arial" font-size="24" font-weight="bold">MY SIX FAVORITES / COLLECTING SINCE ${p.since}</text>${lines}<rect x="65" y="1470" width="950" height="130" fill="#c83e30" stroke="#20201f" stroke-width="5"/><text x="88" y="1522" font-family="Arial" font-size="23" fill="#fff">INTO RIGHT NOW</text><text x="88" y="1570" font-family="Arial" font-size="32" fill="#fff">${xml(p.favorite.slice(0,45)||'The next great story')}</text><text x="65" y="1695" font-family="Arial" font-size="23">${p.stats.wants} wanted · ${p.stats.trades} up for trade</text><text x="65" y="1760" font-family="Arial" font-size="18">Stats come from what this collector entered.</text><text x="65" y="1830" font-family="Impact,Arial" font-size="38">FIND ME ON COMICHUDDLE.</text></svg>`;
}

function BookGrid({books,onBook,label}:{books:ShowcaseBook[];onBook:(b:ShowcaseBook)=>void;label:string}){
 return <ul className="nw-books" aria-label={label}>{books.map(b=><li key={b.id}><button type="button" className="nw-book" onClick={()=>onBook(b)} aria-label={'Peek inside '+b.title+' '+(/^#/.test(b.issue)||!b.issue?b.issue:'#'+b.issue)+': see full details'}><ComicArt book={b}/><strong>{b.title} {b.issue}</strong>{b.grade&&<small>{b.grade}</small>}<span className="peek-inside nw-peek" aria-hidden="true">Peek inside <ArrowRight size={14}/></span></button></li>)}</ul>;
}
function ProfileShowcase({p,own,onEdit,onBook,onIssue,onReport,wants}:{p:CollectorProfile;own:boolean;onEdit:()=>void;onBook:(b:ShowcaseBook)=>void;onIssue:(id:number)=>void;onReport:()=>void;wants:Record<number,Issue>}){
 const favorites=p.showcase.slice(0,6),open=Math.max(0,6-favorites.length),wantList=p.wantIds.slice(0,12);
 return <div className={'nw-showcase nw-tone-'+p.color}>
  <div className="nw-id ds-card">
   <div className="nw-monogram" aria-hidden="true">{p.name.slice(0,1).toUpperCase()}</div>
   <div className="nw-id-copy">
    <p className="nw-handle">@{p.handle}{p.location?' · '+p.location:''}</p>
    {own&&!p.visible&&<p className="nw-pill">Hidden. Only you can see this.</p>}
    {p.bio&&<p className="nw-bio">{p.bio}</p>}
    {p.favorite&&<p className="nw-favorite"><b>Into right now:</b> {p.favorite}</p>}
    {p.provider&&<a className="ds-link" href={'/?section=Pressing&provider='+p.provider.id}><Wrench size={16} aria-hidden="true"/> Comic Workshop pro · {p.provider.name}</a>}
   </div>
   <dl className="nw-stats">
    <div><dt>Comics</dt><dd>{p.stats.comics.toLocaleString('en-US')}</dd></div>
    <div><dt>Wants</dt><dd>{p.stats.wants.toLocaleString('en-US')}</dd></div>
    <div><dt>For trade</dt><dd>{p.stats.trades.toLocaleString('en-US')}</dd></div>
    <div><dt>Collecting since</dt><dd>{p.since}</dd></div>
   </dl>
   <p className="nw-note">Stats come from what this collector entered.</p>
  </div>

  <section className="nw-block" aria-labelledby="nw-favorites">
   <div className="ds-section-head"><div><p className="ds-eyebrow">The six</p><h2 id="nw-favorites">Favorites<span>.</span></h2></div>{own&&<button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" onClick={onEdit}><Pencil size={16} aria-hidden="true"/> Pick favorites</button>}</div>
   {favorites.length||own?<ul className="nw-books nw-six" aria-label="Six favorites">
    {favorites.map((b,i)=><li key={b.id}><button type="button" className="nw-book" onClick={()=>onBook(b)} aria-label={'Peek inside '+b.title+' '+(/^#/.test(b.issue)||!b.issue?b.issue:'#'+b.issue)+': see full details'}><span className="nw-rank" aria-hidden="true">{i+1}</span><ComicArt book={b}/><strong>{b.title} {b.issue}</strong>{b.grade&&<small>{b.grade}</small>}<span className="peek-inside nw-peek" aria-hidden="true">Peek inside <ArrowRight size={14}/></span></button></li>)}
    {own&&Array.from({length:open},(_,i)=><li key={'open-'+i}><button type="button" className="nw-book nw-slot" onClick={onEdit}><span className="nw-slot-art"><Plus size={28} aria-hidden="true"/></span><strong>Add a favorite</strong></button></li>)}
   </ul>:<p className="nw-empty">No favorites picked yet.</p>}
  </section>

  <section className="nw-block" aria-labelledby="nw-trades">
   <div className="ds-section-head"><div><p className="ds-eyebrow">Up for trade</p><h2 id="nw-trades">Trade pile<span>.</span></h2></div></div>
   {p.tradeBooks.length?<BookGrid books={p.tradeBooks} onBook={onBook} label="Trade pile"/>:<p className="nw-empty">{own?'Nothing up for trade yet. Mark comics for trade in your collection.':'Nothing up for trade right now.'}</p>}
  </section>

  <section className="nw-block" aria-labelledby="nw-wants">
   <div className="ds-section-head"><div><p className="ds-eyebrow">Looking for</p><h2 id="nw-wants">Wants<span>.</span></h2></div>{p.wantIds.length>wantList.length&&<p>Showing {wantList.length} of {p.wantIds.length}.</p>}</div>
   {wantList.length?<ul className="nw-wants">{wantList.map(id=>{const record=wants[id]||catalog[id];return <li key={id}><button type="button" className="nw-want" onClick={()=>onIssue(id)} aria-label={'Peek inside '+(record?record.title+' #'+record.number.replace(/^#/,''):'saved issue')+': see full details'}><span className="nw-want-art"><ComicArt issue={record} small/></span><span><strong>{record?record.title+' #'+record.number:'Loading…'}</strong>{record&&<small>{[record.publisher,record.year].filter(Boolean).join(' · ')}</small>}<span className="peek-inside nw-peek" aria-hidden="true">Peek inside <ArrowRight size={14}/></span></span></button></li>})}</ul>:<p className="nw-empty">{own?'No wants yet. Add them from any comic page.':'No wants listed.'}</p>}
  </section>

  {p.stats.publishers.length>0&&<section className="nw-block" aria-labelledby="nw-publishers">
   <div className="ds-section-head"><div><p className="ds-eyebrow">On the shelf</p><h2 id="nw-publishers">Publishers<span>.</span></h2></div></div>
   <ul className="nw-publishers">{p.stats.publishers.map(v=><li key={v.name}><span>{v.name}</span><span className="nw-bar" aria-hidden="true"><i style={{width:Math.max(2,v.count/Math.max(1,p.stats.comics)*100)+'%'}}/></span><b>{v.count}</b></li>)}</ul>
  </section>}

  <section className="nw-block" aria-label="Seller feedback"><SellerFeedback profileId={p.id}/></section>
  {own&&<section className="nw-block" aria-labelledby="nw-wallet"><div className="ds-section-head"><div><p className="ds-eyebrow">Only you can see this</p><h2 id="nw-wallet">Wallet<span>.</span></h2></div><a className="ds-link" href="/wallet">How rewards work <ArrowUpRight size={16} aria-hidden="true"/></a></div><CollectorWallet key={p.id} showInfoLink={false}/></section>}
  {!own&&<p className="nw-report"><button type="button" className="ds-link" onClick={onReport}><Flag size={16} aria-hidden="true"/> Report this profile</button></p>}
 </div>;
}
type Props={onAddComic?:()=>void;addComicOpen?:boolean;myProfileRequest:number;tab:string;net:Net;vault:Vault;commit:(v:Vault)=>Promise<boolean>;go:(s:string)=>void;openIssue:(id:number)=>void;openCollection:()=>void;notice:(s:string)=>void;signedIn:boolean;name:string;gate:()=>boolean;profileOpen:boolean;setProfileOpen:(v:boolean)=>void;marketIssue:number|null;clearMarketIssue:()=>void;incomingThread:{id:string;version:number};preferredRole:'collector'|'provider';onProviderProfileCreated:()=>void;onAccountProfileSaved:()=>void};
export default function CollectorNetwork({onAddComic,addComicOpen,myProfileRequest,tab,net,vault,commit,go,openIssue,openCollection,notice,signedIn,name,gate:parentGate,profileOpen,setProfileOpen,marketIssue,clearMarketIssue,incomingThread,preferredRole,onProviderProfileCreated,onAccountProfileSaved}:Props){
 const {data,busy}=net;function gate(){const okay=parentGate();if(!okay)setNewChat(false);return okay;}const [search,setSearch]=useState('');
 const [threadId,setThreadId]=useState(''),[chat,setChat]=useState<ChatMessage[]>([]),[message,setMessage]=useState(''),[chatBlocked,setChatBlocked]=useState(false),[chatLoading,setChatLoading]=useState(false),[chatError,setChatError]=useState(''),[newChat,setNewChat]=useState(false),[blockedByMe,setBlockedByMe]=useState(false),[sending,setSending]=useState(false),[seen,setSeen]=useState<Record<string,string>>({});
 useEffect(()=>{setSeen(readSeen())},[]);
 function markSeen(id:string,stamp:string){setSeen(current=>{if(current[id]&&current[id]>=stamp)return current;const next={...current,[id]:stamp};writeSeen(next);return next})}
 const [profile,setProfile]=useState<CollectorProfile|null>(null),[share,setShare]=useState<CollectorProfile|null>(null);
 const [report,setReport]=useState<{type:string;id:string}|null>(null),[featureIds,setFeatureIds]=useState<string[]>([]);
 const [grailRecords,setGrailRecords]=useState<Record<number,Issue>>({});
 const chatRequest=useRef(0),profileRequest=useRef(0),currentChatSelection=useRef(''),currentProfileSelection=useRef('');
 const [profileLoading,setProfileLoading]=useState(false);
 const [signInHref,setSignInHref]=useState('/sign-in?return_to=%2F');
 useEffect(()=>{if(profileOpen)setSignInHref(accountSignInPath(window.location.pathname,window.location.search,preferredRole,tab))},[profileOpen,preferredRole,tab]);
 const thread=data.threads.find(t=>t.id===threadId);const me=data.me;
 const isUnread=(t:typeof data.threads[number])=>t.id!==threadId&&t.latestMine===false&&!!t.latestAt&&(!seen[t.id]||seen[t.id]<t.latestAt),unreadThreads=data.threads.filter(isUnread).length;
 currentChatSelection.current=tab==='Messages'?threadId:'';
 if(tab!=='Collectors')currentProfileSelection.current='';
 useEffect(()=>{if(tab!=='Collectors'){selectProfile(null);setProfileLoading(false)}},[tab]);
 useEffect(()=>{selectProfile(null)},[myProfileRequest]);
 useEffect(()=>()=>{profileRequest.current++},[]);
 useEffect(()=>{setSearch('')},[tab,marketIssue]);
 useEffect(()=>{if(incomingThread.id)setThreadId(incomingThread.id)},[incomingThread.version]);
 useEffect(()=>{if(profileOpen){setFeatureIds(me?.featured||[]);net.clearActionError()}},[profileOpen,me?.featured.join(',')]);
 useEffect(()=>{if(!profileOpen)return;const ids=[...new Set(featureIds.flatMap(key=>{const id=featuredIssueId(key,vault.books);return id===null||grailRecords[id]||catalog[id]?[]:[id]}))];if(!ids.length)return;const controller=new AbortController();void fetch('/api/catalog?ids='+ids.join(','),{signal:controller.signal}).then(async response=>{if(!response.ok)throw Error();return parseCatalogSearchPage(await response.json())}).then(page=>{if(!controller.signal.aborted)setGrailRecords(previous=>({...previous,...Object.fromEntries(page.issues.map(issue=>[issue.id,issue]))}))}).catch(()=>undefined);return()=>controller.abort()},[profileOpen,featureIds.join(','),vault.books,grailRecords]);
 function chooseGrail(issue:Issue|null){if(!issue)return;if(featureIds.length>=6&&!featureIds.some(key=>featuredIssueId(key,vault.books)===issue.id)){notice('You can show six favorites. Remove one to add another.');return}setGrailRecords(previous=>({...previous,[issue.id]:issue}));setFeatureIds(previous=>{if(previous.some(key=>featuredIssueId(key,vault.books)===issue.id))return previous;if(previous.length>=6)return previous;const owned=vault.books.find(book=>listingDirectoryId(book)===issue.id);return [...previous,owned?.id||directoryGrail(issue.id)]})}
 const grailChoices=featureIds.map(key=>{const copy=vault.books.find(book=>book.id===key),id=featuredIssueId(key,vault.books),record=id===null?undefined:grailRecords[id]||catalog[id];return {id:key,title:record?.title||copy?.title||'Loading…',issue:record?.number||copy?.issue||'',subtitle:record?[record.publisher,record.year||null,record.variant].filter(Boolean).join(' · '):copy?.grade,cover:copy?.photoId?'/api/media?id='+copy.photoId:record?.cover}});
 useEffect(()=>{const handle=new URLSearchParams(window.location.search).get('collector');if(handle){go('Collectors');void loadProfile(handle)}},[]);
 function selectProfile(value:CollectorProfile|null){profileRequest.current++;currentProfileSelection.current='';setProfileLoading(false);setProfile(value)}
 async function loadProfile(handle:string){
  selectProfile(null);const request=++profileRequest.current;currentProfileSelection.current=handle;go('Collectors');setProfileLoading(true);
  const current=()=>request===profileRequest.current&&currentProfileSelection.current===handle;
  try{const r=await fetch('/api/social?kind=profile&handle='+encodeURIComponent(handle)),d=await r.json() as CollectorProfile&{error?:string};if(!r.ok)throw Error(d.error);if(current())selectProfile(d)}
  catch(e){if(current())notice(e instanceof Error&&e.message?e.message:'Couldn’t open that profile. Try again.')}
  finally{if(current())setProfileLoading(false)}
 }
 async function loadChat(showLoading=false){
  const selection=threadId;if(!selection||currentChatSelection.current!==selection)return;
  const request=++chatRequest.current;if(showLoading)setChatLoading(true);
  const current=()=>request===chatRequest.current&&currentChatSelection.current===selection;
  try{const r=await fetch('/api/social?kind=messages&thread='+encodeURIComponent(threadId)),d=await r.json() as {error?:string;messages:ChatMessage[];blocked:boolean;blockedByMe?:boolean};if(!r.ok)throw Error(d.error||'Couldn’t load this chat. Try again.');if(current()){setChat(d.messages);setChatBlocked(d.blocked);setBlockedByMe(!!d.blockedByMe);setChatError('');const last=d.messages.at(-1);markSeen(selection,last?.createdAt||new Date(0).toISOString())}}
  catch(e){if(current())setChatError(e instanceof Error&&e.message?e.message:'Couldn’t load this chat. Try again.')}
  finally{if(current())setChatLoading(false)}
 }
 useEffect(()=>{setChat([]);setChatError('');setChatBlocked(false);setBlockedByMe(false);setChatLoading(false);setMessage('');if(!threadId||tab!=='Messages')return;void loadChat(true);const timer=setInterval(()=>void loadChat(),12000);return()=>{chatRequest.current++;clearInterval(timer)}},[threadId,tab]);

 async function startMessage(to:string,context=''){if(!gate())return;const d=await net.act({action:'start_thread',to,context});if(d?.threadId){setThreadId(d.threadId);setNewChat(false);selectProfile(null);go('Messages')}}
 async function downloadCard(p:CollectorProfile){const svgUrl=URL.createObjectURL(new Blob([storySvg(p)],{type:'image/svg+xml'}));try{const img=new Image();img.src=svgUrl;await img.decode();const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1920;const ctx=canvas.getContext('2d');if(!ctx)throw Error();ctx.drawImage(img,0,0);const blob=await new Promise<Blob|null>(r=>canvas.toBlob(r,'image/png'));if(!blob)throw Error();const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='comichuddle-'+p.handle+'-story.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);notice('Your story card is downloaded.')}catch{const a=document.createElement('a');a.href=svgUrl;a.download='comichuddle-'+p.handle+'-story.svg';a.click();notice('PNG didn’t work, so we saved it as an SVG.')}finally{setTimeout(()=>URL.revokeObjectURL(svgUrl),2000)}}
 async function shareUrl(p:CollectorProfile){const url=window.location.origin+'/?collector='+encodeURIComponent(p.handle);try{if(navigator.share)await navigator.share({title:p.name+' on ComicHuddle',text:p.tagline,url});else{await navigator.clipboard.writeText(url);notice('Profile link copied.')}}catch{notice('Sharing didn’t go through. Try again.')}}
 const currentProfile=profile||me,own=!!currentProfile&&currentProfile.id===me?.id,viewingOther=!!profile&&profile.id!==me?.id;
 const sendDisabled=!message.trim()||busy||sending;
 const profileHeader=profileLoading?null:currentProfile&&!own?<PageHeader id="nw-profile-title" eyebrow="Collector profile" title={currentProfile.name+'.'} accent={'@'+currentProfile.handle} lede={currentProfile.tagline||undefined} pose="profile" caption="THEIR SHELF" actions={<><button type="button" className="ds-btn ds-btn-primary" disabled={!currentProfile.dmOpen||busy} title={currentProfile.dmOpen?undefined:'This collector isn’t taking messages.'} onClick={()=>void startMessage(currentProfile.id)}><MessageCircle size={18} aria-hidden="true"/> {currentProfile.dmOpen?'Send a message':'Not taking messages'}</button><button type="button" className="ds-btn ds-btn-secondary" onClick={()=>setShare(currentProfile)}><Share2 size={18} aria-hidden="true"/> Share</button></>}/>
  :<PageHeader id="nw-profile-title" eyebrow="My profile" title="Your shelf." accent="Your story." lede={currentProfile?'Your collection is private. You choose what to show.':'Pick a name. Show off six favorite books. It’s free.'} pose="profile" caption="YOUR SHELF" line="Pick six favorites to show off." actions={currentProfile?<><button type="button" className="ds-btn ds-btn-primary" onClick={()=>setProfileOpen(true)}><Pencil size={18} aria-hidden="true"/> Edit showcase</button><button type="button" className="ds-btn ds-btn-secondary" onClick={()=>setShare(currentProfile)}><Share2 size={18} aria-hidden="true"/> Share</button><button type="button" className="ds-btn ds-btn-secondary" onClick={openCollection}><Layers size={18} aria-hidden="true"/> My collection</button></>:<><button type="button" className="ds-btn ds-btn-primary" onClick={()=>{selectProfile(null);setProfileOpen(true)}}>Create my profile <ArrowRight size={18} aria-hidden="true"/></button><button type="button" className="ds-btn ds-btn-secondary" onClick={openCollection}><Layers size={18} aria-hidden="true"/> My collection</button></>}/>;
 const [wantRecords,setWantRecords]=useState<Record<number,Issue>>({});
 const wantKey=tab==='Collectors'&&currentProfile?currentProfile.wantIds.slice(0,12).filter(id=>!catalog[id]&&!wantRecords[id]).join(','):'';
 useEffect(()=>{if(!wantKey)return;const controller=new AbortController();void fetch('/api/catalog?ids='+wantKey,{signal:controller.signal}).then(async response=>{if(!response.ok)throw Error();return parseCatalogSearchPage(await response.json())}).then(page=>{if(!controller.signal.aborted)setWantRecords(previous=>({...previous,...Object.fromEntries(page.issues.map(issue=>[issue.id,issue]))}))}).catch(()=>undefined);return()=>controller.abort()},[wantKey]);
 const openBook=(b:ShowcaseBook)=>{const id=b.directoryIssueId??listingDirectoryId(b)??bookIssue(b)?.id;if(id!==undefined&&id!==null)openIssue(id)};
 return <>
 {['Marketplace','Collectors','Messages'].includes(tab)&&net.error&&<div className="network-error nw-error" role="alert"><strong>{net.error}</strong><button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" onClick={()=>void net.refresh()}><RefreshCw size={16} aria-hidden="true"/> Try again</button></div>}
 {tab==='Marketplace'&&<Marketplace commit={commit} onAddComic={onAddComic} addComicOpen={addComicOpen} net={net} vault={vault} gate={gate} notice={notice} openCollection={openCollection} marketIssue={marketIssue} clearIssue={clearMarketIssue} onSeller={handle=>void loadProfile(handle)} onMessage={(id,title)=>void startMessage(id,title)} onReport={id=>setReport({type:'listing',id})}/> }
 {tab==='Collectors'&&<section className="nw-profile" aria-labelledby="nw-profile-title">
  {viewingOther&&<button type="button" className="ds-link nw-back" onClick={()=>go('My Profile')}><ArrowLeft size={16} aria-hidden="true"/> Back to my profile</button>}
  {profileLoading?<LoadingState message="Loading this shelf…"/>:<>
   {profileHeader}
   {currentProfile?<ProfileShowcase p={currentProfile} own={own} wants={wantRecords} onEdit={()=>setProfileOpen(true)} onBook={openBook} onIssue={openIssue} onReport={()=>{if(gate())setReport({type:'profile',id:currentProfile.id})}}/>
   :<div className="nw-invite ds-card"><ul>
     <li><b>Your collection is private.</b> You choose what to show.</li>
     <li><b>Six favorites.</b> Put your best books up front.</li>
     <li><b>One account.</b> Sell, trade and get your comics pressed, all with one account.</li>
    </ul></div>}
  </>}
 </section>}
 {tab==='Messages'&&<section className="nw-messages" aria-labelledby="nw-messages-title">
  <PageHeader id="nw-messages-title" eyebrow="Messages" title="Your messages." actions={data.threads.length?<button type="button" className="ds-btn ds-btn-secondary" onClick={()=>{if(gate())setNewChat(true)}}><Plus size={18} aria-hidden="true"/> New message</button>:undefined}/>
  {!data.threads.length&&!thread?<div className="nw-inbox-empty">
   <HuddlesGuide pose="messages" caption="YOUR MESSAGES" line="Say hi to a collector." size="md"/>
   <div><h2>No messages yet.</h2><p>Message a seller from a listing, or find a collector to say hi.</p><div className="ds-actions"><button type="button" className="ds-btn ds-btn-primary" onClick={()=>{if(gate())setNewChat(true)}}><Search size={18} aria-hidden="true"/> Find a collector</button><button type="button" className="ds-btn ds-btn-secondary" onClick={()=>go('Marketplace')}>Browse the marketplace</button></div></div>
  </div>
  :<div className={'nw-inbox'+(thread?' has-thread':'')}>
   <aside className="nw-list" aria-label="Conversations">
    <div className="nw-list-head"><h2>Inbox{unreadThreads>0&&<span className="nw-count" aria-label={unreadThreads+' unread'}>{unreadThreads}</span>}</h2><button type="button" className="nw-icon-btn" aria-label="Refresh inbox" onClick={()=>void net.refresh()}><RefreshCw size={18} aria-hidden="true"/></button></div>
    <ul>{data.threads.map(t=>{const unread=isUnread(t);return <li key={t.id}><button type="button" className={'nw-thread'+(threadId===t.id?' active':'')+(unread?' unread':'')} aria-current={threadId===t.id?'true':undefined} onClick={()=>setThreadId(t.id)}><span className="nw-avatar" aria-hidden="true">{t.peer.name.slice(0,1).toUpperCase()}</span><span className="nw-thread-copy"><strong>{t.peer.name}{unread&&<span className="nw-dot"><span className="sr-only">Unread</span></span>}</strong><small>{t.latest?(t.latestMine?'You: ':'')+t.latest:t.context||'No messages yet'}</small></span>{t.latestAt&&<time dateTime={t.latestAt}>{chatStamp(t.latestAt)}</time>}</button></li>})}</ul>
   </aside>
   <div className="nw-chat">{thread?<>
    <div className="nw-chat-head">
     <button type="button" className="nw-icon-btn nw-chat-back" aria-label="All messages" onClick={()=>setThreadId('')}><ArrowLeft size={20} aria-hidden="true"/></button>
     <span className="nw-avatar" aria-hidden="true">{thread.peer.name.slice(0,1).toUpperCase()}</span>
     <div className="nw-chat-who"><strong>{thread.peer.name}</strong><small>@{thread.peer.handle}{thread.context?' · '+thread.context:''}</small></div>
     <div className="nw-chat-tools">
      <button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" onClick={()=>void loadProfile(thread.peer.handle)}>Profile</button>
      {blockedByMe?<button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" disabled={busy} onClick={async()=>{const r=await net.act({action:'unblock',to:thread.peer.id});if(r){notice(thread.peer.name+' is unblocked.');await loadChat()}}}>Unblock</button>:<button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" disabled={busy||chatBlocked} onClick={async()=>{if(!window.confirm('Block '+thread.peer.name+'? Neither of you can send messages, and they’ll be hidden from you. You can unblock later.'))return;const r=await net.act({action:'block',to:thread.peer.id});if(r){setChatBlocked(true);setBlockedByMe(true);notice(thread.peer.name+' is blocked.')}}}>Block</button>}
     </div>
    </div>
    <TradeTerms key={threadId} threadId={threadId} act={net.act} notify={notice}/>
    <div className="nw-chat-body" aria-live="polite">
     {chatLoading&&<p className="nw-muted" role="status">Loading messages…</p>}
     {chatError&&<p className="ds-error" role="alert">{chatError}</p>}
     {!chat.length&&!chatLoading&&!chatError&&<div className="nw-chat-start"><HuddlesArt pose="messages" size="sm" decorative/><div><h3>Say hi.</h3><p>Talk about the book, its condition or a trade. Keep addresses and payment info out of chat.</p></div></div>}
     {chat.map(m=><div className={'nw-bubble'+(m.mine?' mine':'')} key={m.id}><span className="sr-only">{m.mine?'You':m.authorName}: </span><p>{m.body}</p><div className="nw-bubble-meta"><time dateTime={m.createdAt}>{chatStamp(m.createdAt)}</time>{!m.mine&&<button type="button" className="nw-report-msg" onClick={()=>setReport({type:'message',id:m.id})}><Flag size={14} aria-hidden="true"/> Report</button>}</div></div>)}
    </div>
    {chatBlocked?<p className="nw-blocked" role="status">{blockedByMe?'You blocked this collector. Unblock them to message again.':'You can’t send messages in this chat.'}</p>
    :<form className="nw-composer" onSubmit={async e=>{e.preventDefault();const body=message.trim();if(!body||sending||!gate())return;setSending(true);try{const r=await net.act({action:'message',threadId,body});if(r){setMessage('');await loadChat()}}finally{setSending(false)}}}>
     <label className="sr-only" htmlFor="nw-composer-input">Message {thread.peer.name}</label>
     <textarea id="nw-composer-input" value={message} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();e.currentTarget.form?.requestSubmit()}}} maxLength={2000} aria-describedby="nw-composer-help" placeholder="Write a message…"/>
     <button type="submit" className="ds-btn ds-btn-primary" disabled={sendDisabled}>{sending?'Sending…':'Send'} <ArrowRight size={18} aria-hidden="true"/></button>
     <small id="nw-composer-help">Enter to send. Shift+Enter for a new line.{message.length>1800?' '+(2000-message.length)+' characters left.':''}</small>
    </form>}
    <p className="nw-chat-note"><Flag size={14} aria-hidden="true"/> Only you two can see this. Report anything that’s not okay.</p>
   </>:<div className="nw-chat-none"><HuddlesArt pose="messages" size="md" decorative/><p>Pick a conversation to read it.</p></div>}</div>
  </div>}
 </section>}
 {profileOpen&&<Modal label={signedIn?(me?'Edit your showcase':'Set up your profile'):'Join ComicHuddle'} onClose={()=>setProfileOpen(false)}><div className="form-dialog nw-join">
  {!signedIn?<>
   <HuddlesGuide pose="sign-in" caption="COME ON IN" line="Join free. It takes a minute." size="md" className="nw-join-art"/>
   <p className="ds-eyebrow">Free account</p><h2 className="nw-join-title">Join <span>ComicHuddle.</span></h2>
   <p className="nw-join-lede">Join free to save comics, sell, trade and chat with collectors.</p>
   <a className="ds-btn ds-btn-primary nw-join-cta" href={signInHref} target="_top">Join free or log in <ArrowRight size={18} aria-hidden="true"/></a>
   <p className="nw-note">Your password is stored securely. Nobody can read it.</p>
  </>:<>
   <p className="ds-eyebrow">{me?'Your showcase':'Free profile'}</p><h2 className="nw-join-title">{me?<>Edit your <span>showcase.</span></>:<>Set up your <span>profile.</span></>}</h2>
   <p className="nw-join-lede">Pick a name. Show off six favorite books. It’s free.</p>
   <form className="nw-join-form" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget),r=await net.act({action:'profile',handle:String(f.get('handle')),name:String(f.get('name')),bio:String(f.get('bio')),tagline:String(f.get('tagline')),location:String(f.get('location')),favorite:String(f.get('favorite')),since:Number(f.get('since')),color:String(f.get('color')),featured:featureIds,visible:f.get('visible')==='on',dmOpen:f.get('dmOpen')==='on',accept:f.get('accept')==='on'});if(r){onAccountProfileSaved();setProfileOpen(false);selectProfile(null);if(f.get('accountRole')==='provider'&&(!me?.provider||preferredRole==='provider'))onProviderProfileCreated();notice(me?'Showcase saved.':'Your profile is ready. Welcome to ComicHuddle!')}}}>
    <label className="ds-field"><span>I’m joining as</span><select name="accountRole" defaultValue={me?.provider?'provider':preferredRole} aria-describedby="nw-role-help"><option value="collector">A collector</option><option value="provider">A collector who also presses or cleans comics</option></select><small id="nw-role-help">Everyone gets a showcase. Pros also get a free studio page.</small></label>
    <label className="ds-field"><span>Handle <span className="required-mark" aria-hidden="true">*</span></span><input name="handle" required minLength={3} maxLength={24} pattern="[a-z][a-z0-9_]{2,23}" defaultValue={me?.handle||''} placeholder="your_name" autoCapitalize="none" spellCheck={false} aria-describedby="nw-handle-help"/><small id="nw-handle-help">Lowercase letters, numbers and underscores.</small></label>
    <label className="ds-field"><span>Display name <span className="required-mark" aria-hidden="true">*</span></span><input name="name" required maxLength={60} defaultValue={me?.name||(name.includes('@')?'Collector':name)} placeholder="The name on your shelf"/></label>
    <label className="ds-field"><span>City and state <span className="required-mark" aria-hidden="true">*</span></span><input name="location" required minLength={2} maxLength={60} defaultValue={me?.location||''} placeholder="Minneapolis, MN" aria-describedby="nw-location-help"/><small id="nw-location-help">City and state only, like Minneapolis, MN. Never a street address.</small></label>
    <label className="ds-field"><span>Collecting since <span className="required-mark" aria-hidden="true">*</span></span><input name="since" type="number" inputMode="numeric" min="1930" max={new Date().getFullYear()} defaultValue={me?.since||new Date().getFullYear()} required/></label>
    <div className="nw-join-picker"><h3>Six favorites</h3><p>Search the directory and add up to six.</p><ComicPicker value={null} onChange={chooseGrail} disabled={busy} clearOnChoose label="Find a favorite"/><SelectedComicList items={grailChoices} disabled={busy} label="Your favorites" onRemove={id=>setFeatureIds(previous=>previous.filter(key=>key!==id))}/></div>
    <details className="nw-join-more"><summary>More about you (optional)</summary>
     <label className="ds-field"><span>Tagline</span><input name="tagline" maxLength={100} defaultValue={me?.tagline||''} placeholder="One line about your collecting"/></label>
     <label className="ds-field"><span>About you</span><textarea name="bio" maxLength={500} defaultValue={me?.bio||''} placeholder="What do you collect, and why?"/></label>
     <label className="ds-field"><span>Into right now</span><input name="favorite" maxLength={80} defaultValue={me?.favorite||''} placeholder="A character, era or series"/></label>
     <label className="ds-field"><span>Profile color</span><select name="color" defaultValue={me?.color||'red'}><option value="red">Red</option><option value="blue">Blue</option><option value="yellow">Yellow</option><option value="teal">Teal</option></select></label>
    </details>
    <label className="nw-check"><input name="visible" type="checkbox" defaultChecked={me?.visible??true}/><span>Let other members see my showcase, trade pile and wants.</span></label>
    <label className="nw-check"><input name="dmOpen" type="checkbox" defaultChecked={me?.dmOpen??true}/><span>Let collectors message me.</span></label>
    <label className="nw-check"><input name="accept" type="checkbox" required defaultChecked={me?.consent?.version===previewRulesVersion}/><span>I’m 18+, live in the US, and agree to the <a className="nw-rules-link" href="/?section=Rules" target="_blank" rel="noreferrer">collector rules</a>.<span className="required-mark" aria-hidden="true"> *</span></span></label>
    <p className="nw-note">Your collection is private. You choose what to show. We save the rules version ({previewRulesVersion}) and the date you agreed.</p>
    {net.actionError&&<p className="ds-error" role="alert">{net.actionError}</p>}
    <button type="submit" className="ds-btn ds-btn-primary nw-join-cta" disabled={busy}>{busy?'Saving…':me?'Save showcase':'Create my profile'}<Check size={18} aria-hidden="true"/></button>
   </form>
  </>}
 </div></Modal>}
 {newChat&&<Modal label="New message" onClose={()=>setNewChat(false)}><div className="form-dialog nw-join">
  <p className="ds-eyebrow">New message</p><h2 className="nw-join-title">Find a <span>collector.</span></h2>
  <label className="ds-field"><span>Name or handle</span><span className="nw-search-field"><Search size={18} aria-hidden="true"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search collectors" type="search"/>{search&&<button type="button" className="nw-search-clear" aria-label="Clear collector search" onClick={()=>setSearch('')}><X size={16}/></button>}</span></label>
  <ul className="nw-people">{data.people.filter(p=>p.id!==me?.id&&p.dmOpen&&(p.name+' '+p.handle).toLowerCase().includes(search.toLowerCase())).map(p=><li key={p.id}><button type="button" className="nw-thread" disabled={busy} onClick={()=>void startMessage(p.id)}><span className="nw-avatar" aria-hidden="true">{p.name.slice(0,1).toUpperCase()}</span><span className="nw-thread-copy"><strong>{p.name}</strong><small>@{p.handle}</small></span><MessageCircle size={18} aria-hidden="true"/></button></li>)}</ul>
  {!data.people.some(p=>p.id!==me?.id&&p.dmOpen)&&<p className="nw-empty">No collectors are taking messages yet.</p>}
 </div></Modal>}
 {share&&<Modal label="Share your profile" onClose={()=>setShare(null)}><div className="form-dialog nw-join">
  <p className="ds-eyebrow">Share</p><h2 className="nw-join-title">Show off <span>your shelf.</span></h2>
  <div className="nw-story"><span>@{share.handle}</span><h3>{share.name}</h3><strong>{share.stats.comics} comics</strong>{share.tagline&&<p>{share.tagline}</p>}<small>Collecting since {share.since}</small></div>
  <p className="nw-join-lede">Download a story card sized for social posts.</p>
  <div className="ds-actions"><button type="button" className="ds-btn ds-btn-primary" onClick={()=>void downloadCard(share)}><Download size={18} aria-hidden="true"/> Download card</button><button type="button" className="ds-btn ds-btn-secondary" onClick={()=>void shareUrl(share)}><Share2 size={18} aria-hidden="true"/> Share link</button></div>
  <p className="nw-note">Stats come from what this collector entered.</p>
 </div></Modal>}
 {report&&<Modal label="Report this" onClose={()=>setReport(null)}><div className="form-dialog nw-join">
  <p className="ds-eyebrow">Report</p><h2 className="nw-join-title">Something <span>not okay?</span></h2>
  <form className="nw-join-form" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget),r=await net.act({action:'report',targetType:report.type,targetId:report.id,reason:String(f.get('reason'))});if(r){setReport(null);notice('Thanks. We’ll take a look.')}}}>
   <label className="ds-field"><span>What happened? <span className="required-mark" aria-hidden="true">*</span></span><textarea name="reason" required maxLength={500} placeholder="Tell us what’s wrong. Skip private details." aria-describedby="nw-report-help"/><small id="nw-report-help">We review every report. We don’t have round-the-clock moderators yet.</small></label>
   <button type="submit" className="ds-btn ds-btn-primary nw-join-cta" disabled={busy}><Flag size={18} aria-hidden="true"/> Send report</button>
  </form>
 </div></Modal>}
 </>;
}
