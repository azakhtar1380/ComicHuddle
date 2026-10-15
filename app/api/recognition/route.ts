import {createHmac} from 'node:crypto';
import {z} from 'zod';
import {getPool} from '../../../db/postgres';
import {getDb} from '../../../db';
import {catalogIssuesById} from '../../../lib/catalog-store';
import {catalogSearchDto} from '../../../lib/catalog-search';
import {coverFeatureDistance,type CoverDescriptor} from '../../../lib/cover-recognition';
import {hashBits,hashDistance} from '../../../lib/cover-phash';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const descriptor=z.object({luma:z.array(z.number().finite().min(-25).max(25)).length(468),chroma:z.array(z.number().finite().min(0).max(1)).length(936),edges:z.array(z.number().finite().min(-50).max(50)).length(892),contrast:z.number().finite().min(0).max(1)});
const inputSchema=z.object({signatures:z.array(z.object({hash:z.string().regex(/^[a-f0-9]{16}$/),descriptor})).min(1).max(10)}).strict();
export async function GET(){
 try{const result=await getPool().query('SELECT count(*)::integer AS count,max(indexed_at) AS updated FROM ch_web.catalog_cover_features WHERE active');return json({engine:'catalog-phash-v2',indexedCovers:result.rows[0].count,updatedAt:result.rows[0].updated,ocr:'on-device',identitySource:'central-catalog',authenticityVerification:false})}
 catch{return json({error:'The visual index is temporarily unavailable. Catalog text search remains available.'},503)}
}
export async function POST(request:Request){
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return json({error:'Open the scanner from ComicHuddle.'},403);
 if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'Submit numerical cover features as JSON.'},415);
 const declared=Number(request.headers.get('content-length')||0);if(declared>400000)return json({error:'Cover feature request is too large.'},413);
 try{
  // Stream with a hard byte limit; Content-Length is not trusted.
  const reader=request.body?.getReader();if(!reader)return json({error:'Cover features are missing.'},400);
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>400000){await reader.cancel();return json({error:'Cover feature request is too large.'},413)}chunks.push(value)}
  const parsed=inputSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));if(!parsed.success)return json({error:'The cover features could not be read. Retake the photo.'},400);
  const pool=getPool(),secret=process.env.BETTER_AUTH_SECRET;if(!secret)return json({error:'The scanner service is not configured.'},503);
  const clientKey=createHmac('sha256',secret).update(request.headers.get('x-vercel-forwarded-for')||request.headers.get('x-forwarded-for')||'unknown').digest('hex');
  const quota=await pool.query(`INSERT INTO ch_web.catalog_scan_rate_limits(client_key,window_start,requests) VALUES($1,now(),1) ON CONFLICT(client_key) DO UPDATE SET window_start=CASE WHEN catalog_scan_rate_limits.window_start<now()-interval '1 minute' THEN now() ELSE catalog_scan_rate_limits.window_start END,requests=CASE WHEN catalog_scan_rate_limits.window_start<now()-interval '1 minute' THEN 1 ELSE catalog_scan_rate_limits.requests+1 END RETURNING requests`,[clientKey]);
  if(quota.rows[0].requests>16)return Response.json({error:'Scanner is taking a short pause. Retry in a minute.'},{status:429,headers:{'Retry-After':'60','Cache-Control':'no-store'}});
  const signatures=parsed.data.signatures,probes=signatures.flatMap(signature=>Array.from({length:8},(_,band)=>({band,bucket:hashBits(signature.hash).slice(band*8,band*8+8)})));
  const result=await pool.query(`WITH probes AS(SELECT DISTINCT band,bucket::bit(8) AS bucket FROM jsonb_to_recordset($1::jsonb) AS p(band smallint,bucket text)), candidates AS(SELECT b.issue_id,count(*) AS hits FROM probes p JOIN ch_web.catalog_cover_feature_bands b ON b.band=p.band AND b.bucket=p.bucket GROUP BY b.issue_id ORDER BY hits DESC,b.issue_id LIMIT 256) SELECT f.issue_id,f.phash::text,f.descriptor FROM candidates c JOIN ch_web.catalog_cover_features f ON f.issue_id=c.issue_id WHERE f.active AND f.descriptor_version=2`,[JSON.stringify(probes)]);
  const ranked=result.rows.map(row=>{
   const hash=BigInt('0b'+row.phash).toString(16).padStart(16,'0');let distance=Infinity,hamming=64;
   for(const signature of signatures){const h=hashDistance(signature.hash,hash),d=coverFeatureDistance(signature.descriptor,row.descriptor as CoverDescriptor);if(d<distance){distance=d;hamming=h}}
   return {id:Number(row.issue_id),distance,hamming};
  }).filter(row=>row.hamming<=24&&row.distance<=.28).sort((a,b)=>a.distance-b.distance).slice(0,6);
  const issues=await catalogIssuesById(getDb(),ranked.map(row=>row.id));
  const candidates=ranked.flatMap(row=>{const issue=issues.find(issue=>issue.id===row.id);return issue?[{issue:catalogSearchDto(issue),distance:row.distance,hashDistance:row.hamming}]:[]});
  const first=candidates[0],margin=first?(candidates[1]?.distance??1)-first.distance:0;
  return json({status:first&&first.distance<=.23&&first.hashDistance<=18&&margin>=.04?'matched':'unknown',method:'catalog-perceptual-hash',candidates,margin,authenticityVerification:false});
 }catch(error){if(error instanceof SyntaxError)return json({error:'The scanner request was unreadable.'},400);console.warn('Catalog recognition lookup deferred.');return json({error:'Visual matching could not connect. Automatic cover text search can still find the issue.'},503)}
}
