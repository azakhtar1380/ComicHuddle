/** Pure server policy. Adapters must authenticate evidence and persist decisions with a version CAS. */
export const commercePolicyVersion='2026-10-09-protection-draft-1';
const hour=3600000;
export const commerceStatuses=['awaiting_payment','awaiting_shipment','in_transit','delivered_review','release_eligible','refund_eligible','refund_pending','refunded','transfer_pending','transferred','manual_review','awaiting_pickup','picked_up','shipped_to_inspection','at_inspection','inspection_passed','inspection_failed','shipped_to_buyer'] as const;
export type CommerceStatus=typeof commerceStatuses[number];
export type ProtectionTier='standard'|'safepurchase';
/**
 * Legacy orders have no `tier` and keep the original 48h tracking / 72h carrier deadlines.
 * Tiered orders snapshot their protection terms at checkout; later config never changes them.
 */
export type CommercePolicy={version:string;trackingHours:48;carrierHours:72;reviewHours:number;highValue:boolean;highValueConfigured:boolean;requiresSignature:boolean;tier?:ProtectionTier;handlingBusinessDays?:number;claimDays?:number;insured?:boolean};
export const standardCommercePolicy:CommercePolicy=Object.freeze({version:commercePolicyVersion,trackingHours:48,carrierHours:72,reviewHours:48,highValue:false,highValueConfigured:false,requiresSignature:false});
export type Fulfillment='shipping'|'pickup';
export type CommerceOrder={orderId:string;buyerId:string;sellerId:string;sellerAccountId:string|null;currency:'USD';totalCents:number;sellerTransferCents:number;storeCreditCents?:number;createdAt:string;paymentIntentId:string|null;chargeId:string|null;paidAt:string|null;fulfillment?:Fulfillment};
type RefundReason='tracking_deadline'|'carrier_deadline'|'operator_refund'|'inspection_failed';
type FinancialOperation={kind:'refund'|'transfer';requestId:string;amountCents:number;destinationAccountId:string|null;requestedAt:string;processorId:string|null;confirmedAt:string|null};
export type PickupConfirmation={confirmedAt:string;by:'buyer'|'seller'|'operator'};
export type Inspection={inbound:{carrier:string;trackingNumber:string;submittedAt:string}|null;receivedAt:string|null;decidedAt:string|null;result:null|'passed'|'failed'|'partial';reasons:string[];failedItems:number;totalItems:number;buyerChoice:null|'accept_partial'|'full_refund';partialRefundCents:number};
export type CommerceState={
 order:CommerceOrder;policy:CommercePolicy;version:number;status:CommerceStatus;
 shipment:{carrier:string|null;trackingNumber:string|null;submittedAt:string|null;validatedAt:string|null;acceptedAt:string|null;deliveredAt:string|null;signatureVerified:boolean};
 issue:{reason:string;openedAt:string;open:boolean;kind?:'not_received'|'not_as_described'|'other'}|null;dispute:'none'|'open'|'won'|'lost';disputeUpdatedAt:string|null;holdReason:string|null;refundReason:RefundReason|null;
 financial:FinancialOperation|null;recentEvents:{id:string;fingerprint:string}[];
 pickup?:PickupConfirmation|null;inspection?:Inspection|null;
};
/** Adds weekdays (Mon–Fri, UTC) to a timestamp, keeping the time of day. */
export function addBusinessDays(stamp:number,days:number){let value=stamp,left=days;while(left>0){value+=24*hour;const day=new Date(value).getUTCDay();if(day!==0&&day!==6)left--}return value}
export function emptyInspection(totalItems:number):Inspection{return {inbound:null,receivedAt:null,decidedAt:null,result:null,reasons:[],failedItems:0,totalItems,buyerChoice:null,partialRefundCents:0}}
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
 // Server-verified reversal of a confirmed seller transfer (full refund after release).
 | ({type:'transfer_reversed';requestId:string;processorId:string;destinationAccountId?:string}&MoneyEvent)
 | ({type:'processor_unknown';reason:string}&MoneyEvent)
 // Seller-entered tracking accepted by the server (tiered orders). It is not carrier proof.
 | ({type:'tracking_submitted'}&ShipmentEvent)
 // Buyer tap, server-verified seller pickup code, or operator hand-off at the inspection center.
 | {type:'pickup_confirmed';actor:'buyer'|'seller'|'operator'}
 | ({type:'inspection_inbound';submittedAt:string}&ShipmentEvent)
 | {type:'inspection_received'}
 | {type:'inspection_decided';result:'passed'|'failed'|'partial';reasons:string[];failedItems:number;totalItems:number}
 | {type:'inspection_buyer_choice';choice:'accept_partial'|'full_refund';partialRefundCents:number}
 | ({type:'inspection_shipped'}&ShipmentEvent)
);
export type CommerceTransition={state:CommerceState;accepted:boolean;duplicate:boolean;error?:string;decision:CommerceDecision};

