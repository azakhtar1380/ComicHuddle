import {createHash,randomUUID} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {z} from 'zod';
import {estimateConditionSchema} from './estimate-condition';
import {catalogIssuesById,type CatalogDb} from './catalog-store';
import type {Issue} from './catalog';
import {listingDirectoryId} from './shared-catalog';
import type {ListingItem} from './community';
import {combineEstimates,estimateRequestKey,unavailableEstimate,type EstimateRequest,type EstimateSnapshot,type EstimateTarget,type CombinedEstimate} from './estimated-fmv-types';
import {enqueueEnrichment,type EnrichmentJob,finishEnrichment,retryDelay} from './enrichment-jobs';
import {ingestExternalEvidence} from './external-valuation-evidence';
import {structuredAi,EnrichmentAiError} from './enrichment-ai';

export const estimateRequestSchema=z.object({issueId:z.number().int().min(0).max(6500000000),condition:estimateConditionSchema.optional(),reference:z.boolean().optional()}).strict();
const stable=(value:unknown):string=>Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable((value as Record<string,unknown>)[key])).join(',')+'}':JSON.stringify(value);
const hash=(value:unknown)=>createHash('sha256').update(stable(value)).digest('hex');
export function canonicalEstimateTarget(issue:Issue,request:EstimateRequest):EstimateTarget{
 const condition=request.reference?(request.condition||{mode:'Raw' as const,grade:'8.0',label:'Raw',printing:'Catalog edition',language:'Catalog language'}):request.condition;
 // Certification serials identify a physical copy but are not monetary anchors.
 const safe=condition?{mode:condition.mode,grade:condition.grade,label:condition.label,printing:condition.printing,language:condition.language||'Catalog language',signatureStatus:condition.signatureStatus||'Not recorded',restorationStatus:condition.restorationStatus||'Not recorded'}:undefined;
 return {...request,condition:safe,title:issue.title,number:issue.number,year:issue.year,publisher:issue.publisher,variant:issue.variant||'Edition not recorded',language:safe?.language||'Catalog language',conditionLabel:request.reference?(safe?.mode==='Raw'&&safe.grade==='8.0'?'Reference: Raw Very Fine':'Reference: '+safe?.mode+' '+safe?.grade):safe?safe.mode+' '+safe.grade+' · '+safe.label+' · '+safe.printing+(safe.mode==='Raw'?' · seller-assessed':' · seller-declared'):'Condition not recorded'};
}
export const valuationTargetKey=(target:EstimateTarget)=>hash([target.issueId,target.year,target.variant,target.language,target.condition?.mode,target.condition?.grade,target.condition?.label,target.condition?.printing,target.condition?.signatureStatus,target.condition?.restorationStatus]);
export function targetHasDetails(target:EstimateTarget){return !!target.condition&&!!target.condition.grade&&target.condition.grade!=='Unspecified'&&!!target.condition.label&&!!target.condition.printing&&!/^(unspecified|later printing)$/i.test(target.condition.printing)}
type SnapshotRow={id:string;target_key:string;target:EstimateTarget;status:EstimateSnapshot['status'];low_cents:number|null;high_cents:number|null;evidence_kind:EstimateSnapshot['evidenceKind'];sample_count:number;independent_count:number;calculated_at:Date;expires_at:Date;evidence_oldest_at:Date|null;evidence_newest_at:Date|null;model:string|null;methodology:string;explanation:string;assumptions:string[];evidence:{sources?:{label:string;url?:string}[];providers?:string[]}};
function dto(row:SnapshotRow):EstimateSnapshot{return {id:row.id,targetKey:row.target_key,target:row.target,status:row.status,lowCents:row.low_cents===null?null:Number(row.low_cents),highCents:row.high_cents===null?null:Number(row.high_cents),currency:'USD',evidenceKind:row.evidence_kind,sampleCount:row.sample_count,independentCount:row.independent_count,calculatedAt:new Date(row.calculated_at).toISOString(),expiresAt:new Date(row.expires_at).toISOString(),evidenceOldestAt:row.evidence_oldest_at?new Date(row.evidence_oldest_at).toISOString():null,evidenceNewestAt:row.evidence_newest_at?new Date(row.evidence_newest_at).toISOString():null,model:row.model,methodology:row.methodology,explanation:row.explanation,assumptions:row.assumptions,sources:row.evidence.sources||[]}}
export async function readEstimates(db:CatalogDb,requests:EstimateRequest[],queue=true):Promise<EstimateSnapshot[]>{
 const detailed=(request:EstimateRequest)=>request.reference||!!(request.condition?.mode&&request.condition.grade&&request.condition.printing);
 const ids=[...new Set(requests.filter(detailed).map(r=>r.issueId))],issues=new Map<number,Issue>();
 for(let i=0;i<ids.length;i+=100)for(const issue of await catalogIssuesById(db,ids.slice(i,i+100)))issues.set(issue.id,issue);
 const targets=requests.map(request=>{const issue=issues.get(request.issueId);return issue?canonicalEstimateTarget(issue,request):null}),keys=targets.filter((t):t is EstimateTarget=>!!t).map(valuationTargetKey);
 const found=keys.length?await db.execute(sql`SELECT s.* FROM ch_web.valuation_targets t JOIN ch_web.valuation_snapshots s ON s.id=t.snapshot_id WHERE t.target_key IN (${sql.join(keys.map(k=>sql`${k}`),sql`,`)})`):{rows:[]};
 const rows=new Map((found.rows as unknown as SnapshotRow[]).map(row=>[row.target_key,row]));
 const permissions=await db.execute(sql`SELECT provider FROM ch_web.source_permissions WHERE enabled AND ai_allowed AND valuation_allowed AND display_allowed AND revoked_at IS NULL AND valid_until>now()`),allowed=new Set(permissions.rows.map(r=>String(r.provider)));
 const pending=new Map<string,EstimateTarget>();
 const result=targets.map((target,index)=>{
  if(!target)return unavailableEstimate(requests[index],'awaiting_details',detailed(requests[index])?'Choose an existing directory edition.':'Record this copy’s condition and printing. No catalog reference grade is silently applied.');
  const key=valuationTargetKey(target);if(!targetHasDetails(target))return {...unavailableEstimate(requests[index]),target,targetKey:key};
  const row=rows.get(key),permitted=row&&(row.evidence.providers||[]).every(provider=>allowed.has(provider));
  if(row&&permitted&&Date.parse(String(row.expires_at))>Date.now())return dto(row);
  if(queue)pending.set(key,target);
  if(row&&permitted&&row.status==='available'&&Date.parse(String(row.expires_at))+3600000>Date.now())return {...dto(row),status:'refreshing' as const};
  return {...unavailableEstimate(requests[index],queue&&allowed.size?'queued':'insufficient_evidence',queue&&allowed.size?'The shared estimate is queued automatically. You can continue without waiting.':'Not enough pricing evidence yet. No numerical price was generated.'),target,targetKey:key};
 });
 if(pending.size){const entries=[...pending];await db.execute(sql`INSERT INTO ch_web.enrichment_catalog_refs(issue_id,source_provider,source_id) VALUES ${sql.join([...new Map(entries.map(([,t])=>[t.issueId,t])).values()].map(t=>sql`(${t.issueId},'Directory',NULL)`),sql`, `)} ON CONFLICT DO NOTHING`);
  for(const [key,target] of entries){await db.execute(sql`INSERT INTO ch_web.valuation_targets(target_key,issue_id,target,status) VALUES(${key},${target.issueId},${JSON.stringify(target)}::jsonb,'queued') ON CONFLICT(target_key) DO NOTHING`);await enqueueEnrichment(db,'valuation',key,{target})}
 }
 return result;
}
export type ValuationEvidence={id:string;kind:'sale'|'reviewed_baseline';low:number;high:number;observedAt:string;entity:string;provider:string;reference:string;reliability?:'confirmed_paid'|'published_auction_result';url?:string};
export function evidenceRange(evidence:ValuationEvidence[],now=Date.now()){
 const unique=[...new Map(evidence.map(row=>[row.id,row])).values()].filter(row=>Number.isSafeInteger(row.low)&&Number.isSafeInteger(row.high)&&row.low>0&&row.high>=row.low&&Date.parse(row.observedAt)<=now);
 let sales=unique.filter(row=>row.kind==='sale'&&now-Date.parse(row.observedAt)<=90*86400000);const entities=new Set(sales.map(row=>row.entity));
 if(sales.length>=5&&entities.size>=3&&sales.some(row=>now-Date.parse(row.observedAt)<=30*86400000)){
  if(sales.some(row=>sales.filter(other=>other.entity===row.entity).length/sales.length>.4))return null;
  const prices=sales.map(row=>row.low).sort((a,b)=>a-b),median=prices[Math.floor(prices.length/2)],deviations=prices.map(p=>Math.abs(Math.log(p/median))).sort((a,b)=>a-b),mad=deviations[Math.floor(deviations.length/2)];
  if(sales.length>=9&&mad>0)sales=sales.filter(row=>Math.abs(Math.log(row.low/median))<=3*1.4826*mad);
  if(sales.length<5||new Set(sales.map(row=>row.entity)).size<3||sales.some(row=>sales.filter(other=>other.entity===row.entity).length/sales.length>.4))return null;
  const weighted=sales.map(row=>({row,weight:2**(-Math.max(0,now-Date.parse(row.observedAt))/(30*86400000))*(row.reliability==='published_auction_result'?.7:1)})).sort((a,b)=>a.row.low-b.row.low),totalWeight=weighted.reduce((sum,r)=>sum+r.weight,0);
  const quantile=(p:number)=>{let weight=0;for(const entry of weighted){weight+=entry.weight;if(weight>=totalWeight*p)return entry.row.low}return weighted.at(-1)!.row.low};
  return {low:quantile(.25),high:quantile(.75),rows:sales,kind:sales.every(row=>row.reliability!=='published_auction_result')?'sales' as const:'comparable' as const};
 }
 const anchors=unique.filter(row=>row.kind==='reviewed_baseline'&&now-Date.parse(row.observedAt)<=30*86400000);return anchors.length?{low:Math.min(...anchors.map(r=>r.low)),high:Math.max(...anchors.map(r=>r.high)),rows:anchors,kind:'baseline' as const}:null;
}
export async function processValuationJob(db:CatalogDb,job:EnrichmentJob){
 const target=job.payload.target as EstimateTarget,key=valuationTargetKey(target);let status:EstimateSnapshot['status']='insufficient_evidence',explanation='Insufficient eligible evidence for this exact edition and condition. No numerical price was generated.',model:string|null=null,range:ReturnType<typeof evidenceRange>=null;
 try{
  await ingestExternalEvidence(db,target,key);
  const found=await db.execute(sql`SELECT o.* FROM ch_web.valuation_observations o JOIN ch_web.source_permissions p ON p.provider=o.source_provider WHERE o.target_key=${key} AND o.eligible AND o.original_observation AND o.reviewed_at IS NOT NULL AND o.expires_at>now() AND p.enabled AND p.display_allowed AND p.ai_allowed AND p.valuation_allowed AND p.revoked_at IS NULL AND p.valid_until>now() ORDER BY o.observed_at DESC LIMIT 100`);
  const observations:ValuationEvidence[]=found.rows.map(r=>({id:String(r.id),kind:r.kind as ValuationEvidence['kind'],low:Number(r.low_cents),high:Number(r.high_cents),observedAt:new Date(String(r.observed_at)).toISOString(),entity:String(r.independent_entity_key),provider:String(r.source_provider),reference:String(r.evidence_reference),reliability:(r.details as {status?:ValuationEvidence['reliability']})?.status,...(r.source_url?{url:String(r.source_url)}:{})}));
  // Current platform orders are sandbox-only. Never promote them to pricing
  // evidence. Future live intake must record verified settlement, delivery,
  // disputes, refunds and participant independence before this table admits it.
  const eligible=evidenceRange(observations);
  if(eligible){
   const schema={type:'object',properties:{includedEvidenceIds:{type:'array',items:{type:'string'}},summary:{type:'string'},assumptions:{type:'array',items:{type:'string'}}},required:['includedEvidenceIds','summary','assumptions'],additionalProperties:false};
   const response=await structuredAi<{includedEvidenceIds:string[];summary:string;assumptions:string[]}>(db,'valuation',schema,'Assess only the supplied exact-edition evidence. Do not estimate from memory, use the asking price, invent transactions, mention endorsement, or claim authenticity. Return the IDs of relevant supplied observations. Explain their limitations without monetary numbers, dates or unsupported causal claims. Baselines are reviewed assumptions, not sales.',{target,evidence:eligible.rows.map(({entity,...row})=>row)});
   const parsed=z.object({includedEvidenceIds:z.array(z.string()).min(1).max(100),summary:z.string().max(600).refine(s=>!/[0-9]/.test(s)),assumptions:z.array(z.string().max(250).refine(s=>!/[0-9]/.test(s))).max(6)}).parse(response.value);
   if(parsed.includedEvidenceIds.some(id=>!eligible.rows.some(row=>row.id===id)))throw new EnrichmentAiError('ai_unknown_evidence');
   range=evidenceRange(eligible.rows.filter(row=>parsed.includedEvidenceIds.includes(row.id)));if(range){status='available';model=response.model;explanation=parsed.summary}
  }
 }catch(error){status='service_failure';explanation=error instanceof EnrichmentAiError?'AI valuation could not run: '+error.code.replaceAll('_',' ')+'. Your listing can still be saved.':'Valuation processing could not finish. Your listing can still be saved.';
  if(error instanceof EnrichmentAiError&&error.retryable&&job.attempts<3){await finishEnrichment(db,job,'PENDING',error.code,retryDelay(job.attempts));return}
 }
 const id=randomUUID(),rows=range?.rows||[],dates=rows.map(r=>r.observedAt).sort(),ttl=status==='available'?86400:status==='service_failure'?900:21600;
 await db.execute(sql`INSERT INTO ch_web.valuation_snapshots(id,target_key,target,status,low_cents,high_cents,evidence,evidence_kind,sample_count,independent_count,evidence_oldest_at,evidence_newest_at,expires_at,model,methodology,explanation,assumptions)
 VALUES(${id}::uuid,${key},${JSON.stringify(target)}::jsonb,${status},${range?.low??null},${range?.high??null},${JSON.stringify({ids:rows.map(r=>r.id),providers:[...new Set(rows.map(r=>r.provider))],sources:rows.map(r=>({label:r.provider,...(r.url?{url:r.url}:{})}))})}::jsonb,${range?.kind||'none'},${range&&range.kind!=='baseline'?rows.length:0},${new Set(rows.map(r=>r.entity)).size},${dates[0]||null}::timestamptz,${dates.at(-1)||null}::timestamptz,now()+${ttl}*interval '1 second',${model},'evidence-range-v1',${explanation},${JSON.stringify(['Exact directory edition and declared condition only.','Raw condition is seller-assessed.','No asking price is used as an estimate anchor.'])}::jsonb)`);
 await db.execute(sql`UPDATE ch_web.valuation_targets SET snapshot_id=${id}::uuid,status=${status},next_refresh_at=now()+${ttl}*interval '1 second',updated_at=now() WHERE target_key=${key}`);await finishEnrichment(db,job,'DONE');
}
export function itemEstimateRequest(item:ListingItem):EstimateRequest|null{const id=listingDirectoryId(item);return id===null?null:{issueId:id,...(item.condition?{condition:item.condition}:{})}}
export async function combinedListingEstimate(db:CatalogDb,items:ListingItem[],queue=false):Promise<CombinedEstimate>{
 const grouped=new Map<string,{item:ListingItem;request:EstimateRequest|null;quantity:number}>();
 for(const item of items){const request=itemEstimateRequest(item),key=JSON.stringify([request,item.grade]);const found=grouped.get(key);if(found)found.quantity++;else grouped.set(key,{item,request,quantity:1})}
 const entries=[...grouped.values()],requests=entries.flatMap(row=>row.request?[row.request]:[]),quotes=await readEstimates(db,requests,queue);let offset=0;
 const components=entries.map(row=>({id:row.item.id,title:row.item.title+' '+row.item.issue,quantity:row.quantity,request:row.request,snapshot:row.request?quotes[offset++]:unavailableEstimate(null)})),version=hash(items.map(i=>[i.id,listingDirectoryId(i),i.condition||null]));
 const result=combineEstimates(components,version);
 // All surfaces resolve the same composition and target snapshots. Arithmetic
 // never depends on buyer identity or a separate per-surface model invocation.
 await db.execute(sql`INSERT INTO ch_web.listing_estimates(composition_version,snapshot) VALUES(${version},${JSON.stringify(result)}::jsonb) ON CONFLICT(composition_version) DO UPDATE SET snapshot=excluded.snapshot,updated_at=now()`);
 return result;
}
