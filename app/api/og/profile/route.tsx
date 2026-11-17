// Open Graph / Twitter image for a public profile (1200×630), in the share card's look turned landscape: a cream
// card with an ink border and hard shadow on soft dots; the photo (white ring, Mr. Huddles) on the left; name,
// @handle, Collecting since, stat chips and Fave / Grail on the right. Hidden or unknown profiles get 404.
import {ImageResponse} from 'next/og';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {publicProfileSummary} from '../../../../lib/public-profile';
import sharp from 'sharp';
import {env} from '../../../../lib/runtime-env';

/** The member's photo as a PNG data URL, read from the photo store (the image renderer may not fetch our own host). */
async function avatarData(url:string|null){
 const id=/[?&]id=([a-f0-9-]{36})$/.exec(url||'')?.[1];if(!id)return null;
 try{const object=await env.BUCKET.get('avatars/'+id);if(!object)return null;return 'data:image/png;base64,'+(await sharp(Buffer.from(object.body)).resize(260,260).png().toBuffer()).toString('base64')}catch{return null}
}
/** Small brand images from /public as PNG data URLs, made once per server. */
const assets=new Map<string,Promise<string|null>>();
function asset(file:string,height:number){
 if(!assets.has(file))assets.set(file,readFile(path.join(process.cwd(),'public',file)).then(async b=>'data:image/png;base64,'+(await sharp(b).resize({height}).png().toBuffer()).toString('base64')).catch(()=>null));
 return assets.get(file)!;
}
const INK='#20201f',CREAM='#f9f6ef',PAPER='#f5f1e7',YELLOW='#efd369',MUTED='#5c5850';
const check=<svg width="56" height="56" viewBox="0 0 24 24"><path fill="#1d5fc4" d="M12 1.5l2.6 1.9 3.2-.2 1 3.1 2.7 1.8-1 3.1 1 3.1-2.7 1.8-1 3.1-3.2-.2L12 22.5l-2.6-1.9-3.2.2-1-3.1-2.7-1.8 1-3.1-1-3.1 2.7-1.8 1-3.1 3.2.2z"/><path fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" d="M7.6 12.3l3 3 5.8-6.3"/></svg>;

export const runtime='nodejs';
export async function GET(req:Request){
 const handle=new URL(req.url).searchParams.get('handle')||'';
 const p=await publicProfileSummary(handle);
 if(!p)return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});
 const [avatar,huddles]=await Promise.all([avatarData(p.avatarUrl),asset('mascot/huddles-cutout.webp',170)]);
 const rating=p.rating?(p.rating.stars!==null?`★ ${p.rating.stars.toFixed(1)}`:`${p.rating.percent}%`):'New';
 const chip=(value:string,label:string)=><div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',width:170,height:112,background:'#fff',border:`5px solid ${INK}`,borderRadius:18,boxShadow:`6px 6px 0 ${INK}`}}><span style={{fontSize:52,fontWeight:800,lineHeight:1}}>{value}</span><span style={{fontSize:24,fontWeight:700,color:MUTED,marginTop:6}}>{label}</span></div>;
 const extras=[p.favoriteCharacter?'Fave: '+p.favoriteCharacter:null,p.grail?'Grail: '+p.grail:null].filter((x):x is string=>!!x).map(s=>s.length>34?s.slice(0,33)+'…':s);
 return new ImageResponse(<div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',background:PAPER,backgroundImage:'radial-gradient(circle, rgba(32,32,31,.13) 2.5px, transparent 3px)',backgroundSize:'24px 24px',color:INK,fontFamily:'sans-serif'}}>
  <div style={{display:'flex',width:1100,height:530,background:CREAM,border:`8px solid ${INK}`,borderRadius:36,boxShadow:`16px 16px 0 ${INK}`,padding:'40px 44px',alignItems:'center',gap:48}}>
   <div style={{display:'flex',position:'relative',width:300,height:300,flexShrink:0}}>
    <div style={{display:'flex',width:300,height:300,borderRadius:999,background:'#fff',border:`6px solid ${INK}`,padding:14}}>
     {avatar?<img src={avatar} width={260} height={260} style={{borderRadius:999,border:`6px solid ${INK}`}} alt=""/>
     :<div style={{display:'flex',width:260,height:260,borderRadius:999,border:`6px solid ${INK}`,background:YELLOW,alignItems:'center',justifyContent:'center',fontSize:130,fontWeight:800}}>{p.name.slice(0,1).toUpperCase()}</div>}
    </div>
    {huddles&&<img src={huddles} height={170} width={119} style={{position:'absolute',right:-40,bottom:-4}} alt=""/>}
   </div>
   <div style={{display:'flex',flexDirection:'column',flexGrow:1,minWidth:0}}>
    <div style={{display:'flex',alignItems:'center',gap:14,fontSize:p.name.length>16?60:76,fontWeight:800,lineHeight:1}}>{p.name.slice(0,24)}{p.verified&&check}</div>
    <div style={{display:'flex',fontSize:34,fontWeight:700,marginTop:12}}>@{p.handle}</div>
    <div style={{display:'flex',fontSize:28,color:MUTED,marginTop:4}}>Collecting since {p.since}</div>
    <div style={{display:'flex',gap:20,marginTop:24}}>{chip(p.comics.toLocaleString('en-US'),p.comics===1?'Comic':'Comics')}{chip(p.keys.toLocaleString('en-US'),p.keys===1?'Key':'Keys')}{chip(rating,'Rating')}</div>
    {extras.length>0&&<div style={{display:'flex',gap:12,marginTop:22,flexWrap:'wrap'}}>{extras.map(line=><span key={line} style={{display:'flex',fontSize:24,fontWeight:700,background:YELLOW,border:`4px solid ${INK}`,borderRadius:999,padding:'6px 18px'}}>{line}</span>)}</div>}
   </div>
  </div>
 </div>,{width:1200,height:630,headers:{'Cache-Control':'public, max-age=600, s-maxage=600'}});
}
