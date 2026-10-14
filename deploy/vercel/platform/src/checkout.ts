import {DomainError,once,outbox,serializable,type SqlPool} from './db';
import {createSafeTradeForOrder,type SafeTradeConfig} from './escrow';
import {bps,cents} from './money';
export async function prepareOrder(pool:SqlPool,buyerId:string,listingId:string,key:string,config:{safetrade:SafeTradeConfig;platformFeeBps:number;shippingCents:string;taxCents:string;paymentsEnabled:boolean}){
 if(!config.paymentsEnabled)throw new DomainError('checkout_disabled','Checkout is not enabled.',503);
 return serializable(pool,db=>once(db,key,'prepare_order',{buyerId,listingId},async()=>{
  const listing=(await db.query<{seller_id:string;status:string;is_custom_entry:boolean;asking_price_cents:string;sale_mode:string}>('SELECT * FROM ch_platform.marketplace_listings WHERE id=$1 FOR UPDATE',[listingId])).rows[0];
  if(!listing||listing.status!=='active'||listing.is_custom_entry||listing.sale_mode!=='fixed')throw new DomainError('listing_unavailable','Listing is unavailable for this checkout.',409);
  if(listing.seller_id===buyerId)throw new DomainError('self_purchase','You cannot buy your own listing.',400);
  const ebay=(await db.query<{id:string}>(`SELECT id FROM ch_platform.ebay_listings WHERE internal_listing_id=$1
   AND status IN ('live','publish_pending','needs_reconciliation') LIMIT 1`,[listingId])).rows[0];
  if(ebay)throw new DomainError('external_reservation_required','Reserve or end the eBay copy and reconcile it before platform checkout.');
  const copies=(await db.query<{collection_item_id:string;comic_id:string;grade_key:string;status:string;metadata_status:string;issue_number:string;printing_type:string;variant_code:string}>(`SELECT i.collection_item_id,i.comic_id,p.grade_key,p.status,c.metadata_status,c.issue_number,c.printing_type,c.variant_code
   FROM ch_platform.listing_items i JOIN ch_platform.collection_items p ON p.id=i.collection_item_id JOIN ch_platform.comics c ON c.id=i.comic_id
   WHERE i.listing_id=$1 ORDER BY p.id FOR UPDATE OF p`,[listingId])).rows;
  if(!copies.length||copies.some(v=>v.status!=='held'||v.metadata_status!=='canonical'))throw new DomainError('copy_unavailable','Every exact physical copy must be available.');
  const amount=cents(listing.asking_price_cents),fee=bps(amount,config.platformFeeBps);
  const order=(await db.query<{id:string}>(`INSERT INTO ch_platform.orders(listing_id,buyer_id,seller_id,subtotal_cents,shipping_cents,tax_cents,platform_fee_cents)
   VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[listingId,buyerId,listing.seller_id,amount.toString(),cents(config.shippingCents).toString(),cents(config.taxCents).toString(),fee.toString()])).rows[0];
  for(const copy of copies)await db.query('INSERT INTO ch_platform.order_items(order_id,collection_item_id,comic_id,grade_key,snapshot) VALUES($1,$2,$3,$4,$5::jsonb)',[order.id,copy.collection_item_id,copy.comic_id,copy.grade_key,JSON.stringify({comicId:copy.comic_id,issueNumber:copy.issue_number,printingType:copy.printing_type,variantCode:copy.variant_code,gradeKey:copy.grade_key})]);
  await db.query("UPDATE ch_platform.marketplace_listings SET status='reserved',version=version+1 WHERE id=$1",[listingId]);
  const safetrade=await createSafeTradeForOrder(db,order.id,config.safetrade);
  // Payment Intent creation is a separate explicit checkout step, after points
  // redemption and a server-created shipping/tax quote. No stale price capture.
  return {orderId:order.id,subtotalCents:amount.toString(),platformFeeCents:fee.toString(),safetrade};
 }));
}
export async function requestOrderPayment(pool:SqlPool,userId:string,orderId:string,key:string){
 return serializable(pool,db=>once(db,key,'request_payment',{userId,orderId},async()=>{
  const o=(await db.query<{buyer_id:string;status:string;subtotal_cents:string;shipping_cents:string;tax_cents:string;discount_cents:string}>('SELECT * FROM ch_platform.orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];
  if(!o||o.buyer_id!==userId)throw new DomainError('order_missing','Order not found.',404);
  if(o.status!=='pending_payment')throw new DomainError('payment_not_pending','Order is not awaiting payment.');
  const amount=cents(o.subtotal_cents)-cents(o.discount_cents)+cents(o.shipping_cents)+cents(o.tax_cents);
  await db.query("UPDATE ch_platform.orders SET status='payment_preparing' WHERE id=$1",[orderId]);
  await outbox(db,'stripe_payment_intent',orderId,'payment-intent:'+orderId,{orderId,amountCents:amount.toString()});
  return {orderId,amountCents:amount.toString(),status:'payment_preparing'};
 }));
}
