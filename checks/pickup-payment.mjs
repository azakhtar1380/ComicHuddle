// Run: node --experimental-vm-modules checks/pickup-payment.mjs
// Reuses the commerce suite's isolated SQLite/Drizzle/auth/HTTP fixture setup,
// then executes actual commerce route handlers. No genuine payment is made.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const existing = await readFile('checks/commerce-api.mjs', 'utf8');
const boundary = existing.indexOf('\nawait test(');
assert.ok(boundary > 0, 'Shared commerce fixture setup boundary is missing.');
const dependencyUrls = Object.fromEntries(['drizzle-orm', 'drizzle-orm/d1', 'drizzle-orm/sqlite-core', 'zod'].map(spec => [spec, import.meta.resolve(spec)]));
const setup = `const dependencyUrls=${JSON.stringify(dependencyUrls)};\n` + existing.slice(0, boundary)
  .replace("import ts from 'typescript';", `import ts from ${JSON.stringify(import.meta.resolve('typescript'))};`)
  .replace('await import(spec)', 'await import(dependencyUrls[spec]??spec)');
assert.ok(setup.includes('async function checkoutFixture('), 'Actual checkout fixture is missing.');
assert.ok(setup.includes("const commerce=await route(") || setup.includes("commerce=await route('app/api/commerce/route.ts')"), 'Actual commerce route is not loaded.');

