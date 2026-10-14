'use client';
import {useCallback,useEffect,useState} from 'react';
import Homepage from '../architecture/platform-v2/ui/Homepage';
import type {ComicCardRecord,HomeFeed,MarketTick} from '../architecture/platform-v2/ui/types';
import {catalog,type Issue} from '../lib/catalog';
import {parseCatalogSearchPage} from '../lib/catalog-picker-client';
import './platform-v2.css';

export function homeComic(issue:Issue):ComicCardRecord{
 return {id:String(issue.id),title:issue.title,issueNumber:issue.number,publisher:issue.publisher,
  publicationDate:issue.bibliography?.publicationDate|| (issue.year?String(issue.year):null),
  coverUrl:issue.cover||null,coverCredit:issue.coverCredit||null,variant:issue.variant,
  keyTags:issue.kind==='Key issue'?['Key issue']:[],rawFMVCents:null,cgc98FMVCents:null,
  valuationAsOf:null,valuationKind:'unavailable',listingCount:0};
}
const emptyFeed:HomeFeed={items:[],market:[],indexedCount:0,asOf:'',feedKind:'editorial',filmKeys:[],ratioVariants:[]};
export default function CollectorHome({go,onProfile,onProvider,onScan,onOpenComic,onValueCollection}:{go:(value:string)=>void;onProfile:()=>void;onProvider:()=>void;onScan:()=>void;onOpenComic:(id:string)=>void;onValueCollection:()=>void}){
 const [feed,setFeed]=useState<HomeFeed>(emptyFeed),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const reload=useCallback(async(signal:AbortSignal)=>{
  setLoading(true);setError('');
  try{const response=await fetch('/api/catalog?'+new URLSearchParams({ids:[...catalog.filter(issue=>issue.cover?.startsWith('/covers/')).map(issue=>issue.id),0,3,7,10].join(',')}),{signal,cache:'no-store'});if(!response.ok)throw Error();
   const page=parseCatalogSearchPage(await response.json());if(!signal.aborted)setFeed({...emptyFeed,items:[...page.issues].sort((a,b)=>Number(!!b.cover?.startsWith('/covers/'))-Number(!!a.cover?.startsWith('/covers/'))||a.id-b.id).map(homeComic),indexedCount:page.issueCount,asOf:new Date().toISOString()});
   try{const extra=await fetch('/api/home-feed',{signal,cache:'no-store'});if(extra.ok){const payload=await extra.json();if(!signal.aborted&&Array.isArray(payload.market)&&Array.isArray(payload.upcoming))setFeed(current=>({...current,market:payload.market as MarketTick[],upcoming:payload.upcoming.map(homeComic)}))}}catch{/* The directory remains usable if the optional market feed is unavailable. */}
  }catch(e){if(!signal.aborted)setError('The directory could not load. Open the directory or retry below.');}
  finally{if(!signal.aborted)setLoading(false);}
 },[]);
 useEffect(()=>{const controller=new AbortController();void reload(controller.signal);return()=>controller.abort()},[reload]);
 const search=useCallback(async(query:string,signal:AbortSignal)=>{
  const response=await fetch('/api/catalog?'+new URLSearchParams({q:query,limit:'6',offset:'0'}),{signal});
  if(!response.ok)throw Error('Directory search unavailable.');return parseCatalogSearchPage(await response.json()).issues.map(homeComic);
 },[]);
 return <><Homepage feed={feed} loading={loading} search={search} onScan={onScan} onOpenComic={onOpenComic}
  onValueCollection={onValueCollection} onBrowseKeys={()=>go('Directory')} onMarketplace={()=>go('Marketplace')}
  onProfile={onProfile} onWorkshop={()=>go('Comic Workshop')} onUpcoming={()=>go('Upcoming')}/>
  {error&&<div role="alert" className="home-directory-error"><p>{error}</p><button className="button outline small-button" onClick={()=>void reload(new AbortController().signal)}>Retry directory</button></div>}
  <div className="home-provider-link"><button className="inline-button" onClick={onProvider}>List my pressing studio</button><span>Vintage cover spotlight: Planet Comics #12, #55 and #27. Public-domain US editions; cover credits appear in the directory.</span></div>
 </>;
}
