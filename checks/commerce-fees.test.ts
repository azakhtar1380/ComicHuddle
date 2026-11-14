// Run: node --import tsx --test checks/commerce-fees.test.ts
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {estimatedStripeFeeCents,formatBps,payoutLegs,platformFeeCents,platformFeeConfig,proratedFeeRefundCents,saleBreakdown} from '../lib/commerce-fees';
import {applyCommerceEvent,createCommerceState,evaluateCommercePolicy,type CommerceState} from '../lib/commerce-policy';

const eight={bps:800,minCents:50,maxCents:null};
test('config: defaults to 8% with a 50c minimum; strings parse; invalid values are reported, not guessed',()=>{
 assert.deepEqual(platformFeeConfig({}),{bps:800,minCents:50,maxCents:null,valid:true});
 assert.deepEqual(platformFeeConfig({COMMERCE_PLATFORM_FEE_BPS:'1000',COMMERCE_PLATFORM_FEE_MIN_CENTS:'0',COMMERCE_PLATFORM_FEE_MAX_CENTS:'5000'}),{bps:1000,minCents:0,maxCents:5000,valid:true});
 for(const bad of [{COMMERCE_PLATFORM_FEE_BPS:'8%'},{COMMERCE_PLATFORM_FEE_BPS:'3001'},{COMMERCE_PLATFORM_FEE_BPS:'-1'},{COMMERCE_PLATFORM_FEE_MIN_CENTS:'100',COMMERCE_PLATFORM_FEE_MAX_CENTS:'99'},{COMMERCE_PLATFORM_FEE_BPS:'7.5'}])
  assert.equal(platformFeeConfig(bad).valid,false);
});
test('fee math: half-up rounding on the item only, minimum, maximum, never above the item, zero rate',()=>{
 assert.equal(platformFeeCents(10000,eight),800);
 assert.equal(platformFeeCents(1263,eight),101);   // 101.04
 assert.equal(platformFeeCents(1269,eight),102);   // 101.52
 assert.equal(platformFeeCents(1256,eight),100);   // 100.48
 assert.equal(platformFeeCents(625,eight),50);     // exactly 50.00
 assert.equal(platformFeeCents(100,eight),50,'minimum applies');
 assert.equal(platformFeeCents(40,eight),40,'never more than the item');
 assert.equal(platformFeeCents(1_000_000,{...eight,maxCents:2500}),2500,'cap applies');
 assert.equal(platformFeeCents(10000,{bps:0,minCents:50,maxCents:null}),0,'zero rate means no minimum');
 assert.throws(()=>platformFeeCents(10.5,eight));
 assert.deepEqual(saleBreakdown(10000,1500,eight),{itemCents:10000,shippingCents:1500,feeBps:800,feeCents:800,sellerNetCents:10700},'shipping is not feed and goes to the seller');
 assert.equal(formatBps(800),'8%');assert.equal(formatBps(750),'7.50%');
});
test('payout legs keep the charge-funded transfer within the charge; credit shortfall is a platform top-up',()=>{
 assert.deepEqual(payoutLegs(9200,10000),{fromChargeCents:9200,platformTopUpCents:0});
 assert.deepEqual(payoutLegs(9200,5000),{fromChargeCents:5000,platformTopUpCents:4200});
 assert.deepEqual(payoutLegs(9200,0),{fromChargeCents:0,platformTopUpCents:9200});
});
test('partial refunds pro-rate the fee (floor); full refunds return it all; Stripe fee estimate',()=>{
 assert.equal(proratedFeeRefundCents(800,10000,10000),800);
 assert.equal(proratedFeeRefundCents(800,5000,10000),400);
 assert.equal(proratedFeeRefundCents(800,3333,10000),266);
 assert.equal(proratedFeeRefundCents(801,1,10000),0);
 assert.throws(()=>proratedFeeRefundCents(800,10001,10000));
 assert.equal(estimatedStripeFeeCents(10000),320);assert.equal(estimatedStripeFeeCents(0),0);
});

const stamp=(minutes:number)=>new Date(Date.parse('2026-11-01T00:00:00.000Z')+minutes*60000).toISOString();
const base={orderId:'o1',buyerId:'b1',sellerId:'s1',occurredAt:'',source:'server' as const,verified:true as const};
function transferred(credit=0):CommerceState{
 const state=createCommerceState({orderId:'o1',buyerId:'b1',sellerId:'s1',sellerAccountId:'acct_seller',currency:'USD',totalCents:10000-credit,sellerTransferCents:9200,storeCreditCents:credit,createdAt:stamp(0),paymentIntentId:'pi_1',chargeId:'ch_1',paidAt:stamp(1)});
 return {...state,status:'transferred',financial:{kind:'transfer',requestId:'req1',amountCents:9200,destinationAccountId:'acct_seller',requestedAt:stamp(2),processorId:'tr_1',confirmedAt:stamp(3)}};
}
test('policy: a credit-funded order is no longer parked for manual settlement, and the net transfer may exceed the charge',()=>{
 const state=createCommerceState({orderId:'o1',buyerId:'b1',sellerId:'s1',sellerAccountId:'acct_seller',currency:'USD',totalCents:5000,sellerTransferCents:9200,storeCreditCents:5000,createdAt:stamp(0),paymentIntentId:'pi_1',chargeId:'ch_1',paidAt:stamp(1)});
 assert.notEqual(evaluateCommercePolicy(state,stamp(2)).reason,'store_credit_subsidy_settlement_required');
 assert.notEqual(evaluateCommercePolicy(state,stamp(2)).reason,'invalid_or_unknown_state');
});
test('policy: transfer_reversed returns a released order to refundable, only for the exact confirmed transfer',()=>{
 const event={...base,eventId:'rev1',occurredAt:stamp(10),type:'transfer_reversed' as const,requestId:'req1',processorId:'tr_1',paymentIntentId:'pi_1',currency:'USD' as const,amountCents:9200};
 const ok=applyCommerceEvent(transferred(),event,stamp(11));
 assert.equal(ok.accepted,true);assert.equal(ok.state.financial,null);assert.equal(ok.state.status,'refund_eligible');assert.equal(ok.decision.refundEligible,true);
 for(const change of [{processorId:'tr_other'},{amountCents:9999},{requestId:'other'}])assert.equal(applyCommerceEvent(transferred(),{...event,...change},stamp(11)).accepted,false);
 assert.equal(applyCommerceEvent(transferred(),{...event,source:'buyer' as never},stamp(11)).accepted,false,'Only the server may record a reversal');
 const disputed={...transferred(),dispute:'open' as const,disputeUpdatedAt:stamp(5)};
 assert.equal(applyCommerceEvent(disputed,event,stamp(11)).accepted,false,'Disputed money is handled through the dispute, not a reversal');
});