const nonempty=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0&&value.length<=200;
const time=(value:unknown)=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))return NaN;const stamp=Date.parse(value);return Number.isFinite(stamp)&&new Date(stamp).toISOString()===value?stamp:NaN};
const cents=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=100000000;
const iso=(stamp:number)=>new Date(stamp).toISOString();
function copy(state:CommerceState):CommerceState{return {...state,order:{...state.order},policy:{...state.policy},shipment:{...state.shipment},issue:state.issue?{...state.issue}:null,financial:state.financial?{...state.financial}:null,recentEvents:state.recentEvents.map(row=>({...row})),...(state.pickup!==undefined?{pickup:state.pickup?{...state.pickup}:null}:{}),...(state.inspection!==undefined?{inspection:state.inspection?{...state.inspection,inbound:state.inspection.inbound?{...state.inspection.inbound}:null,reasons:[...state.inspection.reasons]}:null}:{})}}
function validPolicy(policy:CommercePolicy){return policy&&policy.version===commercePolicyVersion&&policy.trackingHours===48&&policy.carrierHours===72&&Number.isInteger(policy.reviewHours)&&policy.reviewHours>=48&&policy.reviewHours<=336&&typeof policy.highValue==='boolean'&&typeof policy.highValueConfigured==='boolean'&&typeof policy.requiresSignature==='boolean'
 &&(policy.tier===undefined||policy.tier==='standard'||policy.tier==='safepurchase')&&(policy.handlingBusinessDays===undefined||Number.isInteger(policy.handlingBusinessDays)&&policy.handlingBusinessDays>=1&&policy.handlingBusinessDays<=10)&&(policy.claimDays===undefined||Number.isInteger(policy.claimDays)&&policy.claimDays>=1&&policy.claimDays<=90)&&(policy.insured===undefined||typeof policy.insured==='boolean')}
