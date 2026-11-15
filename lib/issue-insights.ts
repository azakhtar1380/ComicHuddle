/**
 * Sales & Value insights: gathers every permitted price/demand signal for one issue and hands
 * it to the deterministic engine in ./issue-insights-core. Each source is read independently
 * (own try/catch + timeout), so a missing table or slow source is skipped, never fatal.
 *
 * Permitted sources only: licensed FMV rows (gcd.fmv_records/fmv_history, ch_web.market_values),
 * verified licensed/authorized sold comps (gcd.sales_comps), CGC-reported sales
 * (lib/reported-sales.ts), ComicHuddle completed sales, listings, auctions and demand, and the
 * official eBay Browse API (asking prices) when keys exist. No scraping, no AI/model calls.
 */
import {sql,type SQL} from 'drizzle-orm';
import type {CatalogDb} from './catalog-store';
import {catalog} from './catalog';
import {CURATED_GCD_IDS,coverLookupId} from './curated-cover-ids';
import {computeInsights,normalizeGrade,normalizeLabel,parseCopyGrade,reportedSaleObservations,SOURCE_WEIGHTS,type InsightsResponse,type Observation} from './issue-insights-core';
import {EBAY_SETUP_HINT,ebayAskingPrices,ebayConfigured} from './ebay-browse';

const GCD_OFFSET=4_000_000_000,METRON_OFFSET=1_000_000_000,MAX_ID=6_500_000_000;
const SOURCE_TIMEOUT_MS=2500;

export type ResolvedIssue={issueId:number;curatedId:number|null;nativeId:number|null;gcdId:number|null;metronId:number|null;ids:number[];title:string;number:string;year:number;variant:string;coverPriceText:string|null};
type DirectoryData={title?:unknown;number?:unknown;year?:unknown;variant?:unknown;metronId?:unknown;bibliography?:{originalCoverPrice?:{text?:unknown}}};
const curatedByGcd=new Map(Object.entries(CURATED_GCD_IDS).map(([curated,gcd])=>[gcd,Number(curated)]));
const rowsOf=(result:unknown)=>((result as {rows?:Record<string,unknown>[]}).rows)||[];
const parseData=(raw:unknown):DirectoryData|null=>{if(raw&&typeof raw==='object')return raw as DirectoryData;if(typeof raw!=='string')return null;try{return JSON.parse(raw) as DirectoryData}catch{return null}};

export function validIssueId(raw:string):number|null{
 if(!/^\d{1,10}$/.test(raw))return null;const id=Number(raw);return Number.isSafeInteger(id)&&id<=MAX_ID?id:null;
}

/** Curated ids (lib/catalog.ts) and GCD catalog ids (4e9 + GCD id) resolve to the same book. */
export async function resolveIssue(db:CatalogDb,id:number):Promise<ResolvedIssue|null>{
 const curated=id<METRON_OFFSET?catalog.find(issue=>issue.id===id)||null:null;
 const nativeId=id>=GCD_OFFSET?id:curated?coverLookupId(id):null;
 const curatedId=curated?id:nativeId!==null?curatedByGcd.get(nativeId-GCD_OFFSET)??null:null;
 let data:DirectoryData|null=null;
 if(nativeId!==null){
  try{data=parseData(rowsOf(await db.execute(sql`SELECT data FROM gcd.comichuddle_native_directory WHERE id=${nativeId} LIMIT 1`))[0]?.data)}catch{data=null}
  if(!data&&id>=GCD_OFFSET)return null;
 }else if(!curated){
  try{data=parseData(rowsOf(await db.execute(sql`SELECT data FROM gcd.comichuddle_legacy_directory WHERE id=${id} LIMIT 1`))[0]?.data)}catch{data=null}
  if(!data)return null;
 }
 const fallback=curatedId!==null?catalog.find(issue=>issue.id===curatedId):undefined;
 const title=String(fallback?.title??data?.title??''),number=String(fallback?.number??data?.number??''),year=Number(fallback?.year??data?.year??0);
 const metronId=id>=METRON_OFFSET&&id<GCD_OFFSET?id-METRON_OFFSET:Number.isSafeInteger(Number(data?.metronId))?Number(data?.metronId):null;
 const cover=data?.bibliography?.originalCoverPrice?.text;
 const ids=[...new Set([id,curatedId,nativeId].filter((v):v is number=>v!==null))];
 return {issueId:id,curatedId,nativeId,gcdId:nativeId!==null?nativeId-GCD_OFFSET:null,metronId,ids,title,number,year,
  variant:String(data?.variant??fallback?.variant??''),coverPriceText:typeof cover==='string'&&cover.trim()?cover.trim():null};
}

