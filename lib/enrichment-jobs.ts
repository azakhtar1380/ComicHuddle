import {randomUUID} from 'node:crypto';
import {sql} from 'drizzle-orm';
import type {CatalogDb} from './catalog-store';
export type EnrichmentKind='cover'|'valuation'|'pulse';
export type EnrichmentJob={id:string;kind:EnrichmentKind;job_key:string;payload:Record<string,unknown>;attempts:number;lease_token:string};
export async function enqueueEnrichment(db:CatalogDb,kind:EnrichmentKind,key:string,payload:Record<string,unknown>){
 if(kind!=='cover')return;
 await db.execute(sql`INSERT INTO ch_web.enrichment_jobs(id,kind,job_key,payload) VALUES(${randomUUID()}::uuid,${kind},${key},${JSON.stringify(payload)}::jsonb)
 ON CONFLICT(kind,job_key) DO UPDATE SET status='PENDING',payload=excluded.payload,available_at=now(),attempts=0,last_error_code=NULL,updated_at=now()
 WHERE enrichment_jobs.status IN ('DONE','DISABLED') AND enrichment_jobs.updated_at<now()-interval '5 minutes'`);
}
export async function claimEnrichment(db:CatalogDb,kind:EnrichmentKind):Promise<EnrichmentJob|null>{
 if(kind!=='cover')return null;
 await db.execute(sql`UPDATE ch_web.enrichment_jobs SET status='FAILED',last_error_code='lease_recovery_exhausted',updated_at=now() WHERE kind=${kind} AND status='PROCESSING' AND attempts>=5 AND lease_expires_at<now()`);
 const lease=randomUUID();const rows=await db.execute(sql`WITH due AS (SELECT id FROM ch_web.enrichment_jobs
  WHERE kind=${kind} AND attempts<5 AND available_at<=now() AND (status='PENDING' OR status='PROCESSING' AND lease_expires_at<now())
  ORDER BY available_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1)
 UPDATE ch_web.enrichment_jobs j SET status='PROCESSING',attempts=attempts+1,lease_token=${lease}::uuid,lease_expires_at=now()+interval '2 minutes',updated_at=now()
 FROM due WHERE j.id=due.id RETURNING j.*`);
 return rows.rows[0] as unknown as EnrichmentJob||null;
}
export async function finishEnrichment(db:CatalogDb,job:EnrichmentJob,status:'DONE'|'FAILED'|'BLOCKED'|'DISABLED'|'PENDING',code:string|null=null,retrySeconds=60){
 const quotaWait=status==='PENDING'&&['provider_wait','cdn_wait','source_rate_limited'].includes(code||'');
 await db.execute(sql`UPDATE ch_web.enrichment_jobs SET status=${job.attempts>=5&&status==='PENDING'&&!quotaWait?'FAILED':status},attempts=GREATEST(0,attempts-${quotaWait?1:0}),last_error_code=${code},available_at=now()+${Math.max(1,Math.min(retrySeconds,86400))}*interval '1 second',lease_expires_at=NULL,updated_at=now()
 WHERE id=${job.id}::uuid AND lease_token=${job.lease_token}::uuid`);
}
export function retryDelay(attempt:number,retryAfter:string|null=null,now=Date.now(),random=Math.random){
 const supplied=retryAfter?(/^\d+(\.\d+)?$/.test(retryAfter)?Number(retryAfter):Math.max(0,(Date.parse(retryAfter)-now)/1000)):0;
 return Math.min(86400,Math.ceil(Math.max(Number.isFinite(supplied)?supplied:0,Math.min(3600,15*2**Math.max(0,attempt-1))*(.8+random()*.4))));
}
export async function providerTurn(db:CatalogDb,provider:string,spacingSeconds:number){
 const result=await db.execute(sql`INSERT INTO ch_web.enrichment_provider_limits(provider,next_request_at) VALUES(${provider},now()+${spacingSeconds}*interval '1 second')
 ON CONFLICT(provider) DO UPDATE SET next_request_at=now()+${spacingSeconds}*interval '1 second',updated_at=now()
 WHERE enrichment_provider_limits.next_request_at<=now() AND (enrichment_provider_limits.blocked_until IS NULL OR enrichment_provider_limits.blocked_until<=now()) RETURNING provider`);
 return result.rows.length>0;
}
