'use client';
import {useId} from 'react';

/** A readable edition placeholder; React escapes every title and issue label. */
export default function ComicCoverPlaceholder({title,issue,className}:{title:string;issue?:string;className?:string}){
 const dots='cover-dots-'+useId().replace(/[^a-z0-9]/gi,'');
 const lines:string[]=[];
 for(const word of title.slice(0,180).split(/\s+/)){
  const last=lines.length-1;
  if(last>=0&&(lines[last]+' '+word).length<=21)lines[last]+=' '+word;
  else if(lines.length<4)lines.push(word.slice(0,21));
 }
 return <svg className={'comic-cover-placeholder '+(className||'')} viewBox="0 0 240 360" role="img" aria-label={'Cover unavailable: '+title+(issue?' #'+issue:'')} xmlns="http://www.w3.org/2000/svg">
  <defs><pattern id={dots} width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#345a6a" opacity=".14"/></pattern></defs>
  <rect x="9" y="12" width="222" height="337" rx="12" fill="#f9f6ee" stroke="#345a6a" strokeWidth="2"/>
  <rect x="11" y="14" width="218" height="333" rx="11" fill={'url(#'+dots+')'}/>
  <path d="M10 71H230V14H10Z" fill="#345a6a"/>
  <text x="120" y="39" textAnchor="middle" fill="#fff" fontSize="12" fontWeight="800" letterSpacing="2">COMICHUDDLE</text>
  <text x="120" y="58" textAnchor="middle" fill="#f9d765" fontSize="10">DIRECTORY EDITION</text>
  <path d="M74 99h41q12 0 12 10v31q-12-9-31-9H74zm53 10q0-10 12-10h27v32h-23q-9 0-16 9z" fill="none" stroke="#345a6a" strokeWidth="3" strokeLinejoin="round"/>
  <text x="120" y="177" textAnchor="middle" fill="#20201f" fontSize="17" fontWeight="800">{lines.map((line,index)=><tspan key={index} x="120" dy={index?25:0}>{line}</tspan>)}</text>
  {issue&&<text x="120" y="285" textAnchor="middle" fill="#c83e30" fontSize="25" fontWeight="900">#{issue.replace(/^#/,'').slice(0,18)}</text>}
  <text x="120" y="323" textAnchor="middle" fill="#656159" fontSize="10">COVER IMAGE UNAVAILABLE</text>
 </svg>;
}