function withTimeout<T>(work:Promise<T>,ms=SOURCE_TIMEOUT_MS):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 return Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('source_timeout')),ms)})]).finally(()=>clearTimeout(timer));
}
const iso=(v:unknown)=>{const t=v instanceof Date?v.getTime():Date.parse(String(v));return Number.isFinite(t)?new Date(t).toISOString():null};
const idList=(ids:number[])=>sql.join(ids.map(id=>sql`${id}`),sql`,`);
const textList=(values:string[])=>sql.join(values.map(v=>sql`${v}`),sql`,`);

/** Single-copy listings for this issue: issue_id, curated catalogId, or exact GCD/Metron identity. */
function listingMatch(issue:ResolvedIssue):SQL{
 const idTexts=issue.ids.map(String);
 const external=[
  issue.gcdId!==null?sql`(item->'externalCatalog'->>'provider'='GCD' AND item->'externalCatalog'->>'id'=${String(issue.gcdId)})`:null,
  issue.metronId!==null?sql`(item->'externalCatalog'->>'provider'='Metron' AND item->'externalCatalog'->>'id'=${String(issue.metronId)})`:null,
 ].filter((v):v is SQL=>v!==null);
 return sql`(l.issue_id IN (${idList(issue.ids)}) OR (l.items LIKE '[%' AND EXISTS(SELECT 1 FROM jsonb_array_elements(l.items::jsonb) item WHERE item->>'catalogId' IN (${textList(idTexts)})${external.length?sql` OR ${sql.join(external,sql` OR `)}`:sql``})))`;
}

type Collected={observations:Observation[];askSources:string[];auctions:{active:number;highestBid:number|null;endsAt:string|null};demand:{wants:number|null;collections:number|null};sources:InsightsResponse['sources'];missing:InsightsResponse['missingSources']};

