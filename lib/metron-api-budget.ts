// Shared Metron API budget (ch_web.metron_api_budget, migration 030) for every caller of the
// character endpoints: the local crawler (scripts/crawl-metron-characters.ts) and the deployed
// app's on-demand issue enrichment. Metron allows 20 requests/minute and 5,000/day per account;
// the shared ceiling stays under both and also counts the barcode/cover lookups recorded in
// ch_web.provider_request_windows (migration 025). Image downloads from static.metron.cloud are
// not API calls and are never counted here. The token is never logged.
import {sql} from 'drizzle-orm';
import type {CatalogDb} from './catalog-store';
import {metronConfig,type MetronEnv} from './metron-config';

export type MetronCaller='crawler'|'app';
export const METRON_API_ORIGIN='https://metron.cloud';
export const METRON_USER_AGENT='ComicHuddle character indexer (server-side; contact via metron.cloud account)';
const bounded=(raw:string|undefined,fallback:number,max:number)=>{const n=Number(raw);return Number.isInteger(n)&&n>0?Math.min(n,max):fallback};
/** Daily ceilings: all callers together <= shared (4,500); the crawler alone <= 3,700 so the app keeps headroom. */
export function metronBudgetLimits(caller:MetronCaller,env:MetronEnv=process.env){
 const shared=bounded(env.METRON_SHARED_DAILY_MAX,4500,4900);
 const own=caller==='crawler'?bounded(env.METRON_CRAWLER_DAILY_MAX,3700,shared):bounded(env.METRON_APP_DAILY_MAX,shared,shared);
 return {shared,own,minute:bounded(env.METRON_SHARED_MINUTE_MAX,18,19)};
}
export type BudgetDecision={ok:true;used:number}|{ok:false;reason:'day'|'minute'|'blocked'|'unavailable';retryAfterMs:number};

/** Requests already counted today by the barcode/cover lookups (migration 025); 0 when that table is absent. */
async function otherUsage(db:CatalogDb){
 try{
  const r=await db.execute(sql`SELECT COALESCE(sum(requests),0)::int AS n FROM ch_web.provider_request_windows WHERE provider='metron' AND window_kind='day' AND window_start=date_trunc('day',now())`);
  return Number(r.rows[0]?.n||0);
 }catch{return 0}
}
async function sharedBlock(db:CatalogDb){
 try{
  const r=await db.execute(sql`SELECT GREATEST(0,EXTRACT(EPOCH FROM blocked_until-now()))::float8 AS s FROM ch_web.enrichment_provider_limits WHERE provider='metron-api' AND blocked_until>now()`);
  return r.rows.length?Number(r.rows[0].s)*1000:0;
 }catch{return 0}
}
/** Atomically reserves `count` calls for `caller`; never exceeds the shared, caller or minute ceilings. */
export async function reserveMetronCalls(db:CatalogDb,caller:MetronCaller,count=1,env:MetronEnv=process.env):Promise<BudgetDecision>{
 const limits=metronBudgetLimits(caller,env);
 try{
  const blocked=await sharedBlock(db);if(blocked>0)return {ok:false,reason:'blocked',retryAfterMs:blocked};
  const other=await otherUsage(db);
  const r=await db.execute(sql`INSERT INTO ch_web.metron_api_budget AS b(day,used,by_caller,minute_start,minute_used,updated_at)
   SELECT (now() AT TIME ZONE 'utc')::date,${count}::int,jsonb_build_object(${caller}::text,${count}::int),date_trunc('minute',now()),${count}::int,now()
   WHERE ${count}::int+${other}::int<=${limits.shared}::int
   ON CONFLICT(day) DO UPDATE SET used=b.used+excluded.used,
    by_caller=b.by_caller||jsonb_build_object(${caller}::text,COALESCE((b.by_caller->>${caller}::text)::int,0)+excluded.used),
    minute_used=CASE WHEN b.minute_start=excluded.minute_start THEN b.minute_used+excluded.used ELSE excluded.used END,
    minute_start=excluded.minute_start,updated_at=now()
   WHERE b.used+excluded.used+${other}::int<=${limits.shared}::int
    AND COALESCE((b.by_caller->>${caller}::text)::int,0)+excluded.used<=${limits.own}::int
    AND (b.minute_start IS DISTINCT FROM excluded.minute_start OR b.minute_used+excluded.used<=${limits.minute}::int)
    AND (b.blocked_until IS NULL OR b.blocked_until<=now())
   RETURNING used`);
  if(r.rows.length)return {ok:true,used:Number(r.rows[0].used)};
  const row=(await db.execute(sql`SELECT used,COALESCE((by_caller->>${caller}::text)::int,0) AS own,minute_used,minute_start=date_trunc('minute',now()) AS same_minute,
    GREATEST(0,EXTRACT(EPOCH FROM blocked_until-now()))::float8 AS blocked_s,EXTRACT(EPOCH FROM date_trunc('minute',now())+interval '1 minute'-now())::float8 AS minute_left_s,
    EXTRACT(EPOCH FROM date_trunc('day',now() AT TIME ZONE 'utc')+interval '1 day'-(now() AT TIME ZONE 'utc'))::float8 AS day_left_s
   FROM ch_web.metron_api_budget WHERE day=(now() AT TIME ZONE 'utc')::date`)).rows[0];
  if(!row)return {ok:false,reason:'day',retryAfterMs:3600000};
  if(Number(row.blocked_s)>0)return {ok:false,reason:'blocked',retryAfterMs:Number(row.blocked_s)*1000};
  if(Number(row.used)+count+other>limits.shared||Number(row.own)+count>limits.own)return {ok:false,reason:'day',retryAfterMs:Number(row.day_left_s)*1000};
  return {ok:false,reason:'minute',retryAfterMs:Math.max(1000,Number(row.minute_left_s)*1000)};
 }catch{return {ok:false,reason:'unavailable',retryAfterMs:60000}}
}
/** Pauses every caller (429 / daily limit reached), also in the barcode lookup's shared block row. */
export async function blockMetronCalls(db:CatalogDb,seconds:number,code:string){
 const wait=Math.max(1,Math.min(86400,Math.ceil(seconds)));
 try{await db.execute(sql`INSERT INTO ch_web.metron_api_budget AS b(day,blocked_until) VALUES((now() AT TIME ZONE 'utc')::date,now()+${wait}*interval '1 second')
  ON CONFLICT(day) DO UPDATE SET blocked_until=GREATEST(COALESCE(b.blocked_until,now()),excluded.blocked_until),updated_at=now()`)}catch{/* migration 030 missing */}
 try{await db.execute(sql`INSERT INTO ch_web.enrichment_provider_limits(provider,next_request_at,blocked_until,error_code) VALUES('metron-api',now(),now()+${wait}*interval '1 second',${code})
  ON CONFLICT(provider) DO UPDATE SET blocked_until=GREATEST(COALESCE(enrichment_provider_limits.blocked_until,now()),excluded.blocked_until),error_code=excluded.error_code,updated_at=now()`)}catch{/* migration 025 missing */}
}
export async function metronBudgetToday(db:CatalogDb){
 try{const r=await db.execute(sql`SELECT used,by_caller FROM ch_web.metron_api_budget WHERE day=(now() AT TIME ZONE 'utc')::date`);return {used:Number(r.rows[0]?.used||0),byCaller:(r.rows[0]?.by_caller||{}) as Record<string,number>,other:await otherUsage(db)}}
 catch{return null}
}

