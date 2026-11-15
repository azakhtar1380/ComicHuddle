'use client';
// The one messaging experience: conversation list + thread. Rendered by app/network.tsx (section "Messages").
import {useEffect,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {Archive,ArchiveRestore,ArrowLeft,Ban,Check,CheckCheck,Ellipsis,Flag,ImagePlus,MessageCircle,PenSquare,Search,SendHorizontal,Store,UserRound,Wrench,X} from 'lucide-react';
import type {ChatMessage,HubData} from '../../lib/community';
import UserAvatar from '../user-avatar';
import {VerifiedBadge} from '../verified-badge';
import HuddlesGuide,{HuddlesArt} from '../huddles-guide';
import TradeTerms from '../../app/trade-terms';
import {listingLink,messageLinks,previewKey,providerLink,type LinkPreview} from './links';
import {countUnread,dayKey,dayLabel,fullStamp,listStamp,money,readSeen,threadUnread,timeOnly,toneColor,writeSeen,type InboxThread} from './format';

export {countUnread};
type ActionResult={threadId?:string;saved?:boolean;messageId?:string}|null;
type Photo={id:string;url:string;thumbnail:string};
type Msg=ChatMessage&{photos?:Photo[]};
type Features={photos:boolean;archive:boolean;receipts:boolean};
type ChatPayload={error?:string;messages:Msg[];previews?:Record<string,LinkPreview>;peerReadAt?:string|null;archived?:boolean;features?:Features;blocked:boolean;blockedByMe?:boolean};
/** A listing or studio the conversation was opened from; attached as a link card to the next message sent. */
export type PendingRef={threadId:string;kind:'listing'|'provider';id:string;title?:string};
type Net={data:HubData;busy:boolean;ready:boolean;refresh:()=>Promise<unknown>;act:(action:Record<string,unknown>)=>Promise<ActionResult>};
type Props={net:Net;threadId:string;setThreadId:(id:string)=>void;gate:()=>boolean;notice:(s:string)=>void;go:(s:string)=>void;onProfile:(handle:string)=>void;onReport:(type:string,id:string)=>void;onNewChat:()=>void;upload:(file:File)=>Promise<string>;pendingRef:PendingRef|null;clearPendingRef:()=>void};
type Draft={key:string;file:File;preview:string;id?:string;error?:string};
type Filter='all'|'unread'|'archived';

const GROUP_GAP=5*60*1000;
const noFeatures:Features={photos:false,archive:false,receipts:false};

function Avatar({peer,size}:{peer:InboxThread['peer'];size:number}){return <UserAvatar name={peer.name} src={peer.avatarUrl} color={toneColor(peer.color)} size={size}/>}

export function PreviewCard({preview,compact=false,onOpen}:{preview:LinkPreview;compact?:boolean;onOpen?:()=>void}){
 const photo=preview.kind==='issue'?preview.cover:preview.photo;
 let eyebrow:ReactNode,title:string,meta:string;
 if(preview.kind==='listing'){
  eyebrow=<><Store size={13} aria-hidden="true"/> Listing</>;title=preview.title;
  const price=preview.saleType==='auction'?(preview.currentBid?'Bid '+money(preview.currentBid):'Starts '+money(preview.price)):money(preview.price);
  meta=[price,preview.grade,preview.status==='active'?'':preview.status==='ended'?'Ended':preview.status==='sold'?'Sold':''].filter(Boolean).join(' · ');
 }else if(preview.kind==='provider'){eyebrow=<><Wrench size={13} aria-hidden="true"/> Comic Workshop</>;title=preview.name;meta=preview.location}
 else{eyebrow='Comic';title=preview.title+' #'+preview.number.replace(/^#/,'');meta=[preview.publisher,preview.year].filter(Boolean).join(' · ')}
 return <a className={'nwm-card'+(compact?' compact':'')} href={preview.href} onClick={onOpen}>
  <span className={'nwm-card-art'+(preview.kind==='provider'?' round':'')}>{photo?<img src={photo} alt="" loading="lazy" decoding="async"/>:preview.kind==='provider'?<Wrench size={18} aria-hidden="true"/>:<Store size={18} aria-hidden="true"/>}</span>
  <span className="nwm-card-copy"><small>{eyebrow}</small><strong>{title}</strong>{meta&&<span>{meta}</span>}</span>
 </a>;
}

/** Message text with ComicHuddle links that became cards removed, so the card isn't repeated as a raw URL. */
function visibleText(body:string,previews:Record<string,LinkPreview>){
 if(typeof window==='undefined')return body;
 const links=messageLinks(body,window.location.host).filter(l=>previews[previewKey(l)]);let text=body;
 for(const l of links)text=text.split('\n').filter(line=>line.trim()!==l.text).join('\n');
 return text.trim();
}

export default function MessagesInbox({net,threadId,setThreadId,gate,notice,go,onProfile,onReport,onNewChat,upload,pendingRef,clearPendingRef}:Props){
 const {data,busy}=net;
 const threads=data.threads as InboxThread[];
 const [seen,setSeen]=useState<Record<string,string>>(()=>typeof window==='undefined'?{}:readSeen());
 const [query,setQuery]=useState(''),[filter,setFilter]=useState<Filter>('all');
 const [chat,setChat]=useState<Msg[]>([]),[previews,setPreviews]=useState<Record<string,LinkPreview>>({}),[peerRead,setPeerRead]=useState<string|null>(null),[archived,setArchived]=useState(false),[features,setFeatures]=useState<Features>(noFeatures);
 const [chatBlocked,setChatBlocked]=useState(false),[blockedByMe,setBlockedByMe]=useState(false),[chatLoading,setChatLoading]=useState(false),[chatError,setChatError]=useState('');
 const [message,setMessage]=useState(''),[sending,setSending]=useState(false),[drafts,setDrafts]=useState<Draft[]>([]),[fetchedListing,setFetchedListing]=useState<LinkPreview|null>(null);
 const [coarse]=useState(()=>typeof window!=='undefined'&&window.matchMedia('(pointer: coarse)').matches);
 // Reset the open conversation's state when another one is picked (adjusting state during render, not in an effect).
 const [shownThread,setShownThread]=useState(threadId);
 if(shownThread!==threadId){setShownThread(threadId);setChat([]);setPreviews({});setPeerRead(null);setArchived(false);setChatError('');setChatBlocked(false);setBlockedByMe(false);setChatLoading(!!threadId);setMessage('');for(const d of drafts)URL.revokeObjectURL(d.preview);setDrafts([])}
 const chatRequest=useRef(0),selection=useRef(threadId),body=useRef<HTMLDivElement>(null),stick=useRef(true),input=useRef<HTMLTextAreaElement>(null),fileInput=useRef<HTMLInputElement>(null),menu=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{selection.current=threadId},[threadId]);
 const thread=threads.find(t=>t.id===threadId);

 function markSeen(id:string,stamp:string){setSeen(current=>{if(current[id]&&current[id]>=stamp)return current;const next={...current,[id]:stamp};writeSeen(next);return next})}

 const unreadOf=(t:InboxThread)=>t.id!==threadId&&threadUnread(t,seen);
 const archiveAvailable=features.archive||threads.some(t=>typeof t.archived==='boolean');
 const unreadTotal=threads.filter(t=>!t.archived&&unreadOf(t)).length,archivedTotal=threads.filter(t=>t.archived).length;
 const shown=useMemo(()=>{const q=query.trim().toLowerCase();return threads.filter(t=>{
  if(filter==='archived'?!t.archived:t.archived&&t.id!==threadId)return false;
  if(filter==='unread'&&!(t.id!==threadId&&threadUnread(t,seen)))return false;
  return !q||(t.peer.name+' '+t.peer.handle+' '+(t.context||'')+' '+(t.latest||'')).toLowerCase().includes(q);
 })},[threads,query,filter,threadId,seen]);

 // ---- Load the open conversation and poll it while it's open ----
 async function loadChat(){
  const id=threadId;if(!id)return;const request=++chatRequest.current,current=()=>request===chatRequest.current&&selection.current===id;
  try{
   const r=await fetch('/api/social?kind=messages&thread='+encodeURIComponent(id),{cache:'no-store',credentials:'same-origin'}),d=await r.json() as ChatPayload;
   if(!r.ok)throw Error(d.error||'Couldn’t load this chat. Try again.');if(!current())return;
   setChat(d.messages);setPreviews(d.previews||{});setPeerRead(d.peerReadAt||null);setArchived(!!d.archived);setFeatures(d.features||noFeatures);setChatBlocked(d.blocked);setBlockedByMe(!!d.blockedByMe);setChatError('');
   const last=d.messages.at(-1);markSeen(id,last?.createdAt||new Date(0).toISOString());
   const listed=(net.data.threads as InboxThread[]).find(t=>t.id===id);if(listed&&(listed.unread||listed.unreadCount))void net.refresh();
  }catch(e){if(current())setChatError(e instanceof Error&&e.message?e.message:'Couldn’t load this chat. Try again.')}
  finally{if(current())setChatLoading(false)}
 }
 useEffect(()=>{
  stick.current=true;
  if(!threadId)return;const first=setTimeout(()=>void loadChat(),0),timer=setInterval(()=>{if(document.visibilityState==='visible')void loadChat()},12000);
  const requests=chatRequest;return()=>{requests.current++;clearTimeout(first);clearInterval(timer)};
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[threadId]);

 // ---- Reference card for a conversation opened from a listing or a studio ----
 const activeRef=pendingRef&&pendingRef.threadId===threadId?pendingRef:null;
 const toListingCard=(l:{id:string;title:string;grade:string;price:number;status:string;saleType:string;photos:string[];auction?:{currentBid?:number|null}|null}):LinkPreview=>({kind:'listing',href:'/?section=Marketplace&listing='+encodeURIComponent(l.id),id:l.id,title:l.title,grade:l.grade,price:l.price,status:l.status,saleType:l.saleType,currentBid:l.auction?.currentBid??null,photo:l.photos[0]?'/api/media?id='+l.photos[0]+'&size=thumbnail':null});
 const knownListing=activeRef?.kind==='listing'?data.listings.find(l=>l.id===activeRef.id):undefined;
 const refCard:LinkPreview|null=!activeRef?null:activeRef.kind==='provider'?{kind:'provider',href:'/?section=Pressing&provider='+encodeURIComponent(activeRef.id),id:activeRef.id,name:activeRef.title||'Comic Workshop studio',location:'',photo:null}
  :knownListing?toListingCard(knownListing):fetchedListing?.kind==='listing'&&fetchedListing.id===activeRef.id?fetchedListing:null;
 const missingListing=activeRef?.kind==='listing'&&!knownListing?activeRef.id:'';
 useEffect(()=>{
  if(!missingListing)return;const controller=new AbortController();
  void fetch('/api/social?kind=listing&id='+encodeURIComponent(missingListing),{signal:controller.signal,credentials:'same-origin'}).then(async r=>{if(r.ok)setFetchedListing(toListingCard(await r.json()))}).catch(()=>undefined);
  return()=>controller.abort();
 },[missingListing]);
 // Most recent listing/studio card in the conversation, shown pinned under the header.
 const contextCard=(()=>{if(refCard)return refCard;for(let i=chat.length-1;i>=0;i--){for(const l of typeof window==='undefined'?[]:messageLinks(chat[i].body,window.location.host)){const p=previews[previewKey(l)];if(p&&p.kind!=='issue')return p}}return null})();

 // ---- Stay at the latest message ----
 useLayoutEffect(()=>{const el=body.current;if(el&&stick.current)el.scrollTop=el.scrollHeight},[chat,chatLoading,threadId]);
 const onScroll=()=>{const el=body.current;if(el)stick.current=el.scrollHeight-el.scrollTop-el.clientHeight<96};
 const keepBottom=()=>{const el=body.current;if(el&&stick.current)el.scrollTop=el.scrollHeight};

 // ---- Phones: the open thread is a full-screen layer sized to the visible viewport (keyboard aware) ----
 useEffect(()=>{
  if(!threadId)return;const root=document.documentElement,phone=window.matchMedia('(max-width:760px)');
  const sync=()=>{root.classList.toggle('nwm-thread-open',phone.matches);const vv=window.visualViewport;if(vv){root.style.setProperty('--nwm-vh',vv.height+'px');root.style.setProperty('--nwm-vtop',vv.offsetTop+'px')}keepBottom()};
  sync();phone.addEventListener('change',sync);window.visualViewport?.addEventListener('resize',sync);window.visualViewport?.addEventListener('scroll',sync);
  return()=>{root.classList.remove('nwm-thread-open');root.style.removeProperty('--nwm-vh');root.style.removeProperty('--nwm-vtop');window.visualViewport?.removeEventListener('scroll',sync);phone.removeEventListener('change',sync);window.visualViewport?.removeEventListener('resize',sync)};
 },[threadId]);
 useEffect(()=>{if(!threadId)return;const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'&&window.matchMedia('(max-width:760px)').matches&&!document.querySelector('[role=dialog]'))setThreadId('')};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)},[threadId,setThreadId]);

 // ---- Composer ----
 function autosize(){const el=input.current;if(!el)return;el.style.height='auto';el.style.height=Math.min(el.scrollHeight,168)+'px'}
 useEffect(autosize,[message]);
 const previewUrls=useRef(new Set<string>());
 useEffect(()=>{const urls=previewUrls.current;return()=>urls.forEach(u=>URL.revokeObjectURL(u))},[]);
 function dropDrafts(keep:(d:Draft)=>boolean){setDrafts(ds=>{for(const d of ds)if(!keep(d)){URL.revokeObjectURL(d.preview);previewUrls.current.delete(d.preview)}return ds.filter(keep)})}
 useEffect(()=>{if(!threadId)return;const close=(e:PointerEvent)=>{const el=menu.current;if(el?.open&&!el.contains(e.target as Node))el.removeAttribute('open')};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[threadId]);
 function addFiles(list:FileList|null){
  if(!list?.length)return;if(!gate())return;
  const room=4-drafts.length;if(room<=0){notice('You can attach up to four photos.');return}
  const picked=[...list].slice(0,room).map(file=>({key:crypto.randomUUID(),file,preview:URL.createObjectURL(file)}));picked.forEach(d=>previewUrls.current.add(d.preview));setDrafts(d=>[...d,...picked]);
  if(list.length>room)notice('Only the first four photos were added.');
  for(const draft of picked)void upload(draft.file).then(id=>setDrafts(ds=>ds.map(d=>d.key===draft.key?{...d,id}:d))).catch(e=>setDrafts(ds=>ds.map(d=>d.key===draft.key?{...d,error:e instanceof Error&&e.message?e.message:'Upload failed.'}:d)));
 }
 const uploading=drafts.some(d=>!d.id&&!d.error),readyPhotos=drafts.filter(d=>d.id).map(d=>d.id!);
 const canSend=(!!message.trim()||readyPhotos.length>0||!!activeRef)&&!uploading&&!sending&&!busy;
 async function send(){
  if(!thread||!canSend||!gate())return;
  let text=message.trim();
  if(activeRef){const link=activeRef.kind==='listing'?listingLink(window.location.origin,activeRef.id):providerLink(window.location.origin,activeRef.id);text=(text?text+'\n':'')+link}
  setSending(true);
  try{const r=await net.act({action:'message',threadId:thread.id,body:text,...(readyPhotos.length?{photoIds:readyPhotos}:{})});if(r){setMessage('');dropDrafts(()=>false);if(activeRef)clearPendingRef();stick.current=true;await loadChat();input.current?.focus()}}
  finally{setSending(false)}
 }

 async function toggleArchive(){
  if(!thread)return;menu.current?.removeAttribute('open');const next=!archived;
  const r=await net.act({action:'thread_state',threadId:thread.id,archived:next});
  if(r){setArchived(next);notice(next?'Conversation archived.':'Moved back to your inbox.');if(next){setThreadId('')}}
 }
 async function block(){
  if(!thread)return;menu.current?.removeAttribute('open');
  if(blockedByMe){const r=await net.act({action:'unblock',to:thread.peer.id});if(r){notice(thread.peer.name+' is unblocked.');await loadChat()}return}
  if(!window.confirm('Block '+thread.peer.name+'? Neither of you can send messages, and they’ll be hidden from you. You can unblock later.'))return;
  const r=await net.act({action:'block',to:thread.peer.id});if(r){setChatBlocked(true);setBlockedByMe(true);notice(thread.peer.name+' is blocked.')}
 }

 // ---- Message list with day dividers and sender grouping ----
 const lastMine=[...chat].reverse().find(m=>m.mine);
 const rendered:ReactNode[]=[];
 chat.forEach((m,i)=>{
  const prev=chat[i-1],next=chat[i+1];
  if(!prev||dayKey(prev.createdAt)!==dayKey(m.createdAt))rendered.push(<li key={'day-'+m.id} className="nwm-day" role="separator"><span>{dayLabel(m.createdAt)}</span></li>);
  const joinsPrev=!!prev&&prev.mine===m.mine&&dayKey(prev.createdAt)===dayKey(m.createdAt)&&Date.parse(m.createdAt)-Date.parse(prev.createdAt)<GROUP_GAP;
  const joinsNext=!!next&&next.mine===m.mine&&dayKey(next.createdAt)===dayKey(m.createdAt)&&Date.parse(next.createdAt)-Date.parse(m.createdAt)<GROUP_GAP;
  const text=visibleText(m.body,previews),cards=typeof window==='undefined'?[]:messageLinks(m.body,window.location.host).map(l=>previews[previewKey(l)]).filter((p,j,all):p is LinkPreview=>!!p&&all.indexOf(p)===j);
  const receipt=features.receipts&&m.id===lastMine?.id?(peerRead&&peerRead>=m.createdAt?'Seen':'Sent'):'';
  rendered.push(<li key={m.id} className={'nwm-msg'+(m.mine?' mine':' theirs')+(joinsPrev?' joins-prev':'')+(joinsNext?' joins-next':'')}>
   <span className="sr-only">{m.mine?'You':m.authorName}, {fullStamp(m.createdAt)}: </span>
   <div className="nwm-bubble-wrap">
    {(text||m.photos?.length||cards.length)?<div className={'nwm-bubble'+(!text&&!cards.length?' photo-only':'')}>
     {!!m.photos?.length&&<div className={'nwm-photos n'+Math.min(m.photos.length,4)}>{m.photos.map(p=><a key={p.id} href={p.url} target="_blank" rel="noreferrer" aria-label="Open photo full size"><img src={p.thumbnail} alt="" loading="lazy" decoding="async" onLoad={keepBottom}/></a>)}</div>}
     {text&&<p>{text}</p>}
     {cards.map(p=><PreviewCard key={previewKey(p)} preview={p}/>)}
    </div>:null}
    {!m.mine&&<button type="button" className="nwm-msg-report" aria-label={'Report this message from '+m.authorName} title="Report" onClick={()=>onReport('message',m.id)}><Flag size={14} aria-hidden="true"/></button>}
   </div>
   {(!joinsNext||receipt)&&<div className="nwm-meta"><time dateTime={m.createdAt} title={fullStamp(m.createdAt)}>{timeOnly(m.createdAt)}</time>{receipt&&<span className="nwm-receipt">{receipt==='Seen'?<CheckCheck size={14} aria-hidden="true"/>:<Check size={14} aria-hidden="true"/>}{receipt}</span>}</div>}
  </li>);
 });

 // ---- Empty inbox ----
 if(!threads.length&&!thread){
  if(!net.ready)return <div className="nwm" aria-busy="true"><div className="nwm-list"><ListSkeleton/></div></div>;
  return <div className="nwm-empty">
   <HuddlesGuide pose="messages" caption="YOUR MESSAGES" line="Say hi to a collector." size="md"/>
   <div><h2>No messages yet.</h2><p>Message a seller from a listing, a Comic Workshop studio, or find a collector to say hi.</p>
    <div className="ds-actions"><button type="button" className="ds-btn ds-btn-primary" onClick={()=>{if(gate())onNewChat()}}><Search size={18} aria-hidden="true"/> Find a collector</button><button type="button" className="ds-btn ds-btn-secondary" onClick={()=>go('Marketplace')}>Browse the marketplace</button></div></div>
  </div>;
 }

 const sendHint=coarse?'':'Enter to send · Shift+Enter for a new line';
 return <div className={'nwm'+(thread?' has-thread':'')}>
  <aside className="nwm-list" aria-label="Conversations">
   <div className="nwm-list-head">
    <h2>Chats{unreadTotal>0&&<span className="nwm-count" aria-label={unreadTotal+' unread conversations'}>{unreadTotal}</span>}</h2>
    <button type="button" className="nwm-icon" aria-label="New message" title="New message" onClick={()=>{if(gate())onNewChat()}}><PenSquare size={20} aria-hidden="true"/></button>
   </div>
   <div className="nwm-tools">
    <label className="nwm-search"><Search size={17} aria-hidden="true"/><span className="sr-only">Search conversations</span><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search messages" enterKeyHint="search"/>{query&&<button type="button" aria-label="Clear search" onClick={()=>setQuery('')}><X size={15}/></button>}</label>
    <div className="nwm-chips" role="group" aria-label="Show">
     <button type="button" aria-pressed={filter==='all'} onClick={()=>setFilter('all')}>All</button>
     <button type="button" aria-pressed={filter==='unread'} onClick={()=>setFilter(filter==='unread'?'all':'unread')}>Unread{unreadTotal>0?' '+unreadTotal:''}{filter==='unread'&&<X size={13} aria-hidden="true"/>}</button>
     {archiveAvailable&&<button type="button" aria-pressed={filter==='archived'} onClick={()=>setFilter(filter==='archived'?'all':'archived')}>Archived{archivedTotal>0?' '+archivedTotal:''}{filter==='archived'&&<X size={13} aria-hidden="true"/>}</button>}
    </div>
   </div>
   {!net.ready&&!threads.length?<ListSkeleton/>:<ul className="nwm-rows">
    {shown.map(t=>{const unread=unreadOf(t),count=unread?Math.max(1,t.unreadCount||0):0;return <li key={t.id}>
     <button type="button" className={'nwm-row'+(threadId===t.id?' active':'')+(unread?' unread':'')} aria-current={threadId===t.id?'true':undefined} onClick={()=>setThreadId(t.id)}>
      <Avatar peer={t.peer} size={48}/>
      <span className="nwm-row-main">
       <span className="nwm-row-top"><strong>{t.peer.name}{(t.peer as {verified?:boolean}).verified&&<> <VerifiedBadge size={14}/></>}</strong><span className="nwm-handle">@{t.peer.handle}</span>{t.latestAt&&<time dateTime={t.latestAt}>{listStamp(t.latestAt)}</time>}</span>
       <span className="nwm-row-bottom"><span className="nwm-preview">{t.latest?(t.latestMine?'You: ':'')+t.latest.replace(/\s+/g,' '):t.context?'About: '+t.context:'No messages yet'}</span>{unread&&<span className="nwm-badge" aria-label={count>1?count+' unread messages':'Unread'}>{count>99?'99+':count>1?count:''}</span>}</span>
      </span>
     </button>
    </li>})}
   </ul>}
   {net.ready&&!shown.length&&<p className="nwm-none">{query?'No conversations match “'+query.trim()+'”.':filter==='unread'?'You’re all caught up.':filter==='archived'?'No archived conversations.':'No conversations yet.'}</p>}
  </aside>

  <section className="nwm-thread" aria-label={thread?'Conversation with '+thread.peer.name:'Conversation'}>{thread?<>
   <header className="nwm-thread-head">
    <button type="button" className="nwm-icon nwm-back" aria-label="Back to all messages" onClick={()=>setThreadId('')}><ArrowLeft size={22} aria-hidden="true"/></button>
    <button type="button" className="nwm-who" onClick={()=>onProfile(thread.peer.handle)} aria-label={'View '+thread.peer.name+'’s profile'}>
     <Avatar peer={thread.peer} size={40}/>
     <span><strong>{thread.peer.name}{(thread.peer as {verified?:boolean}).verified&&<> <VerifiedBadge size={15}/></>}</strong><small>@{thread.peer.handle}</small></span>
    </button>
    <details className="nwm-menu" ref={menu}>
     <summary className="nwm-icon" aria-label="Conversation options"><Ellipsis size={22} aria-hidden="true"/></summary>
     <div role="menu">
      <button type="button" role="menuitem" onClick={()=>{menu.current?.removeAttribute('open');onProfile(thread.peer.handle)}}><UserRound size={17} aria-hidden="true"/> View profile</button>
      {features.archive&&<button type="button" role="menuitem" disabled={busy} onClick={()=>void toggleArchive()}>{archived?<ArchiveRestore size={17} aria-hidden="true"/>:<Archive size={17} aria-hidden="true"/>} {archived?'Move to inbox':'Archive'}</button>}
      <button type="button" role="menuitem" disabled={busy||chatBlocked&&!blockedByMe} onClick={()=>void block()}><Ban size={17} aria-hidden="true"/> {blockedByMe?'Unblock':'Block'} {thread.peer.name}</button>
     </div>
    </details>
   </header>
   {contextCard?<div className="nwm-context"><PreviewCard preview={contextCard} compact/></div>:thread.context?<p className="nwm-context-text">About: {thread.context}</p>:null}
   <TradeTerms key={thread.id} threadId={thread.id} act={net.act} notify={notice}/>
   <div className="nwm-body" ref={body} onScroll={onScroll}>
    {chatLoading&&!chat.length?<ThreadSkeleton/>:null}
    {chatError&&<p className="nwm-error" role="alert">{chatError} <button type="button" onClick={()=>{setChatLoading(true);void loadChat()}}>Retry</button></p>}
    {!chat.length&&!chatLoading&&!chatError&&<div className="nwm-start"><HuddlesArt pose="messages" size="sm" decorative/><h3>Say hi to {thread.peer.name.split(' ')[0]}.</h3><p>Talk about the book, its condition or a trade. Keep addresses and payment details out of chat.</p></div>}
    <ol className="nwm-msgs" aria-live="polite" aria-relevant="additions">{rendered}</ol>
   </div>
   {chatBlocked?<p className="nwm-blocked" role="status">{blockedByMe?<>You blocked {thread.peer.name}. <button type="button" onClick={()=>void block()} disabled={busy}>Unblock</button></>:'You can’t send messages in this chat.'}</p>
   :<form className="nwm-composer" onSubmit={e=>{e.preventDefault();void send()}}>
    {(activeRef&&refCard||drafts.length>0)&&<div className="nwm-attachments">
     {activeRef&&refCard&&<div className="nwm-attached-ref"><PreviewCard preview={refCard} compact/><button type="button" className="nwm-remove" aria-label="Don’t attach this" onClick={clearPendingRef}><X size={14}/></button></div>}
     {drafts.map(d=><div key={d.key} className={'nwm-draft'+(d.error?' failed':'')+(!d.id&&!d.error?' loading':'')}><img src={d.preview} alt=""/>{d.error&&<span className="nwm-draft-error" title={d.error}>Failed</span>}<button type="button" className="nwm-remove" aria-label="Remove photo" onClick={()=>dropDrafts(x=>x.key!==d.key)}><X size={14}/></button></div>)}
    </div>}
    <div className="nwm-compose-row">
     {features.photos&&<><button type="button" className="nwm-icon nwm-attach" aria-label="Add photos" title="Add photos" disabled={drafts.length>=4||sending} onClick={()=>fileInput.current?.click()}><ImagePlus size={22} aria-hidden="true"/></button>
      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={e=>{addFiles(e.target.files);e.target.value=''}}/></>}
     <label className="sr-only" htmlFor="nwm-input">Message {thread.peer.name}</label>
     <textarea id="nwm-input" ref={input} rows={1} value={message} maxLength={1800} placeholder={'Message '+thread.peer.name.split(' ')[0]+'…'} enterKeyHint={coarse?'enter':'send'} aria-describedby={sendHint?'nwm-hint':undefined}
      onChange={e=>setMessage(e.target.value)}
      onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!coarse&&!e.nativeEvent.isComposing){e.preventDefault();void send()}}}/>
     <button type="submit" className="nwm-send" aria-label={sending?'Sending':'Send'} disabled={!canSend}><SendHorizontal size={20} aria-hidden="true"/></button>
    </div>
    {(sendHint||message.length>1600)&&<small id="nwm-hint" className="nwm-hint">{sendHint}{message.length>1600?(sendHint?' · ':'')+(1800-message.length)+' characters left':''}</small>}
   </form>}
  </>:<div className="nwm-idle"><MessageCircle size={28} aria-hidden="true"/><p>Pick a conversation to read it.</p></div>}</section>
 </div>;
}

function ListSkeleton(){return <ul className="nwm-rows nwm-skeleton" aria-hidden="true">{[0,1,2,3,4].map(i=><li key={i}><span className="nwm-row"><span className="sk-avatar"/><span className="nwm-row-main"><span className="sk-line w60"/><span className="sk-line w90"/></span></span></li>)}</ul>}
function ThreadSkeleton(){return <div className="nwm-skeleton nwm-thread-skeleton" role="status"><span className="sr-only">Loading messages…</span>{['l w50','r w40','l w70','r w55'].map((c,i)=><span key={i} className={'sk-bubble '+c}/>)}</div>}
