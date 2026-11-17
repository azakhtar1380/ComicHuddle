// Saves the My Profile extras (tags, favorite character and comic, grail + reward, public-link switches).
// POST JSON with only the fields to change. Owner only; restricted accounts blocked.
import {queueTrophies} from '../../../lib/trophies';
import {eq} from 'drizzle-orm';
import {ZodError} from 'zod';
import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {profiles} from '../../../db/schema';
import {enforceWriteLimits,isRestricted,privateJson} from '../../../lib/api-security';
import {ExtrasError,extrasInput,saveExtras} from '../../../lib/profile-extras';

export const dynamic='force-dynamic';
const json=(error:string,status:number)=>privateJson({error},status);
export async function POST(req:Request){
 try{
  const user=await getChatGPTUser();if(!user)return json('Sign in to edit your profile.',401);
  if(req.headers.get('origin')!==new URL(req.url).origin)return json('Request origin rejected.',403);
  const db=getDb();const [profile]=await db.select().from(profiles).where(eq(profiles.userId,user.userId));
  if(!profile)return json('Create your free collector profile first.',403);
  if(profile.moderated||await isRestricted(db,user.userId))return json('Your account is restricted pending moderation review.',403);
  const limited=await enforceWriteLimits(db,user.userId,'profile:extras',30);if(limited)return limited;
  const input=extrasInput.parse(await req.json().catch(()=>null));
  await saveExtras(db as never,{id:profile.id,userId:user.userId},input);
  queueTrophies([user.userId]);
  return privateJson({saved:true});
 }catch(error){
  if(error instanceof ZodError)return json(error.issues[0]?.message||'Check those profile details.',400);
  if(error instanceof ExtrasError)return json(error.message,error.status);
  return json('Your profile details could not be saved. Please try again.',500);
 }
}
