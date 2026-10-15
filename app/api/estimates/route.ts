import {z} from 'zod';
import {after} from 'next/server';
import {drainEnrichment} from '../../../lib/enrichment-worker';
import {createHmac} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {getDb} from '../../../db';
import {estimateRequestSchema,readEstimates} from '../../../lib/estimated-fmv';
import {readObject,privateJson,ApiRequestError} from '../../../lib/api-security';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(request:Request){try{
 if(request.headers.get('origin')!==new URL(request.url).origin)return privateJson({error:'Open estimates from ComicHuddle.'},403);
 const input=z.object({requests:z.array(estimateRequestSchema).min(1).max(30)}).strict().parse(await readObject(request,40000)),db=getDb();
 const address=request.headers.get('x-vercel-forwarded-for')||request.headers.get('x-forwarded-for')||'unknown',secret=process.env.BETTER_AUTH_SECRET;if(!secret)return privateJson({error:'Estimate access is not configured.'},503);
 const key=createHmac('sha256',secret).update('estimates:'+address+':'+Math.floor(Date.now()/60000)).digest('hex');
 const rate=await db.execute(sql`INSERT INTO ch_web.catalog_scan_rate_limits(client_key,window_start,requests) VALUES(${key},now(),1) ON CONFLICT(client_key) DO UPDATE SET requests=catalog_scan_rate_limits.requests+1 RETURNING requests`);
 if(Number(rate.rows[0].requests)>40)return privateJson({error:'Too many estimate requests. Retry shortly.'},429);
 const snapshots=await readEstimates(db,input.requests);after(async()=>{await drainEnrichment(db,['valuation'],4,45000)});return privateJson({snapshots,updatedAt:new Date().toISOString()});
 }catch(error){if(error instanceof ApiRequestError)return privateJson({error:error.message},error.status);if(error instanceof z.ZodError)return privateJson({error:'Choose valid directory issues and copy conditions.'},400);return privateJson({error:'Estimates are temporarily unavailable. Your listing can still be saved.'},503)}}
