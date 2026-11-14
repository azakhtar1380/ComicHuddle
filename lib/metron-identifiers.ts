import {sql} from 'drizzle-orm';
import {catalogIssuesById,type CatalogDb} from './catalog-store';
import type {Issue} from './catalog';
import {parseComicIdentifier,type ComicIdentifier} from './comic-identifiers';
import {METRON_COVER_ATTRIBUTION,METRON_DATA_CREDIT} from './data-credits';

/**
 * Server-side Metron access shared by the barcode fallback and cover resolution.
 * One owner-configured token (METRON_API_TOKEN), a shared per-minute/per-day
 * request budget, Retry-After/X-RateLimit blocking and a hard timeout.
 * Metron: https://metron.cloud/api/issue/ (Bearer token, 20 req/min, 5,000/day standard).
 */
export const METRON_ISSUE_API='https://metron.cloud/api/issue/';
import {METRON_COVER_HOST,metronConfig,metronImageUrl,type MetronConfig,type MetronEnv} from './metron-config';
export {METRON_COVER_HOST,metronConfig,metronImageUrl,type MetronConfig,type MetronEnv};
const PROVIDER='metron';
export class MetronLookupError extends Error{constructor(public code:'metron_budget'|'metron_rate_limited'|'metron_token_rejected'|'metron_timeout'|'metron_unavailable'|'metron_bad_response'|'metron_unsafe_url',public retryAfterSeconds:number|null=null){super(code)}}
export type MetronDeps={fetcher?:typeof fetch;signal?:AbortSignal;env?:MetronEnv;timeoutMs?:number};

async function blockMetron(db:CatalogDb,seconds:number,code:string){
 const wait=Math.max(1,Math.min(86400,Math.ceil(seconds)));
 await db.execute(sql`INSERT INTO ch_web.enrichment_provider_limits(provider,next_request_at,blocked_until,error_code) VALUES('metron-api',now(),now()+${wait}*interval '1 second',${code})
  ON CONFLICT(provider) DO UPDATE SET blocked_until=GREATEST(COALESCE(enrichment_provider_limits.blocked_until,now()),excluded.blocked_until),error_code=excluded.error_code,updated_at=now()`);
}
/** Consumes one request from the shared budget; false when blocked or exhausted. */
export async function metronBudget(db:CatalogDb,config:MetronConfig){
 const blocked=await db.execute(sql`SELECT 1 FROM ch_web.enrichment_provider_limits WHERE provider='metron-api' AND blocked_until>now()`);
 if(blocked.rows.length)return false;
 const rows=await db.execute(sql`INSERT INTO ch_web.provider_request_windows(provider,window_kind,window_start,requests) VALUES(${PROVIDER},'minute',date_trunc('minute',now()),1),(${PROVIDER},'day',date_trunc('day',now()),1)
  ON CONFLICT(provider,window_kind,window_start) DO UPDATE SET requests=provider_request_windows.requests+1 RETURNING window_kind,requests`);
 const count=(kind:string)=>Number(rows.rows.find(row=>row.window_kind===kind)?.requests||0);
 if(count('minute')===1)await db.execute(sql`DELETE FROM ch_web.provider_request_windows WHERE window_start<now()-interval '3 days'`);
 return count('minute')<=config.minuteBudget&&count('day')<=config.dailyBudget;
}
function headerNumber(headers:Headers,name:string){const value=headers.get(name)?.trim();return value&&/^\d+(\.\d+)?$/.test(value)?Number(value):null}
// Reset headers may be delta-seconds or epoch seconds.
function resetSeconds(headers:Headers,name:string,fallback:number){const value=headerNumber(headers,name);if(value===null)return fallback;return value>1e9?Math.max(1,value-Date.now()/1000):Math.max(1,value)}

