/**
 * Official eBay Browse API (item_summary/search) for ACTIVE listings only. These are asking
 * prices, never sold prices; eBay sold-listing pages are not scraped. Enabled only when
 * EBAY_CLIENT_ID and EBAY_CLIENT_SECRET exist (OAuth client-credentials, public api_scope).
 * Results are cached in memory (TTL ≥ 6h) and every call has a strict timeout. No secret or
 * token is ever logged or returned.
 *
 * Optional env: EBAY_ENV=sandbox, EBAY_MARKETPLACE_ID (default EBAY_US),
 * EBAY_COMICS_CATEGORY_ID (default 259104, "Comics & Graphic Novels"), EBAY_CACHE_TTL_HOURS (≥6).
 */
import {parseCopyGrade} from './issue-insights-core';

export type EbayAsk={itemId:string;title:string;priceUsd:number;url:string|null;mode:'Raw'|'CGC';grade:string|null;label:string};
export type EbayResult={status:'ok';items:EbayAsk[];query:string;fetchedAt:string;searchUrl:string}|{status:'disabled'}|{status:'error';reason:string};
export type EbayQuery={series:string;number:string;year:number;variant?:string|null};

export const EBAY_SETUP_HINT='Create an eBay developer production keyset and set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET to show eBay asking prices (active listings only).';
const SCOPE='https://api.ebay.com/oauth/api_scope';
export function ebayConfigured(env:NodeJS.ProcessEnv=process.env){return !!(env.EBAY_CLIENT_ID&&env.EBAY_CLIENT_SECRET)}
const hosts=(env:NodeJS.ProcessEnv)=>env.EBAY_ENV==='sandbox'?{api:'https://api.sandbox.ebay.com',web:'https://www.sandbox.ebay.com'}:{api:'https://api.ebay.com',web:'https://www.ebay.com'};

let token:{value:string;expires:number;key:string}|null=null;
const cache=new Map<string,{expires:number;value:EbayResult}>();
const MAX_CACHE=500;
export function clearEbayCache(){cache.clear();token=null}

