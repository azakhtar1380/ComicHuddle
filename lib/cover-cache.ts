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

export function coverStorageStatus(){
 const {COVER_STORAGE_BUCKET:bucket,COVER_CDN_BASE_URL:base,COVER_CLOUDFRONT_DISTRIBUTION_ID:distribution}=process.env;
 const credentials=!!(process.env.AWS_ACCESS_KEY_ID&&process.env.AWS_SECRET_ACCESS_KEY||process.env.AWS_WEB_IDENTITY_TOKEN_FILE&&process.env.AWS_ROLE_ARN);
 let url:URL|null=null;try{url=base?new URL(base):null}catch{}
 const ready=!!(bucket&&url?.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&distribution&&credentials&&process.env.COVER_STORAGE_REVIEWED==='true');
 return {ready,bucket:bucket||null,base:ready?url!.href.replace(/\/$/,''):null,distribution:distribution||null,reason:ready?null:'Approved S3 bucket, CloudFront domain/distribution, service credentials and storage policy review are required.'};
}
type Permission={provider:string;enabled:boolean;access_allowed:boolean;cache_allowed:boolean;display_allowed:boolean;ai_allowed:boolean;evidence_reference:string;attribution:string;approved_hosts:string[];valid_until:Date;revoked_at:Date|null};
async function permission(db:CatalogDb){const rows=await db.execute(sql`SELECT * FROM ch_web.source_permissions WHERE provider='GCD'`);const row=rows.rows[0] as unknown as Permission|undefined;return row&&row.enabled&&row.access_allowed&&row.cache_allowed&&row.display_allowed&&!row.revoked_at&&new Date(row.valid_until).getTime()>Date.now()?row:null}
type Rendition={key:string;width:number;height:number;bytes:number};
type CacheRow={issue_id:number;status:CoverStatus;renditions:Record<string,Rendition>;attribution:string;source_url:string|null;updated_at:Date;permission_reference:string;permission_expires_at:Date;next_retry_at:Date|null};
export async function resolveCoverBatch(db:CatalogDb,ids:number[]):Promise<CoverResolution[]>{
 const storage=coverStorageStatus(),grant=await permission(db),rows=ids.length?await db.execute(sql`SELECT DISTINCT ON(issue_id) issue_id,status,renditions,attribution,source_url,updated_at,permission_reference,permission_expires_at,next_retry_at FROM ch_web.cover_cache WHERE issue_id IN (${sql.join(ids.map(id=>sql`${id}`),sql`,`)}) ORDER BY issue_id,(status='CACHED') DESC,updated_at DESC`):{rows:[]},found=new Map((rows.rows as unknown as CacheRow[]).map(row=>[Number(row.issue_id),row]));
 const missing=ids.filter(id=>!found.has(id)||['FAILED','RATE_LIMITED','NOT_FOUND'].includes(found.get(id)?.status||'')&&new Date(found.get(id)!.next_retry_at||0).getTime()<=Date.now()||found.get(id)?.status==='CACHED'&&(found.get(id)?.permission_reference!==grant?.evidence_reference||new Date(found.get(id)!.permission_expires_at).getTime()<=Date.now())),issues=missing.length?await catalogIssuesById(db,missing):[];
 const local=new Map(issues.filter(issue=>issue.cover?.startsWith('/covers/')).map(issue=>[issue.id,issue]));
 const eligible=new Set(issues.filter(issue=>issue.gcdId&&issue.id===4000000000+issue.gcdId).map(issue=>issue.id));
 if(grant&&storage.ready&&process.env.ENRICHMENT_COVERS_ENABLED==='true')for(const issue of issues){if(!eligible.has(issue.id))continue;await db.execute(sql`INSERT INTO ch_web.enrichment_catalog_refs(issue_id,source_provider,source_id) VALUES(${issue.id},'GCD',${issue.gcdId!}) ON CONFLICT DO NOTHING`);await db.execute(sql`INSERT INTO ch_web.cover_cache(id,issue_id,source_provider,source_cover_id,permission_reference,status,attribution,permission_expires_at) VALUES(${randomUUID()}::uuid,${issue.id},'GCD','resolution',${grant.evidence_reference},'PENDING',${grant.attribution},${new Date(grant.valid_until).toISOString()}::timestamptz) ON CONFLICT(issue_id,source_provider,source_cover_id) DO UPDATE SET status='PENDING',permission_reference=excluded.permission_reference,permission_expires_at=excluded.permission_expires_at,updated_at=now() WHERE cover_cache.status IN ('NOT_FOUND','FAILED','RATE_LIMITED','DISABLED')`);await enqueueEnrichment(db,'cover',String(issue.id),{issueId:issue.id,gcdId:issue.gcdId});}
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
export async function processCoverJob(db:CatalogDb,job:EnrichmentJob,dependencies:Partial<{fetchSource:typeof approvedSourceFetch;writeRendition:(bucket:string,key:string,bytes:Buffer,permission:string)=>Promise<void>;deleteRenditions:(bucket:string,keys:string[])=>Promise<void>}>={}){
 if(job.payload.action==='revalidate'){await revalidateCachedCover(db,job);return}
 if(job.payload.action==='purge'){await purgeCoverProvider(db,String(job.payload.provider));await finishEnrichment(db,job,'DONE');return}
 const issueId=Number(job.payload.issueId),gcdId=Number(job.payload.gcdId),grant=await permission(db),storage=coverStorageStatus();
 if(!grant||!storage.ready||process.env.ENRICHMENT_COVERS_ENABLED!=='true'){await finishEnrichment(db,job,'DISABLED','cover_access_or_storage_unconfigured');return}
 if(!Number.isSafeInteger(gcdId)||issueId!==4000000000+gcdId){await finishEnrichment(db,job,'FAILED','invalid_catalog_identity');return}
 // Conservative project testing policy: one outstanding GCD job and at most
 // one request every 30 seconds. This is NOT represented as GCD's official quota.
 if(!await providerTurn(db,'GCD-covers',30)){await finishEnrichment(db,job,'PENDING','provider_wait',60);return}
 let sourceCoverId='resolution';
 await db.execute(sql`UPDATE ch_web.cover_cache SET status='PROCESSING',lease_expires_at=now()+interval '2 minutes',attempt_count=attempt_count+1,updated_at=now() WHERE issue_id=${issueId} AND source_cover_id='resolution'`);
 try{
  const hosts=grant.approved_hosts.filter(host=>host==='www.comics.org'||/^files[0-9]+\.comics\.org$/.test(host));if(!hosts.includes('www.comics.org'))throw new CoverSourceError('source_host_not_approved');
  const headers:Record<string,string>={Accept:'application/json'};if(process.env.GCD_USERNAME&&process.env.GCD_PASSWORD)headers.Authorization='Basic '+Buffer.from(process.env.GCD_USERNAME+':'+process.env.GCD_PASSWORD).toString('base64');
  const fetchSource=dependencies.fetchSource||approvedSourceFetch;
  const metadata=await fetchSource('https://www.comics.org/api/issue/'+gcdId+'/',hosts,{headers,maxBytes:1000000});
  if(!/application\/json/i.test(metadata.headers['content-type']||''))throw new CoverSourceError('invalid_metadata_type');
  const parsed=parseGcdCoverResponse(JSON.parse(metadata.bytes.toString()),gcdId);
  if(!parsed.covers.length){await saveCoverState(db,issueId,'resolution',grant,'NOT_FOUND','confirmed_no_eligible_scan',200,86400*30);await finishEnrichment(db,job,'DONE');return}
  const s3=new S3Client({region:process.env.AWS_REGION||'us-east-2',maxAttempts:2,requestHandler:{connectionTimeout:3000,requestTimeout:10000}});
  for(const cover of parsed.covers.slice(0,1)){
   sourceCoverId=cover.id;const downloaded=await fetchSource(cover.url,hosts,{maxBytes:6000000}),optimized=await optimizeCover(downloaded.bytes,downloaded.headers['content-type']||''),renditions:Record<string,Rendition>={};
   // Every object is written before the cache row is published. A partial
   // upload never becomes a ready CDN reference; retries use identical keys.
   for(const [name,r] of Object.entries(optimized.renditions)){const key='comic-covers/GCD/'+gcdId+'/'+encodeURIComponent(cover.id)+'/'+optimized.hash+'/'+name+'.webp';if(dependencies.writeRendition)await dependencies.writeRendition(storage.bucket!,key,r.bytes,grant.evidence_reference);else await s3.send(new PutObjectCommand({Bucket:storage.bucket!,Key:key,Body:r.bytes,ContentType:'image/webp',CacheControl:'public,max-age=31536000,immutable',Metadata:{issue:String(gcdId),permission:createHash('sha256').update(grant.evidence_reference).digest('hex')}}));renditions[name]={key,width:r.width,height:r.height,bytes:r.bytes.length}}
   // Re-read the grant after processing so revocation wins a racing upload.
   const current=await permission(db);if(!current||current.evidence_reference!==grant.evidence_reference){if(dependencies.deleteRenditions)await dependencies.deleteRenditions(storage.bucket!,Object.values(renditions).map(r=>r.key));else await s3.send(new DeleteObjectsCommand({Bucket:storage.bucket!,Delete:{Objects:Object.values(renditions).map(r=>({Key:r.key}))}}));throw new CoverSourceError('permission_revoked')}
   await db.execute(sql`INSERT INTO ch_web.cover_cache(id,issue_id,source_provider,source_cover_id,source_url,permission_reference,status,storage_bucket,renditions,content_hash,mime_type,width,height,byte_size,etag,last_modified,last_checked_at,last_success_at,attribution,permission_expires_at)
   VALUES(${randomUUID()}::uuid,${issueId},'GCD',${cover.id},${downloaded.url},${grant.evidence_reference},'CACHED',${storage.bucket},${JSON.stringify(renditions)}::jsonb,${optimized.hash},'image/webp',${optimized.sourceWidth},${optimized.sourceHeight},${downloaded.bytes.length},${downloaded.headers.etag||null},${downloaded.headers['last-modified']||null},now(),now(),${grant.attribution},${new Date(grant.valid_until).toISOString()}::timestamptz)
   ON CONFLICT(issue_id,source_provider,source_cover_id) DO UPDATE SET source_url=excluded.source_url,permission_reference=excluded.permission_reference,status='CACHED',storage_bucket=excluded.storage_bucket,renditions=excluded.renditions,content_hash=excluded.content_hash,mime_type=excluded.mime_type,width=excluded.width,height=excluded.height,byte_size=excluded.byte_size,last_checked_at=now(),last_success_at=now(),permission_expires_at=excluded.permission_expires_at,sanitized_error_code=NULL,updated_at=now()`);
  }
  await db.execute(sql`DELETE FROM ch_web.cover_cache WHERE issue_id=${issueId} AND source_cover_id='resolution' AND status='PROCESSING'`);await finishEnrichment(db,job,'DONE');
 }catch(error){
  const e=error instanceof CoverSourceError?error:new CoverSourceError(error instanceof Error&&/timeout|abort/i.test(error.name+' '+error.message)?'source_timeout':'cover_processing_failed');
  const blocked=['source_access_denied','source_html_challenge','permission_revoked'].includes(e.code),limited=e.status===429,delay=retryDelay(job.attempts,e.retryAfter),status:CoverStatus=blocked?'BLOCKED':limited?'RATE_LIMITED':'FAILED';
  await saveCoverState(db,issueId,sourceCoverId,grant,status,e.code,e.status,blocked?86400*30:delay);
  if(blocked)await db.execute(sql`INSERT INTO ch_web.enrichment_provider_limits(provider,blocked_until,error_code) VALUES('GCD-covers',now()+interval '30 days',${e.code}) ON CONFLICT(provider) DO UPDATE SET blocked_until=excluded.blocked_until,error_code=excluded.error_code`);
  if(sourceCoverId!=='resolution')await db.execute(sql`DELETE FROM ch_web.cover_cache WHERE issue_id=${issueId} AND source_cover_id='resolution' AND status='PROCESSING'`);
  await finishEnrichment(db,job,blocked?'BLOCKED':job.attempts>=5?'FAILED':'PENDING',e.code,delay);
 }
}
async function saveCoverState(db:CatalogDb,issueId:number,coverId:string,grant:Permission,status:CoverStatus,code:string,http:number|null,retry:number){await db.execute(sql`INSERT INTO ch_web.cover_cache(id,issue_id,source_provider,source_cover_id,permission_reference,status,last_checked_at,next_retry_at,attempt_count,last_http_status,sanitized_error_code,attribution,permission_expires_at)
 VALUES(${randomUUID()}::uuid,${issueId},'GCD',${coverId},${grant.evidence_reference},${status},now(),now()+${retry}*interval '1 second',1,${http},${code},${grant.attribution},${new Date(grant.valid_until).toISOString()}::timestamptz)
 ON CONFLICT(issue_id,source_provider,source_cover_id) DO UPDATE SET status=excluded.status,last_checked_at=now(),next_retry_at=excluded.next_retry_at,attempt_count=cover_cache.attempt_count+1,last_http_status=excluded.last_http_status,sanitized_error_code=excluded.sanitized_error_code,updated_at=now()`)}
export async function revokeCoverProvider(db:CatalogDb,provider:string){await db.execute(sql`DELETE FROM ch_web.listing_estimates`);await db.execute(sql`DELETE FROM ch_web.market_pulse_snapshots`);await db.execute(sql`UPDATE ch_web.source_permissions SET enabled=false,revoked_at=now(),updated_at=now() WHERE provider=${provider}`);await db.execute(sql`UPDATE ch_web.cover_cache SET status='DISABLED',updated_at=now() WHERE source_provider=${provider}`);const objects=await db.execute(sql`SELECT 1 FROM ch_web.cover_cache WHERE source_provider=${provider} AND renditions<>'{}'::jsonb LIMIT 1`);if(objects.rows.length)await enqueueEnrichment(db,'cover','purge:'+provider,{action:'purge',provider})}
async function purgeCoverProvider(db:CatalogDb,provider:string){
 const storage=coverStorageStatus();if(!storage.ready)throw new CoverSourceError('purge_storage_unconfigured');
 const found=await db.execute(sql`SELECT id,storage_bucket,renditions FROM ch_web.cover_cache WHERE source_provider=${provider} AND renditions<>'{}'::jsonb LIMIT 100`),s3=new S3Client({region:process.env.AWS_REGION||'us-east-2',maxAttempts:2,requestHandler:{connectionTimeout:3000,requestTimeout:10000}}),cloudfront=new CloudFrontClient({region:'us-east-1'});
 for(const row of found.rows){const keys=Object.values(row.renditions as Record<string,Rendition>).map(r=>r.key);if(!keys.length)continue;await s3.send(new DeleteObjectsCommand({Bucket:String(row.storage_bucket),Delete:{Objects:keys.map(Key=>({Key}))}}));await cloudfront.send(new CreateInvalidationCommand({DistributionId:storage.distribution!,InvalidationBatch:{CallerReference:randomUUID(),Paths:{Quantity:keys.length,Items:keys.map(key=>'/'+key)}}}));await db.execute(sql`UPDATE ch_web.cover_cache SET renditions='{}',updated_at=now() WHERE id=${String(row.id)}::uuid`)}
 if(found.rows.length===100)throw new CoverSourceError('purge_more_objects_remaining');
}

/** A browser failure is only a hint. The worker checks our own stored CDN key;
 * callers cannot choose an origin or invalidate a healthy cached object. */
async function revalidateCachedCover(db:CatalogDb,job:EnrichmentJob){
 const storage=coverStorageStatus(),grant=await permission(db),issueId=Number(job.payload.issueId);if(!storage.ready||!grant){await finishEnrichment(db,job,'DISABLED','cover_access_or_storage_unconfigured');return}
 if(!await providerTurn(db,'cover-cdn-revalidation',5)){await finishEnrichment(db,job,'PENDING','cdn_wait',15);return}
 const result=await db.execute(sql`SELECT id,renditions FROM ch_web.cover_cache WHERE issue_id=${issueId} AND status='CACHED' AND permission_reference=${grant.evidence_reference} ORDER BY updated_at DESC LIMIT 1`),row=result.rows[0],key=(row?.renditions as {card?:Rendition}|undefined)?.card?.key;
 if(!row||!key||!/^comic-covers\/[A-Za-z0-9/%_.-]+$/.test(key)||key.includes('..')){await finishEnrichment(db,job,'DONE');return}
 try{await approvedSourceFetch(storage.base+'/'+key,[new URL(storage.base!).hostname],{method:'HEAD',maxBytes:1000});await db.execute(sql`UPDATE ch_web.cover_cache SET last_checked_at=now() WHERE id=${String(row.id)}::uuid`);await finishEnrichment(db,job,'DONE')}
 catch(error){const e=error instanceof CoverSourceError?error:new CoverSourceError('cdn_check_failed');if(e.status===404){await db.execute(sql`UPDATE ch_web.cover_cache SET status='FAILED',sanitized_error_code='cdn_object_missing',next_retry_at=now(),updated_at=now() WHERE id=${String(row.id)}::uuid`);await enqueueEnrichment(db,'cover',String(issueId),{issueId,gcdId:issueId-4000000000});await finishEnrichment(db,job,'DONE')}else await finishEnrichment(db,job,job.attempts>=5?'FAILED':'PENDING','cdn_check_failed',retryDelay(job.attempts,e.retryAfter))}
}
