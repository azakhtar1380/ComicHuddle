'use client';
import {useState} from 'react';
import ComicCoverPlaceholder from '../components/comic-cover-placeholder';

export default function ComicCover({src,title}:{src?:string|null;title:string}){
 const [failed,setFailed]=useState<string|null>(null);
 return <div className="comic-image">{src&&failed!==src?<img src={src} alt={title+' cover'} onError={()=>setFailed(src)} loading="lazy" decoding="async"/>:<ComicCoverPlaceholder title={title}/>}</div>;
}
