import {env} from '../../../../lib/runtime-env';
import {getDb} from '../../../../db';
import {privateJson,readBytes} from '../../../../lib/api-security';
import {commerceApplyWebhook,commerceError,commerceSetup} from '../../../../lib/commerce';
import {verifyStripeWebhook,STRIPE_WEBHOOK_MAX_BYTES,type StripeSandboxEnv} from '../../../../lib/stripe-sandbox';

export async function POST(req:Request){try{
 const environment=env as unknown as StripeSandboxEnv;
 // Signature authentication alone must not bypass integration review/config revocation.
 if(!commerceSetup(environment).setup.ready)return privateJson({error:'Payment sandbox webhook is not enabled and reviewed.'},503);
 const bytes=await readBytes(req,STRIPE_WEBHOOK_MAX_BYTES),event=await verifyStripeWebhook(bytes,req.headers.get('stripe-signature')||'',environment);
 return privateJson(await commerceApplyWebhook(getDb(),event,bytes,environment));
}catch(error){return commerceError(error)}}
