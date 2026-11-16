import {env} from '../../../lib/runtime-env';
import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {ApiRequestError,enforceWriteLimits,privateJson,readObject} from '../../../lib/api-security';
import {commerceCancelOrder,commerceCheckout,commerceConfirmPickup,commerceConfirmPickupCode,commerceBuyLabel,commerceError,commerceInspection,commerceInspectionChoice,commerceOnboard,commerceOverview,commerceOwnerRefund,commerceOwnerReconcile,commerceOwnerRelease,commerceOwnerRevenue,commerceOwnerSweep,commerceParticipant,commerceResumePayment,commerceCancelCheckout,commerceRequestRefund,commerceSetup,commerceSubmitTracking,type StripeSandboxEnv} from '../../../lib/commerce';
import {ownerAccountId} from '../../../lib/owner';
// --- offers (round 4) ---
import {commerceDeliveryInfo,commercePickupCodeOpen,commercePickupExpirySweep} from '../../../lib/commerce';
import {notifyOrderEvent} from '../../../lib/offers';
// --- end offers (round 4) ---

const environment=()=>env as unknown as StripeSandboxEnv;
export async function GET(req:Request){try{
 const url=new URL(req.url);if(url.searchParams.get('kind')==='setup')return privateJson(commerceSetup(environment()));
 const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in to ComicHuddle to see your orders.'},401);
 // offers (round 4): seller delivery details (paid, undelivered Standard orders only; enforced server-side).
 if(url.searchParams.get('kind')==='delivery')return privateJson(await commerceDeliveryInfo(getDb(),user.userId,url.searchParams.get('order'),environment()));
 if(url.searchParams.get('kind')==='revenue')return privateJson(await commerceOwnerRevenue(getDb(),user.userId,environment()));
 return privateJson(await commerceOverview(getDb(),user.userId,environment(),url.searchParams.get('order')||undefined,{sellerReturn:url.searchParams.get('seller')==='return'}));
}catch(error){return commerceError(error)}}
export async function POST(req:Request){try{
 const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in to ComicHuddle to continue.'},401);
 if(req.headers.get('origin')!==new URL(req.url).origin)return privateJson({error:'Request origin rejected.'},403);
 const raw=await readObject(req,25000),action=typeof raw.action==='string'?raw.action:'unknown';
 const budgets:Record<string,number>={buy_label:5,checkout:10,seller_onboard:5,submit_tracking:10,request_refund:5,owner_refund:10,owner_reconcile:10,owner_sweep:3,owner_release:10,resume_payment:20,cancel_checkout:5,confirm_pickup:10,confirm_pickup_code:5,cancel_order:5,inspection:30,inspection_choice:5};
 // --- offers (round 4): owner sweep for unused pickup codes (7 days → full refund) ---
 if(action==='pickup_expiry_sweep'){const db=getDb(),limited=await enforceWriteLimits(db,user.userId,'commerce:pickup_expiry_sweep',3);if(limited)return limited;return privateJson(await commercePickupExpirySweep(db,user.userId,raw,environment()))}
 // --- end offers (round 4) ---
 if(!Object.hasOwn(budgets,action)){
  if(action==='release'&&user.userId===ownerAccountId)return privateJson({error:'Seller payouts are disabled until carrier delivery verification and the release review are connected.',code:'carrier_setup_required'},503);
  throw new ApiRequestError('That order action isn’t available.',400);
 }
 const db=getDb(),limited=await enforceWriteLimits(db,user.userId,'commerce:'+action,budgets[action]);if(limited)return limited;
 // Pickup codes are 6 digits: also cap wrong guesses per order, independent of the per-user budget.
 if(action==='confirm_pickup_code'||action==='inspection'&&raw.step==='handoff'){const orderLimited=await enforceWriteLimits(db,user.userId,'commerce:pickup_code:'+String(raw.orderId||'').slice(0,100),5);if(orderLimited)return orderLimited}
 // --- offers (round 4): pickup-code expiry check and order notifications (tracking added, pickup confirmed) ---
 if(action==='confirm_pickup_code')await commercePickupCodeOpen(db,user.userId,raw.orderId,environment());
 if(action==='buy_label'){const result=await commerceBuyLabel(db,user.userId,raw,environment());if(!('duplicate'in result&&result.duplicate))await notifyOrderEvent(String(raw.orderId),'tracking');return privateJson(result)}
 if(action==='submit_tracking'||action==='confirm_pickup'||action==='confirm_pickup_code'){
  const result=action==='submit_tracking'?await commerceSubmitTracking(db,user.userId,raw,environment()):action==='confirm_pickup'?await commerceConfirmPickup(db,user.userId,raw):await commerceConfirmPickupCode(db,user.userId,raw);
  if(!('duplicate'in result&&result.duplicate))await notifyOrderEvent(String(raw.orderId),action==='submit_tracking'?'tracking':'pickup');
  return privateJson(result);
 }
 // --- end offers (round 4) ---
 if(action==='request_refund')return privateJson(await commerceRequestRefund(db,user.userId,raw));
 if(action==='owner_refund')return privateJson(await commerceOwnerRefund(db,user.userId,raw,environment()));
 if(action==='owner_reconcile')return privateJson(await commerceOwnerReconcile(db,user.userId,raw,environment()));
 // Seller release: owner-only, and still refused unless COMMERCE_PAYOUTS_ENABLED=true.
 if(action==='owner_release')return privateJson(await commerceOwnerRelease(db,user.userId,raw,environment()));
 // Buyer: reopen or cancel an unpaid checkout (order already exists; never a second order).
 if(action==='resume_payment')return privateJson(await commerceResumePayment(db,user.userId,user.email,raw,environment()));
 if(action==='cancel_checkout')return privateJson(await commerceCancelCheckout(db,user.userId,raw,environment()));
 if(action==='owner_sweep')return privateJson(await commerceOwnerSweep(db,user.userId,raw,environment()));
 if(action==='confirm_pickup')return privateJson(await commerceConfirmPickup(db,user.userId,raw));
 if(action==='confirm_pickup_code')return privateJson(await commerceConfirmPickupCode(db,user.userId,raw));
 if(action==='cancel_order')return privateJson(await commerceCancelOrder(db,user.userId,raw,environment()));
 if(action==='inspection')return privateJson(await commerceInspection(db,user.userId,raw,environment()));
 if(action==='inspection_choice')return privateJson(await commerceInspectionChoice(db,user.userId,raw,environment()));
 if(action==='submit_tracking')return privateJson(await commerceSubmitTracking(db,user.userId,raw,environment()));
 const profile=await commerceParticipant(db,user.userId);
 if(action==='checkout')return privateJson(await commerceCheckout(db,profile,user.email,raw,environment()));
 return privateJson(await commerceOnboard(db,profile,user.email,raw,environment()));
}catch(error){return commerceError(error)}}
