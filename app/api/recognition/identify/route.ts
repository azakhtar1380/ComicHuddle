import {getDb} from '../../../../db';
import {identifyCover,visionAvailable,visionConfig} from '../../../../lib/cover-vision';
import {catalogCandidatesFor} from '../../../../lib/cover-identify';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=40;
const MAX_BYTES=10*1024*1024;
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});

/** Whether AI identification can be tried right now (configured, not over the global free-tier cap). */
export async function GET(){
 const config=visionConfig();
 return json({available:config.ready?await visionAvailable(getDb(),config):false,provider:config.provider});
}

/**
 * AI cover identification (provider chosen by the owner; default off).
 * Never a user-facing error when AI is off or out of free quota: the response is
 * {status:'unavailable'} and the scanner continues with free on-device OCR.
 * The photo is processed in memory and never stored.
 */
export async function POST(request:Request){
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return json({error:'Open the scanner from ComicHuddle.'},403);
 const config=visionConfig();if(!config.ready)return json({status:'unavailable',reason:'disabled'});
 let bytes:Buffer;
 try{
  const type=request.headers.get('content-type')||'';
  if(type.startsWith('multipart/form-data')){const file=(await request.formData()).get('image');if(!file||typeof file==='string')return json({error:'Attach the photo as "image".'},400);bytes=Buffer.from(await file.arrayBuffer())}
  else if(/^image\/(jpeg|png|webp)\b/.test(type))bytes=Buffer.from(await request.arrayBuffer());
  else return json({error:'Send a JPEG, PNG or WebP photo.'},415);
 }catch{return json({error:'The photo could not be read.'},400)}
 if(!bytes.length||bytes.length>MAX_BYTES)return json({error:'Choose a photo up to 10 MB.'},413);
 try{
  const outcome=await identifyCover(getDb(),bytes);
  if(outcome.status!=='ok')return json({status:outcome.status==='not_comic'?'not_comic':'unavailable',reason:outcome.reason||outcome.status,provider:outcome.provider});
  const candidates=await catalogCandidatesFor(outcome.identification!);
  return json({status:'ok',provider:outcome.provider,model:outcome.model,cached:outcome.cached,identification:outcome.identification,candidates});
 }catch{return json({status:'unavailable',reason:'error'})}
}
