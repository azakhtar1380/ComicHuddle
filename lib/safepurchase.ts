// SafePurchase order timeline and admin dashboard data (server-only).
//
// The timeline is derived from the real order: payment (Stripe), the seller's inbound tracking, the
// Inspection Center's receive / check / ship events (lib/commerce.ts commerceInspection, which goes through
// lib/commerce-policy.ts), carrier delivery (EasyPost) and the seller release. Admins add notes, tracking
// numbers and photos to a step (ch_web.safepurchase_updates, migration 040), but a note never moves the
// order: only the real events do. Nothing here invents a status.
import {and,desc,eq,inArray,or,sql} from 'drizzle-orm';
import {getDb} from '../db';
import {getPool} from '../db/postgres';
import {commerceEvents,commerceOrders,profiles} from '../db/schema';
import {ApiRequestError} from './api-security';
import {commerceOrderDto} from './commerce';
import {notify} from './notifications';
import {protectionConfig,type ProtectionEnv} from './commerce-protection';
import {SAFEPURCHASE_STEPS,isSafePurchaseStep,normalizeOrderSearch,orderNumber,stepLabel,type SafePurchaseOutcome,type SafePurchaseStep,type SafePurchaseTimeline,type StepState,type TimelineStep,type TimelineUpdate} from './safepurchase-steps';

type Db=ReturnType<typeof getDb>;
export type OrderRow=typeof commerceOrders.$inferSelect;
type Obj=Record<string,unknown>;
const obj=(value:unknown):Obj=>value&&typeof value==='object'&&!Array.isArray(value)?value as Obj:{};
const str=(value:unknown)=>typeof value==='string'&&value?value:null;
function json(text:string):Obj{try{return obj(JSON.parse(text))}catch{return {}}}
const missingTable=(error:unknown)=>(error as {code?:string})?.code==='42P01';
/** Serialized order state always contains this exact fragment for SafePurchase orders (JSON.stringify, no spaces). */
const TIER_FRAGMENT='%"tier":"safepurchase"%';

export const isSafePurchaseRow=(row:OrderRow)=>obj(json(row.state).policy).tier==='safepurchase';

// --- updates (migration 040) ---------------------------------------------------------------
type UpdateRow={id:string;order_id:string;step:string;kind:string;internal:boolean;note:string;carrier:string|null;tracking_number:string|null;photo_ids:unknown;created_at:Date|string};
function updateDto(row:UpdateRow):TimelineUpdate|null{
 if(!isSafePurchaseStep(row.step))return null;
 const kind=(['note','tracking','return_shipped','internal_note','step'] as const).find(value=>value===row.kind)||'note';
 const photos=Array.isArray(row.photo_ids)?row.photo_ids.filter((id):id is string=>typeof id==='string').slice(0,8):[];
 return {id:row.id,step:row.step,kind,note:row.note||'',carrier:row.carrier,trackingNumber:row.tracking_number,photoIds:photos,createdAt:new Date(row.created_at).toISOString(),internal:row.internal===true};
}
/** Updates for some orders. available=false until migration 040 is applied. */
export async function orderUpdates(orderIds:string[],includeInternal:boolean):Promise<{available:boolean;byOrder:Map<string,TimelineUpdate[]>}>{
 const byOrder=new Map<string,TimelineUpdate[]>();if(!orderIds.length)return {available:true,byOrder};
 try{
  const result=await getPool().query<UpdateRow>(`SELECT id,order_id,step,kind,internal,note,carrier,tracking_number,photo_ids,created_at FROM ch_web.safepurchase_updates WHERE order_id=ANY($1::text[])${includeInternal?'':' AND internal=false'} ORDER BY created_at ASC LIMIT 2000`,[orderIds]);
  for(const row of result.rows){const dto=updateDto(row);if(!dto)continue;const list=byOrder.get(row.order_id)||[];list.push(dto);byOrder.set(row.order_id,list)}
  return {available:true,byOrder};
 }catch(error){if(missingTable(error))return {available:false,byOrder};throw error}
}
export type NewUpdate={orderId:string;step:SafePurchaseStep;kind:TimelineUpdate['kind'];note:string;carrier?:string|null;trackingNumber?:string|null;photoIds?:string[];internal:boolean;createdBy:string};
export async function addOrderUpdate(input:NewUpdate):Promise<string>{
 const id=crypto.randomUUID();
 try{await getPool().query('INSERT INTO ch_web.safepurchase_updates (id,order_id,step,kind,internal,note,carrier,tracking_number,photo_ids,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)',[id,input.orderId,input.step,input.kind,input.internal,input.note.slice(0,1000),input.carrier||null,input.trackingNumber||null,JSON.stringify((input.photoIds||[]).slice(0,8)),input.createdBy])}
 catch(error){if(missingTable(error))throw new ApiRequestError('SafePurchase updates need database migration 040. Ask the owner to apply it.',503);throw error}
 return id;
}
/** The update a photo belongs to, for the photo route's permission check. */
export async function updateForPhoto(updateId:string,photoId:string):Promise<{orderId:string;internal:boolean}|null>{
 try{
  const result=await getPool().query<{order_id:string;internal:boolean;photo_ids:unknown}>('SELECT order_id,internal,photo_ids FROM ch_web.safepurchase_updates WHERE id=$1',[updateId]);
  const row=result.rows[0];if(!row||!Array.isArray(row.photo_ids)||!row.photo_ids.includes(photoId))return null;
  return {orderId:row.order_id,internal:row.internal===true};
 }catch{return null}
}

