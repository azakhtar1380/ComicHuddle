'use client';
import {useRef,useState,useSyncExternalStore} from 'react';
import {COMMUNITY_COVER_CREDIT,coverMediaId} from '../lib/cover-cache-types';
import {addSharedCover,coverDisplayVersion,removeCoverUrl,shownCover,subscribeCoverDisplay} from './cover-display-store';
import {refreshResolvedCover} from './resolved-comic-cover';

const MAX_BYTES=10*1024*1024;
/** "Add a cover photo" while the placeholder shows; "Report image" on a collector cover.
 * Rendered next to (not inside) the cover, which is often itself a button. */
export default function CoverContribution({issueId}:{issueId:number}){
 useSyncExternalStore(subscribeCoverDisplay,coverDisplayVersion,coverDisplayVersion);
 const shown=shownCover(issueId),input=useRef<HTMLInputElement>(null),[busy,setBusy]=useState(false),[note,setNote]=useState('');
 async function send(url:string,init:RequestInit){
  const response=await fetch(url,{...init,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(30000)}),body=await response.json().catch(()=>({})) as {error?:unknown;cover?:{url?:unknown;attribution?:unknown}|null};
  return {response,body,error:typeof body.error==='string'?body.error:''};
 }
 async function upload(file:File|undefined){
  if(!file||busy)return;setNote('');
  if(!/^image\/(jpeg|png|webp)$/.test(file.type)){setNote('Choose a JPEG, PNG or WebP photo of the front cover.');return}
  if(file.size>MAX_BYTES){setNote('Choose a photo up to 10 MB.');return}
  setBusy(true);
  try{
   const {response,body,error}=await send('/api/covers/community?issueId='+issueId,{method:'POST',headers:{'Content-Type':file.type},body:file});
   if(!response.ok){setNote(response.status===401?'Sign in to add a cover photo.':error||'The photo could not be added. Please retry.');return}
   const url=typeof body.cover?.url==='string'&&coverMediaId(body.cover.url)?body.cover.url:null;
   refreshResolvedCover(issueId);
   if(url)addSharedCover(issueId,{url,credit:COMMUNITY_COVER_CREDIT});
   setNote(url?'Thanks for sharing a cover photo!':'Thanks! Your photo will appear after review.');
  }catch{setNote('The photo could not be added. Please retry.')}
  finally{setBusy(false);if(input.current)input.current.value=''}
 }
 async function report(url:string){
  const mediaId=coverMediaId(url);if(!mediaId||busy||!window.confirm('Report this cover photo? It will be hidden until it is reviewed.'))return;
  setBusy(true);setNote('');
  try{
   const {response,error}=await send('/api/covers/community/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mediaId})});
   if(!response.ok){setNote(response.status===401?'Sign in to report an image.':error||'The report could not be sent. Please retry.');return}
   refreshResolvedCover(issueId);removeCoverUrl(url);setNote('Thanks. The photo is hidden until it is reviewed.');
  }catch{setNote('The report could not be sent. Please retry.')}
  finally{setBusy(false)}
 }
 const canAdd=!!shown&&!shown.url,canReport=!!shown?.url&&shown.credit===COMMUNITY_COVER_CREDIT;
 if(!canAdd&&!canReport&&!note)return null;
 return <span className="cover-contribution">
  {canAdd&&<><input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={event=>void upload(event.target.files?.[0])}/><button type="button" className="cover-contribution-button" disabled={busy} onClick={()=>input.current?.click()}>{busy?'Uploading…':'Add a cover photo'}</button></>}
  {canReport&&<button type="button" className="cover-contribution-button" disabled={busy} onClick={()=>void report(shown!.url!)}>Report image</button>}
  {note&&<small role="status">{note}</small>}
 </span>;
}
