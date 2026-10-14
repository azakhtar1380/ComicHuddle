import {z} from 'zod';
import {DomainError,type SqlPool} from './db';
import {boundedJson,requireOrigin,persistVerifiedWebhook} from './security';
import {requestWithdrawal,type WalletConfig} from './wallet';
import {redeemPoints,type RewardPolicy} from './rewards';
import {recordSellerShipment,type CarrierVerifier} from './fulfillment';
import {transitionSafePurchase,type SafePurchaseConfig,type SafePurchaseEvent} from './escrow';
export type VerifiedSession={userId:string;browserSessionId:string};
export type ApiDependencies={pool:SqlPool;publicOrigin:string;authenticate:(r:Request)=>Promise<VerifiedSession|null>;rateLimit:(userId:string,action:string)=>Promise<boolean>;
 wallet:WalletConfig;rewards:RewardPolicy;safepurchase:SafePurchaseConfig;stripeWebhookSecret?:string;carrierVerifier?:CarrierVerifier};
const keySchema=z.string().min(8).max(180),moneySchema=z.string().regex(/^[1-9]\d{0,15}$/);
const userEvent=z.discriminatedUnion('type',[
 z.object({type:z.literal('seller_dispatched'),tracking:z.string().min(5).max(100),carrier:z.string().min(2).max(40),acceptanceScanVerified:z.literal(true)}).strict(),
 z.object({type:z.literal('vault_received'),inspectionId:z.string().uuid()}).strict(),
 z.object({type:z.literal('inspection_passed'),report:z.object({physicalCopyIds:z.array(z.string().uuid()).min(1).max(1000),editionMatches:z.boolean(),conditionDisclosed:z.boolean(),certificatesChecked:z.boolean(),reportAssetId:z.string().uuid()}).strict()}).strict(),
 z.object({type:z.literal('inspection_failed'),reason:z.string().min(10).max(1000)}).strict(),
 z.object({type:z.literal('vault_dispatched'),tracking:z.string().min(5).max(100),carrier:z.string().min(2).max(40),insuranceReceiptId:z.string().min(5).max(100)}).strict(),
 z.object({type:z.literal('refund_requested'),reason:z.enum(['seller_missed_ship_deadline','inspection_failed','approved_return'])}).strict()
]);
function json(body:unknown,status=200){return Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})}
export function platformApi(d:ApiDependencies){return async(request:Request):Promise<Response>=>{
 try{
  const url=new URL(request.url);
  if(url.pathname==='/api/platform/stripe-webhook'&&request.method==='POST'){
   if(!d.stripeWebhookSecret)throw new DomainError('webhook_unconfigured','Webhook is not configured.',503);
   const reader=request.body?.getReader();if(!reader)throw new DomainError('body_missing','Webhook body is missing.',400);
   const parts:Uint8Array[]=[];let n=0;while(true){const item=await reader.read();if(item.done)break;n+=item.value.byteLength;if(n>262144){await reader.cancel();throw new DomainError('body_too_large','Webhook exceeds limits.',413)}parts.push(item.value)}
   const raw=new Uint8Array(n);let offset=0;for(const p of parts){raw.set(p,offset);offset+=p.length}
   return json(await persistVerifiedWebhook(d.pool,raw,request.headers.get('Stripe-Signature')||'',d.stripeWebhookSecret));
  }
  const session=await d.authenticate(request);if(!session)throw new DomainError('sign_in_required','Sign in to continue.',401);
  if(request.method!=='POST')return json({error:{code:'method_not_allowed',message:'Use POST.'}},405);
  requireOrigin(request,d.publicOrigin);if(!await d.rateLimit(session.userId,url.pathname))throw new DomainError('rate_limited','Try again shortly.',429);
  const body=await boundedJson(request);
  if(url.pathname==='/api/platform/wallet/withdraw'){
   const v=z.object({amountCents:moneySchema,idempotencyKey:keySchema}).strict().parse(body);
   return json(await requestWithdrawal(d.pool,session.userId,v.amountCents,v.idempotencyKey,d.wallet),202);
  }
  if(url.pathname==='/api/platform/rewards/redeem'){
   const v=z.object({orderId:z.string().uuid(),points:moneySchema,idempotencyKey:keySchema}).strict().parse(body);
   return json(await redeemPoints(d.pool,session.userId,v.orderId,v.points,v.idempotencyKey,d.rewards));
  }
  if(url.pathname==='/api/platform/safepurchase/shipment'){
   const v=z.object({transactionId:z.string().uuid(),tracking:z.string().min(5).max(100),carrier:z.string().min(2).max(40),idempotencyKey:keySchema}).strict().parse(body);
   if(!d.carrierVerifier)throw new DomainError('carrier_unconfigured','Carrier verification is not configured.',503);
   return json(await recordSellerShipment(d.pool,session.userId,v.transactionId,v.tracking,v.carrier,v.idempotencyKey,d.carrierVerifier,d.safepurchase));
  }
  if(url.pathname==='/api/platform/safepurchase/event'){
   const v=z.object({transactionId:z.string().uuid(),event:userEvent,idempotencyKey:keySchema}).strict().parse(body);
   // Carrier acceptance is not a self-authenticating boolean. The fulfillment
   // adapter must verify the carrier receipt before this seller action.
   if(v.event.type==='seller_dispatched')throw new DomainError('carrier_receipt_required','Use the server-verified shipment route.',409);
   return json(await transitionSafePurchase(d.pool,v.transactionId,{kind:'user',userId:session.userId},v.event as SafePurchaseEvent,v.idempotencyKey,d.safepurchase));
  }
  throw new DomainError('route_missing','Route not found.',404);
 }catch(error){
  if(error instanceof DomainError)return json({error:{code:error.code,message:error.message}},error.httpStatus);
  if(error instanceof z.ZodError)return json({error:{code:'invalid_input',message:'Check the submitted fields.'}},400);
  return json({error:{code:'server_error',message:'This action could not be completed. Its saved operation can be reconciled.'}},500);
 }
 }}
