import {env} from '../../../lib/runtime-env';
import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {media,profiles,collections,listings,careProviders,careJobs,careEvents,commerceOrders,groupPosts,groups,memberships} from '../../../db/schema';
import {and,eq,count,or,inArray,sql} from 'drizzle-orm';
import {vaultSchema} from '../../../lib/vault';
import {blocked} from '../../../lib/conversations';
import {previewRulesVersion} from '../../../lib/community';
import {ApiRequestError,enforceWriteLimits,isRestricted,privateJson,readBytes} from '../../../lib/api-security';
import {normalizeSellerPhoto} from '../../../lib/seller-photos';
const json=(error:string,status:number)=>privateJson({error},status);

export async function POST(req:Request){try{
 const user=await getChatGPTUser();if(!user)return json('Sign in to upload.',401);
 if(req.headers.get('origin')!==new URL(req.url).origin)return json('Request origin rejected.',403);
 if(!env.BUCKET)return json('Photo storage is unavailable. Please retry later.',503);
 const db=getDb(),limited=await enforceWriteLimits(db,user.userId,'media:upload',20);if(limited)return limited;
 const [profile]=await db.select().from(profiles).where(eq(profiles.userId,user.userId));
 if(!profile)return json('Create your free collector profile before uploading photos.',403);
 if(profile.moderated||await isRestricted(db,user.userId))return json('Your account is restricted pending moderation review.',403);
 if(profile.rulesVersion!==previewRulesVersion||!profile.rulesAcceptedAt)return json('Open your collector profile and accept the current community rules before uploading.',403);
 const prepared=await normalizeSellerPhoto(await readBytes(req,4194304));
 const [n]=await db.select({n:count()}).from(media).where(eq(media.userId,user.userId));if(n.n>=500)return json('Your photo limit is 500. Contact the operator for more storage.',429);
 const id=crypto.randomUUID();await env.BUCKET.put('photos/'+id,prepared.bytes,{httpMetadata:{contentType:prepared.contentType}});
 try{await env.BUCKET.put('thumbnails/'+id,prepared.thumbnail,{httpMetadata:{contentType:'image/webp'}});await db.batch([db.insert(media).values({id,userId:user.userId,contentType:prepared.contentType,createdAt:new Date().toISOString()}),db.execute(sql`INSERT INTO ch_web.media_renditions(media_id,width,height,content_hash,thumbnail_key) VALUES(${id},${prepared.width},${prepared.height},${prepared.hash},${'thumbnails/'+id})`)])}catch{await env.BUCKET.delete(['photos/'+id,'thumbnails/'+id]);return json('Photo could not be saved.',500)}
 return privateJson({id});
}catch(error){if(error instanceof ApiRequestError)return json(error.message,error.status);return json('Photo could not be uploaded. Please retry.',500)}}

