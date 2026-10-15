import {z} from 'zod';
import {sql} from 'drizzle-orm';
import {getDb} from '../../../db';
import {getChatGPTUser} from '../../chatgpt-auth';
import {ownerAccountId} from '../../../lib/owner';
import {coverStorageStatus,revokeCoverProvider} from '../../../lib/cover-cache';
import {privateJson,readObject} from '../../../lib/api-security';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(){try{const user=await getChatGPTUser();if(user?.userId!==ownerAccountId)return privateJson({error:'Owner access required.'},403);const db=getDb();const [providers,covers,queue,values,usage,pulse,scanner,ai,metrics]=await Promise.all([
 db.execute(sql`SELECT provider,enabled,access_allowed,cache_allowed,display_allowed,ai_allowed,valuation_allowed,valid_until,revoked_at FROM ch_web.source_permissions`),
 db.execute(sql`SELECT status,count(*)::int AS count FROM ch_web.cover_cache GROUP BY status`),
 db.execute(sql`SELECT kind,status,count(*)::int AS count,min(created_at) AS oldest FROM ch_web.enrichment_jobs GROUP BY kind,status`),
 db.execute(sql`SELECT status,count(*)::int AS count FROM ch_web.valuation_targets GROUP BY status`),
 db.execute(sql`SELECT purpose,outcome,count(*)::int AS calls,sum(reserved_cents)::int AS reserved_cents,sum(input_tokens)::int AS input_tokens,sum(output_tokens)::int AS output_tokens,round(avg(latency_ms))::int AS average_latency_ms FROM ch_web.enrichment_ai_usage WHERE created_at>=date_trunc('day',now()) GROUP BY purpose,outcome`),
 db.execute(sql`SELECT id,created_at,expires_at,ai_status FROM ch_web.market_pulse_snapshots ORDER BY created_at DESC LIMIT 1`),
 db.execute(sql`SELECT result,count(*)::int AS count FROM ch_web.scanner_outcomes WHERE created_at>=now()-interval '30 days' GROUP BY result`),Promise.resolve({available:false,reason:'AI features are deferred for launch.'})
 ,db.execute(sql`SELECT name,count FROM ch_web.enrichment_metrics WHERE day=CURRENT_DATE`)]);return privateJson({cacheMetrics:metrics.rows,providers:providers.rows,covers:covers.rows,queue:queue.rows,valuations:values.rows,usage:usage.rows,pulse:pulse.rows[0]||null,scanner:scanner.rows,ai,model:null,storage:{ready:coverStorageStatus().ready,reason:coverStorageStatus().reason},externalEvidence:{configured:!!(process.env.COMICHUDDLE_EXTERNAL_COMPS_URL&&process.env.COMICHUDDLE_EXTERNAL_COMPS_TOKEN),reason:'A configured feed also needs a current, reviewed source permission record.'},budget:{dailyCapCents:Number(process.env.ENRICHMENT_AI_DAILY_CAP_CENTS||100),note:'Reservation cap, not a provider invoice.'}})}catch{return privateJson({error:'Enrichment diagnostics could not connect.'},503)}}
export async function POST(request:Request){try{if(request.headers.get('origin')!==new URL(request.url).origin)return privateJson({error:'Origin rejected.'},403);const user=await getChatGPTUser();if(user?.userId!==ownerAccountId)return privateJson({error:'Owner access required.'},403);const raw=await readObject(request,30000),db=getDb();
 if(raw.action==='revoke_source'){const input=z.object({action:z.literal('revoke_source'),provider:z.string().min(1).max(60)}).strict().parse(raw);await revokeCoverProvider(db,input.provider);return privateJson({saved:true,note:'Source disabled immediately. Purge is checkpointed in the durable worker.'})}
 return privateJson({error:'Permission grants and reviewed evidence must be configured through the documented operator intake, not inferred from an API token.'},400);
 }catch{return privateJson({error:'The source change could not be confirmed.'},503)}}
