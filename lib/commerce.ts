import {and,desc,eq,inArray,or,sql,type SQL} from 'drizzle-orm';
import {z} from 'zod';
import {getDb} from '../db';
import {commerceOrders,commerceEvents,commerceSellers,commerceMoneyRequests,listings,listingInventory,offers,profiles,collections} from '../db/schema';
import {ApiRequestError,isRestricted,privateJson} from './api-security';
import {blocked} from './conversations';
import {previewRulesVersion} from './community';
import {listingItems} from './marketplace';
import {conditionalGuard,operationGuardFailed} from './operation-guard';
import {ownerAccountId} from './owner';
import {createCommerceState,evaluateCommercePolicy,applyCommerceEvent,type CommerceState,type CommerceEvent} from './commerce-policy';
import {sandboxSetup,stripeSandbox,StripeSandboxError,type StripeSandboxEnv,type StripeVerifiedEvent} from './stripe-sandbox';

type Db=ReturnType<typeof getDb>;
type Profile=typeof profiles.$inferSelect;
type Row=typeof commerceOrders.$inferSelect;
type Ledger=typeof commerceMoneyRequests.$inferSelect;
type Processor=ReturnType<typeof stripeSandbox>;
type ObjectRecord=Record<string,unknown>;
type TrackingSubmission={carrier:string;number:string;submittedAt:string;verified:false};
type State=CommerceState&{trackingSubmission?:TrackingSubmission;paymentTimingVerified?:boolean};
const now=()=>new Date().toISOString();
const id=z.string().trim().min(1).max(100);
const uuid=z.string().uuid();
const line=(max:number)=>z.string().trim().min(1).max(max).refine(s=>!/[\u0000-\u001f\u007f]/.test(s));
const states=new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));
const addressSchema=z.object({name:line(100),line1:line(160),line2:z.string().trim().max(160).default(''),city:line(100),state:z.string().refine(v=>states.has(v)),postalCode:z.string().regex(/^\d{5}(?:-\d{4})?$/),country:z.literal('US')}).strict();
export const commerceCheckoutSchema=z.object({action:z.literal('checkout'),listingId:id,requestId:uuid,sandboxAcknowledged:z.literal(true),shippingAddress:addressSchema}).strict();
export const commerceTrackingSchema=z.object({action:z.literal('submit_tracking'),orderId:id,carrier:z.enum(['USPS','UPS','FedEx','DHL']),trackingNumber:z.string().trim().min(6).max(60).regex(/^[A-Za-z0-9 -]+$/)}).strict();
export const commerceRefundSchema=z.object({action:z.literal('request_refund'),orderId:id,requestId:uuid,reason:line(200)}).strict();
export const commerceOwnerRefundSchema=z.object({action:z.literal('owner_refund'),orderId:id,requestId:uuid,approveIssue:z.literal(true).optional()}).strict();
export const commerceOnboardSchema=z.object({action:z.literal('seller_onboard'),sandboxAcknowledged:z.literal(true)}).strict();
export const commerceSweepSchema=z.object({action:z.literal('owner_sweep'),sandboxAcknowledged:z.literal(true)}).strict();
export const commerceReconcileSchema=z.object({action:z.literal('owner_reconcile'),orderId:id}).strict();

