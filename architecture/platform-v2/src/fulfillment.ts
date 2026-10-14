import {DomainError,serializable,type SqlPool} from './db';
import {transitionSafeTrade,type SafeTradeConfig} from './escrow';
export type ShipmentReceipt={tracking:string;carrier:string;acceptedAt:string;destinationMatches:boolean};
// A provider-verified carrier integration must retrieve the shipment server-side
// and compare its destination with the vault/order address. Printing a label is
// not acceptance. Track events must be signature-checked and deduplicated.
export interface CarrierVerifier {
 acceptance(orderId:string,tracking:string,carrier:string,destination:'vault'|'buyer'):Promise<ShipmentReceipt|null>;
 delivery(orderId:string,eventId:string):Promise<{tracking:string;deliveredAt:string;destinationMatches:boolean}|null>;
}
export async function recordSellerShipment(pool:SqlPool,userId:string,transactionId:string,tracking:string,carrier:string,key:string,verifier:CarrierVerifier,config:SafeTradeConfig,now=new Date()){
 const db=await pool.connect();let row:{seller_id:string;order_id:string;requires_vault:boolean}|undefined;
 try{row=(await db.query<typeof row extends infer T?NonNullable<T>:never>(`SELECT o.seller_id,e.order_id,e.requires_vault FROM ch_platform.escrow_transactions e JOIN ch_platform.orders o ON o.id=e.order_id WHERE e.id=$1`,[transactionId])).rows[0]}finally{db.release()}
 if(!row||row.seller_id!==userId)throw new DomainError('shipment_missing','Owned transaction not found.',404);
 const receipt=await verifier.acceptance(row.order_id,tracking,carrier,row.requires_vault?'vault':'buyer');
 if(!receipt||receipt.tracking!==tracking||receipt.carrier!==carrier||!receipt.destinationMatches||!Number.isFinite(Date.parse(receipt.acceptedAt))||Date.parse(receipt.acceptedAt)>now.getTime())throw new DomainError('carrier_not_accepted','The carrier has not accepted this shipment to the required destination.');
 // Eligibility is evaluated using the real carrier acceptance time, not label time.
 return transitionSafeTrade(pool,transactionId,{kind:'user',userId},{type:'seller_dispatched',tracking,carrier,acceptanceScanVerified:true},key,config,new Date(receipt.acceptedAt));
}
export async function recordBuyerDelivery(pool:SqlPool,transactionId:string,carrierEventId:string,verifier:CarrierVerifier,config:SafeTradeConfig){
 const db=await pool.connect();let orderId:string|undefined;try{orderId=(await db.query<{order_id:string}>('SELECT order_id FROM ch_platform.escrow_transactions WHERE id=$1',[transactionId])).rows[0]?.order_id}finally{db.release()}
 if(!orderId)throw new DomainError('transaction_missing','Transaction not found.',404);
 const receipt=await verifier.delivery(orderId,carrierEventId);if(!receipt?.destinationMatches)throw new DomainError('delivery_unverified','Verified destination delivery is required.');
 return transitionSafeTrade(pool,transactionId,{kind:'carrier_webhook'},{type:'buyer_delivery_confirmed',...receipt,destinationMatches:true,carrierEventId},'carrier:'+carrierEventId,config);
}
export async function cancelUnpaidOrder(pool:SqlPool,userId:string,orderId:string){
 return serializable(pool,async db=>{
  const o=(await db.query<{buyer_id:string;status:string;listing_id:string;payment_intent_id:string|null}>('SELECT * FROM ch_platform.orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];
  if(!o||o.buyer_id!==userId)throw new DomainError('order_missing','Owned order not found.',404);
  if(o.status!=='pending_payment'||o.payment_intent_id)throw new DomainError('payment_reconciliation_required','Cancel or reconcile the payment provider object before releasing inventory.');
  await db.query("UPDATE ch_platform.orders SET status='cancelled' WHERE id=$1",[orderId]);
  await db.query("UPDATE ch_platform.escrow_transactions SET status='cancelled' WHERE order_id=$1",[orderId]);
  await db.query("UPDATE ch_platform.marketplace_listings SET status='draft',version=version+1 WHERE id=$1",[o.listing_id]);
  await db.query('UPDATE ch_platform.listing_items SET reserved=false WHERE listing_id=$1',[o.listing_id]);
  await db.query(`INSERT INTO ch_platform.outbox_jobs(kind,aggregate_id,operation_key,payload) VALUES('reverse_order_rewards',$1,$2,jsonb_build_object('orderId',$1::text)) ON CONFLICT(operation_key) DO NOTHING`,[orderId,'cancel-points:'+orderId]);return {cancelled:true};
 });
}
