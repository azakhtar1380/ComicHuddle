// Loads the Metron character crawl cache (scripts/crawl-metron-characters.ts) into the database
// (migration 030), links harvested Metron issues to catalog issues, derives character_issues /
// merges / shown facts, and copies character portraits to S3 as
// metron-characters/<id>/portrait.webp (240px WebP, served by app/api/cover-cdn).
// Idempotent; new cache lines are imported incrementally (per-database byte offsets).
//
//   node --import tsx scripts/import-characters.ts [--full] [--relink] [--portraits N] [--no-portraits]
//
// Portrait downloads come from static.metron.cloud (not Metron API calls). S3 env (process env or
// .env.local): COVER_S3_BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (or COVER_AWS_*).
// Credentials are never logged.
import {existsSync,mkdirSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {sql} from 'drizzle-orm';
import sharp from 'sharp';
import {getDb} from '../db';
import {metronImage,portraitKey,type MetronCharacterDetail,type MetronIssueDetail} from '../lib/characters';
import {finalizeCharacters,importCharacterDetails,importCharacterList,importIssueDetails,importIssueLists,linkMetronIssues,ndjson,readHarvest,type IssueListPage} from '../lib/characters-import';

const args=process.argv.slice(2),flag=(n:string)=>{const i=args.indexOf(n);return i>=0?args[i+1]:undefined};
const full=args.includes('--full'),relink=args.includes('--relink'),portraitLimit=args.includes('--no-portraits')?0:Number(flag('--portraits')||500);
const dir='.metron-cache/characters',harvestFile='.metron-cache/metron-issues.ndjson';mkdirSync(dir,{recursive:true});
const dbKey=createHash('sha256').update((process.env.DB_HOST||'local')+'/'+(process.env.DB_NAME||'')).digest('hex').slice(0,12);
const stateFile=join(dir,`import-state.${dbKey}.json`);
type ImportState={offsets:Record<string,number>;harvest?:{size:number;mtime:number}};
const state:ImportState=!full&&existsSync(stateFile)?JSON.parse(readFileSync(stateFile,'utf8')):{offsets:{}};
const save=()=>writeFileSync(stateFile,JSON.stringify(state,null,1));
const log=(line:string)=>console.log('characters: '+line);
const db=getDb();

async function readNew<T>(name:string){
 const file=join(dir,name+'.ndjson'),rows:T[]=[];let end=state.offsets[name]||0;
 if(existsSync(file)&&statSync(file).size<end)end=0; // file replaced: start over
 for await(const line of ndjson<T>(file,end)){rows.push(line.value);end=line.end}
 return {rows,commit:()=>{state.offsets[name]=end}};
}

function loadEnv(){
 if(!existsSync('.env.local'))return;
 for(const line of readFileSync('.env.local','utf8').split(/\r?\n/)){
  const m=/^\s*(?:export\s+)?(COVER_S3_BUCKET|AWS_REGION|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|COVER_AWS_REGION|COVER_AWS_ACCESS_KEY_ID|COVER_AWS_SECRET_ACCESS_KEY)\s*=\s*(.*)\s*$/.exec(line);
  if(!m||process.env[m[1]])continue;let v=m[2];if(/^".*"$/.test(v)||/^'.*'$/.test(v))v=v.slice(1,-1);if(v)process.env[m[1]]=v;
 }
}
async function copyPortraits(limit:number){
 loadEnv();const e=process.env,bucket=e.COVER_S3_BUCKET;
 if(!bucket||!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)){log('portraits skipped: COVER_S3_BUCKET not set');return 0}
 const id=e.COVER_AWS_ACCESS_KEY_ID||e.AWS_ACCESS_KEY_ID,secret=e.COVER_AWS_SECRET_ACCESS_KEY||e.AWS_SECRET_ACCESS_KEY;
 if(!id||!secret){log('portraits skipped: AWS credentials not set');return 0}
 const aws=await import('@aws-sdk/client-s3');
 const s3=new aws.S3Client({region:e.COVER_AWS_REGION||e.AWS_REGION||'us-east-2',maxAttempts:4,credentials:{accessKeyId:id,secretAccessKey:secret,...(e.AWS_SESSION_TOKEN&&!e.COVER_AWS_ACCESS_KEY_ID?{sessionToken:e.AWS_SESSION_TOKEN}:{})}});
 // Characters shown on profiles first (first appearances), then by issue count.
 const todo=(await db.execute(sql`SELECT c.character_id,c.image_url FROM ch_web.characters c WHERE c.character_id>0 AND c.image_url IS NOT NULL AND c.portrait_key IS NULL
  ORDER BY EXISTS(SELECT 1 FROM ch_web.character_first_appearances f WHERE f.character_id=c.character_id AND f.issue_id IS NOT NULL AND NOT f.suppressed) DESC,c.issue_count DESC NULLS LAST,c.character_id LIMIT ${limit}`)).rows;
 let copied=0,failed=0;
 for(const row of todo){
  const cid=Number(row.character_id),url=metronImage(row.image_url),key=portraitKey(cid);
  if(!url)continue;
  try{
   const res=await fetch(url,{redirect:'error',headers:{'User-Agent':'ComicHuddle portrait mirror (one-time copy, ~1 image/s; contact via metron.cloud account)',Accept:'image/jpeg,image/png,image/webp'},signal:AbortSignal.timeout(60000)});
   if(!res.ok||!/^image\//i.test(res.headers.get('content-type')||''))throw new Error('HTTP '+res.status);
   const bytes=Buffer.from(await res.arrayBuffer());if(bytes.length>15*1024*1024)throw new Error('image too large');
   const img=sharp(bytes,{limitInputPixels:60000000,animated:false,failOn:'error'});const meta=await img.metadata();
   if(!meta.width||!['jpeg','png','webp'].includes(meta.format||''))throw new Error('unsupported image');
   const out=await img.rotate().resize({width:240,withoutEnlargement:true}).webp({quality:80,effort:4}).toBuffer();
   await s3.send(new aws.PutObjectCommand({Bucket:bucket,Key:key,Body:out,ContentType:'image/webp',CacheControl:'public, max-age=31536000, immutable',Metadata:{'metron-character-id':String(cid)}}));
   await db.execute(sql`UPDATE ch_web.characters SET portrait_key=${key},updated_at=now() WHERE character_id=${cid} AND image_url=${url}`);
   copied++;
  }catch(error){
   const name=(error as {name?:string})?.name;
   if(['InvalidAccessKeyId','SignatureDoesNotMatch','AccessDenied','NoSuchBucket','ExpiredToken'].includes(name||'')){log('portraits stopped: S3 rejected the request ('+name+')');break}
   failed++;log(`portrait ${cid} skipped (${String((error as Error)?.message||error).slice(0,80)})`);
  }
  await new Promise(r=>setTimeout(r,1000));
 }
 log(`portraits: ${copied} copied, ${failed} failed, ${Math.max(0,todo.length-copied-failed)} left in this batch`);
 return copied;
}

try{
 const present=await db.execute(sql`SELECT to_regclass('ch_web.characters') IS NOT NULL AS ok`);
 if(present.rows[0]?.ok!==true)throw new Error('Migration 030 is not applied (ch_web.characters missing).');
 if(existsSync(harvestFile)){
  const st=statSync(harvestFile),stamp={size:st.size,mtime:Math.round(st.mtimeMs)};
  if(relink||full||!state.harvest||state.harvest.size!==stamp.size||state.harvest.mtime!==stamp.mtime){
   await linkMetronIssues(db,await readHarvest(harvestFile),log);state.harvest=stamp;save();
  }else log('Metron issue links unchanged (use --relink to recompute after a GCD or cover-index refresh)');
 }
 const list=await readNew<{id:number;name:string;modified:string|null}>('list');
 if(list.rows.length){log(`character list: ${await importCharacterList(db,list.rows)} rows`);}list.commit();save();
 const details=await readNew<MetronCharacterDetail>('details');
 if(details.rows.length)log(`character details: ${await importCharacterDetails(db,details.rows)} rows`);details.commit();save();
 const issues=await readNew<MetronIssueDetail>('issues');
 if(issues.rows.length)log(`issue details: ${await importIssueDetails(db,issues.rows)} rows`);issues.commit();save();
 const lists=await readNew<IssueListPage>('issue-lists');
 if(lists.rows.length)log(`issue-list pages: ${await importIssueLists(db,lists.rows)} rows`);lists.commit();save();
 await finalizeCharacters(db,log);
 if(portraitLimit>0)await copyPortraits(portraitLimit);
}finally{
 const pool=(globalThis as typeof globalThis&{comicHuddlePool?:{end():Promise<void>}}).comicHuddlePool;await pool?.end().catch(()=>undefined);
}
