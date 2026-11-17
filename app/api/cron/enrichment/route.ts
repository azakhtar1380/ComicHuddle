import {dailyTrophySweep} from '../../../../lib/trophies';
import {createHash,timingSafeEqual} from 'node:crypto';
import {getDb} from '../../../../db';
import {syncIdentifierBatch} from '../../../../lib/catalog-identifiers';
import {drainEnrichment} from '../../../../lib/enrichment-worker';
import {commerceRefreshCarrierStatus,type StripeSandboxEnv} from '../../../../lib/commerce';
import {importMetronCovers} from '../../../../lib/metron-cover-import';
import {env} from '../../../../lib/runtime-env';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=300;
export async function GET(request:Request){const digest=(s:string)=>createHash('sha256').update(s).digest();if(!process.env.CRON_SECRET||!timingSafeEqual(digest(request.headers.get('authorization')||''),digest('Bearer '+process.env.CRON_SECRET)))return Response.json({error:'Unauthorized'},{status:401});// Daily carrier polling backup (bounded batch, independent of catalog enrichment).
let carrier:unknown=null;try{carrier=await commerceRefreshCarrierStatus(getDb(),env as unknown as StripeSandboxEnv,{limit:25})}catch{carrier={error:'carrier_refresh_failed'}}
try{const started=Date.now();let identifierRows=0;for(let step=0;step<12&&Date.now()-started<180000;step++){const result=await syncIdentifierBatch();identifierRows+=result.scanned;if(result.complete)break}
// Owner's Metron CDN cover index (only when METRON_COVER_CDN_BASE is set); bounded and resumable, never fails the run.
let metronCovers:unknown=null;if(process.env.METRON_COVER_CDN_BASE){const budgetMs=Math.min(60000,Math.max(5000,230000-(Date.now()-started)));try{const r=await importMetronCovers(getDb(),{budgetMs});metronCovers={status:r.status,upserted:r.upserted,exact:r.exact,named:r.named}}catch{metronCovers={error:'metron_cover_import_failed'}}}
// Daily trophy sweep: awards order trophies once review windows pass and quietly revokes dropped tiers.
const trophies=await dailyTrophySweep().catch(()=>null);
return Response.json({trophies,...await drainEnrichment(getDb(),['cover'],20,Math.max(1000,240000-(Date.now()-started))),identifierRows,metronCovers,carrier},{headers:{'Cache-Control':'no-store'}})}catch{return Response.json({error:'Enrichment processing paused; durable checkpoints were retained.',carrier},{status:503})}}
