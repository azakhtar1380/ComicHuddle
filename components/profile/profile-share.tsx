'use client';
// Share screen: one card (light HTML preview), copy link, five share buttons, chat preview, and what the public
// link shows. Opens instantly: the full 1080×1920 PNG is drawn only when someone taps Instagram, Save card or
// More, and is cached for the session until the profile changes.
import {useEffect,useId,useMemo,useState} from 'react';
import {Check,Download,Loader2,Lock,MessageSquareText,MoreHorizontal} from 'lucide-react';
import qrcode from 'qrcode-generator';
import {HUDDLES_SRC,LOGO_SRC,cardKey,drawShareCard,type CardImages,type ShareCardData} from '../../lib/share-cards';
import {emptyExtras,profilePath,type ProfileExtras} from '../../lib/profile-page-types';
import ShareCardPreview from './share-card-preview';
import type {ProfileView} from './profile-page';
import './profile-share.css';

// Finished PNGs for this session, by card contents.
const pngCache=new Map<string,Promise<Blob>>();
async function bitmap(url:string|null){
 if(!url)return null;
 try{const r=await fetch(url,{credentials:'same-origin'});if(!r.ok)return null;return await createImageBitmap(await r.blob())}catch{return null}
}
const fontsReady=()=>Promise.all(["800 108px 'Barlow Condensed'","800 40px 'DM Sans'","700 44px 'DM Sans'","600 34px 'DM Sans'","500 38px 'DM Sans'"].map(f=>document.fonts.load(f))).catch(()=>undefined);
const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
function buildPng(card:ShareCardData,sources:{avatar:string|null;cover:string|null}){
 const key=cardKey(card),cached=pngCache.get(key);if(cached)return cached;
 const job=(async()=>{
  // Fetch and decode everything in parallel (createImageBitmap decodes off the main thread), then draw in one step.
  const [avatar,cover,huddles,logo]=await Promise.all([bitmap(sources.avatar),bitmap(sources.cover),bitmap(HUDDLES_SRC),bitmap(LOGO_SRC),fontsReady()]);
  await frame();
  const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1920;const ctx=canvas.getContext('2d');if(!ctx)throw Error('Your card couldn’t be drawn on this device.');
  const images:CardImages={avatar,cover,huddles,logo};drawShareCard(ctx,card,images);
  for(const b of [avatar,cover,huddles,logo])b?.close();
  const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('Your card couldn’t be saved as a picture.');
  return blob;
 })();
 pngCache.set(key,job);job.catch(()=>pngCache.delete(key));
 return job;
}
type QrCode={svg:string};
const qrCache=new Map<string,QrCode>();
function qrFor(url:string){const hit=qrCache.get(url);if(hit)return hit;const q=qrcode(0,'M');q.addData(url);q.make();const code={svg:q.createSvgTag({cellSize:4,margin:0,scalable:true})};qrCache.set(url,code);return code}
const isPhone=()=>typeof navigator!=='undefined'&&/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
function InstagramGlyph(){return <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5.2" fill="none" stroke="#fff" strokeWidth="2"/><circle cx="12" cy="12" r="4.2" fill="none" stroke="#fff" strokeWidth="2"/><circle cx="17.3" cy="6.7" r="1.3" fill="#fff"/></svg>}
function FacebookGlyph(){return <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="#fff" d="M13.6 21v-7.6h2.6l.4-3h-3V8.5c0-.9.3-1.5 1.5-1.5h1.6V4.3c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H8v3h2.5V21h3.1z"/></svg>}

export default function ProfileShare({p,own,notice,trophy,onSettingsSaved}:{p:ProfileView;own:boolean;notice:(s:string)=>void;trophy?:{name:string;tier:string}|null;onSettingsSaved?:()=>void}){
 const x:ProfileExtras=p.extras||emptyExtras,ids=useId();
 const [copied,setCopied]=useState(false),[working,setWorking]=useState(''),[share,setShare]=useState(x.share);
 // Client-only (the share screen opens after a tap), so window is available.
 const url=(typeof window==='undefined'?'https://comichuddle.com':window.location.origin)+profilePath(p.handle);
 useEffect(()=>{if(!copied)return;const timer=setTimeout(()=>setCopied(false),1500);return()=>clearTimeout(timer)},[copied]);
 const rating=x.rating?(x.rating.stars!==null?x.rating.stars.toFixed(1):x.rating.percent+'%'):null;
 const card=useMemo<ShareCardData>(()=>({name:p.name,handle:p.handle,since:p.since,comics:p.stats.comics,keys:x.keys,trades:p.stats.trades,rating,
  verified:p.verified?(p.isBusiness?'business':'person'):null,founder:!!p.staff?.founder,favoriteCharacter:x.favoriteCharacter?.name||null,
  grail:x.grail?`${x.grail.title} #${x.grail.number}`:null,avatar:p.avatarUrl||null,cover:x.coverUrl,trophy:trophy||null}),
 [p.name,p.handle,p.since,p.stats.comics,x.keys,p.stats.trades,rating,p.verified,p.isBusiness,p.staff?.founder,x.favoriteCharacter?.name,x.grail,p.avatarUrl,x.coverUrl,trophy]);
 // The QR code is built just after the window first paints, once per link for the session.
 const [qr,setQr]=useState<QrCode|null>(()=>qrCache.get(url)||null);
 useEffect(()=>{if(qr)return;const t=setTimeout(()=>setQr(qrFor(url)),0);return()=>clearTimeout(t)},[qr,url]);
 const filename=`comichuddle-${p.handle}.png`;
 const png=()=>buildPng(card,{avatar:card.avatar,cover:card.cover&&/[?&]id=/.test(card.cover)?card.cover+'&w=1080':card.cover});
 async function copyLink(){try{await navigator.clipboard.writeText(url);setCopied(false);setTimeout(()=>setCopied(true),0)}catch{notice('Copy didn’t work. Select the link and copy it.')}}
 const file=async()=>new File([await png()],filename,{type:'image/png'});
 async function run(name:string,action:()=>Promise<void>){if(working)return;setWorking(name);try{await action()}catch(error){if((error as Error)?.name!=='AbortError')notice(error instanceof Error&&error.message?error.message:'Sharing didn’t go through. Try again.')}finally{setWorking('')}}
 async function fallback(message:string){await copyLink();notice(message)}
 const instagram=()=>run('instagram',async()=>{const f=await file();if(navigator.canShare?.({files:[f]})){await navigator.share({files:[f],title:p.name+' on ComicHuddle'});return}await fallback('Instagram sharing isn’t available here, so we copied your link.')});
 const facebook=()=>run('facebook',async()=>{window.open('https://www.facebook.com/sharer/sharer.php?u='+encodeURIComponent(url),'_blank','noopener,noreferrer,width=600,height=520')});
 const messages=()=>run('messages',async()=>{const text=`Check out my comic collection on ComicHuddle: ${url}`;if(navigator.share){await navigator.share({title:p.name+' on ComicHuddle',text,url});return}if(isPhone()){window.location.href='sms:?&body='+encodeURIComponent(text);return}await fallback('Texting isn’t available on this device, so we copied your link.')});
 const save=()=>run('save',async()=>{const blob=await png(),href=URL.createObjectURL(blob),a=document.createElement('a');a.href=href;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),2000);notice('Your card is saved.')});
 const more=()=>run('more',async()=>{if(navigator.share){const f=await file().catch(()=>null);await navigator.share(f&&navigator.canShare?.({files:[f]})?{files:[f],title:p.name+' on ComicHuddle',url}:{title:p.name+' on ComicHuddle',url});return}await fallback('Sharing isn’t available here, so we copied your link.')});
 // Switches update at once and save in the background; a failed save puts the switch back.
 async function toggle(key:'wishlist'|'reviews'|'city',value:boolean){
  setShare(s=>({...s,[key]:value}));
  try{const r=await fetch('/api/profile-extras',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({[key==='wishlist'?'shareWishlist':key==='reviews'?'shareReviews':'shareCity']:value})});if(!r.ok)throw Error(((await r.json().catch(()=>({}))) as {error?:string}).error||'That didn’t save.');onSettingsSaved?.()}
  catch(error){setShare(s=>({...s,[key]:!value}));notice(error instanceof Error?error.message:'That didn’t save.')}
 }
 const buttons=[
  {key:'instagram',label:'Instagram',icon:<InstagramGlyph/>,className:'ps-ig',onClick:instagram},
  {key:'facebook',label:'Facebook',icon:<FacebookGlyph/>,className:'ps-fb',onClick:facebook},
  {key:'messages',label:'Messages',icon:<MessageSquareText size={24} aria-hidden="true"/>,className:'ps-sms',onClick:messages},
  {key:'save',label:'Save card',icon:<Download size={24} aria-hidden="true"/>,className:'ps-save',onClick:save},
  {key:'more',label:'More',icon:<MoreHorizontal size={24} aria-hidden="true"/>,className:'ps-more',onClick:more},
 ];
 return <div className="ps">
  <h2 className="ps-title">Share your profile</h2>
  <div className="ps-card"><ShareCardPreview d={card} label={'Share card preview for '+p.name}/></div>
  <div className="ps-panel">
   <div className="ps-qr-row">
    <div className="ps-qr" role="img" aria-label={'QR code for '+url} dangerouslySetInnerHTML={{__html:qr?.svg||''}}/>
    <div><p className="ps-qr-title">Scan at the con</p><p className="ps-qr-text">Print it on your table sign or show it at a swap meet. It opens your profile.</p></div>
   </div>
   <div className="ps-link">
    <label htmlFor={ids+'-url'} className="sr-only">Your profile link</label>
    <div className="ps-link-field"><input id={ids+'-url'} readOnly value={url.replace(/^https?:\/\//,'')} onFocus={event=>event.currentTarget.select()}/><button type="button" className="ps-copy" onClick={()=>void copyLink()}>{copied?<><Check size={16} aria-hidden="true"/> Copied!</>:'Copy link'}</button></div>
    <span className="sr-only" role="status">{copied?'Link copied':''}</span>
   </div>
   <ul className="ps-buttons" aria-label="Share to">{buttons.map(b=><li key={b.key}><button type="button" className={'ps-btn '+b.className} data-share={b.key} onClick={()=>void b.onClick()} disabled={!!working} aria-busy={working===b.key}><span className="ps-btn-icon">{working===b.key?<Loader2 size={24} className="ps-spin" aria-hidden="true"/>:b.icon}</span><span>{b.label}</span></button></li>)}</ul>
  </div>
  <section className="ps-chat" aria-label="How your link looks in a chat">
   <p className="ps-chat-label">In a chat</p>
   <div className="ps-chat-bubble"><p className="ps-chat-url">{url.replace(/^https?:\/\//,'')}</p>
    <div className="ps-chat-card">
     {/* eslint-disable-next-line @next/next/no-img-element */}
     <img src={'/api/og/profile?handle='+encodeURIComponent(p.handle)} alt="" width={240} height={126} loading="lazy" decoding="async"/>
     <div><strong>{p.name} (@{p.handle}) on ComicHuddle</strong><small>{p.stats.comics.toLocaleString('en-US')} comics · {x.keys.toLocaleString('en-US')} keys{x.rating?' · '+(x.rating.stars!==null?x.rating.stars.toFixed(1)+'★':x.rating.percent+'% positive'):''}</small></div>
    </div>
   </div>
  </section>
  {own&&<fieldset className="ps-switches"><legend>On your public link</legend>
   {([['wishlist','Wishlist & grail'],['reviews','Collector reviews'],['city','City']] as const).map(([key,label])=><label key={key} className="ps-switch"><span>{label}</span><input type="checkbox" role="switch" checked={share[key]} onChange={event=>void toggle(key,event.currentTarget.checked)}/></label>)}
   <label className="ps-switch is-locked"><span><Lock size={14} aria-hidden="true"/> Collection value <small>Always private</small></span><input type="checkbox" role="switch" checked={false} disabled aria-describedby={ids+'-value-note'}/></label>
   <p id={ids+'-value-note'} className="ps-note">Your collection’s value is never shown on your public profile.</p>
  </fieldset>}
 </div>;
}
