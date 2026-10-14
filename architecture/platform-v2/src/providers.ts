import {z} from 'zod';
import {DomainError,type SqlClient,type SqlPool,serializable} from './db';
import {cents} from './money';
export interface StripeConfig {secretKey:string;apiVersion:string;liveApproved:boolean}
export class StripeConnectProvider {
 constructor(private cfg:StripeConfig,private http:typeof fetch=fetch){
  if(!cfg.secretKey.startsWith('sk_test_')&&!cfg.liveApproved)throw new DomainError('live_payments_disabled','Live payment credentials require an approved launch configuration.');
 }
 private async call(path:string,method:'GET'|'POST',params:Record<string,string>,key?:string,connectedAccount?:string){
  const headers:Record<string,string>={Authorization:'Bearer '+this.cfg.secretKey,'Stripe-Version':this.cfg.apiVersion};
  if(key)headers['Idempotency-Key']=key;if(connectedAccount)headers['Stripe-Account']=connectedAccount;
  if(method==='POST')headers['Content-Type']='application/x-www-form-urlencoded';
  const url='https://api.stripe.com'+path+(method==='GET'&&Object.keys(params).length?'?'+new URLSearchParams(params):'');
  const r=await this.http(url,{method,headers,body:method==='POST'?new URLSearchParams(params):undefined,redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new DomainError(r.status>=500?'provider_outcome_unknown':'provider_request_rejected','Payment provider request needs reconciliation.',502);
  return await r.json() as Record<string,unknown>;
 }
 async createPayment(input:{orderId:string;amountCents:string;key:string}){
  cents(input.amountCents);const result=await this.call('/v1/payment_intents','POST',{amount:input.amountCents,currency:'usd','payment_method_types[0]':'card','metadata[order_id]':input.orderId,transfer_group:'order_'+input.orderId},input.key);
  const value=z.object({id:z.string(),client_secret:z.string()}).parse(result);return {id:value.id,clientSecret:value.client_secret};
 }
 async transfer(input:{destination:string;amountCents:string;sourceChargeId:string;orderId:string;key:string}){
  if(!/^acct_[a-zA-Z0-9]+$/.test(input.destination)||!/^ch_[a-zA-Z0-9]+$/.test(input.sourceChargeId))throw new DomainError('invalid_provider_identity','Invalid provider identity.');
  cents(input.amountCents);const result=await this.call('/v1/transfers','POST',{amount:input.amountCents,currency:'usd',destination:input.destination,source_transaction:input.sourceChargeId,transfer_group:'order_'+input.orderId,'metadata[order_id]':input.orderId},input.key);
  return z.object({id:z.string(),amount:z.number().int().positive(),currency:z.literal('usd'),destination:z.string(),source_transaction:z.string()}).parse(result);
 }
 async refund(input:{chargeId:string;amountCents:string;orderId:string;key:string}){
  cents(input.amountCents);return z.object({id:z.string(),status:z.string().nullable(),amount:z.number().int().positive(),charge:z.string()}).parse(await this.call('/v1/refunds','POST',{charge:input.chargeId,amount:input.amountCents,'metadata[order_id]':input.orderId},input.key));
 }
 async reverseTransfer(input:{transferId:string;amountCents:string;orderId:string;key:string}){
  cents(input.amountCents);return this.call('/v1/transfers/'+encodeURIComponent(input.transferId)+'/reversals','POST',{amount:input.amountCents,'metadata[order_id]':input.orderId},input.key);
 }
 async payout(input:{accountId:string;amountCents:string;withdrawalId:string;key:string}){
  const amount=cents(input.amountCents);if(!/^acct_[a-zA-Z0-9]+$/.test(input.accountId))throw new DomainError('invalid_provider_identity','Invalid connected account.');
  const b=z.object({available:z.array(z.object({amount:z.number().int(),currency:z.string()}))}).parse(await this.call('/v1/balance','GET',{},undefined,input.accountId));
  const available=b.available.filter(v=>v.currency==='usd').reduce((sum,v)=>sum+BigInt(v.amount),BigInt(0));
  if(available<amount)throw new DomainError('provider_balance_insufficient','Connected-account funds are not available for this payout.');
  return z.object({id:z.string(),status:z.string(),amount:z.number().int().positive()}).parse(await this.call('/v1/payouts','POST',{amount:input.amountCents,currency:'usd','metadata[withdrawal_id]':input.withdrawalId},input.key,input.accountId));
 }
 async retrieveObject(path:string,connectedAccount?:string){
  if(!/^\/v1\/(payment_intents|charges|transfers|refunds|payouts|disputes)\/[a-zA-Z0-9_]+$/.test(path))throw new DomainError('invalid_reconciliation_path','Unsupported reconciliation resource.');
  return this.call(path,'GET',{},undefined,connectedAccount);
 }
}
export type OutboxJob={id:string;kind:string;aggregate_id:string;operation_key:string;payload:Record<string,string>;attempts:number;created_at:string;lease_owner:string};
export async function claimJob(pool:SqlPool,workerId:string,allowedKinds:string[],now=new Date()):Promise<OutboxJob|null>{
 return serializable(pool,async db=>{
  const row=(await db.query<OutboxJob>(`WITH job AS(SELECT id FROM ch_platform.outbox_jobs WHERE kind=ANY($1::text[]) AND available_at<=$2
   AND (status='pending' OR(status='leased' AND lease_until<$2)) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
   UPDATE ch_platform.outbox_jobs o SET status='leased',lease_owner=$3,lease_until=$2::timestamptz+interval '60 seconds',attempts=attempts+1
   FROM job WHERE o.id=job.id RETURNING o.*`,[allowedKinds,now.toISOString(),workerId])).rows[0];return row||null;
 });
}
export async function finishJob(db:SqlClient,job:OutboxJob,status:'succeeded'|'pending'|'failed'|'needs_reconciliation',errorCode?:string){
 const r=await db.query(`UPDATE ch_platform.outbox_jobs SET status=$3,lease_until=NULL,lease_owner=NULL,last_error_code=$4,
  available_at=now()+interval '30 seconds' WHERE id=$1 AND lease_owner=$2 AND status='leased' RETURNING id`,[job.id,job.lease_owner,status,errorCode||null]);
 if(!r.rows.length)throw new DomainError('lease_lost','Worker lease was lost; reconcile its outcome.');
}
export async function executeOutboxJob(pool:SqlPool,job:OutboxJob,handler:(job:OutboxJob)=>Promise<void>,now=new Date()){
 // Stripe v1 may prune an idempotency key after 24h. Never make an ambiguous
 // old money request again without retrieving/reconciling the original object.
 if(['stripe_payment_intent','stripe_transfer','stripe_refund','stripe_payout','stripe_transfer_reversal'].includes(job.kind)&&job.attempts>1&&now.getTime()-Date.parse(job.created_at)>=23*3600000){
  return serializable(pool,db=>finishJob(db,job,'needs_reconciliation','idempotency_window_elapsed'));
 }
 try{await handler(job);await serializable(pool,db=>finishJob(db,job,'succeeded'))}
 catch(error){const code=error instanceof DomainError?error.code:'unknown_provider_outcome';
  const ambiguous=['provider_outcome_unknown','unknown_provider_outcome','lease_lost','operator_reconciliation_required','payment_reconcile_required','payout_reconcile_required','payment_not_confirmed','payout_pending'].includes(code);
  await serializable(pool,db=>finishJob(db,job,ambiguous?'needs_reconciliation':'failed',code));
  throw error;
 }
}
