import type {CatalogDb} from './catalog-store';
import {claimEnrichment,finishEnrichment,retryDelay,type EnrichmentKind} from './enrichment-jobs';
import {processValuationJob} from './estimated-fmv';
import {processCoverJob} from './cover-cache';
import {processPulseJob} from './market-pulse-snapshot';
export async function drainEnrichment(db:CatalogDb,kinds:EnrichmentKind[]=['valuation','pulse','cover'],maxJobs=6,maxMilliseconds=45000){
 const started=Date.now();let processed=0;
 for(const kind of kinds){while(processed<maxJobs&&Date.now()-started<maxMilliseconds){const job=await claimEnrichment(db,kind);if(!job)break;try{if(kind==='valuation')await processValuationJob(db,job);else if(kind==='cover')await processCoverJob(db,job);else await processPulseJob(db,job)}catch{await finishEnrichment(db,job,job.attempts>=5?'FAILED':'PENDING','worker_operation_failed',retryDelay(job.attempts))}processed++;if(kind==='cover')break}}
 return {processed,elapsedMs:Date.now()-started};
}
