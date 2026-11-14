'use client';
import {useEffect,useState,useSyncExternalStore} from 'react';
import ComicCoverPlaceholder from '../components/comic-cover-placeholder';
import {coverMediaId,coverStatusMessage,type CoverResolution} from '../lib/cover-cache-types';
import {coverDisplayVersion,coverRemoved,reportShownCover,sharedCover,subscribeCoverDisplay} from './cover-display-store';
import {coverLookupId} from '../lib/curated-cover-ids';
import './resolved-comic-cover.css';
type CoverEntry={value:CoverResolution;listeners:Set<(value:CoverResolution)=>void>;at:number;polls:number;pollUntil:number;inFlight:boolean};
const cache=new Map<number,CoverEntry>(),pending=new Set<number>();let timer:ReturnType<typeof setTimeout>|null=null;
function schedule(id:number){if(cache.get(id)?.inFlight)return;pending.add(id);if(!timer)timer=setTimeout(()=>{timer=null;void flush()},50)}
async function flush(){const ids=[...pending].slice(0,30);ids.forEach(id=>pending.delete(id));ids.forEach(id=>{const entry=cache.get(id);if(entry)entry.inFlight=true});const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
 try{const response=await fetch('/api/covers?ids='+ids.join(','),{signal:controller.signal});if(!response.ok)throw Error();const body=await response.json();for(const value of body.covers as CoverResolution[]){const entry=cache.get(value.issueId);if(!entry)continue;entry.value=value;entry.at=Date.now();entry.listeners.forEach(fn=>fn(value));if(['PENDING','PROCESSING'].includes(value.status)&&Date.now()<entry.pollUntil)setTimeout(()=>{if(entry.listeners.size)schedule(value.issueId)},entry.polls++<3?5000:30000)}}
 catch{for(const id of ids){const entry=cache.get(id);if(entry){entry.value={issueId:id,status:'FAILED',url:null,attribution:'',message:coverStatusMessage('FAILED')};entry.at=Date.now();entry.listeners.forEach(fn=>fn(entry.value))}}}finally{ids.forEach(id=>{const entry=cache.get(id);if(entry)entry.inFlight=false});clearTimeout(timeout);if(pending.size&&!timer)timer=setTimeout(()=>{timer=null;void flush()},60)}}
export default function ResolvedComicCover({issueId,title,issue,publisher,year,src,credit,actualPhoto=false,priority=false}:{issueId?:number|null;title:string;issue?:string;publisher?:string;year?:number|null;src?:string|null;credit?:string;actualPhoto?:boolean;priority?:boolean}){
 const [failed,setFailed]=useState<string[]>([]),[resolution,setResolution]=useState<CoverResolution|null>(null);
 useSyncExternalStore(subscribeCoverDisplay,coverDisplayVersion,coverDisplayVersion);
 // Seller/collector fallbacks (/api/media) are provisional: still ask /api/covers, whose
 // provider covers outrank them, and keep the fallback on screen meanwhile.
 const provisional=!actualPhoto&&!!coverMediaId(src),local=!provisional&&!!src?.startsWith('/'),initial=!provisional&&(local||src&&!/comics\.org/i.test(src))?src!:null,initialFailed=!!initial&&failed.includes(initial);
 // Curated key issues map to their exact GCD catalog id for cover lookups.
 const lookupId=coverLookupId(issueId);
 useEffect(()=>{setResolution(null);if(actualPhoto||initial&&!initialFailed||lookupId===null)return;const issueId=lookupId;let entry=cache.get(issueId);if(!entry){entry={value:{issueId,status:'PENDING',url:null,attribution:'',message:coverStatusMessage('PENDING')},listeners:new Set(),at:0,polls:0,pollUntil:Date.now()+10*60000,inFlight:false};cache.set(issueId,entry)}if(cache.size>500)for(const [id,old] of cache){if(!old.listeners.size)cache.delete(id);if(cache.size<=400)break}entry.listeners.add(setResolution);setResolution(entry.value);if(!entry.at||Date.now()-entry.at>300000)schedule(issueId);return()=>{entry!.listeners.delete(setResolution)}},[lookupId,initial,initialFailed,actualPhoto]);
 // Priority: the issue's own cover, a photo just shared in this session, the resolved cover, then a provisional fallback.
 const shared=!actualPhoto&&typeof issueId==='number'?sharedCover(issueId):null;
 const choices:[string|null|undefined,string|undefined,boolean][]=[[initial,credit,false],[shared?.url,shared?.credit,false],[resolution?.url,resolution?.attribution||credit,true],[provisional?src:null,credit,false]];
 const chosen=choices.find(([url])=>url&&!failed.includes(url)&&!coverRemoved(url)),image=chosen?.[0]||null,fromResolution=!!chosen?.[2];
 const status=resolution?.url&&failed.includes(resolution.url)?'FAILED':resolution?.status||'DISABLED',removed=!image&&[src,resolution?.url].some(url=>url&&coverRemoved(url));
 const shownCredit=image?actualPhoto?'Seller’s actual-copy photo':chosen?.[1]||'Catalog reference art · © respective rights holders':'';
 useEffect(()=>{if(typeof issueId==='number'&&!actualPhoto)reportShownCover(issueId,{url:image,credit:shownCredit})},[issueId,actualPhoto,image,shownCredit]);
 return <span className="resolved-cover"><span className="resolved-cover-frame">{image?<img src={image} srcSet={fromResolution?resolution?.srcSet:undefined} sizes="(max-width: 760px) 44vw, 240px" alt={title+(issue?' #'+issue.replace(/^#/,''):'')+(actualPhoto?' actual-copy photo':' catalog reference cover')} loading={priority?'eager':'lazy'} fetchPriority={priority?'high':'auto'} decoding="async" onError={()=>{setFailed(list=>list.includes(image)?list:[...list,image]);if(lookupId&&!actualPhoto&&!image.startsWith('/'))void fetch('/api/covers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({issueId:lookupId}),signal:AbortSignal.timeout(4000)}).catch(()=>undefined)}} referrerPolicy="no-referrer"/>:<ComicCoverPlaceholder title={title} issue={issue} publisher={publisher} year={year||undefined} message={actualPhoto?'Seller photo temporarily unavailable':removed?'Cover photo under review':coverStatusMessage(status)}/>}</span>{image&&<small className="resolved-cover-credit">{shownCredit}</small>}</span>;
}
/** Forget a cached resolution so the next mount asks /api/covers again (after a share or report). */
export function refreshResolvedCover(issueId:number){const entry=cache.get(issueId);if(entry)entry.at=0}
