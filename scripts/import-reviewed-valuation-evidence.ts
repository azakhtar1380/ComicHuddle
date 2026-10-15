/** Operator intake for genuinely reviewed ORIGINAL sale observations or pricing
 * benchmarks. This is not a scraper, an asking-price import or AI price seed. */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {sql} from 'drizzle-orm';
import {getDb} from '../db';
import {getPool} from '../db/postgres';
import {catalogIssue} from '../lib/catalog-store';
import {estimateRequestSchema,canonicalEstimateTarget,valuationTargetKey,targetHasDetails} from '../lib/estimated-fmv';
const schema=z.object({provider:z.string().min(1).max(60),reviewedOriginalEvidence:z.literal(true),observations:z.array(z.object({originalId:z.string().min(1).max(200),request:estimateRequestSchema,kind:z.enum(['sale','reviewed_baseline']),lowCents:z.number().int().positive().max(10000000000),highCents:z.number().int().positive().max(10000000000),originalSourceUrl:z.string().url(),originalEntityKey:z.string().min(5).max(200),observedAt:z.string().datetime(),evidenceReference:z.string().min(10).max(1000),expiresAt:z.string().datetime(),saleStatus:z.enum(['confirmed_paid','published_auction_result']).optional(),actualAmountKnown:z.boolean().optional(),priceBasis:z.literal('item_only'),independenceReviewed:z.literal(true)}).strict()).min(1).max(500)}).strict();
const file=process.argv[2];if(!file)throw Error('Provide reviewed original evidence JSON; never model-generated prices.');
const input=schema.parse(JSON.parse(await readFile(file,'utf8'))),db=getDb(),pool=getPool();
try{
 const grants=await db.execute(sql`SELECT * FROM ch_web.source_permissions WHERE provider=${input.provider} AND enabled AND access_allowed AND cache_allowed AND display_allowed AND ai_allowed AND valuation_allowed AND revoked_at IS NULL AND valid_until>now()`),grant=grants.rows[0];if(!grant)throw Error('A current reviewed access, retention, display, AI and valuation grant is required.');
 let imported=0;for(const observation of input.observations){
  const issue=await catalogIssue(db,observation.request.issueId);if(!issue)throw Error('An original observation references a missing directory issue.');const target=canonicalEstimateTarget(issue,observation.request);if(!targetHasDetails(target))throw Error('Exact edition and condition are required.');
  const original=new URL(observation.originalSourceUrl);if(original.protocol!=='https:'||original.username||original.password||!(grant.approved_hosts as string[]).includes(original.hostname))throw Error('The original source host is not approved.');
  if(observation.highCents<observation.lowCents||Date.parse(observation.observedAt)>Date.now()||Date.parse(observation.expiresAt)<=Date.now()||observation.kind==='sale'&&(!observation.saleStatus||!observation.actualAmountKnown||observation.lowCents!==observation.highCents))throw Error('Invalid or unconfirmed original monetary observation.');
  const id=createHash('sha256').update(original.origin+':'+observation.originalId).digest('hex'),entity=createHash('sha256').update(original.origin+':'+observation.originalEntityKey).digest('hex'),key=valuationTargetKey(target);
  const result=await db.execute(sql`INSERT INTO ch_web.valuation_observations(id,target_key,source_provider,kind,low_cents,high_cents,currency,observed_at,independent_entity_key,source_url,evidence_reference,eligible,original_observation,reviewed_at,expires_at,details)
   VALUES(${id},${key},${input.provider},${observation.kind},${observation.lowCents},${observation.highCents},'USD',${observation.observedAt}::timestamptz,${entity},${observation.originalSourceUrl},${observation.evidenceReference},true,true,now(),LEAST(${observation.expiresAt}::timestamptz,${new Date(String(grant.valid_until)).toISOString()}::timestamptz,now()+interval '30 days'),${JSON.stringify({status:observation.saleStatus||'reviewed_benchmark',priceBasis:'item_only'})}::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id`);imported+=result.rows.length;
 }
 console.log('Reviewed original evidence imported: '+imported+'. No model or web research was run by this intake.');
}finally{await pool.end()}
