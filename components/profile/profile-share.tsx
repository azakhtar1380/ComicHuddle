'use client';
// Share screen: card style (slab / trading card), QR code, copy link, five share buttons, chat preview,
// and what the public link shows. Replaces the old story SVG in app/network.tsx.
import {useEffect,useId,useMemo,useState} from 'react';
import {Check,Copy,Download,Lock,MessageSquareText,MoreHorizontal} from 'lucide-react';
import qrcode from 'qrcode-generator';
import {shareCardSvg,type ShareCardData,type ShareCardStyle} from '../../lib/share-cards';
import {emptyExtras,profilePath,type ProfileExtras} from '../../lib/profile-page-types';
import type {ProfileView} from './profile-page';
import {inkFor,worldFor} from '../../lib/profile-worlds';
import './profile-share.css';

export type ShareTheme={sky:[string,string];accent:string};
const CLASSIC:ShareTheme={sky:['#efd369','#f3c94a'],accent:'#c83e30'};
async function dataUrl(url:string|null):Promise<string|null>{
 if(!url)return null;
 try{const r=await fetch(url,{credentials:'same-origin'});if(!r.ok)return null;const blob=await r.blob();return await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(blob)})}catch{return null}
}
async function svgToPng(svg:string){
 const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
 try{const img=new Image();img.src=url;await img.decode();const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1920;const ctx=canvas.getContext('2d');if(!ctx)throw Error('canvas');ctx.drawImage(img,0,0,1080,1920);
  const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('png');return blob}
 finally{setTimeout(()=>URL.revokeObjectURL(url),2000)}
}
const isPhone=()=>typeof navigator!=='undefined'&&/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
function InstagramGlyph(){return <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5.2" fill="none" stroke="#fff" strokeWidth="2"/><circle cx="12" cy="12" r="4.2" fill="none" stroke="#fff" strokeWidth="2"/><circle cx="17.3" cy="6.7" r="1.3" fill="#fff"/></svg>}
function FacebookGlyph(){return <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="#fff" d="M13.6 21v-7.6h2.6l.4-3h-3V8.5c0-.9.3-1.5 1.5-1.5h1.6V4.3c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H8v3h2.5V21h3.1z"/></svg>}

export default function ProfileShare({p,own,theme:given,notice,trophy,onSettingsSaved}:{p:ProfileView;own:boolean;theme?:ShareTheme;notice:(s:string)=>void;trophy?:{name:string;tier:string}|null;onSettingsSaved?:()=>void}){
 const x:ProfileExtras=p.extras||emptyExtras,ids=useId();
 // The card sits on the member's world background, in their ink.
 const theme:ShareTheme=given||(x.look?{sky:worldFor(x.look.world).sky,accent:inkFor(x.look.ink).a}:CLASSIC);
 const [style,setStyle]=useState<ShareCardStyle>('slab'),[images,setImages]=useState<{avatar:string|null;cover:string|null;huddles:string}|null>(null),[copied,setCopied]=useState(false),[working,setWorking]=useState(''),[share,setShare]=useState(x.share),[saving,setSaving]=useState('');
 // Client-only (the share screen opens after a tap), so window is available.
 const url=(typeof window==='undefined'?'https://comichuddle.com':window.location.origin)+profilePath(p.handle);
 useEffect(()=>{let keep=true;void Promise.all([dataUrl(p.avatarUrl||null),dataUrl(x.coverUrl),dataUrl('/mascot/huddles-cutout.webp')]).then(([avatar,cover,huddles])=>{if(keep)setImages({avatar,cover,huddles:huddles||'/mascot/huddles-cutout.webp'})});return()=>{keep=false}},[p.avatarUrl,x.coverUrl]);
 useEffect(()=>{if(!copied)return;const timer=setTimeout(()=>setCopied(false),1500);return()=>clearTimeout(timer)},[copied]);
 const card:ShareCardData={name:p.name,handle:p.handle,since:p.since,comics:p.stats.comics,keys:x.keys,verified:p.verified?(p.isBusiness?'business':'person'):null,favoriteCharacter:x.favoriteCharacter?.name||null,grail:x.grail?`${x.grail.title} #${x.grail.number}`:null,avatar:images?.avatar??p.avatarUrl??null,cover:images?.cover??x.coverUrl,huddles:images?.huddles||'/mascot/huddles-cutout.webp',sky:theme.sky,accent:theme.accent,trophy:trophy||null};
 const svg=shareCardSvg(style,card);
 const qr=useMemo(()=>{const q=qrcode(0,'M');q.addData(url);q.make();return q.createSvgTag({cellSize:4,margin:2,scalable:true})},[url]);
 async function copyLink(){try{await navigator.clipboard.writeText(url);setCopied(false);setTimeout(()=>setCopied(true),0)}catch{notice('Copy didn’t work. Select the link and copy it.')}}
 async function png(){if(!images)throw Error('Your card is still loading.');return svgToPng(svg)}
 const file=async()=>new File([await png()],`comichuddle-${p.handle}-${style}.png`,{type:'image/png'});
 async function run(name:string,action:()=>Promise<void>){if(working)return;setWorking(name);try{await action()}catch(error){if((error as Error)?.name!=='AbortError')notice(error instanceof Error&&error.message?error.message:'Sharing didn’t go through. Try again.')}finally{setWorking('')}}
 async function fallback(message:string){await copyLink();notice(message)}
 const instagram=()=>run('instagram',async()=>{const f=await file();if(navigator.canShare?.({files:[f]})){await navigator.share({files:[f],title:p.name+' on ComicHuddle'});return}await fallback('Instagram sharing isn’t available here, so we copied your link.')});
 const facebook=()=>run('facebook',async()=>{window.open('https://www.facebook.com/sharer/sharer.php?u='+encodeURIComponent(url),'_blank','noopener,noreferrer,width=600,height=520')});
 const messages=()=>run('messages',async()=>{const text=`Check out my comic collection on ComicHuddle: ${url}`;if(navigator.share){await navigator.share({title:p.name+' on ComicHuddle',text,url});return}if(isPhone()){window.location.href='sms:?&body='+encodeURIComponent(text);return}await fallback('Texting isn’t available on this device, so we copied your link.')});
 const save=()=>run('save',async()=>{const blob=await png(),href=URL.createObjectURL(blob),a=document.createElement('a');a.href=href;a.download=`comichuddle-${p.handle}-${style}.png`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),2000);notice('Your card is saved.')});
 const more=()=>run('more',async()=>{if(navigator.share){await navigator.share({title:p.name+' on ComicHuddle',url});return}await fallback('Sharing isn’t available here, so we copied your link.')});
 async function toggle(key:'wishlist'|'reviews'|'city',value:boolean){
  const next={...share,[key]:value};setShare(next);setSaving(key);
  try{const r=await fetch('/api/profile-extras',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({[key==='wishlist'?'shareWishlist':key==='reviews'?'shareReviews':'shareCity']:value})});if(!r.ok)throw Error(((await r.json().catch(()=>({}))) as {error?:string}).error||'That didn’t save.');onSettingsSaved?.()}
  catch(error){setShare(share);notice(error instanceof Error?error.message:'That didn’t save.')}finally{setSaving('')}
 }
 const buttons=[
  {key:'instagram',label:'Instagram',icon:<InstagramGlyph/>,className:'ps-ig',onClick:instagram},
  {key:'facebook',label:'Facebook',icon:<FacebookGlyph/>,className:'ps-fb',onClick:facebook},
  {key:'messages',label:'Messages',icon:<MessageSquareText size={24} aria-hidden="true"/>,className:'ps-sms',onClick:messages},
  {key:'save',label:'Save card',icon:<Download size={24} aria-hidden="true"/>,className:'ps-save',onClick:save},
  {key:'more',label:'More',icon:<MoreHorizontal size={24} aria-hidden="true"/>,className:'ps-more',onClick:more},
 ];
 return <div className="ps">
  <p className="ds-eyebrow">Share</p><h2 className="ps-title">Show off <span>your shelf.</span></h2>
  <div className="ps-styles" role="radiogroup" aria-label="Card style">
   {(['slab','trading'] as const).map(value=><label key={value} className={style===value?'is-on':''}><input type="radio" name={ids+'-style'} value={value} checked={style===value} onChange={()=>setStyle(value)}/>{value==='slab'?'Slab':'Trading card'}</label>)}
  </div>
  <div className="ps-card" data-style={style} data-ready={images?'true':'false'} aria-label={(style==='slab'?'Slab':'Trading card')+' preview for '+p.name} role="img" dangerouslySetInnerHTML={{__html:svg}}/>
  <div className="ps-row">
   <figure className="ps-qr"><div className="ps-qr-code" role="img" aria-label={'QR code for '+url} dangerouslySetInnerHTML={{__html:qr}}/><figcaption>Scan at the con</figcaption></figure>
   <div className="ps-link">
    <label htmlFor={ids+'-url'}>Your profile link</label>
    <div className="ps-link-field"><input id={ids+'-url'} readOnly value={url} onFocus={event=>event.currentTarget.select()}/><button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" onClick={()=>void copyLink()}>{copied?<><Check size={16} aria-hidden="true"/> Copied!</>:<><Copy size={16} aria-hidden="true"/> Copy</>}</button></div>
    <span className="sr-only" role="status">{copied?'Link copied':''}</span>
   </div>
  </div>
  <ul className="ps-buttons" aria-label="Share to">{buttons.map(b=><li key={b.key}><button type="button" className={'ps-btn '+b.className} data-share={b.key} onClick={()=>void b.onClick()} disabled={!!working} aria-busy={working===b.key}><span className="ps-btn-icon">{b.icon}</span><span>{b.label}</span></button></li>)}</ul>
  <section className="ps-chat" aria-label="How your link looks in a chat">
   <p className="ps-chat-label">In a chat</p>
   <div className="ps-chat-bubble"><p className="ps-chat-url">{url.replace(/^https?:\/\//,'')}</p>
    <div className="ps-chat-card">
     {/* eslint-disable-next-line @next/next/no-img-element */}
     <img src={'/api/og/profile?handle='+encodeURIComponent(p.handle)} alt="" width={240} height={126} loading="lazy"/>
     <div><strong>{p.name} (@{p.handle}) on ComicHuddle</strong><small>{p.stats.comics.toLocaleString('en-US')} comics · {x.keys.toLocaleString('en-US')} keys{x.rating?' · '+(x.rating.stars!==null?x.rating.stars.toFixed(1)+'★':x.rating.percent+'% positive'):''}</small></div>
    </div>
   </div>
  </section>
  {own&&<fieldset className="ps-switches"><legend>On your public link</legend>
   {([['wishlist','Wishlist & grail'],['reviews','Collector reviews'],['city','City']] as const).map(([key,label])=><label key={key} className="ps-switch"><span>{label}</span><input type="checkbox" role="switch" checked={share[key]} disabled={saving===key} onChange={event=>void toggle(key,event.currentTarget.checked)}/></label>)}
   <label className="ps-switch is-locked"><span><Lock size={14} aria-hidden="true"/> Collection value <small>Always private</small></span><input type="checkbox" role="switch" checked={false} disabled aria-describedby={ids+'-value-note'}/></label>
   <p id={ids+'-value-note'} className="ps-note">Your collection’s value is never shown on your public profile.</p>
  </fieldset>}
 </div>;
}
