import {and,eq,inArray,sql} from 'drizzle-orm';
import {catalogGcdBulkBatches,catalogGcdBulkRuns,catalogIssues,catalogSync} from '../db/schema';
import {seedStarterStatements,type CatalogDb} from './catalog-store';
import {ApiRequestError} from './api-security';
import {conditionalGuard,operationGuardFailed} from './operation-guard';
import {gcdRecordStatements,normalizeGcdIssue} from './gcd-catalog';
import {withGcdCatalogLease} from './gcd-sync';
import {GCD_BULK_BOUNDS,GCD_EMPTY_CHAIN,appendGcdRecordChain,canonicalJson,isSha256,sanitizeGcdBulkRecord,sha256,validateGcdBulkManifest} from './gcd-bulk-format';

function validId(id:unknown):asserts id is string{if(!isSha256(id))throw new ApiRequestError('Use the exact GCD import manifest ID.',400)}
async function runFor(db:CatalogDb,id:string){validId(id);const [run]=await db.select().from(catalogGcdBulkRuns).where(eq(catalogGcdBulkRuns.id,id));if(!run)throw new ApiRequestError('GCD bulk import not found.',404);return run}
function status(run:typeof catalogGcdBulkRuns.$inferSelect){return {importId:run.id,stage:run.stage,manifest:JSON.parse(run.manifest),expectedRecords:run.expectedRecords,acceptedRecords:run.acceptedRecords,writtenRecords:run.writtenRecords,retainedNewerRecords:run.retainedNewerRecords,retentionPolicy:'Stored timestamps equal to or later than the source snapshot are retained.',nextBatch:run.nextBatch,lastProviderId:run.lastProviderId,recordChainSha256:run.recordChainSha256,createdAt:run.createdAt,finishedAt:run.finishedAt,historicalCoverageComplete:false,artworkImported:false,valuationImported:false,sourceVerification:'Operator-provided authorized export; upstream completeness is not independently certified.'}}
export async function getGcdBulkStatus(db:CatalogDb,id:string){return status(await runFor(db,id))}
const leaseCondition=(lease:string,now:number)=>sql`EXISTS (SELECT 1 FROM ${catalogSync} WHERE ${catalogSync.id}='gcd' AND ${catalogSync.leaseId}=${lease} AND ${catalogSync.leaseUntil}>=${now})`;
async function guarded(db:CatalogDb,condition:ReturnType<typeof leaseCondition>,writes:unknown[]){const guard=conditionalGuard(db,condition);try{await db.batch([guard.start,...writes,guard.finish] as never)}catch(error){if(operationGuardFailed(error))throw new ApiRequestError('GCD import state changed. Retry the exact batch.',409);throw error}}
export async function startGcdBulk(db:CatalogDb,input:unknown,now=Date.now()){
 const manifest=validateGcdBulkManifest(input,now),serialized=canonicalJson(manifest),id=await sha256(serialized);
 const [existing]=await db.select().from(catalogGcdBulkRuns).where(eq(catalogGcdBulkRuns.id,id));if(existing)return {...status(existing),replayed:true};
 return withGcdCatalogLease(db,now,async lease=>{
  await guarded(db,leaseCondition(lease,now),[...seedStarterStatements(db,new Date(now).toISOString()),db.insert(catalogGcdBulkRuns).values({id,manifest:serialized,expectedRecords:manifest.expectedRecords,recordChainSha256:GCD_EMPTY_CHAIN,createdAt:new Date(now).toISOString()}).onConflictDoNothing()]);
  return {...await getGcdBulkStatus(db,id),replayed:false};
 });
}
export async function ingestGcdBulkBatch(db:CatalogDb,id:string,batchIndex:unknown,input:unknown,now=Date.now()){
 validId(id);if(!Number.isSafeInteger(batchIndex)||Number(batchIndex)<0||Number(batchIndex)>GCD_BULK_BOUNDS.expectedRecords||!Array.isArray(input)||input.length<1||input.length>GCD_BULK_BOUNDS.records)throw new ApiRequestError('Use an ordered batch of 1–8 GCD issues.',400);
 const index=Number(batchIndex),initial=await runFor(db,id),manifest=validateGcdBulkManifest(JSON.parse(initial.manifest),now);
 const records=input.map(raw=>sanitizeGcdBulkRecord(raw,manifest.snapshotAt)),normalized=records.map(raw=>normalizeGcdIssue(raw,manifest.snapshotAt));
 const ids=normalized.map(n=>n.issue.gcdId!),directoryIds=normalized.map(n=>n.issue.id);
 if(ids.some((v,i)=>i>0&&v<=ids[i-1]))throw new ApiRequestError('GCD export IDs must be unique and sorted ascending.',400);
 const contentSha256=await sha256(canonicalJson(records));
 return withGcdCatalogLease(db,now,async lease=>{
  const run=await runFor(db,id),[receipt]=await db.select().from(catalogGcdBulkBatches).where(and(eq(catalogGcdBulkBatches.importId,id),eq(catalogGcdBulkBatches.batchIndex,index)));
  if(receipt){if(receipt.contentSha256!==contentSha256)throw new ApiRequestError('This batch index already has different committed content.',409);return {...status(run),receipt,replayed:true}}
  if(run.stage!=='OPEN'||index!==run.nextBatch||ids[0]<=run.lastProviderId||run.acceptedRecords+records.length>run.expectedRecords)throw new ApiRequestError('The bulk import is closed, out of order or exceeds its declared unique count.',409);
  const stored=await db.select({id:catalogIssues.id,gcdId:catalogIssues.gcdId,metronId:catalogIssues.metronId,fetchedAt:catalogIssues.fetchedAt}).from(catalogIssues).where(inArray(catalogIssues.id,directoryIds));
  if(stored.some(r=>r.metronId!==null||r.gcdId!==r.id-4_000_000_000))throw new ApiRequestError('A stored directory identity conflicts with this GCD export.',409);
  const newer=new Set(stored.filter(r=>r.fetchedAt>=manifest.snapshotAt).map(r=>r.id));
  let chain=run.recordChainSha256;for(const record of records)chain=await appendGcdRecordChain(chain,record);
  const written=records.length-newer.size,last=ids[ids.length-1],stamp=new Date(now).toISOString();
  const writes:unknown[]=[];for(const record of normalized){record.rawMetadata=canonicalJson({...JSON.parse(record.rawMetadata),bulkProvenance:{importId:id,sourceSha256:manifest.sourceSha256,exportSha256:manifest.exportSha256,snapshotAt:manifest.snapshotAt,receivedAt:stamp}});writes.push(...gcdRecordStatements(db,record,true))}
  const receiptRow={importId:id,batchIndex:index,contentSha256,recordCount:records.length,writtenRecords:written,retainedNewerRecords:newer.size,firstProviderId:ids[0],lastProviderId:last,chainSha256:chain,committedAt:stamp};
  writes.push(db.insert(catalogGcdBulkBatches).values(receiptRow),db.update(catalogGcdBulkRuns).set({acceptedRecords:run.acceptedRecords+records.length,writtenRecords:run.writtenRecords+written,retainedNewerRecords:run.retainedNewerRecords+newer.size,nextBatch:index+1,lastProviderId:last,recordChainSha256:chain}).where(eq(catalogGcdBulkRuns.id,id)));
  const condition=sql`${leaseCondition(lease,now)} AND EXISTS (SELECT 1 FROM ${catalogGcdBulkRuns} WHERE ${catalogGcdBulkRuns.id}=${id} AND ${catalogGcdBulkRuns.stage}='OPEN' AND ${catalogGcdBulkRuns.nextBatch}=${index} AND ${catalogGcdBulkRuns.lastProviderId}=${run.lastProviderId}) AND NOT EXISTS (SELECT 1 FROM ${catalogIssues} WHERE ${inArray(catalogIssues.id,directoryIds)} AND (${catalogIssues.metronId} IS NOT NULL OR ${catalogIssues.gcdId} IS NULL OR ${catalogIssues.gcdId}<>${catalogIssues.id}-4000000000))`;
  await guarded(db,condition,writes);return {...await getGcdBulkStatus(db,id),receipt:receiptRow,replayed:false};
 });
}
export async function closeGcdBulk(db:CatalogDb,id:string,action:'finish'|'cancel',now=Date.now()){
 validId(id);return withGcdCatalogLease(db,now,async lease=>{
  const run=await runFor(db,id);if(run.stage==='CANCELLED'&&action==='cancel'||run.stage==='COMPLETED'&&action==='finish')return {...status(run),replayed:true};
  if(run.stage!=='OPEN')throw new ApiRequestError('This GCD bulk import is already closed.',409);
  if(action==='finish'){const manifest=validateGcdBulkManifest(JSON.parse(run.manifest),now);if(run.acceptedRecords!==run.expectedRecords||run.recordChainSha256!==manifest.recordsSha256)throw new ApiRequestError('The GCD export count or record checksum is incomplete. Keep the accepted checkpoint; do not claim full coverage.',409)}
  await guarded(db,sql`${leaseCondition(lease,now)} AND EXISTS (SELECT 1 FROM ${catalogGcdBulkRuns} WHERE ${catalogGcdBulkRuns.id}=${id} AND ${catalogGcdBulkRuns.stage}='OPEN' AND ${catalogGcdBulkRuns.nextBatch}=${run.nextBatch})`,[db.update(catalogGcdBulkRuns).set({stage:action==='finish'?'COMPLETED':'CANCELLED',finishedAt:new Date(now).toISOString()}).where(eq(catalogGcdBulkRuns.id,id))]);
  return {...await getGcdBulkStatus(db,id),replayed:false};
 });
}