export async function collectObservations(db:CatalogDb,issue:ResolvedIssue,env:NodeJS.ProcessEnv=process.env):Promise<Collected>{
 const out:Collected={observations:[],askSources:[],auctions:{active:0,highestBid:null,endsAt:null},demand:{wants:null,collections:null},sources:[],missing:[]};
 const failed=new Set<string>();
 const run=async(name:string,work:()=>Promise<void>)=>{try{await withTimeout(work())}catch{failed.add(name)}};
 const ids=issue.ids;

 // 1. CGC-reported individual sales (curated ids only).
 const reported=reportedSaleObservations(issue.curatedId);
 out.observations.push(...reported);
 for(const url of [...new Set(reported.map(r=>r.url).filter((u):u is string=>!!u))])
  out.sources.push({name:'CGC-reported sales',url,note:'Individual sales reported by CGC (dated results, not FMV).'});

 await Promise.all([
  // 2. Licensed FMV (current rows + history for trend).
  run('Licensed FMV',async()=>{
   const [current,history]=await Promise.all([
    db.execute(sql`SELECT issue_id,mode,grade,label,printing,fmv_price,low_price,high_price,last_updated,sample_size,window_days,source_name,source_url FROM gcd.fmv_records WHERE issue_id IN (${idList(ids)}) AND valid_until>now() AND printing<>'Later printing'`),
    db.execute(sql`SELECT mode,grade,label,observed_on,fmv_price,sample_size,source_name FROM gcd.fmv_history WHERE issue_id IN (${idList(ids)}) AND observed_on>=(now()-interval '730 days')::date AND printing<>'Later printing' ORDER BY observed_on DESC LIMIT 400`),
   ]);
   const seen=new Set<string>();
   for(const r of rowsOf(current)){
    if(r.mode!=='Raw'&&r.mode!=='CGC')continue;const mode=r.mode as 'Raw'|'CGC',date=iso(r.last_updated);if(!date)continue;
    out.observations.push({source:'licensed_fmv',sourceName:'Licensed FMV',kind:'fmv',amountUsd:Number(r.fmv_price),low:Number(r.low_price),high:Number(r.high_price),date,
     grade:normalizeGrade(r.grade),label:normalizeLabel(r.label,mode),mode,venue:String(r.source_name),url:String(r.source_url),weight:SOURCE_WEIGHTS.licensed_fmv*(1+Math.log2(Math.max(1,Number(r.sample_size)||1))),
     sampleSize:Number(r.sample_size),windowDays:Number(r.window_days),confirmed:false,entity:'fmv:'+String(r.source_name)});
    if(!seen.has(String(r.source_name))){seen.add(String(r.source_name));out.sources.push({name:'Licensed FMV · '+String(r.source_name),url:String(r.source_url)||null,note:'Licensed completed-sales median (rolling window).'})}
   }
   for(const r of rowsOf(history)){
    if(r.mode!=='Raw'&&r.mode!=='CGC')continue;const mode=r.mode as 'Raw'|'CGC',date=iso(r.observed_on);if(!date)continue;
    out.observations.push({source:'licensed_fmv',sourceName:'Licensed FMV',kind:'fmv',amountUsd:Number(r.fmv_price),date,grade:normalizeGrade(r.grade),label:normalizeLabel(r.label,mode),mode,
     weight:SOURCE_WEIGHTS.licensed_fmv,sampleSize:Number(r.sample_size),historyOnly:true});
   }
  }),
  // 3. Licensed production values in ch_web.market_values (attributable, unexpired rights only).
  run('Licensed market values',async()=>{
   const result=await db.execute(sql`SELECT mode,grade,label,printing,fmv,low,high,sales,window_days,updated_at,source_name,source_url,rights_expires_at FROM ch_web.market_values WHERE issue_id IN (${idList(ids)}) AND license_reference<>'' AND printing<>'Later printing'`);
   for(const r of rowsOf(result)){
    if(r.mode!=='Raw'&&r.mode!=='CGC')continue;
    const expires=Date.parse(String(r.rights_expires_at||''));if(String(r.rights_expires_at||'')&&!(expires>Date.now()))continue;
    const mode=r.mode as 'Raw'|'CGC',date=iso(r.updated_at);if(!date||!(Number(r.fmv)>0))continue;
    out.observations.push({source:'licensed_fmv',sourceName:'Licensed FMV',kind:'fmv',amountUsd:Number(r.fmv),low:Number(r.low),high:Number(r.high),date,grade:normalizeGrade(r.grade),label:normalizeLabel(r.label,mode),mode,
     venue:String(r.source_name),url:String(r.source_url)||null,weight:SOURCE_WEIGHTS.licensed_fmv*(1+Math.log2(Math.max(1,Number(r.sales)||1))),sampleSize:Number(r.sales),windowDays:Number(r.window_days),entity:'fmv:'+String(r.source_name)});
    out.sources.push({name:'Licensed FMV · '+String(r.source_name),url:String(r.source_url)||null,note:'Licensed, attributable market value.'});
   }
  }),
  // 4. Verified licensed / authorized completed sales (gcd.sales_comps).
  run('Licensed sold comps',async()=>{
   const result=await db.execute(sql`SELECT source,source_reference,source_url,mode,grade,label,sold_at,price_cents FROM gcd.sales_comps WHERE issue_id IN (${idList(ids)}) AND verified AND actual_price_confirmed AND rights_expires_at>now() AND printing<>'Later printing' ORDER BY sold_at DESC LIMIT 500`);
   const names=new Set<string>();
   for(const r of rowsOf(result)){
    if(r.mode!=='Raw'&&r.mode!=='CGC')continue;const mode=r.mode as 'Raw'|'CGC',date=iso(r.sold_at);if(!date)continue;
    const name=r.source==='authorized_ebay'?'eBay completed sales (authorized)':r.source==='platform'?'ComicHuddle verified completed sales':'Licensed completed sales';names.add(name);
    out.observations.push({source:'licensed_sale',sourceName:name,kind:'sale',amountUsd:Number(r.price_cents)/100,date,grade:normalizeGrade(r.grade),label:normalizeLabel(r.label,mode),mode,
     venue:r.source==='authorized_ebay'?'eBay':r.source==='platform'?'ComicHuddle':'Licensed feed',url:String(r.source_url),weight:SOURCE_WEIGHTS.licensed_sale,confirmed:true,entity:String(r.source)+':'+String(r.source_reference).slice(0,40)});
   }
   for(const name of names)out.sources.push({name,url:null,note:'Verified completed sales under an active redistribution grant.'});
  }),
  // 5. ComicHuddle completed sales (single-copy listings) and paid auction results.
  run('ComicHuddle sales',async()=>{
   const result=await db.execute(sql`SELECT l.id,l.grade,l.title,s.gross_cents,s.payment_verified,s.source,s.sold_at,s.seller_user_id FROM ch_web.marketplace_sales s JOIN ch_web.listings l ON l.id=s.listing_id
    WHERE l.kind='single' AND l.status='sold' AND s.gross_cents>0 AND ${listingMatch(issue)} ORDER BY s.sold_at DESC LIMIT 200`);
   let auctions={rows:[] as Record<string,unknown>[]};
   try{auctions={rows:rowsOf(await db.execute(sql`SELECT l.id,l.grade,t.winning_cents,t.resolved_at,l.seller_id FROM ch_web.marketplace_auction_terms t JOIN ch_web.listings l ON l.id=t.listing_id
    WHERE t.result='paid' AND t.winning_cents>0 AND l.kind='single' AND ${listingMatch(issue)} AND NOT EXISTS(SELECT 1 FROM ch_web.marketplace_sales s WHERE s.listing_id=l.id) LIMIT 100`))}}catch{/* auction tables optional */}
   let any=false;
   for(const r of rowsOf(result)){
    const copy=parseCopyGrade(String(r.grade||'')),date=iso(r.sold_at);if(!copy||!date)continue;any=true;
    const verified=Number(r.payment_verified)===1;
    out.observations.push({source:verified?'platform_sale':'platform_reported_sale',sourceName:verified?'ComicHuddle verified sales':'ComicHuddle seller-reported sales',kind:'sale',amountUsd:Number(r.gross_cents)/100,date,...copy,
     venue:'ComicHuddle',url:null,weight:verified?SOURCE_WEIGHTS.platform_sale:SOURCE_WEIGHTS.platform_reported_sale,confirmed:verified,entity:'seller:'+String(r.seller_user_id)});
   }
   for(const r of auctions.rows){
    const copy=parseCopyGrade(String(r.grade||'')),date=iso(r.resolved_at);if(!copy||!date)continue;any=true;
    out.observations.push({source:'platform_sale',sourceName:'ComicHuddle verified sales',kind:'sale',amountUsd:Number(r.winning_cents)/100,date,...copy,venue:'ComicHuddle auction',url:null,
     weight:SOURCE_WEIGHTS.platform_sale,confirmed:true,entity:'seller:'+String(r.seller_id)});
   }
   if(any)out.sources.push({name:'ComicHuddle sales',url:null,note:'Completed single-copy sales on ComicHuddle; seller-reported sales are weighted lower.'});
  }),
  // 6. ComicHuddle active listings (asks) and live auctions, public sellers only.
  run('ComicHuddle listings',async()=>{
   const stamp=new Date().toISOString();
   const result=await db.execute(sql`SELECT l.grade,l.price,l.sale_type,l.current_bid,l.end_at FROM ch_web.listings l JOIN ch_web.profiles p ON p.id=l.seller_id
    WHERE l.status='active' AND l.kind='single' AND p.visible=1 AND p.moderated=0 AND p.deletion_started_at IS NULL AND ${listingMatch(issue)} LIMIT 300`);
   let active=0,highest:number|null=null,ends:string|null=null;
   for(const r of rowsOf(result)){
    if(r.sale_type==='auction'){
     if(!(String(r.end_at)>stamp))continue;active++;
     if(r.current_bid!==null&&Number(r.current_bid)>0)highest=Math.max(highest??0,Number(r.current_bid)/100);
     const end=iso(r.end_at);if(end&&(!ends||end<ends))ends=end;continue;
    }
    const copy=parseCopyGrade(String(r.grade||''))||{mode:'Raw' as const,grade:null,label:'Raw'};
    out.observations.push({source:'platform_ask',sourceName:'ComicHuddle listings',kind:'ask',amountUsd:Number(r.price)/100,date:stamp,...copy,venue:'ComicHuddle',weight:SOURCE_WEIGHTS.platform_ask});
   }
   out.askSources.push('ComicHuddle listings');
   out.auctions={active,highestBid:highest,endsAt:ends};
  }),
  // 7. Demand: aggregate want-list and collection counts (no user data leaves this function).
  run('ComicHuddle demand',async()=>{
   const idTexts=ids.map(String),patterns=[...idTexts,...(issue.gcdId!==null?[String(issue.gcdId)]:[])].map(v=>'%'+v+'%');
   const prefilter=sql.join(patterns.map(p=>sql`c.data LIKE ${p}`),sql` OR `);
   const result=await db.execute(sql`SELECT
     count(*) FILTER (WHERE EXISTS(SELECT 1 FROM jsonb_array_elements_text(COALESCE(c.data::jsonb->'wants','[]'::jsonb)) w WHERE w IN (${textList(idTexts)}))) AS wants,
     count(*) FILTER (WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(c.data::jsonb->'books','[]'::jsonb)) b WHERE b->>'catalogId' IN (${textList(idTexts)})
       ${issue.gcdId!==null?sql`OR (b->'externalCatalog'->>'provider'='GCD' AND b->'externalCatalog'->>'id'=${String(issue.gcdId)})`:sql``}
       ${issue.metronId!==null?sql`OR (b->'externalCatalog'->>'provider'='Metron' AND b->'externalCatalog'->>'id'=${String(issue.metronId)})`:sql``})) AS owners
    FROM ch_web.collections c WHERE (${prefilter}) AND c.data LIKE '{%'`);
   const row=rowsOf(result)[0]||{};
   out.demand={wants:Number(row.wants||0),collections:Number(row.owners||0)};
  }),
  // 8. eBay Browse API: asking prices only, when configured.
  (async()=>{
   if(!ebayConfigured(env)){out.missing.push({name:'eBay asking prices',setup:EBAY_SETUP_HINT});return}
   if(!issue.title||!issue.number){return}
   const result=await ebayAskingPrices({series:issue.title,number:issue.number,year:issue.year,variant:issue.variant},env);
   if(result.status!=='ok'){if(result.status==='error')failed.add('eBay asking prices');return}
   out.askSources.push('eBay asking prices');
   for(const item of result.items)out.observations.push({source:'ebay_ask',sourceName:'eBay asking prices',kind:'ask',amountUsd:item.priceUsd,date:result.fetchedAt,mode:item.mode,grade:item.grade,label:item.label,venue:'eBay',url:item.url,weight:SOURCE_WEIGHTS.ebay_ask});
   out.sources.push({name:'eBay asking prices',url:result.searchUrl,note:'Active eBay listings via the official Browse API. Asking prices only — not sales.'});
  })(),
 ]);

 if(!(env.FMV_LICENSED_FEED_URL&&env.FMV_LICENSED_FEED_TOKEN))out.missing.push({name:'Licensed completed-sales feed',setup:'Connect an authorized sales feed (FMV_WEEKLY_SYNC_ENABLED, FMV_LICENSED_FEED_URL, FMV_LICENSED_FEED_TOKEN, FMV_LICENSED_FEED_HOSTS) or import licensed comps; see docs/MARKET-DATA-SETUP.md.'});
 for(const name of failed)out.missing.push({name,setup:'Temporarily unavailable; results shown without this source.'});
 if(failed.has('ComicHuddle demand'))out.demand={wants:null,collections:null};
 return out;
}

const responseCache=new Map<string,{expires:number;value:InsightsResponse}>();
/** null → unknown issue (404). */
export async function issueInsights(db:CatalogDb,id:number,options:{grade?:string|null;env?:NodeJS.ProcessEnv;now?:number}={}):Promise<InsightsResponse|null>{
 const grade=options.grade?normalizeGrade(options.grade):null,key=id+'|'+(grade||''),now=options.now??Date.now();
 const hit=responseCache.get(key);if(hit&&hit.expires>now)return hit.value;
 const issue=await resolveIssue(db,id);if(!issue)return null;
 const collected=await collectObservations(db,issue,options.env??process.env);
 const value=computeInsights({issueId:id,now,observations:collected.observations,requestedGrade:grade,askSources:collected.askSources,auctions:collected.auctions,demand:collected.demand,
  coverPriceText:issue.coverPriceText,sources:collected.sources,missingSources:collected.missing});
 if(responseCache.size>1000)responseCache.delete(responseCache.keys().next().value!);
 responseCache.set(key,{expires:now+60_000,value});
 return value;
}
