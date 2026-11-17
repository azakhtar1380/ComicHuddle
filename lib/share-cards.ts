// The profile share card: the "slab" (a generic clear graded-slab look, no grading company branding), story size
// 1080×1920. The layout below is the single source for both the in-app preview (share-card-preview.tsx, plain HTML
// and <img>, scaled with CSS) and the PNG (drawShareCard on a canvas, only when someone taps Instagram, Save card
// or More). No publisher art: the window shows the member's own cover photo, or a plain pattern.
export type ShareCardData={name:string;handle:string;since:number;comics:number;keys:number;trades:number;rating:string|null;
 verified:'person'|'business'|null;founder:boolean;favoriteCharacter:string|null;grail:string|null;
 avatar:string|null;cover:string|null;trophy?:{name:string;tier:string}|null};

export const INK='#20201f',CREAM='#f9f6ef',YELLOW='#efd369',RED='#c83e30',BLUE='#345a6a',CHECK='#1d5fc4',NIGHT='#26282e',NIGHT2='#2e3139';
export const HEAD_FONT="'Barlow Condensed','Arial Narrow',Impact,sans-serif",BODY_FONT="'DM Sans',Arial,sans-serif";
export const HUDDLES_SRC='/mascot/huddles-cutout.webp',LOGO_SRC='/brand/comichuddle-logo-cutout.webp';

/** Layout in 1080×1920 card pixels. */
export const L={
 W:1080,H:1920,
 logo:{cx:540,y:70,h:150,w:186},       // the logo is 297×240
 slab:{x:90,y:260,w:900,h:1440,r:44,border:8,shadow:20},
 label:{x:128,y:298,w:824,h:340,r:22,border:6},
 grade:{x:158,y:328,w:196,h:206,border:6,value:118,word:32},
 name:{x:384,y:410,max:540,size:96,min:54},
 handle:{x:384,y:462,size:34},
 lines:{x:384,y:512,gap:40,size:29,max:540},
 strip:{x:158,y:604,size:30},
 window:{x:128,y:672,w:824,h:900,border:6},
 sticker:{x:712,y:700,w:210,h:84,size:54},
 photo:{cx:540,cy:1300,r:176,ring:16},
 huddles:{h:240,w:168},               // the cutout is 359×512
 url:{x:140,y:1636,size:38},
} as const;

const clip=(s:string,n:number)=>s.length>n?s.slice(0,n-1)+'…':s;
export function nameFontSize(name:string){return Math.max(L.name.min,Math.min(L.name.size,Math.floor(L.name.max/Math.max(1,name.length*.46))))}
/** "1,284 issues · 46 keys · 38 trades." then "Fave: … Grail: …" (only those that are set). */
export function labelLines(d:ShareCardData){
 const n=(v:number,one:string,many:string)=>v.toLocaleString('en-US')+' '+(v===1?one:many);
 const extras=[d.favoriteCharacter?'Fave: '+clip(d.favoriteCharacter,22)+'.':null,d.grail?'Grail: '+clip(d.grail,24)+'.':null].filter(Boolean).join(' ');
 return [n(d.comics,'issue','issues')+' · '+n(d.keys,'key','keys')+' · '+n(d.trades,'trade','trades')+(d.rating?' · ★ '+d.rating:'')+'.',extras||null,d.trophy?'Trophy: '+clip(d.trophy.name+' · '+d.trophy.tier,30):null].filter((x):x is string=>!!x).slice(0,2);
}
export const STRIP_TEXT='White pages · Bagged & boarded';
export const cardKey=(d:ShareCardData)=>JSON.stringify(d);

type Img=CanvasImageSource&{width:number;height:number};
export type CardImages={avatar:Img|null;cover:Img|null;huddles:Img|null;logo:Img|null};

