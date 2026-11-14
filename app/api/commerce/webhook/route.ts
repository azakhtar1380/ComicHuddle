import {env} from '../../../../lib/runtime-env';
import {getDb} from '../../../../db';
import {privateJson,readBytes} from '../../../../lib/api-security';
import {commerceApplyThinAccountEvent,commerceApplyWebhook,commerceError,commerceSetup} from '../../../../lib/commerce';
import {isThinEventPayload,verifyStripeThinEvent} from '../../../../lib/stripe-connect-v2';
import {verifyStripeWebhook,STRIPE_WEBHOOK_MAX_BYTES,type StripeSandboxEnv} from '../../../../lib/stripe-sandbox';

export async function POST(req:Request){try{
 const environment=env as unknown as StripeSandboxEnv;
 // Signature authentication alone must not bypass integration review/config revocation.
 // Test or live is chosen by COMMERCE_STRIPE_MODE; live also requires COMMERCE_LIVE_REVIEWED=true.
 if(!commerceSetup(environment).setup.ready)return privateJson({error:'Payment webhook is not enabled and reviewed.'},503);
 const bytes=await readBytes(req,STRIPE_WEBHOOK_MAX_BYTES),signature=req.headers.get('stripe-signature')||'';
 // Accounts v2 thin events (object "v2.core.event") share this URL. The unauthenticated peek only picks
 // the verifier; both verifiers authenticate the exact bytes before anything is acted on.
 let thin=false;try{thin=isThinEventPayload(JSON.parse(new TextDecoder().decode(bytes)))}catch{}
 if(thin)return privateJson(await commerceApplyThinAccountEvent(getDb(),await verifyStripeThinEvent(bytes,signature,environment),environment));
 const event=await verifyStripeWebhook(bytes,signature,environment);
 return privateJson(await commerceApplyWebhook(getDb(),event,bytes,environment));
}catch(error){return commerceError(error)}}
