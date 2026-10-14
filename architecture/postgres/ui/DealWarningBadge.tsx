'use client';
import {useEffect,useState} from 'react';
import type {DealPosition,PublicDealAnalysis} from '../types';

const presentation:Record<DealPosition,{label:string;style:string}>={
 BELOW_MARKET:{label:'Below FMV',style:'border-[#936818] bg-[#fff3ca] text-[#523b0d]'},
 FAIR:{label:'Fair market value',style:'border-[#1e2530] bg-[#f6f0e4] text-[#1e2530]'},
 OVERPRICED:{label:'Overpriced',style:'border-[#bd332d] bg-[#fff0ec] text-[#84251f]'},
 UNKNOWN:{label:'FMV unavailable',style:'border-[#625f58] bg-[#f6f0e4] text-[#41403a]'},
};
/** Props come exclusively from the authenticated API's publicDealAnalysis() DTO. */
export function dealPresentation(analysis:PublicDealAnalysis,now=Date.now()){
 const valid=analysis.schemaVersion==='1.0'&&analysis.modelVersion==='price-data-heuristic-v1'&&analysis.riskKind==='PRICE_DATA_CAUTION'&&Number.isInteger(analysis.riskScore)&&analysis.riskScore>=0&&analysis.riskScore<=100;
 const covered=analysis.coveragePercent===100&&analysis.baselineCents!==null&&/^[1-9]\d*$/.test(analysis.baselineCents)&&Number.isFinite(analysis.variancePercent)&&!analysis.isCustomEntry&&analysis.items.length>0&&analysis.items.every(item=>item.quoteState==='PRICED'&&item.evidence?.kind==='SALE_BASELINE'&&Date.parse(item.evidence.observedAt)<=now&&Date.parse(item.evidence.expiresAt)>now);
 const position:DealPosition=valid&&covered&&Object.hasOwn(presentation,analysis.position)?analysis.position:'UNKNOWN';
 return {...presentation[position],position,score:valid?(position==='UNKNOWN'?Math.max(60,analysis.riskScore):analysis.riskScore):60};
}
export default function DealWarningBadge({analysis}:{analysis:PublicDealAnalysis}){
 const [clock,setClock]=useState(()=>Date.now());
 useEffect(()=>{const now=Date.now(),expiries=analysis.items.map(item=>Date.parse(item.evidence?.expiresAt||'')).filter(expiry=>Number.isFinite(expiry)&&expiry>now);if(!expiries.length)return;const timer=setTimeout(()=>setClock(Date.now()),Math.min(Math.min(...expiries)-now,2147483647));return()=>clearTimeout(timer);},[analysis,clock]);
 const state=dealPresentation(analysis,Math.max(clock,Date.now()));
 return <aside role="status" aria-label="Price and data caution" className={'border-2 border-solid p-4 '+state.style}>
  <strong className="block text-lg font-bold">{state.label}</strong>
  <p className="my-2 text-sm">{state.position==='UNKNOWN'?'A complete, current comparable value is unavailable.':(analysis.variancePercent!>0?'+':'')+analysis.variancePercent!.toFixed(2)+'% versus the comparable baseline.'}</p>
  <p className="my-2 text-sm">Price/data caution: {state.score}/100. This score does not authenticate the comic, verify the seller, or measure fraud probability.</p>
  {analysis.isCustomEntry&&<p className="my-2 text-sm font-bold">Custom edition under review. Purchasing is disabled.</p>}
  <ul className="my-2 list-disc pl-5 text-sm">{analysis.warnings.slice(0,8).map((warning,index)=><li key={index}>{warning}</li>)}</ul>
  <p className="mb-0 text-xs">Check edition, photos, condition, seller history and purchase terms before paying.</p>
 </aside>;
}
