import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {getPool} from '../db/postgres';
import {ApiRequestError} from './api-security';
export async function normalizeSellerPhoto(bytes:Uint8Array){
 try{const source=sharp(bytes,{limitInputPixels:16000000,animated:false,failOn:'error'}),meta=await source.metadata();if(!meta.width||!meta.height||meta.width<120||meta.height<120||(meta.pages||1)>1||!['jpeg','png','webp'].includes(meta.format||''))throw Error('invalid photo');
 const full=await source.clone().rotate().resize({width:2400,height:2400,fit:'inside',withoutEnlargement:true}).webp({quality:86}).toBuffer({resolveWithObject:true});
 const thumbnail=await source.clone().rotate().resize({width:480,height:640,fit:'inside',withoutEnlargement:true}).webp({quality:80}).toBuffer();
 if(full.data.length>4194304)throw Error('photo too large');return {bytes:full.data,thumbnail,contentType:'image/webp',width:full.info.width,height:full.info.height,hash:createHash('sha256').update(full.data).digest('hex')};
 }catch{throw new ApiRequestError('Upload a readable, still JPEG, PNG or WebP photo at least 120 pixels on each side and at most 16 megapixels.',400)}
}
/** Verify actual bytes, not just a media metadata row, before reserving a purchase. */
export async function ensureSellerPhotos(userId:string,ids:string[]){
 if(!ids.length)throw new ApiRequestError('Add a clear photograph of the actual comic or collection before listing.',400);
 const pool=getPool(),rows=await pool.query(`SELECT m.id,b.body,r.media_id AS normalized FROM ch_web.media m LEFT JOIN ch_web.photo_bytes b ON b.key='photos/'||m.id LEFT JOIN ch_web.media_renditions r ON r.media_id=m.id WHERE m.user_id=$1 AND m.id=ANY($2::text[])`,[userId,ids]);
 const byId=new Map(rows.rows.map(row=>[String(row.id),row]));
 for(const id of ids){const row=byId.get(id);if(!row?.body)throw new ApiRequestError('A listing photo is missing from storage. Re-upload the actual-copy photo before continuing.',409);if(!row.normalized){const image=await normalizeSellerPhoto(new Uint8Array(row.body));await pool.query(`INSERT INTO ch_web.photo_bytes(key,body,content_type) VALUES($1,$2,'image/webp') ON CONFLICT(key) DO NOTHING`,['thumbnails/'+id,image.thumbnail]);await pool.query(`INSERT INTO ch_web.media_renditions(media_id,width,height,content_hash,thumbnail_key) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[id,image.width,image.height,createHash('sha256').update(row.body).digest('hex'),'thumbnails/'+id])}}
}
