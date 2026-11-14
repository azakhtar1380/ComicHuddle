/**
 * Stripe Connect seller accounts on the Accounts v2 API (server only).
 *
 * New sellers are v2 Accounts with only the `recipient` configuration
 * (capability stripe_balance.stripe_transfers), the Express dashboard, and the
 * platform as fees and losses collector. Charges stay on the platform (separate
 * charges and transfers); v1 /v1/transfers accepts a v2 Account ID as destination
 * once stripe_transfers is active (verified against the Stripe sandbox).
 *
 * Shapes follow docs.stripe.com/api/v2/core/accounts and /v2/core/account_links
 * (Stripe-Version 2026-10-28.endive, JSON bodies) and were confirmed against a real
 * test-mode platform. Sellers bound before this change remain v1 and keep using
 * lib/stripe-sandbox.ts retrieveAccount.
 */
import {sandboxConfiguration,stripeConfiguredOrigin,stripeSecretKey,StripeSandboxError,verifyStripeSignedPayload,type StripeSandboxEnv,type StripeSellerBinding} from './stripe-sandbox';

export const STRIPE_ACCOUNTS_V2_API_VERSION='2026-10-28.endive';
const API_ORIGIN='https://api.stripe.com';
type Obj=Record<string,unknown>;
const isObject=(value:unknown):value is Obj=>!!value&&typeof value==='object'&&!Array.isArray(value);
function fail(code:string,message:string,status=400,retryable=false):never{throw new StripeSandboxError(code,message,status,retryable)}
function accountId(value:unknown):asserts value is string{if(typeof value!=='string'||!/^acct_[A-Za-z0-9]{1,250}$/.test(value))fail('invalid_identifier','Stripe account ID is invalid.')}
function localId(value:unknown,name:string):asserts value is string{if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value))fail('invalid_identifier',name+' is invalid.')}
function idempotencyKey(value:unknown):asserts value is string{if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{15,254}$/.test(value))fail('invalid_idempotency_key','A persisted idempotency key is required.')}
const at=(value:unknown,...path:string[])=>path.reduce<unknown>((node,key)=>isObject(node)?node[key]:undefined,value);

/** Ready to receive transfers: stripe_transfers active, account open, and nothing currently or past due. */
export function recipientReady(account:Obj){
 if(account.closed===true)return false;
 if(at(account,'configuration','recipient','capabilities','stripe_balance','stripe_transfers','status')!=='active')return false;
 const entries=at(account,'requirements','entries');
 if(entries!==undefined&&entries!==null&&!Array.isArray(entries))return false;
 return !(entries as unknown[]|null|undefined??[]).some(entry=>['currently_due','past_due'].includes(String(at(entry,'minimum_deadline','status'))));
}
export const isV2Account=(value:unknown)=>isObject(value)&&value.object==='v2.core.account';

