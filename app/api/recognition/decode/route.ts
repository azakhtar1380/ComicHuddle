import {decodeBarcodePhoto} from '../../../../lib/barcode-photo-decode';
import {parseComicIdentifier} from '../../../../lib/comic-identifiers';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=30;
const MAX_BYTES=10*1024*1024;
const json=(body:unknown,status=200,headers:Record<string,string>={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store',...headers}});

/**
 * Free server-side barcode reading for a photo the device could not read.
 * Body: multipart form field "image" or a raw image/jpeg|png|webp body (<= 10 MB).
 * The photo is decoded in memory and discarded; only digits are returned.
 */
export async function POST(request:Request){
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return json({error:'Open the scanner from ComicHuddle.'},403);
 const declared=Number(request.headers.get('content-length')||0);if(declared>MAX_BYTES+64*1024)return json({error:'Choose a photo up to 10 MB.'},413);
 let bytes:Buffer;
 try{
  const type=request.headers.get('content-type')||'';
  if(type.startsWith('multipart/form-data')){const file=(await request.formData()).get('image');if(!file||typeof file==='string')return json({error:'Attach the photo as "image".'},400);bytes=Buffer.from(await file.arrayBuffer())}
  else if(/^image\/(jpeg|png|webp)\b/.test(type))bytes=Buffer.from(await request.arrayBuffer());
  else return json({error:'Send a JPEG, PNG or WebP photo.'},415);
 }catch{return json({error:'The photo could not be read.'},400)}
 if(!bytes.length||bytes.length>MAX_BYTES)return json({error:'Choose a photo up to 10 MB.'},413);
 // No per-user/IP throttle by design: decoding is free (CPU only) and bounded per request.
 try{
  const result=await decodeBarcodePhoto(bytes,{deadlineMs:20000});
  if(!result.code)return json({found:false,attempts:result.attempts,elapsedMs:result.elapsedMs});
  const parsed=parseComicIdentifier(result.code.value,result.code.supplement,result.code.format);
  return json({found:true,value:result.code.value,supplement:result.code.supplement,format:result.code.format,valid:!!parsed,attempts:result.attempts,elapsedMs:result.elapsedMs});
 }catch{return json({error:'This photo format could not be opened. Use JPEG, PNG or WebP.'},415)}
}