/** Only the character/issue read endpoints this feature needs. */
const PATH=/^(character\/\?page=[1-9][0-9]{0,3}|character\/[1-9][0-9]{0,9}\/|character\/[1-9][0-9]{0,9}\/issue_list\/\?page=[1-9][0-9]{0,3}|issue\/[1-9][0-9]{0,9}\/)$/;
export const allowedMetronPath=(path:string)=>PATH.test(path);
export type MetronFetchResult=
 {status:'ok';body:unknown;sustainedRemaining:number|null}
 |{status:'not_found'}
 |{status:'budget';reason:'day'|'minute'|'blocked'|'unavailable';retryAfterMs:number}
 |{status:'error';code:'no_token'|'rate_limited'|'token_rejected'|'timeout'|'unavailable'|'bad_response';retryAfterMs?:number};
const headerNumber=(headers:Headers,name:string)=>{const v=headers.get(name)?.trim();return v&&/^\d+(\.\d+)?$/.test(v)?Number(v):null};

/** One budgeted GET of an allowlisted Metron API path. */
export async function metronApiGet(db:CatalogDb,path:string,options:{caller:MetronCaller;timeoutMs?:number;fetcher?:typeof fetch;env?:MetronEnv;signal?:AbortSignal}):Promise<MetronFetchResult>{
 if(!allowedMetronPath(path))throw new Error('Metron path not allowed.');
 const env=options.env||process.env,token=metronConfig(env).token;
 if(!token)return {status:'error',code:'no_token'};
 const budget=await reserveMetronCalls(db,options.caller,1,env);
 if(!budget.ok)return {status:'budget',reason:budget.reason,retryAfterMs:budget.retryAfterMs};
 const timeout=AbortSignal.timeout(options.timeoutMs||30000),signal=options.signal?AbortSignal.any([options.signal,timeout]):timeout;
 let response:Response;
 try{response=await (options.fetcher||fetch)(METRON_API_ORIGIN+'/api/'+path,{headers:{Authorization:'Bearer '+token,Accept:'application/json','User-Agent':METRON_USER_AGENT},redirect:'error',signal,cache:'no-store'})}
 catch{return {status:'error',code:timeout.aborted?'timeout':'unavailable'}}
 const sustained=headerNumber(response.headers,'X-RateLimit-Sustained-Remaining');
 if(sustained===0)await blockMetronCalls(db,headerNumber(response.headers,'X-RateLimit-Sustained-Reset')??3600,'metron_daily_limit');
 if(response.status===429){
  const wait=headerNumber(response.headers,'Retry-After')??60;await blockMetronCalls(db,wait,'metron_rate_limited');await response.body?.cancel();
  return {status:'error',code:'rate_limited',retryAfterMs:wait*1000};
 }
 if(response.status===401||response.status===403){await blockMetronCalls(db,3600,'metron_token_rejected');await response.body?.cancel();return {status:'error',code:'token_rejected'}}
 if(response.status===404){await response.body?.cancel();return {status:'not_found'}}
 if(!response.ok){await response.body?.cancel();return {status:'error',code:'unavailable',retryAfterMs:60000}}
 let text:string;try{text=await response.text()}catch{return {status:'error',code:timeout.aborted?'timeout':'unavailable'}}
 if(text.length>2000000||text.includes(token))return {status:'error',code:'bad_response'};
 try{return {status:'ok',body:JSON.parse(text),sustainedRemaining:sustained}}catch{return {status:'error',code:'bad_response'}}
}
