// Run: node --import tsx --test checks/email-templates.test.ts
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {itemSoldEmail,orderReceiptEmail,sampleOrder,supportThanksEmail} from '../lib/email-templates';
import {sendEmail,testOutbox} from '../lib/email';

const origin='https://comichuddle.test';

test('buyer receipt: totals, Huddles, address, next step, test banner, plain text',()=>{
 const email=orderReceiptEmail(origin,sampleOrder());
 assert.match(email.subject,/^\[Test\] Order confirmed: Incredible Hulk #181$/);
 assert.ok(email.html.includes(origin+'/email/huddles-thank-you.png'),'Huddles image by absolute URL');
 assert.ok(email.html.includes('$1,262.95'),'total paid');
 assert.ok(email.html.includes('USPS Ground Advantage'));
 assert.ok(email.html.includes('Minneapolis, MN 55403'));
 assert.ok(email.html.includes('Test mode: no real money moved'));
 assert.ok(email.text.includes('Total paid: $1,262.95'));
 assert.ok(!email.html.includes('undefined')&&!email.text.includes('undefined'));
});
test('auction auto-charge and pickup variants say the right thing',()=>{
 assert.match(orderReceiptEmail(origin,sampleOrder({autoCharged:{last4:'4242'}})).html,/saved card ending 4242 was charged automatically/);
 const pickup=orderReceiptEmail(origin,sampleOrder({fulfillment:'pickup',shippingCents:0,totalCents:125000,shipTo:null}));
 assert.match(pickup.html,/pickup PIN/);assert.doesNotMatch(pickup.html,/Shipping to/);
});
test('seller notice: what they receive and the ship-by date',()=>{
 const email=itemSoldEmail(origin,sampleOrder());
 assert.match(email.subject,/Sold! Incredible Hulk #181/);
 assert.ok(email.html.includes('$1,162.95'));assert.ok(email.html.includes('Nov 19'));
 assert.ok(email.html.includes(origin+'/email/huddles-sold.png'));
});
test('user-supplied text is escaped (no HTML injection through a listing title)',()=>{
 const email=orderReceiptEmail(origin,sampleOrder({title:'<script>alert(1)</script> & "quotes"',buyerName:'<b>x</b>'}));
 assert.ok(!email.html.includes('<script>'));assert.ok(email.html.includes('&lt;script&gt;'));assert.ok(!email.html.includes('<b>x</b>'));
});
test('support thank-you carries the not-a-donation disclosure',()=>{
 const email=supportThanksEmail(origin,{amountCents:2500,name:null,test:false,disclosure:'Not a charitable donation.'});
 assert.ok(email.html.includes('$25.00'));assert.ok(email.html.includes('Not a charitable donation.'));assert.doesNotMatch(email.subject,/Test/);
});
test('sending: off without a provider key, never throws, test outbox records instead of sending',async()=>{
 const saved={...process.env};
 try{
  delete process.env.EMAIL_TEST_OUTBOX;delete process.env.RESEND_API_KEY;delete process.env.EMAIL_FROM;
  assert.deepEqual(await sendEmail('a@b.test',orderReceiptEmail(origin,sampleOrder())),{sent:false,reason:'not_configured'});
  assert.deepEqual(await sendEmail('not-an-email',orderReceiptEmail(origin,sampleOrder())),{sent:false,reason:'no_address'});
  process.env.EMAIL_TEST_OUTBOX='1';
  const before=testOutbox().length;
  assert.deepEqual(await sendEmail('buyer@b.test',orderReceiptEmail(origin,sampleOrder())),{sent:true});
  assert.equal(testOutbox().length,before+1);assert.equal(testOutbox().at(-1)!.to,'buyer@b.test');
 }finally{process.env={...saved}}
});
