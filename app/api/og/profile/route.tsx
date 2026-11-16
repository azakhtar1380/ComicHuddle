// Open Graph / Twitter image for a public profile (1200×630): name, verified check, @handle, comics, keys,
// star rating, on the member's world background. Hidden or unknown profiles get 404 and no image.
import {ImageResponse} from 'next/og';
import {publicProfileSummary} from '../../../../lib/public-profile';
import {worldFor} from '../../../../lib/profile-worlds';
import sharp from 'sharp';
import {env} from '../../../../lib/runtime-env';

/** The member's photo as a PNG data URL, read from the photo store (the image renderer may not fetch our own host). */
async function avatarData(url:string|null){
 const id=/[?&]id=([a-f0-9-]{36})$/.exec(url||'')?.[1];if(!id)return null;
 try{const object=await env.BUCKET.get('avatars/'+id);if(!object)return null;return 'data:image/png;base64,'+(await sharp(Buffer.from(object.body)).resize(200,200).png().toBuffer()).toString('base64')}catch{return null}
}

export const runtime='nodejs';
export async function GET(req:Request){
 const handle=new URL(req.url).searchParams.get('handle')||'';
 const p=await publicProfileSummary(handle);
 if(!p)return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});
 const world=worldFor(p.world),avatar=await avatarData(p.avatarUrl);
 const stat=(label:string,value:string)=><div style={{display:'flex',flexDirection:'column',alignItems:'center',padding:'10px 26px',background:'#f9f6ef',border:'5px solid #20201f',boxShadow:'6px 6px 0 #20201f'}}><span style={{fontSize:58,fontWeight:800,lineHeight:1}}>{value}</span><span style={{fontSize:24,fontWeight:700,textTransform:'uppercase',letterSpacing:2}}>{label}</span></div>;
 const rating=p.rating?(p.rating.stars!==null?`${p.rating.stars.toFixed(1)}★`:`${p.rating.percent}%`):null;
 return new ImageResponse(<div style={{width:'100%',height:'100%',display:'flex',flexDirection:'column',justifyContent:'space-between',padding:48,background:`linear-gradient(180deg, ${world.sky[0]}, ${world.sky[1]})`,color:'#20201f',fontFamily:'sans-serif'}}>
  <div style={{display:'flex',alignItems:'center',gap:36,background:'#f9f6ef',border:'6px solid #20201f',boxShadow:'10px 10px 0 #20201f',padding:'28px 36px'}}>
   {avatar?<img src={avatar} width={180} height={180} style={{borderRadius:999,border:'6px solid #20201f'}} alt=""/>:<div style={{width:180,height:180,borderRadius:999,border:'6px solid #20201f',background:'#efd369',display:'flex',alignItems:'center',justifyContent:'center',fontSize:96,fontWeight:800}}>{p.name.slice(0,1).toUpperCase()}</div>}
   <div style={{display:'flex',flexDirection:'column',gap:6}}>
    <div style={{display:'flex',alignItems:'center',gap:16,fontSize:76,fontWeight:800,lineHeight:1}}>{p.name.slice(0,22)}{p.verified&&<svg width="58" height="58" viewBox="0 0 24 24"><path fill="#1d5fc4" d="M12 1.5l2.6 1.9 3.2-.2 1 3.1 2.7 1.8-1 3.1 1 3.1-2.7 1.8-1 3.1-3.2-.2L12 22.5l-2.6-1.9-3.2.2-1-3.1-2.7-1.8 1-3.1-1-3.1 2.7-1.8 1-3.1 3.2.2z"/><path fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" d="M7.6 12.3l3 3 5.8-6.3"/></svg>}</div>
    <div style={{display:'flex',fontSize:36,fontWeight:700}}>@{p.handle}{p.verified?` · Verified ${p.verified==='business'?'business':'collector'}`:''}</div>
   </div>
  </div>
  <div style={{display:'flex',gap:24,alignItems:'flex-end',justifyContent:'space-between'}}>
   <div style={{display:'flex',gap:24}}>{stat('Comics',p.comics.toLocaleString('en-US'))}{stat('Keys',p.keys.toLocaleString('en-US'))}{rating&&stat(p.rating!.count+' reviews',rating)}</div>
   <div style={{display:'flex',fontSize:44,fontWeight:800,background:'#20201f',color:'#efd369',padding:'8px 20px'}}>ComicHuddle</div>
  </div>
 </div>,{width:1200,height:630,headers:{'Cache-Control':'public, max-age=600, s-maxage=600'}});
}