type Options={fetch?:typeof fetch;now?:()=>number;timeoutMs?:number};
export function stripeConnectV2(env:StripeSandboxEnv,options:Options={}){
 const config=sandboxConfiguration(env),live=config.mode==='live',origin=stripeConfiguredOrigin(env.COMMERCE_PUBLIC_ORIGIN),fetcher=options.fetch??fetch,timeoutMs=options.timeoutMs??12_000;
 function assertReady(){
  const current=sandboxConfiguration(env);
  if(!current.ready||current.mode!==config.mode||!stripeSecretKey(env)||!origin||stripeConfiguredOrigin(env.COMMERCE_PUBLIC_ORIGIN)!==origin)fail(current.ready?'sandbox_configuration_changed':current.reason,'Stripe payments are not ready. No seller account was changed.',503);
 }
 /** Never surfaces Stripe's message (it may contain personal data); only the machine-readable error code. */
 async function request(method:'GET'|'POST',path:string,{json,form,key,version=STRIPE_ACCOUNTS_V2_API_VERSION}:{json?:Obj;form?:Record<string,string>;key?:string;version?:string}={}):Promise<{status:number;body:Obj}>{
  assertReady();if(method==='POST')idempotencyKey(key);
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   const task=(async()=>{
    const headers:Record<string,string>={Authorization:'Bearer '+stripeSecretKey(env),'Stripe-Version':version,...(method==='POST'?{'Idempotency-Key':key!}:{})};
    if(json)headers['Content-Type']='application/json';if(form)headers['Content-Type']='application/x-www-form-urlencoded';
    const response=await fetcher(API_ORIGIN+path,{method,redirect:'error',signal:controller.signal,headers,...(json?{body:JSON.stringify(json)}:form?{body:new URLSearchParams(form)}:{})});
    const text=await response.text();if(text.length>524_288)fail('stripe_invalid_response','Stripe response exceeded its limit.',502);
    let body:unknown;try{body=JSON.parse(text)}catch{return fail('stripe_invalid_response','Stripe returned an invalid response.',502)}
    if(!isObject(body))fail('stripe_invalid_response','Stripe returned an invalid response.',502);
    return {status:response.status,body};
   })();
   const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new StripeSandboxError('stripe_timeout','Stripe response was not confirmed. Reconcile before retrying.',504,true))},timeoutMs)});
   return await Promise.race([task,deadline]);
  }catch(error){if(error instanceof StripeSandboxError)throw error;return fail('stripe_unavailable','Stripe response was not confirmed. Reconcile before retrying.',503,true)}
  finally{if(timer!==undefined)clearTimeout(timer)}
 }
 function ok(result:{status:number;body:Obj}){
  if(result.status>=200&&result.status<300)return result.body;
  const transient=result.status===429||result.status>=500;
  return fail('stripe_provider_error','Stripe could not complete this seller account request. Reconcile before retrying.',result.status===409?409:transient?503:502,transient);
 }
 function account(value:Obj,binding?:StripeSellerBinding){
  if(value.object!=='v2.core.account'||value.livemode!==live)fail('stripe_invalid_response','Stripe returned an unexpected account or one from the other payment mode.',502);
  accountId(value.id);
  if(value.closed===true)fail('stripe_account_unavailable','Seller account is closed.',409);
  const country=at(value,'identity','country');if(country!==undefined&&country!==null&&String(country).toUpperCase()!=='US')fail('stripe_account_mismatch','Seller account is unavailable.',502);
  if(binding){const metadata=isObject(value.metadata)?value.metadata:{};if(metadata.profile_id!==binding.profileId||metadata.user_id!==binding.userId)fail('stripe_account_mismatch','Seller account does not match this profile.',502)}
  return value;
 }
 function sameOriginUrl(value:string){
  let url:URL;try{url=new URL(value)}catch{return fail('invalid_return_url','Return URL is invalid.')}
  if(!origin||url.origin!==origin||url.username||url.password)fail('invalid_return_url','Return URL must use the configured site origin.');return value;
 }
 const include=['configuration.recipient','requirements','identity'];
 return {
  mode:config.mode,
  async createRecipientAccount(input:StripeSellerBinding&{email:string;displayName?:string},key:string){
   localId(input.profileId,'Profile ID');localId(input.userId,'User ID');
   if(typeof input.email!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)||input.email.length>254)fail('invalid_email','Seller email is invalid.');
   const body=ok(await request('POST','/v2/core/accounts',{key,json:{
    contact_email:input.email,
    ...(input.displayName?{display_name:input.displayName.slice(0,100)}:{}),
    dashboard:'express',identity:{country:'us'},
    configuration:{recipient:{capabilities:{stripe_balance:{stripe_transfers:{requested:true}}}}},
    defaults:{currency:'usd',responsibilities:{fees_collector:'application',losses_collector:'application'}},
    metadata:{profile_id:input.profileId,user_id:input.userId},include,
   }}));
   return account(body,input);
  },
  async retrieveRecipientAccount(id:string,binding?:StripeSellerBinding){
   accountId(id);
   const body=ok(await request('GET','/v2/core/accounts/'+id+'?'+include.map(value=>'include='+encodeURIComponent(value)).join('&')));
   if(body.id!==id)fail('stripe_account_mismatch','Seller account is unavailable.',502);
   return account(body,binding);
  },
  /**
   * Stripe-hosted onboarding. Uses v2/core/account_links; Stripe rejects v2 links for recipient accounts on
   * non-sandbox test-mode platforms (400 invalid_fields), in which case the documented v1 account_links
   * endpoint is used with the same v2 account ID.
   */
  async createOnboardingLink(id:string,urls:{refreshUrl:string;returnUrl:string},key:string=crypto.randomUUID()){
   accountId(id);const refresh=sameOriginUrl(urls.refreshUrl),back=sameOriginUrl(urls.returnUrl),now=(options.now??Date.now)();
   const v2=await request('POST','/v2/core/account_links',{key:'v2l-'+key,json:{account:id,use_case:{type:'account_onboarding',account_onboarding:{refresh_url:refresh,return_url:back}}}});
   let url:unknown,expiresMs:number;
   if(v2.status>=200&&v2.status<300){
    if(v2.body.object!=='v2.core.account_link'||v2.body.account!==id||v2.body.livemode!==live)fail('stripe_invalid_response','Stripe returned an unexpected onboarding link.',502);
    url=v2.body.url;expiresMs=Date.parse(String(v2.body.expires_at));
   }else if(v2.status===400&&at(v2.body,'error','code')==='invalid_fields'){
    const v1=ok(await request('POST','/v1/account_links',{key:'v1l-'+key,version:'2026-09-30.endive',form:{account:id,type:'account_onboarding',refresh_url:refresh,return_url:back}}));
    if(v1.object!=='account_link')fail('stripe_invalid_response','Stripe returned an unexpected onboarding link.',502);
    url=v1.url;expiresMs=Number(v1.expires_at)*1000;
   }else return fail('stripe_provider_error','Stripe could not create the seller onboarding link.',v2.status===429||v2.status>=500?503:502,v2.status===429||v2.status>=500);
   let parsed:URL;try{parsed=new URL(String(url))}catch{return fail('stripe_invalid_response','Stripe returned an invalid onboarding URL.',502)}
   if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port||!['connect.stripe.com','accounts.stripe.com'].includes(parsed.hostname))fail('stripe_invalid_response','Stripe returned an unexpected onboarding URL.',502);
   if(!Number.isFinite(expiresMs)||expiresMs<=now)fail('stripe_invalid_response','Seller onboarding link has expired.',502);
   return {url:parsed.href,expiresAt:new Date(expiresMs).toISOString()};
  },
 };
}

