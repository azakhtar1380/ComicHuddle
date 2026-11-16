'use client';
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {COMMUNITY_COVER_CREDIT,coverMediaId} from '../lib/cover-cache-types';
import {addSharedCover,coverDisplayVersion,removeCoverUrl,shownCover,subscribeCoverDisplay} from './cover-display-store';
import {refreshResolvedCover} from './resolved-comic-cover';

const MAX_BYTES=10*1024*1024;
// Admin status only decides which buttons show; the server checks admin again on every action.
let adminStatus:Promise<boolean>|null=null;
const loadAdmin=()=>adminStatus??=fetch('/api/admin/me',{credentials:'same-origin',cache:'no-store'}).then(r=>r.ok?r.json():{admin:false}).then(b=>b?.admin===true).catch(()=>false);

/** Cover photo tools, rendered next to (not inside) the cover, which is often itself a button.
 * Everyone signed in: add a photo where there is none, suggest a better one (an admin approves it),
 * report a collector photo. Admins: replace or remove any member photo. */
export default function CoverContribution({issueId}:{issueId:number}){
 useSyncExternalStore(subscribeCoverDisplay,coverDisplayVersion,coverDisplayVersion);
 const shown=shownCover(issueId),input=useRef<HTMLInputElement>(null),[busy,setBusy]=useState(false),[note,setNote]=useState(''),[admin,setAdmin]=useState(false);
 useEffect(()=>{let live=true;void loadAdmin().then(value=>{if(live)setAdmin(value)});return()=>{live=false}},[]);
 async function send(url:string,init:RequestInit){
  const response=await fetch(url,{...init,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(30000)}),body=await response.json().catch(()=>({})) as {error?:unknown;suggestion?:unknown;cover?:{url?:unknown;attribution?:unknown}|null};
  return {response,body,error:typeof body.error==='string'?body.error:''};
 }
 async function upload(file:File|undefined){
  if(!file||busy)return;setNote('');
  if(!/^image\/(jpeg|png|webp)$/.test(file.type)){setNote('Choose a JPEG, PNG or WebP photo of the front cover.');return}
  if(file.size>MAX_BYTES){setNote('Choose a photo up to 10 MB.');return}
  const previous=shown?.url||null;setBusy(true);
  try{
   const {response,body,error}=await send('/api/covers/community?issueId='+issueId,{method:'POST',headers:{'Content-Type':file.type},body:file});
   if(!response.ok){setNote(response.status===401?'Sign in to add a cover photo.':error||'The photo could not be added. Please retry.');return}
   const url=typeof body.cover?.url==='string'&&coverMediaId(body.cover.url)?body.cover.url:null;
   refreshResolvedCover(issueId);
   if(url){if(previous&&previous!==url)removeCoverUrl(previous);addSharedCover(issueId,{url,credit:COMMUNITY_COVER_CREDIT})}
   setNote(url?(previous?'Cover photo replaced.':'Thanks for sharing a cover photo!'):body.suggestion?'Thanks! An admin will review your photo before it replaces the current one.':'Thanks! Your photo will appear after review.');
  }catch{setNote('The photo could not be added. Please retry.')}
  finally{setBusy(false);if(input.current)input.current.value=''}
 }
 async function report(url:string){
  const mediaId=coverMediaId(url);if(!mediaId||busy||!window.confirm('Report this cover photo to the ComicHuddle admins?'))return;
  setBusy(true);setNote('');
  try{
   const {response,body,error}=await send('/api/covers/community/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mediaId})});
   if(!response.ok){setNote(response.status===401?'Sign in to report an image.':error||'The report could not be sent. Please retry.');return}
   if((body as {hidden?:unknown}).hidden===true){refreshResolvedCover(issueId);removeCoverUrl(url)}
   setNote('Thanks. An admin will review this photo.');
  }catch{setNote('The report could not be sent. Please retry.')}
  finally{setBusy(false)}
 }
 async function remove(url:string){
  const mediaId=coverMediaId(url);if(!mediaId||busy||!window.confirm('Remove this cover photo from the directory?'))return;
  setBusy(true);setNote('');
  try{
   const {response,error}=await send('/api/admin/covers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'remove',mediaId})});
   if(!response.ok){setNote(error||'The photo could not be removed. Please retry.');return}
   refreshResolvedCover(issueId);removeCoverUrl(url);setNote('Cover photo removed.');
  }catch{setNote('The photo could not be removed. Please retry.')}
  finally{setBusy(false)}
 }
 const memberPhoto=!!shown?.url&&shown.credit===COMMUNITY_COVER_CREDIT&&!!coverMediaId(shown.url);
 const canAdd=!!shown&&(!shown.url||memberPhoto),canReport=!admin&&memberPhoto&&shown!.credit===COMMUNITY_COVER_CREDIT,canRemove=admin&&memberPhoto;
 if(!canAdd&&!canReport&&!canRemove&&!note)return null;
 const addLabel=!shown?.url?'Add a cover photo':admin?'Replace photo':'Suggest a better photo';
 return <span className="cover-contribution">
  {canAdd&&<><input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={event=>void upload(event.target.files?.[0])}/><button type="button" className="cover-contribution-button" disabled={busy} onClick={()=>input.current?.click()}>{busy?'Working…':addLabel}</button></>}
  {canRemove&&<button type="button" className="cover-contribution-button" disabled={busy} onClick={()=>void remove(shown!.url!)}>Remove photo</button>}
  {canReport&&<button type="button" className="cover-contribution-button" disabled={busy} onClick={()=>void report(shown!.url!)}>Report image</button>}
  {note&&<small role="status">{note}</small>}
 </span>;
}
