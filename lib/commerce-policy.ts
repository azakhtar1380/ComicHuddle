/** Pure server policy. Adapters must authenticate evidence and persist decisions with a version CAS. */
export const commercePolicyVersion='2026-10-09-protection-draft-1';
const hour=3600000;
export type CommerceStatus='awaiting_payment'|'awaiting_shipment'|'in_transit'|'delivered_review'|'release_eligible'|'refund_eligible'|'refund_pending'|'refunded'|'transfer_pending'|'transferred'|'manual_review';
export type CommercePolicy={version:string;trackingHours:48;carrierHours:72;reviewHours:number;highValue:boolean;highValueConfigured:boolean;requiresSignature:boolean};
export const standardCommercePolicy:CommercePolicy=Object.freeze({version:commercePolicyVersion,trackingHours:48,carrierHours:72,reviewHours:48,highValue:false,highValueConfigured:false,requiresSignature:false});
export type CommerceOrder={orderId:string;buyerId:string;sellerId:string;sellerAccountId:string|null;currency:'USD';totalCents:number;sellerTransferCents:number;createdAt:string;paymentIntentId:string|null;chargeId:string|null;paidAt:string|null};
type RefundReason='tracking_deadline'|'carrier_deadline'|'operator_refund';
type FinancialOperation={kind:'refund'|'transfer';requestId:string;amountCents:number;destinationAccountId:string|null;requestedAt:string;processorId:string|null;confirmedAt:string|null};
export type CommerceState={
 order:CommerceOrder;policy:CommercePolicy;version:number;status:CommerceStatus;
 shipment:{carrier:string|null;trackingNumber:string|null;submittedAt:string|null;validatedAt:string|null;acceptedAt:string|null;deliveredAt:string|null;signatureVerified:boolean};
 issue:{reason:string;openedAt:string;open:boolean}|null;dispute:'none'|'open'|'won'|'lost';disputeUpdatedAt:string|null;holdReason:string|null;refundReason:RefundReason|null;
 financial:FinancialOperation|null;recentEvents:{id:string;fingerprint:string}[];
};
export type CommerceDecision={state:CommerceState;status:CommerceStatus;refundEligible:boolean;transferEligible:boolean;reason:string;trackingDeadlineAt:string|null;carrierDeadlineAt:string|null;releaseAt:string|null};
type EventBase={eventId:string;orderId:string;buyerId:string;sellerId:string;occurredAt:string;source:'stripe'|'carrier'|'buyer'|'operator'|'server';verified:true};
type MoneyEvent={paymentIntentId:string;currency:'USD';amountCents:number};
type ShipmentEvent={carrier:string;trackingNumber:string};
export type CommerceEvent=EventBase&(
 | ({type:'payment_confirmed';chargeId:string|null}&MoneyEvent)
 | ({type:'tracking_confirmed';submittedAt:string}&ShipmentEvent)
 | ({type:'label_created'|'carrier_accepted'}&ShipmentEvent)
 | ({type:'delivered';signatureVerified:boolean}&ShipmentEvent)
 | ({type:'shipment_exception';reason:string}&ShipmentEvent)
 | {type:'buyer_issue'|'buyer_return_requested';actorId:string;reason:string}
 | ({type:'dispute_opened'|'dispute_closed';outcome?:'won'|'lost'}&MoneyEvent)
 | {type:'issue_resolved';resolution:'release'|'refund'}
 | ({type:'refund_requested'|'transfer_requested';requestId:string;destinationAccountId?:string}&MoneyEvent)
 | ({type:'refund_confirmed'|'transfer_confirmed';requestId:string;processorId:string;destinationAccountId?:string}&MoneyEvent)
 | ({type:'processor_unknown';reason:string}&MoneyEvent)
);
export type CommerceTransition={state:CommerceState;accepted:boolean;duplicate:boolean;error?:string;decision:CommerceDecision};

