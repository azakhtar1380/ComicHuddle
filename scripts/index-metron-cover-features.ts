// Free visual scanner index: computes the scanner's perceptual hash + colour/edge descriptor
// for every matched Metron cover copy in our own S3 bucket and stores it in
// ch_web.catalog_visual_features (the table /api/recognition matches photos against).
// No AI, no third-party calls: reads our bucket only. Incremental and resumable.
//   node --import tsx scripts/index-metron-cover-features.ts [--limit N] [--budget-seconds S]
import sharp from 'sharp';
import {GetObjectCommand,S3Client} from '@aws-sdk/client-s3';
import {readFileSync,existsSync} from 'node:fs';
import {getPool} from '../db/postgres';
import {describeCoverPixels,type CoverDescriptor} from '../lib/cover-recognition';
import {perceptualCoverHash,hashBits} from '../lib/cover-phash';
import {METRON_COVER_ATTRIBUTION} from '../lib/data-credits';

const args=process.argv.slice(2),flag=(name:string)=>{const i=args.indexOf(name);return i>=0?Number(args[i+1]):undefined};
const limit=flag('--limit')??Infinity,deadline=Date.now()+(flag('--budget-seconds')??Infinity)*1000;
function localEnv(name:string){if(process.env[name])return process.env[name];if(!existsSync('.env.local'))return undefined;const m=new RegExp('^'+name+'="?([^"\\r\\n]*)"?','m').exec(readFileSync('.env.local','utf8'));return m?.[1]}
const bucket=localEnv('COVER_S3_BUCKET'),id=localEnv('COVER_AWS_ACCESS_KEY_ID')||localEnv('AWS_ACCESS_KEY_ID'),secret=localEnv('COVER_AWS_SECRET_ACCESS_KEY')||localEnv('AWS_SECRET_ACCESS_KEY');
if(!bucket||!id||!secret)throw new Error('Cover bucket credentials are not configured.');
const s3=new S3Client({region:localEnv('COVER_AWS_REGION')||localEnv('AWS_REGION')||'us-east-2',credentials:{accessKeyId:id,secretAccessKey:secret}});
// 4 decimals keeps matching identical in practice and roughly halves storage.
const round=(values:number[])=>values.map(v=>Math.round(v*1e4)/1e4);
const compact=(d:CoverDescriptor):CoverDescriptor=>({luma:round(d.luma),chroma:round(d.chroma),edges:round(d.edges),contrast:Math.round(d.contrast*1e4)/1e4});

const pool=getPool(),client=await pool.connect();
let indexed=0,failed=0;const started=Date.now();
try{
 await client.query("SET statement_timeout='60s'");
 while(indexed+failed<limit&&Date.now()<deadline){
  // Matched copies not yet indexed (or indexed from a different image). Best match per issue only.
  const batch=await client.query(`SELECT DISTINCT ON(m.issue_id) m.issue_id,m.metron_id,m.card->>'key' AS key FROM ch_web.metron_cover_index m
   LEFT JOIN ch_web.catalog_visual_features f ON f.issue_id=m.issue_id
   WHERE m.issue_id IS NOT NULL AND m.card IS NOT NULL AND (f.issue_id IS NULL OR f.image_url<>'metron:'||m.metron_id)
   ORDER BY m.issue_id,(COALESCE(m.match_method,'') LIKE 'exact%') DESC,m.metron_id LIMIT 200`);
  if(!batch.rows.length)break;
  for(const row of batch.rows){
   if(indexed+failed>=limit||Date.now()>=deadline)break;
   const key=String(row.key);if(!/^metron\/[1-9][0-9]{0,9}\/card\.webp$/.test(key)){failed++;continue}
   try{
    const object=await s3.send(new GetObjectCommand({Bucket:bucket,Key:key}));
    const bytes=Buffer.from(await object.Body!.transformToByteArray());
    const {data,info}=await sharp(bytes,{limitInputPixels:25000000}).rotate().resize({width:640,height:640,fit:'inside',withoutEnlargement:true}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const pixels={width:info.width,height:info.height,data},descriptor=compact(describeCoverPixels(pixels)),hash=hashBits(perceptualCoverHash(pixels));
    await client.query('BEGIN');
    try{
     await client.query(`INSERT INTO ch_web.catalog_visual_features(issue_id,phash,descriptor,image_url,image_sha256,source_url,attribution) VALUES($1,$2::bit(64),$3::jsonb,$4,$5,$6,$7)
      ON CONFLICT(issue_id) DO UPDATE SET descriptor_version=2,phash=excluded.phash,descriptor=excluded.descriptor,image_url=excluded.image_url,image_sha256=excluded.image_sha256,source_url=excluded.source_url,attribution=excluded.attribution`,
      [row.issue_id,hash,JSON.stringify(descriptor),'metron:'+row.metron_id,(await import('node:crypto')).createHash('sha256').update(bytes).digest('hex'),'https://metron.cloud/issue/'+row.metron_id+'/',METRON_COVER_ATTRIBUTION]);
     await client.query('DELETE FROM ch_web.catalog_visual_feature_bands WHERE issue_id=$1',[row.issue_id]);
     await client.query(`INSERT INTO ch_web.catalog_visual_feature_bands(issue_id,band,bucket) SELECT $1,b,substring($2::bit(64) from b*8+1 for 8)::bit(8) FROM generate_series(0,7) b`,[row.issue_id,hash]);
     await client.query('COMMIT');indexed++;
    }catch(error){await client.query('ROLLBACK');throw error}
   }catch(error){failed++;if(failed<=5)console.warn('skip',row.issue_id,(error as {name?:string})?.name||'error')}
   if((indexed+failed)%250===0)console.log(`indexed ${indexed} · failed ${failed} · ${((indexed+failed)/((Date.now()-started)/1000)).toFixed(1)}/s`);
  }
 }
 const count=await client.query('SELECT count(*)::integer AS count FROM ch_web.catalog_visual_features WHERE active');
 console.log('METRON_VISUAL_INDEX '+JSON.stringify({indexed,failed,activeReferences:count.rows[0].count,aiCalls:0,externalRequests:0}));
}finally{client.release();await pool.end()}
