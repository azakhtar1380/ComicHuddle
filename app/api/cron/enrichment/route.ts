import {createHash,timingSafeEqual} from 'node:crypto';
import {getDb} from '../../../../db';
import {drainEnrichment} from '../../../../lib/enrichment-worker';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=300;
export async function GET(request:Request){const digest=(s:string)=>createHash('sha256').update(s).digest();if(!process.env.CRON_SECRET||!timingSafeEqual(digest(request.headers.get('authorization')||''),digest('Bearer '+process.env.CRON_SECRET)))return Response.json({error:'Unauthorized'},{status:401});try{return Response.json(await drainEnrichment(getDb(),['valuation','pulse','cover'],20,240000),{headers:{'Cache-Control':'no-store'}})}catch{return Response.json({error:'Enrichment processing paused; durable checkpoints were retained.'},{status:503})}}
