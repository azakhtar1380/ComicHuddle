// Copies Metron cover images (from the harvested index) to the owner's S3 bucket as
// WebP renditions, for display through CloudFront (METRON_COVER_CDN_BASE).
//
//   node scripts/copy-metron-covers.mjs [--dry-run] [--limit N] [--retry-failed] [--input file]
//
// Input:  .metron-cache/metron-issues.ndjson (scripts/harvest-metron-index.mjs; may still be growing).
// State:  .metron-cache/copy-state/done.ndjson   append-only, one line per copied cover
//         .metron-cache/copy-state/failed.ndjson append-only, permanent failures (404, bad image)
//         (--dry-run uses .metron-cache/dry/copy-state and writes renditions to .metron-cache/dry/)
// Output: s3://$COVER_S3_BUCKET/metron/<id>/card.webp (480w) and dense.webp (240w),
//         plus metron/manifest.ndjson.gz every ~500 covers and at the end.
//
// Env (process env or .env.local): COVER_S3_BUCKET, AWS_REGION (us-east-2), AWS_ACCESS_KEY_ID,
// AWS_SECRET_ACCESS_KEY [, AWS_SESSION_TOKEN]; pacing METRON_COPY_CONCURRENCY (2),
// METRON_COPY_GAP_MS (1000 = about one image per second overall), METRON_COPY_MANIFEST_EVERY (500).
// Credentials are never logged. Stop with Ctrl+C at any time; re-run to resume.
import {createReadStream,existsSync,mkdirSync,readFileSync,appendFileSync,writeFileSync,statSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gzipSync} from 'node:zlib';
import sharp from 'sharp';

export const SOURCE_HOST='static.metron.cloud';
export const RENDITIONS=[['card',480],['dense',240]];
export const MANIFEST_KEY='metron/manifest.ndjson.gz';
export const USER_AGENT='ComicHuddle cover mirror (one-time copy, ~1 image/s; contact via metron.cloud account)';
const MAX_IMAGE_BYTES=15*1024*1024;

// ---------- pure helpers (unit-tested in checks/metron-covers.test.ts) ----------
/** Only https://static.metron.cloud/... with no credentials or port. */
export function allowedImageUrl(value){
 if(typeof value!=='string'||!value||value.length>1024)return null;
 try{const url=new URL(value);if(url.protocol!=='https:'||url.hostname!==SOURCE_HOST||url.username||url.password||url.port)return null;url.hash='';return url.href}catch{return null}
}
/** One harvested NDJSON line -> entry, or null (partial trailing lines while the harvester writes are ignored). */
export function parseIndexLine(line){
 let raw;try{raw=JSON.parse(line)}catch{return null}
 if(!raw||typeof raw!=='object'||!Number.isSafeInteger(raw.id)||raw.id<=0||raw.id>2147483647)return null;
 return {id:raw.id,series:typeof raw.series==='string'?raw.series:null,volume:Number.isInteger(raw.volume)?raw.volume:null,yearBegan:Number.isInteger(raw.yearBegan)?raw.yearBegan:null,
  number:typeof raw.number==='string'?raw.number:null,coverDate:typeof raw.coverDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(raw.coverDate)?raw.coverDate:null,
  image:allowedImageUrl(raw.image),rawImage:raw.image??null,coverHash:typeof raw.coverHash==='string'&&/^[A-Za-z0-9]{1,128}$/.test(raw.coverHash)?raw.coverHash:null,modified:typeof raw.modified==='string'?raw.modified:null};
}
/** Duplicate ids keep the latest `modified` (ties: the later line). */
export function keepLatest(map,entry){
 const prev=map.get(entry.id);
 if(!prev){map.set(entry.id,entry);return}
 const a=Date.parse(prev.modified||''),b=Date.parse(entry.modified||'');
 if(Number.isNaN(a)||Number.isNaN(b)?true:b>=a)map.set(entry.id,entry);
}
export const renditionKey=(id,name)=>`metron/${id}/${name}.webp`;
/** Same source version: identical cover hash when both have one, else identical image URL. */
export const sameVersion=(done,entry)=>done.coverHash&&entry.coverHash?done.coverHash===entry.coverHash:done.image===entry.image;
/** Retry-After seconds or HTTP-date -> ms; fallback exponential (30s, 60s, ... max 15 min). */
export function retryDelayMs(header,attempt,now=Date.now()){
 if(header){const s=Number(header);if(Number.isFinite(s)&&s>=0)return Math.min(3600000,s*1000);const at=Date.parse(header);if(!Number.isNaN(at))return Math.min(3600000,Math.max(0,at-now))}
 return Math.min(900000,30000*2**Math.max(0,attempt-1));
}
/** WebP renditions, EXIF orientation applied then all metadata dropped, never upscaled. */
export async function makeRenditions(bytes){
 const source=sharp(bytes,{limitInputPixels:60000000,animated:false,failOn:'error'}),meta=await source.metadata();
 if(!meta.width||!meta.height||!['jpeg','png','webp'].includes(meta.format||'')||(meta.pages||1)>1)throw Object.assign(new Error('unsupported image'),{permanent:true});
 const out={};
 for(const [name,width] of RENDITIONS){
  const r=await source.clone().rotate().resize({width,withoutEnlargement:true}).webp({quality:name==='card'?82:78,effort:4}).toBuffer({resolveWithObject:true});
  out[name]={bytes:r.data,width:r.info.width,height:r.info.height};
 }
 return out;
}
export function manifestLine(entry,done){
 return JSON.stringify({id:done.id,series:entry?.series??done.series??null,volume:entry?.volume??done.volume??null,yearBegan:entry?.yearBegan??done.yearBegan??null,number:entry?.number??done.number??null,
  coverDate:entry?.coverDate??done.coverDate??null,card:done.card,dense:done.dense,coverHash:done.coverHash??null});
}
/** Manifest from the done log (latest record per id) merged with current index metadata. */
export function buildManifest(doneById,index){
 const lines=[...doneById.values()].sort((a,b)=>a.id-b.id).map(done=>manifestLine(index.get(done.id),done));
 return gzipSync(Buffer.from(lines.join('\n')+(lines.length?'\n':'')),{level:9});
}

