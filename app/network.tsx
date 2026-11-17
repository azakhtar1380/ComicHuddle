'use client';
import {EmptyState} from '../components/states';
import {SellerFeedback} from './community-feedback';
import CollectorWallet from './collector-wallet';
import ResolvedComicCover from './resolved-comic-cover';
import {accountSignInPath} from '../lib/account-intent';
import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {ArrowRight,ArrowUpRight,Check,Flag,Layers,MessageCircle,RefreshCw,Search,X} from 'lucide-react';
import {parseCatalogSearchPage} from '../lib/catalog-picker-client';
import {listingDirectoryId} from '../lib/shared-catalog';
import {catalog,type Issue} from '../lib/catalog';
import {bookIssue} from '../lib/trades';
import {activateDialog} from '../lib/dialog-focus';
import {emptyHub,previewRulesVersion,type HubData,type CollectorProfile,type ShowcaseBook} from '../lib/community';
import Marketplace from './marketplace';
import PageHeader from '../components/page-header';
import HuddlesGuide from '../components/huddles-guide';
import MessagesInbox,{type PendingRef} from '../components/messages/inbox';
export {countUnread} from '../components/messages/format';
import {LoadingState} from '../components/states';
import type {Vault} from '../lib/vault';
import BusinessFields from '../components/profile/business-fields';
import ProfilePage,{type PickKind} from '../components/profile/profile-page';
import {CharacterSheet,FavoritesSheet,IssueSheet} from '../components/profile/directory-pickers';
import ProfileShare from '../components/profile/profile-share';
import ThemeScreen from '../components/profile/theme-screen';
import {TrophyPreview} from '../components/trophies/trophy-ui';
import {DEFAULT_LOOK} from '../lib/profile-worlds';
import CollectionTab from '../components/collection/collection-tab';
import {handOffBooksForSale} from '../lib/listing-draft';
import ProfileDetailsFields,{draftFromExtras,saveDetails,type DetailsDraft} from '../components/profile/profile-details-fields';
import type {ProfileExtras} from '../lib/profile-page-types';
import {businessDraftProblem,draftFrom,fetchMyBusiness,forgetAccountType,rememberedAccountType,saveMyBusiness,type BusinessDraft,type BusinessSummary,type OwnBusiness} from '../components/profile/business-client';
import './network.css';

/** Public profile data plus the business fields /api/social appends (isBusiness, verified, shopName, business). */
type ProfileView=CollectorProfile&Partial<BusinessSummary>&{extras?:ProfileExtras};

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
 async function act(action:Record<string,unknown>,options:{rethrow?:boolean}={}):Promise<ActionResult|null>{
  if(busyRef.current)return null;busyRef.current=true;setBusy(true);setActionError('');const session=networkSession.current,current=()=>networkMounted.current&&networkSignedIn.current&&session===networkSession.current,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),40000);
  try{
   const r=await fetch('/api/social',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(action),signal:controller.signal});const d=await r.json() as ActionResult&{error?:string};if(!r.ok)throw Error(d.error||'Couldn’t save that. Try again.');if(!current())return null;
   if(action.action==='profile'||action.action==='listing'){
    networkRequest.current++;readController.current?.abort();
    if(d.profile)setData(previous=>({...previous,me:d.profile!}));
    setReady(true);setError('');void refresh();return d;
   }
   await refresh();return current()?d:null;
  }catch(e){if(current()){const message=controller.signal.aborted?'We’re not sure that saved. Your choices are still here. Check before trying again.':e instanceof Error&&e.message?e.message:'Couldn’t save that. Try again.';if(options.rethrow)throw Error(message);setActionError(message);notify(message)}return null}
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

