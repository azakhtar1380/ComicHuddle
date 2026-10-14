import {and,eq,lt,sql} from 'drizzle-orm';
import {catalogIssues,catalogSync,catalogSyncSeen} from '../db/schema';
import {type CatalogDb,catalogOverview,metronRecordStatements,metronRecordsByIds,normalizeMetronRecord,seedStarterStatements} from './catalog-store';
import {conditionalGuard} from './operation-guard';
import {ApiRequestError} from './api-security';

const API='https://metron.cloud/api/issue/';
const KEY='metron',OVERLAP=7*86400000,REFRESH_AGE=7*86400000;
export type MetronSyncEnv={METRON_API_TOKEN?:string;METRON_SYNC_ENABLED?:string;METRON_PRIVATE_SERVICE_ENABLED?:string;METRON_NIGHTLY_SCHEDULE_ENABLED?:string};
export type SyncScope={publisherName?:string;startDate?:string;endDate?:string};
type Pending={id:number;modified:string};
type SyncState={runId:string;active:boolean;pausedByOwner:boolean;stage:string;scope:SyncScope;startedAt:string|null;floor:string|null;watermark:string|null;lastCompletedAt:string|null;lastFullAt:string|null;nextPage:number;pending:Pending[];nextAfterPending:number|null;pass:number;passExpectedCount:number|null;error:string|null;providerDailyLimit:number;providerBurstLimit:number;checkedRecords:number};
const initial=():SyncState=>({runId:'',active:false,pausedByOwner:false,stage:'idle',scope:{},startedAt:null,floor:null,watermark:null,lastCompletedAt:null,lastFullAt:null,nextPage:1,pending:[],nextAfterPending:null,pass:1,passExpectedCount:null,error:null,providerDailyLimit:5000,providerBurstLimit:20,checkedRecords:0});
export const syncConfigured=(env:MetronSyncEnv)=>typeof env.METRON_API_TOKEN==='string'&&/^[A-Za-z0-9_.~-]{20,512}$/.test(env.METRON_API_TOKEN);
export function parseSyncScope(raw:unknown):SyncScope{
 if(raw===undefined)return {};
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new ApiRequestError('Choose a valid catalog scope.',400);
 const value=raw as Record<string,unknown>;
 if(Object.keys(value).some(k=>!['publisherName','startDate','endDate'].includes(k)))throw new ApiRequestError('Unsupported catalog scope.',400);
 const out:SyncScope={};
 if(value.publisherName!==undefined){if(typeof value.publisherName!=='string'||value.publisherName.trim().length>100||/[\x00-\x1f]/.test(value.publisherName))throw new ApiRequestError('Use a publisher name up to 100 characters.',400);if(value.publisherName.trim())out.publisherName=value.publisherName.trim();}
 for(const key of ['startDate','endDate'] as const)if(value[key]!==undefined){const v=value[key];if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw new ApiRequestError('Use valid YYYY-MM-DD release dates.',400);out[key]=v;}
 if(out.startDate&&out.endDate&&out.startDate>out.endDate)throw new ApiRequestError('The first release date must precede the last.',400);
 return out;
}
async function rowFor(db:CatalogDb){
 await db.insert(catalogSync).values({id:KEY,state:JSON.stringify(initial())}).onConflictDoNothing();
 const [row]=await db.select().from(catalogSync).where(eq(catalogSync.id,KEY));if(!row)throw new Error('Sync state unavailable.');
 return row;
}
function readState(raw:string):SyncState{return {...initial(),...JSON.parse(raw)} as SyncState}
export async function getSyncStatus(db:CatalogDb,env:MetronSyncEnv,now=Date.now()){
 const [row]=await db.select().from(catalogSync).where(eq(catalogSync.id,KEY));
 const state=row?readState(row.state):initial(),meta=await catalogOverview(db);
 return {configured:syncConfigured(env),accessReady:syncConfigured(env)&&env.METRON_SYNC_ENABLED==='true',imported:meta.syncedIssueCount,active:state.active,pausedByOwner:state.pausedByOwner,stage:state.stage,pending:state.pending.length,nextPage:state.nextPage,lastCompletedAt:state.lastCompletedAt,retryAfter:row?Math.max(0,Math.ceil((row.retryAt-now)/1000)):0,error:state.error,checkedRecords:state.checkedRecords,pass:state.pass,scope:state.scope,schedulerEnabled:env.METRON_NIGHTLY_SCHEDULE_ENABLED==='true'};
}
async function acquire(db:CatalogDb,now:number){
 await rowFor(db);const lease=crypto.randomUUID();
 const rows=await db.update(catalogSync).set({leaseId:lease,leaseUntil:now+120000}).where(and(eq(catalogSync.id,KEY),lt(catalogSync.leaseUntil,now))).returning();
 if(!rows.length)throw new ApiRequestError('Another catalog step is running. Retry shortly.',409);
 return {lease,row:rows[0],state:readState(rows[0].state)};
}
async function persist(db:CatalogDb,lease:string,state:SyncState,statements:unknown[]=[],extra:{retryAt?:number}={}){
 const guard=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM ${catalogSync} WHERE ${catalogSync.id}=${KEY} AND ${catalogSync.leaseId}=${lease})`);
 const writes=[guard.start,...statements,db.update(catalogSync).set({state:JSON.stringify(state),...extra}).where(and(eq(catalogSync.id,KEY),eq(catalogSync.leaseId,lease))),guard.finish];
 await db.batch(writes as unknown as Parameters<CatalogDb['batch']>[0]);
}
export async function startSync(db:CatalogDb,env:MetronSyncEnv,rawScope:unknown,now=Date.now()){
 requireConfigured(env);const scope=parseSyncScope(rawScope),lock=await acquire(db,now);
 try{
  if(lock.state.active||lock.state.stage==='paused')throw new ApiRequestError('Finish or resume the current import before starting another scope.',409);
  const state={...lock.state,runId:crypto.randomUUID(),active:true,pausedByOwner:false,stage:'scanning',scope,startedAt:new Date(now).toISOString(),floor:null,nextPage:1,pending:[],nextAfterPending:null,pass:1,passExpectedCount:null,error:null,checkedRecords:0};
  // Old manifests are maintenance data; deleting them never deletes comics.
  await persist(db,lock.lease,state,[db.delete(catalogSyncSeen)] ,{retryAt:0});
 }finally{await release(db,lock.lease)}
 return getSyncStatus(db,env,now);
}
export async function pauseSync(db:CatalogDb,env:MetronSyncEnv,now=Date.now()){
 const lock=await acquire(db,now);try{const state=lock.state;if(state.active||state.stage==='paused'){state.active=false;state.pausedByOwner=true;state.stage='paused';await persist(db,lock.lease,state)}}finally{await release(db,lock.lease)}return getSyncStatus(db,env,now);
}
export async function seedStarter(db:CatalogDb,env:MetronSyncEnv,now=Date.now()){
 const lock=await acquire(db,now);try{await persist(db,lock.lease,lock.state,seedStarterStatements(db,new Date(now).toISOString()))}finally{await release(db,lock.lease)}return getSyncStatus(db,env,now);
}
function requireConfigured(env:MetronSyncEnv){
 if(!syncConfigured(env))throw new ApiRequestError('Configure the business METRON_API_TOKEN in Sites runtime secrets first.',424);
 if(env.METRON_SYNC_ENABLED!=='true')throw new ApiRequestError('Enable METRON_SYNC_ENABLED for the operator catalog connection first.',424);
}
async function release(db:CatalogDb,lease:string){await db.update(catalogSync).set({leaseId:'',leaseUntil:0}).where(and(eq(catalogSync.id,KEY),eq(catalogSync.leaseId,lease)))}
function numericHeader(headers:Headers,key:string,max:number){const value=headers.get(key);return value&&/^\d{1,12}$/.test(value)&&Number(value)<=max?Number(value):null}
function resetAt(headers:Headers,key:string,now:number){const value=numericHeader(headers,key,9999999999);return value===null?0:Math.max(now,value*1000)}
function nextPage(next:unknown,current:number,params:URLSearchParams):number|null{
 if(next===null)return null;
 if(typeof next!=='string')throw new Error('Invalid Metron pagination.');
 const url=new URL(next);
 if(url.origin!=='https://metron.cloud'||url.pathname!=='/api/issue/'||url.username||url.password||url.hash)throw new Error('Unsafe Metron pagination.');
 const n=url.searchParams.get('page');if(!n||!/^\d+$/.test(n)||Number(n)!==current+1||url.searchParams.getAll('page').length!==1)throw new Error('Invalid Metron page sequence.');
 for(const [key,value] of url.searchParams)if(key!=='page'&&(url.searchParams.getAll(key).length!==1||params.get(key)!==value))throw new Error('Metron changed the import scope.');
 for(const [key,value] of params)if(key!=='page'&&url.searchParams.get(key)!==value)throw new Error('Metron changed the import scope.');
 return Number(n);
}
export type SyncDependencies={fetcher?:typeof fetch;now?:()=>number};
export async function syncStep(db:CatalogDb,env:MetronSyncEnv,deps:SyncDependencies={}){
 requireConfigured(env);const clock=deps.now||Date.now,now=clock(),lock=await acquire(db,now),state=lock.state;
 const fetcher=deps.fetcher||fetch;
 let calls=0,records=0;
 async function request(url:string){
  const target=new URL(url);
  if(target.origin!=='https://metron.cloud'||!/^\/api\/issue\/(?:[1-9]\d*\/)?$/.test(target.pathname)||target.username||target.password||target.hash)throw new Error('Unsafe Metron request.');
  const stamp=clock(),[row]=await db.select().from(catalogSync).where(eq(catalogSync.id,KEY));if(!row||row.leaseId!==lock.lease)throw new ApiRequestError('Catalog lease changed. Retry the step.',409);
  if(row.retryAt>stamp)throw new ApiRequestError('Metron rate limit: retry in '+Math.ceil((row.retryAt-stamp)/1000)+' seconds.',429);
  const minute=Math.floor(stamp/60000)*60000,day=Math.floor(stamp/86400000)*86400000;
  const mc=row.minuteStart===minute?row.minuteRequests:0,dc=row.dayStart===day?row.dayRequests:0;
  if(mc>=Math.min(20,state.providerBurstLimit)||dc>=state.providerDailyLimit){const retryAt=dc>=state.providerDailyLimit?day+86400000:minute+60000;await db.update(catalogSync).set({retryAt}).where(eq(catalogSync.id,KEY));throw new ApiRequestError('Catalog request budget reached. The checkpoint is preserved.',429);}
  await db.update(catalogSync).set({minuteStart:minute,minuteRequests:mc+1,dayStart:day,dayRequests:dc+1,leaseUntil:stamp+120000}).where(and(eq(catalogSync.id,KEY),eq(catalogSync.leaseId,lock.lease)));
  calls++;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{
   const response=await fetcher(target.toString(),{headers:{Authorization:'Bearer '+env.METRON_API_TOKEN,Accept:'application/json'},redirect:'error',signal:controller.signal});
   const daily=numericHeader(response.headers,'X-RateLimit-Sustained-Limit',100000),burst=numericHeader(response.headers,'X-RateLimit-Burst-Limit',100);
   if(daily&&daily>=5000)state.providerDailyLimit=daily;if(burst&&burst>0)state.providerBurstLimit=burst;
   let retryAt=0;
   const wait=numericHeader(response.headers,'Retry-After',86400);if(wait!==null)retryAt=stamp+Math.max(1,wait)*1000;
   if(numericHeader(response.headers,'X-RateLimit-Burst-Remaining',100000)===0)retryAt=Math.max(retryAt,resetAt(response.headers,'X-RateLimit-Burst-Reset',stamp)||minute+60000);
   if(numericHeader(response.headers,'X-RateLimit-Sustained-Remaining',100000)===0)retryAt=Math.max(retryAt,resetAt(response.headers,'X-RateLimit-Sustained-Reset',stamp)||day+86400000);
   if(retryAt)await db.update(catalogSync).set({retryAt}).where(and(eq(catalogSync.id,KEY),eq(catalogSync.leaseId,lock.lease)));
   if(response.status===429){await response.body?.cancel();if(!retryAt)await db.update(catalogSync).set({retryAt:stamp+60000}).where(eq(catalogSync.id,KEY));throw new ApiRequestError('Metron request limit reached. The checkpoint is preserved.',429);}
   if(response.status===401||response.status===403){await response.body?.cancel();throw new ApiRequestError('Metron rejected the business token. Check its account and permitted access.',424);}
   if(response.status===404){await response.body?.cancel();throw new ApiRequestError('A Metron record disappeared during this scan. Existing records are retained; retry or reconcile with the provider.',502);}
   if(!response.ok){await response.body?.cancel();throw new ApiRequestError('Metron is temporarily unavailable. Retry this checkpoint.',503);}
   if(!response.headers.get('content-type')?.toLowerCase().includes('application/json')){await response.body?.cancel();throw new ApiRequestError('Metron returned an unreadable response.',502);}
   const length=Number(response.headers.get('content-length'));if(Number.isFinite(length)&&length>1500000){await response.body?.cancel();throw new ApiRequestError('Metron response exceeds the import limit.',502);}
   if(!response.body)throw new ApiRequestError('Metron returned an empty response.',502);
   const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
   try{while(true){const {value,done}=await reader.read();if(done)break;if(!value)continue;size+=value.byteLength;if(size>1500000){await reader.cancel();throw new ApiRequestError('Metron response exceeds the import limit.',502)}chunks.push(value)}}finally{reader.releaseLock()}
   const bytes=new Uint8Array(size);let pos=0;for(const chunk of chunks){bytes.set(chunk,pos);pos+=chunk.length}
   try{return JSON.parse(new TextDecoder().decode(bytes)) as unknown}catch{throw new ApiRequestError('Metron returned invalid metadata JSON.',502)}
  }catch(error){if(error instanceof ApiRequestError)throw error;throw new ApiRequestError('Metron request failed or timed out. The checkpoint is preserved.',503)}finally{clearTimeout(timer)}
 }
 try{
  if(!state.runId||['idle','complete'].includes(state.stage))throw new ApiRequestError('Start an import before continuing.',409);
  state.active=true;state.pausedByOwner=false;state.stage=state.pending.length?'details':'scanning';state.error=null;
  await persist(db,lock.lease,state);
  // Each HTTP step has at most four external requests. Python/cloud runners
  // repeat steps and honor retryAfter; a page load never calls this function.
  while(calls<4&&records<8&&state.active){
   if(state.pending.length){
    const pending=state.pending[0],stamp=new Date(clock()).toISOString(),rows=await metronRecordsByIds(db,[pending.id]),existing=rows[0];
    const fresh=existing&&Date.parse(existing.fetchedAt)>clock()-REFRESH_AGE&&Date.parse(existing.sourceModified)>=Date.parse(pending.modified);
    let writes:unknown[]=[];
    if(!fresh){
     const raw=await request(API+pending.id+'/');const record=normalizeMetronRecord(raw,stamp,env.METRON_API_TOKEN);
     if(record.issue.metronId!==pending.id)throw new ApiRequestError('Metron returned a different issue identity.',502);
     if(Date.parse(record.sourceModified)<Date.parse(pending.modified))throw new ApiRequestError('Metron detail is older than its catalog listing. Retry the preserved checkpoint.',502);
     if(!existing||Date.parse(record.sourceModified)>=Date.parse(existing.sourceModified))writes=metronRecordStatements(db,record);
    }
    state.pending.shift();state.checkedRecords++;records++;
    await persist(db,lock.lease,state,writes);
    if(state.pending.length)continue;
    if(state.nextAfterPending!==null){state.nextPage=state.nextAfterPending;state.nextAfterPending=null;state.stage='scanning';await persist(db,lock.lease,state);continue;}
    await finishPass();continue;
   }
   const params=new URLSearchParams({page:String(state.nextPage)});
   if(state.scope.publisherName)params.set('publisher_name',state.scope.publisherName);
   if(state.scope.startDate)params.set('store_date_range_after',state.scope.startDate);
   if(state.scope.endDate)params.set('store_date_range_before',state.scope.endDate);
   if(state.floor)params.set('modified_gt',state.floor);
   const raw=await request(API+'?'+params);
   if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new ApiRequestError('Metron returned an invalid catalog page.',502);
   const page=raw as Record<string,unknown>;
   if(!Array.isArray(page.results)||page.results.length>100||typeof page.count!=='number'||!Number.isSafeInteger(page.count)||page.count<0)throw new ApiRequestError('Metron returned an invalid catalog page.',502);
   const pending:Pending[]=page.results.map(value=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiRequestError('Invalid Metron issue list.',502);const item=value as Record<string,unknown>;if(typeof item.id!=='number'||!Number.isSafeInteger(item.id)||item.id<1||item.id>2147483647||typeof item.modified!=='string'||!Number.isFinite(Date.parse(item.modified)))throw new ApiRequestError('Invalid Metron issue list.',502);return {id:item.id,modified:new Date(item.modified).toISOString()}});
   if(new Set(pending.map(p=>p.id)).size!==pending.length)throw new ApiRequestError('Metron repeated an issue in one page.',502);
   const next=nextPage(page.next,state.nextPage,params);
   if(next!==null&&!pending.length)throw new ApiRequestError('Metron returned an empty page with further pages.',502);
   if(page.count<pending.length||page.count>0&&!pending.length&&state.nextPage===1)throw new ApiRequestError('Metron catalog count does not match its page. Retry the preserved checkpoint.',502);
   // A large backfill can span days. Valid later pages must still be imported
   // as the source grows; reconcile unique coverage against its final reported
   // count at pass end instead of repeatedly resetting to the first page.
   state.passExpectedCount=page.count;
   state.pending=pending;state.nextAfterPending=next;state.stage='details';
   const seen=pending.map(p=>db.insert(catalogSyncSeen).values({runId:state.runId,metronId:p.id,firstPass:state.pass===1?1:0,lastPass:state.pass}).onConflictDoUpdate({target:[catalogSyncSeen.runId,catalogSyncSeen.metronId],set:{lastPass:state.pass}}));
   await persist(db,lock.lease,state,seen);
   if(!pending.length)await finishPass();
  }
  async function restartReconciliation(message:string){
   state.active=false;state.stage='paused';state.error=message;state.pass=1;state.passExpectedCount=null;state.nextPage=1;state.pending=[];state.nextAfterPending=null;
   await persist(db,lock.lease,state,[db.delete(catalogSyncSeen).where(eq(catalogSyncSeen.runId,state.runId))]);
  }
  async function finishPass(){
   const [coverage]=await db.select({count:sql<number>`count(*)`}).from(catalogSyncSeen).where(and(eq(catalogSyncSeen.runId,state.runId),eq(catalogSyncSeen.lastPass,state.pass)));
   if(state.passExpectedCount===null||Number(coverage?.count)!==state.passExpectedCount){await restartReconciliation('Metron pagination did not cover its reported record count. Resume a fresh reconciliation scan.');throw new ApiRequestError(state.error!,502);}
   if(state.pass===1){state.pass=2;state.passExpectedCount=null;state.nextPage=1;state.stage='scanning';await persist(db,lock.lease,state);return;}
   const [manifest]=await db.select({missing:sql<number>`coalesce(sum(case when ${catalogSyncSeen.firstPass}=1 and ${catalogSyncSeen.lastPass}<>2 then 1 else 0 end),0)`,added:sql<number>`coalesce(sum(case when ${catalogSyncSeen.firstPass}=0 and ${catalogSyncSeen.lastPass}=2 then 1 else 0 end),0)`}).from(catalogSyncSeen).where(eq(catalogSyncSeen.runId,state.runId));
   if(Number(manifest?.missing)||Number(manifest?.added)){await restartReconciliation('The source changed between scans. Imported metadata is retained. Resume another reconciliation pass before advancing the watermark.');return;}
   state.active=false;state.stage='complete';state.watermark=state.startedAt;state.lastCompletedAt=new Date(clock()).toISOString();if(!state.floor)state.lastFullAt=state.lastCompletedAt;state.nextPage=1;await persist(db,lock.lease,state);
  }
 }catch(error){
  state.error=error instanceof ApiRequestError?error.message:'The catalog step could not save validated metadata. Retry the preserved checkpoint.';
  // A failed atomic batch must not advance the in-memory cursor in storage.
  const [current]=await db.select().from(catalogSync).where(eq(catalogSync.id,KEY));
  const saved=current?readState(current.state):state;saved.error=state.error;
  if(!(error instanceof ApiRequestError&&error.status===429)&&!['idle','complete'].includes(saved.stage)){saved.active=false;saved.stage='paused'}
  await persist(db,lock.lease,saved);
  if(error instanceof ApiRequestError)throw error;throw new ApiRequestError(saved.error,503);
 }finally{await release(db,lock.lease)}
 return getSyncStatus(db,env,clock());
}
// Nightly jobs reuse the last explicit scope. Full scans at least weekly also
// refresh nested credit/character changes which may not bump Issue.modified.
export async function nightlySyncStep(db:CatalogDb,env:MetronSyncEnv,deps:SyncDependencies={}){
 requireConfigured(env);const clock=deps.now||Date.now,now=clock(),row=await rowFor(db),state=readState(row.state);
 if(!state.runId)throw new ApiRequestError('Choose and start the initial catalog scope in Data Studio first.',409);
 if(state.pausedByOwner)return getSyncStatus(db,env,now);
 if(!state.active&&state.stage==='complete'){
  const lock=await acquire(db,now);try{
   const state=lock.state,full=!state.lastFullAt||Date.parse(state.lastFullAt)<now-7*86400000;
   const next:SyncState={...state,runId:crypto.randomUUID(),active:true,stage:'scanning',startedAt:new Date(now).toISOString(),floor:!full&&state.watermark?new Date(Date.parse(state.watermark)-OVERLAP).toISOString():null,nextPage:1,pending:[],nextAfterPending:null,pass:1,passExpectedCount:null,error:null,checkedRecords:0};
   await persist(db,lock.lease,next,[db.delete(catalogSyncSeen)],{retryAt:row.retryAt});
  }finally{await release(db,lock.lease)}
 }
 return syncStep(db,env,deps);
}
