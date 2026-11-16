// Forward-only tracking milestones and the eBay-style timeline model behind <OrderProgressBar/>.
import test from 'node:test';
import assert from 'node:assert/strict';
import {carrierUpdate,mergeTracking,type TrackingProgress} from '../lib/commerce-carrier';
import {orderTimeline} from '../lib/marketplace-order-progress';

const hook=(status:string,details:[string,string,string?][],est?:string)=>carrierUpdate({description:'tracker.updated',result:{object:'Tracker',id:'trk_qa',tracking_code:'9400111899223197428490',status,est_delivery_date:est,
 tracking_details:details.map(([s,at,message])=>({status:s,datetime:at,message:message||s,tracking_location:{city:'Saint Paul',state:'MN'}}))}})!;

test('EasyPost statuses map to milestones; each is set once from the carrier time',()=>{
 let t=mergeTracking(null,hook('pre_transit',[['pre_transit','2026-11-01T10:00:00Z']],'2026-11-05T00:00:00Z'));
 assert.equal(t.labelCreatedAt,'2026-11-01T10:00:00.000Z');assert.equal(t.rank,1);assert.equal(t.estDeliveryDate,'2026-11-05T00:00:00.000Z');
 t=mergeTracking(t,hook('in_transit',[['pre_transit','2026-11-01T10:00:00Z'],['in_transit','2026-11-02T08:00:00Z']]));
 t=mergeTracking(t,hook('out_for_delivery',[['out_for_delivery','2026-11-04T07:30:00Z']]));
 t=mergeTracking(t,hook('delivered',[['delivered','2026-11-04T15:12:00Z','Delivered, front door']]));
 assert.deepEqual([t.labelCreatedAt,t.shippedAt,t.outForDeliveryAt,t.deliveredAt],['2026-11-01T10:00:00.000Z','2026-11-02T08:00:00.000Z','2026-11-04T07:30:00.000Z','2026-11-04T15:12:00.000Z']);
 assert.equal(t.rank,4);assert.equal(t.checkpoints.length,4,'duplicate checkpoints are stored once');
});

test('late, repeated and out-of-order webhooks never move the bar backward or overwrite a time',()=>{
 let t:TrackingProgress=mergeTracking(null,hook('delivered',[['delivered','2026-11-04T15:12:00Z']]));
 const delivered=t.deliveredAt;
 t=mergeTracking(t,hook('in_transit',[['in_transit','2026-11-02T08:00:00Z']]));
 assert.equal(t.rank,4,'a late in_transit after delivery keeps Delivered');assert.equal(t.deliveredAt,delivered);
 assert.equal(t.shippedAt,'2026-11-02T08:00:00.000Z','the late event still fills its own empty step');
 t=mergeTracking(t,hook('delivered',[['delivered','2026-11-09T09:00:00Z']]));
 assert.equal(t.deliveredAt,delivered,'a repeated delivered event never changes the delivery time');
 const same=mergeTracking(t,hook('delivered',[['delivered','2026-11-04T15:12:00Z']]));
 assert.deepEqual(same,t,'an exact duplicate webhook changes nothing');
});

test('exceptions: amber for a failed attempt, red for return to sender; progress or delivery clears them',()=>{
 let t=mergeTracking(null,hook('in_transit',[['in_transit','2026-11-02T08:00:00Z']]));
 t=mergeTracking(t,hook('failure',[['failure','2026-11-03T12:00:00Z','Delivery attempted, no access']]));
 assert.equal(t.exception?.kind,'failed_attempt');
 let model=orderTimeline({status:'in_transit',paidAt:'2026-11-01T00:00:00Z',tracking:null,fulfillment:'shipping',timeline:{paidAt:'2026-11-01T00:00:00Z',labelCreatedAt:null,shippedAt:t.shippedAt,outForDeliveryAt:null,deliveredAt:null,readyForPickupAt:null,pickedUpAt:null,estDeliveryDate:null,exception:t.exception,checkpoints:t.checkpoints}});
 assert.equal(model.alert?.tone,'amber');assert.match(model.alert!.message,/no access/);
 t=mergeTracking(t,hook('out_for_delivery',[['out_for_delivery','2026-11-04T07:00:00Z']]));
 assert.equal(t.exception,null,'later progress clears the exception');
 const r=mergeTracking(null,hook('return_to_sender',[['return_to_sender','2026-11-05T07:00:00Z','Returned to sender']]));
 model=orderTimeline({status:'in_transit',paidAt:'2026-11-01T00:00:00Z',tracking:null,fulfillment:'shipping',timeline:{paidAt:'2026-11-01T00:00:00Z',labelCreatedAt:null,shippedAt:null,outForDeliveryAt:null,deliveredAt:null,readyForPickupAt:null,pickedUpAt:null,estDeliveryDate:null,exception:r.exception,checkpoints:[]}});
 assert.equal(model.alert?.tone,'red');
});

test('timeline: 5 shipping steps with dates; 3 pickup steps with the PIN expiry warning inside 24h',()=>{
 const ship=orderTimeline({status:'in_transit',paidAt:'2026-11-01T00:00:00Z',tracking:null,fulfillment:'shipping',timeline:{paidAt:'2026-11-01T00:00:00Z',labelCreatedAt:'2026-11-01T02:00:00Z',shippedAt:'2026-11-02T00:00:00Z',outForDeliveryAt:null,deliveredAt:null,readyForPickupAt:null,pickedUpAt:null,estDeliveryDate:'2026-11-05T00:00:00Z',exception:null,checkpoints:[]}},Date.parse('2026-11-03T00:00:00Z'));
 assert.deepEqual(ship.steps.map(s=>s.label),['Paid','Label created','Shipped','Out for delivery','Delivered']);
 assert.deepEqual(ship.steps.map(s=>s.state),['done','done','done','current','upcoming']);assert.equal(ship.estDeliveryDate,'2026-11-05T00:00:00Z');
 const late=orderTimeline({status:'in_transit',paidAt:'2026-11-01T00:00:00Z',tracking:null,fulfillment:'shipping',timeline:{paidAt:'2026-11-01T00:00:00Z',labelCreatedAt:null,shippedAt:'2026-11-02T00:00:00Z',outForDeliveryAt:null,deliveredAt:null,readyForPickupAt:null,pickedUpAt:null,estDeliveryDate:'2026-11-05T00:00:00Z',exception:null,checkpoints:[]}},Date.parse('2026-11-08T00:00:00Z'));
 assert.equal(late.alert?.title,'Running late');
 const pickup=orderTimeline({status:'awaiting_pickup',paidAt:'2026-11-01T00:00:00Z',tracking:null,fulfillment:'pickup',pickupCodeExpiresAt:'2026-11-08T00:00:00Z',timeline:{paidAt:'2026-11-01T00:00:00Z',labelCreatedAt:null,shippedAt:null,outForDeliveryAt:null,deliveredAt:null,readyForPickupAt:'2026-11-01T00:00:00Z',pickedUpAt:null,estDeliveryDate:null,exception:null,checkpoints:[]}},Date.parse('2026-11-07T06:00:00Z'));
 assert.deepEqual(pickup.steps.map(s=>s.label),['Paid','Ready for pickup','Picked up']);assert.equal(pickup.reached,1);assert.equal(pickup.pinExpiringSoon,true);
 const early=orderTimeline({status:'awaiting_pickup',paidAt:'2026-11-01T00:00:00Z',tracking:null,fulfillment:'pickup',pickupCodeExpiresAt:'2026-11-08T00:00:00Z',timeline:null},Date.parse('2026-11-02T00:00:00Z'));
 assert.equal(early.pinExpiringSoon,false);
});
