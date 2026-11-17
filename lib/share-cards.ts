// The profile share card: one design, story size (1080×1920). The layout below is the single source for both the
// in-app preview (components/profile/share-card-preview.tsx, plain HTML + <img>, scaled with CSS) and the PNG
// (drawShareCard on a canvas, only when someone taps Instagram, Save card or More). No publisher art: the top is
// the member's own cover photo, or a plain pattern.
export type ShareCardData={name:string;handle:string;since:number;comics:number;keys:number;rating:string|null;
 verified:'person'|'business'|null;founder:boolean;favoriteCharacter:string|null;grail:string|null;
 avatar:string|null;cover:string|null;trophy?:{name:string;tier:string}|null};

export const INK='#20201f',CREAM='#f9f6ef',PAPER='#f5f1e7',YELLOW='#efd369',RED='#c83e30',BLUE='#345a6a',MUTED='#5c5850',CHECK='#1d5fc4';
export const HEAD_FONT="'Barlow Condensed','Arial Narrow',Impact,sans-serif",BODY_FONT="'DM Sans',Arial,sans-serif";
export const HUDDLES_SRC='/mascot/huddles-cutout.webp',LOGO_SRC='/brand/comichuddle-logo-cutout.webp';

/** Layout in 1080×1920 card pixels. */
export const L={
 W:1080,H:1920,
 card:{x:70,y:110,w:940,h:1700,r:44,border:10,shadow:22},
 cover:{h:500},
 photo:{cx:540,cy:610,r:150,ring:18},
 huddles:{h:206,w:144},           // the cutout is 359×512
 name:{y:930,max:800,size:108,min:60},
 handle:{y:1004,size:44},
 since:{y:1060,size:38},
 stats:{y:1110,h:170,w:262,gap:27,value:76,label:30},
 extras:{y:1330,h:76,gap:18,size:34,max:820},
 strip:{y:1600,h:210},
 logo:{x:110,h:150,w:186},        // the logo is 297×240
 qr:{size:150,pad:16},
 link:{size:34,small:30},
} as const;

export function nameFontSize(name:string){
 // Barlow Condensed averages about 0.46em per character at weight 800.
 return Math.max(L.name.min,Math.min(L.name.size,Math.floor(L.name.max/Math.max(1,name.length*.46))));
}
export function statChips(d:ShareCardData){
 return [{value:d.comics.toLocaleString('en-US'),label:d.comics===1?'Comic':'Comics'},{value:d.keys.toLocaleString('en-US'),label:d.keys===1?'Key':'Keys'},{value:d.rating?'★ '+d.rating:'New',label:'Rating'}];
}
const clip=(s:string,n:number)=>s.length>n?s.slice(0,n-1)+'…':s;
export function extraLines(d:ShareCardData){
 return [d.favoriteCharacter?'Fave: '+clip(d.favoriteCharacter,34):null,d.grail?'Grail: '+clip(d.grail,34):null,d.trophy?'Trophy: '+clip(d.trophy.name+' · '+d.trophy.tier,32):null].filter((x):x is string=>!!x);
}
/** Fewer extra lines: move the name, stats and extras down so the block stays centered above the strip. */
export const blockShift=(d:ShareCardData)=>Math.round((3-extraLines(d).length)*(L.extras.h+L.extras.gap)/2);
export const cardKey=(d:ShareCardData)=>JSON.stringify(d);

type Img=CanvasImageSource&{width:number;height:number};
export type CardImages={avatar:Img|null;cover:Img|null;huddles:Img|null;logo:Img|null};
export type QrMatrix={count:number;dark:(row:number,col:number)=>boolean};