// --- timeline ------------------------------------------------------------------------------
type Viewer={userId:string;admin:boolean};
export function buildTimeline(row:OrderRow,viewer:Viewer,updates:TimelineUpdate[],updatesAvailable:boolean,environment:ProtectionEnv):SafePurchaseTimeline{
 const state=json(row.state),snapshot=json(row.snapshot),order=obj(state.order),shipment=obj(state.shipment),inspection=obj(state.inspection),inbound=obj(inspection.inbound),financial=obj(state.financial),pickup=obj(state.pickup);
 const role:SafePurchaseTimeline['role']=row.buyerUserId===viewer.userId?'buyer':row.sellerUserId===viewer.userId?'seller':'admin';
 const fulfillment=snapshot.fulfillment==='pickup'?'pickup':'shipping',isPickup=fulfillment==='pickup';
 // The validated view of the order (throws when the stored state fails its integrity checks).
 let dto:ReturnType<typeof commerceOrderDto>|null=null;try{dto=commerceOrderDto(row,viewer.userId)}catch{dto=null}
 const status=dto?.status||row.status,result=str(inspection.result),buyerChoice=str(inspection.buyerChoice);
 const passed=result==='passed'||result==='partial'&&buyerChoice==='accept_partial';
 const checkFailed=result==='failed'||result==='partial'&&buyerChoice!=='accept_partial';
 const transferDone=financial.kind==='transfer'&&!!str(financial.confirmedAt);
 const reasons=Array.isArray(inspection.reasons)?inspection.reasons.filter((value):value is string=>typeof value==='string'):[];
 type Facts={done:boolean;failed?:boolean;at:string|null;detail?:string|null;tracking?:{carrier:string;number:string}|null};
 const facts:Record<SafePurchaseStep,Facts>={
  paid:{done:!!str(order.paidAt)&&dto?.paymentConfirmed!==false,at:str(order.paidAt)},
  seller_shipped:str(inbound.trackingNumber)?{done:true,at:str(inbound.submittedAt),tracking:{carrier:String(inbound.carrier||''),number:String(inbound.trackingNumber)}}:{done:!!str(inspection.receivedAt),at:null,detail:str(inspection.receivedAt)?'Arrived without seller tracking.':null},
  received:{done:!!str(inspection.receivedAt),at:str(inspection.receivedAt)},
  checked:{done:!!result,failed:checkFailed,at:str(inspection.decidedAt),detail:result==='passed'?'Passed: right book, condition as described.':result==='failed'?'Did not pass: '+reasons.join('; '):result==='partial'?`${Number(inspection.failedItems)||0} of ${Number(inspection.totalItems)||0} books did not pass: ${reasons.join('; ')}`+(buyerChoice==='accept_partial'?' Buyer kept the rest with a pro-rated refund.':buyerChoice==='full_refund'?' Buyer chose a full refund.':' Waiting for the buyer to choose.'):null},
  shipped_to_buyer:isPickup?{done:passed,at:passed?str(inspection.decidedAt):null,detail:passed?'Ready for pickup at ComicHuddle.':null}:{done:passed&&!!str(shipment.trackingNumber),at:str(shipment.submittedAt)||str(shipment.validatedAt),tracking:passed&&str(shipment.trackingNumber)?{carrier:String(shipment.carrier||''),number:String(shipment.trackingNumber)}:null,detail:passed&&str(shipment.trackingNumber)?'Insured, signature required.':null},
  delivered:isPickup?{done:!!str(pickup.confirmedAt),at:str(pickup.confirmedAt)}:{done:!!str(shipment.deliveredAt),at:str(shipment.deliveredAt),detail:str(shipment.deliveredAt)?(shipment.signatureVerified===true?'Delivered with signature (carrier confirmed).':'Delivered (carrier confirmed). Signature not yet confirmed.'):null},
  done:{done:transferDone,at:str(financial.confirmedAt),detail:transferDone?'Seller paid.':null},
 };
 const refunded=status==='refunded',refundPending=status==='refund_pending',refundEligible=status==='refund_eligible',cancelled=row.status==='cancelled'||row.status==='checkout_expired';
 const outcome:SafePurchaseOutcome=cancelled?'cancelled':refunded?'refunded':refundPending?'refund_pending':transferDone?'done':checkFailed?'check_failed':status==='manual_review'||refundEligible||!dto?'on_hold':'in_progress';
 const reviewUntil=dto?.reviewUntil||null;
 if(!transferDone&&facts.delivered.done&&outcome==='in_progress')facts.done.detail=reviewUntil?'The buyer can report a problem until '+new Date(reviewUntil).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'})+' UTC. The seller is paid after that.':'The seller is paid after the 48-hour review window.';
 const outcomeNote=outcome==='refunded'?'The buyer was refunded.':outcome==='refund_pending'?'A refund to the buyer is in progress.':outcome==='check_failed'?(result==='failed'?'The comic did not pass our check. The buyer is refunded and the comic goes back to the seller.':'Part of the collection did not pass our check.'):outcome==='on_hold'?refundEligible?'Eligible for a full refund (for example, the seller missed the 48-hour shipping deadline). Waiting for the refund to be started.':(dto?'On hold for review by ComicHuddle.':'This order needs a manual check by ComicHuddle.'):outcome==='cancelled'?'This order was cancelled.':outcome==='done'?'Complete.':null;
 let currentStep:SafePurchaseStep|null=null;const stopAfterCheck=checkFailed||refunded||refundPending||refundEligible||cancelled;
 const steps:TimelineStep[]=SAFEPURCHASE_STEPS.map(step=>{
  const fact=facts[step],index=SAFEPURCHASE_STEPS.indexOf(step);let stepState:StepState;
  if(fact.failed)stepState='failed';
  else if(fact.done)stepState='done';
  else if(stopAfterCheck&&index>=SAFEPURCHASE_STEPS.indexOf(facts.checked.done?'shipped_to_buyer':'paid'))stepState='skipped';
  else if(!currentStep&&outcome==='in_progress'){stepState='current';currentStep=step}
  else stepState='upcoming';
  return {step,label:stepLabel(step,isPickup),state:stepState,at:fact.at,detail:fact.detail??null,tracking:fact.tracking??null,updates:updates.filter(update=>update.step===step)};
 });
 const config=protectionConfig(environment);
 return {orderId:row.id,orderNumber:orderNumber(row.id),title:typeof snapshot.title==='string'?snapshot.title:'Order',fulfillment,sandbox:row.sandbox===1,role,outcome,outcomeNote,currentStep,steps,reviewUntil,
  ...(role==='seller'||role==='admin'?!str(inspection.receivedAt)&&!cancelled?{receiving:{address:config.inspectionAddress}}:{}:{}),
  updatesAvailable};
}

