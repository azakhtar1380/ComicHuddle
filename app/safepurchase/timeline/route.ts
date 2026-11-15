// GET /safepurchase/timeline?order=<id> — the SafePurchase step-by-step timeline for the buyer or seller of
// that order (shared notes only), or for an admin (internal notes included). Anyone else gets 404.
import {env} from '../../../lib/runtime-env';
import {getChatGPTUser} from '../../chatgpt-auth';
import {isAdmin} from '../../../lib/admin';
import {ApiRequestError,privateJson} from '../../../lib/api-security';
import {timelineForViewer} from '../../../lib/safepurchase';
import type {ProtectionEnv} from '../../../lib/commerce-protection';

export const dynamic='force-dynamic';
export async function GET(req:Request){
 try{
  const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in to see this order.'},401);
  const orderId=(new URL(req.url).searchParams.get('order')||'').slice(0,100);if(!orderId)return privateJson({error:'Order not found.'},404);
  return privateJson({timeline:await timelineForViewer({userId:user.userId,admin:isAdmin(user)},orderId,env as unknown as ProtectionEnv)});
 }catch(error){
  if(error instanceof ApiRequestError)return privateJson({error:error.message},error.status);
  return privateJson({error:'The order timeline could not be loaded. Try again.'},500);
 }
}