function rounded(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number){
 ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();
}
function coverFit(ctx:CanvasRenderingContext2D,img:Img,x:number,y:number,w:number,h:number){
 const s=Math.max(w/img.width,h/img.height),sw=w/s,sh=h/s;ctx.drawImage(img,(img.width-sw)/2,(img.height-sh)/2,sw,sh,x,y,w,h);
}
function fitText(ctx:CanvasRenderingContext2D,text:string,weight:number,font:string,size:number,min:number,max:number){
 let s=size;ctx.font=`${weight} ${s}px ${font}`;while(s>min&&ctx.measureText(text).width>max){s-=2;ctx.font=`${weight} ${s}px ${font}`}
 if(ctx.measureText(text).width<=max)return text;let t=text;while(t.length>1&&ctx.measureText(t+'…').width>max)t=t.slice(0,-1);return t+'…';
}
function silhouette(img:Img,color:string){
 const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d')!;x.drawImage(img,0,0);x.globalCompositeOperation='source-in';x.fillStyle=color;x.fillRect(0,0,c.width,c.height);return c;
}
function check(ctx:CanvasRenderingContext2D,x:number,y:number,size:number){
 ctx.save();ctx.translate(x,y);ctx.scale(size/24,size/24);ctx.fillStyle=CHECK;ctx.fill(new Path2D('M12 1.5l2.6 1.9 3.2-.2 1 3.1 2.7 1.8-1 3.1 1 3.1-2.7 1.8-1 3.1-3.2-.2L12 22.5l-2.6-1.9-3.2.2-1-3.1-2.7-1.8 1-3.1-1-3.1 2.7-1.8 1-3.1 3.2.2z'));
 ctx.strokeStyle='#fff';ctx.lineWidth=2.4;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke(new Path2D('M7.6 12.3l3 3 5.8-6'));ctx.restore();
}