/** Buyer or seller view of their own SafePurchase order (no internal notes). Admins get the full view. */
export async function timelineForViewer(viewer:Viewer,orderId:string,environment:ProtectionEnv):Promise<SafePurchaseTimeline>{
 const db=getDb();
 const [row]=await db.select().from(commerceOrders).where(viewer.admin?eq(commerceOrders.id,orderId):and(eq(commerceOrders.id,orderId),or(eq(commerceOrders.buyerUserId,viewer.userId),eq(commerceOrders.sellerUserId,viewer.userId))));
 if(!row||!isSafePurchaseRow(row))throw new ApiRequestError('SafePurchase order not found.',404);
 const participant=row.buyerUserId===viewer.userId||row.sellerUserId===viewer.userId;
 const {available,byOrder}=await orderUpdates([row.id],viewer.admin&&!participant);
 return buildTimeline(row,viewer,byOrder.get(row.id)||[],available,environment);
}

// --- admin dashboard -----------------------------------------------------------------------
export type AdminOrderSummary={orderId:string;orderNumber:string;title:string;buyer:{profileId:string;name:string|null};seller:{profileId:string;name:string|null};totalCents:number;itemAmountCents:number;status:string;currentStep:SafePurchaseStep|null;currentLabel:string;outcome:SafePurchaseOutcome;createdAt:string;updatedAt:string;sandbox:boolean;fulfillment:'shipping'|'pickup'};
export const ADMIN_STEP_FILTERS=['all',...SAFEPURCHASE_STEPS,'problems'] as const;
export type AdminStepFilter=typeof ADMIN_STEP_FILTERS[number];
const SCAN_LIMIT=500;