export async function GET(req:Request){try{
 const user=await getChatGPTUser();if(!user)return json('Sign in to view collector photos.',401);
 const id=new URL(req.url).searchParams.get('id')||'';if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))return json('Photo not found.',404);
 const db=getDb();const [asset]=await db.select().from(media).where(eq(media.id,id));if(!asset)return json('Photo not found.',404);
 let shared=asset.userId===user.userId;
 if(!shared){
  const [viewer]=await db.select().from(profiles).where(eq(profiles.userId,user.userId));
  const [owner]=await db.select().from(profiles).where(eq(profiles.userId,asset.userId));
  const publiclyVisible=owner?.visible&&!owner.moderated&&(!viewer||!await blocked(db,viewer.id,owner.id));
  if(publiclyVisible){
   const [listed]=await db.select({id:listings.id}).from(listings).where(and(eq(listings.sellerId,owner.id),inArray(listings.status,['active','ended']),or(
    sql`EXISTS (SELECT 1 FROM json_each(${listings.photos}) photo WHERE photo.value = ${id})`,
    sql`EXISTS (SELECT 1 FROM json_each(${listings.items}) item WHERE json_extract(item.value, '$.photoId') = ${id})`
   ))).limit(1);
   shared=!!listed;
   if(!shared){const [row]=await db.select().from(collections).where(eq(collections.userId,asset.userId));if(row){const vault=vaultSchema.safeParse(JSON.parse(row.data));if(vault.success){const featured=JSON.parse(owner.featured) as string[];shared=vault.data.books.some(b=>b.photoId===id&&(featured.includes(b.id)||vault.data.tradeBookIds.includes(b.id)))}}}
   if(!shared){const [provider]=await db.select().from(careProviders).where(eq(careProviders.profileId,owner.id));if(provider?.visible&&!provider.moderated)shared=provider.logoId===id||(JSON.parse(provider.portfolio) as {before:string;after:string}[]).some(p=>p.before===id||p.after===id)}
  }
  // Group attachments remain private to current eligible members. A hidden
  // showcase is allowed here; it does not make the attachment publicly shared.
  if(!shared&&viewer&&owner&&!viewer.moderated&&!viewer.deletionStartedAt&&!owner.moderated&&!owner.deletionStartedAt){
   const [attachment]=await db.select({id:groupPosts.id}).from(groupPosts).innerJoin(groups,eq(groups.id,groupPosts.groupId)).innerJoin(memberships,and(eq(memberships.groupId,groups.id),eq(memberships.profileId,viewer.id))).where(and(
    eq(groupPosts.photoId,id),eq(groupPosts.profileId,owner.id),
    sql`NOT EXISTS (SELECT 1 FROM account_restrictions r WHERE r.scope = 'account' AND r.user_id IN (${viewer.userId},${owner.userId}))`,
    sql`NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.from_id = ${viewer.id} AND b.to_id = ${owner.id}) OR (b.from_id = ${owner.id} AND b.to_id = ${viewer.id}))`,
    sql`(${groups.ownerId} IS NULL OR EXISTS (SELECT 1 FROM profiles manager WHERE manager.id = ${groups.ownerId} AND manager.moderated = 0 AND manager.deletion_started_at IS NULL AND NOT EXISTS (SELECT 1 FROM account_restrictions r WHERE r.scope = 'account' AND r.user_id = manager.user_id) AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.from_id = ${viewer.id} AND b.to_id = manager.id) OR (b.from_id = manager.id AND b.to_id = ${viewer.id}))))`
   )).limit(1);shared=!!attachment;
  }
  // A paid order preserves its own private photo evidence even after discovery
  // is blocked or its seller hides the listing. Unpaid reservations grant none.
  if(!shared){
   const [order]=await db.select({id:commerceOrders.id}).from(commerceOrders).where(and(
    eq(commerceOrders.sandbox,1),eq(commerceOrders.sellerUserId,asset.userId),
    or(eq(commerceOrders.buyerUserId,user.userId),eq(commerceOrders.sellerUserId,user.userId)),
    sql`json_extract(${commerceOrders.state}, '$.order.paidAt') IS NOT NULL`,
    or(sql`EXISTS (SELECT 1 FROM json_each(${commerceOrders.snapshot}, '$.photoIds') photo WHERE photo.value = ${id})`,
       sql`EXISTS (SELECT 1 FROM json_each(${commerceOrders.snapshot}, '$.items') item WHERE json_extract(item.value, '$.photoId') = ${id})`)
   )).limit(1);
   shared=!!order;
  }
  // Blocking discovery does not destroy either participant's existing private
  // custody records. Their own care jobs may also grant this exception.
  if(!shared&&viewer){
   const participation=or(eq(careJobs.requesterId,viewer.id),eq(careJobs.providerProfileId,viewer.id));
   const [book]=await db.select({id:careJobs.id}).from(careJobs).where(and(participation,sql`EXISTS (SELECT 1 FROM json_each(${careJobs.books}) item WHERE json_extract(item.value, '$.photoId') = ${id})`)).limit(1);
   shared=!!book;
   if(!shared){const [event]=await db.select({id:careEvents.id}).from(careEvents).where(and(inArray(careEvents.jobId,db.select({id:careJobs.id}).from(careJobs).where(participation)),sql`EXISTS (SELECT 1 FROM json_each(${careEvents.photos}) photo WHERE photo.value = ${id})`)).limit(1);shared=!!event}
  }
 }
 if(!shared)return json('Photo not found.',404);
 const thumbnail=new URL(req.url).searchParams.get('size')==='thumbnail',rendition=thumbnail?await env.BUCKET?.get('thumbnails/'+id):null;const object=rendition||await env.BUCKET?.get('photos/'+id);if(!object)return json('Photo not found.',404);
 return new Response(object.body,{headers:{'Content-Type':rendition?'image/webp':asset.contentType,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'inline'}});
}catch{return json('Photo could not be loaded. Please retry.',500)}}