export async function uploadPhoto(file:File){
 if(!/^image\/(jpeg|png|webp)$/.test(file.type))throw Error('Pick a JPEG, PNG or WebP photo.');if(file.size>20000000)throw Error('That photo is over 20 MB. Try a smaller one.');
 const bitmap=await createImageBitmap(file),ratio=Math.min(1,1800/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*ratio);canvas.height=Math.round(bitmap.height*ratio);const ctx=canvas.getContext('2d');if(!ctx){bitmap.close();throw Error('Couldn’t prepare this photo. Try another.')};ctx.fillStyle='#f5f1e7';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const blob=await new Promise<Blob|null>(res=>canvas.toBlob(res,'image/jpeg',.88));if(!blob)throw Error('Couldn’t prepare this photo. Try another.');const r=await fetch('/api/media',{method:'POST',headers:{'Content-Type':'image/jpeg'},body:blob}),d=await r.json() as {error?:string;id:string};if(!r.ok)throw Error(d.error);return d.id as string;
}
function BookGrid({books,onBook,label}:{books:ShowcaseBook[];onBook:(b:ShowcaseBook)=>void;label:string}){
 return <ul className="nw-books" aria-label={label}>{books.map(b=><li key={b.id}><button type="button" className="nw-book" onClick={()=>onBook(b)} aria-label={'Peek inside '+b.title+' '+(/^#/.test(b.issue)||!b.issue?b.issue:'#'+b.issue)+': see full details'}><ComicArt book={b}/><strong>{b.title} {b.issue}</strong>{b.grade&&<small>{b.grade}</small>}<span className="peek-inside nw-peek" aria-hidden="true">Peek inside <ArrowRight size={14}/></span></button></li>)}</ul>;
}
type Props={initialCollector?:string;profileTabRequest?:{tab:'collection';chip:'all'|'trade';n:number}|null;onEditBook?:(id:string)=>void;onScanComic?:()=>void;saving?:boolean;onAddComic?:()=>void;addComicOpen?:boolean;myProfileRequest:number;tab:string;net:Net;vault:Vault;commit:(v:Vault)=>Promise<boolean>;go:(s:string)=>void;openIssue:(id:number)=>void;openCollection:()=>void;notice:(s:string)=>void;signedIn:boolean;name:string;gate:()=>boolean;profileOpen:boolean;setProfileOpen:(v:boolean)=>void;marketIssue:number|null;clearMarketIssue:()=>void;incomingThread:{id:string;version:number};preferredRole:'collector'|'provider';onProviderProfileCreated:()=>void;onAccountProfileSaved:()=>void};
export default function CollectorNetwork({initialCollector,profileTabRequest,onEditBook,onScanComic,saving=false,onAddComic,addComicOpen,myProfileRequest,tab,net,vault,commit,go,openIssue,openCollection,notice,signedIn,name,gate:parentGate,profileOpen,setProfileOpen,marketIssue,clearMarketIssue,incomingThread,preferredRole,onProviderProfileCreated,onAccountProfileSaved}:Props){
 const {data,busy}=net;function gate(){const okay=parentGate();if(!okay)setNewChat(false);return okay;}const [search,setSearch]=useState('');
 const [threadId,setThreadId]=useState(''),[newChat,setNewChat]=useState(false),[pendingRef,setPendingRef]=useState<PendingRef|null>(null);
 const [profile,setProfile]=useState<CollectorProfile|null>(null),[share,setShare]=useState<CollectorProfile|null>(null);
 const [report,setReport]=useState<{type:string;id:string}|null>(null);
 const profileRequest=useRef(0),currentProfileSelection=useRef('');
 const [profileLoading,setProfileLoading]=useState(false);
 // Collector, workshop provider or Business (round 4). Business details save through /api/business after the profile saves.
 const [accountRole,setAccountRole]=useState<'collector'|'provider'|'business'>('collector'),[myBusiness,setMyBusiness]=useState<OwnBusiness|null>(null),[bizDraft,setBizDraft]=useState<BusinessDraft>(draftFrom(null)),[bizError,setBizError]=useState(''),[bizSaving,setBizSaving]=useState(false);
 const [signInHref,setSignInHref]=useState('/sign-in?return_to=%2F');
 useEffect(()=>{if(profileOpen)setSignInHref(accountSignInPath(window.location.pathname,window.location.search,preferredRole,tab))},[profileOpen,preferredRole,tab]);
 const me=data.me;
 if(tab!=='Collectors')currentProfileSelection.current='';
 useEffect(()=>{if(tab!=='Collectors'){selectProfile(null);setProfileLoading(false)}},[tab]);
 useEffect(()=>{selectProfile(null)},[myProfileRequest]);
 useEffect(()=>()=>{profileRequest.current++},[]);
 useEffect(()=>{setSearch('')},[tab,marketIssue]);
 useEffect(()=>{if(incomingThread.id)setThreadId(incomingThread.id)},[incomingThread.version]);
 // Reset the account-type choice each time the form opens (adjusting state during render, not in an effect).
 const bizOpenKey=profileOpen&&signedIn?'open':'',[bizSeenKey,setBizSeenKey]=useState(''),[details,setDetails]=useState<DetailsDraft>(draftFromExtras(undefined));
 if(bizOpenKey!==bizSeenKey){setBizSeenKey(bizOpenKey);if(bizOpenKey){setDetails(draftFromExtras((me as ProfileView|null)?.extras));setBizError('');setAccountRole(me?.provider?'provider':!me&&rememberedAccountType()==='business'?'business':preferredRole);if(!me)setMyBusiness(null);setBizDraft(draftFrom(me?myBusiness:null))}}
 useEffect(()=>{
  if(!profileOpen||!signedIn||!me)return;
  const controller=new AbortController();
  void fetchMyBusiness(controller.signal).then(({business})=>{if(controller.signal.aborted)return;setMyBusiness(business);if(business){setBizDraft(draftFrom(business));if(business.accountType==='business')setAccountRole('business')}}).catch(()=>undefined);
  return()=>controller.abort();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[profileOpen,signedIn,me?.id]);
 // Clean links (/@handle) open that profile; the browser Back button to a /@handle address does too.
 useEffect(()=>{if(initialCollector)void loadProfile(initialCollector,false);const open=(event:Event)=>{const handle=(event as CustomEvent<string>).detail;if(typeof handle==='string')void loadProfile(handle,false)};window.addEventListener('ch:open-collector',open);return()=>window.removeEventListener('ch:open-collector',open)},[]);
 function selectProfile(value:CollectorProfile|null){profileRequest.current++;currentProfileSelection.current='';setProfileLoading(false);setProfile(value)}
 async function loadProfile(handle:string,push=true){
  selectProfile(null);const request=++profileRequest.current;currentProfileSelection.current=handle;if(push)go('Collectors');setProfileLoading(true);
  const current=()=>request===profileRequest.current&&currentProfileSelection.current===handle;
  try{const r=await fetch('/api/social?kind=profile&handle='+encodeURIComponent(handle)),d=await r.json() as CollectorProfile&{error?:string};if(!r.ok)throw Error(d.error);if(current()){selectProfile(d);const path='/@'+d.handle;if(window.location.pathname!==path)window.history.replaceState({chSection:'Collectors'},'',path)}}
  catch(e){if(current())notice(e instanceof Error&&e.message?e.message:'Couldn’t open that profile. Try again.')}
  finally{if(current())setProfileLoading(false)}
 }
 async function startMessage(to:string,context='',ref:{listingId?:string;providerId?:string}={}){if(!gate())return false;const listing=ref.listingId?undefined:data.listings.find(l=>l.sellerId===to&&l.title===context&&l.status==='active'),listingId=ref.listingId||listing?.id;const d=await net.act({action:'start_thread',to,context,...(listingId?{listingId}:{}),...(ref.providerId?{providerId:ref.providerId}:{})});if(d?.threadId){setPendingRef(listingId?{threadId:d.threadId,kind:'listing',id:listingId}:ref.providerId?{threadId:d.threadId,kind:'provider',id:ref.providerId,title:data.people.find(p=>p.provider?.id===ref.providerId)?.provider?.name}:null);setThreadId(d.threadId);setNewChat(false);selectProfile(null);go('Messages');return true}return false}
 // Deep link: /?section=Messages&to=<profileId>[&listing=<id>|&provider=<id>] opens (or starts) that conversation once signed in.
 const deepLink=useRef<{to:string;listing?:string;provider?:string}|null>(null);
 useEffect(()=>{const q=new URLSearchParams(window.location.search),to=q.get('to');if(q.get('section')==='Messages'&&to)deepLink.current={to:to.slice(0,100),listing:q.get('listing')?.slice(0,100)||undefined,provider:q.get('provider')?.slice(0,100)||undefined}},[]);
 useEffect(()=>{
  const link=deepLink.current;if(!link||tab!=='Messages'||!signedIn||!net.ready||busy)return;
  if(link.to===me?.id){deepLink.current=null;return}
  if(!gate())return;
  deepLink.current=null;const url=new URL(window.location.href);for(const key of ['to','listing','provider'])url.searchParams.delete(key);window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);
  const existing=data.threads.find(t=>t.peer.id===link.to);
  if(existing&&!link.listing&&!link.provider){setThreadId(existing.id);return}
  void startMessage(link.to,'',{listingId:link.listing,providerId:link.provider}).then(ok=>{if(!ok&&existing)setThreadId(existing.id)});
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[tab,signedIn,net.ready,busy,me?.id]);
 const currentProfile=profile||me,own=!!currentProfile&&currentProfile.id===me?.id,viewingOther=!!profile&&profile.id!==me?.id;
 const profileHeader=profileLoading||currentProfile?null:<PageHeader id="nw-profile-title" eyebrow="My profile" title="Your shelf." accent="Your story." lede='Pick a name. Show off six favorite books. It’s free.' pose="profile" caption="YOUR SHELF" line="Pick six favorites to show off." actions={<><button type="button" className="ds-btn ds-btn-primary" onClick={()=>{selectProfile(null);setProfileOpen(true)}}>Create my profile <ArrowRight size={18} aria-hidden="true"/></button><button type="button" className="ds-btn ds-btn-secondary" onClick={openCollection}><Layers size={18} aria-hidden="true"/> My collection</button></>}/>;
 const [picking,setPicking]=useState<PickKind|null>(null);
 const [uploading,setUploading]=useState<''|'photo'|'cover'>(''),[themeOpen,setThemeOpen]=useState(false);
 async function upload(kind:'photo'|'cover',file:File){
  if(uploading)return;if(!/^image\/(jpeg|png|webp)$/.test(file.type)){notice('Pick a JPEG, PNG or WebP photo.');return}if(file.size>4194304){notice('That photo is over 4 MB. Try a smaller one.');return}
  setUploading(kind);try{const r=await fetch(kind==='photo'?'/api/avatar':'/api/profile-cover',{method:'POST',credentials:'same-origin',headers:{'Content-Type':file.type},body:file});const d=await r.json().catch(()=>({})) as {error?:string};if(!r.ok)throw Error(d.error||'That photo didn’t upload.');await refreshOwn();notice(kind==='photo'?'Profile photo saved.':'Cover photo saved.')}
  catch(e){notice(e instanceof Error&&e.message?e.message:'That photo didn’t upload. Try again.')}finally{setUploading('')}
 }
 // Your own profile opened from /@handle is a loaded copy: after a change, show the refreshed one.
 async function refreshOwn(){await net.refresh();if(profile&&profile.id===me?.id)selectProfile(null)}
 const [shareTrophy,setShareTrophy]=useState<{name:string;tier:string}|null>(null);
 // Reads the address once the account has loaded (it is only known in the browser), then clears it.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{const q=new URLSearchParams(window.location.search);if(q.get('share')!=='1'||!me)return;const [name,tier]=(q.get('trophy')||'').split('|');if(name&&tier)setShareTrophy({name:name.slice(0,40),tier:tier.slice(0,20)});setShare(me);const url=new URL(window.location.href);url.searchParams.delete('share');url.searchParams.delete('trophy');window.history.replaceState(window.history.state,'',url.pathname+url.search)},[me?.id]);
 async function copyProfileLink(p:CollectorProfile){try{await navigator.clipboard.writeText(window.location.origin+'/@'+p.handle);notice('Profile link copied.')}catch{notice('Copy didn’t work. Your link is comichuddle.com/@'+p.handle)}}
 // Copies in an active listing can't be removed or sold twice.
 const listedIds=new Set(data.listings.filter(l=>l.status==='active'&&l.sellerId===me?.id).flatMap(l=>[l.bookId,...l.items.map(item=>item.bookId)].filter((id):id is string=>!!id)));
 const [wantRecords,setWantRecords]=useState<Record<number,Issue>>({});
 const wantKey=tab==='Collectors'&&currentProfile?currentProfile.wantIds.slice(0,12).filter(id=>!catalog[id]&&!wantRecords[id]).join(','):'';
 useEffect(()=>{if(!wantKey)return;const controller=new AbortController();void fetch('/api/catalog?ids='+wantKey,{signal:controller.signal}).then(async response=>{if(!response.ok)throw Error();return parseCatalogSearchPage(await response.json())}).then(page=>{if(!controller.signal.aborted)setWantRecords(previous=>({...previous,...Object.fromEntries(page.issues.map(issue=>[issue.id,issue]))}))}).catch(()=>undefined);return()=>controller.abort()},[wantKey]);
 const openBook=(b:ShowcaseBook)=>{const id=b.directoryIssueId??listingDirectoryId(b)??bookIssue(b)?.id;if(id!==undefined&&id!==null)openIssue(id)};
 return <>
 {['Marketplace','Collectors','Messages'].includes(tab)&&net.error&&<div className="network-error nw-error" role="alert"><strong>{net.error}</strong><button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" onClick={()=>void net.refresh()}><RefreshCw size={16} aria-hidden="true"/> Try again</button></div>}
 {tab==='Marketplace'&&<Marketplace onOpenIssue={openIssue} commit={commit} onAddComic={onAddComic} addComicOpen={addComicOpen} net={net} vault={vault} gate={gate} notice={notice} openCollection={openCollection} marketIssue={marketIssue} clearIssue={clearMarketIssue} onSeller={handle=>void loadProfile(handle)} onMessage={(id,title)=>void startMessage(id,title)} onReport={id=>setReport({type:'listing',id})}/> }
 {tab==='Collectors'&&<section className="nw-profile" aria-labelledby="nw-profile-title">
  {profileLoading?<LoadingState message="Loading this shelf…"/>:<>
   {profileHeader}
   {currentProfile?<ProfilePage p={currentProfile as ProfileView} own={own} busy={busy} wants={wantRecords} uploading={uploading}
     onBack={()=>{if(viewingOther)go('My Profile');else if(window.history.length>1)window.history.back();else go('Home')}}
     onEdit={()=>setProfileOpen(true)} onPick={setPicking} onBook={openBook} onIssue={openIssue} onReport={()=>{if(gate())setReport({type:'profile',id:currentProfile.id})}}
     onMessage={context=>void startMessage(currentProfile.id,context||'')} onShare={()=>setShare(currentProfile)} onTheme={()=>setThemeOpen(true)} onCollection={openCollection}
     onPhoto={file=>void upload('photo',file)} onCover={file=>void upload('cover',file)} onCopyLink={()=>void copyProfileLink(currentProfile)} art={b=><ComicArt book={b}/>}
     tabRequest={profileTabRequest&&own?{tab:'collection',n:profileTabRequest.n}:null}
     collectionTab={<CollectionTab key={currentProfile.handle+(profileTabRequest?.n||0)} handle={currentProfile.handle} own={own} dmOpen={currentProfile.dmOpen} notice={notice} onIssue={openIssue} initialChip={own&&profileTabRequest?.chip==='trade'?'trade':'all'}
      owner={own?{vault,commit,saving,listedIds,onEditCopy:id=>onEditBook?.(id),onScan:()=>onScanComic?.(),onSell:ids=>{const free=ids.filter(id=>!listedIds.has(id));if(!free.length){notice('That comic is already listed for sale.');return}handOffBooksForSale(free);window.location.assign('/?'+new URLSearchParams({section:'Marketplace',sell:free.length>1?'collection':'single'}))}}:undefined}/>}
     trophyPreview={<TrophyPreview key={currentProfile.handle} handle={currentProfile.handle} own={own}/>}
     reviewsTab={<section className="pp-card pp-block" aria-label="Seller feedback"><SellerFeedback profileId={currentProfile.id}/></section>}
     ownerExtras={own?<section className="pp-card pp-block" aria-labelledby="nw-wallet"><div className="pp-block-head"><h2 id="nw-wallet"><span className="pp-eyebrow">Only you can see this</span>Wallet</h2><a className="ds-link" href="/wallet">How rewards work <ArrowUpRight size={16} aria-hidden="true"/></a></div><CollectorWallet key={currentProfile.id} showInfoLink={false}/></section>:undefined}/>
   :<div className="nw-invite ds-card"><ul>
     <li><b>Your collection is private.</b> You choose what to show.</li>
     <li><b>Six favorites.</b> Put your best books up front.</li>
     <li><b>One account.</b> Sell, trade and get your comics pressed, all with one account.</li>
    </ul></div>}
  </>}
 </section>}
 {tab==='Messages'&&!signedIn&&<section className="nw-messages nw-messages-guest" aria-labelledby="nw-messages-title"><h1 id="nw-messages-title" className="sr-only">Messages</h1><EmptyState title="Sign in to view your messages." message="Your conversations with collectors, sellers and workshops stay private to your account." action={{label:'Sign in',href:'/sign-in?return_to=%2F%3Fsection%3DMessages'}}/></section>}
 {tab==='Messages'&&signedIn&&<section className="nw-messages" aria-labelledby="nw-messages-title">
  <h1 id="nw-messages-title" className="sr-only">Messages</h1>
  <MessagesInbox net={net} threadId={threadId} setThreadId={setThreadId} gate={gate} notice={notice} go={go} onProfile={handle=>void loadProfile(handle)} onReport={(type,id)=>setReport({type,id})} onNewChat={()=>setNewChat(true)} upload={uploadPhoto} pendingRef={pendingRef} clearPendingRef={()=>setPendingRef(null)}/>
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
   <form className="nw-join-form" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);setBizError('');
    const asBusiness=accountRole==='business';if(asBusiness){const problem=businessDraftProblem(bizDraft);if(problem){setBizError(problem);return}}
    const r=await net.act({action:'profile',handle:String(f.get('handle')),name:String(f.get('name')),bio:String(f.get('bio')),tagline:String(f.get('tagline')),location:String(f.get('location')),favorite:String(f.get('favorite')),since:Number(f.get('since')),color:String(f.get('color')),featured:me?.featured||[],visible:f.get('visible')==='on',dmOpen:f.get('dmOpen')==='on',accept:f.get('accept')==='on'});
    if(r&&(asBusiness||myBusiness?.accountType==='business')){setBizSaving(true);try{const saved=await saveMyBusiness(asBusiness?'business':'collector',bizDraft);setMyBusiness(saved.business);forgetAccountType();void net.refresh();if(saved.verificationCleared)notice('Your verified tick was removed because your shop details changed. An admin will check again.')}catch(err){setBizError((err instanceof Error&&err.message?err.message:'Couldn’t save your shop details.')+' Your profile itself was saved.');void net.refresh();return}finally{setBizSaving(false)}}
    if(r&&me){try{await saveDetails(details);await refreshOwn()}catch(err){notice((err instanceof Error?err.message:'Your profile details could not be saved.')+' The rest of your profile was saved.')}}
    if(r){onAccountProfileSaved();setProfileOpen(false);selectProfile(null);if(f.get('accountRole')==='provider'&&(!me?.provider||preferredRole==='provider'))onProviderProfileCreated();notice(me?'Showcase saved.':'Your profile is ready. Welcome to ComicHuddle!')}}}>
    <label className="ds-field"><span>I’m joining as</span><select name="accountRole" value={accountRole} onChange={e=>{const v=e.target.value;setAccountRole(v==='business'||v==='provider'?v:'collector');setBizError('')}} aria-describedby="nw-role-help"><option value="collector">A collector (personal profile)</option><option value="provider">A collector who also presses or cleans comics</option><option value="business">A business (comic shop or dealer)</option></select><small id="nw-role-help">Everyone gets a showcase. Pros also get a free studio page. Businesses add shop details and can be verified.</small></label>
    {accountRole==='business'&&<BusinessFields value={bizDraft} onChange={setBizDraft} disabled={busy||bizSaving} current={myBusiness}/>}
    {accountRole!=='business'&&myBusiness?.accountType==='business'&&<p className="nw-note" role="note">Saving as a collector hides your shop details and removes any verified tick. We keep the details in case you switch back.</p>}
    <label className="ds-field"><span>Handle <span className="required-mark" aria-hidden="true">*</span></span><input name="handle" required minLength={3} maxLength={24} pattern="[a-z][a-z0-9_]{2,23}" defaultValue={me?.handle||''} placeholder="your_name" autoCapitalize="none" spellCheck={false} aria-describedby="nw-handle-help"/><small id="nw-handle-help">Lowercase letters, numbers and underscores.</small></label>
    <label className="ds-field"><span>Display name <span className="required-mark" aria-hidden="true">*</span></span><input name="name" required maxLength={60} defaultValue={me?.name||(name.includes('@')?'Collector':name)} placeholder="The name on your shelf"/></label>
    <label className="ds-field"><span>City and state <span className="required-mark" aria-hidden="true">*</span></span><input name="location" required minLength={2} maxLength={60} defaultValue={me?.location||''} placeholder="Minneapolis, MN" aria-describedby="nw-location-help"/><small id="nw-location-help">City and state only, like Minneapolis, MN. Never a street address.</small></label>
    <label className="ds-field"><span>Collecting since <span className="required-mark" aria-hidden="true">*</span></span><input name="since" type="number" inputMode="numeric" min="1930" max={new Date().getFullYear()} defaultValue={me?.since||new Date().getFullYear()} required/></label>
    {me&&<ProfileDetailsFields value={details} onChange={setDetails} disabled={busy||bizSaving}/>}
    <details className="nw-join-more"><summary>More about you (optional)</summary>
     <label className="ds-field"><span>Tagline</span><input name="tagline" maxLength={100} defaultValue={me?.tagline||''} placeholder="One line about your collecting"/></label>
     <label className="ds-field"><span>Origin story (about you)</span><textarea name="bio" maxLength={500} defaultValue={me?.bio||''} placeholder="What do you collect, and why?"/></label>
     <label className="ds-field"><span>Now reading (into right now)</span><input name="favorite" maxLength={80} defaultValue={me?.favorite||''} placeholder="A character, era or series"/></label>
     <label className="ds-field"><span>Profile color</span><select name="color" defaultValue={me?.color||'red'}><option value="red">Red</option><option value="blue">Blue</option><option value="yellow">Yellow</option><option value="teal">Teal</option></select></label>
    </details>
    <label className="nw-check"><input name="visible" type="checkbox" defaultChecked={me?.visible??true}/><span>Let other members see my showcase, trade pile and wants.</span></label>
    <label className="nw-check"><input name="dmOpen" type="checkbox" defaultChecked={me?.dmOpen??true}/><span>Let collectors message me.</span></label>
    <label className="nw-check"><input name="accept" type="checkbox" required defaultChecked={me?.consent?.version===previewRulesVersion}/><span>I’m 18+, live in the US, and agree to the <a className="nw-rules-link" href="/?section=Rules" target="_blank" rel="noreferrer">collector rules</a>.<span className="required-mark" aria-hidden="true"> *</span></span></label>
    <p className="nw-note">Your collection is private. You choose what to show. We save the rules version ({previewRulesVersion}) and the date you agreed.</p>
    {net.actionError&&<p className="ds-error" role="alert">{net.actionError}</p>}
    {bizError&&<p className="ds-error" role="alert">{bizError}</p>}
    <button type="submit" className="ds-btn ds-btn-primary nw-join-cta" disabled={busy||bizSaving}>{busy||bizSaving?'Saving…':me?'Save showcase':'Create my profile'}<Check size={18} aria-hidden="true"/></button>
   </form>
  </>}
 </div></Modal>}
 {newChat&&<Modal label="New message" onClose={()=>setNewChat(false)}><div className="form-dialog nw-join">
  <p className="ds-eyebrow">New message</p><h2 className="nw-join-title">Find a <span>collector.</span></h2>
  <label className="ds-field"><span>Name or handle</span><span className="nw-search-field"><Search size={18} aria-hidden="true"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search collectors" type="search"/>{search&&<button type="button" className="nw-search-clear" aria-label="Clear collector search" onClick={()=>setSearch('')}><X size={16}/></button>}</span></label>
  <ul className="nw-people">{data.people.filter(p=>p.id!==me?.id&&p.dmOpen&&(p.name+' '+p.handle).toLowerCase().includes(search.toLowerCase())).map(p=><li key={p.id}><button type="button" className="nw-thread" disabled={busy} onClick={()=>void startMessage(p.id)}>{p.avatarUrl?<span className="nw-avatar nw-avatar-photo" aria-hidden="true"><img src={p.avatarUrl} alt="" width={40} height={40}/></span>:<span className="nw-avatar" aria-hidden="true">{p.name.slice(0,1).toUpperCase()}</span>}<span className="nw-thread-copy"><strong>{p.name}</strong><small>@{p.handle}</small></span><MessageCircle size={18} aria-hidden="true"/></button></li>)}</ul>
  {!data.people.some(p=>p.id!==me?.id&&p.dmOpen)&&<p className="nw-empty">No collectors are taking messages yet.</p>}
 </div></Modal>}
 {picking&&me&&(()=>{const x=(me as ProfileView).extras,close=()=>setPicking(null),saved=(message:string)=>{notice(message);void refreshOwn()};
  const asIssue=(r:{issueId:number;title:string;number:string;year:number|null})=>({id:r.issueId,title:r.title,number:r.number,year:r.year||0,publisher:'',era:'',characters:[],writer:'',artist:'',note:'',kind:'',variant:'',source:''}) as Issue;
  if(picking==='six')return <FavoritesSheet initial={(me.showcase||[]).slice(0,6).map(b=>({key:b.id,issueId:b.directoryIssueId??null,label:b.title+' '+(/^#/.test(b.issue)||!b.issue?b.issue:'#'+b.issue)}))} onClose={close} onSaved={saved}/>;
  if(picking==='character')return <CharacterSheet current={x?.favoriteCharacter?{id:x.favoriteCharacter.id,name:x.favoriteCharacter.name}:null} onClose={close} onSaved={saved}/>;
  if(picking==='comic')return <IssueSheet kind="comic" current={x?.favoriteComic?asIssue(x.favoriteComic):null} onClose={close} onSaved={saved}/>;
  return <IssueSheet kind="grail" current={x?.grail?asIssue(x.grail):null} reward={x?.grail?.reward||''} onClose={close} onSaved={saved}/>;
 })()}
 {share&&<Modal label="Share your profile" wide onClose={()=>setShare(null)}><div className="form-dialog nw-join"><ProfileShare p={share as ProfileView} own={share.id===me?.id} trophy={share.id===me?.id?shareTrophy:null} notice={notice} onSettingsSaved={()=>void refreshOwn()}/></div></Modal>}
 {themeOpen&&me&&<Modal label="Pick your world" wide onClose={()=>setThemeOpen(false)}><div className="form-dialog nw-join"><ThemeScreen name={me.name} avatarUrl={me.avatarUrl||null} initial={(me as ProfileView).extras?.look||DEFAULT_LOOK} notice={notice} onCancel={()=>setThemeOpen(false)} onSaved={()=>{setThemeOpen(false);void refreshOwn()}}/></div></Modal>}
 {report&&<Modal label="Report this" onClose={()=>setReport(null)}><div className="form-dialog nw-join">
  <p className="ds-eyebrow">Report</p><h2 className="nw-join-title">Something <span>not okay?</span></h2>
  <form className="nw-join-form" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget),r=await net.act({action:'report',targetType:report.type,targetId:report.id,reason:String(f.get('reason'))});if(r){setReport(null);notice('Thanks. We’ll take a look.')}}}>
   <label className="ds-field"><span>What happened? <span className="required-mark" aria-hidden="true">*</span></span><textarea name="reason" required maxLength={500} placeholder="Tell us what’s wrong. Skip private details." aria-describedby="nw-report-help"/><small id="nw-report-help">We review every report. We don’t have round-the-clock moderators yet.</small></label>
   <button type="submit" className="ds-btn ds-btn-primary nw-join-cta" disabled={busy}><Flag size={18} aria-hidden="true"/> Send report</button>
  </form>
 </div></Modal>}
 </>;
}
