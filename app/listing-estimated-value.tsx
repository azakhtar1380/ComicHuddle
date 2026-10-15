'use client';
import {useEffect,useState} from 'react';
import {CombinedValue,useEstimatedValue} from './estimated-value';
import type {CombinedEstimate,EstimateRequest} from '../lib/estimated-fmv-types';
function QueueVisibleEstimate({request}:{request:EstimateRequest}){useEstimatedValue(request);return null}
export default function ListingEstimatedValue({listingId,value,detail=false,example=false}:{listingId:string;value?:CombinedEstimate;detail?:boolean;example?:boolean}){
 const [current,setCurrent]=useState(value);
 useEffect(()=>setCurrent(value),[value]);
 useEffect(()=>{if(example||!listingId)return;const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,round=0;const end=Date.now()+10*60000;
  async function read(){const timeout=setTimeout(()=>controller.abort(),12000);try{const response=await fetch('/api/social?kind=listing&id='+encodeURIComponent(listingId),{signal:controller.signal,cache:'no-store'});if(!response.ok)return;const body=await response.json();if(controller.signal.aborted)return;if(body.aiEstimate)setCurrent(body.aiEstimate);if(body.aiEstimate?.components.some((row:{snapshot:{status:string}})=>['queued','generating','refreshing'].includes(row.snapshot.status))&&Date.now()<end)timer=setTimeout(()=>void read(),round++<3?5000:30000)}catch{/* Asking price and checkout remain usable. */}finally{clearTimeout(timeout)}}
  if(!value||value.components.some(row=>!row.snapshot.id&&row.request||['queued','generating','refreshing'].includes(row.snapshot.status)))timer=setTimeout(()=>void read(),1000);
  const update=()=>{if(timer)clearTimeout(timer);timer=setTimeout(()=>void read(),500)};window.addEventListener('comichuddle:estimate-updated',update);
  return()=>{controller.abort();if(timer)clearTimeout(timer);window.removeEventListener('comichuddle:estimate-updated',update)};
 },[listingId,example]);
 const pending=(current?.components||[]).filter(row=>row.request&&(!row.snapshot.id||['queued','generating','refreshing'].includes(row.snapshot.status))).slice(0,30);
 return <><CombinedValue value={current} detail={detail}/>{!example&&pending.map(row=><QueueVisibleEstimate key={JSON.stringify(row.request)} request={row.request!}/>)}</>;
}
