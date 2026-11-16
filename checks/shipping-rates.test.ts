// Calculated shipping: package sizing, EasyPost rate parsing (mocked), filtering and the buyer's choice.
import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseShippingOption,parcelFor,quoteShippingRates,ShippingQuoteError} from '../lib/shipping-rates';

const env={EASYPOST_API_KEY:'EZTK_test_key_for_checks'};
const rates=[
 {carrier:'USPS',service:'Priority',rate:'13.57',delivery_days:2},
 {carrier:'USPS',service:'GroundAdvantage',rate:'7.05',delivery_days:4},
 {carrier:'USPS',service:'MediaMail',rate:'4.10',delivery_days:8},
 {carrier:'FedExDefault',service:'FIRST_OVERNIGHT',rate:'188.56',delivery_days:1},
 {carrier:'FedExDefault',service:'FEDEX_GROUND',rate:'16.69',delivery_days:4},
 {carrier:'Mystery',service:'Teleport',rate:'1.00',delivery_days:0},
];
function mock(body:unknown,status=201){const calls:{url:string;body:Record<string,unknown>}[]=[];return {calls,fetcher:async(url:string,init:RequestInit)=>{calls.push({url,body:JSON.parse(String(init.body))});return new Response(JSON.stringify(body),{status})}}}

test('package is sized to what is sold',()=>{
 assert.equal(parcelFor({kind:'single',itemCount:1}).label,'Comic in a rigid mailer');
 assert.equal(parcelFor({kind:'single',itemCount:1,cert:'1234567001'}).label,'Graded slab in a box');
 const box=parcelFor({kind:'collection',itemCount:30});assert.equal(box.label,'30 comics in a box');assert.equal(box.weightOz,16+30*6);
 assert.ok(parcelFor({kind:'collection',itemCount:500}).weightOz<=1120,'capped at 70 lb');
 assert.deepEqual(parcelFor({kind:'single',itemCount:1,weightOz:20,lengthIn:14,widthIn:11,heightIn:3}),{length:14,width:11,height:3,weightOz:20,label:'Your package'},'the seller’s full package wins');
 assert.equal(parcelFor({kind:'single',itemCount:1,weightOz:30}).weightOz,30,'a weight alone overrides the estimate');
});

test('live rates: cheapest first, Media Mail, premium overnight and unknown carriers hidden, ZIPs sent',async()=>{
 const {calls,fetcher}=mock({rates});
 const options=await quoteShippingRates(env,'55401','90210-1234',parcelFor({kind:'single',itemCount:1}),fetcher as never);
 assert.deepEqual(options.map(o=>o.id),['USPS:GroundAdvantage','USPS:Priority','FedEx:FEDEX_GROUND']);
 assert.equal(options[0].cents,705);assert.equal(options[0].service,'Ground Advantage');assert.equal(options[0].days,4);
 const shipment=calls[0].body.shipment as {from_address:{zip:string};to_address:{zip:string}};
 assert.equal(shipment.from_address.zip,'55401');assert.equal(shipment.to_address.zip,'90210');
 // Same route and package: served from the short cache, no second carrier call.
 await quoteShippingRates(env,'55401','90210',parcelFor({kind:'single',itemCount:1}),fetcher as never);assert.equal(calls.length,1);
});

test('the buyer picks among quoted services; anything else falls back to the cheapest',async()=>{
 const {fetcher}=mock({rates});
 const options=await quoteShippingRates(env,'10001','60601',parcelFor({kind:'single',itemCount:1}),fetcher as never);
 assert.equal(chooseShippingOption(options,'USPS:Priority').cents,1357);
 assert.equal(chooseShippingOption(options,'made-up:9999').cents,705,'a client cannot invent a price');
 assert.equal(chooseShippingOption(options,undefined).id,'USPS:GroundAdvantage');
});

test('no guessing: bad ZIPs, no carrier key and carrier failures all refuse',async()=>{
 const parcel=parcelFor({kind:'single',itemCount:1});
 await assert.rejects(quoteShippingRates(env,'5540','90210',parcel,mock({rates}).fetcher as never),ShippingQuoteError);
 await assert.rejects(quoteShippingRates({},'55401','90210',parcel),ShippingQuoteError);
 await assert.rejects(quoteShippingRates(env,'55402','90211',parcel,mock({error:{message:'bad'}},422).fetcher as never),ShippingQuoteError);
 await assert.rejects(quoteShippingRates(env,'55403','90212',parcel,mock({rates:[]}).fetcher as never),ShippingQuoteError);
});
