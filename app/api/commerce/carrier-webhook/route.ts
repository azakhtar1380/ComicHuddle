import {env} from '../../../../lib/runtime-env';
import {getDb} from '../../../../db';
import {privateJson,readBytes} from '../../../../lib/api-security';
import {commerceApplyCarrierUpdate,commerceError} from '../../../../lib/commerce';
import {EASYPOST_WEBHOOK_MAX_BYTES,carrierUpdate,carrierWebhookConfigured,verifyEasyPostWebhook,type CarrierEnv} from '../../../../lib/commerce-carrier';

// EasyPost tracker webhooks. Only HMAC-verified bodies become trusted carrier evidence.
export async function POST(req:Request){try{
 const environment=env as unknown as CarrierEnv;
 if(!carrierWebhookConfigured(environment))return privateJson({error:'Carrier tracking is not connected.'},503);
 const bytes=await readBytes(req,EASYPOST_WEBHOOK_MAX_BYTES);
 if(!await verifyEasyPostWebhook(environment,bytes,req.headers.get('x-hmac-signature')))return privateJson({error:'Signature rejected.'},401);
 let payload:unknown;try{payload=JSON.parse(new TextDecoder().decode(bytes))}catch{return privateJson({error:'Unreadable event.'},400)}
 const update=carrierUpdate(payload);if(!update)return privateJson({received:true,ignored:true});
 return privateJson(await commerceApplyCarrierUpdate(getDb(),update));
}catch(error){return commerceError(error)}}