type Snapshot={title:string;kind:'single'|'collection';fulfillment:'shipping';itemCount:number;items:ReturnType<typeof listingItems>;photoIds:string[];itemAmountCents:number;shippingCents:number;taxCents:0;totalCents:number;currency:'USD';sellerTransferCents:number;platformFeeCents:0;shippingAddress:z.infer<typeof addressSchema>;policyVersion:string};
function stateOf(row:Row):State{
 let value:State;try{value=JSON.parse(row.state)}catch{throw new ApiRequestError('Order requires operator reconciliation.',409)}
 const snapshot=snapshotOf(row);
 if(row.sandbox!==1||!value||value.order?.orderId!==row.id||value.order?.buyerId!==row.buyerId||value.order?.sellerId!==row.sellerId||value.order?.createdAt!==row.createdAt||value.order?.currency!==snapshot.currency||value.order?.totalCents!==snapshot.totalCents||value.order?.sellerTransferCents!==snapshot.sellerTransferCents||value.order?.paymentIntentId!==row.paymentIntentId||value.order?.chargeId!==row.chargeId||evaluateCommercePolicy(value,now()).reason==='invalid_or_unknown_state')throw new ApiRequestError('Order requires operator reconciliation.',409);
 return value;
}
function snapshotOf(row:Row):Snapshot{
 let snapshot:Snapshot;try{snapshot=JSON.parse(row.snapshot)}catch{throw new ApiRequestError('Order snapshot is unavailable.',409)}
 if(!snapshot||snapshot.currency!=='USD'||!Number.isSafeInteger(snapshot.totalCents)||!Number.isSafeInteger(snapshot.itemAmountCents)||!Number.isSafeInteger(snapshot.shippingCents)||snapshot.itemAmountCents<100||snapshot.shippingCents<0||snapshot.totalCents>99_999_999||snapshot.totalCents!==snapshot.itemAmountCents+snapshot.shippingCents||snapshot.sellerTransferCents!==snapshot.totalCents||snapshot.taxCents!==0||snapshot.platformFeeCents!==0)throw new ApiRequestError('Order requires operator reconciliation.',409);
 // Orders created before pickup listings existed were all shipping orders.
 // A future pickup snapshot requires its own policy and proof of handoff.
 if(snapshot.fulfillment!==undefined&&snapshot.fulfillment!=='shipping')throw new ApiRequestError('This order’s delivery method requires operator reconciliation.',409);
 return {...snapshot,fulfillment:'shipping'};
}
function object(value:unknown):ObjectRecord|undefined{return value&&typeof value==='object'&&!Array.isArray(value)?value as ObjectRecord:undefined}
function providerId(value:unknown):string|undefined{return typeof value==='string'?value:typeof object(value)?.id==='string'?object(value)!.id as string:undefined}
function needReady(environment:StripeSandboxEnv){const setup=sandboxSetup(environment);if(!setup.ready)throw new ApiRequestError('Payment sandbox is not connected or reviewed. No payment was started.',503);return setup}
function needShippingCheckout(listing:{fulfillment:unknown}){
 if(listing.fulfillment==='pickup')throw new ApiRequestError('Pickup checkout is unavailable. Message the seller to arrange pickup; no new order or payment was started.',409);
 if(listing.fulfillment!=='shipping'&&listing.fulfillment!=='both')throw new ApiRequestError('This listing’s delivery method is unavailable for shipping checkout.',409);
}
function retryWindow(createdAt:string){const age=Date.now()-Date.parse(createdAt);if(!Number.isFinite(age)||age<0||age>=23*3600000)throw new ApiRequestError('The processor idempotency safety window expired. Support must reconcile the original operation before any new request.',409)}
export function commerceSetup(environment:StripeSandboxEnv){return {sandbox:true,setup:sandboxSetup(environment),carrierConnected:false,payoutsEnabled:false,productionPaymentsEnabled:false,provider:'Stripe',supportedPaymentMethods:['card','apple_pay'],applePayRequiresEligibleDevice:true}}
export function commerceOrderDto(row:Row,userId:string){
 const state=stateOf(row),snapshot=snapshotOf(row),decision=evaluateCommercePolicy(state,now()),timingUnknown=state.paymentTimingVerified===false;
 const verified=state.shipment.validatedAt?{carrier:state.shipment.carrier,number:state.shipment.trackingNumber,verified:true,submittedAt:state.shipment.submittedAt}:state.trackingSubmission||null;
 return {id:row.id,listingId:row.listingId,title:snapshot.title,kind:snapshot.kind,fulfillment:snapshot.fulfillment,itemCount:snapshot.itemCount,role:row.buyerUserId===userId?'buyer':row.sellerUserId===userId?'seller':'operator',status:row.status,sandbox:true,itemAmountCents:snapshot.itemAmountCents,shippingCents:snapshot.shippingCents,taxCents:0,totalCents:snapshot.totalCents,currency:'USD',createdAt:row.createdAt,updatedAt:row.updatedAt,paidAt:timingUnknown?null:state.order.paidAt,paymentConfirmed:!!state.order.paidAt,paymentTimingVerified:!timingUnknown,trackingDeadlineAt:timingUnknown?null:decision.trackingDeadlineAt,carrierDeadlineAt:timingUnknown?null:decision.carrierDeadlineAt,reviewUntil:timingUnknown?null:decision.releaseAt,tracking:verified,issue:state.issue,refundRequested:!!state.issue||!!state.refundReason,refundStatus:state.financial?.kind==='refund'?(state.financial.confirmedAt?'refunded':'pending'):null,protectionReason:decision.reason};
}
function eventDto(row:typeof commerceEvents.$inferSelect){let body:ObjectRecord={};try{body=object(JSON.parse(row.body))||{}}catch{}return {type:row.type,note:typeof body.note==='string'?body.note:undefined,createdAt:row.createdAt}}
export async function commerceAccountData(db:Db,userId:string){
 const owned=or(eq(commerceOrders.buyerUserId,userId),eq(commerceOrders.sellerUserId,userId));
 const orders=await db.select().from(commerceOrders).where(owned).orderBy(desc(commerceOrders.createdAt));
 const events=orders.length?await db.select().from(commerceEvents).where(inArray(commerceEvents.orderId,db.select({id:commerceOrders.id}).from(commerceOrders).where(owned))).orderBy(desc(commerceEvents.createdAt)):[];
 return {sandbox:true,complete:true,orders:orders.map(row=>commerceOrderDto(row,userId)),events:events.map(row=>({orderId:row.orderId,...eventDto(row)}))};
}
export async function commerceOwnedOrder(db:Db,userId:string,orderId:string,allowOperator=false){
 const [row]=await db.select().from(commerceOrders).where(and(eq(commerceOrders.id,orderId),allowOperator&&userId===ownerAccountId?sql`true`:or(eq(commerceOrders.buyerUserId,userId),eq(commerceOrders.sellerUserId,userId))));
 if(!row)throw new ApiRequestError('Order not found.',404);return row;
}
export async function commerceOverview(db:Db,userId:string,environment:StripeSandboxEnv,orderId?:string){
 if(orderId){const row=await commerceOwnedOrder(db,userId,orderId,true),events=await db.select().from(commerceEvents).where(eq(commerceEvents.orderId,row.id)).orderBy(desc(commerceEvents.createdAt)).limit(101),snapshot=snapshotOf(row),participant=row.buyerUserId===userId||row.sellerUserId===userId;return {...commerceSetup(environment),order:{...commerceOrderDto(row,userId),items:snapshot.items,photoIds:snapshot.photoIds||[],...(participant&&stateOf(row).order.paidAt?{shippingAddress:snapshot.shippingAddress}:{})},events:events.slice(0,100).reverse().map(eventDto),hasMoreEvents:events.length>100}}
 const [seller]=await db.select().from(commerceSellers).where(eq(commerceSellers.userId,userId));let ready=false;
 try{ready=object(JSON.parse(seller?.state||'{}'))?.ready===true}catch{}
 const orders=await db.select().from(commerceOrders).where(or(eq(commerceOrders.buyerUserId,userId),eq(commerceOrders.sellerUserId,userId))).orderBy(desc(commerceOrders.createdAt)).limit(101);
 return {...commerceSetup(environment),orders:orders.slice(0,100).map(row=>commerceOrderDto(row,userId)),hasMoreOrders:orders.length>100,seller:{registered:!!seller,onboardingRequired:!!seller&&!ready,ready}};
}
export async function commerceParticipant(db:Db,userId:string){
 const [profile]=await db.select().from(profiles).where(eq(profiles.userId,userId));
 if(!profile)throw new ApiRequestError('Create your free collector profile first.',403);
 if(profile.moderated||profile.deletionStartedAt||await isRestricted(db,userId))throw new ApiRequestError('Your account cannot start new commerce while restricted.',403);
 if(!profile.visible||profile.rulesVersion!==previewRulesVersion||!profile.rulesAcceptedAt)throw new ApiRequestError('Enable your collector showcase and accept the current community rules first.',403);
 return profile;
}
function transition(state:State,event:CommerceEvent,stamp=now()):State{
 const result=applyCommerceEvent(state,event,stamp);if(!result.accepted)throw new ApiRequestError('Order protection rejected this change: '+result.error,409);return result.state as State;
}
function eventBase(row:Row,eventId:string,source:CommerceEvent['source'],stamp=now()){return {eventId,orderId:row.id,buyerId:row.buyerId,sellerId:row.sellerId,source,occurredAt:stamp,verified:true as const}}
async function persist(db:Db,row:Row,state:State,type:string,body:ObjectRecord={},providerEventId:string|null=null,patch:Partial<typeof commerceOrders.$inferInsert>={},condition:SQL=sql`true`){
 const check=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM commerce_orders o WHERE o.id = ${row.id} AND o.version = ${row.version} AND o.sandbox = 1) AND ${condition}`),stamp=now();
 try{await db.batch([check.start,db.update(commerceOrders).set({...patch,state:JSON.stringify(state),status:state.status,version:row.version+1,updatedAt:stamp}).where(eq(commerceOrders.id,row.id)),db.insert(commerceEvents).values({id:crypto.randomUUID(),orderId:row.id,providerEventId,type,body:JSON.stringify(body),createdAt:stamp}),check.finish])}
 catch(error){if(operationGuardFailed(error))throw new ApiRequestError('Order changed. Refresh before trying again.',409);throw error}
 return (await db.select().from(commerceOrders).where(eq(commerceOrders.id,row.id)))[0];
}
async function boundSeller(db:Db,seller:Profile,processor:Processor){
 const [record]=await db.select().from(commerceSellers).where(and(eq(commerceSellers.profileId,seller.id),eq(commerceSellers.userId,seller.userId)));
 if(!record?.stripeAccountId)throw new ApiRequestError('This seller has not completed sandbox payment onboarding.',409);
 const account=await processor.retrieveAccount(record.stripeAccountId,{profileId:seller.id,userId:seller.userId});
 const capabilities=object(account.capabilities);
 if(account.country!=='US'||account.details_submitted!==true||capabilities?.transfers!=='active'||account.payouts_enabled!==true)throw new ApiRequestError('This seller must complete sandbox payment verification before checkout.',409);
 return record.stripeAccountId;
}
export async function commerceCheckout(db:Db,profile:Profile,email:string,raw:Record<string,unknown>,environment:StripeSandboxEnv){
 const input=commerceCheckoutSchema.parse(raw);needReady(environment);const processor=stripeSandbox(environment);
 const [previous]=await db.select().from(commerceOrders).where(and(eq(commerceOrders.buyerUserId,profile.userId),eq(commerceOrders.requestId,input.requestId)));
 let row:Row;
 if(previous){const snapshot=snapshotOf(previous);if(previous.listingId!==input.listingId||JSON.stringify(snapshot.shippingAddress)!==JSON.stringify(input.shippingAddress))throw new ApiRequestError('This checkout request was already used for a different order.',409);row=previous}
 else{
  const [listing]=await db.select().from(listings).where(eq(listings.id,input.listingId));
  if(!listing||listing.status!=='active'||listing.saleType!=='fixed')throw new ApiRequestError('Fixed-price listing is unavailable. Auctions are still nonbinding previews.',409);
  needShippingCheckout(listing);
  if(listing.safePurchaseOptIn)throw new ApiRequestError('This listing selected SafePurchase. Request inspection and accepted service terms before payment; no charge was started.',409);
  if(listing.sellerId===profile.id)throw new ApiRequestError('You cannot buy your own comic listing.',403);
  const [seller]=await db.select().from(profiles).where(eq(profiles.id,listing.sellerId));
  if(!seller?.visible||seller.moderated||seller.deletionStartedAt||seller.rulesVersion!==previewRulesVersion||!seller.rulesAcceptedAt||!listing.usaAttestedAt||await isRestricted(db,seller.userId)||await blocked(db,profile.id,seller.id))throw new ApiRequestError('Listing is unavailable for checkout.',404);
  const sellerAccountId=await boundSeller(db,seller,processor),items=listingItems(listing),total=listing.price+listing.shipping;
  if(!items.length||items.length!==listing.itemCount||!Number.isSafeInteger(total)||listing.price<100||listing.shipping<0||total>99_999_999)throw new ApiRequestError('Listing needs a valid bounded price and complete copy snapshot.',409);
  const [source]=await db.select().from(collections).where(eq(collections.userId,seller.userId));
  const selected=JSON.stringify(items.map(copy=>copy.bookId));
  if(!source)throw new ApiRequestError('The seller’s source collection is unavailable.',409);
  const orderId=crypto.randomUUID(),stamp=new Date(Math.floor(Date.now()/1000)*1000).toISOString();
  const state=createCommerceState({orderId,buyerId:profile.id,sellerId:seller.id,sellerAccountId,currency:'USD',totalCents:total,sellerTransferCents:total,createdAt:stamp,paymentIntentId:null,chargeId:null,paidAt:null});
  const photos=z.array(z.string().uuid()).max(6).parse(JSON.parse(listing.photos));
  const snapshot:Snapshot={title:listing.title,kind:listing.kind==='collection'?'collection':'single',fulfillment:'shipping',itemCount:items.length,items,photoIds:[...new Set([...photos,...items.flatMap(copy=>copy.photoId?[copy.photoId]:[])])],itemAmountCents:listing.price,shippingCents:listing.shipping,taxCents:0,totalCents:total,currency:'USD',sellerTransferCents:total,platformFeeCents:0,shippingAddress:input.shippingAddress,policyVersion:state.policy.version};
  const reservation=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM listings l JOIN profiles seller ON seller.id = l.seller_id JOIN profiles buyer ON buyer.id = ${profile.id} JOIN collections c ON c.user_id = seller.user_id WHERE l.id = ${listing.id} AND l.status = 'active' AND l.sale_type = 'fixed' AND l.fulfillment IN ('shipping','both') AND l.fulfillment = ${listing.fulfillment} AND l.price = ${listing.price} AND l.shipping = ${listing.shipping} AND l.items = ${listing.items} AND l.photos = ${listing.photos} AND l.vault_revision = ${listing.vaultRevision} AND c.revision = ${source.revision} AND l.usa_attested_at != '' AND seller.id != buyer.id AND buyer.user_id = ${profile.userId} AND seller.visible = 1 AND buyer.visible = 1 AND seller.moderated = 0 AND buyer.moderated = 0 AND seller.deletion_started_at IS NULL AND buyer.deletion_started_at IS NULL AND seller.rules_version = ${previewRulesVersion} AND buyer.rules_version = ${previewRulesVersion} AND seller.rules_accepted_at != '' AND buyer.rules_accepted_at != '' AND NOT EXISTS (SELECT 1 FROM account_restrictions r WHERE r.scope = 'account' AND r.user_id IN (seller.user_id,buyer.user_id)) AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.from_id = buyer.id AND b.to_id = seller.id) OR (b.from_id = seller.id AND b.to_id = buyer.id))) AND NOT EXISTS (SELECT 1 FROM commerce_orders o WHERE o.listing_id = ${listing.id} AND o.status NOT IN ('cancelled','refunded','checkout_expired')) AND NOT EXISTS (SELECT 1 FROM json_each(${selected}) copy WHERE copy.value NOT IN (SELECT json_extract(owned.value,'$.id') FROM collections c, json_each(c.data,'$.books') owned WHERE c.user_id = ${seller.userId}) OR NOT EXISTS (SELECT 1 FROM listing_inventory reserved WHERE reserved.seller_id = ${seller.id} AND reserved.listing_id = ${listing.id} AND reserved.book_id = copy.value)) AND NOT EXISTS (SELECT 1 FROM json_each(${JSON.stringify(snapshot.photoIds)}) photo WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.id = photo.value AND m.user_id = ${seller.userId})) AND EXISTS (SELECT 1 FROM commerce_sellers s WHERE s.profile_id = ${seller.id} AND s.user_id = ${seller.userId} AND s.stripe_account_id = ${sellerAccountId})`);
  try{await db.batch([reservation.start,db.insert(commerceOrders).values({id:orderId,buyerId:profile.id,buyerUserId:profile.userId,sellerId:seller.id,sellerUserId:seller.userId,listingId:listing.id,requestId:input.requestId,status:state.status,version:0,sandbox:1,snapshot:JSON.stringify(snapshot),state:JSON.stringify(state),checkoutSessionId:null,paymentIntentId:null,chargeId:null,transferId:null,createdAt:stamp,updatedAt:stamp}),db.update(listings).set({status:'checkout_reserved'}).where(eq(listings.id,listing.id)),db.update(offers).set({status:'closed'}).where(and(eq(offers.listingId,listing.id),eq(offers.status,'pending'))),db.insert(commerceEvents).values({id:crypto.randomUUID(),orderId,providerEventId:null,type:'checkout_reserved',body:JSON.stringify({note:'Sandbox only. No payment is confirmed. Tax and platform fee are zero in this test order.'}),createdAt:stamp}),reservation.finish])}
  catch(error){if(operationGuardFailed(error)||/commerce_(?:order_request|open_listing)_unique|UNIQUE constraint failed: commerce_orders/.test(String((error as Error)?.cause||error)))throw new ApiRequestError('This listing was reserved or changed. Refresh and try again.',409);throw error}
  row=(await db.select().from(commerceOrders).where(eq(commerceOrders.id,orderId)))[0];
 }
 stateOf(row);
 if(row.status!=='awaiting_payment')return {sandbox:true,order:commerceOrderDto(row,profile.userId),checkoutUrl:null,note:'This checkout is no longer open. A redirect is never proof of payment.'};
 // Retry identity is not a permit to restart commerce with a newly ineligible peer.
 const [currentSeller]=await db.select().from(profiles).where(eq(profiles.id,row.sellerId));
 if(!currentSeller?.visible||currentSeller.moderated||currentSeller.deletionStartedAt||currentSeller.rulesVersion!==previewRulesVersion||!currentSeller.rulesAcceptedAt||await isRestricted(db,currentSeller.userId)||await blocked(db,profile.id,row.sellerId))throw new ApiRequestError('This seller is no longer available for a new checkout attempt.',404);
 const [currentListing]=await db.select().from(listings).where(eq(listings.id,row.listingId));
 if(!currentListing||currentListing.status!=='checkout_reserved')throw new ApiRequestError('This checkout reservation requires review before payment can be restarted.',409);
 needShippingCheckout(currentListing);
 const snapshot=snapshotOf(row),origin=new URL(String(environment.COMMERCE_PUBLIC_ORIGIN)).origin;
 if(!row.checkoutSessionId)retryWindow(row.createdAt);
 // A timeout deliberately retains the reservation; the same persisted key is reused.
 const session=row.checkoutSessionId?await processor.retrieveCheckout(row.checkoutSessionId,{orderId:row.id,amountCents:snapshot.totalCents},{requirePaid:false}):await processor.createCheckout({orderId:row.id,amountCents:snapshot.totalCents,itemAmountCents:snapshot.itemAmountCents,shippingCents:snapshot.shippingCents,taxCents:0,title:snapshot.title,successUrl:origin+'/?section=Account&accountTab=Orders&checkout=return&order='+encodeURIComponent(row.id),cancelUrl:origin+'/?section=Account&accountTab=Orders&checkout=cancel&order='+encodeURIComponent(row.id),buyerEmail:email},'comichuddle_checkout_'+row.id);
 const sessionId=providerId(session),url=typeof session.url==='string'?session.url:null;
 if(!sessionId)throw new ApiRequestError('Sandbox checkout requires reconciliation.',502);
 if(!row.checkoutSessionId){const check=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM commerce_orders o WHERE o.id = ${row.id} AND (o.checkout_session_id IS NULL OR o.checkout_session_id = ${sessionId}) AND o.sandbox = 1)`);try{await db.batch([check.start,db.update(commerceOrders).set({checkoutSessionId:sessionId,updatedAt:now()}).where(eq(commerceOrders.id,row.id)),check.finish])}catch(error){if(operationGuardFailed(error))throw new ApiRequestError('Sandbox checkout requires reconciliation.',409);throw error}}
 row=(await db.select().from(commerceOrders).where(eq(commerceOrders.id,row.id)))[0];
 return {sandbox:true,order:commerceOrderDto(row,profile.userId),checkoutUrl:row.status==='awaiting_payment'&&session.status==='open'&&session.payment_status==='unpaid'?url:null,note:'Use test cards only. Payment is confirmed solely by a signed provider event.'};
}
export async function commerceOnboard(db:Db,profile:Profile,email:string,raw:Record<string,unknown>,environment:StripeSandboxEnv){
 commerceOnboardSchema.parse(raw);needReady(environment);const processor=stripeSandbox(environment),stamp=now();
 const registration=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM profiles p WHERE p.id = ${profile.id} AND p.user_id = ${profile.userId} AND p.deletion_started_at IS NULL AND p.moderated = 0 AND p.visible = 1 AND p.rules_version = ${previewRulesVersion} AND p.rules_accepted_at != '' AND NOT EXISTS (SELECT 1 FROM account_restrictions r WHERE r.user_id = p.user_id AND r.scope = 'account'))`);
 try{await db.batch([registration.start,db.insert(commerceSellers).values({profileId:profile.id,userId:profile.userId,stripeAccountId:null,state:JSON.stringify({ready:false,status:'onboarding_pending'}),updatedAt:stamp}).onConflictDoNothing(),registration.finish])}
 catch(error){if(operationGuardFailed(error))throw new ApiRequestError('Seller registration changed. Refresh before retrying.',409);throw error}
 const [record]=await db.select().from(commerceSellers).where(and(eq(commerceSellers.profileId,profile.id),eq(commerceSellers.userId,profile.userId)));
 if(!record)throw new ApiRequestError('Seller onboarding requires review.',409);
 if(!record.stripeAccountId)retryWindow(record.updatedAt);
 const account=record.stripeAccountId?await processor.retrieveAccount(record.stripeAccountId,{profileId:profile.id,userId:profile.userId}):await processor.createSellerAccount({profileId:profile.id,userId:profile.userId,email},'comichuddle_seller_'+profile.id);
 const accountId=providerId(account),metadata=object(account.metadata);
 if(!accountId||metadata?.profile_id!==profile.id||metadata?.user_id!==profile.userId||account.country!=='US')throw new ApiRequestError('Seller account verification did not match this collector.',502);
 const ready=account.details_submitted===true&&account.payouts_enabled===true&&object(account.capabilities)?.transfers==='active';
 const check=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM commerce_sellers s JOIN profiles p ON p.id = s.profile_id WHERE s.profile_id = ${profile.id} AND s.user_id = ${profile.userId} AND (s.stripe_account_id IS NULL OR s.stripe_account_id = ${accountId}) AND p.deletion_started_at IS NULL AND p.moderated = 0 AND NOT EXISTS (SELECT 1 FROM account_restrictions r WHERE r.user_id = p.user_id AND r.scope = 'account'))`);
 try{await db.batch([check.start,db.update(commerceSellers).set({stripeAccountId:accountId,state:JSON.stringify({ready,status:ready?'verified':'onboarding_required'}),updatedAt:stamp}).where(eq(commerceSellers.profileId,profile.id)),check.finish])}catch(error){if(operationGuardFailed(error))throw new ApiRequestError('Seller onboarding changed; refresh before retrying.',409);throw error}
 const origin=new URL(String(environment.COMMERCE_PUBLIC_ORIGIN)).origin,link=await processor.createAccountLink(accountId,{refreshUrl:origin+'/?section=Account&accountTab=Orders&seller=refresh',returnUrl:origin+'/?section=Account&accountTab=Orders&seller=return'});
 return {sandbox:true,onboardingUrl:typeof link.url==='string'?link.url:null,ready,note:'Stripe sandbox verification. Completing a return URL does not verify the seller.'};
}
export async function commerceSubmitTracking(db:Db,userId:string,raw:Record<string,unknown>){
 const input=commerceTrackingSchema.parse(raw),row=await commerceOwnedOrder(db,userId,input.orderId),state=stateOf(row);
 if(row.sellerUserId!==userId)throw new ApiRequestError('Only this order’s seller can submit tracking.',403);
 if(!state.order.paidAt||state.financial||['refunded','transferred'].includes(row.status))throw new ApiRequestError('Tracking is unavailable for this order.',409);
 if(state.trackingSubmission&&(state.trackingSubmission.carrier!==input.carrier||state.trackingSubmission.number!==input.trackingNumber))throw new ApiRequestError('Contact support before replacing the order’s tracking number.',409);
 if(state.trackingSubmission)return {sandbox:true,order:commerceOrderDto(row,userId),duplicate:true};
 state.trackingSubmission={carrier:input.carrier,number:input.trackingNumber,submittedAt:now(),verified:false};
 if(!state.holdReason)state.holdReason='tracking_verification_pending';state.version++;
 const next=evaluateCommercePolicy(state,now()).state as State;
 const updated=await persist(db,row,next,'tracking_submitted',{note:'Seller entered tracking. Carrier acceptance and delivery are unverified; payouts remain blocked.'});
 return {sandbox:true,order:commerceOrderDto(updated,userId),note:'Tracking is shared with the buyer and awaits carrier verification. A label is not proof of shipping.'};
}
export async function commerceRequestRefund(db:Db,userId:string,raw:Record<string,unknown>){
 const input=commerceRefundSchema.parse(raw),row=await commerceOwnedOrder(db,userId,input.orderId),state=stateOf(row);
 if(row.buyerUserId!==userId)throw new ApiRequestError('Only this order’s buyer can request a refund.',403);
 if(!state.order.paidAt||row.status==='refunded')throw new ApiRequestError('No refundable confirmed payment is available.',409);
 const event:CommerceEvent={...eventBase(row,'buyer_refund_'+input.requestId,'buyer'),type:'buyer_return_requested',actorId:row.buyerId,reason:input.reason};
 const existing=state.recentEvents.find(entry=>entry.id===event.eventId);
 if(existing){if(state.issue?.reason!==input.reason)throw new ApiRequestError('This refund request was already used for a different issue.',409);return {sandbox:true,order:commerceOrderDto(row,userId),duplicate:true}}
 const next=transition(state,event),updated=await persist(db,row,next,'buyer_refund_requested',{note:input.reason});
 return {sandbox:true,order:commerceOrderDto(updated,userId),note:state.financial?.kind==='transfer'?'Support must reconcile the seller transfer and buyer issue.':'Seller release is frozen while support reviews this request.'};
}
function exactRefundLedger(row:Row,state:State,ledger:Ledger|undefined):asserts ledger is Ledger{
 const financial=state.financial;
 if(!ledger||ledger.orderId!==row.id||ledger.kind!=='refund'||!financial||financial.kind!=='refund'||financial.requestId!==ledger.id||ledger.amountCents!==state.order.totalCents||financial.amountCents!==state.order.totalCents||!row.paymentIntentId||!['pending','reconciliation_required','succeeded'].includes(ledger.status)||(ledger.status==='succeeded'&&(!financial.confirmedAt||!ledger.providerId||financial.processorId!==ledger.providerId)))throw new ApiRequestError('The refund ledger does not match this complete order. Support must reconcile it before contacting the processor.',409);
}
async function refundLedger(db:Db,row:Row,state:State,requestId:string){
 const [requestOwner]=await db.select().from(commerceMoneyRequests).where(eq(commerceMoneyRequests.id,requestId));
 if(requestOwner&&(requestOwner.orderId!==row.id||requestOwner.kind!=='refund'))throw new ApiRequestError('This financial request ID was already used for another operation.',409);
 const [existing]=await db.select().from(commerceMoneyRequests).where(and(eq(commerceMoneyRequests.orderId,row.id),eq(commerceMoneyRequests.kind,'refund')));
 if(existing){exactRefundLedger(row,state,existing);if(existing.id!==requestId)throw new ApiRequestError('A refund is already reserved. Reuse its original request or contact support.',409);return {row,ledger:existing,state}}
 const stamp=now(),event:CommerceEvent={...eventBase(row,'refund_request_'+requestId,'server',stamp),type:'refund_requested',requestId,paymentIntentId:state.order.paymentIntentId!,currency:'USD',amountCents:state.order.totalCents},next=transition(state,event,stamp);
 const check=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM commerce_orders o WHERE o.id = ${row.id} AND o.version = ${row.version} AND o.sandbox = 1) AND NOT EXISTS (SELECT 1 FROM commerce_money_requests m WHERE m.order_id = ${row.id})`);
 try{await db.batch([check.start,db.update(commerceOrders).set({state:JSON.stringify(next),status:next.status,version:row.version+1,updatedAt:stamp}).where(eq(commerceOrders.id,row.id)),db.insert(commerceMoneyRequests).values({id:requestId,orderId:row.id,kind:'refund',status:'pending',amountCents:state.order.totalCents,providerId:null,createdAt:stamp,updatedAt:stamp}),db.insert(commerceEvents).values({id:crypto.randomUUID(),orderId:row.id,providerEventId:null,type:'refund_reserved',body:JSON.stringify({note:'Full sandbox refund reserved before contacting the processor.'}),createdAt:stamp}),check.finish])}
 catch(error){if(operationGuardFailed(error))throw new ApiRequestError('A financial operation is already reserved or the order changed.',409);throw error}
 return {row:(await db.select().from(commerceOrders).where(eq(commerceOrders.id,row.id)))[0],ledger:(await db.select().from(commerceMoneyRequests).where(eq(commerceMoneyRequests.id,requestId)))[0],state:next};
}
async function finishRefund(db:Db,row:Row,ledger:Ledger,refund:ObjectRecord,receiptId:string|null=null,fingerprint?:string){
 const state=stateOf(row),refundId=providerId(refund);
 exactRefundLedger(row,state,ledger);
 if(refund.amount!==state.order.totalCents||refund.currency!=='usd'||providerId(refund.payment_intent)!==row.paymentIntentId)throw new ApiRequestError('Refund confirmation does not match the full original payment.',409);
 if(!refundId)throw new ApiRequestError('Refund requires processor reconciliation.',502);
 if(refund.status!=='succeeded'){
  // A confirmed object ID is retained even when completion is still uncertain.
  const stamp=now(),check=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM commerce_orders o JOIN commerce_money_requests m ON m.order_id = o.id WHERE o.id = ${row.id} AND o.version = ${row.version} AND o.sandbox = 1 AND m.id = ${ledger.id} AND m.kind = 'refund' AND m.amount_cents = ${state.order.totalCents} AND m.status IN ('pending','reconciliation_required') AND (m.provider_id IS NULL OR m.provider_id = ${refundId}))`);
  try{await db.batch([check.start,db.update(commerceOrders).set({version:row.version+1,updatedAt:stamp}).where(eq(commerceOrders.id,row.id)),db.update(commerceMoneyRequests).set({providerId:refundId,status:refund.status==='pending'?'pending':'reconciliation_required',updatedAt:stamp}).where(eq(commerceMoneyRequests.id,ledger.id)),db.insert(commerceEvents).values({id:crypto.randomUUID(),orderId:row.id,providerEventId:receiptId,type:'refund_pending',body:JSON.stringify({note:'Processor refund completion remains unconfirmed.',...(fingerprint?{fingerprint}: {})}),createdAt:stamp}),check.finish])}catch(error){if(operationGuardFailed(error))throw new ApiRequestError('Refund pending response requires reconciliation.',409);throw error}
  return (await db.select().from(commerceOrders).where(eq(commerceOrders.id,row.id)))[0];
 }
 const stamp=now(),next=transition(state,{...eventBase(row,receiptId||'refund_confirmed_'+ledger.id,'stripe',stamp),type:'refund_confirmed',requestId:ledger.id,processorId:refundId,paymentIntentId:state.order.paymentIntentId!,currency:'USD',amountCents:ledger.amountCents},stamp);
 if(next.status!=='refunded'||!next.financial?.confirmedAt||next.financial.processorId!==refundId)throw new ApiRequestError('Refund confirmation requires reconciliation before order or inventory changes.',409);
 const check=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM commerce_orders o JOIN commerce_money_requests m ON m.order_id = o.id WHERE o.id = ${row.id} AND o.version = ${row.version} AND o.sandbox = 1 AND m.id = ${ledger.id} AND m.kind = 'refund' AND m.amount_cents = ${state.order.totalCents} AND m.status IN ('pending','reconciliation_required') AND (m.provider_id IS NULL OR m.provider_id = ${refundId}))`);
 try{await db.batch([check.start,db.update(commerceOrders).set({state:JSON.stringify(next),status:next.status,version:row.version+1,updatedAt:stamp}).where(eq(commerceOrders.id,row.id)),db.update(commerceMoneyRequests).set({providerId:refundId,status:'succeeded',updatedAt:stamp}).where(eq(commerceMoneyRequests.id,ledger.id)),db.update(listings).set({status:'refunded'}).where(eq(listings.id,row.listingId)),...(!state.shipment.acceptedAt&&!state.trackingSubmission?[db.delete(listingInventory).where(eq(listingInventory.listingId,row.listingId))]:[]),db.insert(commerceEvents).values({id:crypto.randomUUID(),orderId:row.id,providerEventId:receiptId,type:'refund_confirmed',body:JSON.stringify({note:'Full sandbox refund confirmed by the processor.',...(fingerprint?{fingerprint}: {})}),createdAt:stamp}),check.finish])}
 catch(error){if(operationGuardFailed(error))throw new ApiRequestError('Refund confirmation must be reconciled with the changed order.',409);throw error}
 return (await db.select().from(commerceOrders).where(eq(commerceOrders.id,row.id)))[0];
}
export async function commerceOwnerRefund(db:Db,userId:string,raw:Record<string,unknown>,environment:StripeSandboxEnv){
 if(userId!==ownerAccountId)throw new ApiRequestError('Owner access required.',403);
 const input=commerceOwnerRefundSchema.parse(raw);needReady(environment);const processor=stripeSandbox(environment);
 let row=await commerceOwnedOrder(db,userId,input.orderId,true),state=stateOf(row);
 const [held]=await db.select().from(commerceMoneyRequests).where(eq(commerceMoneyRequests.orderId,row.id));
 if(state.financial||held)exactRefundLedger(row,state,held);
 if(state.financial?.kind==='refund'&&state.financial.confirmedAt)return {sandbox:true,order:commerceOrderDto(row,userId),duplicate:true};
 if(!state.order.paidAt||!state.order.paymentIntentId||state.dispute!=='none'&&state.dispute!=='won')throw new ApiRequestError('Payment requires reconciliation before any refund.',409);
 // Re-retrieve the exact paid intent; never refund a redirect/client-paid claim.
 await processor.retrievePaymentIntent(state.order.paymentIntentId,{orderId:row.id,amountCents:state.order.totalCents,paymentIntentId:state.order.paymentIntentId});
 if(input.approveIssue===true&&state.issue?.open){
  const approved=transition(state,{...eventBase(row,'approve_refund_'+input.requestId,'operator'),type:'issue_resolved',resolution:'refund'});
  // A verified operator approval can refund during a carrier outage; it cannot release funds.
  if(!approved.financial&&approved.dispute!=='open'&&approved.dispute!=='lost'&&['tracking_verification_pending','checkout_eligibility_changed'].includes(approved.holdReason||''))approved.holdReason=null;
  const decision=evaluateCommercePolicy(approved,now());row=await persist(db,row,decision.state as State,'refund_claim_approved',{note:'Support approved the buyer’s full sandbox refund claim.'});state=stateOf(row);
 }
 const evaluated=evaluateCommercePolicy(state,now());
 if(JSON.stringify(evaluated.state)!==JSON.stringify(state)){row=await persist(db,row,evaluated.state as State,'protection_evaluated',{note:'Shipping deadlines evaluated by the server.'});state=stateOf(row)}
 if(!evaluateCommercePolicy(state,now()).refundEligible&&state.financial?.kind!=='refund')throw new ApiRequestError('Refund needs a missed shipping deadline or an approved buyer claim.',409);
 const reserved=await refundLedger(db,row,state,input.requestId);row=reserved.row;state=reserved.state;
 if(reserved.ledger.status==='succeeded')return {sandbox:true,order:commerceOrderDto(row,userId),duplicate:true};
 if(!reserved.ledger.providerId&&state.holdReason&&state.holdReason!=='tracking_verification_pending')throw new ApiRequestError('Unknown processor or custody state requires reconciliation before another refund POST.',409);
 if(!reserved.ledger.providerId)retryWindow(reserved.ledger.createdAt);
 const refund=reserved.ledger.providerId?await processor.retrieveRefund(reserved.ledger.providerId,{orderId:row.id,paymentIntentId:state.order.paymentIntentId!,amountCents:reserved.ledger.amountCents},{requireSucceeded:false}):await processor.createRefund({orderId:row.id,paymentIntentId:state.order.paymentIntentId!,amountCents:reserved.ledger.amountCents,orderAmountCents:state.order.totalCents,remainingAmountCents:state.order.totalCents},'comichuddle_refund_'+reserved.ledger.id);
 row=await finishRefund(db,row,reserved.ledger,refund);
 return {sandbox:true,order:commerceOrderDto(row,userId),note:refund.status==='succeeded'?'Sandbox refund confirmed.':'Refund is pending processor confirmation. The seller transfer remains frozen.'};
}
export async function commerceOwnerReconcile(db:Db,userId:string,raw:Record<string,unknown>,environment:StripeSandboxEnv){
 if(userId!==ownerAccountId)throw new ApiRequestError('Owner access required.',403);const input=commerceReconcileSchema.parse(raw);needReady(environment);
 const row=await commerceOwnedOrder(db,userId,input.orderId,true),state=stateOf(row),[ledger]=await db.select().from(commerceMoneyRequests).where(and(eq(commerceMoneyRequests.orderId,row.id),eq(commerceMoneyRequests.kind,'refund')));
 exactRefundLedger(row,state,ledger);
 if(ledger.status==='succeeded')return {sandbox:true,order:commerceOrderDto(row,userId),duplicate:true};
 if(!ledger.providerId)return commerceOwnerRefund(db,userId,{action:'owner_refund',orderId:row.id,requestId:ledger.id},environment);
 const refund=await stripeSandbox(environment).retrieveRefund(ledger.providerId,{orderId:row.id,paymentIntentId:row.paymentIntentId!,amountCents:ledger.amountCents},{requireSucceeded:false}),updated=await finishRefund(db,row,ledger,refund);
 return {sandbox:true,order:commerceOrderDto(updated,userId),note:'Only the existing persisted refund was retrieved. No new financial operation was created.'};
}
async function deterministicRefundId(orderId:string){const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('comichuddle-auto-refund:'+orderId)));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const h=Array.from(bytes.slice(0,16),v=>v.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20)}
export async function commerceOwnerSweep(db:Db,userId:string,raw:Record<string,unknown>,environment:StripeSandboxEnv){
 if(userId!==ownerAccountId)throw new ApiRequestError('Owner access required.',403);commerceSweepSchema.parse(raw);needReady(environment);
 const rows=await db.select().from(commerceOrders).where(inArray(commerceOrders.status,['awaiting_shipment','in_transit','delivered_review','release_eligible','refund_eligible','manual_review','refund_pending'])).orderBy(commerceOrders.updatedAt).limit(25),results=[];
 for(const row of rows){
  const state=stateOf(row),decision=evaluateCommercePolicy(state,now());
  // Without a live carrier adapter an entered label/number cannot be declared missing or delivered.
  if(state.trackingSubmission&&!state.shipment.validatedAt&&state.financial?.kind!=='refund'){results.push({orderId:row.id,result:'manual_review',reason:'carrier_verification_not_connected'});continue}
  if(!decision.refundEligible&&state.financial?.kind!=='refund'){results.push({orderId:row.id,result:decision.status,reason:decision.reason});continue}
  try{const result=state.financial?.kind==='refund'?await commerceOwnerReconcile(db,userId,{action:'owner_reconcile',orderId:row.id},environment):await commerceOwnerRefund(db,userId,{action:'owner_refund',orderId:row.id,requestId:await deterministicRefundId(row.id)},environment);results.push({orderId:row.id,result:result.order.status})}
  catch(error){results.push({orderId:row.id,result:'reconciliation_required',reason:error instanceof ApiRequestError?'order_or_policy_changed':error instanceof StripeSandboxError?'processor_response_unconfirmed':'operation_unconfirmed'})}
 }
 return {sandbox:true,results,scheduled:false,note:'Manual owner sweep only. No background scheduler or trusted carrier connector is installed.'};
}
async function receiptMatches(db:Db,eventId:string,fingerprint:string){
 const [receipt]=await db.select().from(commerceEvents).where(eq(commerceEvents.providerEventId,eventId));
 if(!receipt)return false;let body:ObjectRecord={};try{body=object(JSON.parse(receipt.body))||{}}catch{}
 if(body.fingerprint!==fingerprint)throw new ApiRequestError('A processor event ID was reused with different content.',409);return true;
}
function metadataOrder(data:ObjectRecord){
 const metadata=object(data.metadata)||{},canonical=metadata.order_id,alias=metadata.orderId;
 if(canonical!==undefined&&typeof canonical!=='string'||alias!==undefined&&typeof alias!=='string'||canonical!==undefined&&alias!==undefined&&canonical!==alias)throw new ApiRequestError('Processor order metadata does not match.',400);
 return typeof canonical==='string'?canonical:typeof alias==='string'?alias:undefined;
}
async function processorRow(db:Db,event:StripeVerifiedEvent){
 const data=event.data.object,orderId=metadataOrder(data),intentId=providerId(data.payment_intent),chargeId=providerId(data.charge);
 if(orderId)return (await db.select().from(commerceOrders).where(eq(commerceOrders.id,orderId)))[0];
 if(event.type==='charge.refunded'&&providerId(data))return (await db.select().from(commerceOrders).where(eq(commerceOrders.chargeId,providerId(data)!)))[0];
 if(intentId)return (await db.select().from(commerceOrders).where(eq(commerceOrders.paymentIntentId,intentId)))[0];
 if(chargeId)return (await db.select().from(commerceOrders).where(eq(commerceOrders.chargeId,chargeId)))[0];
 return undefined;
}
async function recordPaid(db:Db,row:Row,event:StripeVerifiedEvent,processor:Processor,fingerprint:string){
 const data=event.data.object,snapshot=snapshotOf(row);let sessionId=row.checkoutSessionId;
 if(event.type.startsWith('checkout.session.')){
  const eventSession=providerId(data);if(!eventSession||sessionId&&sessionId!==eventSession)throw new ApiRequestError('Checkout session does not match this order.',409);sessionId=eventSession;
 }
 if(!sessionId)throw new ApiRequestError('Checkout session binding is not yet recorded. Retry this signed event.',409);
 const binding={orderId:row.id,amountCents:snapshot.totalCents,...(row.paymentIntentId?{paymentIntentId:row.paymentIntentId}:{})},session=await processor.retrieveCheckout(sessionId,binding),intentId=providerId(session.payment_intent);
 if(!intentId||event.type==='payment_intent.succeeded'&&providerId(data)!==intentId)throw new ApiRequestError('Paid intent does not match this checkout.',409);
 const intent=await processor.retrievePaymentIntent(intentId,{orderId:row.id,amountCents:snapshot.totalCents,paymentIntentId:intentId}),chargeId=providerId(intent.latest_charge);
 if(!chargeId)throw new ApiRequestError('Paid charge is not confirmed.',409);
 const charge=await processor.retrieveCharge(chargeId,{orderId:row.id,amountCents:snapshot.totalCents,paymentIntentId:intentId});
 const state=stateOf(row),stamp=now(),completionMs=typeof event.created==='number'&&Number.isSafeInteger(event.created)?event.created*1000:NaN;
 const validCompletion=Number.isSafeInteger(completionMs)&&completionMs>=Date.parse(row.createdAt)&&completionMs<=Date.parse(stamp);
 const occurredAt=validCompletion?new Date(completionMs).toISOString():stamp;
 const next=transition(state,{...eventBase(row,event.id,'stripe',occurredAt),type:'payment_confirmed',paymentIntentId:intentId,chargeId,currency:'USD',amountCents:snapshot.totalCents},stamp);
 if(!state.order.paidAt)next.paymentTimingVerified=validCompletion;
 const [seller]=await db.select().from(profiles).where(eq(profiles.id,row.sellerId)),[buyer]=await db.select().from(profiles).where(eq(profiles.id,row.buyerId)),[listing]=await db.select().from(listings).where(eq(listings.id,row.listingId));
 if(!state.order.paidAt&&(!seller?.visible||!buyer?.visible||seller.moderated||buyer.moderated||seller.deletionStartedAt||buyer.deletionStartedAt||seller.rulesVersion!==previewRulesVersion||buyer.rulesVersion!==previewRulesVersion||!seller.rulesAcceptedAt||!buyer.rulesAcceptedAt||await isRestricted(db,row.sellerUserId)||await isRestricted(db,row.buyerUserId)||await blocked(db,row.buyerId,row.sellerId)||listing?.status!=='checkout_reserved'))next.holdReason='checkout_eligibility_changed';
 if(charge.disputed===true||Number(charge.amount_refunded)>0)next.holdReason='processor_charge_requires_reconciliation';
 if(!state.order.paidAt&&!validCompletion)next.holdReason='processor_payment_timing_requires_reconciliation';
 const evaluated=evaluateCommercePolicy(next,stamp).state;
 const check=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM commerce_orders o JOIN listings l ON l.id = o.listing_id WHERE o.id = ${row.id} AND o.version = ${row.version} AND o.sandbox = 1 AND o.status NOT IN ('cancelled','checkout_expired') AND (o.checkout_session_id IS NULL OR o.checkout_session_id = ${sessionId}) AND (o.payment_intent_id IS NULL OR o.payment_intent_id = ${intentId})) AND NOT EXISTS (SELECT 1 FROM commerce_events e WHERE e.provider_event_id = ${event.id})`);
 try{await db.batch([check.start,db.update(commerceOrders).set({checkoutSessionId:sessionId,paymentIntentId:intentId,chargeId,state:JSON.stringify(evaluated),status:evaluated.status,version:row.version+1,updatedAt:stamp}).where(eq(commerceOrders.id,row.id)),db.update(listings).set({status:'sold'}).where(and(eq(listings.id,row.listingId),eq(listings.status,'checkout_reserved'))),db.insert(commerceEvents).values({id:crypto.randomUUID(),orderId:row.id,providerEventId:event.id,type:'payment_confirmed',body:JSON.stringify({fingerprint,note:'Signed sandbox event and server-retrieved session, intent and charge confirm this exact order amount.',providerCreatedAt:typeof event.created==='number'?event.created:null}),createdAt:stamp}),check.finish])}
 catch(error){if(operationGuardFailed(error))throw new ApiRequestError('Order changed while confirming payment. Retry the signed event.',409);throw error}
 return {received:true,sandbox:true};
}
async function expireCheckout(db:Db,row:Row,event:StripeVerifiedEvent,processor:Processor,fingerprint:string){
 const sessionId=providerId(event.data.object),state=stateOf(row);
 if(!sessionId||row.checkoutSessionId&&row.checkoutSessionId!==sessionId||state.order.paidAt)throw new ApiRequestError('Expired checkout does not match an unpaid order.',409);
 const session=await processor.retrieveCheckout(sessionId,{orderId:row.id,amountCents:snapshotOf(row).totalCents},{requirePaid:false});
 if(session.status!=='expired'||session.payment_status!=='unpaid')throw new ApiRequestError('Checkout has not been confirmed expired and unpaid.',409);
 const stamp=now(),check=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM commerce_orders o WHERE o.id = ${row.id} AND o.version = ${row.version} AND o.status = 'awaiting_payment' AND o.payment_intent_id IS NULL AND o.sandbox = 1) AND NOT EXISTS (SELECT 1 FROM commerce_events e WHERE e.provider_event_id = ${event.id})`);
 try{await db.batch([check.start,db.update(commerceOrders).set({checkoutSessionId:sessionId,status:'checkout_expired',version:row.version+1,updatedAt:stamp}).where(eq(commerceOrders.id,row.id)),db.update(listings).set({status:'withdrawn'}).where(and(eq(listings.id,row.listingId),eq(listings.status,'checkout_reserved'))),db.delete(listingInventory).where(eq(listingInventory.listingId,row.listingId)),db.insert(commerceEvents).values({id:crypto.randomUUID(),orderId:row.id,providerEventId:event.id,type:'checkout_expired',body:JSON.stringify({fingerprint,note:'Processor confirmed this sandbox session expired without payment. The seller can explicitly create a fresh listing.'}),createdAt:stamp}),check.finish])}catch(error){if(operationGuardFailed(error))throw new ApiRequestError('Order changed while expiring checkout. Retry the signed event.',409);throw error}
 return {received:true,sandbox:true};
}
async function processorHold(db:Db,row:Row,event:StripeVerifiedEvent,processor:Processor,fingerprint:string){
 const state=stateOf(row);if(!state.order.paidAt||!row.paymentIntentId||!row.chargeId)throw new ApiRequestError('Processor issue requires a confirmed order binding.',409);
 const charge=await processor.retrieveCharge(row.chargeId,{orderId:row.id,paymentIntentId:row.paymentIntentId,amountCents:state.order.totalCents}),data=event.data.object;
 if(event.type.startsWith('charge.dispute.')&&providerId(data.charge)!==row.chargeId||event.type==='charge.refunded'&&providerId(data)!==row.chargeId||event.type.startsWith('refund.')&&providerId(data.payment_intent)!==row.paymentIntentId)throw new ApiRequestError('Processor issue does not match the order charge.',409);
 const stamp=now();
 const next=event.type.startsWith('charge.dispute.')?transition(state,{...eventBase(row,event.id,'stripe',stamp),type:'dispute_opened',paymentIntentId:row.paymentIntentId,currency:'USD',amountCents:state.order.totalCents},stamp):transition(state,{...eventBase(row,event.id,'stripe',stamp),type:'processor_unknown',reason:'processor_refund_reconciliation',paymentIntentId:row.paymentIntentId,currency:'USD',amountCents:state.order.totalCents},stamp);
 if(event.type==='charge.refunded'&&Number(charge.amount_refunded)<=0)throw new ApiRequestError('Refund is not reflected on the recorded charge.',409);
 await persist(db,row,next,'processor_issue',{fingerprint,note:'Processor dispute or refund requires support reconciliation. Seller release remains blocked.'},event.id);
 return {received:true,sandbox:true,manualReview:true};
}
/** Only verified raw-body Stripe events reach here; all payment proof is re-retrieved. */
export async function commerceApplyWebhook(db:Db,event:StripeVerifiedEvent,rawBody:Uint8Array,environment:StripeSandboxEnv){
 needReady(environment);if(event.livemode!==false)throw new ApiRequestError('Live payments are disabled.',400);
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(rawBody))),fingerprint=Array.from(digest,v=>v.toString(16).padStart(2,'0')).join('');
 if(await receiptMatches(db,event.id,fingerprint))return {received:true,sandbox:true,duplicate:true};
 const supported=['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.expired','payment_intent.succeeded','refund.created','refund.updated','refund.failed','charge.refunded','charge.dispute.created','charge.dispute.updated','charge.dispute.closed'];
 if(!supported.includes(event.type))return {received:true,sandbox:true,ignored:true};
 const processor=stripeSandbox(environment);
 // The webhook application owns durable receipt dedupe; the kernel's last64 is not a ledger.
 for(let attempt=0;attempt<3;attempt++){
  const row=await processorRow(db,event);if(!row)return {received:true,sandbox:true,ignored:true};
  try{
   if(['checkout.session.completed','checkout.session.async_payment_succeeded','payment_intent.succeeded'].includes(event.type))return await recordPaid(db,row,event,processor,fingerprint);
   if(event.type==='checkout.session.expired')return await expireCheckout(db,row,event,processor,fingerprint);
   if(event.type.startsWith('refund.')){
    const [ledger]=await db.select().from(commerceMoneyRequests).where(and(eq(commerceMoneyRequests.orderId,row.id),eq(commerceMoneyRequests.kind,'refund'))),refundId=providerId(event.data.object),state=stateOf(row);
    if(!refundId||!row.paymentIntentId)throw new ApiRequestError('Refund is not bound to a paid order.',409);
    if(!ledger||ledger.providerId&&ledger.providerId!==refundId){await processorHold(db,row,event,processor,fingerprint);return {received:true,sandbox:true,manualReview:true}}
    exactRefundLedger(row,state,ledger);
    const refund=await processor.retrieveRefund(refundId,{orderId:row.id,paymentIntentId:row.paymentIntentId,amountCents:ledger.amountCents},{requireSucceeded:false});
    if(state.financial?.requestId!==ledger.id||state.financial?.kind!=='refund')throw new ApiRequestError('Refund ledger does not match order protection state.',409);
    if(ledger.status==='succeeded'){
     await persist(db,row,state,'refund_confirmation_duplicate',{fingerprint,note:'Processor confirmed a previously completed sandbox refund.'},event.id);return {received:true,sandbox:true,duplicate:true};
    }
    await finishRefund(db,row,ledger,refund,event.id,fingerprint);return {received:true,sandbox:true};
   }
   return await processorHold(db,row,event,processor,fingerprint);
  }catch(error){
   if(await receiptMatches(db,event.id,fingerprint))return {received:true,sandbox:true,duplicate:true};
   if(error instanceof ApiRequestError&&error.status===409&&attempt<2)continue;
   throw error;
  }
 }
 throw new ApiRequestError('Processor event requires reconciliation.',409);
}
export function commerceError(error:unknown){
 if(error instanceof ApiRequestError)return privateJson({error:error.message},error.status);
 if(error instanceof z.ZodError)return privateJson({error:'Please check the fields. Only the documented sandbox action is accepted.'},400);
 if(error instanceof StripeSandboxError)return privateJson({error:error.message,code:error.code,pending:error.retryable,note:'Do not create a replacement request. Reconcile or retry the original persisted request.'},error.status);
 return privateJson({error:'This commerce operation was not confirmed. Refresh the order or contact maliktecks@gmail.com before retrying.'},500);
}
