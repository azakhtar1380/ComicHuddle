'use client';
import {useId} from 'react';

const palettes=[
 {bg:'#0d1117',band:'#e11d2e',accent:'#ffcc00',text:'#ffffff'},
 {bg:'#1652f0',band:'#0d1117',accent:'#ffcc00',text:'#ffffff'},
 {bg:'#e11d2e',band:'#0d1117',accent:'#ffcc00',text:'#ffffff'},
 {bg:'#ffcc00',band:'#0d1117',accent:'#e11d2e',text:'#0d1117'},
 {bg:'#14532d',band:'#0d1117',accent:'#ffcc00',text:'#ffffff'},
 {bg:'#581c87',band:'#0d1117',accent:'#ffcc00',text:'#ffffff'},
];
function hash(value:string){let h=0;for(let i=0;i<value.length;i++)h=(h*31+value.charCodeAt(i))|0;return Math.abs(h)}

/** A stylized comic-cover stand-in shown when no licensed cover image is available. React escapes every label. */
export default function ComicCoverPlaceholder({title,issue,className,publisher,year,message='Cover image coming soon'}:{title:string;issue?:string;className?:string;publisher?:string;year?:number;message?:string}){
 const id=useId().replace(/[^a-z0-9]/gi,''),dots='cover-dots-'+id,rays='cover-rays-'+id;
 const p=palettes[hash(title+(publisher||''))%palettes.length];
 const lines:string[]=[];
 for(const word of title.toUpperCase().slice(0,120).split(/\s+/)){
  const last=lines.length-1;
  if(last>=0&&(lines[last]+' '+word).length<=13)lines[last]+=' '+word;
  else if(lines.length<3)lines.push(word.slice(0,13));
 }
 const size=lines.some(l=>l.length>10)?26:32;
 return <svg className={'comic-cover-placeholder '+(className||'')} viewBox="0 0 240 360" role="img" aria-label={title+(issue?' #'+issue:'')+' — '+message} xmlns="http://www.w3.org/2000/svg">
  <defs>
   <pattern id={dots} width="8" height="8" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.3" fill="#000" opacity=".18"/></pattern>
   <radialGradient id={rays} cx="50%" cy="62%" r="65%"><stop offset="0" stopColor="#fff" stopOpacity=".22"/><stop offset="1" stopColor="#fff" stopOpacity="0"/></radialGradient>
  </defs>
  <rect x="3" y="3" width="234" height="354" rx="4" fill={p.bg} stroke="#0d1117" strokeWidth="4"/>
  <rect x="5" y="5" width="230" height="350" fill={'url(#'+rays+')'}/>
  <rect x="5" y="5" width="230" height="350" fill={'url(#'+dots+')'}/>
  <path d="M5 5H235V58H5Z" fill={p.band}/>
  <text x="16" y="38" fill="#fff" fontFamily="'Barlow Condensed',Impact,sans-serif" fontSize="22" fontWeight="800" letterSpacing="1">{(publisher||'COMICHUDDLE').toUpperCase().slice(0,18)}</text>
  {issue&&<g><rect x="168" y="14" width="58" height="34" rx="3" fill={p.accent} stroke="#0d1117" strokeWidth="2.5"/><text x="197" y="39" textAnchor="middle" fill="#0d1117" fontFamily="'Barlow Condensed',Impact,sans-serif" fontSize="22" fontWeight="900">#{issue.replace(/^#/,'').slice(0,4)}</text></g>}
  <text x="120" y={150-(lines.length-1)*size/2} textAnchor="middle" fill={p.text} stroke="#0d1117" strokeWidth="1.5" paintOrder="stroke" fontFamily="'Bangers','Barlow Condensed',Impact,sans-serif" fontSize={size} letterSpacing="1.5">{lines.map((line,index)=><tspan key={index} x="120" dy={index?size*1.02:0}>{line}</tspan>)}</text>
  <path d="M120 222l12 22 24-8-10 22 22 10-24 6 6 24-22-12-12 22-8-24-24 8 12-22-20-12 24-4-4-24 22 12z" fill={p.accent} stroke="#0d1117" strokeWidth="2.5" opacity=".95"/>
  <text x="120" y="282" textAnchor="middle" fill="#0d1117" fontFamily="'Bangers',Impact,sans-serif" fontSize="18" letterSpacing="1">{year?String(year):'NEW!'}</text>
  <path d="M5 322H235V355H5Z" fill="#0d1117" opacity=".85"/>
  <text x="120" y="343" textAnchor="middle" fill="#ffffffcc" fontFamily="Inter,Arial,sans-serif" fontSize="10.5" fontWeight="600" letterSpacing=".5">{message.toUpperCase().slice(0,34)}</text>
 </svg>;
}
