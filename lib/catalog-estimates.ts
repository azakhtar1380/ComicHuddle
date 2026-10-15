import {sql} from 'drizzle-orm';
import type {CatalogDb} from './catalog-store';
import type {Issue} from './catalog';
import type {EstimateSnapshot,EstimateTarget} from './estimated-fmv-types';
/** Existing eligible reference snapshots travel with catalog card data. This
 * read never performs AI, outside research or an HTTP request. */
export async function withCatalogEstimates(db:CatalogDb,issues:Issue[]):Promise<Issue[]>{
 if(!issues.length)return issues;
 try{const found=await db.execute(sql`SELECT DISTINCT ON(t.issue_id) t.issue_id,s.* FROM ch_web.valuation_targets t JOIN ch_web.valuation_snapshots s ON s.id=t.snapshot_id
 WHERE t.issue_id IN (${sql.join(issues.map(i=>sql`${i.id}`),sql`,`)}) AND s.target->>'reference'='true' AND s.target->'condition'->>'mode'='Raw' AND s.target->'condition'->>'grade'='8.0' AND s.expires_at>now()
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(COALESCE(s.evidence->'providers','[]'::jsonb)) source WHERE NOT EXISTS(SELECT 1 FROM ch_web.source_permissions p WHERE p.provider=source.value AND p.enabled AND p.ai_allowed AND p.valuation_allowed AND p.display_allowed AND p.revoked_at IS NULL AND p.valid_until>now())) ORDER BY t.issue_id,s.calculated_at DESC`);
 const byId=new Map(found.rows.map(row=>[Number(row.issue_id),row]));
 return issues.map(issue=>{const row=byId.get(issue.id);if(!row)return issue;const target=row.target as EstimateTarget;if(target.year!==issue.year||target.variant!==(issue.variant||'Edition not recorded'))return issue;
  const estimate:EstimateSnapshot={id:String(row.id),targetKey:String(row.target_key),target,status:row.status as EstimateSnapshot['status'],lowCents:row.low_cents===null?null:Number(row.low_cents),highCents:row.high_cents===null?null:Number(row.high_cents),currency:'USD',evidenceKind:row.evidence_kind as EstimateSnapshot['evidenceKind'],sampleCount:Number(row.sample_count),independentCount:Number(row.independent_count),calculatedAt:new Date(String(row.calculated_at)).toISOString(),expiresAt:new Date(String(row.expires_at)).toISOString(),evidenceOldestAt:row.evidence_oldest_at?new Date(String(row.evidence_oldest_at)).toISOString():null,evidenceNewestAt:row.evidence_newest_at?new Date(String(row.evidence_newest_at)).toISOString():null,model:row.model?String(row.model):null,methodology:String(row.methodology),explanation:String(row.explanation),assumptions:row.assumptions as string[],sources:(row.evidence as {sources?:EstimateSnapshot['sources']}).sources||[]};return {...issue,estimatedValue:estimate};
 });
 }catch{return issues}
}
