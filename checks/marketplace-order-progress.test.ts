// Run: node --import tsx --test checks/marketplace-order-progress.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {orderProgress,orderStatusLabel,type ProgressInput} from '../lib/marketplace-order-progress';
import {OrderProgress} from '../app/marketplace-order-progress';

const base:ProgressInput={status:'awaiting_payment',paidAt:null,paymentConfirmed:false,tracking:null,fulfillment:'shipping'};
const tracking={carrier:'USPS',number:'9400111899223197428490',verified:false};
const paid='2026-11-01T12:00:00.000Z';

test('unpaid order: placed is done and payment is the current step',()=>{
 const p=orderProgress(base);
 assert.deepEqual(p.steps.map(s=>s.label),['Order placed','Payment confirmed','Shipped','Delivered']);
 assert.equal(p.complete,1);assert.equal(p.current,1);assert.equal(p.terminal,null);
});
test('paid without tracking waits on shipping',()=>{
 const p=orderProgress({...base,status:'awaiting_shipment',paidAt:paid,paymentConfirmed:true});
 assert.equal(p.complete,2);assert.equal(p.current,2);
});
test('seller tracking marks shipped even while carrier verification holds the order',()=>{
 const p=orderProgress({...base,status:'manual_review',paidAt:paid,paymentConfirmed:true,tracking});
 assert.equal(p.complete,3);assert.equal(p.current,3);assert.match(p.hold||'',/Support is reviewing/);
});
test('delivered and release/transfer statuses all read as delivered, never as paid out',()=>{
 for(const status of ['delivered_review','release_eligible','transfer_pending','transferred']){
  const p=orderProgress({...base,status,paidAt:paid,paymentConfirmed:true,tracking});
  assert.equal(p.complete,4,status);assert.equal(p.current,-1,status);
  assert.doesNotMatch(orderStatusLabel(status),/pa(id|yout)|transfer/i);
 }
});
test('a payment with unverified timing still counts as confirmed',()=>{
 assert.equal(orderProgress({...base,status:'awaiting_shipment',paidAt:null,paymentConfirmed:true}).complete,2);
});
test('pickup path ends at Picked up',()=>{
 const p=orderProgress({...base,fulfillment:'pickup',status:'awaiting_shipment',paidAt:paid,paymentConfirmed:true});
 assert.deepEqual(p.steps.map(s=>s.label),['Order placed','Payment confirmed','Ready for pickup','Picked up']);
});
test('refunded, refund pending, cancelled and expired are terminal states',()=>{
 assert.equal(orderProgress({...base,status:'refunded',paidAt:paid,tracking}).terminal?.label,'Refunded');
 assert.equal(orderProgress({...base,status:'refunded',paidAt:paid,tracking}).complete,3);
 assert.equal(orderProgress({...base,status:'refund_pending',paidAt:paid}).terminal?.kind,'refunding');
 assert.equal(orderProgress({...base,status:'cancelled'}).terminal?.label,'Cancelled');
 assert.equal(orderProgress({...base,status:'checkout_expired'}).terminal?.label,'Checkout expired');
 assert.equal(orderProgress({...base,status:'cancelled'}).current,-1);
});
test('every server status has a plain-language label',()=>{
 for(const status of ['awaiting_payment','awaiting_shipment','in_transit','delivered_review','release_eligible','refund_eligible','refund_pending','refunded','transfer_pending','transferred','manual_review','checkout_expired','cancelled'])assert.doesNotMatch(orderStatusLabel(status),/_/);
});
test('rendered stepper is an ordered list with exactly one aria-current step',()=>{
 const html=renderToStaticMarkup(createElement(OrderProgress,{order:{...base,status:'awaiting_shipment',paidAt:paid,paymentConfirmed:true}}));
 assert.match(html,/^<div class="order-progress"><ol aria-label="Order progress">/);
 assert.equal(html.match(/aria-current="step"/g)?.length,1);
 assert.match(html,/<li class="current" aria-current="step">.*Shipped/);
 const ended=renderToStaticMarkup(createElement(OrderProgress,{order:{...base,status:'refunded',paidAt:paid}}));
 assert.equal(ended.match(/aria-current="step"/g)?.length,1);assert.match(ended,/Refunded/);
});