export async function metronRequest(db:CatalogDb,config:MetronConfig,url:URL,deps:MetronDeps={}):Promise<unknown>{
 if(url.origin!=='https://metron.cloud'||!url.pathname.startsWith('/api/issue/')||url.username||url.password||url.hash)throw new MetronLookupError('metron_unsafe_url');
 if(!config.token)throw new MetronLookupError('metron_token_rejected');
 if(!await metronBudget(db,config))throw new MetronLookupError('metron_budget');
 const timeout=AbortSignal.timeout(deps.timeoutMs||8000),signal=deps.signal?AbortSignal.any([deps.signal,timeout]):timeout;
 let response:Response;
 try{response=await (deps.fetcher||fetch)(url.toString(),{headers:{Authorization:'Bearer '+config.token,Accept:'application/json','User-Agent':'ComicHuddle/1.0 (barcode and cover lookup)'},redirect:'error',signal,cache:'no-store'})}
 catch{throw new MetronLookupError(timeout.aborted?'metron_timeout':'metron_unavailable')}
 if(headerNumber(response.headers,'X-RateLimit-Sustained-Remaining')===0)await blockMetron(db,resetSeconds(response.headers,'X-RateLimit-Sustained-Reset',3600),'metron_daily_limit');
 else if(headerNumber(response.headers,'X-RateLimit-Burst-Remaining')===0)await blockMetron(db,Math.min(120,resetSeconds(response.headers,'X-RateLimit-Burst-Reset',60)),'metron_burst_limit');
 if(response.status===429){const wait=headerNumber(response.headers,'Retry-After')??60;await blockMetron(db,wait,'metron_rate_limited');await response.body?.cancel();throw new MetronLookupError('metron_rate_limited',Math.ceil(wait))}
 if(response.status===401||response.status===403){await blockMetron(db,3600,'metron_token_rejected');await response.body?.cancel();throw new MetronLookupError('metron_token_rejected')}
 if(response.status===404){await response.body?.cancel();return null}
 if(!response.ok){await response.body?.cancel();throw new MetronLookupError('metron_unavailable')}
 const text=await response.text();if(text.length>600000)throw new MetronLookupError('metron_bad_response');
 // An HTML bot-protection page is not data.
 try{return JSON.parse(text)}catch{throw new MetronLookupError('metron_bad_response')}
}

export type MetronIssueSummary={metronId:number;title:string;number:string;publisher:string;year:number|null;coverDate:string;image:string|null;gcdId:number|null;upc:string;sourceUrl:string|null};
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown,max=160)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max):'';
export function parseMetronIssue(raw:unknown):MetronIssueSummary|null{
 if(!record(raw)||!Number.isSafeInteger(raw.id)||(raw.id as number)<=0)return null;
 const series=record(raw.series)?raw.series:null,publisher=record(raw.publisher)?raw.publisher:series&&record(series.publisher)?series.publisher:null;
 const title=text(series?.name)||text(raw.issue)||text(raw.series),coverDate=typeof raw.cover_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(raw.cover_date)?raw.cover_date:'';
 const gcd=raw.gcd_id,upc=typeof raw.upc==='string'&&/^\d{8,18}$/.test(raw.upc.trim())?raw.upc.trim():'';
 let sourceUrl:string|null=null;if(typeof raw.resource_url==='string')try{const url=new URL(raw.resource_url);if(url.protocol==='https:'&&url.hostname==='metron.cloud')sourceUrl=url.href}catch{}
 if(!title)return null;
 return {metronId:raw.id as number,title,number:text(raw.number,24),publisher:text(publisher?.name),year:coverDate?Number(coverDate.slice(0,4)):null,coverDate,image:metronImageUrl(raw.image),
  gcdId:Number.isSafeInteger(gcd)&&(gcd as number)>0&&(gcd as number)<2500000000?gcd as number:null,upc,sourceUrl};
}
function pageResults(page:unknown){return record(page)&&Array.isArray(page.results)?page.results.slice(0,100):[]}
function pageCount(page:unknown,fallback:number){return record(page)&&Number.isSafeInteger(page.count)?page.count as number:fallback}