// ---------- runtime ----------
function loadEnv(){
 const wanted=new Set(['COVER_S3_BUCKET','AWS_REGION','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','METRON_COPY_CONCURRENCY','METRON_COPY_GAP_MS','METRON_COPY_MANIFEST_EVERY']);
 if(!existsSync('.env.local'))return;
 for(const line of readFileSync('.env.local','utf8').split(/\r?\n/)){
  const m=/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);if(!m||!wanted.has(m[1])||process.env[m[1]])continue;
  let v=m[2];if(/^".*"$/.test(v)||/^'.*'$/.test(v))v=v.slice(1,-1);if(v)process.env[m[1]]=v;
 }
}
function readLog(file){
 const map=new Map();if(!existsSync(file))return map;
 for(const line of readFileSync(file,'utf8').split(/\r?\n/)){if(!line.trim())continue;try{const r=JSON.parse(line);if(Number.isSafeInteger(r.id))map.set(r.id,r)}catch{}}
 return map;
}
async function readIndex(file){
 const index=new Map();let bad=0;
 const lines=createInterface({input:createReadStream(file,{encoding:'utf8'}),crlfDelay:Infinity});
 for await(const line of lines){if(!line.trim())continue;const e=parseIndexLine(line);if(e)keepLatest(index,e);else bad++}
 return {index,bad};
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const fmt=s=>{if(!Number.isFinite(s))return '?';s=Math.round(s);const d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);return (d?d+'d ':'')+(d||h?h+'h ':'')+m+'m'};

