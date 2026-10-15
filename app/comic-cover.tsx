'use client';
import ResolvedComicCover from './resolved-comic-cover';
export default function ComicCover({src,title,issue,issueId,publisher,year,credit}:{src?:string|null;title:string;issue?:string;issueId?:number;publisher?:string;year?:number;credit?:string}){return <div className="comic-image"><ResolvedComicCover issueId={issueId} title={title} issue={issue} publisher={publisher} year={year} credit={credit} src={src}/></div>}
