// Photos attached to private messages. Served only to the two people in that conversation, only while
// the message still exists, and only when the photo was uploaded by the message's author.
import {env} from '../../../../lib/runtime-env';
import {getChatGPTUser} from '../../../chatgpt-auth';
import {getDb} from '../../../../db';
import {media,messages,profiles,threads} from '../../../../db/schema';
import {eq} from 'drizzle-orm';
import {privateJson} from '../../../../lib/api-security';
import {attachmentsFor,uuidPattern} from '../../../../lib/conversations';

const missing=()=>privateJson({error:'Photo not found.'},404);

export async function GET(req:Request){try{
 const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in to see this photo.'},401);
 const params=new URL(req.url).searchParams,messageId=params.get('message')||'',photoId=params.get('photo')||'';
 if(!uuidPattern.test(messageId)||!uuidPattern.test(photoId))return missing();
 const db=getDb();
 const [viewer]=await db.select().from(profiles).where(eq(profiles.userId,user.userId));if(!viewer)return missing();
 const [message]=await db.select().from(messages).where(eq(messages.id,messageId));if(!message)return missing();
 const [thread]=await db.select().from(threads).where(eq(threads.id,message.threadId));if(!thread||![thread.a,thread.b].includes(viewer.id))return missing();
 if(!(await attachmentsFor(db,[messageId])).get(messageId)?.includes(photoId))return missing();
 const [[asset],[author]]=await Promise.all([db.select().from(media).where(eq(media.id,photoId)),db.select().from(profiles).where(eq(profiles.id,message.profileId))]);
 if(!asset||!author||asset.userId!==author.userId)return missing();
 const thumbnail=params.get('size')==='thumbnail',rendition=thumbnail?await env.BUCKET?.get('thumbnails/'+photoId):null,object=rendition||await env.BUCKET?.get('photos/'+photoId);
 if(!object)return missing();
 return new Response(object.body as BodyInit,{headers:{'Content-Type':rendition?'image/webp':asset.contentType,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'inline'}});
}catch{return privateJson({error:'Photo could not be loaded. Please retry.'},500)}}
