import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {S3Client,PutObjectCommand,DeleteObjectsCommand} from '@aws-sdk/client-s3';
import {CloudFrontClient,CreateInvalidationCommand} from '@aws-sdk/client-cloudfront';
import {sql} from 'drizzle-orm';
import {z} from 'zod';
import {catalogIssuesById,type CatalogDb} from './catalog-store';
import {approvedSourceFetch,CoverSourceError} from './cover-source-fetch';
import {enqueueEnrichment,finishEnrichment,providerTurn,retryDelay,type EnrichmentJob} from './enrichment-jobs';
import {coverStatusMessage,type CoverResolution,type CoverStatus} from './cover-cache-types';
import {METRON_COVER_HOST,MetronLookupError,metronConfig,metronCoverForGcd,metronImageUrl} from './metron-identifiers';
import {METRON_COVER_ATTRIBUTION} from './data-credits';
import {fallbackCovers} from './community-covers';
import {metronCdnCovers} from './metron-cover-index';
import {catalogArtCovers} from './cover-policy';

export function coverStorageStatus(){
 const {COVER_STORAGE_BUCKET:bucket,COVER_CDN_BASE_URL:base,COVER_CLOUDFRONT_DISTRIBUTION_ID:distribution}=process.env;
 const credentials=!!(process.env.AWS_ACCESS_KEY_ID&&process.env.AWS_SECRET_ACCESS_KEY||process.env.AWS_WEB_IDENTITY_TOKEN_FILE&&process.env.AWS_ROLE_ARN);
 let url:URL|null=null;try{url=base?new URL(base):null}catch{}
 const ready=!!(bucket&&url?.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&distribution&&credentials&&process.env.COVER_STORAGE_REVIEWED==='true');
 return {ready,bucket:bucket||null,base:ready?url!.href.replace(/\/$/,''):null,distribution:distribution||null,reason:ready?null:'Approved S3 bucket, CloudFront domain/distribution, service credentials and storage policy review are required.'};
}
type Permission={provider:string;enabled:boolean;access_allowed:boolean;cache_allowed:boolean;display_allowed:boolean;ai_allowed:boolean;evidence_reference:string;attribution:string;approved_hosts:string[];valid_until:Date;revoked_at:Date|null};
export type CoverProvider='GCD'|'METRON';
async function permission(db:CatalogDb,provider:CoverProvider='GCD'){const rows=await db.execute(sql`SELECT * FROM ch_web.source_permissions WHERE provider=${provider}`);const row=rows.rows[0] as unknown as Permission|undefined;return row&&row.enabled&&row.access_allowed&&row.cache_allowed&&row.display_allowed&&!row.revoked_at&&new Date(row.valid_until).getTime()>Date.now()?row:null}
/** S3/CDN source: a reviewed GCD grant wins; a reviewed METRON grant needs the server token too. */
async function activeGrant(db:CatalogDb):Promise<{provider:CoverProvider;grant:Permission}|null>{
 const gcd=await permission(db,'GCD');if(gcd)return {provider:'GCD',grant:gcd};
 if(!metronConfig().token)return null;const metron=await permission(db,'METRON');return metron?{provider:'METRON',grant:metron}:null;
}
const providerLimitKey=(provider:CoverProvider)=>provider==='GCD'?'GCD-covers':'METRON-covers';
const jobKey=(provider:CoverProvider,issueId:number)=>provider==='GCD'?String(issueId):'metron-s3:'+issueId;
type Rendition={key:string;width:number;height:number;bytes:number};
type CacheRow={issue_id:number;status:CoverStatus;renditions:Record<string,Rendition>;attribution:string;source_url:string|null;updated_at:Date;permission_reference:string;permission_expires_at:Date;next_retry_at:Date|null};
export async function resolveCoverBatch(db:CatalogDb,ids:number[]):Promise<CoverResolution[]>{
 // Members' photos always win (seller front photo, then collector cover). Catalog art only fills the
 // rest when CATALOG_ART_COVERS=on (lib/cover-policy.ts); otherwise nothing else is looked up or queued.
 if(!catalogArtCovers())return withFallbackResolutions(db,ids.map(issueId=>({issueId,status:'DISABLED' as const,url:null,attribution:'',message:coverStatusMessage('DISABLED')})));
 // Art on — priority: reviewed local /covers/ file, GCD/S3 cache (both in resolveStoredCoverBatch), the owner's
 // Metron CDN copy, Metron direct hotlink, then seller photo / collector cover.
 let results=await resolveStoredCoverBatch(db,ids);
 const uncopied=results.filter(row=>!row.url).map(row=>row.issueId);
 if(uncopied.length){const copies=await metronCdnCovers(db,uncopied);if(copies.size)results=results.map(row=>{const copy=row.url?null:copies.get(row.issueId);return copy?{issueId:row.issueId,status:'CACHED' as const,url:copy.url,srcSet:copy.srcSet,attribution:copy.attribution,sourceUrl:copy.source,message:'Catalog reference art'}:row})}
 // Owner-controlled interim mode: show Metron's own image URL, cached per issue.
 if(metronConfig().directCovers){
  const unresolved=results.filter(row=>!row.url&&row.issueId>4000000000).map(row=>row.issueId);
  if(unresolved.length){const direct=await resolveDirectMetronCovers(db,unresolved);results=results.map(row=>direct.get(row.issueId)||row)}
 }
 return withFallbackResolutions(db,results);
}
/** Members' photos first: a seller photo, then a collector cover, replaces any catalog result. */
async function withFallbackResolutions(db:CatalogDb,results:CoverResolution[]){
 if(!results.length)return results;
 const fallback=await fallbackCovers(db,results.map(row=>row.issueId));
 return results.map(row=>{const cover=fallback.get(row.issueId);return cover?{issueId:row.issueId,status:'CACHED' as const,url:cover.url,attribution:cover.attribution,sourceUrl:cover.source,message:cover.attribution}:row});
}
async function resolveStoredCoverBatch(db:CatalogDb,ids:number[]):Promise<CoverResolution[]>{
 const storage=coverStorageStatus(),active=await activeGrant(db),grant=active?.grant||null,provider:CoverProvider=active?.provider||'GCD',rows=ids.length?await db.execute(sql`SELECT DISTINCT ON(issue_id) issue_id,status,renditions,attribution,source_url,updated_at,permission_reference,permission_expires_at,next_retry_at FROM ch_web.cover_cache WHERE issue_id IN (${sql.join(ids.map(id=>sql`${id}`),sql`,`)}) AND source_provider=${provider} ORDER BY issue_id,(status='CACHED') DESC,updated_at DESC`):{rows:[]},found=new Map((rows.rows as unknown as CacheRow[]).map(row=>[Number(row.issue_id),row]));
 const missing=ids.filter(id=>!found.has(id)||['FAILED','RATE_LIMITED','NOT_FOUND'].includes(found.get(id)?.status||'')&&new Date(found.get(id)!.next_retry_at||0).getTime()<=Date.now()||found.get(id)?.status==='CACHED'&&(found.get(id)?.permission_reference!==grant?.evidence_reference||new Date(found.get(id)!.permission_expires_at).getTime()<=Date.now())),issues=missing.length?await catalogIssuesById(db,missing):[];
 const local=new Map(issues.filter(issue=>issue.cover?.startsWith('/covers/')).map(issue=>[issue.id,issue]));
 const eligible=new Set(issues.filter(issue=>issue.gcdId&&issue.id===4000000000+issue.gcdId).map(issue=>issue.id));
 if(grant&&storage.ready&&process.env.ENRICHMENT_COVERS_ENABLED==='true')for(const issue of issues){if(!eligible.has(issue.id))continue;await db.execute(sql`INSERT INTO ch_web.enrichment_catalog_refs(issue_id,source_provider,source_id) VALUES(${issue.id},${provider},${issue.gcdId!}) ON CONFLICT DO NOTHING`);await db.execute(sql`INSERT INTO ch_web.cover_cache(id,issue_id,source_provider,source_cover_id,permission_reference,status,attribution,permission_expires_at) VALUES(${randomUUID()}::uuid,${issue.id},${provider},'resolution',${grant.evidence_reference},'PENDING',${grant.attribution},${new Date(grant.valid_until).toISOString()}::timestamptz) ON CONFLICT(issue_id,source_provider,source_cover_id) DO UPDATE SET status='PENDING',permission_reference=excluded.permission_reference,permission_expires_at=excluded.permission_expires_at,updated_at=now() WHERE cover_cache.status IN ('NOT_FOUND','FAILED','RATE_LIMITED','DISABLED')`);await enqueueEnrichment(db,'cover',jobKey(provider,issue.id),{issueId:issue.id,gcdId:issue.gcdId,provider});}
 return ids.map(issueId=>{
  const reviewed=local.get(issueId);if(reviewed?.cover)return {issueId,status:'CACHED' as const,url:reviewed.cover,attribution:reviewed.coverCredit||'Reviewed public-domain reference cover',message:'Reviewed local reference cover'};
  const row=found.get(issueId),allowed=!!(grant&&row?.permission_reference===grant.evidence_reference&&new Date(row.permission_expires_at).getTime()>Date.now()),cached=allowed&&row?.status==='CACHED'&&storage.ready;
  if(cached){const card=row.renditions.card,dense=row.renditions.dense;return {issueId,status:'CACHED',url:card?storage.base+'/'+card.key:null,srcSet:card&&dense?storage.base+'/'+card.key+' '+card.width+'w, '+storage.base+'/'+dense.key+' '+dense.width+'w':undefined,attribution:row.attribution,sourceUrl:row.source_url||undefined,message:'Catalog reference art',updatedAt:new Date(row.updated_at).toISOString()}}
  const status:CoverStatus=!grant||!storage.ready||process.env.ENRICHMENT_COVERS_ENABLED!=='true'?'DISABLED':(eligible.has(issueId)&&missing.includes(issueId)?'PENDING':row?.status)||(eligible.has(issueId)?'PENDING':'DISABLED');
  return {issueId,status,url:null,attribution:'',message:coverStatusMessage(status),...(row?{updatedAt:new Date(row.updated_at).toISOString()}:{})};
 });
}
const coverItem=z.object({id:z.union([z.number().int().positive(),z.string().regex(/^[A-Za-z0-9_-]{1,100}$/)]).optional(),issue_id:z.number().int().positive().optional(),url:z.string().optional(),image_url:z.string().optional(),cover_url:z.string().optional()}).passthrough();
export function parseGcdCoverResponse(value:unknown,gcdId:number){
 const body=z.object({api_url:z.string(),cover_url:z.string().nullable().optional(),cover:z.union([z.string(),coverItem,z.null()]).optional(),covers:z.array(coverItem).max(30).optional()}).passthrough().parse(value);
 if(body.api_url.replace(/\/$/,'')!=='https://www.comics.org/api/issue/'+gcdId)throw new CoverSourceError('wrong_issue_association');
 const covers:{id:string;url:string}[]=[];
 if(typeof body.cover_url==='string'&&body.cover_url.trim())covers.push({id:'url-'+createHash('sha256').update(body.cover_url).digest('hex').slice(0,20),url:body.cover_url});
 if(typeof body.cover==='string'&&body.cover.trim())covers.push({id:'url-'+createHash('sha256').update(body.cover).digest('hex').slice(0,20),url:body.cover});
 for(const c of [...(typeof body.cover==='object'&&body.cover?[body.cover]:[]),...(body.covers||[])]){if(c.issue_id!==undefined&&c.issue_id!==gcdId)throw new CoverSourceError('wrong_variant_association');const url=c.cover_url||c.image_url||c.url;if(url)covers.push({id:String(c.id||'url-'+createHash('sha256').update(url).digest('hex').slice(0,20)),url})}
 const confirmedAbsent=Object.hasOwn(body,'cover_url')&&(body.cover_url===null||body.cover_url==='')||Object.hasOwn(body,'covers')&&body.covers?.length===0||Object.hasOwn(body,'cover')&&(body.cover===null||body.cover==='');
 if(!covers.length&&!confirmedAbsent)throw new CoverSourceError('upstream_cover_schema_unknown');
 return {covers:[...new Map(covers.map(c=>[c.url,c])).values()],confirmedAbsent};
}
export async function optimizeCover(bytes:Buffer,mime:string){
 if(!/^image\/(jpeg|png|webp)(?:;|$)/i.test(mime))throw new CoverSourceError('invalid_image_type');
 const image=sharp(bytes,{limitInputPixels:16000000,animated:false,failOn:'error'}),meta=await image.metadata();
 if(!meta.width||!meta.height||!['jpeg','png','webp'].includes(meta.format||'')||meta.width<40||meta.height<60||(meta.pages||1)>1)throw new CoverSourceError('invalid_image_dimensions');
 const output:Record<string,{bytes:Buffer;width:number;height:number}>={};
 for(const [name,width] of [['card',240],['dense',480],['detail',960]] as const){const result=await image.clone().rotate().resize({width,fit:'inside',withoutEnlargement:true}).webp({quality:name==='detail'?85:80}).toBuffer({resolveWithObject:true});output[name]={bytes:result.data,width:result.info.width,height:result.info.height}}
 return {renditions:output,sourceWidth:meta.width,sourceHeight:meta.height,hash:createHash('sha256').update(bytes).digest('hex')};
}
type CoverJobDependencies=Partial<{fetchSource:typeof approvedSourceFetch;writeRendition:(bucket:string,key:string,bytes:Buffer,permission:string)=>Promise<void>;deleteRenditions:(bucket:string,keys:string[])=>Promise<void>;metronFetcher:typeof fetch}>;
export async function processCoverJob(db:CatalogDb,job:EnrichmentJob,dependencies:CoverJobDependencies={}){
 if(job.payload.action==='revalidate'){await revalidateCachedCover(db,job);return}
 if(job.payload.action==='purge'){await purgeCoverProvider(db,String(job.payload.provider));await finishEnrichment(db,job,'DONE');return}
 if(job.payload.provider==='METRON'&&job.payload.mode==='direct'){await processDirectMetronCover(db,job,dependencies);return}
 const provider:CoverProvider=job.payload.provider==='METRON'?'METRON':'GCD';
 const issueId=Number(job.payload.issueId),gcdId=Number(job.payload.gcdId),grant=await permission(db,provider),storage=coverStorageStatus();
 if(!grant||!storage.ready||process.env.ENRICHMENT_COVERS_ENABLED!=='true'||provider==='METRON'&&!metronConfig().token){await finishEnrichment(db,job,'DISABLED','cover_access_or_storage_unconfigured');return}
 if(!Number.isSafeInteger(gcdId)||issueId!==4000000000+gcdId){await finishEnrichment(db,job,'FAILED','invalid_catalog_identity');return}
 // Conservative project testing policy: one outstanding GCD job and at most
 // one request every 30 seconds. This is NOT represented as GCD's official quota.
 // Metron requests are additionally bounded by the shared Metron budget.
 if(!await providerTurn(db,providerLimitKey(provider),provider==='GCD'?30:5)){await finishEnrichment(db,job,'PENDING','provider_wait',60);return}
 let sourceCoverId='resolution';
 await db.execute(sql`UPDATE ch_web.cover_cache SET status='PROCESSING',lease_expires_at=now()+interval '2 minutes',attempt_count=attempt_count+1,updated_at=now() WHERE issue_id=${issueId} AND source_provider=${provider} AND source_cover_id='resolution'`);
 try{
  let hosts:string[],covers:{id:string;url:string}[];
  const fetchSource=dependencies.fetchSource||approvedSourceFetch;
  if(provider==='GCD'){
   hosts=grant.approved_hosts.filter(host=>host==='www.comics.org'||/^files[0-9]+\.comics\.org$/.test(host));if(!hosts.includes('www.comics.org'))throw new CoverSourceError('source_host_not_approved');
   const headers:Record<string,string>={Accept:'application/json'};if(process.env.GCD_USERNAME&&process.env.GCD_PASSWORD)headers.Authorization='Basic '+Buffer.from(process.env.GCD_USERNAME+':'+process.env.GCD_PASSWORD).toString('base64');
   const metadata=await fetchSource('https://www.comics.org/api/issue/'+gcdId+'/',hosts,{headers,maxBytes:1000000});
   if(!/application\/json/i.test(metadata.headers['content-type']||''))throw new CoverSourceError('invalid_metadata_type');
   covers=parseGcdCoverResponse(JSON.parse(metadata.bytes.toString()),gcdId).covers;
  }else{
   hosts=grant.approved_hosts.filter(host=>host===METRON_COVER_HOST);if(!hosts.length)throw new CoverSourceError('source_host_not_approved');
   const found=await metronCoverForGcd(db,gcdId,{fetcher:dependencies.metronFetcher});
   covers=found.image?[{id:'metron-'+found.metronId,url:found.image}]:[];
  }
  if(!covers.length){await saveCoverState(db,provider,issueId,'resolution',grant,'NOT_FOUND','confirmed_no_eligible_scan',200,86400*30);await finishEnrichment(db,job,'DONE');return}
  const s3=new S3Client({region:process.env.AWS_REGION||'us-east-2',maxAttempts:2,requestHandler:{connectionTimeout:3000,requestTimeout:10000}});
  for(const cover of covers.slice(0,1)){
   sourceCoverId=cover.id;const downloaded=await fetchSource(cover.url,hosts,{maxBytes:6000000}),optimized=await optimizeCover(downloaded.bytes,downloaded.headers['content-type']||''),renditions:Record<string,Rendition>={};
   // Every object is written before the cache row is published. A partial
   // upload never becomes a ready CDN reference; retries use identical keys.
   for(const [name,r] of Object.entries(optimized.renditions)){const key='comic-covers/'+provider+'/'+gcdId+'/'+encodeURIComponent(cover.id)+'/'+optimized.hash+'/'+name+'.webp';if(dependencies.writeRendition)await dependencies.writeRendition(storage.bucket!,key,r.bytes,grant.evidence_reference);else await s3.send(new PutObjectCommand({Bucket:storage.bucket!,Key:key,Body:r.bytes,ContentType:'image/webp',CacheControl:'public,max-age=31536000,immutable',Metadata:{issue:String(gcdId),permission:createHash('sha256').update(grant.evidence_reference).digest('hex')}}));renditions[name]={key,width:r.width,height:r.height,bytes:r.bytes.length}}
   // Re-read the grant after processing so revocation wins a racing upload.
   const current=await permission(db,provider);if(!current||current.evidence_reference!==grant.evidence_reference){if(dependencies.deleteRenditions)await dependencies.deleteRenditions(storage.bucket!,Object.values(renditions).map(r=>r.key));else await s3.send(new DeleteObjectsCommand({Bucket:storage.bucket!,Delete:{Objects:Object.values(renditions).map(r=>({Key:r.key}))}}));throw new CoverSourceError('permission_revoked')}
   await db.execute(sql`INSERT INTO ch_web.cover_cache(id,issue_id,source_provider,source_cover_id,source_url,permission_reference,status,storage_bucket,renditions,content_hash,mime_type,width,height,byte_size,etag,last_modified,last_checked_at,last_success_at,attribution,permission_expires_at)
   VALUES(${randomUUID()}::uuid,${issueId},${provider},${cover.id},${downloaded.url},${grant.evidence_reference},'CACHED',${storage.bucket},${JSON.stringify(renditions)}::jsonb,${optimized.hash},'image/webp',${optimized.sourceWidth},${optimized.sourceHeight},${downloaded.bytes.length},${downloaded.headers.etag||null},${downloaded.headers['last-modified']||null},now(),now(),${grant.attribution},${new Date(grant.valid_until).toISOString()}::timestamptz)
   ON CONFLICT(issue_id,source_provider,source_cover_id) DO UPDATE SET source_url=excluded.source_url,permission_reference=excluded.permission_reference,status='CACHED',storage_bucket=excluded.storage_bucket,renditions=excluded.renditions,content_hash=excluded.content_hash,mime_type=excluded.mime_type,width=excluded.width,height=excluded.height,byte_size=excluded.byte_size,last_checked_at=now(),last_success_at=now(),permission_expires_at=excluded.permission_expires_at,sanitized_error_code=NULL,updated_at=now()`);
  }
  await db.execute(sql`DELETE FROM ch_web.cover_cache WHERE issue_id=${issueId} AND source_provider=${provider} AND source_cover_id='resolution' AND status='PROCESSING'`);await finishEnrichment(db,job,'DONE');
 }catch(error){
  const e=error instanceof CoverSourceError?error:error instanceof MetronLookupError?metronCoverError(error):new CoverSourceError(error instanceof Error&&/timeout|abort/i.test(error.name+' '+error.message)?'source_timeout':'cover_processing_failed');
  const blocked=['source_access_denied','source_html_challenge','permission_revoked'].includes(e.code),limited=e.status===429,delay=retryDelay(job.attempts,e.retryAfter),status:CoverStatus=blocked?'BLOCKED':limited?'RATE_LIMITED':'FAILED';
  await saveCoverState(db,provider,issueId,sourceCoverId,grant,status,e.code,e.status,blocked?86400*30:delay);
  if(blocked)await db.execute(sql`INSERT INTO ch_web.enrichment_provider_limits(provider,blocked_until,error_code) VALUES(${providerLimitKey(provider)},now()+interval '30 days',${e.code}) ON CONFLICT(provider) DO UPDATE SET blocked_until=excluded.blocked_until,error_code=excluded.error_code`);
  if(sourceCoverId!=='resolution')await db.execute(sql`DELETE FROM ch_web.cover_cache WHERE issue_id=${issueId} AND source_provider=${provider} AND source_cover_id='resolution' AND status='PROCESSING'`);
  await finishEnrichment(db,job,blocked?'BLOCKED':job.attempts>=5?'FAILED':'PENDING',e.code,delay);
 }
}
async function saveCoverState(db:CatalogDb,provider:CoverProvider,issueId:number,coverId:string,grant:Permission,status:CoverStatus,code:string,http:number|null,retry:number){await db.execute(sql`INSERT INTO ch_web.cover_cache(id,issue_id,source_provider,source_cover_id,permission_reference,status,last_checked_at,next_retry_at,attempt_count,last_http_status,sanitized_error_code,attribution,permission_expires_at)
 VALUES(${randomUUID()}::uuid,${issueId},${provider},${coverId},${grant.evidence_reference},${status},now(),now()+${retry}*interval '1 second',1,${http},${code},${grant.attribution},${new Date(grant.valid_until).toISOString()}::timestamptz)
 ON CONFLICT(issue_id,source_provider,source_cover_id) DO UPDATE SET status=excluded.status,last_checked_at=now(),next_retry_at=excluded.next_retry_at,attempt_count=cover_cache.attempt_count+1,last_http_status=excluded.last_http_status,sanitized_error_code=excluded.sanitized_error_code,updated_at=now()`)}
