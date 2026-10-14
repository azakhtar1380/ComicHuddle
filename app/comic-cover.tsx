'use client';
import {useState} from 'react';
import {BookOpen} from 'lucide-react';

export default function ComicCover({src,title}:{src?:string|null;title:string}){
 const [failed,setFailed]=useState<string|null>(null);
 return <div className="comic-image">{src&&failed!==src?<img src={src} alt={title+' cover'} onError={()=>setFailed(src)} loading="lazy" decoding="async"/>:<span className="comic-image-missing" role="img" aria-label="Cover unavailable"><BookOpen size={32}/><small>Cover unavailable</small></span>}</div>;
}
