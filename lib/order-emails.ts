// Order emails: the buyer's receipt and the seller's "sold" notice, sent once, when a payment is first confirmed
// (lib/commerce.ts recordPaid). Built only from the order's frozen snapshot, so the email matches what was paid.
import {getPool} from '../db/postgres';
import {accountEmail,sendEmail} from './email';
import {itemSoldEmail,orderReceiptEmail,type OrderEmailData} from './email-templates';
import {evaluateCommercePolicy,type CommerceState} from './commerce-policy';

type Snapshot={title?:string;itemCount?:number;photoIds?:string[];itemAmountCents?:number;shippingCents?:number;inspectionFeeCents?:number;storeCreditCents?:number;totalCents?:number;fulfillment?:'shipping'|'pickup';shippingService?:string;sellerTransferCents?:number;autoCharge?:boolean;shippingAddress?:{name:string;line1:string;line2?:string;city:string;state:string;postalCode:string}};
const ref=(orderId:string)=>orderId.replace(/[^A-Za-z0-9]/g,'').slice(0,8).toUpperCase();

export function publicOrigin(){try{return new URL(String(process.env.COMMERCE_PUBLIC_ORIGIN||process.env.BETTER_AUTH_URL||'')).origin}catch{return 'https://comichuddle.com'}}

export async function sendOrderPaidEmails(orderId:string){
 try{
  const row=(await getPool().query<{id:string;snapshot:string;state:string;sandbox:number;buyer_user_id:string;seller_user_id:string;buyer_id:string;seller_id:string}>('SELECT id,snapshot,state,sandbox,buyer_user_id,seller_user_id,buyer_id,seller_id FROM ch_web.commerce_orders WHERE id=$1',[orderId])).rows[0];
  if(!row)return;
  const snapshot=JSON.parse(row.snapshot) as Snapshot,state=JSON.parse(row.state) as CommerceState;
  const people=(await getPool().query<{id:string;name:string;handle:string}>('SELECT id,name,handle FROM ch_web.profiles WHERE id = ANY($1::text[])',[[row.buyer_id,row.seller_id]])).rows;
  const buyer=people.find(p=>p.id===row.buyer_id),seller=people.find(p=>p.id===row.seller_id);
  let last4:string|null=null;
  if(snapshot.autoCharge)last4=(await getPool().query<{card_last4:string}>('SELECT card_last4 FROM ch_web.buyer_saved_cards WHERE user_id=$1 AND sandbox=$2',[row.buyer_user_id,Number(row.sandbox)]).catch(()=>({rows:[]}))).rows[0]?.card_last4||null;
  let shipBy:string|null=null;try{const deadline=evaluateCommercePolicy(state,new Date().toISOString()).trackingDeadlineAt;shipBy=deadline?new Date(deadline).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'America/Chicago'}):null}catch{}
  const a=snapshot.shippingAddress;
  const data:OrderEmailData={orderRef:ref(row.id),title:String(snapshot.title||'Your comic'),itemCount:Number(snapshot.itemCount)||1,photoUrl:snapshot.photoIds?.[0]?'/api/media?id='+snapshot.photoIds[0]+'&size=thumbnail':null,
   itemCents:Number(snapshot.itemAmountCents)||0,shippingCents:Number(snapshot.shippingCents)||0,feeCents:Number(snapshot.inspectionFeeCents)||0,creditCents:Number(snapshot.storeCreditCents)||0,totalCents:Number(snapshot.totalCents)||0,
   fulfillment:snapshot.fulfillment==='pickup'?'pickup':'shipping',shipTo:a?[a.name,a.line1,a.line2,a.city+', '+a.state+' '+a.postalCode].filter(Boolean).join('\n'):null,shippingService:snapshot.shippingService||null,
   buyerName:buyer?.name||'collector',sellerName:seller?.name||'the seller',sellerHandle:seller?.handle||'',
   ...(snapshot.autoCharge&&last4?{autoCharged:{last4}}:{}),sellerNetCents:Number(snapshot.sellerTransferCents)||0,shipBy,test:Number(row.sandbox)===1};
  const origin=publicOrigin();
  await Promise.all([
   accountEmail(row.buyer_user_id).then(to=>sendEmail(to,orderReceiptEmail(origin,data))),
   accountEmail(row.seller_user_id).then(to=>sendEmail(to,itemSoldEmail(origin,data))),
  ]);
 }catch{/* an email problem never affects the order */}
}
