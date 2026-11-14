// Run: node --import tsx --test checks/stripe-connect-v2.test.ts
// Accounts v2 seller adapter against mocked HTTP shaped like real sandbox responses (see
// docs/PAYMENTS-SETUP.md). No network or Stripe account is used.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {recipientReady,stripeConnectV2,thinAccountEvent,verifyStripeThinEvent,STRIPE_ACCOUNTS_V2_API_VERSION} from '../lib/stripe-connect-v2';

const env={COMMERCE_SANDBOX_ENABLED:'true',COMMERCE_SANDBOX_REVIEWED:'true',COMMERCE_STRIPE_TEST_SECRET_KEY:['sk','test','SYNTHETICV2FIXTURE000001'].join('_'),COMMERCE_STRIPE_TEST_WEBHOOK_SECRET:'whsec_SYNTHETICV2PLATFORM0001',COMMERCE_PUBLIC_ORIGIN:'https://comichuddle.test'};
const liveEnv={...env,COMMERCE_STRIPE_MODE:'live',COMMERCE_LIVE_REVIEWED:'true',COMMERCE_STRIPE_LIVE_SECRET_KEY:['sk','live','SYNTHETICV2FIXTURE000001'].join('_'),COMMERCE_STRIPE_LIVE_WEBHOOK_SECRET:'whsec_SYNTHETICV2LIVEPLAT001'};
const binding={profileId:'profile-1',userId:'user-1'};
type Obj=Record<string,unknown>;
// Mirrors the recipient account returned by the real sandbox (trimmed), already fully onboarded.
const readyAccount=(changes:Obj={}):Obj=>({id:'acct_V2Synthetic0001',object:'v2.core.account',livemode:false,closed:false,dashboard:'express',applied_configurations:['recipient'],identity:{country:'US'},metadata:{profile_id:'profile-1',user_id:'user-1'},
 configuration:{recipient:{applied:true,capabilities:{stripe_balance:{payouts:{status:'active',status_details:[]},stripe_transfers:{status:'active',status_details:[]}}}}},requirements:{entries:[],summary:{minimum_deadline:null}},...changes});
function mock(handler:(req:{method:string;url:URL;headers:Headers;body:string})=>Response|Promise<Response>){
 const requests:{method:string;url:URL;headers:Headers;body:string}[]=[];
 const fetcher=(async(input:string|URL|Request,init:RequestInit={})=>{const req={method:init.method||'GET',url:new URL(String(input)),headers:new Headers(init.headers),body:String(init.body??'')};requests.push(req);return handler(req)}) as typeof fetch;
 return {requests,fetcher};
}

