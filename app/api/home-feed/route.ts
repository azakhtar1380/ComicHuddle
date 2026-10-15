import {after} from 'next/server';
import {getDb} from '../../../db';
import {readMarketPulseSnapshot} from '../../../lib/market-pulse-snapshot';
import {drainEnrichment} from '../../../lib/enrichment-worker';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(){try{const db=getDb(),pulse=await readMarketPulseSnapshot(db);if(pulse.aiStatus==='queued')after(async()=>{await drainEnrichment(db,['pulse'],1,40000)});return Response.json({pulse,market:[],upcoming:[],asOf:pulse.updatedAt},{headers:{'Cache-Control':'public,s-maxage=60,stale-while-revalidate=60'}})}catch{return Response.json({error:'Recorded market activity could not load.'},{status:503,headers:{'Cache-Control':'no-store'}})}}
