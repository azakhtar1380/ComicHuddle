'use client';
import {useState} from 'react';
import {ArrowUpRight,BookOpen,ShieldCheck} from 'lucide-react';
import type {ComicCardRecord} from './types';
import {cgcLinks} from './cgc-links';
export function DirectoryCard({comic,onOpen}:{comic:ComicCardRecord;onOpen:(id:string)=>void;onSave?:(id:string)=>void;onBuy?:(id:string)=>void}){
 const [failed,setFailed]=useState<string|null>(null);
 return <article className="v2-card"><button type="button" className="v2-card-open" onClick={()=>onOpen(comic.id)} aria-haspopup="dialog" aria-label={'More info about '+comic.title+' #'+comic.issueNumber}>
  <span className="v2-card-art">{comic.coverUrl&&failed!==comic.coverUrl?<img src={comic.coverUrl} onError={()=>setFailed(comic.coverUrl!)} alt={comic.title+' #'+comic.issueNumber+' cover'} loading="lazy" decoding="async"/>:<span className="comic-image-missing" role="img" aria-label="Cover unavailable"><BookOpen size={30}/><small>Cover unavailable</small></span>}</span>
  {comic.coverUrl&&failed!==comic.coverUrl&&comic.coverCredit&&<span className="v2-cover-credit">{comic.coverCredit.includes('Wikimedia')?'Cover: Wikimedia Commons · US public domain':comic.coverCredit}</span>}
  <span className="v2-card-copy"><strong>{comic.title} <span>#{comic.issueNumber}</span></strong><small>{comic.publisher}</small><span className="v2-more-info">More info <ArrowUpRight size={13}/></span></span>
 </button></article>;
}
export function CGCLinks({comic}:{comic:ComicCardRecord}){
 const links=cgcLinks(comic.certNumber,comic.title,comic.issueNumber);
 const [copied,setCopied]=useState(false);
 return <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><strong className="flex items-center gap-2 text-sm"><ShieldCheck size={17}/> Check with CGC</strong>
  <p className="mt-2 text-xs">{comic.certNumber?'Certification number is seller-supplied: '+comic.certNumber:'Search the population report for '+links.searchText+'.'}</p>
  <div className="flex flex-wrap gap-3 text-xs font-bold"><a href={links.certificationUrl} target="_blank" rel="noopener noreferrer">Certification lookup ↗</a><a href={links.populationUrl} target="_blank" rel="noopener noreferrer">Population report ↗</a><button onClick={()=>void navigator.clipboard.writeText(comic.certNumber||links.searchText).then(()=>setCopied(true))}>{copied?'Copied':'Copy '+(comic.certNumber?'cert number':'title + issue')}</button></div>
 </div>;
}
