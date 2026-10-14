'use client';
import {useEffect,useState} from 'react';
type Quote={fmv:number;sourceName:string;sourceUrl:string;updatedAt:string;validUntil:string;sales:number;mode:string;grade:string;printing:string;fresh:boolean};
export default function CatalogFmv({issueId}:{issueId:number}){
 const [quote,setQuote]=useState<Quote|null>(null);
 useEffect(()=>{const abort=new AbortController();setQuote(null);void fetch('/api/values?issue='+issueId,{signal:abort.signal}).then(async response=>response.ok?response.json():null).then(body=>{if(abort.signal.aborted)return;const selected=body?.rows?.find((row:Quote)=>row.mode==='Raw'&&row.printing==='First printing'&&row.fresh&&Date.parse(row.validUntil)>Date.now()&&Number.isFinite(row.fmv)&&row.fmv>0);if(selected)setQuote(selected)}).catch(()=>{});return()=>abort.abort()},[issueId]);
 if(!quote)return <span className="sd-fmv unavailable">Current FMV: unavailable<small>Verified sold comps needed</small></span>;
 return <span className="sd-fmv">Current FMV: {new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(quote.fmv)}<small>Raw {quote.grade==='Unspecified'?'ungraded':quote.grade} · {quote.sales} sales · {quote.sourceName} · {new Date(quote.updatedAt).toLocaleDateString('en-US')}</small></span>;
}
