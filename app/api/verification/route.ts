// Verified collectors. GET: your verification status. POST {action:'request',contact}: ask to be verified
// (pending; we contact you to confirm you're a real person). Admin: GET ?kind=admin_list&status=,
// POST {action:'decide',profileId,verified,note} turns the check on or off by hand (logged).
import {stripeMode,stripeSandbox,type StripeSandboxEnv} from '../../../lib/stripe-sandbox';
import {env as runtimeEnv} from '../../../lib/runtime-env';
import {FeeError,feeLabel,keepFee,refundFee,startVerificationCheckout,verificationFeeCents} from '../../../lib/verification-payments';
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
  return privateJson({...await personVerification(p.id),business:biz?.accountType==='business',admin:isAdmin(user),feeCents:verificationFeeCents()});
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
   const before=await personVerification(a.profileId);
   // Declining a request in review refunds the fee in full; approving keeps it.
   let refund:'refunded'|'none'|'failed'='none';
   if(!a.verified&&before.status==='pending'){refund=await refundFee(stripeSandbox(runtimeEnv as unknown as StripeSandboxEnv),a.profileId);if(refund==='failed')return json('The refund didn’t go through, so nothing changed. Try again, or refund it in Stripe.',502)}
   const result=await setPersonVerified(user.userId,a.profileId,a.verified,a.note);
   if(a.verified)await keepFee(a.profileId);
   await logAdminAction({admin:user,action:a.verified?'person_verification_granted':'person_verification_removed',targetType:'profile',targetId:a.profileId,detail:{note:a.note,refund}});
   if(result.changed)await notify({userId:result.userId,kind:'verification',title:a.verified?'You’re verified!':before.status==='pending'?'Your verification request was declined':'Your verified check was removed',body:a.verified?'The blue check now shows next to your name.':refund==='refunded'?'Your verification fee has been refunded in full. It can take 5–10 business days to show on your statement.':'Contact support if you think this is a mistake.',href:'/verified'});
   queueTrophies([result.userId]);
   return privateJson({status:result.status,refund});
  }
  const [p]=await db.select().from(profiles).where(eq(profiles.userId,user.userId));
  if(!p)return json('Create your free collector profile first.',403);
  if(p.moderated||await isRestricted(db,user.userId))return json('Your account is restricted pending moderation review.',403);
  const biz=await ownBusiness(p.id).catch(()=>null);
  if(biz?.accountType==='business')return json('Business accounts are verified through the business details in your profile.',400);
  const limited=await enforceWriteLimits(db,user.userId,'verification:request',5);if(limited)return limited;
  // The fee comes first: the request reaches the admin queue once Stripe confirms the payment.
  const fee=verificationFeeCents();
  if(fee>0){
   const current=await personVerification(p.id);if(current.status==='verified'||current.status==='pending')return privateJson(current);
   const environment=runtimeEnv as unknown as StripeSandboxEnv,mode=stripeMode(environment);
   if(!mode)return json('Payments aren’t available right now, so verification can’t start. Please try again later.',503);
   try{const checkout=await startVerificationCheckout(stripeSandbox(environment),{profileId:p.id,userId:user.userId,contact:a.contact,email:user.email,amountCents:fee,sandbox:mode==='live'?0:1});return privateJson({status:'unverified',checkoutUrl:checkout.url,fee:feeLabel(fee)})}
   catch(error){if(error instanceof FeeError)return json(error.message,error.status);return json('Checkout couldn’t start. Nothing was charged. Please try again.',502)}
  }
  return privateJson(await requestPersonVerification({id:p.id,userId:user.userId},a.contact));
 }catch(error){
  if(error instanceof AdminRequiredError)return json(error.message,403);
  if(error instanceof ZodError)return json('Add a short note.',400);
  const status=(error as {status?:number}).status;if(status)return json((error as Error).message,status);
  return json('That didn’t save. Please retry.',500);
 }
}