const cases = String.raw`
const sessionPosts=()=>processor.requests.filter(r=>r.route==='/v1/checkout/sessions'&&r.method==='POST');
async function localFixture(prefix,fulfillment='shipping'){
 const s=await seller(prefix),b=await collector(prefix+'buyer'),listingId=await publish(s,{fulfillment,...(fulfillment==='shipping'?{}:{pickupCity:'Test City',pickupState:'MN'}),...(fulfillment==='pickup'?{shipping:0}:{})});
 status(await post(s.user,{action:'seller_onboard',sandboxAcknowledged:true}),200);
 return {s,b,listingId,request:checkoutFields(listingId)};
}
await test('Pickup-only listings reject shipping checkout before any order, reservation or provider request',async()=>{
 const f=await localFixture('pickuponly','pickup'),before=processor.requests.length;
 const result=await unchanged(()=>post(f.b.user,f.request));status(result,409);assert.match(result.data.error,/pickup checkout.*message the seller/i);
 assert.equal(processor.requests.length,before);assert.equal(sessionPosts().length,0);
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM commerce_orders').get().n,0);
 assert.equal(sqlite.prepare('SELECT status FROM listings WHERE id=?').get(f.listingId).status,'active');
});
await test('A listing offering both methods creates one explicitly shipping order and retries its saved session',async()=>{
 const f=await localFixture('bothmethods','both'),first=await post(f.b.user,f.request);status(first,200);
 const saved=order(first.data.order.id),snapshot=JSON.parse(saved.snapshot);assert.equal(snapshot.fulfillment,'shipping');assert.equal(first.data.order.fulfillment,'shipping');
 assert.deepEqual(snapshot.shippingAddress,address);assert.equal(snapshot.shippingCents,700);assert.equal(sessionPosts().length,1);
 const again=await post(f.b.user,f.request);status(again,200);assert.equal(again.data.order.id,saved.id);assert.equal(again.data.order.fulfillment,'shipping');
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM commerce_orders WHERE listing_id=?').get(f.listingId).n,1);assert.equal(sessionPosts().length,1);
});
await test('Default shipping listings preserve existing checkout and protection policy',async()=>{
 const f=await checkoutFixture('defaultship'),saved=order(f.orderId),snapshot=JSON.parse(saved.snapshot);
 assert.equal(sqlite.prepare('SELECT fulfillment FROM listings WHERE id=?').get(f.listingId).fulfillment,'shipping');
 assert.equal(snapshot.fulfillment,'shipping');assert.equal(f.opened.data.order.fulfillment,'shipping');assert.equal(snapshot.totalCents,3200);
 const state=JSON.parse(saved.state);assert.equal(state.order.paidAt,null);assert.equal(state.status,'awaiting_payment');assert.equal(sessionPosts().length,1);
});
await test('Forged pickup selection and unknown client delivery fields cannot bypass the shipping-only action contract',async()=>{
 const f=await localFixture('clientpickup','both'),before=processor.requests.length;
 for(const change of [{fulfillment:'pickup'},{deliveryMethod:'pickup'},{pickup:true}])status(await unchanged(()=>post(f.b.user,{...f.request,...change})),400);
 assert.equal(processor.requests.length,before);assert.equal(sessionPosts().length,0);assert.equal(sqlite.prepare('SELECT count(*) AS n FROM commerce_orders').get().n,0);
});
await test('Unknown persisted fulfillment values fail closed without provider or order creation',async()=>{
 const f=await localFixture('unknownmode'),before=processor.requests.length;
 for(const fulfillment of ['','PICKUP','courier','unknown']){
  sqlite.prepare('UPDATE listings SET fulfillment=? WHERE id=?').run(fulfillment,f.listingId);
  const result=await unchanged(()=>post(f.b.user,f.request));status(result,409);assert.match(result.data.error,/delivery method.*unavailable/i);
 }
 assert.equal(processor.requests.length,before);assert.equal(sessionPosts().length,0);assert.equal(sqlite.prepare('SELECT count(*) AS n FROM commerce_orders').get().n,0);
});
await test('A seller switching to pickup during the atomic reservation leaves no shipping order or Stripe session',async()=>{
 const f=await localFixture('pickuprace','both');let raced=false;
 beforeBatch=statements=>{
  if(statements.some(statement=>/insert\s+into\s+["\x60]?commerce_orders["\x60]?\s/i.test(statement.sql))){
   beforeBatch=null;raced=true;sqlite.prepare("UPDATE listings SET fulfillment='pickup' WHERE id=?").run(f.listingId);
  }
 };
 const result=await post(f.b.user,f.request);status(result,409);assert.ok(raced);
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM commerce_orders').get().n,0);assert.equal(sessionPosts().length,0);
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM commerce_events').get().n,0);
 const listing=sqlite.prepare('SELECT status,fulfillment FROM listings WHERE id=?').get(f.listingId);assert.equal(listing.status,'active');assert.equal(listing.fulfillment,'pickup');
});
await test('Checkout retry rejects a pickup or unknown listing without retrieving or replacing its existing session',async()=>{
 const f=await checkoutFixture('retrydelivery'),before=processor.requests.length;
 for(const fulfillment of ['pickup','unknown']){
  sqlite.prepare('UPDATE listings SET fulfillment=? WHERE id=?').run(fulfillment,f.listingId);
  status(await unchanged(()=>post(f.b.user,f.request)),409);
 }
 assert.equal(processor.requests.length,before);assert.equal(sessionPosts().length,1);
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM commerce_orders WHERE listing_id=?').get(f.listingId).n,1);
});
await test('Uncertain checkout retries cannot issue a new session after delivery changes to pickup',async()=>{
 const f=await localFixture('unboundpickup');processor.override=request=>{if(request.route==='/v1/checkout/sessions')throw Error('SYNTHETIC UNCERTAIN CHECKOUT')};
 status(await post(f.b.user,f.request),503);processor.override=null;
 const saved=sqlite.prepare('SELECT * FROM commerce_orders WHERE listing_id=?').get(f.listingId);assert.ok(saved);assert.equal(saved.checkout_session_id,null);
 sqlite.prepare("UPDATE listings SET fulfillment='pickup' WHERE id=?").run(f.listingId);
 const before=processor.requests.length;status(await unchanged(()=>post(f.b.user,f.request)),409);
 assert.equal(processor.requests.length,before);assert.equal(sessionPosts().length,1);
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM commerce_orders WHERE listing_id=?').get(f.listingId).n,1);
});
await test('Existing shipping-order snapshots remain readable while unsupported pickup snapshots require reconciliation',async()=>{
 const f=await checkoutFixture('legacysnapshot'),saved=order(f.orderId),snapshot=JSON.parse(saved.snapshot);delete snapshot.fulfillment;
 sqlite.prepare('UPDATE commerce_orders SET snapshot=? WHERE id=?').run(JSON.stringify(snapshot),saved.id);
 const legacy=await get(f.b.user,'?order='+saved.id);status(legacy,200);assert.equal(legacy.data.order.fulfillment,'shipping');
 snapshot.fulfillment='pickup';sqlite.prepare('UPDATE commerce_orders SET snapshot=? WHERE id=?').run(JSON.stringify(snapshot),saved.id);
 status(await get(f.b.user,'?order='+saved.id),409);assert.equal(sessionPosts().length,1);
});
completed=true;
console.log('Pickup shipping-payment guard: '+passed+' named groups passed; '+failures.length+' failed. Actual isolated checkout route with synthetic Stripe HTTP; no provider payments.');
if(failures.length)process.exitCode=1;
`;
try {await import('data:text/javascript;base64,' + Buffer.from(setup + '\n' + cases).toString('base64'));}
catch(error) {throw new Error('Pickup suite setup or execution failed: ' + (error.code ?? error.message.split(' from ')[0]));}