export type MetronExternalCandidate={metronId:number;title:string;number:string;publisher:string;year:number|null;cover:string|null;coverCredit:string|null;sourceUrl:string;upc:string;dataCredit:string};
export type MetronLookupStatus='disabled'|'busy'|'unavailable'|'matched'|'external'|'not_found';
export type MetronLookup={status:MetronLookupStatus;cached:boolean;issues:Issue[];external:MetronExternalCandidate[];total:number};
const empty=(status:MetronLookupStatus):MetronLookup=>({status,cached:false,issues:[],external:[],total:0});
export function toExternalCandidate(summary:MetronIssueSummary,config:MetronConfig):MetronExternalCandidate{
 const cover=config.directCovers?summary.image:null;
 return {metronId:summary.metronId,title:summary.title,number:summary.number,publisher:summary.publisher,year:summary.year,cover,coverCredit:cover?METRON_COVER_ATTRIBUTION:null,
  sourceUrl:summary.sourceUrl||'https://metron.cloud/',upc:summary.upc,dataCredit:METRON_DATA_CREDIT};
}
/** Metron stores UPC-A as 12 digits (plus supplement) and EAN/ISBN as 13. */
export function metronUpcBase(code:ComicIdentifier){return code.kind==='UPC'?code.lookupKey.slice(1):code.lookupKey}
/** Modern US direct-market supplements start with the 3-digit issue number. */
function supplementIssue(supplement:string){return /^\d{5}$/.test(supplement)?String(Number(supplement.slice(0,3))):null}

/**
 * Barcode -> Metron -> catalog record. Results (including "not found") are
 * cached per barcode so a repeat scan never calls Metron again before expiry.
 */