async function main(){
 const args=process.argv.slice(2),opt=n=>{const i=args.indexOf(n);return i>=0?args[i+1]:undefined};
 const dry=args.includes('--dry-run'),retryFailed=args.includes('--retry-failed');
 const limit=opt('--limit')!==undefined?Math.max(0,Number(opt('--limit'))):Infinity;
 if(Number.isNaN(limit))throw new Error('--limit must be a number');
 const input=opt('--input')||'.metron-cache/metron-issues.ndjson';
 loadEnv();
 const concurrency=Math.max(1,Math.min(8,Number(process.env.METRON_COPY_CONCURRENCY)||2));
 const gapMs=Math.max(0,Number(process.env.METRON_COPY_GAP_MS??1000)||0);
 const manifestEvery=Math.max(1,Number(process.env.METRON_COPY_MANIFEST_EVERY)||500);
 const root=dry?'.metron-cache/dry':'.metron-cache',stateDir=join(root,'copy-state');mkdirSync(stateDir,{recursive:true});
 const doneFile=join(stateDir,'done.ndjson'),failedFile=join(stateDir,'failed.ndjson');
 if(!existsSync(input))throw new Error('Index not found: '+input+' (run scripts/harvest-metron-index.mjs first)');

 let s3=null,bucket=null,aws=null;
 if(!dry){
  bucket=process.env.COVER_S3_BUCKET;
  if(!bucket||!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket))throw new Error('COVER_S3_BUCKET is not set (or not a valid bucket name).');
  if(!process.env.AWS_ACCESS_KEY_ID||!process.env.AWS_SECRET_ACCESS_KEY)throw new Error('AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are not set.');
  aws=await import('@aws-sdk/client-s3');
  s3=new aws.S3Client({region:process.env.AWS_REGION||'us-east-2',maxAttempts:4});
 }
 const put=async(key,body,contentType,cacheControl,metadata)=>{
  if(dry){const file=join(root,key);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,body);return}
  await s3.send(new aws.PutObjectCommand({Bucket:bucket,Key:key,Body:body,ContentType:contentType,CacheControl:cacheControl,Metadata:metadata}));
 };
 const head=async key=>{
  if(dry)return null;
  try{const r=await s3.send(new aws.HeadObjectCommand({Bucket:bucket,Key:key}));return r.Metadata||{}}
  catch(e){if(e?.$metadata?.httpStatusCode===404||e?.name==='NotFound')return null;throw e}
 };

 const done=readLog(doneFile),failed=retryFailed?new Map():readLog(failedFile);
 let index=new Map(),fileSize=-1,manifestPending=0,stopping=false,fatal=null;
 const stats={copied:0,reused:0,failed:0,deferred:0,started:Date.now()};
 let nextSlot=0,pausedUntil=0;
 const paced=async()=>{for(;;){const now=Date.now(),at=Math.max(nextSlot,pausedUntil);if(at<=now){nextSlot=now+gapMs;return}await sleep(Math.min(at-now,5000));if(stopping)throw new Error('stopping')}};
 process.on('SIGINT',()=>{if(stopping)process.exit(130);stopping=true;console.log('Stopping after in-flight images (Ctrl+C again to quit now)...')});

 const writeManifest=async()=>{
  const body=buildManifest(done,index);
  await put(MANIFEST_KEY,body,'application/gzip','public, max-age=300',undefined);
  manifestPending=0;console.log(`manifest: ${done.size} covers written to ${dry?join(root,MANIFEST_KEY):'s3://'+bucket+'/'+MANIFEST_KEY}`);
 };
 const recordDone=async record=>{
  done.set(record.id,record);appendFileSync(doneFile,JSON.stringify(record)+'\n');
  if(++manifestPending>=manifestEvery)await writeManifest();
 };

 async function download(url){
  for(let attempt=1;;attempt++){
   await paced();
   let target=url,res;
   for(let hop=0;;hop++){
    res=await fetch(target,{redirect:'manual',headers:{'User-Agent':USER_AGENT,Accept:'image/jpeg,image/png,image/webp;q=0.9,*/*;q=0.1'},signal:AbortSignal.timeout(60000)}).catch(error=>({status:0,error}));
    if(res.status>=300&&res.status<400&&res.headers?.get('location')){const next=allowedImageUrl(new URL(res.headers.get('location'),target).href);if(!next||hop>=3)throw Object.assign(new Error('redirect to a non-Metron host'),{permanent:true});target=next;continue}
    break;
   }
   if(res.status===200){
    const type=res.headers.get('content-type')||'';if(!/^image\//i.test(type))throw Object.assign(new Error('not an image ('+type.slice(0,40)+')'),{permanent:true});
    const length=Number(res.headers.get('content-length')||0);if(length>MAX_IMAGE_BYTES)throw Object.assign(new Error('image too large'),{permanent:true});
    const bytes=Buffer.from(await res.arrayBuffer());if(bytes.length>MAX_IMAGE_BYTES)throw Object.assign(new Error('image too large'),{permanent:true});
    return bytes;
   }
   if([400,401,403,404,410].includes(res.status))throw Object.assign(new Error('HTTP '+res.status),{permanent:true});
   const wait=retryDelayMs(res.headers?.get?.('retry-after'),attempt);
   if(res.status===429||res.status>=500)pausedUntil=Math.max(pausedUntil,Date.now()+wait); // slow everyone down
   if(attempt>=6)throw new Error('HTTP '+(res.status||'network')+' after '+attempt+' attempts');
   console.log(`  ${url.replace(/^https:\/\/[^/]+/,'')}: HTTP ${res.status||'network'}; retrying in ${Math.round(wait/1000)}s`);
   await sleep(wait);if(stopping)throw new Error('stopping');
  }
 }

 async function copyOne(entry){
  const keys={card:renditionKey(entry.id,'card'),dense:renditionKey(entry.id,'dense')};
  const hash=entry.coverHash||'';
  // Restart without the done log: objects already in S3 for this cover version are reused, no download.
  const existing=await Promise.all([head(keys.card),head(keys.dense)]);
  if(existing.every(m=>m&&(m['cover-hash']||'')===hash&&Number(m.width)>0&&Number(m.height)>0)){
   await recordDone({id:entry.id,image:entry.image,coverHash:entry.coverHash,series:entry.series,volume:entry.volume,yearBegan:entry.yearBegan,number:entry.number,coverDate:entry.coverDate,
    card:{key:keys.card,width:Number(existing[0].width),height:Number(existing[0].height)},dense:{key:keys.dense,width:Number(existing[1].width),height:Number(existing[1].height)},at:new Date().toISOString(),reused:true});
   stats.reused++;return;
  }
  const renditions=await makeRenditions(await download(entry.image));
  const record={id:entry.id,image:entry.image,coverHash:entry.coverHash,series:entry.series,volume:entry.volume,yearBegan:entry.yearBegan,number:entry.number,coverDate:entry.coverDate,at:new Date().toISOString()};
  for(const [i,[name]] of RENDITIONS.entries()){
   const r=renditions[name],m=existing[i];
   if(!(m&&(m['cover-hash']||'')===hash))await put(keys[name],r.bytes,'image/webp','public, max-age=31536000, immutable',{'cover-hash':hash,width:String(r.width),height:String(r.height),'metron-id':String(entry.id)});
   record[name]={key:keys[name],width:r.width,height:r.height};
  }
  await recordDone(record);stats.copied++;
 }

 let processedThisRun=0,lastLog=0;
 for(let pass=1;!stopping&&processedThisRun<limit;pass++){
  const size=statSync(input).size;
  if(size===fileSize)break; // nothing new since the last pass
  fileSize=size;const loaded=await readIndex(input);index=loaded.index;
  const withImage=[...index.values()].filter(e=>e.image);
  const todo=withImage.filter(e=>!failed.has(e.id)&&!(done.has(e.id)&&sameVersion(done.get(e.id),e)));
  const rejected=[...index.values()].filter(e=>e.rawImage&&!e.image).length;
  console.log(`pass ${pass}: ${index.size} Metron issues (${withImage.length} with images${rejected?`, ${rejected} non-Metron image URLs rejected`:''}${loaded.bad?`, ${loaded.bad} unreadable lines`:''}); ${done.size} done, ${failed.size} failed, ${todo.length} to copy${dry?' [dry run]':''}`);
  if(!todo.length)continue;
  const queue=todo.slice(0,Number.isFinite(limit)?limit-processedThisRun:undefined);let cursor=0;
  const worker=async()=>{
   while(!stopping&&cursor<queue.length){
    const entry=queue[cursor++];
    try{await copyOne(entry)}
    catch(error){
     if(stopping&&error?.message==='stopping')break;
     // Storage credentials/permission problems stop the run instead of skipping every cover.
     if([401,403].includes(error?.$metadata?.httpStatusCode)||['InvalidAccessKeyId','SignatureDoesNotMatch','AccessDenied','NoSuchBucket','ExpiredToken'].includes(error?.name)){fatal=new Error('S3 rejected the request ('+(error.name||'access denied')+'); check COVER_S3_BUCKET, AWS_REGION and the IAM policy.');stopping=true;break}
     if(error?.permanent){failed.set(entry.id,true);appendFileSync(failedFile,JSON.stringify({id:entry.id,image:entry.image,error:String(error.message).slice(0,120),at:new Date().toISOString()})+'\n');stats.failed++}
     else stats.deferred++;
     console.log(`  #${entry.id}: ${error?.permanent?'skipped':'deferred to next run'} (${String(error?.message||error).slice(0,120)})`);
    }
    processedThisRun++;
    if(Date.now()-lastLog>30000||cursor>=queue.length){
     lastLog=Date.now();const elapsed=(Date.now()-stats.started)/1000,rate=(stats.copied+stats.reused)/Math.max(1,elapsed);
     const remaining=Math.max(0,withImage.length-done.size-failed.size);
     console.log(`done ${done.size}/${withImage.length} · this run ${stats.copied} copied, ${stats.reused} reused, ${stats.failed} failed, ${stats.deferred} deferred · ${rate.toFixed(2)}/s · ETA ${fmt(remaining/Math.max(rate,1e-6))}`);
    }
   }
  };
  await Promise.all(Array.from({length:Math.min(concurrency,queue.length)},worker));
 }
 if(done.size&&!fatal)await writeManifest();
 if(fatal)throw fatal;
 console.log(`finished: ${stats.copied} copied, ${stats.reused} reused, ${stats.failed} failed, ${stats.deferred} deferred in ${fmt((Date.now()-stats.started)/1000)}; ${done.size} covers total.`);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 main().catch(error=>{console.error('copy-metron-covers: '+(error?.message||error));process.exit(1)});
}