function validOrder(order:CommerceOrder){return order&&[order.orderId,order.buyerId,order.sellerId].every(nonempty)&&order.buyerId!==order.sellerId&&(order.sellerAccountId===null||nonempty(order.sellerAccountId))&&order.currency==='USD'&&cents(order.totalCents)&&order.totalCents>0&&cents(order.sellerTransferCents)&&cents(order.storeCreditCents??0)&&order.sellerTransferCents<=order.totalCents+(order.storeCreditCents??0)&&Number.isFinite(time(order.createdAt))&&(order.paymentIntentId===null||nonempty(order.paymentIntentId))&&(order.chargeId===null||nonempty(order.chargeId))&&(order.paidAt===null||Number.isFinite(time(order.paidAt))&&!!order.paymentIntentId&&time(order.paidAt)>=time(order.createdAt))&&(order.fulfillment===undefined||order.fulfillment==='shipping'||order.fulfillment==='pickup')}
const optionalTime=(value:unknown)=>value===null||Number.isFinite(time(value));
function validInspection(state:CommerceState){
 const value=state.inspection;if(value===undefined||value===null)return true;
 if(state.policy.tier!=='safepurchase'||!Array.isArray(value.reasons)||value.reasons.length>20||value.reasons.some(reason=>!nonempty(reason))||![value.receivedAt,value.decidedAt].every(optionalTime)||![null,'passed','failed','partial'].includes(value.result)||![null,'accept_partial','full_refund'].includes(value.buyerChoice)||!Number.isSafeInteger(value.failedItems)||!Number.isSafeInteger(value.totalItems)||value.totalItems<1||value.failedItems<0||value.failedItems>value.totalItems||!cents(value.partialRefundCents))return false;
 if(value.inbound&&(!nonempty(value.inbound.carrier)||!nonempty(value.inbound.trackingNumber)||!Number.isFinite(time(value.inbound.submittedAt))))return false;
 if(value.result&&(!value.receivedAt||!value.decidedAt)||value.buyerChoice&&value.result!=='partial')return false;
 return true;
}
function validState(state:CommerceState){
 if(!state||!validOrder(state.order)||!validPolicy(state.policy)||!Number.isSafeInteger(state.version)||state.version<0||!state.shipment||!Array.isArray(state.recentEvents)||state.recentEvents.length>64)return false;
 if(!(commerceStatuses as readonly string[]).includes(state.status)||!['none','open','won','lost'].includes(state.dispute))return false;
 if(state.disputeUpdatedAt!==null&&!Number.isFinite(time(state.disputeUpdatedAt))||state.dispute!=='none'&&!state.disputeUpdatedAt)return false;
 if(![null,'tracking_deadline','carrier_deadline','operator_refund','inspection_failed'].includes(state.refundReason)||state.holdReason!==null&&!nonempty(state.holdReason))return false;
 if(state.pickup&&(state.order.fulfillment!=='pickup'||!state.order.paidAt||!Number.isFinite(time(state.pickup.confirmedAt))||!['buyer','seller','operator'].includes(state.pickup.by)))return false;
 if(!validInspection(state))return false;
 const shipment=state.shipment,pickedUp=!!state.pickup;
 if(typeof shipment.signatureVerified!=='boolean'||[shipment.carrier,shipment.trackingNumber].some(value=>value!==null&&!nonempty(value))||[shipment.submittedAt,shipment.validatedAt,shipment.acceptedAt,shipment.deliveredAt].some(value=>value!==null&&!Number.isFinite(time(value))))return false;
 if(shipment.validatedAt&&(!state.order.paidAt||!shipment.carrier||!shipment.trackingNumber||!shipment.submittedAt||time(shipment.submittedAt)<time(state.order.paidAt)||time(shipment.validatedAt)<time(shipment.submittedAt))||shipment.acceptedAt&&!pickedUp&&(!shipment.validatedAt||time(shipment.acceptedAt)<time(shipment.submittedAt))||shipment.deliveredAt&&(!shipment.acceptedAt||time(shipment.deliveredAt)<time(shipment.acceptedAt)))return false;
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
/** Seller handling deadline: legacy 48h; SafePurchase 48h to record inbound tracking; Standard N business days; pickup none. */
function trackingDeadline(state:CommerceState,paid:number):number|null{
 if(!Number.isFinite(paid))return null;
 const policy=state.policy;if(policy.tier===undefined||policy.tier==='safepurchase')return paid+policy.trackingHours*hour;
 if(state.order.fulfillment==='pickup')return null;
 return addBusinessDays(paid,policy.handlingBusinessDays??3);
}
function trackingRecorded(state:CommerceState,deadline:number){
 if(state.policy.tier===undefined)return !!state.shipment.validatedAt&&time(state.shipment.submittedAt)<deadline&&time(state.shipment.validatedAt)<deadline;
 if(state.policy.tier==='safepurchase'){const inspection=state.inspection;return !!inspection?.receivedAt&&time(inspection.receivedAt)<deadline||!!inspection?.inbound&&time(inspection.inbound.submittedAt)<deadline}
 return !!state.shipment.submittedAt&&time(state.shipment.submittedAt)<deadline;
}
function fulfilmentStage(state:CommerceState):Omit<CommerceDecision,'state'|'refundEligible'|'transferEligible'|'trackingDeadlineAt'|'carrierDeadlineAt'|'releaseAt'>|null{
 const shipment=state.shipment,pickup=state.order.fulfillment==='pickup',inspection=state.inspection;
 if(state.policy.tier==='safepurchase'){
  if(inspection?.result==='partial'&&!inspection.buyerChoice)return {status:'inspection_failed',reason:'buyer_choice_required'};
  if(!inspection?.receivedAt)return inspection?.inbound?{status:'shipped_to_inspection',reason:'inspection_receipt_required'}:{status:'awaiting_shipment',reason:'inspection_shipment_required'};
  if(!inspection.result)return {status:'at_inspection',reason:'inspection_in_progress'};
  if(pickup)return state.pickup?null:{status:'inspection_passed',reason:'pickup_at_inspection_center'};
  if(!shipment.validatedAt)return {status:'inspection_passed',reason:'outbound_shipment_required'};
  if(!shipment.deliveredAt)return {status:'shipped_to_buyer',reason:'confirmed_delivery_required'};
  return null;
 }
 if(pickup)return state.pickup?null:{status:'awaiting_pickup',reason:'pickup_confirmation_required'};
 if(!shipment.acceptedAt)return {status:'awaiting_shipment',reason:shipment.validatedAt?'carrier_acceptance_required':shipment.submittedAt?'carrier_confirmation_pending':'valid_tracking_required'};
 if(!shipment.deliveredAt)return {status:'in_transit',reason:'confirmed_delivery_required'};
 return null;
}
function decide(state:CommerceState,stamp:number):Omit<CommerceDecision,'state'>{
 const order=state.order,paid=time(order.paidAt),trackingAt=trackingDeadline(state,paid),trackingDeadlineAt=trackingAt===null?null:iso(trackingAt),carrierDeadlineAt=Number.isFinite(paid)&&state.policy.tier===undefined?iso(paid+72*hour):null;
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
 const stage=state.policy.tier===undefined?(!state.shipment.acceptedAt?{status:'awaiting_shipment' as const,reason:state.shipment.validatedAt?'carrier_acceptance_required':'valid_tracking_required'}:!state.shipment.deliveredAt?{status:'in_transit' as const,reason:'confirmed_delivery_required'}:null):fulfilmentStage(state);
 if(stage)return {...base,...stage};
 if(state.policy.requiresSignature&&!state.shipment.signatureVerified)return {...base,status:'manual_review',reason:'delivery_signature_required'};
 if(stamp<time(releaseAt))return {...base,status:state.pickup?'picked_up':'delivered_review',reason:'buyer_review_window_open'};
 if(state.inspection?.buyerChoice==='accept_partial'&&state.inspection.partialRefundCents>0)return {...base,status:'manual_review',reason:'partial_refund_settlement_required'};
 // Store credit is a platform-funded discount: the release tops up the seller from the platform balance.
 if(!order.sellerAccountId||!order.chargeId||order.sellerTransferCents<=0)return {...base,status:'manual_review',reason:'seller_transfer_configuration_required'};
 return {...base,status:'release_eligible',transferEligible:true,reason:'delivery_review_completed'};
}
/** Exact deadline equality is late. Once persisted, a missed deadline cannot be rescued by later evidence. */
export function evaluateCommercePolicy(input:CommerceState,nowISO:string):CommerceDecision{
 const stamp=time(nowISO);
 if(!validState(input)||!Number.isFinite(stamp)||stamp<time(input.order.createdAt)||input.order.paidAt&&stamp<time(input.order.paidAt))return {state:input,status:'manual_review',refundEligible:false,transferEligible:false,reason:'invalid_or_unknown_state',trackingDeadlineAt:null,carrierDeadlineAt:null,releaseAt:null};
 const state=copy(input),paid=time(state.order.paidAt);
 if(Number.isFinite(paid)&&!state.refundReason&&!state.financial){
  const deadline=trackingDeadline(state,paid);
  if(deadline!==null&&stamp>=deadline&&!trackingRecorded(state,deadline))state.refundReason='tracking_deadline';
  else if(state.policy.tier===undefined&&stamp>=paid+72*hour&&(!state.shipment.acceptedAt||time(state.shipment.acceptedAt)>=paid+72*hour))state.refundReason='carrier_deadline';
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
 if(['refund_requested','transfer_requested','transfer_reversed','tracking_submitted','inspection_inbound'].includes(event.type))return event.source==='server';
 if(['inspection_received','inspection_decided','inspection_shipped'].includes(event.type))return event.source==='operator';
 if(event.type==='inspection_buyer_choice')return event.source==='buyer';
 // A seller can only confirm with the buyer's code, which the server verifies.
 if(event.type==='pickup_confirmed')return event.actor==='buyer'?event.source==='buyer':event.actor==='seller'?event.source==='server':event.actor==='operator'&&event.source==='operator';
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
   if(state.policy.tier===undefined&&time(event.occurredAt)>=time(order.paidAt)+72*hour)state.refundReason=state.refundReason||'carrier_deadline';
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
  case 'transfer_reversed':{
   const operation=state.financial;
   if(!order.paidAt||operation?.kind!=='transfer'||!operation.confirmedAt||operation.requestId!==event.requestId||operation.processorId!==event.processorId||event.paymentIntentId!==order.paymentIntentId||event.currency!==order.currency||event.amountCents!==order.sellerTransferCents||state.dispute==='open'||state.dispute==='lost')return reject('transfer_reversal_unmatched');
   // The seller's money is back with the platform; the order becomes refundable by the operator.
   state.financial=null;state.refundReason=state.refundReason||'operator_refund';state.status='refund_eligible';break;
  }
  case 'tracking_submitted':
   if(!order.paidAt||state.policy.tier!=='standard'||order.fulfillment==='pickup'||!nonempty(event.carrier)||!nonempty(event.trackingNumber))return reject('tracking_submission_not_applicable');
   if(shipment.trackingNumber){if(matchedShipment(event)){semanticDuplicate=true;break}return reject('shipment_identity_locked')}
   shipment.carrier=event.carrier;shipment.trackingNumber=event.trackingNumber;shipment.submittedAt=event.occurredAt;break;
  case 'pickup_confirmed':{
   if(!order.paidAt||order.fulfillment!=='pickup'||!['buyer','seller','operator'].includes(event.actor))return reject('pickup_not_applicable');
   if(state.pickup){semanticDuplicate=true;break}
   if(state.policy.tier==='safepurchase'){const inspection=state.inspection;if(event.actor==='seller'||!inspection?.result||inspection.result==='failed'||inspection.result==='partial'&&inspection.buyerChoice!=='accept_partial')return reject('pickup_requires_passed_inspection')}
   // An in-person hand-off confirmed by the buyer or the buyer's code is the pickup "signature".
   state.pickup={confirmedAt:event.occurredAt,by:event.actor};shipment.acceptedAt=event.occurredAt;shipment.deliveredAt=event.occurredAt;shipment.signatureVerified=true;break;
  }
  case 'inspection_inbound':
   if(!order.paidAt||state.policy.tier!=='safepurchase'||!nonempty(event.carrier)||!nonempty(event.trackingNumber)||!Number.isFinite(time(event.submittedAt))||time(event.submittedAt)<time(order.paidAt))return reject('inspection_inbound_not_applicable');
   state.inspection=state.inspection||emptyInspection(1);
   if(state.inspection.inbound){if(state.inspection.inbound.carrier===event.carrier&&state.inspection.inbound.trackingNumber===event.trackingNumber){semanticDuplicate=true;break}return reject('shipment_identity_locked')}
   state.inspection.inbound={carrier:event.carrier,trackingNumber:event.trackingNumber,submittedAt:event.submittedAt};break;
  case 'inspection_received':
   if(!order.paidAt||state.policy.tier!=='safepurchase')return reject('inspection_not_applicable');
   state.inspection=state.inspection||emptyInspection(1);
   if(state.inspection.receivedAt){semanticDuplicate=true;break}
   state.inspection.receivedAt=event.occurredAt;break;
  case 'inspection_decided':{
   const inspection=state.inspection;
   if(!inspection?.receivedAt||!['passed','failed','partial'].includes(event.result)||!Number.isSafeInteger(event.totalItems)||event.totalItems<1||!Number.isSafeInteger(event.failedItems)||!Array.isArray(event.reasons)||event.reasons.length>20||event.reasons.some(reason=>!nonempty(reason)))return reject('inspection_decision_invalid');
   if(event.result==='passed'&&event.failedItems!==0||event.result==='failed'&&(event.failedItems<1||!event.reasons.length)||event.result==='partial'&&(event.totalItems<2||event.failedItems<1||event.failedItems>=event.totalItems||!event.reasons.length))return reject('inspection_decision_invalid');
   if(inspection.result){if(inspection.result===event.result){semanticDuplicate=true;break}return reject('inspection_already_decided')}
   inspection.result=event.result;inspection.decidedAt=event.occurredAt;inspection.reasons=[...event.reasons];inspection.failedItems=event.failedItems;inspection.totalItems=event.totalItems;
   if(event.result==='failed')state.refundReason=state.refundReason||'inspection_failed';break;
  }
  case 'inspection_buyer_choice':{
   const inspection=state.inspection;
   if(inspection?.result!=='partial'||!['accept_partial','full_refund'].includes(event.choice)||!cents(event.partialRefundCents)||event.choice==='accept_partial'&&(event.partialRefundCents<1||event.partialRefundCents>=order.totalCents))return reject('inspection_choice_invalid');
   if(inspection.buyerChoice){if(inspection.buyerChoice===event.choice){semanticDuplicate=true;break}return reject('inspection_choice_locked')}
   inspection.buyerChoice=event.choice;inspection.partialRefundCents=event.choice==='accept_partial'?event.partialRefundCents:0;
   if(event.choice==='full_refund')state.refundReason=state.refundReason||'inspection_failed';break;
  }
  case 'inspection_shipped':{
   const inspection=state.inspection;
   if(order.fulfillment==='pickup'||!inspection?.result||inspection.result==='failed'||inspection.result==='partial'&&inspection.buyerChoice!=='accept_partial'||!nonempty(event.carrier)||!nonempty(event.trackingNumber))return reject('inspection_shipment_not_applicable');
   if(shipment.trackingNumber){if(matchedShipment(event)){semanticDuplicate=true;break}return reject('shipment_identity_locked')}
   // The operator's outbound label is trusted tracking; carrier events confirm handoff and signed delivery.
   shipment.carrier=event.carrier;shipment.trackingNumber=event.trackingNumber;shipment.submittedAt=event.occurredAt;shipment.validatedAt=event.occurredAt;break;
  }
  default:return reject('unsupported_event');
 }
 state.recentEvents=[...state.recentEvents,{id:event.eventId,fingerprint:encoded}].slice(-64);state.version=Math.max(input.version,initial.state.version)+1;
 const decision=evaluateCommercePolicy(state,nowISO);state=decision.state;
 // One accepted event is one CAS transition, including its time-derived changes.
 state.version=input.version+1;
 return {state,accepted:true,duplicate:semanticDuplicate,decision};
}
