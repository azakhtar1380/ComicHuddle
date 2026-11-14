import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {profiles} from '../../../db/schema';
import {eq} from 'drizzle-orm';
import {z} from 'zod';
import {locationFilters} from '../../../lib/location-search';
import {marketplaceDirectory} from '../../../lib/marketplace-directory';
import {bidHistory,markAuctionUnpaid,resolveEndedAuctions} from '../../../lib/marketplace-auction';
import {ApiRequestError,enforceWriteLimits,privateJson,readObject} from '../../../lib/api-security';
export const dynamic='force-dynamic';
// Signed-out visitors may browse active listings through the public projection only.
export async function GET(request:Request){try{
 const user=await getChatGPTUser(),db=getDb(),url=new URL(request.url);
 const [viewer]=user?await db.select().from(profiles).where(eq(profiles.userId,user.userId)):[];
 const bids=url.searchParams.get('bids');
 if(bids!==null){if(!/^[A-Za-z0-9_-]{1,100}$/.test(bids))throw new ApiRequestError('Choose a valid auction.',400);await resolveEndedAuctions(db).catch(()=>[]);return privateJson({bids:await bidHistory(db,bids,viewer?.id)})}
 const rawOffset=url.searchParams.get('offset')||'0',rawId=url.searchParams.get('issue'),listingId=url.searchParams.get('listingId'),view=url.searchParams.get('view')||'active';
 if(!user&&view!=='active')return privateJson({error:'Sign in to see your listings.'},401);
 if(listingId!==null&&!/^[A-Za-z0-9_-]{1,100}$/.test(listingId))throw new ApiRequestError('Choose a valid listing ID.',400);
 if(!/^\d{1,8}$/.test(rawOffset)||rawId!==null&&!/^\d{1,10}$/.test(rawId))throw new ApiRequestError('Choose a valid listing page and comic ID.',400);
 // A signed-in visitor without a profile is still treated as a guest for privacy-sensitive fields.
 return privateJson(await marketplaceDirectory(db,viewer,{...locationFilters(url),view,q:url.searchParams.get('q')||'',category:url.searchParams.get('category')||'all',issueId:rawId===null?null:Number(rawId),offset:Number(rawOffset),...(listingId?{listingId}:{})},{guest:!viewer}));
}catch(error){return privateJson({error:error instanceof ApiRequestError?error.message:'Listings could not be loaded. Please retry.'},error instanceof ApiRequestError?error.status:503)}}

export async function POST(request:Request){try{
 const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in to continue.'},401);
 if(request.headers.get('origin')!==new URL(request.url).origin)return privateJson({error:'Request origin rejected.'},403);
 const db=getDb(),[me]=await db.select().from(profiles).where(eq(profiles.userId,user.userId));
 if(!me)return privateJson({error:'Create your free collector profile first.'},403);
 const input=z.object({action:z.literal('auction_unpaid'),listingId:z.string().uuid()}).strict().parse(await readObject(request,2000));
 const limited=await enforceWriteLimits(db,user.userId,'marketplace:'+input.action,10);if(limited)return limited;
 return privateJson(await markAuctionUnpaid(db,me,input.listingId));
}catch(error){return privateJson({error:error instanceof ApiRequestError?error.message:error instanceof z.ZodError?'Please check the request and try again.':'The auction could not be updated. Please retry.'},error instanceof ApiRequestError?error.status:error instanceof z.ZodError?400:503)}}