function rounded(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number|[number,number,number,number]){
 const [a,b,c,e]=typeof r==='number'?[r,r,r,r]:r;
 ctx.beginPath();ctx.moveTo(x+a,y);ctx.lineTo(x+w-b,y);ctx.quadraticCurveTo(x+w,y,x+w,y+b);ctx.lineTo(x+w,y+h-c);ctx.quadraticCurveTo(x+w,y+h,x+w-c,y+h);
 ctx.lineTo(x+e,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-e);ctx.lineTo(x,y+a);ctx.quadraticCurveTo(x,y,x+a,y);ctx.closePath();
}
function cover(ctx:CanvasRenderingContext2D,img:Img,x:number,y:number,w:number,h:number){
 const s=Math.max(w/img.width,h/img.height),sw=w/s,sh=h/s;ctx.drawImage(img,(img.width-sw)/2,(img.height-sh)/2,sw,sh,x,y,w,h);
}
function dots(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,step:number,r:number,alpha:number){
 ctx.save();ctx.fillStyle=`rgba(32,32,31,${alpha})`;for(let yy=y+step/2;yy<y+h;yy+=step)for(let xx=x+step/2;xx<x+w;xx+=step){ctx.beginPath();ctx.arc(xx,yy,r,0,Math.PI*2);ctx.fill()}ctx.restore();
}
function fitText(ctx:CanvasRenderingContext2D,text:string,weight:number,font:string,size:number,min:number,max:number){
 let s=size;ctx.font=`${weight} ${s}px ${font}`;while(s>min&&ctx.measureText(text).width>max){s-=2;ctx.font=`${weight} ${s}px ${font}`}return s;
}
function silhouette(img:Img,color:string){
 const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d')!;x.drawImage(img,0,0);x.globalCompositeOperation='source-in';x.fillStyle=color;x.fillRect(0,0,c.width,c.height);return c;
}
function verifiedMark(ctx:CanvasRenderingContext2D,x:number,y:number,size:number,founder:boolean){
 ctx.save();ctx.translate(x,y);
 if(founder){ctx.fillStyle=YELLOW;ctx.strokeStyle=INK;ctx.lineWidth=size*.09;ctx.beginPath();ctx.arc(size/2,size/2,size/2-ctx.lineWidth/2,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.fillStyle=INK;ctx.beginPath();for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,r=i%2?size*.15:size*.32;ctx[i?'lineTo':'moveTo'](size/2+Math.cos(a)*r,size/2+Math.sin(a)*r)}ctx.closePath();ctx.fill()}
 else{ctx.scale(size/24,size/24);ctx.fillStyle=CHECK;ctx.fill(new Path2D('M12 1.5l2.6 1.9 3.2-.2 1 3.1 2.7 1.8-1 3.1 1 3.1-2.7 1.8-1 3.1-3.2-.2L12 22.5l-2.6-1.9-3.2.2-1-3.1-2.7-1.8 1-3.1-1-3.1 2.7-1.8 1-3.1 3.2.2z'));
  ctx.strokeStyle='#fff';ctx.lineWidth=2.4;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke(new Path2D('M7.6 12.3l3 3 5.8-6'))}
 ctx.restore();
}

