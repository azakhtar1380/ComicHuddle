import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {profiles} from '../../../db/schema';
import {eq} from 'drizzle-orm';
import {locationFilters} from '../../../lib/location-search';
import {marketplaceDirectory} from '../../../lib/marketplace-directory';
import {ApiRequestError,privateJson} from '../../../lib/api-security';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 const user=await getChatGPTUser();if(!user)return privateJson({error:'Join free to browse collector listings.'},401);
 const db=getDb(),url=new URL(request.url),[viewer]=await db.select().from(profiles).where(eq(profiles.userId,user.userId));
 const rawOffset=url.searchParams.get('offset')||'0',rawId=url.searchParams.get('issue');
 if(!/^\d{1,8}$/.test(rawOffset)||rawId!==null&&!/^\d{1,10}$/.test(rawId))throw new ApiRequestError('Choose a valid listing page and comic ID.',400);
 return privateJson(await marketplaceDirectory(db,viewer,{...locationFilters(url),view:url.searchParams.get('view')||'active',q:url.searchParams.get('q')||'',category:url.searchParams.get('category')||'all',issueId:rawId===null?null:Number(rawId),offset:Number(rawOffset)}));
}catch(error){return privateJson({error:error instanceof ApiRequestError?error.message:'Listings could not be loaded. Please retry.'},error instanceof ApiRequestError?error.status:503)}}
