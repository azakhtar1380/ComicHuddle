import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {ApiRequestError,enforceWriteLimits,privateJson,readObject} from '../../../lib/api-security';
import {commerceCheckout,commerceError,commerceOnboard,commerceOverview,commerceOwnerRefund,commerceOwnerReconcile,commerceOwnerSweep,commerceParticipant,commerceRequestRefund,commerceSetup,commerceSubmitTracking} from '../../../lib/commerce';
import {ownerAccountId} from '../../../lib/owner';
import {type StripeSandboxEnv} from '../../../lib/stripe-sandbox';

const environment=()=>env as unknown as StripeSandboxEnv;
export async function GET(req:Request){try{
 const url=new URL(req.url);if(url.searchParams.get('kind')==='setup')return privateJson(commerceSetup(environment()));
 const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in with ChatGPT to see your orders.'},401);
 return privateJson(await commerceOverview(getDb(),user.userId,environment(),url.searchParams.get('order')||undefined));
}catch(error){return commerceError(error)}}
export async function POST(req:Request){try{
 const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in with ChatGPT to continue.'},401);
 if(req.headers.get('origin')!==new URL(req.url).origin)return privateJson({error:'Request origin rejected.'},403);
 const raw=await readObject(req,25000),action=typeof raw.action==='string'?raw.action:'unknown';
 const budgets:Record<string,number>={checkout:10,seller_onboard:5,submit_tracking:10,request_refund:5,owner_refund:10,owner_reconcile:10,owner_sweep:3};
 if(!Object.hasOwn(budgets,action)){
  if(action==='release'&&user.userId===ownerAccountId)return privateJson({error:'Seller transfers are disabled until trusted carrier delivery verification and the release review are connected.',code:'carrier_setup_required'},503);
  throw new ApiRequestError('Unknown sandbox commerce action.',400);
 }
 const db=getDb(),limited=await enforceWriteLimits(db,user.userId,'commerce:'+action,budgets[action]);if(limited)return limited;
 if(action==='request_refund')return privateJson(await commerceRequestRefund(db,user.userId,raw));
 if(action==='owner_refund')return privateJson(await commerceOwnerRefund(db,user.userId,raw,environment()));
 if(action==='owner_reconcile')return privateJson(await commerceOwnerReconcile(db,user.userId,raw,environment()));
 if(action==='owner_sweep')return privateJson(await commerceOwnerSweep(db,user.userId,raw,environment()));
 const profile=await commerceParticipant(db,user.userId);
 if(action==='checkout')return privateJson(await commerceCheckout(db,profile,user.email,raw,environment()));
 if(action==='seller_onboard')return privateJson(await commerceOnboard(db,profile,user.email,raw,environment()));
 return privateJson(await commerceSubmitTracking(db,user.userId,raw));
}catch(error){return commerceError(error)}}
