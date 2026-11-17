'use client';
// The share card preview: plain HTML and <img> tags (the photo and cover the page already loaded), laid out with
// the same numbers as the PNG (lib/share-cards.ts), scaled to the preview's width with CSS. Nothing heavy here.
import {memo,type CSSProperties} from 'react';
import {L,HUDDLES_SRC,LOGO_SRC,blockShift,extraLines,nameFontSize,statChips,type ShareCardData} from '../../lib/share-cards';
import {VerifiedBadge} from '../verified-badge';
import AdminBadge from '../admin-badge';
import './share-card-preview.css';

const u=(n:number)=>`calc(var(--u) * ${n})`;
const box=(x:number,y:number,w:number,h:number):CSSProperties=>({left:u(x),top:u(y),width:u(w),height:u(h)});

function ShareCardPreview({d,qrSvg,label}:{d:ShareCardData;qrSvg:string;label:string}){
 const {card:c,photo:p,huddles:h,stats:s,extras:e,strip:st,qr:q,logo:lg}=L,mark=d.founder||d.verified;
 const statsLeft=L.W/2-(s.w*3+s.gap*2)/2,lines=extraLines(d),dy=blockShift(d);
 return <div className="scp" role="img" aria-label={label}>
  <div className="scp-shadow" style={{...box(c.x+c.shadow,c.y+c.shadow,c.w,c.h),borderRadius:u(c.r)}}/>
  <div className="scp-card" style={{...box(c.x,c.y,c.w,c.h),borderRadius:u(c.r),borderWidth:u(c.border)}}>
   <div className="scp-cover" style={{height:u(L.cover.h-c.border)}}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {d.cover?<img src={d.cover} alt="" decoding="async"/>:<span className="scp-cover-empty"/>}
   </div>
   <div className="scp-strip" style={{top:u(st.y-c.y-c.border),bottom:0}}/>
  </div>
  <div className="scp-photo" style={{...box(p.cx-p.r-p.ring,p.cy-p.r-p.ring,(p.r+p.ring)*2,(p.r+p.ring)*2),padding:u(p.ring),borderWidth:u(6)}}>
   {/* eslint-disable-next-line @next/next/no-img-element */}
   {d.avatar?<img src={d.avatar} alt="" decoding="async" style={{borderWidth:u(8)}}/>:<span className="scp-photo-empty" style={{borderWidth:u(8)}}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9.6" r="3.6" fill="none" stroke="#20201f" strokeWidth="1.3"/><path d="M5.6 19.4c.7-3.4 3.2-5.2 6.4-5.2s5.7 1.8 6.4 5.2" fill="none" stroke="#20201f" strokeWidth="1.3" strokeLinecap="round"/></svg></span>}
  </div>
  {/* eslint-disable-next-line @next/next/no-img-element */}
  <img className="scp-huddles" src={HUDDLES_SRC} alt="" decoding="async" style={box(p.cx+p.r-h.w*.32,p.cy+p.r-h.h+12,h.w,h.h)}/>
  <p className="scp-name" style={{top:u(L.name.y+dy-nameFontSize(d.name)*.86),fontSize:u(nameFontSize(d.name)),gap:u(14)}}>
   <span>{d.name}</span>{mark&&<span className="scp-mark" style={{width:u(nameFontSize(d.name)*.62)}}>{d.founder?<AdminBadge founder size={64}/>:<VerifiedBadge kind={d.verified==='business'?'business':'person'} size={64}/>}</span>}
  </p>
  <p className="scp-handle" style={{top:u(L.handle.y+dy-L.handle.size*.92),fontSize:u(L.handle.size)}}>@{d.handle}</p>
  <p className="scp-since" style={{top:u(L.since.y+dy-L.since.size*.92),fontSize:u(L.since.size)}}>Collecting since {d.since}</p>
  {statChips(d).map((chip,i)=><div key={chip.label} className="scp-stat" style={{...box(statsLeft+i*(s.w+s.gap),s.y+dy,s.w,s.h),borderRadius:u(24),borderWidth:u(6),boxShadow:`${u(7)} ${u(7)} 0 #20201f`}}>
   <span className="scp-stat-value" style={{fontSize:u(s.value)}}>{chip.value}</span><span className="scp-stat-label" style={{fontSize:u(s.label)}}>{chip.label}</span>
  </div>)}
  {lines.map((line,i)=><p key={line} className="scp-extra" style={{top:u(e.y+dy+i*(e.h+e.gap)),height:u(e.h),maxWidth:u(e.max),fontSize:u(e.size),padding:`0 ${u(30)}`,borderWidth:u(5)}}>{line}</p>)}
  {/* eslint-disable-next-line @next/next/no-img-element */}
  <img className="scp-logo" src={LOGO_SRC} alt="" decoding="async" style={box(lg.x,st.y+st.h/2-lg.h/2-6,lg.w,lg.h)}/>
  <p className="scp-link" style={{right:u(L.W-(c.x+c.w-40-q.size-q.pad-26)),top:u(st.y+st.h/2-16-L.link.small*.92),fontSize:u(L.link.small)}}>comichuddle.com<span className="scp-link-handle" style={{fontSize:u(L.link.size+6)}}>/@{d.handle}</span></p>
  <div className="scp-qr" style={{...box(c.x+c.w-40-q.size-q.pad,st.y+st.h/2-q.size/2-6-q.pad,q.size+q.pad*2,q.size+q.pad*2),padding:u(q.pad)}} dangerouslySetInnerHTML={{__html:qrSvg}}/>
 </div>;
}
export default memo(ShareCardPreview);
