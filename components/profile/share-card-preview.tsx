'use client';
// The slab preview: plain HTML and <img> tags (the photo and cover the page already loaded), laid out with the same
// numbers as the PNG (lib/share-cards.ts), scaled to the preview's width with CSS. Nothing heavy here.
import {memo,type CSSProperties} from 'react';
import {L,HUDDLES_SRC,STRIP_TEXT,labelLines,nameFontSize,type ShareCardData} from '../../lib/share-cards';
import {VerifiedBadge} from '../verified-badge';
import './share-card-preview.css';

const u=(n:number)=>`calc(var(--u) * ${n})`;
const box=(x:number,y:number,w:number,h:number):CSSProperties=>({left:u(x),top:u(y),width:u(w),height:u(h)});
// The preview shows the slab itself; the PNG adds the night background and logo around it.
const TOP=L.slab.y-40,BOTTOM=L.slab.y+L.slab.h+L.slab.shadow+40;

function ShareCardPreview({d,label}:{d:ShareCardData;label:string}){
 const {slab:s,label:l,grade:g,window:w,sticker:k,photo:p,huddles:h}=L,size=nameFontSize(d.name);
 const y=(n:number)=>n-TOP;
 return <div className="scp" role="img" aria-label={label} style={{aspectRatio:`${L.W} / ${BOTTOM-TOP}`}}>
  <div className="scp-shadow" style={{...box(s.x+s.shadow,y(s.y+s.shadow),s.w,s.h),borderRadius:u(s.r)}}/>
  <div className="scp-slab" style={{...box(s.x,y(s.y),s.w,s.h),borderRadius:u(s.r),borderWidth:u(s.border)}}/>
  <div className="scp-label" style={{...box(l.x,y(l.y),l.w,l.h),borderRadius:u(l.r),borderWidth:u(l.border)}}/>
  <div className="scp-grade" style={{...box(g.x,y(g.y),g.w,g.h),borderWidth:u(g.border)}}><span style={{fontSize:u(g.value)}}>9.8</span><span style={{fontSize:u(g.word)}}>COLLECTOR</span></div>
  <p className="scp-name" style={{left:u(L.name.x),top:u(y(L.name.y)-size*.86),maxWidth:u(L.name.max),fontSize:u(size),gap:u(12)}}><span>{d.name}</span>{d.verified&&<span className="scp-mark" style={{width:u(size*.62)}}><VerifiedBadge kind={d.verified==='business'?'business':'person'} size={64}/></span>}</p>
  <p className="scp-handle" style={{left:u(L.handle.x),top:u(y(L.handle.y)-L.handle.size*.92),maxWidth:u(L.lines.max),fontSize:u(L.handle.size)}}>@{d.handle} · Since {d.since}</p>
  {labelLines(d).map((line,i)=><p key={line} className="scp-line" style={{left:u(L.lines.x),top:u(y(L.lines.y+i*L.lines.gap)-L.lines.size*.92),maxWidth:u(L.lines.max),fontSize:u(L.lines.size)}}>{line}</p>)}
  <p className="scp-strip" style={{left:u(L.strip.x),top:u(y(L.strip.y)-L.strip.size*.9),fontSize:u(L.strip.size)}}>{STRIP_TEXT}</p>
  <div className="scp-window" style={{...box(w.x,y(w.y),w.w,w.h),borderWidth:u(w.border)}}>
   {/* eslint-disable-next-line @next/next/no-img-element */}
   {d.cover?<img src={d.cover} alt="" decoding="async"/>:<span className="scp-window-empty"/>}
  </div>
  {d.founder&&<p className="scp-sticker" style={{...box(k.x,y(k.y),k.w,k.h),fontSize:u(k.size),borderWidth:u(5),boxShadow:`${u(6)} ${u(6)} 0 #20201f`}}>Founder!</p>}
  <div className="scp-photo" style={{...box(p.cx-p.r-p.ring,y(p.cy-p.r-p.ring),(p.r+p.ring)*2,(p.r+p.ring)*2),padding:u(p.ring),borderWidth:u(6)}}>
   {/* eslint-disable-next-line @next/next/no-img-element */}
   {d.avatar?<img src={d.avatar} alt="" decoding="async" style={{borderWidth:u(6)}}/>:<span className="scp-photo-empty" style={{borderWidth:u(6)}}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9.4" r="3.9" fill="#3e5563"/><ellipse cx="12" cy="22.5" rx="7.4" ry="6.6" fill="#3e5563"/></svg></span>}
  </div>
  {/* eslint-disable-next-line @next/next/no-img-element */}
  <img className="scp-huddles" src={HUDDLES_SRC} alt="" decoding="async" style={box(p.cx+p.r-h.w*.32,y(p.cy+p.r-h.h+14),h.w,h.h)}/>
  <p className="scp-url" style={{left:u(L.url.x),top:u(y(L.url.y)-L.url.size*.92),fontSize:u(L.url.size)}}>comichuddle.com/@{d.handle}</p>
 </div>;
}
export default memo(ShareCardPreview);
