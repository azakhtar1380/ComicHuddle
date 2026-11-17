// Run: node --import tsx --test checks/payment-handoff.test.ts
// "Pay on your phone" codes: one-time, 10 minutes, same buyer, unpaid order only. Saved private address round-trip.
import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {Pool} from 'pg';
import {nativeGcdFixture} from './native-gcd-fixture';
import {createPaymentHandoff,redeemPaymentHandoff,saveBuyerAddress,savedBuyerAddress} from '../lib/payment-handoff';
import {EXCLUDED_ON_PAGE_METHODS} from '../lib/stripe-sandbox';

let engine:PGlite;const pool=new Pool();
before(async()=>{
 engine=new PGlite();await nativeGcdFixture(engine);await engine.exec('CREATE SCHEMA ch_web');
 for(const name of readdirSync('db/postgres-migrations').filter(n=>n.endsWith('.sql')&&!['003_catalog_ingestion.sql','005_gcd_snapshot_import.sql'].includes(n)).sort())await engine.exec(readFileSync('db/postgres-migrations/'+name,'utf8'));
 await engine.exec('SET search_path TO ch_web,gcd,public');
 const query=async(config:string|{text:string},values:unknown[]=[])=>{const r=await engine.query<Record<string,unknown>>(typeof config==='string'?config:config.text,values);return {...r,rowCount:r.affectedRows,command:'',rows:r.rows}};
 Object.assign(pool,{query,connect:async()=>({query,release(){}})});(globalThis as typeof globalThis&{comicHuddlePool:Pool}).comicHuddlePool=pool;
 const order=(id:string,status:string)=>engine.query("INSERT INTO ch_web.commerce_orders(id,buyer_id,buyer_user_id,seller_id,seller_user_id,listing_id,request_id,status,snapshot,state,created_at,updated_at) VALUES($1,'b','buyer','s','seller','l-'||$1,$1,$2,'{}','{}',now()::text,now()::text)",[id,status]);
 await order('o-open','awaiting_payment');await order('o-paid','awaiting_shipment');
});
after(async()=>{await engine.close();delete(globalThis as typeof globalThis&{comicHuddlePool?:Pool}).comicHuddlePool});

test('a phone code works once, only for the same buyer, only for an unpaid order',async()=>{
 await assert.rejects(createPaymentHandoff('someone-else',{action:'payment_handoff',orderId:'o-open'}),/not found/);
 await assert.rejects(createPaymentHandoff('buyer',{action:'payment_handoff',orderId:'o-paid'}),/no longer waiting/);
 const {token,expiresAt}=await createPaymentHandoff('buyer',{action:'payment_handoff',orderId:'o-open'});
 assert.ok(Math.abs(Date.parse(expiresAt)-Date.now()-600_000)<5000,'Expires in 10 minutes');
 const stored=await engine.query<{token_hash:string}>('SELECT token_hash FROM ch_web.payment_handoffs');assert.notEqual(stored.rows[0].token_hash,token,'Only a hash is stored');
 await assert.rejects(redeemPaymentHandoff('intruder',{action:'redeem_handoff',token}),/same account/);
 const second=await createPaymentHandoff('buyer',{action:'payment_handoff',orderId:'o-open'});
 assert.equal(await redeemPaymentHandoff('buyer',{action:'redeem_handoff',token:second.token}),'o-open');
 await assert.rejects(redeemPaymentHandoff('buyer',{action:'redeem_handoff',token:second.token}),/expired or was already used/,'One-time');
 const third=await createPaymentHandoff('buyer',{action:'payment_handoff',orderId:'o-open'});
 await engine.query("UPDATE ch_web.payment_handoffs SET expires_at=now()-interval '1 second'");
 await assert.rejects(redeemPaymentHandoff('buyer',{action:'redeem_handoff',token:third.token}),/expired/,'Expired after 10 minutes');
});

test('saved private address round-trips; on-page checkout excludes PayPal and pay-later',async()=>{
 assert.equal(await savedBuyerAddress('buyer'),null);
 const address={name:'Q Buyer',line1:'1 Main St',line2:'',city:'Austin',state:'TX',postalCode:'78701',country:'US' as const};
 await saveBuyerAddress('buyer',{action:'save_buyer_address',shippingAddress:address});
 assert.deepEqual(await savedBuyerAddress('buyer'),address);
 for(const t of ['paypal','klarna','affirm','afterpay_clearpay','cashapp','amazon_pay'])assert.ok((EXCLUDED_ON_PAGE_METHODS as readonly string[]).includes(t),t);
 assert.ok(!(EXCLUDED_ON_PAGE_METHODS as readonly string[]).includes('card'),'Cards (and the wallets on them) stay');
});