const nonempty=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0&&value.length<=200;
const time=(value:unknown)=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))return NaN;const stamp=Date.parse(value);return Number.isFinite(stamp)&&new Date(stamp).toISOString()===value?stamp:NaN};
const cents=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=100000000;
const iso=(stamp:number)=>new Date(stamp).toISOString();
function copy(state:CommerceState):CommerceState{return {...state,order:{...state.order},policy:{...state.policy},shipment:{...state.shipment},issue:state.issue?{...state.issue}:null,financial:state.financial?{...state.financial}:null,recentEvents:state.recentEvents.map(row=>({...row}))}}
function validPolicy(policy:CommercePolicy){return policy&&policy.version===commercePolicyVersion&&policy.trackingHours===48&&policy.carrierHours===72&&Number.isInteger(policy.reviewHours)&&policy.reviewHours>=48&&policy.reviewHours<=336&&typeof policy.highValue==='boolean'&&typeof policy.highValueConfigured==='boolean'&&typeof policy.requiresSignature==='boolean'}
function validOrder(order:CommerceOrder){return order&&[order.orderId,order.buyerId,order.sellerId].every(nonempty)&&order.buyerId!==order.sellerId&&(order.sellerAccountId===null||nonempty(order.sellerAccountId))&&order.currency==='USD'&&cents(order.totalCents)&&order.totalCents>0&&cents(order.sellerTransferCents)&&order.sellerTransferCents<=order.totalCents&&Number.isFinite(time(order.createdAt))&&(order.paymentIntentId===null||nonempty(order.paymentIntentId))&&(order.chargeId===null||nonempty(order.chargeId))&&(order.paidAt===null||Number.isFinite(time(order.paidAt))&&!!order.paymentIntentId&&time(order.paidAt)>=time(order.createdAt))}
function validState(state:CommerceState){
 if(!state||!validOrder(state.order)||!validPolicy(state.policy)||!Number.isSafeInteger(state.version)||state.version<0||!state.shipment||!Array.isArray(state.recentEvents)||state.recentEvents.length>64)return false;
 if(!['awaiting_payment','awaiting_shipment','in_transit','delivered_review','release_eligible','refund_eligible','refund_pending','refunded','transfer_pending','transferred','manual_review'].includes(state.status)||!['none','open','won','lost'].includes(state.dispute))return false;
 if(state.disputeUpdatedAt!==null&&!Number.isFinite(time(state.disputeUpdatedAt))||state.dispute!=='none'&&!state.disputeUpdatedAt)return false;
 if(![null,'tracking_deadline','carrier_deadline','operator_refund'].includes(state.refundReason)||state.holdReason!==null&&!nonempty(state.holdReason))return false;
 const shipment=state.shipment;
 if(typeof shipment.signatureVerified!=='boolean'||[shipment.carrier,shipment.trackingNumber].some(value=>value!==null&&!nonempty(value))||[shipment.submittedAt,shipment.validatedAt,shipment.acceptedAt,shipment.deliveredAt].some(value=>value!==null&&!Number.isFinite(time(value))))return false;
 if(shipment.validatedAt&&(!state.order.paidAt||!shipment.carrier||!shipment.trackingNumber||!shipment.submittedAt||time(shipment.submittedAt)<time(state.order.paidAt)||time(shipment.validatedAt)<time(shipment.submittedAt))||shipment.acceptedAt&&(!shipment.validatedAt||time(shipment.acceptedAt)<time(shipment.submittedAt))||shipment.deliveredAt&&(!shipment.acceptedAt||time(shipment.deliveredAt)<time(shipment.acceptedAt)))return false;
 if(state.issue&&(!nonempty(state.issue.reason)||!Number.isFinite(time(state.issue.openedAt))||typeof state.issue.open!=='boolean'))return false;
 if(state.financial){const operation=state.financial;if(!['refund','transfer'].includes(operation.kind)||!nonempty(operation.requestId)||!cents(operation.amountCents)||!Number.isFinite(time(operation.requestedAt))||(operation.processorId===null)!==(operation.confirmedAt===null)||operation.processorId!==null&&!nonempty(operation.processorId)||operation.confirmedAt!==null&&!Number.isFinite(time(operation.confirmedAt)))return false;
  if(operation.kind==='refund'&&(operation.amountCents!==state.order.totalCents||operation.destinationAccountId!==null)||operation.kind==='transfer'&&(operation.amountCents!==state.order.sellerTransferCents||!state.order.sellerAccountId||operation.destinationAccountId!==state.order.sellerAccountId)||!state.order.paidAt||time(operation.requestedAt)<time(state.order.paidAt)||operation.confirmedAt&&time(operation.confirmedAt)<time(operation.requestedAt))return false;
  if(state.status!==(operation.confirmedAt?(operation.kind==='refund'?'refunded':'transferred'):(operation.kind==='refund'?'refund_pending':'transfer_pending')))return false;
 }
 else if(['refund_pending','refunded','transfer_pending','transferred'].includes(state.status))return false;
 if(state.recentEvents.some(row=>!nonempty(row.id)||typeof row.fingerprint!=='string'))return false;
 return true;
}
/** Construct only from a server-owned order snapshot, never from a browser's paid/status claims. */
export function createCommerceState(order:CommerceOrder,policy:CommercePolicy=standardCommercePolicy):CommerceState{
 if(!validOrder(order)||!validPolicy(policy))throw new Error('Invalid commerce order or policy.');
 return {order:{...order},policy:{...policy},version:0,status:order.paidAt?'awaiting_shipment':'awaiting_payment',shipment:{carrier:null,trackingNumber:null,submittedAt:null,validatedAt:null,acceptedAt:null,deliveredAt:null,signatureVerified:false},issue:null,dispute:'none',disputeUpdatedAt:null,holdReason:null,refundReason:null,financial:null,recentEvents:[]};
}
function decide(state:CommerceState,stamp:number):Omit<CommerceDecision,'state'>{
 const order=state.order,paid=time(order.paidAt),trackingDeadlineAt=Number.isFinite(paid)?iso(paid+48*hour):null,carrierDeadlineAt=Number.isFinite(paid)?iso(paid+72*hour):null;
 const delivered=time(state.shipment.deliveredAt),releaseAt=Number.isFinite(delivered)?iso(delivered+state.policy.reviewHours*hour):null;
 const base={refundEligible:false,transferEligible:false,trackingDeadlineAt,carrierDeadlineAt,releaseAt};
 if(state.financial){const operation=state.financial;
  if(operation.confirmedAt)return {...base,status:operation.kind==='refund'?'refunded':'transferred',reason:state.holdReason||(state.issue?.open||state.dispute==='open'||state.dispute==='lost'?'terminal_issue_requires_manual_recovery':'financial_operation_completed')};
  return {...base,status:operation.kind==='refund'?'refund_pending':'transfer_pending',reason:state.holdReason||(state.issue?.open||state.dispute==='open'?'financial_operation_in_flight_with_issue':'financial_operation_pending')};
 }
 if(!order.paidAt)return {...base,status:'awaiting_payment',reason:'confirmed_payment_required'};
 if(state.dispute==='open'||state.dispute==='lost')return {...base,status:'manual_review',reason:state.dispute==='open'?'payment_disputed':'dispute_lost_requires_reconciliation'};
 if(state.issue?.open)return {...base,status:'manual_review',reason:'buyer_issue_open'};
 if(state.holdReason)return {...base,status:'manual_review',reason:state.holdReason};
 if(state.policy.highValue&&(!state.policy.highValueConfigured||!state.policy.requiresSignature||state.policy.reviewHours<=48))return {...base,status:'manual_review',reason:'high_value_policy_not_configured'};
 if(state.refundReason)return {...base,status:'refund_eligible',refundEligible:true,reason:state.refundReason};
 if(!state.shipment.acceptedAt)return {...base,status:'awaiting_shipment',reason:state.shipment.validatedAt?'carrier_acceptance_required':'valid_tracking_required'};
 if(!state.shipment.deliveredAt)return {...base,status:'in_transit',reason:'confirmed_delivery_required'};
 if(state.policy.requiresSignature&&!state.shipment.signatureVerified)return {...base,status:'manual_review',reason:'delivery_signature_required'};
 if(stamp<time(releaseAt))return {...base,status:'delivered_review',reason:'buyer_review_window_open'};
 if(!order.sellerAccountId||!order.chargeId||order.sellerTransferCents<=0)return {...base,status:'manual_review',reason:'seller_transfer_configuration_required'};
 return {...base,status:'release_eligible',transferEligible:true,reason:'delivery_review_completed'};
}
/** Exact deadline equality is late. Once persisted, a missed deadline cannot be rescued by later evidence. */
export function evaluateCommercePolicy(input:CommerceState,nowISO:string):CommerceDecision{
 const stamp=time(nowISO);
 if(!validState(input)||!Number.isFinite(stamp)||stamp<time(input.order.createdAt)||input.order.paidAt&&stamp<time(input.order.paidAt))return {state:input,status:'manual_review',refundEligible:false,transferEligible:false,reason:'invalid_or_unknown_state',trackingDeadlineAt:null,carrierDeadlineAt:null,releaseAt:null};
 const state=copy(input),paid=time(state.order.paidAt);
 if(Number.isFinite(paid)&&!state.refundReason&&!state.financial){
  if(stamp>=paid+48*hour&&(!state.shipment.validatedAt||time(state.shipment.submittedAt)>=paid+48*hour||time(state.shipment.validatedAt)>=paid+48*hour))state.refundReason='tracking_deadline';
  else if(stamp>=paid+72*hour&&(!state.shipment.acceptedAt||time(state.shipment.acceptedAt)>=paid+72*hour))state.refundReason='carrier_deadline';
 }
 const decision=decide(state,stamp);state.status=decision.status;
 if(state.status!==input.status||state.refundReason!==input.refundReason)state.version++;
 return {state,...decision};
}
function fingerprint(event:CommerceEvent){return JSON.stringify(Object.fromEntries(Object.entries(event).sort(([a],[b])=>a.localeCompare(b))))}
function sourceFor(event:CommerceEvent){
 if(['payment_confirmed','refund_confirmed','transfer_confirmed','dispute_opened','dispute_closed','processor_unknown'].includes(event.type))return event.source==='stripe';
 if(['carrier_accepted','delivered','shipment_exception','label_created'].includes(event.type))return event.source==='carrier';
 if(event.type==='tracking_confirmed')return event.source==='carrier'||event.source==='server';
 if(['buyer_issue','buyer_return_requested'].includes(event.type))return event.source==='buyer';
 if(event.type==='issue_resolved')return event.source==='operator';
 if(['refund_requested','transfer_requested'].includes(event.type))return event.source==='server';
 return false;
}
/** verified means the trusted adapter verified signature/ownership; it is never accepted from public JSON. */
export function applyCommerceEvent(input:CommerceState,event:CommerceEvent,nowISO:string):CommerceTransition{
 const initial=evaluateCommercePolicy(input,nowISO);
 const reject=(error:string,state:CommerceState=input):CommerceTransition=>{const decision=evaluateCommercePolicy(state,nowISO);return {state,accepted:false,duplicate:false,error,decision:{...decision,refundEligible:false,transferEligible:false,reason:error}}};
 if(initial.reason==='invalid_or_unknown_state')return reject('invalid_or_unknown_state');
 if(!event||typeof event!=='object'||event.verified!==true||!nonempty(event.eventId)||!sourceFor(event)||event.orderId!==input.order.orderId||event.buyerId!==input.order.buyerId||event.sellerId!==input.order.sellerId||!Number.isFinite(time(event.occurredAt))||time(event.occurredAt)>time(nowISO)||time(event.occurredAt)<time(input.order.createdAt))return reject('untrusted_or_unmatched_event');
 if(input.order.paidAt&&!['payment_confirmed','label_created','buyer_issue','buyer_return_requested'].includes(event.type)&&time(event.occurredAt)<time(input.order.paidAt))return reject('event_precedes_confirmed_payment');
 const encoded=fingerprint(event),prior=input.recentEvents.find(receipt=>receipt.id===event.eventId);
 if(prior){if(prior.fingerprint!==encoded)return reject('event_id_payload_mismatch');return {state:initial.state,accepted:true,duplicate:true,decision:initial}}
 let state=copy(initial.state),semanticDuplicate=false;
 const order=state.order,shipment=state.shipment;
 const matchedMoney=(money:MoneyEvent)=>money.paymentIntentId===order.paymentIntentId&&money.currency===order.currency&&money.amountCents===order.totalCents;
 const matchedShipment=(candidate:ShipmentEvent)=>nonempty(candidate.carrier)&&nonempty(candidate.trackingNumber)&&candidate.carrier===shipment.carrier&&candidate.trackingNumber===shipment.trackingNumber;
 switch(event.type){
  case 'payment_confirmed':
   if(!nonempty(event.paymentIntentId)||event.currency!==order.currency||event.amountCents!==order.totalCents||event.chargeId!==null&&!nonempty(event.chargeId)||order.paymentIntentId&&order.paymentIntentId!==event.paymentIntentId||order.chargeId&&order.chargeId!==event.chargeId)return reject('payment_identity_or_amount_mismatch');
   if(order.paidAt){order.chargeId=order.chargeId||event.chargeId;semanticDuplicate=true;break}
   order.paymentIntentId=event.paymentIntentId;order.chargeId=event.chargeId;order.paidAt=event.occurredAt;break;
  case 'label_created':
   if(!nonempty(event.carrier)||!nonempty(event.trackingNumber))return reject('invalid_tracking');
   // A label is not valid tracking submission or proof of physical handoff.
   break;
  case 'tracking_confirmed':
   if(!order.paidAt||!nonempty(event.carrier)||!nonempty(event.trackingNumber)||!Number.isFinite(time(event.submittedAt))||time(event.submittedAt)<time(order.paidAt)||time(event.submittedAt)>time(event.occurredAt))return reject('invalid_tracking_submission');
   if(shipment.trackingNumber&&(!matchedShipment(event)||shipment.submittedAt!==event.submittedAt))return reject('shipment_identity_locked');
   shipment.carrier=event.carrier;shipment.trackingNumber=event.trackingNumber;shipment.submittedAt=event.submittedAt;shipment.validatedAt=shipment.validatedAt||event.occurredAt;break;
  case 'carrier_accepted':
   if(!order.paidAt||!shipment.validatedAt||!matchedShipment(event)||time(event.occurredAt)<time(shipment.submittedAt))return reject('carrier_handoff_unmatched');
   if(time(event.occurredAt)>=time(order.paidAt)+72*hour)state.refundReason=state.refundReason||'carrier_deadline';
   shipment.acceptedAt=shipment.acceptedAt||event.occurredAt;break;
  case 'delivered':
   if(!order.paidAt||!shipment.acceptedAt||!matchedShipment(event)||time(event.occurredAt)<time(shipment.acceptedAt)||typeof event.signatureVerified!=='boolean')return reject('delivery_unmatched');
   if(shipment.deliveredAt&&shipment.deliveredAt!==event.occurredAt)return reject('delivery_timestamp_locked');
   shipment.deliveredAt=shipment.deliveredAt||event.occurredAt;shipment.signatureVerified=shipment.signatureVerified||event.signatureVerified;break;
  case 'shipment_exception':
   if(!matchedShipment(event)||!nonempty(event.reason))return reject('shipment_exception_unmatched');
   state.holdReason='carrier_exception_requires_review';break;
  case 'buyer_issue':case 'buyer_return_requested':
   if(event.actorId!==order.buyerId||!nonempty(event.reason))return reject('buyer_issue_unmatched');
   state.issue={reason:event.reason,openedAt:event.occurredAt,open:true};break;
  case 'issue_resolved':
   if(!state.issue?.open||!['release','refund'].includes(event.resolution)||time(event.occurredAt)<time(state.issue.openedAt))return reject('issue_resolution_unmatched');
   state.issue.open=false;if(event.resolution==='refund')state.refundReason=state.refundReason||'operator_refund';break;
  case 'dispute_opened':case 'dispute_closed':
   if(!order.paidAt||!matchedMoney(event)||event.type==='dispute_closed'&&!['won','lost'].includes(event.outcome||''))return reject('payment_dispute_unmatched');
   if(state.disputeUpdatedAt&&time(event.occurredAt)<time(state.disputeUpdatedAt)){semanticDuplicate=true;break}
   if(event.type==='dispute_closed')state.dispute=event.outcome!;else if(state.dispute!=='lost')state.dispute='open';state.disputeUpdatedAt=event.occurredAt;break;
  case 'processor_unknown':
   if(!order.paidAt||!matchedMoney(event))return reject('processor_event_unmatched');
   state.holdReason='unknown_processor_state_requires_reconciliation';break;
  case 'refund_requested':case 'transfer_requested':{
   const kind=event.type==='refund_requested'?'refund':'transfer',amount=kind==='refund'?order.totalCents:order.sellerTransferCents,destination=kind==='refund'?null:order.sellerAccountId;
   if(!order.paidAt||event.paymentIntentId!==order.paymentIntentId||event.currency!==order.currency||event.amountCents!==amount||!nonempty(event.requestId)||kind==='transfer'&&event.destinationAccountId!==destination)return reject('financial_request_unmatched');
   if(state.financial){if(state.financial.kind===kind&&state.financial.requestId===event.requestId&&state.financial.amountCents===amount){semanticDuplicate=true;break}return reject('financial_operation_already_reserved')}
   if(kind==='refund'&&!initial.refundEligible||kind==='transfer'&&!initial.transferEligible)return reject('financial_operation_not_eligible');
   state.financial={kind,requestId:event.requestId,amountCents:amount,destinationAccountId:destination,requestedAt:event.occurredAt,processorId:null,confirmedAt:null};state.status=kind==='refund'?'refund_pending':'transfer_pending';break;
  }
  case 'refund_confirmed':case 'transfer_confirmed':{
   const kind=event.type==='refund_confirmed'?'refund':'transfer',operation=state.financial;
   if(!order.paidAt||event.paymentIntentId!==order.paymentIntentId||event.currency!==order.currency||!nonempty(event.requestId)||!nonempty(event.processorId))return reject('financial_confirmation_unmatched');
   if(!operation||operation.kind!==kind||operation.requestId!==event.requestId||operation.amountCents!==event.amountCents||kind==='transfer'&&event.destinationAccountId!==operation.destinationAccountId||time(event.occurredAt)<time(operation.requestedAt)){
    state.holdReason='unmatched_financial_confirmation_requires_reconciliation';break;
   }
   if(operation.processorId&&operation.processorId!==event.processorId){state.holdReason='conflicting_processor_objects_require_reconciliation';break}
   if(operation.confirmedAt){semanticDuplicate=true;break}
   operation.processorId=event.processorId;operation.confirmedAt=event.occurredAt;state.status=kind==='refund'?'refunded':'transferred';break;
  }
  default:return reject('unsupported_event');
 }
 state.recentEvents=[...state.recentEvents,{id:event.eventId,fingerprint:encoded}].slice(-64);state.version=Math.max(input.version,initial.state.version)+1;
 const decision=evaluateCommercePolicy(state,nowISO);state=decision.state;
 // One accepted event is one CAS transition, including its time-derived changes.
 state.version=input.version+1;
 return {state,accepted:true,duplicate:semanticDuplicate,decision};
}