test('creates a recipient v2 account with the platform as fees/losses collector, Express dashboard and contact email',async()=>{
 const {requests,fetcher}=mock(()=>Response.json(readyAccount()));
 const account=await stripeConnectV2(env,{fetch:fetcher}).createRecipientAccount({...binding,email:'seller@example.test',displayName:'Seller'},'comichuddle_seller_v2_profile-1');
 assert.equal(account.id,'acct_V2Synthetic0001');
 const [req]=requests;assert.equal(req.method,'POST');assert.equal(req.url.href,'https://api.stripe.com/v2/core/accounts');
 assert.equal(req.headers.get('Stripe-Version'),STRIPE_ACCOUNTS_V2_API_VERSION);assert.equal(req.headers.get('Content-Type'),'application/json');
 assert.equal(req.headers.get('Idempotency-Key'),'comichuddle_seller_v2_profile-1');assert.equal(req.headers.get('Authorization'),'Bearer '+env.COMMERCE_STRIPE_TEST_SECRET_KEY);
 const body=JSON.parse(req.body);
 assert.deepEqual(body.configuration,{recipient:{capabilities:{stripe_balance:{stripe_transfers:{requested:true}}}}});
 assert.deepEqual(body.defaults.responsibilities,{fees_collector:'application',losses_collector:'application'});
 assert.equal(body.dashboard,'express');assert.equal(body.identity.country,'us');assert.equal(body.contact_email,'seller@example.test');
 assert.deepEqual(body.metadata,{profile_id:'profile-1',user_id:'user-1'});assert.ok(body.include.includes('configuration.recipient')&&body.include.includes('requirements'));
});
test('rejects objects from the other mode, other profiles, closed accounts and non-US identities',async()=>{
 for(const [changes,code] of [[{livemode:true},'stripe_invalid_response'],[{metadata:{profile_id:'other',user_id:'user-1'}},'stripe_account_mismatch'],[{closed:true},'stripe_account_unavailable'],[{identity:{country:'CA'}},'stripe_account_mismatch'],[{object:'account'},'stripe_invalid_response']] as [Obj,string][]){
  const {fetcher}=mock(()=>Response.json(readyAccount(changes)));
  await assert.rejects(stripeConnectV2(env,{fetch:fetcher}).retrieveRecipientAccount('acct_V2Synthetic0001',binding),(e:{code?:string})=>e.code===code);
 }
 const {fetcher}=mock(()=>Response.json(readyAccount({livemode:true})));
 assert.equal((await stripeConnectV2(liveEnv,{fetch:fetcher}).retrieveRecipientAccount('acct_V2Synthetic0001',binding)).livemode,true);
});
test('retrieve asks for the recipient configuration and requirements; provider errors never leak messages',async()=>{
 const ok=mock(()=>Response.json(readyAccount()));await stripeConnectV2(env,{fetch:ok.fetcher}).retrieveRecipientAccount('acct_V2Synthetic0001',binding);
 assert.deepEqual(ok.requests[0].url.searchParams.getAll('include'),['configuration.recipient','requirements','identity']);
 const bad=mock(()=>Response.json({error:{message:'secret buyer@example.test sk_test_LEAK'}},{status:400}));
 await assert.rejects(stripeConnectV2(env,{fetch:bad.fetcher}).retrieveRecipientAccount('acct_V2Synthetic0001',binding),(e:Error)=>!/LEAK|buyer@/.test(e.message));
});
test('recipientReady: active stripe_transfers, open account, nothing currently or past due',()=>{
 assert.equal(recipientReady(readyAccount()),true);
 const restricted=readyAccount();((((restricted.configuration as Obj).recipient as Obj).capabilities as Obj).stripe_balance as {stripe_transfers:{status:string}}).stripe_transfers.status='restricted';
 assert.equal(recipientReady(restricted),false);
 for(const status of ['currently_due','past_due'])assert.equal(recipientReady(readyAccount({requirements:{entries:[{minimum_deadline:{status}}]}})),false);
 assert.equal(recipientReady(readyAccount({requirements:{entries:[{minimum_deadline:{status:'eventually_due'}}]}})),true);
 assert.equal(recipientReady(readyAccount({closed:true})),false);
 assert.equal(recipientReady(readyAccount({configuration:{recipient:null}})),false);
});
test('onboarding link uses v2 account_links, and falls back to v1 account_links when Stripe rejects v2 in test mode',async()=>{
 const urls={refreshUrl:'https://comichuddle.test/?seller=refresh',returnUrl:'https://comichuddle.test/?seller=return'};
 const v2=mock(()=>Response.json({object:'v2.core.account_link',account:'acct_V2Synthetic0001',livemode:false,expires_at:new Date(Date.now()+300000).toISOString(),url:'https://accounts.stripe.com/r/acct_V2Synthetic0001#alu_test'}));
 const link=await stripeConnectV2(env,{fetch:v2.fetcher}).createOnboardingLink('acct_V2Synthetic0001',urls);
 assert.match(link.url,/^https:\/\/accounts\.stripe\.com\//);
 assert.deepEqual(JSON.parse(v2.requests[0].body),{account:'acct_V2Synthetic0001',use_case:{type:'account_onboarding',account_onboarding:{refresh_url:urls.refreshUrl,return_url:urls.returnUrl}}});
 const fallback=mock(req=>req.url.pathname.startsWith('/v2/')?Response.json({error:{code:'invalid_fields'}},{status:400}):Response.json({object:'account_link',expires_at:Math.floor(Date.now()/1000)+300,url:'https://connect.stripe.com/setup/e/acct_V2Synthetic0001/x'}));
 const viaV1=await stripeConnectV2(env,{fetch:fallback.fetcher}).createOnboardingLink('acct_V2Synthetic0001',urls);
 assert.match(viaV1.url,/^https:\/\/connect\.stripe\.com\//);assert.equal(fallback.requests[1].url.pathname,'/v1/account_links');
 assert.equal(new URLSearchParams(fallback.requests[1].body).get('account'),'acct_V2Synthetic0001');
 const other=mock(()=>Response.json({error:{code:'not_found'}},{status:404}));
 await assert.rejects(stripeConnectV2(env,{fetch:other.fetcher}).createOnboardingLink('acct_V2Synthetic0001',urls));assert.equal(other.requests.length,1);
 const evil=mock(()=>Response.json({object:'v2.core.account_link',account:'acct_V2Synthetic0001',livemode:false,expires_at:new Date(Date.now()+300000).toISOString(),url:'https://evil.example/onboard'}));
 await assert.rejects(stripeConnectV2(env,{fetch:evil.fetcher}).createOnboardingLink('acct_V2Synthetic0001',urls),(e:{code?:string})=>e.code==='stripe_invalid_response');
 await assert.rejects(stripeConnectV2(env,{fetch:v2.fetcher}).createOnboardingLink('acct_V2Synthetic0001',{...urls,returnUrl:'https://other.example/'}),(e:{code?:string})=>e.code==='invalid_return_url');
});
test('nothing is sent when payments are not ready',async()=>{
 const {requests,fetcher}=mock(()=>Response.json(readyAccount()));
 await assert.rejects(stripeConnectV2({...env,COMMERCE_SANDBOX_REVIEWED:'false'},{fetch:fetcher}).retrieveRecipientAccount('acct_V2Synthetic0001'));assert.equal(requests.length,0);
});
const sign=(body:string,secret:string,stamp=Math.floor(Date.now()/1000))=>'t='+stamp+',v1='+createHmac('sha256',secret).update(stamp+'.').update(body).digest('hex');
const thin=(changes:Obj={})=>JSON.stringify({id:'evt_test_65UIRNU7G1XbhCfOim416TgmEI4ASQ3jHxXt8RFwXoeVwO',object:'v2.core.event',type:'v2.core.account[configuration.recipient].capability_status_updated',livemode:false,created:new Date().toISOString(),context:null,reason:{type:'request'},related_object:{id:'acct_V2Synthetic0001',type:'v2.core.account',url:'/v2/core/accounts/acct_V2Synthetic0001'},...changes});
test('thin events are signature-verified (platform or dedicated thin destination secret) and bound to an account',async()=>{
 const body=thin();
 assert.deepEqual(await verifyStripeThinEvent(body,sign(body,env.COMMERCE_STRIPE_TEST_WEBHOOK_SECRET),env),{id:JSON.parse(body).id,type:JSON.parse(body).type,livemode:false,accountId:'acct_V2Synthetic0001'});
 const thinSecret='whsec_SYNTHETICV2THINDEST0001',withThin={...env,COMMERCE_STRIPE_TEST_THIN_WEBHOOK_SECRET:thinSecret};
 assert.equal((await verifyStripeThinEvent(body,sign(body,thinSecret),withThin))!.accountId,'acct_V2Synthetic0001');
 await assert.rejects(verifyStripeThinEvent(body,sign(body,thinSecret),env),(e:{code?:string})=>e.code==='invalid_webhook_signature');
 await assert.rejects(verifyStripeThinEvent(body.replace('acct_V2Synthetic0001','acct_Other'),sign(body,env.COMMERCE_STRIPE_TEST_WEBHOOK_SECRET),env),(e:{code?:string})=>e.code==='invalid_webhook_signature');
 const live=thin({livemode:true});await assert.rejects(verifyStripeThinEvent(live,sign(live,env.COMMERCE_STRIPE_TEST_WEBHOOK_SECRET),env),(e:{code?:string})=>e.code==='invalid_webhook');
 assert.equal(thinAccountEvent(JSON.parse(thin({type:'v1.billing.meter.error_report_triggered'})),false),null);
 assert.throws(()=>thinAccountEvent(JSON.parse(thin({related_object:{id:'cus_1',type:'customer'}})),false));
});