async function profileNames(db:Db,ids:string[]){
 const map=new Map<string,string>();if(!ids.length)return map;
 const rows=await db.select({id:profiles.id,name:profiles.name}).from(profiles).where(inArray(profiles.id,[...new Set(ids)]));
 for(const row of rows)map.set(row.id,row.name);return map;
}
function money(snapshot:Obj){const total=Number(snapshot.totalCents),item=Number(snapshot.itemAmountCents);return {totalCents:Number.isSafeInteger(total)?total:0,itemAmountCents:Number.isSafeInteger(item)?item:0}}

/** Every SafePurchase order (most recent first, up to 500 scanned), filtered by step and order number. */
export async function adminSafePurchaseOrders(environment:ProtectionEnv,filters:{step?:string;q?:string;offset?:number;adminUserId:string}){
 const db=getDb(),q=normalizeOrderSearch(filters.q||'').toLowerCase(),step=(ADMIN_STEP_FILTERS as readonly string[]).includes(filters.step||'')?filters.step as AdminStepFilter:'all';
 const where=q?and(sql`${commerceOrders.state} LIKE ${TIER_FRAGMENT}`,sql`lower(replace(${commerceOrders.id},'-','')) LIKE ${q.replace(/-/g,'')+'%'}`):sql`${commerceOrders.state} LIKE ${TIER_FRAGMENT}`;
 const rows=(await db.select().from(commerceOrders).where(where).orderBy(desc(commerceOrders.createdAt)).limit(SCAN_LIMIT+1)).filter(isSafePurchaseRow);
 const names=await profileNames(db,rows.flatMap(row=>[row.buyerId,row.sellerId]));
 const viewer={userId:filters.adminUserId,admin:true};
 const summaries:AdminOrderSummary[]=rows.slice(0,SCAN_LIMIT).map(row=>{
  const timeline=buildTimeline(row,viewer,[],true,environment),snapshot=json(row.snapshot),current=timeline.currentStep;
  return {orderId:row.id,orderNumber:timeline.orderNumber,title:timeline.title,buyer:{profileId:row.buyerId,name:names.get(row.buyerId)||null},seller:{profileId:row.sellerId,name:names.get(row.sellerId)||null},...money(snapshot),status:row.status,currentStep:current,currentLabel:current?stepLabel(current,timeline.fulfillment==='pickup'):timeline.outcome==='done'?'Done':timeline.outcomeNote||timeline.outcome,outcome:timeline.outcome,createdAt:row.createdAt,updatedAt:row.updatedAt,sandbox:row.sandbox===1,fulfillment:timeline.fulfillment};
 });
 const counts=Object.fromEntries(ADMIN_STEP_FILTERS.map(value=>[value,summaries.filter(item=>matchesFilter(item,value)).length])) as Record<AdminStepFilter,number>;
 const filtered=summaries.filter(item=>matchesFilter(item,step));
 const offset=Math.max(0,Math.min(filters.offset||0,SCAN_LIMIT)),page=filtered.slice(offset,offset+50);
 return {orders:page,total:filtered.length,offset,hasMore:filtered.length>offset+50,counts,truncated:rows.length>SCAN_LIMIT,step};
}

