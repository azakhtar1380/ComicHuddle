'use client';
import ResolvedComicCover from './resolved-comic-cover';
export default function ComicCover({src,title,issue,issueId,publisher,year}:{src?:string|null;title:string;issue?:string;issueId?:number;publisher?:string;year?:number}){return <div className="comic-image"><ResolvedComicCover issueId={issueId} title={title} issue={issue} publisher={publisher} year={year} src={src}/></div>}
