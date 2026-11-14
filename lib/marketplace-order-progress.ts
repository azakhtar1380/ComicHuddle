// Buyer/seller-facing order progress, derived only from server-owned order DTO fields.
// Nothing here changes order state or implies that a seller payout has been sent:
// release/transfer statuses are seller-side bookkeeping and read as "Delivered".

export type ProgressInput={status:string;paidAt:string|null;paymentConfirmed?:boolean;tracking:{carrier:string;number:string;verified:boolean}|null;fulfillment?:'shipping'|'pickup';protection?:{tier:'standard'|'safepurchase'}|null;inspection?:{received:boolean;result:null|'passed'|'failed'|'partial';inboundTracking?:unknown}|null;pickup?:{confirmedAt:string}|null};
export type ProgressStep={key:string;label:string;detail?:string};
export type ProgressTerminal={kind:'refunded'|'refunding'|'cancelled';label:string;detail:string};
export type OrderProgressModel={steps:ProgressStep[];complete:number;current:number;terminal:ProgressTerminal|null;hold:string|null};

const statusLabels:Record<string,string>={
 awaiting_payment:'Awaiting payment',awaiting_shipment:'Paid · awaiting shipment',in_transit:'Shipped · in transit',
 delivered_review:'Delivered · review window open',release_eligible:'Delivered',transfer_pending:'Delivered',transferred:'Delivered · complete',
 refund_eligible:'Refund approved',refund_pending:'Refund in progress',refunded:'Refunded',manual_review:'On hold for support review',
 checkout_expired:'Checkout expired',cancelled:'Cancelled',awaiting_pickup:'Paid · ready for pickup',picked_up:'Picked up · review window open',
 shipped_to_inspection:'On its way to inspection',at_inspection:'At the Inspection Center',inspection_passed:'Passed inspection',inspection_failed:'Inspection issue · your choice needed',shipped_to_buyer:'Inspected · shipped to you'
};
export function orderStatusLabel(status:string){return statusLabels[status]||status.replaceAll('_',' ')}

const deliveredStatuses=new Set(['delivered_review','picked_up','release_eligible','transfer_pending','transferred']);
export function orderProgress(order:ProgressInput):OrderProgressModel{
 const pickup=order.fulfillment==='pickup',paid=!!order.paidAt||order.paymentConfirmed===true,safePurchase=order.protection?.tier==='safepurchase';
 const finish:ProgressStep=pickup?{key:'picked_up',label:'Picked up'}:{key:'delivered',label:'Delivered'};
 const steps:ProgressStep[]=safePurchase?[
  {key:'placed',label:'Order placed'},{key:'paid',label:'Payment confirmed',detail:'Held until delivery'},
  {key:'to_inspection',label:'Shipped to inspection'},{key:'inspected',label:'Inspected'},
  pickup?{key:'ready',label:'Ready at the Inspection Center'}:{key:'to_buyer',label:'Shipped to you',detail:'Insured, signature required'},finish
 ]:[
  {key:'placed',label:'Order placed'},{key:'paid',label:'Payment confirmed'},
  pickup?{key:'ready',label:'Ready for pickup'}:{key:'shipped',label:'Shipped',detail:'Tracking added'},finish
 ];
 let complete=1;
 if(paid)complete=2;
 if(safePurchase){
  const inspection=order.inspection;
  if(paid&&(inspection?.inboundTracking||inspection?.received))complete=3;
  if(paid&&inspection?.result&&inspection.result!=='failed')complete=4;
  if(paid&&(order.status==='shipped_to_buyer'||!pickup&&order.tracking&&complete>=4))complete=5;
  if(paid&&deliveredStatuses.has(order.status))complete=6;
 }else{
  if(paid&&(order.tracking||order.status==='in_transit'))complete=3;
  if(paid&&pickup&&order.status==='awaiting_pickup')complete=2;
  if(paid&&deliveredStatuses.has(order.status))complete=4;
 }
 const terminal:ProgressTerminal|null=
  order.status==='refunded'?{kind:'refunded',label:'Refunded',detail:'The full payment was returned to the buyer.'}:
  order.status==='refund_pending'?{kind:'refunding',label:'Refund in progress',detail:'The seller’s payout is on hold while the refund completes.'}:
  order.status==='refund_eligible'?{kind:'refunding',label:'Refund approved',detail:'A full refund is available for this order.'}:
  order.status==='cancelled'?{kind:'cancelled',label:'Cancelled',detail:'No money was collected, and the listing was released.'}:
  order.status==='checkout_expired'?{kind:'cancelled',label:'Checkout expired',detail:'Payment was not completed in time. No money was collected.'}:null;
 const hold=order.status==='manual_review'&&!terminal?'Support is reviewing this order. Progress resumes once the review is resolved.':order.status==='inspection_failed'?'Part of this collection didn’t pass inspection. Choose a pro-rated refund or a full refund below.':null;
 return {steps,complete,current:terminal||complete>=steps.length?-1:complete,terminal,hold};
}