function metronCoverError(error:MetronLookupError){
 if(error.code==='metron_budget'||error.code==='metron_rate_limited')return new CoverSourceError('source_rate_limited',429,String(error.retryAfterSeconds??60));
 if(error.code==='metron_timeout')return new CoverSourceError('source_timeout');
 return new CoverSourceError(error.code,error.code==='metron_token_rejected'?401:null);
}

// ---- Interim direct display (COVER_DIRECT_DISPLAY=metron) ----------------
// No S3: the page shows Metron's own static.metron.cloud URL. One Metron
// request per issue; hits are kept 30 days, misses 30 days, failures back off.
const DIRECT_REFERENCE='COVER_DIRECT_DISPLAY=metron';
type DirectRow={issue_id:number;status:CoverStatus;source_url:string|null;attribution:string;next_retry_at:Date|null;permission_expires_at:Date;updated_at:Date};
async function resolveDirectMetronCovers(db:CatalogDb,ids:number[]){
 const out=new Map<number,CoverResolution>();
 try{
  const rows=(await db.execute(sql`SELECT issue_id,status,source_url,attribution,next_retry_at,permission_expires_at,updated_at FROM ch_web.cover_cache WHERE issue_id IN (${sql.join(ids.map(id=>sql`${id}`),sql`,`)}) AND source_provider='METRON' AND source_cover_id='direct'`)).rows as unknown as DirectRow[];
  const byId=new Map(rows.map(row=>[Number(row.issue_id),row])),now=Date.now();
  const due=ids.filter(id=>{const row=byId.get(id);if(!row)return true;if(row.status==='CACHED')return new Date(row.permission_expires_at).getTime()<=now;if(row.status==='PENDING'||row.status==='PROCESSING')return new Date(row.updated_at).getTime()<now-10*60000;return new Date(row.next_retry_at||0).getTime()<=now});
  // Only real native catalog identities may spend Metron requests.
  const verified=due.length?(await catalogIssuesById(db,due)).filter(issue=>issue.gcdId&&issue.id===4000000000+issue.gcdId):[];
  for(const issue of verified){
   await db.execute(sql`INSERT INTO ch_web.enrichment_catalog_refs(issue_id,source_provider,source_id) VALUES(${issue.id},'METRON',${issue.gcdId!}) ON CONFLICT DO NOTHING`);
   await db.execute(sql`INSERT INTO ch_web.cover_cache(id,issue_id,source_provider,source_cover_id,permission_reference,status,attribution,permission_expires_at) VALUES(${randomUUID()}::uuid,${issue.id},'METRON','direct',${DIRECT_REFERENCE},'PENDING',${METRON_COVER_ATTRIBUTION},now()+interval '30 days')
    ON CONFLICT(issue_id,source_provider,source_cover_id) DO UPDATE SET status='PENDING',updated_at=now()`);
   await enqueueEnrichment(db,'cover','metron:'+issue.id,{provider:'METRON',mode:'direct',issueId:issue.id,gcdId:issue.gcdId});
  }
  const queued=new Set(verified.map(issue=>issue.id));
  for(const id of ids){
   const row=byId.get(id),url=row?.status==='CACHED'?metronImageUrl(row.source_url):null;
   if(url&&new Date(row!.permission_expires_at).getTime()>now)out.set(id,{issueId:id,status:'CACHED',url,attribution:row!.attribution||METRON_COVER_ATTRIBUTION,message:'Catalog reference art',updatedAt:new Date(row!.updated_at).toISOString()});
   else if(queued.has(id)||row&&(row.status==='PENDING'||row.status==='PROCESSING'))out.set(id,{issueId:id,status:'PENDING',url:null,attribution:'',message:coverStatusMessage('PENDING')});
   else if(row&&['NOT_FOUND','RATE_LIMITED','FAILED','BLOCKED'].includes(row.status))out.set(id,{issueId:id,status:row.status,url:null,attribution:'',message:coverStatusMessage(row.status)});
  }
 }catch{console.warn('Direct Metron cover lookup deferred; apply migration 025.')}
 return out;
}
async function saveDirectState(db:CatalogDb,issueId:number,status:CoverStatus,code:string|null,retrySeconds:number,url:string|null=null){
 await db.execute(sql`UPDATE ch_web.cover_cache SET status=${status},source_url=COALESCE(${url},source_url),sanitized_error_code=${code},last_checked_at=now(),
  last_success_at=CASE WHEN ${status}='CACHED' THEN now() ELSE last_success_at END,attempt_count=attempt_count+1,
  next_retry_at=now()+${retrySeconds}*interval '1 second',permission_expires_at=CASE WHEN ${status}='CACHED' THEN now()+interval '30 days' ELSE permission_expires_at END,updated_at=now()
  WHERE issue_id=${issueId} AND source_provider='METRON' AND source_cover_id='direct'`);
}
async function processDirectMetronCover(db:CatalogDb,job:EnrichmentJob,dependencies:CoverJobDependencies){
 const issueId=Number(job.payload.issueId),gcdId=Number(job.payload.gcdId);
 if(!metronConfig().directCovers){await finishEnrichment(db,job,'DISABLED','direct_display_disabled');return}
 if(!Number.isSafeInteger(gcdId)||issueId!==4000000000+gcdId){await finishEnrichment(db,job,'FAILED','invalid_catalog_identity');return}
 await db.execute(sql`UPDATE ch_web.cover_cache SET status='PROCESSING',updated_at=now() WHERE issue_id=${issueId} AND source_provider='METRON' AND source_cover_id='direct'`);
 try{
  const found=await metronCoverForGcd(db,gcdId,{fetcher:dependencies.metronFetcher});
  if(found.image)await saveDirectState(db,issueId,'CACHED',null,86400*30,found.image);
  else await saveDirectState(db,issueId,'NOT_FOUND',found.found?'metron_issue_without_image':'metron_issue_not_found',86400*30);
  await finishEnrichment(db,job,'DONE');
 }catch(error){
  const e=error instanceof MetronLookupError?error:null,wait=e?.retryAfterSeconds??60;
  if(e&&(e.code==='metron_budget'||e.code==='metron_rate_limited')){await saveDirectState(db,issueId,'RATE_LIMITED',e.code,wait);await finishEnrichment(db,job,'PENDING','provider_wait',wait);return}
  const delay=retryDelay(job.attempts);await saveDirectState(db,issueId,e?.code==='metron_token_rejected'?'BLOCKED':'FAILED',e?.code||'cover_processing_failed',e?.code==='metron_token_rejected'?86400:delay);
  await finishEnrichment(db,job,job.attempts>=5||e?.code==='metron_token_rejected'?'FAILED':'PENDING',e?.code||'cover_processing_failed',delay);
 }
}

