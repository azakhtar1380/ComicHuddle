import {sql} from 'drizzle-orm';
import {after} from 'next/server';
import {drainEnrichment} from '../../../lib/enrichment-worker';
import {getDb} from '../../../db';
import {resolveCoverBatch} from '../../../lib/cover-cache';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){
 const raw=new URL(request.url).searchParams.get('ids')||'',parts=raw.split(',');
 if(parts.length>30||parts.some(id=>!/^\d{1,10}$/.test(id)||Number(id)>6500000000))return Response.json({error:'Choose up to 30 directory issue identifiers.'},{status:400});
 try{const db=getDb(),covers=await resolveCoverBatch(db,[...new Set(parts.map(Number))]);const counts=new Map<string,number>();for(const cover of covers)counts.set('cover_'+cover.status.toLowerCase(),(counts.get('cover_'+cover.status.toLowerCase())||0)+1);if(counts.size)await db.execute(sql`INSERT INTO ch_web.enrichment_metrics(day,name,count) VALUES ${sql.join([...counts].map(([name,count])=>sql`(CURRENT_DATE,${name},${count})`),sql`, `)} ON CONFLICT(day,name) DO UPDATE SET count=enrichment_metrics.count+excluded.count`);if(covers.some(cover=>cover.status==='PENDING'))after(async()=>{await drainEnrichment(db,['cover'],1,45000)});return Response.json({covers},{headers:{'Cache-Control':'no-store'}})}catch{return Response.json({error:'Cover resolution is temporarily unavailable.'},{status:503,headers:{'Cache-Control':'no-store'}})}
}

// A failed browser image never supplies a source URL. Revalidate the stored
// CDN object asynchronously; healthy objects are not evicted by client reports.
export async function POST(request:Request){try{
 if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Origin rejected.'},{status:403});
 const {createHmac}=await import('node:crypto'),{z}=await import('zod'),{readObject}=await import('../../../lib/api-security'),{enqueueEnrichment}=await import('../../../lib/enrichment-jobs');
 const input=z.object({issueId:z.number().int().min(4000000001).max(6500000000)}).strict().parse(await readObject(request,500)),secret=process.env.BETTER_AUTH_SECRET;if(!secret)return Response.json({queued:false},{status:503});
 const address=request.headers.get('x-vercel-forwarded-for')||request.headers.get('x-forwarded-for')||'unknown',key=createHmac('sha256',secret).update('cover-failure:'+address+':'+Math.floor(Date.now()/3600000)).digest('hex'),db=getDb();
 const rate=await db.execute(sql`INSERT INTO ch_web.catalog_scan_rate_limits(client_key,window_start,requests) VALUES(${key},now(),1) ON CONFLICT(client_key) DO UPDATE SET requests=catalog_scan_rate_limits.requests+1 RETURNING requests`);if(Number(rate.rows[0].requests)>20)return Response.json({queued:false},{status:429});
 await enqueueEnrichment(db,'cover','revalidate:'+input.issueId,{action:'revalidate',issueId:input.issueId});after(async()=>{await drainEnrichment(db,['cover'],1,45000)});return Response.json({queued:true});
 }catch{return Response.json({queued:false},{status:400})}}
