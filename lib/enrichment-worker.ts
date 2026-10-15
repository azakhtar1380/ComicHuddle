import type {CatalogDb} from './catalog-store';
import {claimEnrichment,finishEnrichment,retryDelay,type EnrichmentKind} from './enrichment-jobs';
import {processCoverJob} from './cover-cache';
/** Launch workers process images only. Financial events use their own services. */
export async function drainEnrichment(db:CatalogDb,kinds:EnrichmentKind[]=['cover'],maxJobs=6,maxMilliseconds=45000){
 const started=Date.now();let processed=0;
 if(!kinds.includes('cover'))return {processed,elapsedMs:0};
 while(processed<maxJobs&&Date.now()-started<maxMilliseconds){const job=await claimEnrichment(db,'cover');if(!job)break;try{await processCoverJob(db,job)}catch{await finishEnrichment(db,job,job.attempts>=5?'FAILED':'PENDING','worker_operation_failed',retryDelay(job.attempts))}processed++;break}
 return {processed,elapsedMs:Date.now()-started};
}