export async function revokeCoverProvider(db:CatalogDb,provider:string){await db.execute(sql`DELETE FROM ch_web.listing_estimates`);await db.execute(sql`DELETE FROM ch_web.market_pulse_snapshots`);await db.execute(sql`UPDATE ch_web.source_permissions SET enabled=false,revoked_at=now(),updated_at=now() WHERE provider=${provider}`);await db.execute(sql`UPDATE ch_web.cover_cache SET status='DISABLED',updated_at=now() WHERE source_provider=${provider}`);const objects=await db.execute(sql`SELECT 1 FROM ch_web.cover_cache WHERE source_provider=${provider} AND renditions<>'{}'::jsonb LIMIT 1`);if(objects.rows.length)await enqueueEnrichment(db,'cover','purge:'+provider,{action:'purge',provider})}
async function purgeCoverProvider(db:CatalogDb,provider:string){
 const storage=coverStorageStatus();if(!storage.ready)throw new CoverSourceError('purge_storage_unconfigured');
 const found=await db.execute(sql`SELECT id,storage_bucket,renditions FROM ch_web.cover_cache WHERE source_provider=${provider} AND renditions<>'{}'::jsonb LIMIT 100`),s3=new S3Client({region:process.env.AWS_REGION||'us-east-2',maxAttempts:2,requestHandler:{connectionTimeout:3000,requestTimeout:10000}}),cloudfront=new CloudFrontClient({region:'us-east-1'});
 for(const row of found.rows){const keys=Object.values(row.renditions as Record<string,Rendition>).map(r=>r.key);if(!keys.length)continue;await s3.send(new DeleteObjectsCommand({Bucket:String(row.storage_bucket),Delete:{Objects:keys.map(Key=>({Key}))}}));await cloudfront.send(new CreateInvalidationCommand({DistributionId:storage.distribution!,InvalidationBatch:{CallerReference:randomUUID(),Paths:{Quantity:keys.length,Items:keys.map(key=>'/'+key)}}}));await db.execute(sql`UPDATE ch_web.cover_cache SET renditions='{}',updated_at=now() WHERE id=${String(row.id)}::uuid`)}
 if(found.rows.length===100)throw new CoverSourceError('purge_more_objects_remaining');
}

