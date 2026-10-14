import {and,eq,isNotNull,lt,sql} from 'drizzle-orm';
import {catalogGcdSeen,catalogGcdSeries,catalogIssues,catalogSync} from '../db/schema';
import {seedStarterStatements,type CatalogDb} from './catalog-store';
import {ApiRequestError,chunks} from './api-security';
import {conditionalGuard,operationGuardFailed} from './operation-guard';
import {gcdIssueCoverStatements} from './gcd-cover-writes';
import {GCD_BOUNDS,GCD_ORIGIN,gcdPage,gcdProviderId,gcdRecordStatements,gcdStoredIssue,gcdStoredSeries,isoWeek,normalizeGcdIssue,normalizeGcdSeries,weeklyPath} from './gcd-catalog';

const KEY='gcd',HOUR=3_600_000;
type Week={year:number;week:number};
type Pending={id:number;seriesId:number};
type Daily={runId:string;startedAt:string;lastCompletedAt:string|null;stage:'idle'|'importing'|'complete';weeks:Week[];weekIndex:number;page:number;nextPage:number|null;pending:Pending[];expectedCounts:(number|null)[];checked:number;unavailable:number};
type Backfill={runId:string;startedAt:string;lastPassCompletedAt:string|null;stage:'idle'|'importing'|'pass_complete';page:number;nextPage:number|null;pendingSeries:number[];currentSeries:number|null;issueOffset:number;expectedSeriesCount:number|null;checkedIssues:number;unavailable:number};
type State={version:1;requestTimes:number[];lastSuccessfulRequestAt:string|null;pausedByOwner:boolean;error:string|null;daily:Daily;backfill:Backfill};
export type GcdSyncEnv={METRON_PRIVATE_SERVICE_ENABLED?:string}; // existing owner-private gate is read only
export type GcdSyncDependencies={fetcher?:typeof fetch;now?:()=>number;onlyMissing?:boolean};
const initialDaily=():Daily=>({runId:'',startedAt:'',lastCompletedAt:null,stage:'idle',weeks:[],weekIndex:0,page:1,nextPage:null,pending:[],expectedCounts:[],checked:0,unavailable:0});
const initialBackfill=():Backfill=>({runId:'',startedAt:'',lastPassCompletedAt:null,stage:'idle',page:1,nextPage:null,pendingSeries:[],currentSeries:null,issueOffset:0,expectedSeriesCount:null,checkedIssues:0,unavailable:0});
const initial=():State=>({version:1,requestTimes:[],lastSuccessfulRequestAt:null,pausedByOwner:false,error:null,daily:initialDaily(),backfill:initialBackfill()});
function readState(raw:string):State{
 const state=JSON.parse(raw) as State;
 if(state.version!==1||!Array.isArray(state.requestTimes)||state.requestTimes.length>60||state.requestTimes.some(t=>!Number.isSafeInteger(t)||t<0)||!state.daily||!Array.isArray(state.daily.pending)||state.daily.pending.length>GCD_BOUNDS.rowsPerPage||!state.backfill||!Array.isArray(state.backfill.pendingSeries)||state.backfill.pendingSeries.length>GCD_BOUNDS.rowsPerPage)throw new Error('GCD checkpoint is invalid.');
 return state;
}
async function rowFor(db:CatalogDb){
 await db.insert(catalogSync).values({id:KEY,state:JSON.stringify(initial())}).onConflictDoNothing();
 const [row]=await db.select().from(catalogSync).where(eq(catalogSync.id,KEY));if(!row)throw new Error('GCD checkpoint unavailable.');return row;
}
async function acquire(db:CatalogDb,now:number){
 await rowFor(db);const lease=crypto.randomUUID();
 const [row]=await db.update(catalogSync).set({leaseId:lease,leaseUntil:now+120000}).where(and(eq(catalogSync.id,KEY),lt(catalogSync.leaseUntil,now))).returning();
 if(!row)throw new ApiRequestError('Another GCD import step is running. Retry shortly.',409);
 return {lease,state:readState(row.state),retryAt:row.retryAt};
}
async function release(db:CatalogDb,lease:string){await db.update(catalogSync).set({leaseId:'',leaseUntil:0}).where(and(eq(catalogSync.id,KEY),eq(catalogSync.leaseId,lease)))}
/** Bulk uploads share the existing GCD lock, without changing its state/quota. */
export async function withGcdCatalogLease<T>(db:CatalogDb,now:number,work:(lease:string)=>Promise<T>):Promise<T>{
 const lock=await acquire(db,now);try{return await work(lock.lease)}finally{await release(db,lock.lease)}
}
async function persist(db:CatalogDb,lease:string,state:State,now:number,writes:unknown[]=[],retryAt?:number){
 const guard=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM ${catalogSync} WHERE ${catalogSync.id}=${KEY} AND ${catalogSync.leaseId}=${lease} AND ${catalogSync.leaseUntil}>=${now})`);
 const statements=[guard.start,...writes,db.update(catalogSync).set({state:JSON.stringify(state),...(retryAt===undefined?{}:{retryAt})}).where(and(eq(catalogSync.id,KEY),eq(catalogSync.leaseId,lease))),guard.finish];
 await db.batch(statements as never);
}
function retryAtHeader(header:string|null,now:number):number|null{
 if(!header)return null;
 const value=/^\d+(?:\.\d+)?$/.test(header.trim())?now+Math.ceil(Number(header)*1000):Date.parse(header);
 return Number.isSafeInteger(value)&&value>now?value:null;
}
function safeRequest(path:string,page?:number){
 if(!(/^\/api\/(?:issue|series)\/[1-9]\d*\/$/.test(path)||path==='/api/series/'||/^\/api\/issue\/on_sale_weekly\/\d{4}\/week\/(?:[1-9]|[1-4]\d|5[0-3])\/$/.test(path)))throw new Error('Unsafe GCD endpoint.');
 const url=new URL(path,GCD_ORIGIN);if(page!==undefined){if(!Number.isSafeInteger(page)||page<1||page>1000000)throw new Error('Invalid GCD page.');url.searchParams.set('page',String(page));}return url.href;
}
const currentDailyComplete=(state:State,now:number)=>state.daily.stage==='complete'&&state.daily.startedAt.slice(0,10)===new Date(now).toISOString().slice(0,10);
async function responseBytes(response:Response){
 const declared=Number(response.headers.get('content-length'));
 if(Number.isFinite(declared)&&declared>GCD_BOUNDS.responseBytes){await response.body?.cancel();throw new ApiRequestError('GCD response exceeded the bounded import size.',502)}
 if(!response.body)return new Uint8Array();
 const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;if(!value)continue;size+=value.byteLength;if(size>GCD_BOUNDS.responseBytes){await reader.cancel();throw new ApiRequestError('GCD response exceeded the bounded import size.',502)}parts.push(value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength}return bytes;
}
export async function getGcdSyncStatus(db:CatalogDb,_env:GcdSyncEnv={},now=Date.now()){
 const [row]=await db.select().from(catalogSync).where(eq(catalogSync.id,KEY));const state=row?readState(row.state):initial();
 const [counts]=await db.select({n:sql<number>`count(*)`,last:sql<string|null>`max(${catalogIssues.fetchedAt})`}).from(catalogIssues).where(isNotNull(catalogIssues.gcdId));
 const seriesRun=state.backfill.runId;
 const [series]=seriesRun?await db.select({seen:sql<number>`count(*)`,complete:sql<number>`coalesce(sum(${catalogGcdSeen.completed}),0)`}).from(catalogGcdSeen).where(and(eq(catalogGcdSeen.runId,seriesRun),eq(catalogGcdSeen.kind,'series'))):[];
 const requestTimes=state.requestTimes.filter(t=>t>now-HOUR);
 const budgetRetry=requestTimes.length>=GCD_BOUNDS.requestsPerHour?requestTimes[0]+HOUR+1000:0;
 return {provider:'GCD',accessMode:'anonymous',lastSuccessfulRequestAt:state.lastSuccessfulRequestAt,importedIssueCount:Number(counts?.n||0),lastGcdSyncedAt:counts?.last||null,
  pausedByOwner:state.pausedByOwner,error:state.error,retryAfter:Math.max(0,Math.ceil((Math.max(row?.retryAt||0,budgetRetry)-now)/1000)),requestsLastHour:requestTimes.length,requestBudgetPerHour:GCD_BOUNDS.requestsPerHour,providerDefaultAnonRequestsPerHour:30,
  daily:{stage:state.daily.stage,weeks:state.daily.weeks,weekIndex:state.daily.weekIndex,page:state.daily.page,pending:state.daily.pending.length,expectedCounts:state.daily.expectedCounts,checked:state.daily.checked,unavailable:state.daily.unavailable,startedAt:state.daily.startedAt||null,lastCompletedAt:state.daily.lastCompletedAt},
  backfill:{stage:state.backfill.stage,page:state.backfill.page,pendingSeries:state.backfill.pendingSeries.length,currentSeries:state.backfill.currentSeries,issueOffset:state.backfill.issueOffset,expectedSeriesCount:state.backfill.expectedSeriesCount,observedSeriesCount:Number(series?.seen||0),processedSeriesCount:Number(series?.complete||0),checkedIssues:state.backfill.checkedIssues,unavailable:state.backfill.unavailable,lastPassCompletedAt:state.backfill.lastPassCompletedAt,deferredForRecentRefresh:!currentDailyComplete(state,now)},
  historicalCoverageComplete:false,historicalRefresh:'No modified-since feed is provided by this API. Recent-release daily checks do not make the full historical archive current.',artworkImported:false,valuationImported:false};
}
export async function setGcdSyncPaused(db:CatalogDb,paused:boolean,now=Date.now()){
 const lock=await acquire(db,now);try{lock.state.pausedByOwner=paused;await persist(db,lock.lease,lock.state,now)}finally{await release(db,lock.lease)}return getGcdSyncStatus(db,{},now);
}

/** Central owner job only. A normal directory page reads D1 and never invokes this importer. */
export async function gcdSyncStep(db:CatalogDb,mode:'daily'|'backfill',env:GcdSyncEnv={},deps:GcdSyncDependencies={}){
 const clock=deps.now||Date.now,fetcher=deps.fetcher||fetch,lock=await acquire(db,clock());let state=lock.state,calls=0,records=0,progress=0;
 async function request(path:string,page?:number):Promise<unknown|null>{
  const now=clock(),[current]=await db.select().from(catalogSync).where(eq(catalogSync.id,KEY));
  if(!current||current.leaseId!==lock.lease)throw new ApiRequestError('GCD lease changed. Retry the checkpoint.',409);
  if(current.retryAt>now)throw new ApiRequestError('GCD is waiting for its request window. The checkpoint is preserved.',429);
  state.requestTimes=state.requestTimes.filter(t=>t>now-HOUR);
  if(state.requestTimes.length>=GCD_BOUNDS.requestsPerHour){await persist(db,lock.lease,state,now,[],state.requestTimes[0]+HOUR+1000);throw new ApiRequestError('GCD hourly request budget reached. The checkpoint is preserved.',429)}
  state.requestTimes.push(now);
  const [reserved]=await db.update(catalogSync).set({state:JSON.stringify(state),leaseUntil:now+120000}).where(and(eq(catalogSync.id,KEY),eq(catalogSync.leaseId,lock.lease))).returning({id:catalogSync.id});
  if(!reserved)throw new ApiRequestError('GCD lease changed. Retry the checkpoint.',409);
  calls++;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),GCD_BOUNDS.timeoutMs);
  try{
   const response=await fetcher(safeRequest(path,page),{headers:{Accept:'application/json','User-Agent':'ComicHuddleCatalog/1.0'},redirect:'manual',signal:controller.signal});
   const retry=retryAtHeader(response.headers.get('retry-after'),clock());
   if(retry)await db.update(catalogSync).set({retryAt:retry}).where(and(eq(catalogSync.id,KEY),eq(catalogSync.leaseId,lock.lease)));
   if(response.status===429){await response.body?.cancel();if(!retry)await db.update(catalogSync).set({retryAt:clock()+HOUR}).where(and(eq(catalogSync.id,KEY),eq(catalogSync.leaseId,lock.lease)));throw new ApiRequestError('GCD provider limit reached. Retry-After and the checkpoint are preserved.',429)}
   if(response.status===401||response.status===403){await response.body?.cancel();throw new ApiRequestError('GCD no longer permits this anonymous access. Use its supported account/bulk-download route.',424)}
   if(response.status===404&&/^\/api\/issue\/[1-9]/.test(path)){await response.body?.cancel();return null;}
   if(response.status!==200){await response.body?.cancel();throw new ApiRequestError('GCD is temporarily unavailable. Retry the checkpoint.',503)}
   if(response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'){await response.body?.cancel();throw new ApiRequestError('GCD returned non-JSON metadata. The checkpoint is preserved.',502)}
   let raw:unknown;try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await responseBytes(response)))}catch(error){if(error instanceof ApiRequestError)throw error;throw new ApiRequestError('GCD returned invalid JSON metadata.',502)}
   state.lastSuccessfulRequestAt=new Date(clock()).toISOString();return raw;
  }catch(error){if(error instanceof ApiRequestError)throw error;throw new ApiRequestError('GCD request failed or timed out. The checkpoint is preserved.',503)}finally{clearTimeout(timer)}
 }
 async function saveIssue(pending:Pending,runId:string){
  const stored=await gcdStoredIssue(db,pending.id),start=mode==='daily'?state.daily.startedAt:state.backfill.startedAt;
  let writes:unknown[]=[];
  let sameSeries=false;if(stored){try{sameSeries=JSON.parse(stored.rawMetadata).seriesId===pending.seriesId}catch{}}
  let needsEnrichment=false;if(stored){try{needsEnrichment=JSON.parse(stored.rawMetadata).metadataScope==='selected_series_issue_indexes'}catch{}}
  if(!stored||!sameSeries||(deps.onlyMissing?needsEnrichment:Date.parse(stored.fetchedAt)<Date.parse(start))){
   const raw=await request('/api/issue/'+pending.id+'/');
   if(raw!==null){const normalized=normalizeGcdIssue(raw,new Date(clock()).toISOString());if(normalized.issue.gcdId!==pending.id||normalized.seriesId!==pending.seriesId)throw new ApiRequestError('GCD returned a different issue or series identity.',502);writes=[...gcdRecordStatements(db,normalized),...gcdIssueCoverStatements(db,raw,normalized.issue,normalized.stamp)]}
   else if(mode==='daily')state.daily.unavailable++;else state.backfill.unavailable++;
  }
  writes.push(db.insert(catalogGcdSeen).values({runId,kind:'issue',providerId:pending.id,completed:1}).onConflictDoNothing());
  records++;return writes;
 }
 try{
  if(state.pausedByOwner)return await getGcdSyncStatus(db,env,clock());
  if(mode==='backfill'&&!currentDailyComplete(state,clock()))return await getGcdSyncStatus(db,env,clock());
  state.error=null;
  if(mode==='daily'&&(state.daily.stage==='idle'||state.daily.stage==='complete'&&state.daily.startedAt.slice(0,10)!==new Date(clock()).toISOString().slice(0,10))){
   const previous=state.daily;
   state.daily={...initialDaily(),runId:crypto.randomUUID(),startedAt:new Date(clock()).toISOString(),stage:'importing',weeks:[isoWeek(clock()),isoWeek(clock()-7*86400000)],expectedCounts:[null,null],lastCompletedAt:previous.lastCompletedAt};
   await persist(db,lock.lease,state,clock(),[...seedStarterStatements(db,new Date(clock()).toISOString()),...(previous.runId?[db.delete(catalogGcdSeen).where(sql`${catalogGcdSeen.runId} IN (${previous.runId+':0'},${previous.runId+':1'})`)]:[])]);
  }
  if(mode==='backfill'&&state.backfill.stage==='idle'){
   state.backfill={...initialBackfill(),runId:crypto.randomUUID(),startedAt:new Date(clock()).toISOString(),stage:'importing'};
   await persist(db,lock.lease,state,clock(),seedStarterStatements(db,new Date(clock()).toISOString()));
  }
  while(calls<GCD_BOUNDS.callsPerStep&&records<GCD_BOUNDS.recordsPerStep&&progress++<GCD_BOUNDS.progressPerStep){
   if(mode==='daily'){
    const d=state.daily;if(d.stage!=='importing')break;
    if(d.pending.length){
     const writes=await saveIssue(d.pending[0],d.runId+':'+d.weekIndex);d.pending.shift();d.checked++;
     await persist(db,lock.lease,state,clock(),writes);if(d.pending.length)continue;
     await finishDailyPage();continue;
    }
    const path=weeklyPath(d.weeks[d.weekIndex]),page=gcdPage(await request(path,d.page),path,d.page);
    const pending=page.results.map(raw=>{if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new ApiRequestError('GCD returned an invalid weekly issue identity.',502);const item=raw as Record<string,unknown>;return {id:gcdProviderId(item.api_url,'issue'),seriesId:gcdProviderId(item.series,'series')}});
    if(new Set(pending.map(p=>p.id)).size!==pending.length)throw new ApiRequestError('GCD repeated a weekly issue ID.',502);
    d.pending=pending;d.nextPage=page.next;d.expectedCounts[d.weekIndex]=page.count;
    await persist(db,lock.lease,state,clock());if(!pending.length)await finishDailyPage();
   }else{
    const b=state.backfill;if(b.stage!=='importing')break;
    if(b.currentSeries===null&&b.pendingSeries.length){b.currentSeries=b.pendingSeries.shift()!;b.issueOffset=0;await persist(db,lock.lease,state,clock())}
    if(b.currentSeries!==null){
     let series=await gcdStoredSeries(db,b.currentSeries);
     if(!series||Date.parse(series.fetchedAt)<Date.parse(b.startedAt)){
      const fresh=normalizeGcdSeries(await request('/api/series/'+b.currentSeries+'/'),new Date(clock()).toISOString());
      if(fresh.gcdId!==b.currentSeries)throw new ApiRequestError('GCD returned a different series identity.',502);
      await persist(db,lock.lease,state,clock(),[db.insert(catalogGcdSeries).values(fresh).onConflictDoUpdate({target:catalogGcdSeries.gcdId,set:fresh})]);
      series=fresh;
      if(calls>=GCD_BOUNDS.callsPerStep)continue;
     }
     const issueIds=JSON.parse(series.issueIds) as number[];
     if(b.issueOffset<issueIds.length){const writes=await saveIssue({id:issueIds[b.issueOffset],seriesId:b.currentSeries},b.runId);b.issueOffset++;b.checkedIssues++;await persist(db,lock.lease,state,clock(),writes);continue;}
     const currentSeries=b.currentSeries;b.currentSeries=null;b.issueOffset=0;
     await persist(db,lock.lease,state,clock(),[db.update(catalogGcdSeen).set({completed:1}).where(and(eq(catalogGcdSeen.runId,b.runId),eq(catalogGcdSeen.kind,'series'),eq(catalogGcdSeen.providerId,currentSeries)))]);
     if(b.pendingSeries.length)continue;
     if(b.nextPage!==null){b.page=b.nextPage;b.nextPage=null;await persist(db,lock.lease,state,clock());continue;}
     await finishBackfillPass();break;
    }
    const page=gcdPage(await request('/api/series/',b.page),'/api/series/',b.page);
    const identities=page.results.map(raw=>{if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new ApiRequestError('GCD returned an invalid series identity.',502);return gcdProviderId((raw as Record<string,unknown>).api_url,'series')});
    const series=page.results.flatMap(raw=>Array.isArray((raw as Record<string,unknown>).active_issues)?[normalizeGcdSeries(raw,new Date(clock()).toISOString())]:[]);
    if(new Set(identities).size!==identities.length)throw new ApiRequestError('GCD repeated a series ID.',502);
    b.pendingSeries=identities;b.expectedSeriesCount=page.count;b.nextPage=page.next;
    const writes:unknown[]=[];
    for(const group of chunks(series,20))writes.push(db.insert(catalogGcdSeries).values(group as [typeof series[number],...typeof series]).onConflictDoUpdate({target:catalogGcdSeries.gcdId,set:{data:sql`excluded.data`,issueIds:sql`excluded.issue_ids`,fetchedAt:sql`excluded.fetched_at`}}));
    for(const group of chunks(identities,20))writes.push(db.insert(catalogGcdSeen).values(group.map(id=>({runId:b.runId,kind:'series',providerId:id,completed:0})) as never).onConflictDoNothing());
    await persist(db,lock.lease,state,clock(),writes);if(!identities.length)await finishBackfillPass();
   }
  }
  async function finishDailyPage(){
   const d=state.daily;if(d.nextPage!==null){d.page=d.nextPage;d.nextPage=null;await persist(db,lock.lease,state,clock());return;}
   const [seen]=await db.select({n:sql<number>`count(*)`}).from(catalogGcdSeen).where(and(eq(catalogGcdSeen.runId,d.runId+':'+d.weekIndex),eq(catalogGcdSeen.kind,'issue')));
   if(Number(seen?.n)!==d.expectedCounts[d.weekIndex]){
    d.page=1;d.nextPage=null;d.pending=[];d.expectedCounts[d.weekIndex]=null;
    await persist(db,lock.lease,state,clock(),[db.delete(catalogGcdSeen).where(eq(catalogGcdSeen.runId,d.runId+':'+d.weekIndex))]);
    throw new ApiRequestError('GCD weekly pagination changed or missed records. The week was reset for reconciliation; imported data is retained.',502);
   }
   d.weekIndex++;d.page=1;d.nextPage=null;
   if(d.weekIndex>=d.weeks.length){d.stage='complete';d.lastCompletedAt=new Date(clock()).toISOString();}
   await persist(db,lock.lease,state,clock());
  }
  async function finishBackfillPass(){
   const b=state.backfill;const [seen]=await db.select({n:sql<number>`count(*)`,complete:sql<number>`coalesce(sum(${catalogGcdSeen.completed}),0)`}).from(catalogGcdSeen).where(and(eq(catalogGcdSeen.runId,b.runId),eq(catalogGcdSeen.kind,'series')));
   if(Number(seen?.n)!==b.expectedSeriesCount||Number(seen?.complete)!==Number(seen?.n)){
    const previous=b;
    state.backfill={...initialBackfill(),runId:crypto.randomUUID(),startedAt:new Date(clock()).toISOString(),stage:'importing',lastPassCompletedAt:previous.lastPassCompletedAt};
    await persist(db,lock.lease,state,clock(),[db.delete(catalogGcdSeen).where(eq(catalogGcdSeen.runId,previous.runId))]);
    throw new ApiRequestError('GCD series pagination changed or missed records. The pass was reset for reconciliation; imported data is retained.',502);
   }
   b.stage='pass_complete';b.lastPassCompletedAt=new Date(clock()).toISOString();await persist(db,lock.lease,state,clock());
  }
 }catch(error){
  const [row]=await db.select().from(catalogSync).where(eq(catalogSync.id,KEY));
  if(row?.leaseId===lock.lease){state=readState(row.state);state.error=error instanceof ApiRequestError?error.message:'GCD import could not save validated metadata. Retry the preserved checkpoint.';try{await persist(db,lock.lease,state,clock())}catch{}}
  if(error instanceof ApiRequestError)throw error;if(operationGuardFailed(error))throw new ApiRequestError('GCD lease changed. Retry the preserved checkpoint.',409);throw new ApiRequestError('GCD import could not save validated metadata. Retry the preserved checkpoint.',503);
 }finally{await release(db,lock.lease)}
 return getGcdSyncStatus(db,env,clock());
}