/** Draws the whole card. Fonts must already be loaded (document.fonts.load) and images decoded. */
export function drawShareCard(ctx:CanvasRenderingContext2D,d:ShareCardData,img:CardImages){
 const {W,H}=L;
 // Night background with soft rays.
 ctx.fillStyle=NIGHT;ctx.fillRect(0,0,W,H);ctx.fillStyle=NIGHT2;
 for(let i=0;i<24;i+=2){const a=i*Math.PI/12,b=(i+1)*Math.PI/12;ctx.beginPath();ctx.moveTo(W/2,H/2);ctx.lineTo(W/2+Math.cos(a)*2000,H/2+Math.sin(a)*2000);ctx.lineTo(W/2+Math.cos(b)*2000,H/2+Math.sin(b)*2000);ctx.closePath();ctx.fill()}
 if(img.logo)ctx.drawImage(img.logo,L.logo.cx-L.logo.w/2,L.logo.y,L.logo.w,L.logo.h);
 // The slab: red offset shadow, clear plastic, ink edge.
 const s=L.slab;
 ctx.fillStyle=RED;rounded(ctx,s.x+s.shadow,s.y+s.shadow,s.w,s.h,s.r);ctx.fill();
 const plastic=ctx.createLinearGradient(s.x,s.y,s.x+s.w,s.y+s.h);plastic.addColorStop(0,'#f1f5f7');plastic.addColorStop(.5,'#d9e3e9');plastic.addColorStop(1,'#eef2f4');
 ctx.fillStyle=plastic;rounded(ctx,s.x,s.y,s.w,s.h,s.r);ctx.fill();ctx.strokeStyle=INK;ctx.lineWidth=s.border;ctx.stroke();
 // Label.
 const l=L.label;ctx.fillStyle=CREAM;rounded(ctx,l.x,l.y,l.w,l.h,l.r);ctx.fill();ctx.lineWidth=l.border;ctx.stroke();
 const g=L.grade;ctx.fillStyle=RED;ctx.fillRect(g.x,g.y,g.w,g.h);ctx.lineWidth=g.border;ctx.strokeRect(g.x,g.y,g.w,g.h);
 ctx.fillStyle='#fff';ctx.textAlign='center';ctx.font=`800 ${g.value}px ${HEAD_FONT}`;ctx.fillText('9.8',g.x+g.w/2,g.y+122);
 ctx.font=`800 ${g.word}px ${HEAD_FONT}`;ctx.fillText('COLLECTOR',g.x+g.w/2,g.y+174);
 ctx.textAlign='left';ctx.fillStyle=INK;
 const markRoom=d.verified?nameFontSize(d.name)*.62+12:0;
 const name=fitText(ctx,d.name.toUpperCase(),800,HEAD_FONT,nameFontSize(d.name),L.name.min,L.name.max-markRoom);ctx.fillText(name,L.name.x,L.name.y);
 if(d.verified){const size=Number(/(\d+)px/.exec(ctx.font)?.[1]||60);check(ctx,L.name.x+ctx.measureText(name).width+12,L.name.y-size*.72,size*.62)}
 const handle=fitText(ctx,'@'+d.handle+' · Since '+d.since,700,BODY_FONT,L.handle.size,28,L.lines.max);ctx.fillText(handle,L.handle.x,L.handle.y);
 ctx.fillStyle='#3d3b36';labelLines(d).forEach((line,i)=>{const t=fitText(ctx,line,500,BODY_FONT,L.lines.size,28,L.lines.max);ctx.fillText(t,L.lines.x,L.lines.y+i*L.lines.gap)});
 ctx.fillStyle=INK;ctx.font=`800 ${L.strip.size}px ${HEAD_FONT}`;ctx.fillText(STRIP_TEXT.toUpperCase(),L.strip.x,L.strip.y);
 // Window: the member's cover photo, or a plain pattern.
 const w=L.window;
 ctx.save();ctx.beginPath();ctx.rect(w.x,w.y,w.w,w.h);ctx.clip();
 if(img.cover)coverFit(ctx,img.cover,w.x,w.y,w.w,w.h);
 else{ctx.fillStyle=BLUE;ctx.fillRect(w.x,w.y,w.w,w.h);ctx.strokeStyle='rgba(255,255,255,.09)';ctx.lineWidth=22;for(let i=-w.h;i<w.w;i+=60){ctx.beginPath();ctx.moveTo(w.x+i,w.y+w.h);ctx.lineTo(w.x+i+w.h,w.y);ctx.stroke()}}
 ctx.restore();ctx.strokeStyle=INK;ctx.lineWidth=w.border;ctx.strokeRect(w.x,w.y,w.w,w.h);
 if(d.founder){const k=L.sticker;ctx.save();ctx.translate(k.x+k.w/2,k.y+k.h/2);ctx.rotate(-4*Math.PI/180);ctx.fillStyle=INK;ctx.fillRect(-k.w/2+6,-k.h/2+6,k.w,k.h);ctx.fillStyle=YELLOW;ctx.fillRect(-k.w/2,-k.h/2,k.w,k.h);ctx.strokeStyle=INK;ctx.lineWidth=5;ctx.strokeRect(-k.w/2,-k.h/2,k.w,k.h);ctx.fillStyle=INK;ctx.textAlign='center';ctx.font=`800 ${k.size}px ${HEAD_FONT}`;ctx.fillText('Founder!',0,k.size*.34);ctx.restore()}
 // Photo with a yellow ring, Mr. Huddles at its bottom-right.
 const p=L.photo;
 ctx.fillStyle=YELLOW;ctx.beginPath();ctx.arc(p.cx,p.cy,p.r+p.ring,0,Math.PI*2);ctx.fill();ctx.strokeStyle=INK;ctx.lineWidth=6;ctx.stroke();
 ctx.save();ctx.beginPath();ctx.arc(p.cx,p.cy,p.r,0,Math.PI*2);ctx.clip();
 if(img.avatar)coverFit(ctx,img.avatar,p.cx-p.r,p.cy-p.r,p.r*2,p.r*2);
 else{ctx.fillStyle='#c9d3da';ctx.fillRect(p.cx-p.r,p.cy-p.r,p.r*2,p.r*2);ctx.fillStyle='#3e5563';ctx.beginPath();ctx.arc(p.cx,p.cy-p.r*.2,p.r*.32,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.ellipse(p.cx,p.cy+p.r*.78,p.r*.62,p.r*.55,0,0,Math.PI*2);ctx.fill()}
 ctx.restore();ctx.strokeStyle=INK;ctx.lineWidth=6;ctx.beginPath();ctx.arc(p.cx,p.cy,p.r,0,Math.PI*2);ctx.stroke();
 if(img.huddles){
  const h=L.huddles,hx=p.cx+p.r-h.w*.32,hy=p.cy+p.r-h.h+14,white=silhouette(img.huddles,'#fff'),ink=silhouette(img.huddles,INK);
  ctx.drawImage(ink,hx+8,hy+8,h.w,h.h);for(let a=0;a<16;a++){const t=a*Math.PI/8;ctx.drawImage(white,hx+Math.cos(t)*4,hy+Math.sin(t)*4,h.w,h.h)}ctx.drawImage(img.huddles,hx,hy,h.w,h.h);
 }
 // Link along the bottom of the slab.
 ctx.textAlign='left';ctx.fillStyle=INK;const url=fitText(ctx,'comichuddle.com/@'+d.handle,800,BODY_FONT,L.url.size,28,800);ctx.fillText(url,L.url.x,L.url.y);
}