/** A browser failure is only a hint. The worker checks our own stored CDN key;
 * callers cannot choose an origin or invalidate a healthy cached object. */
async function revalidateDirectMetronCover(db:CatalogDb,job:EnrichmentJob,issueId:number){
 const row=(await db.execute(sql`SELECT source_url FROM ch_web.cover_cache WHERE issue_id=${issueId} AND source_provider='METRON' AND source_cover_id='direct' AND status='CACHED'`)).rows[0],url=metronImageUrl(row?.source_url);
 if(!url){await finishEnrichment(db,job,'DONE');return}
 if(!await providerTurn(db,'cover-cdn-revalidation',5)){await finishEnrichment(db,job,'PENDING','cdn_wait',15);return}
 try{await approvedSourceFetch(url,[METRON_COVER_HOST],{method:'HEAD',maxBytes:1000});await finishEnrichment(db,job,'DONE')}
 catch(error){
  // Only a confirmed 404/410 re-resolves the image; other failures are transient.
  if(error instanceof CoverSourceError&&(error.status===404||error.status===410)){await saveDirectState(db,issueId,'FAILED','metron_image_missing',0);await enqueueEnrichment(db,'cover','metron:'+issueId,{provider:'METRON',mode:'direct',issueId,gcdId:issueId-4000000000})}
  await finishEnrichment(db,job,'DONE');
 }
}
async function revalidateCachedCover(db:CatalogDb,job:EnrichmentJob){
 const issueId0=Number(job.payload.issueId);
 if(metronConfig().directCovers&&(await db.execute(sql`SELECT 1 FROM ch_web.cover_cache WHERE issue_id=${issueId0} AND source_provider='METRON' AND source_cover_id='direct' AND status='CACHED'`).catch(()=>({rows:[]}))).rows.length){await revalidateDirectMetronCover(db,job,issueId0);return}
 const active=await activeGrant(db),storage=coverStorageStatus(),grant=active?.grant||null,issueId=issueId0;if(!storage.ready||!grant){await finishEnrichment(db,job,'DISABLED','cover_access_or_storage_unconfigured');return}
 if(!await providerTurn(db,'cover-cdn-revalidation',5)){await finishEnrichment(db,job,'PENDING','cdn_wait',15);return}
 const result=await db.execute(sql`SELECT id,renditions FROM ch_web.cover_cache WHERE issue_id=${issueId} AND source_provider=${active!.provider} AND status='CACHED' AND permission_reference=${grant.evidence_reference} ORDER BY updated_at DESC LIMIT 1`),row=result.rows[0],key=(row?.renditions as {card?:Rendition}|undefined)?.card?.key;
 if(!row||!key||!/^comic-covers\/[A-Za-z0-9/%_.-]+$/.test(key)||key.includes('..')){await finishEnrichment(db,job,'DONE');return}
 try{await approvedSourceFetch(storage.base+'/'+key,[new URL(storage.base!).hostname],{method:'HEAD',maxBytes:1000});await db.execute(sql`UPDATE ch_web.cover_cache SET last_checked_at=now() WHERE id=${String(row.id)}::uuid`);await finishEnrichment(db,job,'DONE')}
 catch(error){const e=error instanceof CoverSourceError?error:error instanceof MetronLookupError?metronCoverError(error):new CoverSourceError('cdn_check_failed');if(e.status===404){await db.execute(sql`UPDATE ch_web.cover_cache SET status='FAILED',sanitized_error_code='cdn_object_missing',next_retry_at=now(),updated_at=now() WHERE id=${String(row.id)}::uuid`);await enqueueEnrichment(db,'cover',jobKey(active!.provider,issueId),{issueId,gcdId:issueId-4000000000,provider:active!.provider});await finishEnrichment(db,job,'DONE')}else await finishEnrichment(db,job,job.attempts>=5?'FAILED':'PENDING','cdn_check_failed',retryDelay(job.attempts,e.retryAfter))}
}