async function accessToken(env:NodeJS.ProcessEnv,timeoutMs:number,fetcher:typeof fetch){
 const key=env.EBAY_CLIENT_ID+'|'+(env.EBAY_ENV||'production');
 if(token&&token.key===key&&token.expires>Date.now())return token.value;
 const basic=Buffer.from(env.EBAY_CLIENT_ID+':'+env.EBAY_CLIENT_SECRET).toString('base64');
 const response=await fetcher(hosts(env).api+'/identity/v1/oauth2/token',{method:'POST',headers:{Authorization:'Basic '+basic,'Content-Type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({grant_type:'client_credentials',scope:SCOPE}).toString(),signal:AbortSignal.timeout(timeoutMs),redirect:'error',cache:'no-store'});
 if(!response.ok){await response.body?.cancel();throw Error('ebay_oauth_'+response.status)}
 const body=await response.json() as {access_token?:unknown;expires_in?:unknown};
 if(typeof body.access_token!=='string')throw Error('ebay_oauth_invalid');
 const ttl=Math.max(60,Number(body.expires_in)||7200);
 token={value:body.access_token,expires:Date.now()+(ttl-120)*1000,key};
 return token.value;
}

const words=(text:string)=>text.toLowerCase().replace(/^the\s+/,'').replace(/[^a-z0-9]+/g,' ').trim().split(' ').filter(w=>w&&!['the','of','and','a'].includes(w));
/** Reject obvious mismatches: other issues, reprints/facsimiles, lots, unrequested variants, non-comics. */
export function ebayTitleMatches(title:string,query:EbayQuery):boolean{
 const t=' '+title.toLowerCase().replace(/[^a-z0-9#.]+/g,' ')+' ';
 if(/\b(reprint|facsimile|replica|reproduction|lot|lots|set of|bundle|complete run|run of|poster|print only|art print|tpb|trade paperback|omnibus|hardcover|digital|custom|homage|sketch|slab only|empty slab|funko|figure|toy|shirt|magnet|pin)\b/.test(t))return false;
 const variantRequested=!!query.variant&&/variant|virgin|ratio|\b(2nd|3rd|second|third|later) print/i.test(query.variant);
 if(!variantRequested&&/\b(variant|virgin|ratio|1 ?: ?\d+|2nd print|3rd print|second print|third print|later print|reprint|foil|exclusive)\b/.test(t))return false;
 const tw=new Set(words(title));
 if(!words(query.series).every(w=>tw.has(w)||(w==='spider'&&tw.has('spiderman'))||(w==='man'&&tw.has('spiderman'))))return false;
 const number=query.number.toLowerCase().replace(/^#/,'');
 if(!new RegExp('(?:#|\\bno\\.? ?|\\bissue ?|\\s)'+number.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![0-9])').test(t))return false;
 const years=[...t.matchAll(/\b(19[3-9][0-9]|20[0-4][0-9])\b/g)].map(m=>Number(m[1]));
 if(years.length&&!years.some(y=>Math.abs(y-query.year)<=1))return false;
 return true;
}

export async function ebayAskingPrices(query:EbayQuery,env:NodeJS.ProcessEnv=process.env,options:{timeoutMs?:number;fetcher?:typeof fetch;now?:number}={}):Promise<EbayResult>{
 if(!ebayConfigured(env))return {status:'disabled'};
 const q=[query.series.replace(/\s*\(\d{4}\)\s*$/,''),query.number?'#'+query.number:'',query.year||''].filter(Boolean).join(' ').trim();
 const category=/^\d{1,9}$/.test(env.EBAY_COMICS_CATEGORY_ID||'')?env.EBAY_COMICS_CATEGORY_ID!:'259104';
 const marketplace=/^EBAY_[A-Z_]{2,8}$/.test(env.EBAY_MARKETPLACE_ID||'')?env.EBAY_MARKETPLACE_ID!:'EBAY_US';
 const key=[env.EBAY_ENV||'production',marketplace,category,q.toLowerCase(),query.variant||''].join('|');
 const now=options.now??Date.now(),hit=cache.get(key);
 if(hit&&hit.expires>now)return hit.value;
 const timeoutMs=options.timeoutMs??2500,fetcher=options.fetcher??fetch;
 const ttlHours=Math.max(6,Number(env.EBAY_CACHE_TTL_HOURS)||12);
 const store=(value:EbayResult,ttlMs:number)=>{if(cache.size>=MAX_CACHE)cache.delete(cache.keys().next().value!);cache.set(key,{expires:now+ttlMs,value});return value};
 try{
  const bearer=await accessToken(env,timeoutMs,fetcher);
  const url=new URL(hosts(env).api+'/buy/browse/v1/item_summary/search');
  url.searchParams.set('q',q);url.searchParams.set('category_ids',category);url.searchParams.set('limit','50');
  url.searchParams.set('filter','buyingOptions:{FIXED_PRICE},priceCurrency:USD');
  const response=await fetcher(url,{headers:{Authorization:'Bearer '+bearer,'X-EBAY-C-MARKETPLACE-ID':marketplace,Accept:'application/json'},signal:AbortSignal.timeout(timeoutMs),redirect:'error',cache:'no-store'});
  if(!response.ok){await response.body?.cancel();if(response.status===401)token=null;return store({status:'error',reason:'ebay_http_'+response.status},10*60_000)}
  const body=await response.json() as {itemSummaries?:{itemId?:unknown;title?:unknown;price?:{value?:unknown;currency?:unknown};itemWebUrl?:unknown}[]};
  const items:EbayAsk[]=[];
  for(const row of Array.isArray(body.itemSummaries)?body.itemSummaries:[]){
   if(typeof row.itemId!=='string'||typeof row.title!=='string'||row.price?.currency!=='USD')continue;
   const price=Number(row.price.value);if(!Number.isFinite(price)||price<=0||price>10_000_000)continue;
   if(!ebayTitleMatches(row.title,query))continue;
   const grade=parseCopyGrade(row.title);if(!grade)continue; // CBCS/PGX etc. are not comparable buckets.
   const web=typeof row.itemWebUrl==='string'&&/^https:\/\/(www\.)?(sandbox\.)?ebay\.com\//.test(row.itemWebUrl)?row.itemWebUrl:null;
   items.push({itemId:row.itemId.slice(0,100),title:row.title.slice(0,200),priceUsd:price,url:web,...grade});
  }
  const searchUrl=hosts(env).web+'/sch/i.html?'+new URLSearchParams({_nkw:q,_sacat:category}).toString();
  return store({status:'ok',items,query:q,fetchedAt:new Date(now).toISOString(),searchUrl},ttlHours*3600_000);
 }catch(error){
  const reason=error instanceof Error&&/^ebay_/.test(error.message)?error.message:error instanceof Error&&error.name==='TimeoutError'?'ebay_timeout':'ebay_unavailable';
  return store({status:'error',reason},5*60_000);
 }
}
