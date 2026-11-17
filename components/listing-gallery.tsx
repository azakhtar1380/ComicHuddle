'use client';
// The seller's listing photos: a swipeable gallery in a fixed 4:5 frame (the whole photo shows, on a soft
// background), dots and "2 / 6", and tap for full screen with pinch-zoom. These are photos of the actual copy;
// they are never used as a comic's Directory cover.
import {useEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,X} from 'lucide-react';
import {activateDialog} from '../lib/dialog-focus';
import './listing-gallery.css';

const src=(id:string,full=false)=>'/api/media?id='+encodeURIComponent(id)+(full?'':'');
export default function ListingGallery({photos,title}:{photos:string[];title:string}){
 const track=useRef<HTMLDivElement>(null),[index,setIndex]=useState(0),[full,setFull]=useState(false);
 const go=(i:number)=>{const el=track.current;if(!el)return;const next=Math.max(0,Math.min(photos.length-1,i));el.scrollTo({left:next*el.clientWidth,behavior:'smooth'})};
 // Which photo is showing, from the scroll position (passive, one update per frame).
 useEffect(()=>{const el=track.current;if(!el)return;let frame=0;const on=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>setIndex(Math.round(el.scrollLeft/Math.max(1,el.clientWidth))))};el.addEventListener('scroll',on,{passive:true});return()=>{el.removeEventListener('scroll',on);cancelAnimationFrame(frame)}},[]);
 return <div className="lg" aria-roledescription="carousel" aria-label={'Seller photos of '+title}>
  <div className="lg-frame">
   <div ref={track} className="lg-track" tabIndex={0} onKeyDown={e=>{if(e.key==='ArrowRight')go(index+1);if(e.key==='ArrowLeft')go(index-1)}}>
    {photos.map((id,i)=><button type="button" key={id} className="lg-slide" onClick={()=>setFull(true)} aria-label={'Photo '+(i+1)+' of '+photos.length+': open full screen'}>
     {/* eslint-disable-next-line @next/next/no-img-element */}
     <img src={src(id)} alt={'Seller photo '+(i+1)+' of '+title} loading={i?'lazy':'eager'} decoding="async" draggable={false}/>
    </button>)}
   </div>
   {photos.length>1&&<><button type="button" className="lg-nav lg-prev" onClick={()=>go(index-1)} disabled={!index} aria-label="Previous photo"><ChevronLeft size={20}/></button><button type="button" className="lg-nav lg-next" onClick={()=>go(index+1)} disabled={index>=photos.length-1} aria-label="Next photo"><ChevronRight size={20}/></button>
    <span className="lg-count" aria-live="polite">{index+1} / {photos.length}</span></>}
  </div>
  {photos.length>1&&<div className="lg-dots" aria-hidden="true">{photos.map((id,i)=><span key={id} className={i===index?'is-on':''}/>)}</div>}
  {full&&<FullScreen photos={photos} start={index} title={title} onClose={()=>setFull(false)}/>}
 </div>;
}

function FullScreen({photos,start,title,onClose}:{photos:string[];start:number;title:string;onClose:()=>void}){
 const ref=useRef<HTMLDivElement>(null),track=useRef<HTMLDivElement>(null),close=useRef(onClose);
 useEffect(()=>{close.current=onClose});
 useEffect(()=>activateDialog(ref.current,()=>close.current()),[]);
 useEffect(()=>{const el=track.current;if(el)el.scrollLeft=start*el.clientWidth},[start]);
 return <div ref={ref} className="lg-full" role="dialog" aria-modal="true" aria-label={'Photos of '+title} tabIndex={-1}>
  <button type="button" className="lg-full-close" onClick={onClose} aria-label="Close photos"><X size={24}/></button>
  <div ref={track} className="lg-full-track">{photos.map((id,i)=><div key={id} className="lg-full-slide">
   {/* Pinch to zoom: the slide allows the browser's own pinch-zoom. */}
   {/* eslint-disable-next-line @next/next/no-img-element */}
   <img src={src(id,true)} alt={'Seller photo '+(i+1)+' of '+title} decoding="async" draggable={false}/>
  </div>)}</div>
 </div>;
}
