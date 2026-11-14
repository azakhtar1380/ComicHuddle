import {count,eq,sql} from 'drizzle-orm';
import {env} from '../../../../lib/runtime-env';
import {getChatGPTUser} from '../../../chatgpt-auth';
import {getDb} from '../../../../db';
import {media,profiles} from '../../../../db/schema';
import {previewRulesVersion} from '../../../../lib/community';
import {ApiRequestError,enforceWriteLimits,isRestricted,privateJson,readBytes} from '../../../../lib/api-security';
import {catalogIssuesById} from '../../../../lib/catalog-store';
import {COMMUNITY_COVER_CREDIT,communityPhotoUrl} from '../../../../lib/cover-cache-types';
import {COMMUNITY_COVER_DAILY_LIMIT,COMMUNITY_COVER_MAX_UPLOAD,communityCoverSubmission,communitySubmissionsToday,initialCommunityCoverStatus,normalizeCommunityCover} from '../../../../lib/community-covers';
export const runtime='nodejs';export const dynamic='force-dynamic';
const json=(error:string,status:number)=>privateJson({error},status);

/** A signed-in collector adds a cover photo to a Directory issue that has none.
 * Body: the raw JPEG/PNG/WebP bytes. Query: ?issueId=. Stored like listing photos. */
export async function POST(req:Request){try{
 const user=await getChatGPTUser();if(!user)return json('Sign in to add a cover photo.',401);
 if(req.headers.get('origin')!==new URL(req.url).origin)return json('Request origin rejected.',403);
 if(!env.BUCKET)return json('Photo storage is unavailable. Please retry later.',503);
 const input=communityCoverSubmission.safeParse({issueId:new URL(req.url).searchParams.get('issueId'),contentType:(req.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()});
 if(!input.success)return json(input.error.issues[0]?.message.startsWith('Upload')?input.error.issues[0].message:'Choose a Directory issue and a JPEG, PNG or WebP photo.',400);
 const db=getDb(),limited=await enforceWriteLimits(db,user.userId,'covers:submit',6);if(limited)return limited;
 const [profile]=await db.select().from(profiles).where(eq(profiles.userId,user.userId));
 if(!profile)return json('Create your free collector profile before sharing cover photos.',403);
 if(profile.moderated||profile.deletionStartedAt||await isRestricted(db,user.userId))return json('Your account is restricted pending moderation review.',403);
 if(profile.rulesVersion!==previewRulesVersion||!profile.rulesAcceptedAt)return json('Open your collector profile and accept the current community rules before sharing photos.',403);
 const [issue]=await catalogIssuesById(db,[input.data.issueId]);if(!issue)return json('That Directory issue was not found.',404);
 // Only fill gaps: an issue with a reviewed, licensed or seller cover does not take submissions.
 // (comics.org references are never shown directly by the cover component, so they do not count.)
 if(issue.cover&&!/comics\.org/i.test(issue.cover)&&issue.coverCredit!==COMMUNITY_COVER_CREDIT)return json('This issue already has a cover image.',409);
 if(await communitySubmissionsToday(db,user.userId)>=COMMUNITY_COVER_DAILY_LIMIT)return json('You can share up to '+COMMUNITY_COVER_DAILY_LIMIT+' cover photos per day. Please try again tomorrow.',429);
 const [n]=await db.select({n:count()}).from(media).where(eq(media.userId,user.userId));if(n.n>=500)return json('Your photo limit is 500. Contact the operator for more storage.',429);
 const prepared=await normalizeCommunityCover(await readBytes(req,COMMUNITY_COVER_MAX_UPLOAD),input.data.contentType);
 const id=crypto.randomUUID(),status=initialCommunityCoverStatus();
 await env.BUCKET.put('photos/'+id,prepared.bytes,{httpMetadata:{contentType:prepared.contentType}});
 try{await env.BUCKET.put('thumbnails/'+id,prepared.thumbnail,{httpMetadata:{contentType:'image/webp'}});await db.batch([
  db.insert(media).values({id,userId:user.userId,contentType:prepared.contentType,createdAt:new Date().toISOString()}),
  db.execute(sql`INSERT INTO ch_web.media_renditions(media_id,width,height,content_hash,thumbnail_key) VALUES(${id},${prepared.width},${prepared.height},${prepared.hash},${'thumbnails/'+id})`),
  db.execute(sql`INSERT INTO ch_web.community_covers(id,issue_id,media_id,user_id,status,width,height,content_hash) VALUES(${crypto.randomUUID()},${issue.id},${id},${user.userId},${status},${prepared.width},${prepared.height},${prepared.hash})`)])}
 catch{await env.BUCKET.delete(['photos/'+id,'thumbnails/'+id]);return json('Cover photo could not be saved.',500)}
 return privateJson({status,cover:status==='approved'?{url:communityPhotoUrl(id),attribution:COMMUNITY_COVER_CREDIT}:null});
}catch(error){if(error instanceof ApiRequestError)return json(error.message,error.status);return json('Cover photo could not be uploaded. Please retry.',500)}}
