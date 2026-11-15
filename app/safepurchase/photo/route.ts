// GET /safepurchase/photo?update=<id>&photo=<id>[&size=thumbnail] — a photo an admin attached to a
// SafePurchase timeline update. Shared updates: the order's buyer, seller and admins. Internal: admins only.
import {env} from '../../../lib/runtime-env';
import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {commerceOrders,media} from '../../../db/schema';
import {eq} from 'drizzle-orm';
import {isAdmin} from '../../../lib/admin';
import {privateJson} from '../../../lib/api-security';
import {updateForPhoto} from '../../../lib/safepurchase';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const notFound=()=>privateJson({error:'Photo not found.'},404);
export const dynamic='force-dynamic';
export async function GET(req:Request){
 try{
  const user=await getChatGPTUser();if(!user)return notFound();
  const params=new URL(req.url).searchParams,updateId=params.get('update')||'',photoId=params.get('photo')||'';
  if(!UUID.test(updateId)||!UUID.test(photoId))return notFound();
  const update=await updateForPhoto(updateId,photoId);if(!update)return notFound();
  let allowed=isAdmin(user);
  if(!allowed&&!update.internal){const [row]=await getDb().select({buyer:commerceOrders.buyerUserId,seller:commerceOrders.sellerUserId}).from(commerceOrders).where(eq(commerceOrders.id,update.orderId));allowed=!!row&&(row.buyer===user.userId||row.seller===user.userId)}
  if(!allowed)return notFound();
  const thumbnail=params.get('size')==='thumbnail',rendition=thumbnail?await env.BUCKET.get('thumbnails/'+photoId):null,object=rendition||await env.BUCKET.get('photos/'+photoId);
  if(!object)return notFound();
  const type=rendition?'image/webp':(await contentType(photoId));
  return new Response(object.body as BodyInit,{headers:{'Content-Type':type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'inline'}});
 }catch{return privateJson({error:'Photo could not be loaded. Try again.'},500)}
}
async function contentType(photoId:string){
 const [row]=await getDb().select({type:media.contentType}).from(media).where(eq(media.id,photoId));
 return row&&/^image\/(jpeg|png|webp|gif|avif)$/.test(row.type)?row.type:'image/jpeg';
}
