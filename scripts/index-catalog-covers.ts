import {readFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {getPool} from '../db/postgres';
import {describeCoverPixels} from '../lib/cover-recognition';
import {perceptualCoverHash,hashBits} from '../lib/cover-phash';

// Index all locally stored, attributed catalog assets. No remote artwork is
// downloaded and no provider's hotlink restrictions are bypassed by this job.
// Licensed ingestion should first save its permitted files under public/covers.
const pool=getPool(),client=await pool.connect(),root=resolve('public/covers');
let indexed=0;
try{
 await client.query("SET statement_timeout='30s'; SET lock_timeout='5s'");
 const rows=await client.query("SELECT id,data FROM ch_web.catalog_issues WHERE data::jsonb->>'cover' LIKE '/covers/%' ORDER BY id");
 for(const row of rows.rows){
  const issue=JSON.parse(row.data),url=String(issue.cover),credit=String(issue.coverCredit||''),source=String(issue.coverSource||'');
  if(!/^\/covers\/[a-z0-9._/-]+\.(jpg|jpeg|png|webp)$/i.test(url)||!credit||!/^https:\/\//.test(source))continue;
  const file=resolve('public','.'+url);if(!file.startsWith(root+sep))continue;
  const bytes=await readFile(file),digest=createHash('sha256').update(bytes).digest('hex');
  const existing=await client.query('SELECT image_sha256,descriptor_version FROM ch_web.catalog_cover_features WHERE issue_id=$1',[row.id]);
  if(existing.rows[0]?.image_sha256===digest&&existing.rows[0].descriptor_version===2)continue;
  const {data,info}=await sharp(bytes,{limitInputPixels:25000000}).rotate().resize({width:640,height:640,fit:'inside',withoutEnlargement:true}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const pixels={width:info.width,height:info.height,data},descriptor=describeCoverPixels(pixels),hash=hashBits(perceptualCoverHash(pixels));
  await client.query('BEGIN');
  try{
   await client.query(`INSERT INTO ch_web.catalog_cover_features(issue_id,phash,descriptor,image_url,image_sha256,source_url,attribution) VALUES($1,$2::bit(64),$3::jsonb,$4,$5,$6,$7) ON CONFLICT(issue_id) DO UPDATE SET descriptor_version=2,phash=excluded.phash,descriptor=excluded.descriptor,image_url=excluded.image_url,image_sha256=excluded.image_sha256,source_url=excluded.source_url,attribution=excluded.attribution,active=true,indexed_at=now()`,[row.id,hash,JSON.stringify(descriptor),url,digest,source,credit]);
   await client.query('DELETE FROM ch_web.catalog_cover_feature_bands WHERE issue_id=$1',[row.id]);
   for(let band=0;band<8;band++)await client.query('INSERT INTO ch_web.catalog_cover_feature_bands(issue_id,band,bucket) VALUES($1,$2,$3::bit(8))',[row.id,band,hash.slice(band*8,band*8+8)]);
   await client.query('COMMIT');indexed++;
  }catch(error){await client.query('ROLLBACK');throw error}
 }
 // Keep the rate-limit registry bounded; it contains only HMAC client keys.
 await client.query("DELETE FROM ch_web.catalog_scan_rate_limits WHERE window_start<date_trunc('month',now())");
 const count=await client.query('SELECT count(*)::integer AS count FROM ch_web.catalog_cover_features WHERE active');
 console.log('CATALOG_VISUAL_INDEX '+JSON.stringify({newOrUpdated:indexed,activeReferences:count.rows[0].count,externalArtworkFetched:0}));
}finally{client.release();await pool.end()}
