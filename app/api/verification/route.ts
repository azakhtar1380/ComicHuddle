// Verified collectors. GET: your verification status. POST {action:'request',contact}: ask to be verified
// (pending; we contact you to confirm you're a real person). Admin: GET ?kind=admin_list&status=,
// POST {action:'decide',profileId,verified,note} turns the check on or off by hand (logged).
import {eq} from 'drizzle-orm';
import {z,ZodError} from 'zod';
import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {profiles} from '../../../db/schema';
import {AdminRequiredError,isAdmin,requireAdmin} from '../../../lib/admin';
import {logAdminAction} from '../../../lib/admin-audit';
import {enforceWriteLimits,isRestricted,privateJson} from '../../../lib/api-security';
import {ownBusiness} from '../../../lib/business-profile';
import {listPersonVerifications,personVerification,requestPersonVerification,setPersonVerified} from '../../../lib/person-verification';
import {notify} from '../../../lib/notifications';
import {queueTrophies} from '../../../lib/trophies';

export const dynamic='force-dynamic';
const json=(error:string,status:number)=>privateJson({error},status);
export async function GET(req:Request){
 try{
  const user=await getChatGPTUser();if(!user)return json('Sign in first.',401);
  const url=new URL(req.url);
  if(url.searchParams.get('kind')==='admin_list'){requireAdmin(user);const status=z.enum(['all','unverified','pending','verified','revoked']).catch('pending').parse(url.searchParams.get('status')||'pending');return privateJson({people:await listPersonVerifications(status)})}
  const [p]=await getDb().select().from(profiles).where(eq(profiles.userId,user.userId));
  if(!p)return privateJson({status:'unverified',requestedAt:null,verifiedAt:null,business:false,admin:isAdmin(user)});
  const biz=await ownBusiness(p.id).catch(()=>null);
  return privateJson({...await personVerification(p.id),business:biz?.accountType==='business',admin:isAdmin(user)});
 }catch(error){if(error instanceof AdminRequiredError)return json(error.message,403);return json('Verification status could not load.',500)}
}
const body=z.discriminatedUnion('action',[
 z.object({action:z.literal('request'),contact:z.string().trim().max(500).default('')}),
 z.object({action:z.literal('decide'),profileId:z.string().max(100),verified:z.boolean(),note:z.string().trim().min(3).max(500)}),
]);
export async function POST(req:Request){
 try{
  const user=await getChatGPTUser();if(!user)return json('Sign in first.',401);
  if(req.headers.get('origin')!==new URL(req.url).origin)return json('Request origin rejected.',403);
  const a=body.parse(await req.json()),db=getDb();
  if(a.action==='decide'){
   requireAdmin(user);
   const result=await setPersonVerified(user.userId,a.profileId,a.verified,a.note);
   await logAdminAction({admin:user,action:a.verified?'person_verification_granted':'person_verification_removed',targetType:'profile',targetId:a.profileId,detail:{note:a.note}});
   if(result.changed)await notify({userId:result.userId,kind:'verification',title:a.verified?'You’re verified!':'Your verified check was removed',body:a.verified?'The blue check now shows next to your name.':'Contact support if you think this is a mistake.',href:'/verified'});
   queueTrophies([result.userId]);
   return privateJson({status:result.status});
  }
  const [p]=await db.select().from(profiles).where(eq(profiles.userId,user.userId));
  if(!p)return json('Create your free collector profile first.',403);
  if(p.moderated||await isRestricted(db,user.userId))return json('Your account is restricted pending moderation review.',403);
  const biz=await ownBusiness(p.id).catch(()=>null);
  if(biz?.accountType==='business')return json('Business accounts are verified through the business details in your profile.',400);
  const limited=await enforceWriteLimits(db,user.userId,'verification:request',5);if(limited)return limited;
  return privateJson(await requestPersonVerification({id:p.id,userId:user.userId},a.contact));
 }catch(error){
  if(error instanceof AdminRequiredError)return json(error.message,403);
  if(error instanceof ZodError)return json('Add a short note.',400);
  const status=(error as {status?:number}).status;if(status)return json((error as Error).message,status);
  return json('That didn’t save. Please retry.',500);
 }
}
