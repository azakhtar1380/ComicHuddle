// Verification fee (migration 057): paid first through Checkout; only the signed webhook moves the request to
// review; approval keeps it; decline refunds it in full; repeated or mismatched events change nothing.
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {Pool} from 'pg';
import {startVerificationCheckout,applyVerificationEvent,refundFee,keepFee,verificationFeeCents,FeeError} from '../lib/verification-payments';
import {personVerification} from '../lib/person-verification';
import type {StripeVerifiedEvent} from '../lib/stripe-sandbox';

let engine:PGlite;const pool=new Pool();
before(async()=>{
 engine=new PGlite();await engine.exec('CREATE SCHEMA ch_web;CREATE SCHEMA gcd');
 for(const name of readdirSync('db/postgres-migrations').filter(n=>n.endsWith('.sql')&&!['003_catalog_ingestion.sql','005_gcd_snapshot_import.sql'].includes(n)).sort()){try{await engine.exec(readFileSync('db/postgres-migrations/'+name,'utf8'))}catch{/* catalog migrations need GCD tables */}}
 await engine.exec('SET search_path TO ch_web,gcd,public');
 const query=async(config:string|{text:string},values:unknown[]=[])=>{const r=await engine.query<Record<string,unknown>>(typeof config==='string'?config:config.text,values);return {...r,rowCount:r.affectedRows,command:'',rows:r.rows}};
 Object.assign(pool,{query,connect:async()=>({query,release(){}})});(globalThis as typeof globalThis&{comicHuddlePool:Pool}).comicHuddlePool=pool;
 for(const [p,u,h] of [['p1','u1','ava'],['p2','u2','ben']])await engine.query(`INSERT INTO ch_web.profiles(id,user_id,handle,name,bio,tagline,location,favorite,since,color,featured,visible,dm_open,created_at) VALUES($1,$2,$3,'Name','','','Minneapolis, MN','',2015,'red','[]',1,1,'2026-11-01T00:00:00.000Z')`,[p,u,h]);
});
after(async()=>{await engine.close();delete(globalThis as typeof globalThis&{comicHuddlePool?:Pool}).comicHuddlePool});

function fakeStripe(){
 const calls={checkouts:[] as {verificationId:string;amountCents:number}[],refunds:[] as {paymentIntentId:string;amountCents:number}[],failRefund:false};
 return {calls,processor:{
  async createVerificationCheckout(input:{verificationId:string;amountCents:number}){calls.checkouts.push(input);return {id:'cs_test_'+input.verificationId.slice(0,8),url:'https://checkout.stripe.com/c/pay/x'}},
  async refundVerification(input:{paymentIntentId:string;amountCents:number}){if(calls.failRefund)throw Error('stripe down');calls.refunds.push(input);return {id:'re_1'}},
 }};
}
const completed=(id:string,session:string,amount:number,intent='pi_'+id.slice(0,8)):StripeVerifiedEvent=>({id:'evt_'+Math.random(),type:'checkout.session.completed',livemode:false,data:{object:{id:session,amount_total:amount,currency:'usd',payment_status:'paid',payment_intent:intent,metadata:{purpose:'verification',verification_id:id}}}} as unknown as StripeVerifiedEvent);

test('fee amount: $10 by default, configurable, 0 turns it off',()=>{
 assert.equal(verificationFeeCents({}),1000);assert.equal(verificationFeeCents({VERIFICATION_FEE_CENTS:'0'}),0);
 assert.equal(verificationFeeCents({VERIFICATION_FEE_CENTS:'abc'}),1000);assert.equal(verificationFeeCents({VERIFICATION_FEE_CENTS:'500'}),500);
});

test('paid first; only the webhook puts the request in review; decline refunds in full; approve keeps it',async()=>{
 const {calls,processor}=fakeStripe();
 const started=await startVerificationCheckout(processor,{profileId:'p1',userId:'u1',contact:'email me',amountCents:1000,sandbox:1});
 assert.equal(calls.checkouts[0].amountCents,1000);
 assert.equal((await personVerification('p1')).status,'unverified','not in review until paid');
 // A mismatched amount or session never counts.
 assert.equal((await applyVerificationEvent(completed(started.id,'cs_test_'+started.id.slice(0,8),500),1))?.ignored,true);
 assert.equal((await applyVerificationEvent(completed(started.id,'cs_other',1000),1))?.ignored,true);
 assert.equal((await applyVerificationEvent(completed(started.id,'cs_test_'+started.id.slice(0,8),1000),0))?.ignored,true,'other payment mode');
 assert.equal((await applyVerificationEvent(completed(started.id,'cs_test_'+started.id.slice(0,8),1000),1))?.verification,'paid');
 assert.equal((await applyVerificationEvent(completed(started.id,'cs_test_'+started.id.slice(0,8),1000),1))?.verification,'duplicate');
 const now=await personVerification('p1');assert.equal(now.status,'pending');
 await assert.rejects(startVerificationCheckout(processor,{profileId:'p1',userId:'u1',contact:'',amountCents:1000,sandbox:1}),FeeError,'no second fee while one is paid');
 assert.ok((await engine.query("SELECT 1 FROM ch_web.notifications WHERE user_id='u1' AND title='Verification fee received'")).rows.length);
 // Decline: full refund (Stripe error leaves it for a retry).
 calls.failRefund=true;assert.equal(await refundFee(processor,'p1'),'failed');
 calls.failRefund=false;assert.equal(await refundFee(processor,'p1'),'refunded');
 assert.deepEqual(calls.refunds,[{paymentIntentId:'pi_'+started.id.slice(0,8),verificationId:started.id,amountCents:1000}]);
 assert.equal((await engine.query<{status:string}>('SELECT status FROM ch_web.verification_payments WHERE id=$1',[started.id])).rows[0].status,'refunded');
 assert.equal(await refundFee(processor,'p1'),'none','never refunded twice');
 // Approve: kept.
 const second=await startVerificationCheckout(processor,{profileId:'p2',userId:'u2',contact:'',amountCents:1000,sandbox:1});
 await applyVerificationEvent(completed(second.id,'cs_test_'+second.id.slice(0,8),1000),1);
 await keepFee('p2');
 assert.equal((await engine.query<{status:string}>('SELECT status FROM ch_web.verification_payments WHERE id=$1',[second.id])).rows[0].status,'kept');
 assert.equal(await refundFee(processor,'p2'),'none','a kept fee is not refunded by a later removal');
});
