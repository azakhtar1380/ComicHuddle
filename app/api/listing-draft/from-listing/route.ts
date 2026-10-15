import {z} from 'zod';
import {getChatGPTUser} from '../../../chatgpt-auth';
import {getDb} from '../../../../db';
import {ApiRequestError,enforceWriteLimits,privateJson,readObject} from '../../../../lib/api-security';
import {prepareListingEdit} from '../../../../lib/listing-edit';
export async function POST(request:Request){try{
 if(request.headers.get('origin')!==new URL(request.url).origin)return privateJson({error:'Origin rejected.'},403);
 const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in to edit your listing.'},401);
 const input=z.object({listingId:z.string().uuid()}).strict().parse(await readObject(request,2000)),db=getDb(),limited=await enforceWriteLimits(db,user.userId,'listing:edit',10);if(limited)return limited;
 return privateJson(await prepareListingEdit(db,user.userId,input.listingId));
}catch(error){return privateJson({error:error instanceof ApiRequestError?error.message:'The edit could not be confirmed. Check My Listings and your saved draft before retrying.'},error instanceof ApiRequestError?error.status:503)}}