export async function lookupMetronIdentifier(db:CatalogDb,code:ComicIdentifier,deps:MetronDeps={}):Promise<MetronLookup>{
 const config=metronConfig(deps.env);if(!config.upcEnabled)return empty('disabled');
 let cached;
 try{cached=(await db.execute(sql`SELECT status,issue_ids,candidates,total FROM ch_web.metron_identifier_lookups WHERE lookup_key=${code.lookupKey} AND supplement=${code.supplement} AND expires_at>now()`)).rows[0]}
 catch{return empty('unavailable')}
 if(cached){
  const ids=(Array.isArray(cached.issue_ids)?cached.issue_ids:[]).map(Number).filter(Number.isSafeInteger),issues=await catalogIssuesById(db,ids);
  const external=(Array.isArray(cached.candidates)?cached.candidates:[]).map(parseCachedSummary).filter((row):row is MetronIssueSummary=>!!row).map(row=>toExternalCandidate(row,config));
  return {status:cached.status==='MATCHED'&&issues.length?'matched':external.length?'external':'not_found',cached:true,issues,external,total:Number(cached.total)||0};
 }
 try{
  const base=metronUpcBase(code);let page:unknown=null;
  if(code.supplement)page=await metronRequest(db,config,withQuery('upc',base+code.supplement),deps);
  if(!pageResults(page).length)page=await metronRequest(db,config,withQuery('upc_starts_with',base),deps);
  const wantedNumber=supplementIssue(code.supplement);
  const summaries=pageResults(page).map(parseMetronIssue).filter((row):row is MetronIssueSummary=>!!row)
   .sort((a,b)=>Number(b.number===wantedNumber)-Number(a.number===wantedNumber));
  const total=pageCount(page,summaries.length);
  // List rows may omit gcd_id; read at most three details to map them.
  const mapped:MetronIssueSummary[]=[];
  for(const summary of summaries.slice(0,3)){
   if(summary.gcdId){mapped.push(summary);continue}
   try{const detail=parseMetronIssue(await metronRequest(db,config,new URL(METRON_ISSUE_API+summary.metronId+'/'),deps));mapped.push(detail?{...summary,...detail,image:detail.image||summary.image}:summary)}
   catch(error){if(error instanceof MetronLookupError&&['metron_budget','metron_rate_limited'].includes(error.code)){mapped.push(summary);break}throw error}
  }
  const all=[...mapped,...summaries.slice(mapped.length)];
  const issues=await catalogIssuesById(db,[...new Set(mapped.flatMap(row=>row.gcdId?[4000000000+row.gcdId]:[]))]);
  const present=new Set(issues.map(issue=>issue.id));
  for(const row of mapped){
   if(!row.gcdId||!present.has(4000000000+row.gcdId))continue;
   // Store Metron's own code for that issue; fall back to the scanned code only for an exact match.
   const stored=(row.upc&&parseComicIdentifier(row.upc))||(code.supplement&&!row.upc?code:null);
   if(stored&&stored.lookupKey===code.lookupKey)await db.execute(sql`INSERT INTO ch_web.directory_identifiers(issue_id,source,identifier,lookup_key,supplement,kind) VALUES(${4000000000+row.gcdId},'METRON',${stored.identifier},${stored.lookupKey},${stored.supplement},${stored.kind}) ON CONFLICT(issue_id,source,identifier) DO NOTHING`);
  }
  const external=all.filter(row=>!(row.gcdId&&present.has(4000000000+row.gcdId))).slice(0,8);
  const status=issues.length?'MATCHED':external.length?'EXTERNAL':'NOT_FOUND';
  await db.execute(sql`INSERT INTO ch_web.metron_identifier_lookups(lookup_key,supplement,status,issue_ids,candidates,total,checked_at,expires_at)
   VALUES(${code.lookupKey},${code.supplement},${status},${JSON.stringify(issues.map(issue=>issue.id))}::jsonb,${JSON.stringify(external)}::jsonb,${total},now(),now()+${status==='NOT_FOUND'?7:30}*interval '1 day')
   ON CONFLICT(lookup_key,supplement) DO UPDATE SET status=excluded.status,issue_ids=excluded.issue_ids,candidates=excluded.candidates,total=excluded.total,checked_at=now(),expires_at=excluded.expires_at`);
  return {status:status==='MATCHED'?'matched':status==='EXTERNAL'?'external':'not_found',cached:false,issues,external:external.map(row=>toExternalCandidate(row,config)),total};
 }catch(error){
  if(error instanceof MetronLookupError&&['metron_budget','metron_rate_limited'].includes(error.code))return empty('busy');
  if(!(error instanceof MetronLookupError))console.warn('Metron barcode fallback deferred.');
  return empty('unavailable');
 }
}
function withQuery(name:'upc'|'upc_starts_with'|'gcd_id',value:string){const url=new URL(METRON_ISSUE_API);url.searchParams.set(name,value);return url}
function parseCachedSummary(value:unknown):MetronIssueSummary|null{
 if(!record(value)||!Number.isSafeInteger(value.metronId)||typeof value.title!=='string')return null;
 return {metronId:value.metronId as number,title:text(value.title),number:text(value.number,24),publisher:text(value.publisher),year:Number.isSafeInteger(value.year)?value.year as number:null,coverDate:text(value.coverDate,10),
  image:metronImageUrl(value.image),gcdId:Number.isSafeInteger(value.gcdId)?value.gcdId as number:null,upc:text(value.upc,18),sourceUrl:typeof value.sourceUrl==='string'&&value.sourceUrl.startsWith('https://metron.cloud/')?value.sourceUrl:null};
}

/** Cover lookup for one native GCD issue: /api/issue/?gcd_id= -> image (one request). */
export async function metronCoverForGcd(db:CatalogDb,gcdId:number,deps:MetronDeps={}):Promise<{found:boolean;image:string|null;metronId:number|null;sourceUrl:string|null}>{
 const config=metronConfig(deps.env);
 const page=await metronRequest(db,config,withQuery('gcd_id',String(gcdId)),deps);
 const rows=pageResults(page).map(parseMetronIssue).filter((row):row is MetronIssueSummary=>!!row);
 const exact=rows.find(row=>row.gcdId===null||row.gcdId===gcdId)||null;
 return {found:!!exact,image:exact?.image||null,metronId:exact?.metronId||null,sourceUrl:exact?.sourceUrl||null};
}