/** v2 thin-event types that can change a seller's ability to receive transfers. */
export const ACCOUNT_THIN_EVENTS=['v2.core.account.updated','v2.core.account.closed','v2.core.account[configuration.recipient].capability_status_updated','v2.core.account[configuration.recipient].updated','v2.core.account[requirements].updated','v2.core.account[identity].updated'] as const;
export type StripeThinAccountEvent={id:string;type:string;livemode:boolean;accountId:string};
/** True when signed JSON looks like a thin (v2) event notification rather than a v1 snapshot event. */
export const isThinEventPayload=(value:unknown)=>isObject(value)&&value.object==='v2.core.event';
/**
 * Verifies a thin event notification (same Stripe-Signature scheme) and returns the related account ID.
 * The payload carries no account state; callers must re-retrieve the account. Returns null for other thin types.
 */
export async function verifyStripeThinEvent(rawBody:Uint8Array|string,signature:string,env:StripeSandboxEnv,options:{now?:()=>number}={}):Promise<StripeThinAccountEvent|null>{
 const {parsed,livemode}=await verifyStripeSignedPayload(rawBody,signature,env,options);
 return thinAccountEvent(parsed,livemode);
}
export function thinAccountEvent(parsed:unknown,livemode:boolean):StripeThinAccountEvent|null{
 if(!isObject(parsed)||parsed.object!=='v2.core.event'||typeof parsed.id!=='string'||!/^evt_[A-Za-z0-9_]{1,250}$/.test(parsed.id)||typeof parsed.type!=='string'||parsed.livemode!==livemode)fail('invalid_webhook','Signed thin event is invalid or from the other payment mode.');
 if(!(ACCOUNT_THIN_EVENTS as readonly string[]).includes(parsed.type))return null;
 const related=isObject(parsed.related_object)?parsed.related_object:{};
 if(related.type!=='v2.core.account'||typeof related.id!=='string'||!/^acct_[A-Za-z0-9]{1,250}$/.test(related.id))fail('invalid_webhook','Thin event is not bound to an account.');
 return {id:parsed.id,type:parsed.type,livemode,accountId:related.id};
}
