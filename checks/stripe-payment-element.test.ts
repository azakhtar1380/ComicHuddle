// Run: node --import tsx --test checks/stripe-payment-element.test.ts
// Source-level contract (Stripe Elements cannot render outside a browser): the embedded form must collect
// every field the server-created Checkout Session requires, or checkout.confirm() throws.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const element=readFileSync('app/stripe-payment-element.tsx','utf8'),adapter=readFileSync('lib/stripe-sandbox.ts','utf8');
test('billing address is required by the session, so the embedded form renders BillingAddressElement before the payment method',()=>{
 assert.match(adapter,/'billing_address_collection':\s*'required'/);
 assert.match(element,/import\s*\{[^}]*\bBillingAddressElement\b[^}]*\}\s*from\s*'@stripe\/react-stripe-js\/checkout'/);
 const billing=element.indexOf('<BillingAddressElement'),payment=element.indexOf('<PaymentElement');
 assert.ok(billing>0&&payment>billing,'BillingAddressElement must be rendered (above PaymentElement)');
});
test('the embedded form never asks for a second shipping address (the order uses the buyer-confirmed address)',()=>{
 assert.doesNotMatch(element,/ShippingAddressElement/);assert.doesNotMatch(adapter,/shipping_address_collection/);
});
test('confirm failures surface the real Stripe error instead of a generic message',()=>{
 assert.match(element,/result\.error\.message/);assert.match(element,/console\.error\(/);
});
test('order actions use the in-page accessible confirm dialog, never window.confirm',()=>{
 const desk=readFileSync('app/commerce-desk.tsx','utf8');
 assert.doesNotMatch(desk,/window\.confirm/);assert.match(desk,/role="alertdialog"/);assert.match(desk,/aria-modal="true"/);assert.match(desk,/event\.key==='Escape'/);
 assert.match(desk,/I didn’t receive it/,'pickup orders use pickup wording');
});