const PROBLEM_OUTCOMES=new Set<SafePurchaseOutcome>(['check_failed','refund_pending','on_hold']);
/** "done" lists orders waiting for the seller payout and finished ones; "problems" lists failed checks, refunds in progress and holds. */
function matchesFilter(item:AdminOrderSummary,filter:AdminStepFilter){
 if(filter==='all')return true;
 if(filter==='problems')return PROBLEM_OUTCOMES.has(item.outcome);
 if(filter==='done')return item.currentStep==='done'||item.outcome==='done';
 return item.currentStep===filter;
}
export type AdminActions={receive:boolean;check:boolean;checkPartialAllowed:boolean;shipToBuyer:boolean;handoff:boolean;refund:boolean;returnShipment:boolean;release:boolean};
function adminActions(row:OrderRow,timeline:SafePurchaseTimeline,participant:boolean):AdminActions{
 const state=json(row.state),order=obj(state.order),inspection=obj(state.inspection),shipment=obj(state.shipment),financial=obj(state.financial),pickup=obj(state.pickup);
 // The commerce policy makes the final decision; these flags only decide which controls to show.
 const paid=!!str(order.paidAt),open=paid&&!str(financial.kind)&&!['cancelled','checkout_expired','refunded'].includes(row.status);
 const result=str(inspection.result),choice=str(inspection.buyerChoice),passed=result==='passed'||result==='partial'&&choice==='accept_partial';
 if(participant)return {receive:false,check:false,checkPartialAllowed:false,shipToBuyer:false,handoff:false,refund:false,returnShipment:false,release:false};
 return {
  receive:open&&!str(inspection.receivedAt),
  check:open&&!!str(inspection.receivedAt)&&!result,
  checkPartialAllowed:(Number(inspection.totalItems)||1)>=2,
  shipToBuyer:open&&timeline.fulfillment==='shipping'&&passed&&!str(shipment.trackingNumber),
  handoff:open&&timeline.fulfillment==='pickup'&&passed&&!str(pickup.confirmedAt),
  refund:paid&&!str(financial.kind)&&!['cancelled','checkout_expired','refunded'].includes(row.status),
  returnShipment:result==='failed'||result==='partial'&&choice==='full_refund',
  release:row.status==='release_eligible',
 };
}

export async function adminSafePurchaseOrder(environment:ProtectionEnv,adminUserId:string,orderId:string){
 const db=getDb(),[row]=await db.select().from(commerceOrders).where(eq(commerceOrders.id,orderId));
 if(!row||!isSafePurchaseRow(row))throw new ApiRequestError('SafePurchase order not found.',404);
 const participant=row.buyerUserId===adminUserId||row.sellerUserId===adminUserId;
 const {available,byOrder}=await orderUpdates([row.id],true);
 const timeline=buildTimeline(row,{userId:adminUserId,admin:true},byOrder.get(row.id)||[],available,environment);
 const events=await db.select().from(commerceEvents).where(eq(commerceEvents.orderId,row.id)).orderBy(desc(commerceEvents.createdAt)).limit(100);
 const names=await profileNames(db,[row.buyerId,row.sellerId]),snapshot=json(row.snapshot);
 return {
  order:{orderId:row.id,orderNumber:timeline.orderNumber,title:timeline.title,status:row.status,sandbox:row.sandbox===1,fulfillment:timeline.fulfillment,createdAt:row.createdAt,...money(snapshot),itemCount:Number(snapshot.itemCount)||1,
   buyer:{profileId:row.buyerId,name:names.get(row.buyerId)||null},seller:{profileId:row.sellerId,name:names.get(row.sellerId)||null}},
  timeline,
  // Admins who are the buyer or seller can read the order but cannot act on it.
  ownOrder:participant,
  actions:adminActions(row,timeline,participant),
  events:events.map(event=>{const body=json(event.body);return {type:event.type,note:typeof body.note==='string'?body.note:null,createdAt:event.createdAt}}),
 };
}

/** Notifies the buyer and the seller about a SafePurchase step. Never throws. */
export async function notifyParties(row:Pick<OrderRow,'id'|'buyerUserId'|'sellerUserId'|'snapshot'>,title:string,body:string){
 const comic=String(json(row.snapshot).title||'your order').slice(0,80),number=orderNumber(row.id);
 await notify([
  {userId:row.buyerUserId,kind:'safepurchase',title,body:`${comic} · Order ${number}. ${body}`,href:'/?section=Orders&role=buyer'},
  {userId:row.sellerUserId,kind:'safepurchase',title,body:`${comic} · Order ${number}. ${body}`,href:'/?section=Orders&role=seller'},
 ]);
}
export async function safePurchaseRow(orderId:string){
 const [row]=await getDb().select().from(commerceOrders).where(eq(commerceOrders.id,orderId));
 if(!row||!isSafePurchaseRow(row))throw new ApiRequestError('SafePurchase order not found.',404);
 return row;
}
