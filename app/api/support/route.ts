// Support ComicHuddle: POST {amountCents} → {url} of a Stripe Checkout page (platform account, one-time).
// Signed-out visitors can pay too. GET → the signed-in supporter's receipts.
import {eq} from 'drizzle-orm';
import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {profiles} from '../../../db/schema';
import {enforceWriteLimits,privateJson,readObject} from '../../../lib/api-security';
import {stripeMode,stripeSandbox,type StripeSandboxEnv} from '../../../lib/stripe-sandbox';
import {startSupportCheckout,supportReceipts,supportRequestSchema} from '../../../lib/support-payments';
import {env} from '../../../lib/runtime-env';

export const runtime='nodejs';export const dynamic='force-dynamic';
const guestHits=new Map<string,number[]>();
function guestLimited(req:Request){
 const ip=(req.headers.get('x-forwarded-for')||'').split(',')[0].trim()||'unknown',now=Date.now(),recent=(guestHits.get(ip)||[]).filter(t=>now-t<3600000);
 recent.push(now);guestHits.set(ip,recent);if(guestHits.size>5000)guestHits.clear();return recent.length>10;
}

export async function POST(req:Request){
 try{
  if(req.headers.get('origin')!==new URL(req.url).origin)return privateJson({error:'Request origin rejected.'},403);
  const parsed=supportRequestSchema.safeParse(await readObject(req,1000));
  if(!parsed.success)return privateJson({error:parsed.error.issues[0]?.message||'Choose an amount between $1 and $500.'},400);
  const environment=env as unknown as StripeSandboxEnv,mode=stripeMode(environment);
  if(!mode)return privateJson({error:'Payments aren’t available right now. Please try again later.'},503);
  const user=await getChatGPTUser();let name='';
  if(user){const db=getDb(),limited=await enforceWriteLimits(db,user.userId,'support:checkout',10);if(limited)return limited;const [profile]=await db.select().from(profiles).where(eq(profiles.userId,user.userId));name=profile?.name||''}
  else if(guestLimited(req))return privateJson({error:'Too many attempts. Please try again in an hour.'},429);
  const result=await startSupportCheckout(stripeSandbox(environment),{amountCents:parsed.data.amountCents,userId:user?.userId??null,name,email:user?.email??null,sandbox:mode==='live'?0:1});
  return privateJson({url:result.url,sandbox:mode!=='live'});
 }catch{return privateJson({error:'Checkout couldn’t start. Nothing was charged. Please try again.'},502)}
}

export async function GET(){
 const user=await getChatGPTUser();if(!user)return privateJson({receipts:[]},200);
 return privateJson({receipts:await supportReceipts(user.userId)});
}
