// Profile cover photos (migration 051: ch_web.profile_extras.cover_id). Same rules as profile pictures
// (app/api/avatar): JPEG, PNG or WebP up to 4 MB, owner only, write limits, restricted accounts blocked.
// Stored as a 1500×500 WebP in the existing photo store under profile-covers/<id>. GET ?id= reads it.
import sharp from 'sharp';
import {eq} from 'drizzle-orm';
import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {getPool} from '../../../db/postgres';
import {profiles} from '../../../db/schema';
import {env} from '../../../lib/runtime-env';
import {ApiRequestError,enforceWriteLimits,isRestricted,privateJson,readBytes} from '../../../lib/api-security';
import {coverUrlFor,upsertExtras} from '../../../lib/profile-extras';

export const dynamic='force-dynamic';
const json=(error:string,status:number)=>privateJson({error},status);
const MAX=4194304;
const idPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

async function wideCover(bytes:Uint8Array){
 try{
  const source=sharp(bytes,{limitInputPixels:24000000,animated:false,failOn:'error'}),meta=await source.metadata();
  if(!meta.width||!meta.height||meta.width<300||meta.height<100||(meta.pages||1)>1||!['jpeg','png','webp'].includes(meta.format||''))throw Error('invalid');
  return await source.rotate().resize({width:1500,height:500,fit:'cover',position:'attention'}).webp({quality:82}).toBuffer();
 }catch{throw new ApiRequestError('Use a JPEG, PNG or WebP photo at least 300 pixels wide and under 4 MB.',400)}
}
async function owner(userId:string){const db=getDb();const [profile]=await db.select().from(profiles).where(eq(profiles.userId,userId));return {db,profile}}

export async function POST(req:Request){
 try{
  const user=await getChatGPTUser();if(!user)return json('Sign in to add a cover photo.',401);
  if(req.headers.get('origin')!==new URL(req.url).origin)return json('Request origin rejected.',403);
  const {db,profile}=await owner(user.userId);if(!profile)return json('Create your free collector profile first.',403);
  if(profile.moderated||await isRestricted(db,user.userId))return json('Your account is restricted pending moderation review.',403);
  const limited=await enforceWriteLimits(db,user.userId,'cover:upload',6);if(limited)return limited;
  const image=await wideCover(await readBytes(req,MAX)),id=crypto.randomUUID(),pool=getPool();
  const previous=await pool.query<{cover_id:string|null}>('SELECT cover_id FROM ch_web.profile_extras WHERE profile_id=$1',[profile.id]);
  await env.BUCKET.put('profile-covers/'+id,image,{httpMetadata:{contentType:'image/webp'}});
  await upsertExtras({id:profile.id,userId:user.userId},[['cover_id',id]]);
  const old=previous.rows[0]?.cover_id;if(old&&old!==id)await env.BUCKET.delete('profile-covers/'+old).catch(()=>undefined);
  return privateJson({coverUrl:coverUrlFor(id)});
 }catch(error){if(error instanceof ApiRequestError)return json(error.message,error.status);return json('Your cover photo could not be saved. Please try again.',500)}
}
export async function DELETE(req:Request){
 try{
  const user=await getChatGPTUser();if(!user)return json('Sign in first.',401);
  if(req.headers.get('origin')!==new URL(req.url).origin)return json('Request origin rejected.',403);
  const {db,profile}=await owner(user.userId);if(!profile)return privateJson({coverUrl:null});
  const limited=await enforceWriteLimits(db,user.userId,'cover:upload',6);if(limited)return limited;
  const removed=await getPool().query<{cover_id:string|null}>('WITH old AS (SELECT cover_id FROM ch_web.profile_extras WHERE profile_id=$1 AND cover_id IS NOT NULL FOR UPDATE) UPDATE ch_web.profile_extras x SET cover_id=NULL,updated_at=now() FROM old WHERE x.profile_id=$1 RETURNING old.cover_id',[profile.id]);
  for(const row of removed.rows)if(row.cover_id)await env.BUCKET.delete('profile-covers/'+row.cover_id).catch(()=>undefined);
  return privateJson({coverUrl:null});
 }catch{return json('Your cover photo could not be removed. Please try again.',500)}
}
export async function GET(req:Request){
 try{
  const id=new URL(req.url).searchParams.get('id')||'';if(!idPattern.test(id))return json('Picture not found.',404);
  const row=await getPool().query<{visible:number;moderated:number|boolean|null;deletion_started_at:string|null}>('SELECT p.visible,p.moderated,p.deletion_started_at FROM ch_web.profile_extras x JOIN ch_web.profiles p ON p.id=x.profile_id WHERE x.cover_id=$1',[id]);
  const o=row.rows[0];if(!o||o.moderated||o.deletion_started_at)return json('Picture not found.',404);
  if(!Number(o.visible)&&!await getChatGPTUser())return json('Picture not found.',404);
  const object=await env.BUCKET.get('profile-covers/'+id);if(!object)return json('Picture not found.',404);
  return new Response(Buffer.from(object.body),{headers:{'Content-Type':'image/webp','Cache-Control':'public, max-age=86400, immutable','X-Content-Type-Options':'nosniff'}});
 }catch{return json('Picture not found.',404)}
}
