import {createHash,timingSafeEqual} from 'node:crypto';
import {getDb} from '../../../../db';
import {syncIdentifierBatch} from '../../../../lib/catalog-identifiers';
import {drainEnrichment} from '../../../../lib/enrichment-worker';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=300;
export async function GET(request:Request){const digest=(s:string)=>createHash('sha256').update(s).digest();if(!process.env.CRON_SECRET||!timingSafeEqual(digest(request.headers.get('authorization')||''),digest('Bearer '+process.env.CRON_SECRET)))return Response.json({error:'Unauthorized'},{status:401});try{const started=Date.now();let identifierRows=0;for(let step=0;step<12&&Date.now()-started<180000;step++){const result=await syncIdentifierBatch();identifierRows+=result.scanned;if(result.complete)break}return Response.json({...await drainEnrichment(getDb(),['cover'],20,Math.max(1000,240000-(Date.now()-started))),identifierRows},{headers:{'Cache-Control':'no-store'}})}catch{return Response.json({error:'Enrichment processing paused; durable checkpoints were retained.'},{status:503})}}
