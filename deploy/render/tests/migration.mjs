const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');
import {createApplication} from '../server/main.mjs';
import {migrate} from '../server/database.mjs';
import assert from 'node:assert/strict';
const db=new PGlite(),pool={connect:async()=>({query:(s,v)=>!v&&s.includes(';')?db.exec(s):db.query(s,v),release(){}})};
try{await migrate(pool);await migrate(pool);assert.equal((await db.query('SELECT count(*)::int AS n FROM ch_deploy.migrations')).rows[0].n,3);assert.ok((await db.query("SELECT to_regclass('ch_demo.sessions') AS sessions")).rows[0].sessions);console.log('PASS: actual PostgreSQL migration wrapper, all three DDL files and idempotent restart. AWS connection not exercised.');
 const handle=createApplication({...pool,query:(s,v)=>db.query(s,v)},{origin:'https://demo.test'});
 const session=await handle(new Request('https://demo.test/api/session',{method:'POST',headers:{Origin:'https://demo.test'}}));assert.equal(session.status,201);const cookie=session.headers.get('Set-Cookie').split(';')[0];
 const call=async(path,body)=>{const r=await handle(new Request('https://demo.test'+path,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:'https://demo.test','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}));assert.equal(r.status,200);return r;};
 const listing=(await (await call('/api/action',{action:'list',comicId:'planet-12',grade:'cgc_9_8_universal',priceCents:60000})).json()).state.listings[0];
 const order=(await (await call('/api/action',{action:'purchase',listingId:listing.id})).json()).state.orders[0];
 for(let i=0;i<7;i++)await call('/api/action',{action:'advance',orderId:order.orderId});
 const state=(await (await call('/api/state')).json()).state;assert.equal(state.walletCents,55200);assert.equal(state.points,600);assert.ok((await (await call('/api/export')).text()).includes(listing.id));
 await call('/api/action',{action:'withdraw'});assert.equal((await (await call('/api/state')).json()).state.walletCents,0);
 const session2=await handle(new Request('https://demo.test/api/session',{method:'POST',headers:{Origin:'https://demo.test'}}));const cookie2=session2.headers.get('Set-Cookie').split(';')[0];const second=await handle(new Request('https://demo.test/api/state',{headers:{Cookie:cookie2}}));assert.equal((await second.json()).state.listings.length,0);
 console.log('PASS: session creation -> listing -> purchase -> seven demo settlement transitions -> points/wallet -> CSV export -> payout; separate sessions isolated on actual PostgreSQL. No external payment/AI/eBay calls.');}finally{await db.close()}