/** Draws the whole card. Fonts must already be loaded (document.fonts.load) and images decoded. */
export function drawShareCard(ctx:CanvasRenderingContext2D,d:ShareCardData,img:CardImages,qr:QrMatrix){
 const {W,H,card:c}=L;
 ctx.fillStyle=PAPER;ctx.fillRect(0,0,W,H);dots(ctx,0,0,W,H,26,3,.13);
 // Card with a hard offset shadow.
 ctx.fillStyle=INK;rounded(ctx,c.x+c.shadow,c.y+c.shadow,c.w,c.h,c.r);ctx.fill();
 ctx.fillStyle=CREAM;rounded(ctx,c.x,c.y,c.w,c.h,c.r);ctx.fill();
 ctx.save();rounded(ctx,c.x,c.y,c.w,c.h,c.r);ctx.clip();
 // Cover photo across the top (rounded top corners come from the clip).
 if(img.cover)cover(ctx,img.cover,c.x,c.y,c.w,L.cover.h);
 else{ctx.fillStyle=BLUE;ctx.fillRect(c.x,c.y,c.w,L.cover.h);ctx.strokeStyle='rgba(255,255,255,.09)';ctx.lineWidth=20;for(let i=-L.cover.h;i<c.w;i+=56){ctx.beginPath();ctx.moveTo(c.x+i,c.y+L.cover.h);ctx.lineTo(c.x+i+L.cover.h,c.y);ctx.stroke()}}
 ctx.fillStyle=INK;ctx.fillRect(c.x,c.y+L.cover.h-4,c.w,8);
 // Bottom strip.
 ctx.fillStyle=INK;ctx.fillRect(c.x,L.strip.y,c.w,c.y+c.h-L.strip.y);
 ctx.restore();
 ctx.strokeStyle=INK;ctx.lineWidth=c.border;rounded(ctx,c.x,c.y,c.w,c.h,c.r);ctx.stroke();

 // Photo with a white ring, overlapping the cover's bottom edge.
 const p=L.photo;
 ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(p.cx,p.cy,p.r+p.ring,0,Math.PI*2);ctx.fill();ctx.strokeStyle=INK;ctx.lineWidth=6;ctx.stroke();
 ctx.save();ctx.beginPath();ctx.arc(p.cx,p.cy,p.r,0,Math.PI*2);ctx.clip();
 if(img.avatar)cover(ctx,img.avatar,p.cx-p.r,p.cy-p.r,p.r*2,p.r*2);
 else{ctx.fillStyle=CREAM;ctx.fillRect(p.cx-p.r,p.cy-p.r,p.r*2,p.r*2);dots(ctx,p.cx-p.r,p.cy-p.r,p.r*2,p.r*2,18,2.4,.14);ctx.strokeStyle=INK;ctx.lineWidth=11;ctx.beginPath();ctx.arc(p.cx,p.cy-p.r*.18,p.r*.3,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.arc(p.cx,p.cy+p.r*.7,p.r*.55,Math.PI*1.08,Math.PI*1.92);ctx.stroke()}
 ctx.restore();ctx.strokeStyle=INK;ctx.lineWidth=8;ctx.beginPath();ctx.arc(p.cx,p.cy,p.r,0,Math.PI*2);ctx.stroke();
 // Mr. Huddles at the photo's bottom-right: white outline, ink shadow.
 if(img.huddles){
  const h=L.huddles,hx=p.cx+p.r-h.w*.32,hy=p.cy+p.r-h.h+12,white=silhouette(img.huddles,'#fff'),ink=silhouette(img.huddles,INK);
  ctx.drawImage(ink,hx+8,hy+8,h.w,h.h);
  for(let a=0;a<16;a++){const t=a*Math.PI/8;ctx.drawImage(white,hx+Math.cos(t)*4,hy+Math.sin(t)*4,h.w,h.h)}
  ctx.drawImage(img.huddles,hx,hy,h.w,h.h);
 }

 // Name (+ blue check, or the Founder badge for the founder). Everything below moves down by `dy`.
 const dy=blockShift(d);
 ctx.textAlign='center';ctx.textBaseline='alphabetic';ctx.fillStyle=INK;
 const mark=d.founder||d.verified?Math.round(nameFontSize(d.name)*.62):0;
 const size=fitText(ctx,d.name,800,HEAD_FONT,nameFontSize(d.name),L.name.min,L.name.max-(mark?mark+14:0));
 const nameW=ctx.measureText(d.name).width,startX=L.W/2-(nameW+(mark?mark+14:0))/2;
 ctx.textAlign='left';ctx.fillText(d.name,startX,L.name.y+dy);
 if(mark)verifiedMark(ctx,startX+nameW+14,L.name.y+dy-size*.72,mark,d.founder);
 ctx.textAlign='center';
 fitText(ctx,'@'+d.handle,700,BODY_FONT,L.handle.size,30,820);ctx.fillText('@'+d.handle,L.W/2,L.handle.y+dy);
 ctx.fillStyle=MUTED;ctx.font=`500 ${L.since.size}px ${BODY_FONT}`;ctx.fillText('Collecting since '+d.since,L.W/2,L.since.y+dy);

 // Three stat chips.
 const s={...L.stats,y:L.stats.y+dy},total=s.w*3+s.gap*2,sx=L.W/2-total/2;
 statChips(d).forEach((chip,i)=>{const x=sx+i*(s.w+s.gap);
  ctx.fillStyle=INK;rounded(ctx,x+7,s.y+7,s.w,s.h,24);ctx.fill();ctx.fillStyle='#fff';rounded(ctx,x,s.y,s.w,s.h,24);ctx.fill();ctx.strokeStyle=INK;ctx.lineWidth=6;ctx.stroke();
  ctx.fillStyle=INK;fitText(ctx,chip.value,800,HEAD_FONT,s.value,40,s.w-30);ctx.fillText(chip.value,x+s.w/2,s.y+90);
  ctx.fillStyle=MUTED;ctx.font=`700 ${s.label}px ${BODY_FONT}`;ctx.fillText(chip.label,x+s.w/2,s.y+140)});

 // Fave / Grail (/ Trophy) pills, only those that are set.
 const e=L.extras;
 extraLines(d).forEach((line,i)=>{const y=e.y+dy+i*(e.h+e.gap);ctx.font=`600 ${e.size}px ${BODY_FONT}`;
  const sz=fitText(ctx,line,600,BODY_FONT,e.size,28,e.max-60),w=Math.min(e.max,ctx.measureText(line).width+60);
  ctx.fillStyle=YELLOW;rounded(ctx,L.W/2-w/2,y,w,e.h,e.h/2);ctx.fill();ctx.strokeStyle=INK;ctx.lineWidth=5;ctx.stroke();
  ctx.fillStyle=INK;ctx.font=`600 ${sz}px ${BODY_FONT}`;ctx.fillText(line,L.W/2,y+e.h/2+sz*.36)});

 // Bottom strip: logo left; link and a real QR code right.
 const st=L.strip,midY=st.y+st.h/2;
 if(img.logo)ctx.drawImage(img.logo,L.logo.x,midY-L.logo.h/2-6,L.logo.w,L.logo.h);
 const q=L.qr,qx=c.x+c.w-40-q.size,qy=midY-q.size/2-6;
 ctx.fillStyle='#fff';ctx.fillRect(qx-q.pad,qy-q.pad,q.size+q.pad*2,q.size+q.pad*2);
 const cell=q.size/qr.count;ctx.fillStyle=INK;for(let r=0;r<qr.count;r++)for(let col=0;col<qr.count;col++)if(qr.dark(r,col))ctx.fillRect(qx+col*cell,qy+r*cell,Math.ceil(cell),Math.ceil(cell));
 ctx.textAlign='right';const right=qx-q.pad-26,room=right-(L.logo.x+L.logo.w+24);
 ctx.fillStyle=CREAM;ctx.font=`600 ${L.link.small}px ${BODY_FONT}`;ctx.fillText('comichuddle.com',right,midY-16);
 ctx.fillStyle=YELLOW;fitText(ctx,'/@'+d.handle,800,BODY_FONT,L.link.size+6,28,room);ctx.fillText('/@'+d.handle,right,midY+30);
 ctx.textAlign='start';
}
