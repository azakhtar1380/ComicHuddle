'use client';
import {useState} from 'react';
import {ArrowUpRight,BookOpen,Bookmark,ShieldCheck} from 'lucide-react';
import type {ComicCardRecord} from './types';
import {cgcLinks} from './cgc-links';
const money=(c:string|null)=>c===null?'Awaiting data':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(c)/100);
export function DirectoryCard({comic,onOpen,onSave,onBuy}:{comic:ComicCardRecord;onOpen:(id:string)=>void;onSave?:(id:string)=>void;onBuy?:(id:string)=>void}){
 const [format,setFormat]=useState<'raw'|'cgc98'>('raw'),[broken,setBroken]=useState(false);
 const value=format==='raw'?comic.rawFMVCents:comic.cgc98FMVCents;
 return <article className="v2-card group relative min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg motion-reduce:transform-none">
  <button onClick={()=>onOpen(comic.id)} className="relative block aspect-[2/3] w-full overflow-hidden bg-[#eee9dc] p-3 text-left" aria-label={'More information about '+comic.title+' #'+comic.issueNumber}>
   {comic.coverUrl&&!broken?<img className="h-full w-full object-contain transition duration-500 group-hover:scale-[1.03] motion-reduce:transform-none" src={comic.coverUrl} onError={()=>setBroken(true)} alt={comic.title+' #'+comic.issueNumber+' cover'} loading="lazy" decoding="async"/>:<div className="v2-metadata-cover flex h-full w-full flex-col justify-between rounded-lg border-2 border-[#20201f] bg-[#e9d277] p-3"><span className="text-[10px] font-bold uppercase tracking-widest">{comic.publisher}</span><div><BookOpen size={30}/><span className="mt-3 block font-black leading-none" style={{fontFamily:"'Barlow Condensed',Impact,sans-serif",fontSize:'clamp(24px,3vw,39px)'}}>{comic.title}</span><span className="mt-2 block text-4xl font-black text-[#c83e30]">#{comic.issueNumber}</span></div><span className="text-[10px]">Cover image unavailable</span></div>}
   {comic.keyTags[0]&&<span className="absolute left-3 top-3 max-w-[85%] rounded-full bg-[#f8d259] px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-slate-900 shadow-sm">{comic.keyTags[0]}</span>}
  </button>
  <div className="p-3.5 sm:p-4"><div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wide text-slate-500"><span>{comic.publisher}</span><span>{comic.publicationDate?.slice(0,4)||'Date unrecorded'}</span></div>
   <button onClick={()=>onOpen(comic.id)} className="block w-full text-left"><h3 className="m-0 text-[20px] font-extrabold leading-tight text-slate-900">{comic.title} <span className="text-[#c83e30]">#{comic.issueNumber}</span></h3></button>
   {comic.variant&&<p className="mb-2 mt-1 truncate text-[11px] leading-relaxed text-slate-500">{comic.variant}</p>}
   <div className="mb-2 flex rounded-full bg-slate-100 p-0.5" aria-label="Choose grade for valuation">{(['raw','cgc98'] as const).map(v=><button key={v} aria-pressed={format===v} onClick={()=>setFormat(v)} className={'min-h-8 flex-1 rounded-full px-2 text-[10px] font-bold '+(format===v?'bg-white text-slate-900 shadow-sm':'text-slate-500')}>{v==='raw'?'Raw NM':'CGC 9.8'}</button>)}</div>
   <div className="flex items-center justify-between gap-2"><span className="text-[12px] font-bold text-slate-800" title={comic.valuationAsOf?'Estimate observed '+comic.valuationAsOf:'No licensed valuation is connected'}>{money(value)}</span><button className="min-h-9 text-[11px] font-bold text-[#345a6a]" onClick={()=>onOpen(comic.id)}>More info <ArrowUpRight className="inline" size={13}/></button></div>
   {!!onBuy&&comic.listingCount>0&&<button onClick={()=>onBuy(comic.id)} className="mt-2 min-h-10 w-full rounded-lg bg-[#c83e30] px-2 text-xs font-bold text-white">Buy · {comic.listingCount} {comic.listingCount===1?'copy':'copies'}</button>}
   {!!onSave&&<button aria-label={'Save '+comic.title+' to your collection'} onClick={()=>onSave(comic.id)} className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full border border-slate-200 bg-white/95 text-slate-900"><Bookmark size={17}/></button>}
  </div>
 </article>;
}
export function CGCLinks({comic}:{comic:ComicCardRecord}){
 const links=cgcLinks(comic.certNumber,comic.title,comic.issueNumber);
 const [copied,setCopied]=useState(false);
 return <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><strong className="flex items-center gap-2 text-sm"><ShieldCheck size={17}/> Check with CGC</strong>
  <p className="mt-2 text-xs">{comic.certNumber?'Certification number is seller-supplied: '+comic.certNumber:'Search the population report for '+links.searchText+'.'}</p>
  <div className="flex flex-wrap gap-3 text-xs font-bold"><a href={links.certificationUrl} target="_blank" rel="noopener noreferrer">Certification lookup ↗</a><a href={links.populationUrl} target="_blank" rel="noopener noreferrer">Population report ↗</a><button onClick={()=>void navigator.clipboard.writeText(comic.certNumber||links.searchText).then(()=>setCopied(true))}>{copied?'Copied':'Copy '+(comic.certNumber?'cert number':'title + issue')}</button></div>
 </div>;
}
