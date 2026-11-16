import {ensureSellerPhotos} from './seller-photos';
import {and,desc,eq,inArray,or,sql,type SQL} from 'drizzle-orm';
import {z} from 'zod';
import {chooseShippingOption,parcelFor,quoteShippingRates,ShippingQuoteError} from './shipping-rates';
import {applyPayoutEvent,payoutProblem,sellerTier,syncPayoutSchedule} from './seller-payouts';
import {buyShippingLabel,labelAddressSchema,LabelError,type PurchasedLabel} from './shipping-labels';
import {getDb} from '../db';
import {commerceOrders,commerceEvents,commerceSellers,commerceMoneyRequests,listings,listingInventory,offers,profiles,collections,media} from '../db/schema';
import {ApiRequestError,isRestricted,privateJson} from './api-security';
import {blocked} from './conversations';
import {previewRulesVersion} from './community';
import {listingItems} from './marketplace';
import {conditionalGuard,operationGuardFailed} from './operation-guard';
import {ownerAccountId} from './owner';
import {createCommerceState,emptyInspection,evaluateCommercePolicy,applyCommerceEvent,type CommerceState,type CommerceEvent} from './commerce-policy';
import {sandboxSetup,stripeSandbox,stripeMode,stripePublishableKey,CHECKOUT_EXPIRY_SECONDS,StripeSandboxError,type StripeMode,type StripeSandboxEnv as StripeOnlyEnv,type StripeVerifiedEvent} from './stripe-sandbox';
import {MAX_PLATFORM_FEE_BPS,estimatedStripeFeeCents,payoutLegs,platformFeeConfig,saleBreakdown,type PlatformFeeEnv} from './commerce-fees';
import {recipientReady,stripeConnectV2,type StripeThinAccountEvent} from './stripe-connect-v2';
import {pickupCode,pickupCodeHash,pickupCodeMatches,protectionConfig,protectionPlan,type ProtectionEnv} from './commerce-protection';
import {carrierConfigured,carrierProblem,carrierStatusLabel,createCarrierTracker,retrieveCarrierTracker,type CarrierEnv,type CarrierFetch,type CarrierSummary,type CarrierUpdate,mergeTracking,emptyTracking,trackingRank,type TrackingProgress} from './commerce-carrier';
import {auctionTerms,ensureLocalAuctionSchema,markAuctionPaidStatement,wonAuctionPayable} from './marketplace-auction';
/** Payment, protection and carrier settings all come from server configuration. */
export type StripeSandboxEnv=StripeOnlyEnv&ProtectionEnv&CarrierEnv&PlatformFeeEnv&{COMMERCE_PAYOUTS_ENABLED?:unknown};

type Db=ReturnType<typeof getDb>;
type Profile=typeof profiles.$inferSelect;
type Row=typeof commerceOrders.$inferSelect;
type Ledger=typeof commerceMoneyRequests.$inferSelect;
type Processor=ReturnType<typeof stripeSandbox>;
type ObjectRecord=Record<string,unknown>;
type TrackingSubmission={carrier:string;number:string;submittedAt:string;verified:false};
/** A bought label lowers the seller payout by exactly its cost (commerceBuyLabel); nothing else may change it. */
const labelCost=(value:{label?:{costCents?:unknown}}|null|undefined)=>{const c=value?.label?.costCents;return typeof c==='number'&&Number.isSafeInteger(c)&&c>0?c:0};
/** Server-only order fields: the pickup code is stored only as a hash; the carrier tracker id binds webhooks. */
type State=CommerceState&{tracking?:TrackingProgress;label?:PurchasedLabel;trackingSubmission?:TrackingSubmission;paymentTimingVerified?:boolean;pickupCodeHash?:string;carrierTrackerId?:string;inboundTrackerId?:string;carrierStatus?:CarrierSummary};
const now=()=>new Date().toISOString();
const id=z.string().trim().min(1).max(100);
const uuid=z.string().uuid();
const line=(max:number)=>z.string().trim().min(1).max(max).refine(s=>!/[\u0000-\u001f\u007f]/.test(s));
const states=new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));
const addressSchema=z.object({name:line(100),line1:line(160),line2:z.string().trim().max(160).default(''),city:line(100),state:z.string().refine(v=>states.has(v)),postalCode:z.string().regex(/^\d{5}(?:-\d{4})?$/),country:z.literal('US')}).strict();
export const commerceCheckoutSchema=z.object({action:z.literal('checkout'),listingId:id,requestId:uuid,sandboxAcknowledged:z.literal(true),fulfillment:z.enum(['shipping','pickup']).default('shipping'),shippingAddress:addressSchema.optional(),shippingService:z.string().trim().max(80).optional(),storeCreditCents:z.number().int().min(0).max(100000000).default(0),checkoutUiMode:z.enum(['hosted_page','elements']).default('hosted_page'),safePurchaseOptIn:z.boolean().default(false),waiveSafePurchase:z.boolean().default(false)}).strict().superRefine((value,ctx)=>{if(value.fulfillment==='shipping'&&!value.shippingAddress)ctx.addIssue({code:z.ZodIssueCode.custom,path:['shippingAddress'],message:'Enter a USA shipping address.'})});
export const commerceTrackingSchema=z.object({action:z.literal('submit_tracking'),orderId:id,carrier:z.enum(['USPS','UPS','FedEx','DHL']),trackingNumber:z.string().trim().min(6).max(60).regex(/^[A-Za-z0-9 -]+$/)}).strict();
export const commerceRefundSchema=z.object({action:z.literal('request_refund'),orderId:id,requestId:uuid,reason:line(200),claimType:z.enum(['not_received','not_as_described','other']).default('other'),photoIds:z.array(z.string().uuid()).max(6).default([])}).strict();
export const commercePickupSchema=z.object({action:z.literal('confirm_pickup'),orderId:id}).strict();
export const commercePickupCodeSchema=z.object({action:z.literal('confirm_pickup_code'),orderId:id,code:z.string().trim().regex(/^\d{6}$/,'Enter the buyer’s 6-digit pickup code.')}).strict();
export const commerceCancelSchema=z.object({action:z.literal('cancel_order'),orderId:id,requestId:uuid}).strict();
export const commerceInspectionSchema=z.discriminatedUnion('step',[
 z.object({action:z.literal('inspection'),orderId:id,step:z.literal('receive')}).strict(),
 z.object({action:z.literal('inspection'),orderId:id,step:z.literal('decide'),result:z.enum(['passed','failed','partial']),reasons:z.array(line(200)).max(20).default([]),failedItems:z.number().int().min(0).max(1000).default(0),requestId:uuid}).strict(),
 z.object({action:z.literal('inspection'),orderId:id,step:z.literal('ship'),carrier:z.enum(['USPS','UPS','FedEx','DHL']),trackingNumber:z.string().trim().min(6).max(60).regex(/^[A-Za-z0-9 -]+$/)}).strict(),
 z.object({action:z.literal('inspection'),orderId:id,step:z.literal('handoff'),code:z.string().trim().regex(/^\d{6}$/)}).strict()
]);
export const commerceInspectionChoiceSchema=z.object({action:z.literal('inspection_choice'),orderId:id,choice:z.enum(['accept_partial','full_refund']),requestId:uuid}).strict();
export const commerceOwnerRefundSchema=z.object({action:z.literal('owner_refund'),orderId:id,requestId:uuid,approveIssue:z.literal(true).optional()}).strict();
export const commerceOnboardSchema=z.object({action:z.literal('seller_onboard'),sandboxAcknowledged:z.literal(true)}).strict();
export const commerceSweepSchema=z.object({action:z.literal('owner_sweep'),sandboxAcknowledged:z.literal(true)}).strict();
export const commerceReconcileSchema=z.object({action:z.literal('owner_reconcile'),orderId:id}).strict();

type ProtectionSnapshot={tier:'standard'|'safepurchase';overThreshold:boolean;safePurchaseRequested:boolean;comingSoon:boolean;waived:boolean;signatureRequired:boolean;insured:boolean;releaseHoldHours:number;handlingBusinessDays:number|null;claimDays:number};
type Snapshot={shippingService?:string;shippingServiceId?:string;storeCreditCents?:number;checkoutUiMode?:'hosted_page'|'elements';title:string;kind:'single'|'collection';fulfillment:'shipping'|'pickup';itemCount:number;items:ReturnType<typeof listingItems>;photoIds:string[];itemAmountCents:number;shippingCents:number;taxCents:0;totalCents:number;currency:'USD';sellerTransferCents:number;platformFeeCents:number;platformFeeBps?:number;inspectionFeeCents?:number;shippingAddress?:z.infer<typeof addressSchema>;policyVersion:string;protection?:ProtectionSnapshot;auction?:{winningCents:number}};
function stateOf(row:Row):State{
 let value:State;try{value=JSON.parse(row.state)}catch{throw new ApiRequestError('Order requires operator reconciliation.',409)}
 const snapshot=snapshotOf(row);
 if((row.sandbox!==0&&row.sandbox!==1)||!value||value.order?.orderId!==row.id||value.order?.buyerId!==row.buyerId||value.order?.sellerId!==row.sellerId||value.order?.createdAt!==row.createdAt||value.order?.currency!==snapshot.currency||value.order?.totalCents!==snapshot.totalCents||value.order?.sellerTransferCents!==snapshot.sellerTransferCents-labelCost(value)||(value.order?.storeCreditCents??0)!==(snapshot.storeCreditCents??0)||value.order?.paymentIntentId!==row.paymentIntentId||value.order?.chargeId!==row.chargeId||evaluateCommercePolicy(value,now()).reason==='invalid_or_unknown_state')throw new ApiRequestError('Order requires operator reconciliation.',409);
 return value;
}
function snapshotOf(row:Row):Snapshot{
 let snapshot:Snapshot;try{snapshot=JSON.parse(row.snapshot)}catch{throw new ApiRequestError('Order snapshot is unavailable.',409)}
 const fee=snapshot?.inspectionFeeCents??0,platformFee=snapshot?.platformFeeCents;
 if(!snapshot||snapshot.currency!=='USD'||!Number.isSafeInteger(snapshot.totalCents)||!Number.isSafeInteger(snapshot.itemAmountCents)||!Number.isSafeInteger(snapshot.shippingCents)||!Number.isSafeInteger(fee)||fee<0||snapshot.itemAmountCents<100||snapshot.shippingCents<0||snapshot.totalCents>99_999_999||!Number.isSafeInteger(snapshot.storeCreditCents??0)||(snapshot.storeCreditCents??0)<0||(snapshot.storeCreditCents??0)>snapshot.itemAmountCents||snapshot.totalCents!==snapshot.itemAmountCents+snapshot.shippingCents+fee-(snapshot.storeCreditCents??0)||!Number.isSafeInteger(platformFee)||platformFee<0||platformFee>snapshot.itemAmountCents||snapshot.platformFeeBps!==undefined&&(!Number.isSafeInteger(snapshot.platformFeeBps)||snapshot.platformFeeBps<0||snapshot.platformFeeBps>MAX_PLATFORM_FEE_BPS)||snapshot.sellerTransferCents!==snapshot.itemAmountCents+snapshot.shippingCents-platformFee||snapshot.taxCents!==0)throw new ApiRequestError('Order requires operator reconciliation.',409);
 // Orders created before pickup checkout existed were all shipping orders. Pickup orders carry
 // their own pickup-code confirmation and never a shipping address or shipping charge.
 const fulfillment=snapshot.fulfillment===undefined?'shipping':snapshot.fulfillment;
 if(fulfillment!=='shipping'&&fulfillment!=='pickup'||fulfillment==='shipping'&&!snapshot.shippingAddress||fulfillment==='pickup'&&(snapshot.shippingCents!==0||snapshot.shippingAddress))throw new ApiRequestError('This order’s delivery method requires operator reconciliation.',409);
 return {...snapshot,fulfillment};
}
function object(value:unknown):ObjectRecord|undefined{return value&&typeof value==='object'&&!Array.isArray(value)?value as ObjectRecord:undefined}
function providerId(value:unknown):string|undefined{return typeof value==='string'?value:typeof object(value)?.id==='string'?object(value)!.id as string:undefined}
function needReady(environment:StripeSandboxEnv){const setup=sandboxSetup(environment);if(!setup.ready)throw new ApiRequestError('Online checkout is temporarily unavailable. No payment was started.',503);return setup}
const allowedListingFulfillment={shipping:['shipping','both'],pickup:['pickup','both']} as const;
function needFulfillment(listing:{fulfillment:unknown},fulfillment:'shipping'|'pickup'){
 if(!(allowedListingFulfillment[fulfillment] as readonly unknown[]).includes(listing.fulfillment))throw new ApiRequestError(fulfillment==='pickup'?'This listing is shipping only. Choose shipping at checkout.':'This listing is local pickup only. Choose local pickup at checkout.',409);
}
function retryWindow(createdAt:string){const age=Date.now()-Date.parse(createdAt);if(!Number.isFinite(age)||age<0||age>=23*3600000)throw new ApiRequestError('The processor idempotency safety window expired. Support must reconcile the original operation before any new request.',409)}
// Session creation retries reuse the same idempotency key and a deterministic expires_at
// (order creation + CHECKOUT_EXPIRY_SECONDS), which Stripe requires to be ≥30 minutes ahead.
function checkoutCreationWindow(createdAt:string){const age=Date.now()-Date.parse(createdAt);if(!Number.isFinite(age)||age<0||age>=(CHECKOUT_EXPIRY_SECONDS-1800-120)*1000)throw new ApiRequestError('This checkout could not be started in time. Support must reconcile the reservation before a new checkout.',409)}
/** Orders persist sandbox=1 in test mode and sandbox=0 in live mode. */
function modeOf(environment:StripeSandboxEnv):StripeMode{return stripeMode(environment)==='live'?'live':'test'}
function modeFlag(environment:StripeSandboxEnv){return modeOf(environment)==='live'?0:1}
function walletMode(flag:number){return flag===1?'sandbox':'live'}
/** Processor operations only act on orders created in the deployment's current mode. */
function needMode(row:Row,environment:StripeSandboxEnv){if(row.sandbox!==modeFlag(environment))throw new ApiRequestError('This order belongs to the other payment mode. Switch modes before reconciling it.',409)}
// --- Seller Connect accounts --------------------------------------------------------------
// New sellers are Accounts v2 recipients (lib/stripe-connect-v2.ts, state.api='v2'). Sellers bound
// earlier through POST /v1/accounts keep the v1 readiness check (no api field in their state).
type SellerState={ready?:boolean;status?:string;mode?:StripeMode;api?:'v2'};
function sellerState(record:{state:string}|undefined):SellerState{try{return object(JSON.parse(record?.state||'{}')) as SellerState||{}}catch{return {}}}
function sellerMode(record:{state:string}):StripeMode{return sellerState(record).mode==='live'?'live':'test'}
function accountReady(account:ObjectRecord){return account.details_submitted===true&&account.payouts_enabled===true&&object(account.capabilities)?.transfers==='active'}
/** Re-retrieves the bound account from Stripe (v2 or legacy v1) and reports whether it can receive transfers. */
async function sellerAccountReady(environment:StripeSandboxEnv,processor:Processor,record:{state:string},accountId:string,binding:{profileId:string;userId:string}){
 if(sellerState(record).api==='v2')return recipientReady(await stripeConnectV2(environment).retrieveRecipientAccount(accountId,binding));
 const account=await processor.retrieveAccount(accountId,binding);
 return account.country==='US'&&accountReady(account);
}
// --- end seller Connect accounts -----------------------------------------------------------
export function commerceSetup(environment:StripeSandboxEnv){const config=sandboxSetup(environment),live=config.mode==='live',publishableKey=stripePublishableKey(environment),paused=environment.COMMERCE_NEW_CHECKOUT_PAUSED==='true',checkoutEnabled=config.checkoutEnabled&&!paused,protection=protectionConfig(environment);return {publishableKey,paymentElementEnabled:!!publishableKey&&config.ready,sandbox:!live,mode:config.mode,setup:{...config,checkoutEnabled,...(paused?{reason:'new_checkout_paused'}:{})},carrierConnected:carrierConfigured(environment),payoutsEnabled:false,productionPaymentsEnabled:live&&checkoutEnabled,provider:'Stripe',supportedPaymentMethods:['card','apple_pay','google_pay'],applePayRequiresEligibleDevice:true,
 platformFee:(({bps,minCents,maxCents,valid})=>({bps,minCents,maxCents,valid}))(platformFeeConfig(environment)),
 protection:{safePurchaseEnabled:protection.safePurchaseEnabled,safePurchaseThresholdCents:protection.thresholdCents,safePurchaseFeeCents:protection.feeCents,safePurchaseReleaseHoldHours:protection.safePurchaseHoldHours,standardReleaseHoldHours:protection.standardHoldHours,handlingBusinessDays:protection.handlingBusinessDays,claimDays:protection.claimDays}}}
const completedStatuses=new Set(['delivered_review','picked_up','release_eligible','transfer_pending','transferred']);
const hour=3600000;
export function commerceOrderDto(row:Row,userId:string){
 const state=stateOf(row),snapshot=snapshotOf(row),decision=evaluateCommercePolicy(state,now()),timingUnknown=state.paymentTimingVerified===false,tiered=state.policy.tier!==undefined;
 const shipment=state.shipment,role=row.buyerUserId===userId?'buyer':row.sellerUserId===userId?'seller':'operator';
 const tracking=shipment.trackingNumber&&(tiered||shipment.validatedAt)?{carrier:shipment.carrier!,number:shipment.trackingNumber,verified:!!shipment.acceptedAt||!!shipment.validatedAt&&state.policy.tier==='safepurchase',submittedAt:shipment.submittedAt!}:state.trackingSubmission||null;
 // Row status only changes on persisted events; time-based steps (window ended, deadline missed) are derived here.
 const status=['checkout_expired','cancelled'].includes(row.status)?row.status:decision.status;
 const protection=snapshot.protection||null,inspection=state.inspection||null,delivered=shipment.deliveredAt?Date.parse(shipment.deliveredAt):NaN;
 const claimDays=state.policy.claimDays??null,claimUntil=claimDays&&Number.isFinite(delivered)?new Date(delivered+claimDays*24*hour).toISOString():null;
 const sellerView=role!=='buyer',fundsAvailableAt=sellerView&&state.order.paidAt&&!['refunded','refund_pending','refund_eligible'].includes(status)?decision.releaseAt:null;
 return {id:row.id,listingId:row.listingId,title:snapshot.title,kind:snapshot.kind,fulfillment:snapshot.fulfillment,itemCount:snapshot.itemCount,role,status,sandbox:row.sandbox===1,
  // Marketplace fee: shown to the seller and the operator only. Buyers see one all-in price.
  ...(row.status==='awaiting_payment'?{reservedUntil:reservationEndsAt(row)}:{}),
  ...(role!=='buyer'?{saleCents:snapshot.itemAmountCents+snapshot.shippingCents,platformFeeCents:snapshot.platformFeeCents,platformFeeBps:snapshot.platformFeeBps??0,sellerNetCents:state.order.sellerTransferCents,labelCostCents:state.label?.costCents??0,label:state.label?{carrier:state.label.carrier,service:state.label.service,trackingCode:state.label.trackingCode,url:state.label.labelUrl,costCents:state.label.costCents,createdAt:state.label.createdAt}:null,canBuyLabel:role==='seller'&&snapshot.fulfillment==='shipping'&&!!state.order.paidAt&&!state.label&&!shipment.trackingNumber&&!state.financial&&state.policy.tier!=='safepurchase'&&!['refunded','refund_pending','cancelled'].includes(row.status)}:{}),storeCreditCents:snapshot.storeCreditCents||0,itemAmountCents:snapshot.itemAmountCents,shippingCents:snapshot.shippingCents,inspectionFeeCents:snapshot.inspectionFeeCents||0,taxCents:0,totalCents:snapshot.totalCents,currency:'USD',createdAt:row.createdAt,updatedAt:row.updatedAt,paidAt:timingUnknown?null:state.order.paidAt,paymentConfirmed:!!state.order.paidAt,paymentTimingVerified:!timingUnknown,trackingDeadlineAt:timingUnknown?null:decision.trackingDeadlineAt,carrierDeadlineAt:timingUnknown?null:decision.carrierDeadlineAt,reviewUntil:timingUnknown?null:decision.releaseAt,tracking,issue:state.issue,refundRequested:!!state.issue||!!state.refundReason,refundStatus:state.financial?.kind==='refund'?(state.financial.confirmedAt?'refunded':'pending'):null,protectionReason:decision.reason,
  protection,pickup:state.pickup||null,inspection:inspection?{received:!!inspection.receivedAt,result:inspection.result,reasons:inspection.reasons,failedItems:inspection.failedItems,totalItems:inspection.totalItems,buyerChoice:inspection.buyerChoice,partialRefundCents:inspection.partialRefundCents,inboundTracking:inspection.inbound?{carrier:inspection.inbound.carrier,number:inspection.inbound.trackingNumber}:null}:null,
  timeline:{paidAt:state.order.paidAt,labelCreatedAt:state.tracking?.labelCreatedAt||state.label?.createdAt||null,shippedAt:state.tracking?.shippedAt||shipment.acceptedAt||null,outForDeliveryAt:state.tracking?.outForDeliveryAt||null,deliveredAt:shipment.deliveredAt||state.tracking?.deliveredAt||null,readyForPickupAt:snapshot.fulfillment==='pickup'?state.order.paidAt:null,pickedUpAt:state.pickup?.confirmedAt||null,estDeliveryDate:shipment.deliveredAt?null:state.tracking?.estDeliveryDate||state.carrierStatus?.estDeliveryAt||null,exception:shipment.deliveredAt?null:state.tracking?.exception||null,checkpoints:(state.tracking?.checkpoints||[]).slice(-30).reverse()},
  carrierConfirmed:!!shipment.acceptedAt&&!state.pickup,deliveredAt:shipment.deliveredAt,signatureVerified:shipment.signatureVerified,
  canCancel:role==='buyer'&&decision.state.refundReason==='tracking_deadline'&&!state.financial&&!state.issue?.open,
  canConfirmPickup:role==='buyer'&&snapshot.fulfillment==='pickup'&&!!state.order.paidAt&&!state.pickup&&!state.financial&&(state.policy.tier!=='safepurchase'||status==='inspection_passed'),
  canEnterPickupCode:role==='seller'&&snapshot.fulfillment==='pickup'&&!!state.order.paidAt&&!state.pickup&&!state.financial&&state.policy.tier!=='safepurchase'&&!!state.pickupCodeHash,
  carrier:state.carrierStatus?{trackerId:state.carrierStatus.trackerId,status:state.carrierStatus.status,label:carrierStatusLabel(state.carrierStatus.status),problem:carrierProblem(state.carrierStatus.status),estDeliveryAt:state.carrierStatus.estDeliveryAt,lastScan:state.carrierStatus.lastScan,updatedAt:state.carrierStatus.updatedAt}:null,
  claimUntil,fundsAvailableAt,payoutsEnabled:false,feedbackEligible:completedStatuses.has(status)};
}
function eventDto(row:typeof commerceEvents.$inferSelect){let body:ObjectRecord={};try{body=object(JSON.parse(row.body))||{}}catch{}return {type:row.type,note:typeof body.note==='string'?body.note:undefined,createdAt:row.createdAt}}
export async function commerceAccountData(db:Db,userId:string){
 const owned=or(eq(commerceOrders.buyerUserId,userId),eq(commerceOrders.sellerUserId,userId));
 const orders=await db.select().from(commerceOrders).where(owned).orderBy(desc(commerceOrders.createdAt));
 const events=orders.length?await db.select().from(commerceEvents).where(inArray(commerceEvents.orderId,db.select({id:commerceOrders.id}).from(commerceOrders).where(owned))).orderBy(desc(commerceEvents.createdAt)):[];
 return {sandbox:!orders.some(row=>row.sandbox===0),complete:true,orders:orders.map(row=>commerceOrderDto(row,userId)),events:events.map(row=>({orderId:row.orderId,...eventDto(row)}))};
}
export async function commerceOwnedOrder(db:Db,userId:string,orderId:string,allowOperator=false){
 const [row]=await db.select().from(commerceOrders).where(and(eq(commerceOrders.id,orderId),allowOperator&&await commerceOperatorAllowed(userId,orderId)?sql`true`:or(eq(commerceOrders.buyerUserId,userId),eq(commerceOrders.sellerUserId,userId))));
 if(!row)throw new ApiRequestError('Order not found.',404);return row;
}
/** Adds participant-only extras: the buyer's pickup code and the inspection address for a SafePurchase seller. */
async function participantDto(row:Row,userId:string,environment:StripeSandboxEnv){
 const dto=commerceOrderDto(row,userId),state=stateOf(row),extra:{pickupCode?:string;inspectionAddress?:string}={};
 if(dto.role==='buyer'&&dto.fulfillment==='pickup'&&state.order.paidAt&&!state.pickup&&state.pickupCodeHash&&!state.financial){
  try{const code=await pickupCode(environment,row.id);if(await pickupCodeMatches(row.id,state.pickupCodeHash,code))extra.pickupCode=code}catch{}
 }
 const address=protectionConfig(environment).inspectionAddress;
 if(dto.role==='seller'&&state.policy.tier==='safepurchase'&&address&&!state.inspection?.receivedAt)extra.inspectionAddress=address;
 return {...dto,...extra};
}
/**
 * Thin v2 events may not reach the app (e.g. a local CLI relay forwards only snapshot events), so a
 * not-yet-ready seller is re-checked with Stripe on read: at most once per 60s per seller, or once per
 * 10s right after returning from hosted onboarding (?seller=return).
 */
async function refreshSellerIfStale(db:Db,seller:typeof commerceSellers.$inferSelect|undefined,environment:StripeSandboxEnv,returning:boolean){
 if(!seller?.stripeAccountId||sellerState(seller).ready===true||sellerMode(seller)!==modeOf(environment)||!sandboxSetup(environment).ready)return seller;
 const age=Date.now()-Date.parse(seller.updatedAt);if(Number.isFinite(age)&&age>=0&&age<(returning?10_000:60_000))return seller;
 try{await sellerAccountUpdated(db,seller.stripeAccountId,stripeSandbox(environment),modeOf(environment),environment)}catch{/* Stripe unavailable: keep the stored state */}
 return (await db.select().from(commerceSellers).where(eq(commerceSellers.profileId,seller.profileId)))[0];
}
export async function commerceOverview(db:Db,userId:string,environment:StripeSandboxEnv,orderId?:string,options:{sellerReturn?:boolean}={}){
 if(orderId){const row=await commerceOwnedOrder(db,userId,orderId,true),events=await db.select().from(commerceEvents).where(eq(commerceEvents.orderId,row.id)).orderBy(desc(commerceEvents.createdAt)).limit(101),snapshot=snapshotOf(row),participant=row.buyerUserId===userId||row.sellerUserId===userId;return {...commerceSetup(environment),order:{...await participantDto(row,userId,environment),items:snapshot.items,photoIds:snapshot.photoIds||[],...(participant&&stateOf(row).order.paidAt&&snapshot.shippingAddress&&(row.buyerUserId===userId||stateOf(row).policy.tier!=='safepurchase'&&!stateOf(row).shipment.deliveredAt&&stateOf(row).financial?.kind!=='refund')?{shippingAddress:snapshot.shippingAddress}:{})},events:events.slice(0,100).reverse().map(eventDto),hasMoreEvents:events.length>100}}
 const [stored]=await db.select().from(commerceSellers).where(eq(commerceSellers.userId,userId)),seller=await refreshSellerIfStale(db,stored,environment,options.sellerReturn===true);
 // A seller verified in the other payment mode must onboard again in this mode.
 const ready=!!seller&&!!seller.stripeAccountId&&sellerState(seller).ready===true&&sellerMode(seller)===modeOf(environment);
 let orders=await db.select().from(commerceOrders).where(or(eq(commerceOrders.buyerUserId,userId),eq(commerceOrders.sellerUserId,userId))).orderBy(desc(commerceOrders.createdAt)).limit(101);
 // Opening Orders also polls EasyPost for this account's shipments (at most once per 10 minutes per order).
 const polled=await commerceRefreshCarrierStatus(db,environment,{orderIds:orders.map(row=>row.id),limit:5}).catch(()=>({updated:0}));
 if(polled.updated)orders=await db.select().from(commerceOrders).where(or(eq(commerceOrders.buyerUserId,userId),eq(commerceOrders.sellerUserId,userId))).orderBy(desc(commerceOrders.createdAt)).limit(101);
 return {...commerceSetup(environment),orders:await Promise.all(orders.slice(0,100).map(row=>participantDto(row,userId,environment))),hasMoreOrders:orders.length>100,seller:{registered:!!seller,onboardingRequired:!!seller&&!ready,ready,...(seller?{tier:await sellerTier(userId,modeFlag(environment) as 0|1).catch(()=>null),payoutProblem:await payoutProblem(userId)}:{})}};
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
 const check=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM commerce_orders o WHERE o.id = ${row.id} AND o.version = ${row.version} AND o.sandbox = ${row.sandbox}) AND ${condition}`),stamp=now();
 try{await db.batch([check.start,db.update(commerceOrders).set({...patch,state:JSON.stringify(state),status:state.status,version:row.version+1,updatedAt:stamp}).where(eq(commerceOrders.id,row.id)),db.insert(commerceEvents).values({id:crypto.randomUUID(),orderId:row.id,providerEventId,type,body:JSON.stringify(body),createdAt:stamp}),check.finish])}
 catch(error){if(operationGuardFailed(error))throw new ApiRequestError('Order changed. Refresh before trying again.',409);throw error}
 return (await db.select().from(commerceOrders).where(eq(commerceOrders.id,row.id)))[0];
}
async function boundSeller(db:Db,seller:Profile,processor:Processor,environment:StripeSandboxEnv){
 const [record]=await db.select().from(commerceSellers).where(and(eq(commerceSellers.profileId,seller.id),eq(commerceSellers.userId,seller.userId)));
 if(!record?.stripeAccountId||sellerMode(record)!==processor.mode)throw new ApiRequestError('This seller has not completed payment onboarding.',409);
 if(!await sellerAccountReady(environment,processor,record,record.stripeAccountId,{profileId:seller.id,userId:seller.userId}))throw new ApiRequestError('This seller must complete payment verification before checkout.',409);
 return record.stripeAccountId;
}
export async function commerceCheckout(db:Db,profile:Profile,email:string,raw:Record<string,unknown>,environment:StripeSandboxEnv){
 const input=commerceCheckoutSchema.parse(raw);if(environment.COMMERCE_NEW_CHECKOUT_PAUSED==='true')throw new ApiRequestError('Online checkout is temporarily paused, and nothing was charged. Your existing orders and refunds remain available in Orders.',503);needReady(environment);if(input.checkoutUiMode==='elements'&&!commerceSetup(environment).paymentElementEnabled)throw new ApiRequestError('Stripe Payment Element needs a valid publishable key for the current payment mode. No payment was started.',503);const processor=stripeSandbox(environment),flag=modeFlag(environment),live=flag===0;
 let [previous]=await db.select().from(commerceOrders).where(and(eq(commerceOrders.buyerUserId,profile.userId),eq(commerceOrders.requestId,input.requestId)));
 // Re-opening checkout (new tab, reloaded dialog) resumes this buyer's own open reservation instead of failing.
 if(!previous){const [own]=await db.select().from(commerceOrders).where(and(eq(commerceOrders.buyerUserId,profile.userId),eq(commerceOrders.listingId,input.listingId),eq(commerceOrders.status,'awaiting_payment')));if(own){const snapshot=snapshotOf(own);if(snapshot.fulfillment!==input.fulfillment||JSON.stringify(snapshot.shippingAddress??null)!==JSON.stringify(input.shippingAddress??null)||(snapshot.storeCreditCents??0)!==input.storeCreditCents||(snapshot.checkoutUiMode??'hosted_page')!==input.checkoutUiMode)throw new ApiRequestError('You already have a checkout in progress for this listing with different details. Finish or let it expire from Orders before changing them.',409);previous=own}}
 let row:Row;
 if(previous){const snapshot=snapshotOf(previous);if(previous.listingId!==input.listingId||snapshot.fulfillment!==input.fulfillment||JSON.stringify(snapshot.shippingAddress??null)!==JSON.stringify(input.shippingAddress??null)||(snapshot.storeCreditCents??0)!==input.storeCreditCents||(snapshot.checkoutUiMode??'hosted_page')!==input.checkoutUiMode)throw new ApiRequestError('This checkout request was already used for a different order.',409);needMode(previous,environment);row=previous}
 else{
  const [listing]=await db.select().from(listings).where(eq(listings.id,input.listingId));
  // A won binding auction is payable only by its winner, at the winning price, inside the payment window.
  const terms=listing?.saleType==='auction'?(await auctionTerms(db,[listing.id])).get(listing.id):undefined,wonAuction=!!listing&&wonAuctionPayable(listing,terms,profile.id);
  if(!listing||!wonAuction&&(listing.status!=='active'||listing.saleType!=='fixed'))throw new ApiRequestError(listing?.saleType==='auction'?'Only the winning bidder can pay for this auction, within 48 hours of it ending.':'This listing is no longer available for checkout.',409);
  needFulfillment(listing,input.fulfillment);
  if(listing.sellerId===profile.id)throw new ApiRequestError('You cannot buy your own comic listing.',403);
  const [seller]=await db.select().from(profiles).where(eq(profiles.id,listing.sellerId));
  if(!seller?.visible||seller.moderated||seller.deletionStartedAt||seller.rulesVersion!==previewRulesVersion||!seller.rulesAcceptedAt||!listing.usaAttestedAt||await isRestricted(db,seller.userId)||await blocked(db,profile.id,seller.id))throw new ApiRequestError('Listing is unavailable for checkout.',404);
  await ensureSellerPhotos(seller.userId,JSON.parse(listing.photos));
  const itemAmount=wonAuction?terms!.winningCents!:listing.price,shippingQuote=input.fulfillment==='pickup'?null:await listingShipping(listing,input,environment),shippingAmount=shippingQuote?.cents??0;
  const plan=protectionPlan(protectionConfig(environment),{itemCents:itemAmount,fulfillment:input.fulfillment,sellerOptIn:!!listing.safePurchaseOptIn,buyerOptIn:input.safePurchaseOptIn,waiveSafePurchase:input.waiveSafePurchase});
  if(input.waiveSafePurchase&&!plan.waived)throw new ApiRequestError('SafePurchase can be waived only for a local pickup it would otherwise cover.',400);
  // Marketplace fee: snapshotted on the order so later rate changes never alter it. Buyers never pay it separately.
  const feeConfig=platformFeeConfig(environment);if(!feeConfig.valid)throw new ApiRequestError('The marketplace fee configuration is invalid. No order or payment was started.',503);
  const sale=saleBreakdown(itemAmount,shippingAmount,feeConfig);
  const sellerAccountId=await boundSeller(db,seller,processor,environment),items=listingItems(listing),gross=sale.sellerNetCents,total=itemAmount+shippingAmount+plan.feeCents-input.storeCreditCents;
  if(input.storeCreditCents>itemAmount||total<50)throw new ApiRequestError('Credit can reduce the item subtotal. At least $0.50 must remain for the card payment.',400);
  if(!items.length||items.length!==listing.itemCount||!Number.isSafeInteger(total)||itemAmount<100||shippingAmount<0||total>99_999_999)throw new ApiRequestError('Listing needs a valid bounded price and complete copy snapshot.',409);
  const [source]=await db.select().from(collections).where(eq(collections.userId,seller.userId));
  const selected=JSON.stringify(items.map(copy=>copy.bookId));
  if(!source)throw new ApiRequestError('The seller’s source collection is unavailable.',409);
  const orderId=crypto.randomUUID(),stamp=new Date(Math.floor(Date.now()/1000)*1000).toISOString();
  const state:State=createCommerceState({orderId,buyerId:profile.id,sellerId:seller.id,sellerAccountId,currency:'USD',totalCents:total,sellerTransferCents:gross,storeCreditCents:input.storeCreditCents,createdAt:stamp,paymentIntentId:null,chargeId:null,paidAt:null,fulfillment:input.fulfillment},plan.policy);
  if(plan.tier==='safepurchase')state.inspection=emptyInspection(items.length);
  const photos=z.array(z.string().uuid()).max(6).parse(JSON.parse(listing.photos)),policy=plan.policy;
  const protection:ProtectionSnapshot={tier:plan.tier,overThreshold:plan.overThreshold,safePurchaseRequested:plan.safePurchaseRequested,comingSoon:plan.comingSoon,waived:plan.waived,signatureRequired:policy.requiresSignature,insured:policy.insured===true,releaseHoldHours:policy.reviewHours,handlingBusinessDays:policy.handlingBusinessDays??null,claimDays:policy.claimDays??30};
  const snapshot:Snapshot={storeCreditCents:input.storeCreditCents,checkoutUiMode:input.checkoutUiMode,title:listing.title,kind:listing.kind==='collection'?'collection':'single',fulfillment:input.fulfillment,itemCount:items.length,items,photoIds:[...new Set([...photos,...items.flatMap(copy=>copy.photoId?[copy.photoId]:[])])],itemAmountCents:itemAmount,shippingCents:shippingAmount,...(shippingQuote?.service?{shippingService:shippingQuote.service,shippingServiceId:shippingQuote.serviceId}:{}),taxCents:0,totalCents:total,currency:'USD',sellerTransferCents:gross,platformFeeCents:sale.feeCents,platformFeeBps:sale.feeBps,...(plan.feeCents?{inspectionFeeCents:plan.feeCents}:{}),...(input.fulfillment==='shipping'?{shippingAddress:input.shippingAddress}:{}),policyVersion:state.policy.version,protection,...(wonAuction?{auction:{winningCents:itemAmount}}:{})};
  const listingState=wonAuction?sql`l.status = 'auction_won' AND l.sale_type = 'auction' AND l.leader_id = ${profile.id} AND l.current_bid = ${itemAmount} AND EXISTS (SELECT 1 FROM ch_web.marketplace_auction_terms t WHERE t.listing_id = l.id AND t.result = 'awaiting_payment' AND t.winner_id = ${profile.id} AND t.winning_cents = ${itemAmount} AND t.payment_due_at > ${new Date().toISOString()})`:sql`l.status = 'active' AND l.sale_type = 'fixed'`;
  const reservation=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM listings l JOIN profiles seller ON seller.id = l.seller_id JOIN profiles buyer ON buyer.id = ${profile.id} JOIN collections c ON c.user_id = seller.user_id WHERE l.id = ${listing.id} AND ${listingState} AND l.fulfillment IN (${sql.join(allowedListingFulfillment[input.fulfillment].map(value=>sql`${value}`),sql`, `)}) AND l.fulfillment = ${listing.fulfillment} AND l.price = ${listing.price} AND l.shipping = ${listing.shipping} AND l.items = ${listing.items} AND l.photos = ${listing.photos} AND l.vault_revision = ${listing.vaultRevision} AND c.revision = ${source.revision} AND l.usa_attested_at != '' AND seller.id != buyer.id AND buyer.user_id = ${profile.userId} AND seller.visible = 1 AND buyer.visible = 1 AND seller.moderated = 0 AND buyer.moderated = 0 AND seller.deletion_started_at IS NULL AND buyer.deletion_started_at IS NULL AND seller.rules_version = ${previewRulesVersion} AND buyer.rules_version = ${previewRulesVersion} AND seller.rules_accepted_at != '' AND buyer.rules_accepted_at != '' AND NOT EXISTS (SELECT 1 FROM account_restrictions r WHERE r.scope = 'account' AND r.user_id IN (seller.user_id,buyer.user_id)) AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.from_id = buyer.id AND b.to_id = seller.id) OR (b.from_id = seller.id AND b.to_id = buyer.id))) AND NOT EXISTS (SELECT 1 FROM commerce_orders o WHERE o.listing_id = ${listing.id} AND o.status NOT IN ('cancelled','refunded','checkout_expired')) AND NOT EXISTS (SELECT 1 FROM json_each(${selected}) copy WHERE copy.value NOT IN (SELECT json_extract(owned.value,'$.id') FROM collections c, json_each(c.data,'$.books') owned WHERE c.user_id = ${seller.userId}) OR NOT EXISTS (SELECT 1 FROM listing_inventory reserved WHERE reserved.seller_id = ${seller.id} AND reserved.listing_id = ${listing.id} AND reserved.book_id = copy.value)) AND NOT EXISTS (SELECT 1 FROM json_each(${JSON.stringify(snapshot.photoIds)}) photo WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.id = photo.value AND m.user_id = ${seller.userId})) AND EXISTS (SELECT 1 FROM commerce_sellers s WHERE s.profile_id = ${seller.id} AND s.user_id = ${seller.userId} AND s.stripe_account_id = ${sellerAccountId})`);
  try{await db.batch([reservation.start,db.insert(commerceOrders).values({id:orderId,buyerId:profile.id,buyerUserId:profile.userId,sellerId:seller.id,sellerUserId:seller.userId,listingId:listing.id,requestId:input.requestId,status:state.status,version:0,sandbox:flag,snapshot:JSON.stringify(snapshot),state:JSON.stringify(state),checkoutSessionId:null,paymentIntentId:null,chargeId:null,transferId:null,createdAt:stamp,updatedAt:stamp}),db.execute(sql`SELECT ch_web.reserve_store_credit(${orderId},${profile.userId},${walletMode(flag)},${input.storeCreditCents})`),db.update(listings).set({status:'checkout_reserved'}).where(eq(listings.id,listing.id)),db.update(offers).set({status:'closed'}).where(and(eq(offers.listingId,listing.id),eq(offers.status,'pending'))),db.insert(commerceEvents).values({id:crypto.randomUUID(),orderId,providerEventId:null,type:'checkout_reserved',body:JSON.stringify({note:(live?'Live order.':'Test-mode order.')+' No payment is confirmed yet. Protection: '+plan.tier+(plan.comingSoon?' (SafePurchase inspection coming soon)':'')+'. Tax and platform fee are zero in this order.'}),createdAt:stamp}),reservation.finish])}
  catch(error){if(operationGuardFailed(error)||/commerce_(?:order_request|open_listing)_unique|UNIQUE constraint failed: commerce_orders/.test(String((error as Error)?.cause||error)))throw new ApiRequestError('This listing was reserved or changed. Refresh and try again.',409);throw error}
  row=(await db.select().from(commerceOrders).where(eq(commerceOrders.id,orderId)))[0];
 }
 return continuePayment(db,row,profile,email,environment,processor);
}
// --- Buyer: resume or cancel an unpaid checkout ----------------------------------------------
export const commerceResumeSchema=z.object({action:z.literal('resume_payment'),orderId:id}).strict();
export const commerceCancelCheckoutSchema=z.object({action:z.literal('cancel_checkout'),orderId:id}).strict();
/** The reservation ends when the order's Checkout Session expires (fixed at order creation). */
const reservationEndsAt=(row:Row)=>new Date(Date.parse(row.createdAt)+CHECKOUT_EXPIRY_SECONDS*1000).toISOString();
async function buyerUnpaidOrder(db:Db,userId:string,orderId:string,environment:StripeSandboxEnv){
 needReady(environment);const row=await commerceOwnedOrder(db,userId,orderId);
 if(row.buyerUserId!==userId)throw new ApiRequestError('Only the buyer can pay for or cancel this checkout.',403);
 needMode(row,environment);stateOf(row);
 if(row.status!=='awaiting_payment')throw new ApiRequestError('This order is no longer waiting for payment.',409);
 return row;
}
/** Re-opens the order's existing session (or creates it, within the original window and expiry). Never a second order. */
export async function commerceResumePayment(db:Db,userId:string,email:string,raw:Record<string,unknown>,environment:StripeSandboxEnv){
 const input=commerceResumeSchema.parse(raw),row=await buyerUnpaidOrder(db,userId,input.orderId,environment);
 if(Date.now()>=Date.parse(reservationEndsAt(row)))throw new ApiRequestError('This reservation has ended. The listing returns to the marketplace shortly.',409);
 const [profile]=await db.select().from(profiles).where(eq(profiles.id,row.buyerId));if(!profile)throw new ApiRequestError('Buyer profile is unavailable.',409);
 const result=await continuePayment(db,row,profile,email,environment,stripeSandbox(environment));
 if(!result.clientSecret&&!result.checkoutUrl)throw new ApiRequestError('This checkout can no longer be paid. If it expired, the listing returns to the marketplace shortly.',409);
 return {...result,reservedUntil:reservationEndsAt(row)};
}
/** Buyer cancels before paying: expire the open session at Stripe, then release the listing immediately. */
export async function commerceCancelCheckout(db:Db,userId:string,raw:Record<string,unknown>,environment:StripeSandboxEnv){
 const input=commerceCancelCheckoutSchema.parse(raw),row=await buyerUnpaidOrder(db,userId,input.orderId,environment),processor=stripeSandbox(environment),snapshot=snapshotOf(row);
 if(row.checkoutSessionId){
  const binding={orderId:row.id,amountCents:snapshot.totalCents},current=await processor.retrieveCheckout(row.checkoutSessionId,binding,{requirePaid:false});
  if(current.status==='complete'||current.payment_status!=='unpaid')throw new ApiRequestError('Payment was already submitted for this order. Wait for confirmation in Orders.',409);
  if(current.status==='open'){const expired=await processor.expireCheckout(row.checkoutSessionId,binding,'comichuddle_cancel_'+row.id);if(expired.status!=='expired'||expired.payment_status!=='unpaid')throw new ApiRequestError('The checkout could not be cancelled. Check Orders before retrying.',409)}
 }
 await releaseCheckout(db,row,null,row.checkoutSessionId,'cancelled','The buyer cancelled before paying. No money was collected and the listing is available again.','');
 const [updated]=await db.select().from(commerceOrders).where(eq(commerceOrders.id,row.id));
 return {sandbox:updated.sandbox===1,order:commerceOrderDto(updated,userId),note:'Checkout cancelled. No payment was taken.'};
}
// --- end buyer resume/cancel --------------------------------------------------------------------
/** Returns the open payment for an awaiting_payment order (same session and idempotency rules as the original checkout). */
async function continuePayment(db:Db,row:Row,profile:Profile,email:string,environment:StripeSandboxEnv,processor:Processor){
 const live=modeOf(environment)==='live';
 stateOf(row);
 if(row.status!=='awaiting_payment')return {sandbox:row.sandbox===1,order:commerceOrderDto(row,profile.userId),checkoutUrl:null,note:'This checkout is no longer open. A redirect is never proof of payment.'};
 // Retry identity is not a permit to restart commerce with a newly ineligible peer.
 const [currentSeller]=await db.select().from(profiles).where(eq(profiles.id,row.sellerId));
 if(!currentSeller?.visible||currentSeller.moderated||currentSeller.deletionStartedAt||currentSeller.rulesVersion!==previewRulesVersion||!currentSeller.rulesAcceptedAt||await isRestricted(db,currentSeller.userId)||await blocked(db,profile.id,row.sellerId))throw new ApiRequestError('This seller is no longer available for a new checkout attempt.',404);
 const [currentListing]=await db.select().from(listings).where(eq(listings.id,row.listingId));
 if(!currentListing||currentListing.status!=='checkout_reserved')throw new ApiRequestError('This checkout reservation requires review before payment can be restarted.',409);
 needFulfillment(currentListing,snapshotOf(row).fulfillment);
 const snapshot=snapshotOf(row),origin=new URL(String(environment.COMMERCE_PUBLIC_ORIGIN)).origin;
 if(!row.checkoutSessionId)checkoutCreationWindow(row.createdAt);
 // A timeout deliberately retains the reservation; the same persisted key and expiry are reused.
 // The session expires an hour after the order, which releases the listing via checkout.session.expired.
 const expiresAt=Math.floor(Date.parse(row.createdAt)/1000)+CHECKOUT_EXPIRY_SECONDS;
 const session=row.checkoutSessionId?await processor.retrieveCheckout(row.checkoutSessionId,{orderId:row.id,amountCents:snapshot.totalCents},{requirePaid:false}):await processor.createCheckout({orderId:row.id,amountCents:snapshot.totalCents,uiMode:snapshot.checkoutUiMode||'hosted_page',itemAmountCents:snapshot.itemAmountCents+(snapshot.inspectionFeeCents||0)-(snapshot.storeCreditCents||0),shippingCents:snapshot.shippingCents,taxCents:0,title:snapshot.title,successUrl:origin+'/?section=Account&accountTab=Orders&checkout=return&order='+encodeURIComponent(row.id),cancelUrl:origin+'/?section=Account&accountTab=Orders&checkout=cancel&order='+encodeURIComponent(row.id),buyerEmail:email,expiresAt},'comichuddle_checkout_'+row.id);
 const sessionId=providerId(session),url=typeof session.url==='string'?session.url:null;
 if(!sessionId)throw new ApiRequestError('Checkout requires reconciliation.',502);
 if(!row.checkoutSessionId){const check=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM commerce_orders o WHERE o.id = ${row.id} AND (o.checkout_session_id IS NULL OR o.checkout_session_id = ${sessionId}) AND o.sandbox = ${row.sandbox})`);try{await db.batch([check.start,db.update(commerceOrders).set({checkoutSessionId:sessionId,updatedAt:now()}).where(eq(commerceOrders.id,row.id)),check.finish])}catch(error){if(operationGuardFailed(error))throw new ApiRequestError('Checkout requires reconciliation.',409);throw error}}
 row=(await db.select().from(commerceOrders).where(eq(commerceOrders.id,row.id)))[0];
 const clientSecret=typeof session.client_secret==='string'&&session.client_secret.startsWith(String(sessionId)+'_secret_')?session.client_secret:null;
 return {clientSecret:snapshot.checkoutUiMode==='elements'&&row.status==='awaiting_payment'&&session.status==='open'?clientSecret:null,publishableKey:commerceSetup(environment).publishableKey,sandbox:row.sandbox===1,order:commerceOrderDto(row,profile.userId),checkoutUrl:row.status==='awaiting_payment'&&session.status==='open'&&session.payment_status==='unpaid'?url:null,note:(live?'':'Use test cards only. ')+'Payment is confirmed solely by a signed provider event.'};
}
export async function commerceOnboard(db:Db,profile:Profile,email:string,raw:Record<string,unknown>,environment:StripeSandboxEnv){
 commerceOnboardSchema.parse(raw);needReady(environment);const processor=stripeSandbox(environment),stamp=now(),mode=modeOf(environment);
 const registration=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM profiles p WHERE p.id = ${profile.id} AND p.user_id = ${profile.userId} AND p.deletion_started_at IS NULL AND p.moderated = 0 AND p.visible = 1 AND p.rules_version = ${previewRulesVersion} AND p.rules_accepted_at != '' AND NOT EXISTS (SELECT 1 FROM account_restrictions r WHERE r.user_id = p.user_id AND r.scope = 'account'))`);
 try{await db.batch([registration.start,db.insert(commerceSellers).values({profileId:profile.id,userId:profile.userId,stripeAccountId:null,state:JSON.stringify({ready:false,status:'onboarding_pending',mode}),updatedAt:stamp}).onConflictDoNothing(),registration.finish])}
 catch(error){if(operationGuardFailed(error))throw new ApiRequestError('Seller registration changed. Refresh before retrying.',409);throw error}
 let [record]=await db.select().from(commerceSellers).where(and(eq(commerceSellers.profileId,profile.id),eq(commerceSellers.userId,profile.userId)));
 if(!record)throw new ApiRequestError('Seller onboarding requires review.',409);
 // A Stripe account from the other mode cannot be used here (test accounts do not exist in live).
 // Unbind it explicitly so this mode starts a fresh, correctly bound onboarding.
 if(sellerMode(record)!==mode){
  const reset=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM commerce_sellers s WHERE s.profile_id = ${profile.id} AND s.user_id = ${profile.userId} AND s.state = ${record.state} AND s.stripe_account_id IS NOT DISTINCT FROM ${record.stripeAccountId})`);
  try{await db.batch([reset.start,db.update(commerceSellers).set({stripeAccountId:null,state:JSON.stringify({ready:false,status:'onboarding_pending',mode}),updatedAt:stamp}).where(eq(commerceSellers.profileId,profile.id)),reset.finish])}catch(error){if(operationGuardFailed(error))throw new ApiRequestError('Seller onboarding changed; refresh before retrying.',409);throw error}
  [record]=await db.select().from(commerceSellers).where(and(eq(commerceSellers.profileId,profile.id),eq(commerceSellers.userId,profile.userId)));
  if(!record)throw new ApiRequestError('Seller onboarding requires review.',409);
 }
 if(!record.stripeAccountId)retryWindow(record.updatedAt);
 // New bindings use Accounts v2 (POST /v1/accounts is no longer available to new Connect platforms).
 // A legacy v1 binding keeps its account and the v1 readiness check.
 const binding={profileId:profile.id,userId:profile.userId},v2=stripeConnectV2(environment),legacy=!!record.stripeAccountId&&sellerState(record).api!=='v2';
 let accountId:string|undefined,ready:boolean;
 if(legacy){const account=await processor.retrieveAccount(record.stripeAccountId!,binding),metadata=object(account.metadata);accountId=providerId(account);if(!accountId||metadata?.profile_id!==profile.id||metadata?.user_id!==profile.userId||account.country!=='US')throw new ApiRequestError('Seller account verification did not match this collector.',502);ready=accountReady(account)}
 else{const account=record.stripeAccountId?await v2.retrieveRecipientAccount(record.stripeAccountId,binding):await v2.createRecipientAccount({...binding,email,displayName:profile.name},(mode==='live'?'comichuddle_seller_v2_live_':'comichuddle_seller_v2_')+profile.id);accountId=providerId(account);if(!accountId)throw new ApiRequestError('Seller account verification did not match this collector.',502);ready=recipientReady(account)}
 const check=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM commerce_sellers s JOIN profiles p ON p.id = s.profile_id WHERE s.profile_id = ${profile.id} AND s.user_id = ${profile.userId} AND (s.stripe_account_id IS NULL OR s.stripe_account_id = ${accountId}) AND p.deletion_started_at IS NULL AND p.moderated = 0 AND NOT EXISTS (SELECT 1 FROM account_restrictions r WHERE r.user_id = p.user_id AND r.scope = 'account'))`);
 try{await db.batch([check.start,db.update(commerceSellers).set({stripeAccountId:accountId,state:JSON.stringify({ready,status:ready?'verified':'onboarding_required',mode,...(legacy?{}:{api:'v2'})}),updatedAt:stamp}).where(eq(commerceSellers.profileId,profile.id)),check.finish])}catch(error){if(operationGuardFailed(error))throw new ApiRequestError('Seller onboarding changed; refresh before retrying.',409);throw error}
 const origin=new URL(String(environment.COMMERCE_PUBLIC_ORIGIN)).origin,urls={refreshUrl:origin+'/?section=Account&accountTab=Orders&seller=refresh',returnUrl:origin+'/?section=Account&accountTab=Orders&seller=return'};
 const onboardingUrl=legacy?(link=>typeof link.url==='string'?link.url:null)(await processor.createAccountLink(accountId,urls)):(await v2.createOnboardingLink(accountId,urls)).url;
 return {sandbox:mode==='test',onboardingUrl,ready,note:'Stripe '+(mode==='live'?'':'sandbox ')+'verification. Completing a return URL does not verify the seller.'};
}
async function registerTracker(environment:StripeSandboxEnv,carrier:string,trackingNumber:string,fetcher?:CarrierFetch){
 try{return (await createCarrierTracker(environment,carrier,trackingNumber,fetcher))?.id??null}catch{return null}
}
export async function commerceSubmitTracking(db:Db,userId:string,raw:Record<string,unknown>,environment:StripeSandboxEnv={},fetcher?:CarrierFetch){
 const input=commerceTrackingSchema.parse(raw),row=await commerceOwnedOrder(db,userId,input.orderId),state=stateOf(row),snapshot=snapshotOf(row);
 if(row.sellerUserId!==userId)throw new ApiRequestError('Only this order’s seller can submit tracking.',403);
 if(!state.order.paidAt||state.financial||['refunded','transferred'].includes(row.status))throw new ApiRequestError('Tracking is unavailable for this order.',409);
 if(snapshot.fulfillment==='pickup')throw new ApiRequestError('Local pickup orders don’t use tracking. At the hand-off, enter the buyer’s 6-digit pickup code.',409);
 if(state.policy.tier==='safepurchase'){
  const inbound=state.inspection?.inbound;
  if(inbound){if(inbound.carrier===input.carrier&&inbound.trackingNumber===input.trackingNumber)return {sandbox:row.sandbox===1,order:commerceOrderDto(row,userId),duplicate:true};throw new ApiRequestError('Contact support before replacing the tracking number to the inspection center.',409)}
  const stamp=now(),next=transition(state,{...eventBase(row,'inbound_'+input.trackingNumber,'server',stamp),type:'inspection_inbound',carrier:input.carrier,trackingNumber:input.trackingNumber,submittedAt:stamp},stamp);
  const trackerId=await registerTracker(environment,input.carrier,input.trackingNumber,fetcher);if(trackerId)next.inboundTrackerId=trackerId;
  const updated=await persist(db,row,next,'inspection_inbound',{note:'Seller shipped the order to the ComicHuddle Inspection Center.'});
  return {sandbox:row.sandbox===1,order:commerceOrderDto(updated,userId),note:'Tracking to the Inspection Center is recorded. The buyer is told the order is on its way to inspection.'};
 }
 if(state.policy.tier==='standard'){
  if(state.shipment.trackingNumber){if(state.shipment.carrier===input.carrier&&state.shipment.trackingNumber===input.trackingNumber)return {sandbox:row.sandbox===1,order:commerceOrderDto(row,userId),duplicate:true};throw new ApiRequestError('Contact support before replacing the order’s tracking number.',409)}
  const stamp=now(),next=transition(state,{...eventBase(row,'tracking_'+input.trackingNumber,'server',stamp),type:'tracking_submitted',carrier:input.carrier,trackingNumber:input.trackingNumber},stamp);
  const trackerId=await registerTracker(environment,input.carrier,input.trackingNumber,fetcher);if(trackerId)next.carrierTrackerId=trackerId;
  let updated=await persist(db,row,next,'tracking_submitted',{note:trackerId?'Seller entered tracking; carrier updates will confirm handoff and delivery.':'Seller entered tracking. Carrier confirmation is not connected, so delivery is not confirmed automatically.'});
  // Read the tracker once right away (test trackers and quick scans return status immediately).
  if(trackerId){await commerceRefreshCarrierStatus(db,environment,{orderIds:[row.id],limit:1,minIntervalMs:0,fetcher}).catch(()=>undefined);updated=(await db.select().from(commerceOrders).where(eq(commerceOrders.id,row.id)))[0]}
  return {sandbox:row.sandbox===1,order:commerceOrderDto(updated,userId),note:trackerId?'Tracking shared with the buyer. Carrier updates will confirm delivery automatically.':'Tracking shared with the buyer. It stays “awaiting carrier confirmation” until delivery is confirmed.'};
 }
 if(state.trackingSubmission&&(state.trackingSubmission.carrier!==input.carrier||state.trackingSubmission.number!==input.trackingNumber))throw new ApiRequestError('Contact support before replacing the order’s tracking number.',409);
 if(state.trackingSubmission)return {sandbox:row.sandbox===1,order:commerceOrderDto(row,userId),duplicate:true};
 state.trackingSubmission={carrier:input.carrier,number:input.trackingNumber,submittedAt:now(),verified:false};
 if(!state.holdReason)state.holdReason='tracking_verification_pending';state.version++;
 const next=evaluateCommercePolicy(state,now()).state as State;
 const updated=await persist(db,row,next,'tracking_submitted',{note:'Seller entered tracking. Carrier acceptance and delivery are unverified; payouts remain blocked.'});
 return {sandbox:row.sandbox===1,order:commerceOrderDto(updated,userId),note:'Tracking is shared with the buyer and awaits carrier verification. A label is not proof of shipping.'};
}
export async function commerceRequestRefund(db:Db,userId:string,raw:Record<string,unknown>){
 const input=commerceRefundSchema.parse(raw),row=await commerceOwnedOrder(db,userId,input.orderId),state=stateOf(row);
 if(row.buyerUserId!==userId)throw new ApiRequestError('Only this order’s buyer can request a refund.',403);
 if(!state.order.paidAt||row.status==='refunded')throw new ApiRequestError('No refundable confirmed payment is available.',409);
 const reason=input.claimType==='other'?input.reason:(input.claimType==='not_received'?'Not received: ':'Not as described: ')+input.reason;
 const event:CommerceEvent={...eventBase(row,'buyer_refund_'+input.requestId,'buyer'),type:'buyer_return_requested',actorId:row.buyerId,reason:reason.slice(0,200)};
 const existing=state.recentEvents.find(entry=>entry.id===event.eventId);
 if(existing){if(state.issue?.reason!==event.reason)throw new ApiRequestError('This refund request was already used for a different issue.',409);return {sandbox:row.sandbox===1,order:commerceOrderDto(row,userId),duplicate:true}}
 if(state.policy.tier!==undefined)await claimAllowed(db,userId,state,input);
 const next=transition(state,event);if(next.issue)next.issue.kind=input.claimType;
 const updated=await persist(db,row,next,'buyer_refund_requested',{note:event.reason,claimType:input.claimType,...(input.photoIds.length?{photoIds:input.photoIds}:{})});
 return {sandbox:row.sandbox===1,order:commerceOrderDto(updated,userId),note:state.financial?.kind==='transfer'?'Support must reconcile the seller transfer and buyer issue.':'Seller release is frozen while support reviews this request.'};
}
const day=24*hour;
/** Claim rules for tiered orders (docs/BUYER-PROTECTION-POLICY.md §2.4, §4). */
async function claimAllowed(db:Db,userId:string,state:State,input:z.infer<typeof commerceRefundSchema>){
 const shipment=state.shipment,delivered=shipment.deliveredAt?Date.parse(shipment.deliveredAt):NaN,claimDays=state.policy.claimDays??30,stamp=Date.now();
 if(input.claimType==='not_as_described'){
  if(!Number.isFinite(delivered))throw new ApiRequestError('You can report “not as described” once the order is delivered or picked up.',409);
  if(!input.photoIds.length)throw new ApiRequestError('Add at least one photo showing how the comic differs from the listing.',400);
 }
 if(input.claimType==='not_received'){
  if(state.pickup)throw new ApiRequestError('This order was confirmed as picked up, so it can’t be reported as not received. Report it as not as described instead.',409);
  if(state.policy.tier==='safepurchase'&&Number.isFinite(delivered)&&shipment.signatureVerified)throw new ApiRequestError('The carrier confirmed signed delivery for this order. If something is wrong with the comic, report it as not as described.',409);
 }
 // Window: N days after delivery, or after the estimated delivery date (handling deadline + 7 days) if never delivered.
 const paid=Date.parse(state.order.paidAt!),estimated=paid+((state.policy.handlingBusinessDays??2)+2)*day+7*day,start=Number.isFinite(delivered)?delivered:estimated;
 if(stamp>start+claimDays*day)throw new ApiRequestError('The '+claimDays+'-day claim window for this order ended on '+new Date(start+claimDays*day).toLocaleDateString('en-US',{timeZone:'UTC'})+'. Contact support if you need help.',409);
 if(input.photoIds.length){const owned=await db.select({id:media.id}).from(media).where(and(inArray(media.id,input.photoIds),eq(media.userId,userId)));if(owned.length!==new Set(input.photoIds).size)throw new ApiRequestError('Attach only photos you uploaded.',403)}
}
export async function commerceConfirmPickup(db:Db,userId:string,raw:Record<string,unknown>){
 const input=commercePickupSchema.parse(raw),row=await commerceOwnedOrder(db,userId,input.orderId),state=stateOf(row);
 if(row.buyerUserId!==userId)throw new ApiRequestError('Only the buyer can confirm they picked up the order.',403);
 if(snapshotOf(row).fulfillment!=='pickup')throw new ApiRequestError('This order ships by carrier. Delivery is confirmed by the carrier, not by tapping “picked up”.',409);
 if(state.pickup)return {sandbox:row.sandbox===1,order:commerceOrderDto(row,userId),duplicate:true};
 const next=transition(state,{...eventBase(row,'pickup_'+row.id,'buyer'),type:'pickup_confirmed',actor:'buyer'}),updated=await persist(db,row,next,'pickup_confirmed',{note:'Buyer confirmed they picked up the order.'});
 return {sandbox:row.sandbox===1,order:commerceOrderDto(updated,userId),note:'Pickup confirmed. Enjoy your comic! You can still report a problem from this order during the review window.'};
}
export async function commerceConfirmPickupCode(db:Db,userId:string,raw:Record<string,unknown>){
 const input=commercePickupCodeSchema.parse(raw),row=await commerceOwnedOrder(db,userId,input.orderId),state=stateOf(row);
 if(row.sellerUserId!==userId)throw new ApiRequestError('Only the seller can enter the buyer’s pickup code.',403);
 if(snapshotOf(row).fulfillment!=='pickup'||state.policy.tier==='safepurchase')throw new ApiRequestError('This order doesn’t use a seller-entered pickup code.',409);
 if(state.pickup)return {sandbox:row.sandbox===1,order:commerceOrderDto(row,userId),duplicate:true};
 if(!state.pickupCodeHash||!await pickupCodeMatches(row.id,state.pickupCodeHash,input.code))throw new ApiRequestError('That code doesn’t match this order. Ask the buyer to read the 6-digit code shown on their order.',400);
 const next=transition(state,{...eventBase(row,'pickup_'+row.id,'server'),type:'pickup_confirmed',actor:'seller'}),updated=await persist(db,row,next,'pickup_confirmed',{note:'Seller confirmed the hand-off with the buyer’s pickup code.'});
 return {sandbox:row.sandbox===1,order:commerceOrderDto(updated,userId),note:'Pickup confirmed with the buyer’s code.'};
}
/** Shipping for a checkout: the listing's flat amount, or (calculated shipping) a live carrier rate quoted here on
 * the server from the seller's ZIP to the buyer's address. The browser's choice only picks among quoted services. */
async function listingShipping(listing:typeof listings.$inferSelect,input:{shippingAddress?:{postalCode:string};shippingService?:string},environment:StripeSandboxEnv):Promise<{cents:number;service:string|null;serviceId?:string}>{
 if(listing.shippingCalculated!==1)return {cents:listing.shipping,service:null};
 try{
  const options=await quoteShippingRates(environment,listing.locationZip,input.shippingAddress?.postalCode||'',parcelFor({...listing,items:JSON.parse(listing.items||'[]')}));
  const chosen=chooseShippingOption(options,input.shippingService);return {cents:chosen.cents,service:chosen.carrier+' '+chosen.service,serviceId:chosen.id};
 }catch(error){throw new ApiRequestError(error instanceof ShippingQuoteError?error.message:'Shipping couldn’t be calculated. Please try again.',422)}
}
export const commerceBuyLabelSchema=z.object({action:z.literal('buy_label'),orderId:id,from:labelAddressSchema}).strict();
/** Seller buys a shipping label for a paid shipped order. The cost is taken from the seller's payout right away
 * (the frozen transfer amount drops by the label cost), then tracking is added and the carrier tracker registered. */
export async function commerceBuyLabel(db:Db,userId:string,raw:Record<string,unknown>,environment:StripeSandboxEnv={},fetcher?:CarrierFetch){
 const input=commerceBuyLabelSchema.parse(raw),row=await commerceOwnedOrder(db,userId,input.orderId),state=stateOf(row),snapshot=snapshotOf(row);
 if(row.sellerUserId!==userId)throw new ApiRequestError('Only this order’s seller can buy its label.',403);
 if(state.label)return {sandbox:row.sandbox===1,order:commerceOrderDto(row,userId),duplicate:true};
 if(snapshot.fulfillment!=='shipping'||!snapshot.shippingAddress)throw new ApiRequestError('Labels are only for shipped orders.',409);
 if(state.policy.tier==='safepurchase')throw new ApiRequestError('SafePurchase orders ship to the Inspection Center. Use your own label and add its tracking.',409);
 if(!state.order.paidAt||state.financial||state.shipment.trackingNumber||['refunded','refund_pending','cancelled','transferred'].includes(row.status))throw new ApiRequestError('A label can’t be bought for this order now.',409);
 const [listing]=await db.select().from(listings).where(eq(listings.id,row.listingId));
 const parcel=parcelFor({kind:snapshot.kind,itemCount:snapshot.itemCount,cert:listing?.cert,items:snapshot.items,weightOz:listing?.weightOz,lengthIn:listing?.lengthIn,widthIn:listing?.widthIn,heightIn:listing?.heightIn});
 let label:PurchasedLabel;
 try{label=await buyShippingLabel(environment,{from:input.from,to:snapshot.shippingAddress,parcel,preferred:snapshot.shippingServiceId||null,reference:row.id},fetcher)}
 catch(error){throw new ApiRequestError(error instanceof LabelError?error.message:'The label couldn’t be created. Please try again.',422)}
 const net=state.order.sellerTransferCents-label.costCents;
 if(net<=0)throw new ApiRequestError('The label costs more than this sale pays you, so it wasn’t saved. Ship it yourself and add tracking.',409);
 const next={...state,order:{...state.order,sellerTransferCents:net},label,tracking:{...(state.tracking||emptyTracking()),labelCreatedAt:state.tracking?.labelCreatedAt||label.createdAt,rank:Math.max(state.tracking?.rank??0,1)}} as State;
 let updated=await persist(db,row,next,'label_purchased',{note:'Seller bought a '+label.carrier+' '+label.service+' label for $'+(label.costCents/100).toFixed(2)+'. It comes out of the seller payout.',costCents:label.costCents});
 try{const tracked=await commerceSubmitTracking(db,userId,{action:'submit_tracking',orderId:row.id,carrier:label.carrier,trackingNumber:label.trackingCode},environment,fetcher);updated=(await db.select().from(commerceOrders).where(eq(commerceOrders.id,row.id)))[0];void tracked}
 catch{/* The label is saved; the seller can add the tracking number by hand if this step failed. */}
 return {sandbox:row.sandbox===1,order:commerceOrderDto(updated,userId),note:'Label ready. Print it and drop the package off. Tracking was added to the order.'};
}
/** Buyer cancellation for a missed handling deadline: a full refund through the processor. */
export async function commerceCancelOrder(db:Db,userId:string,raw:Record<string,unknown>,environment:StripeSandboxEnv){
 const input=commerceCancelSchema.parse(raw),row=await commerceOwnedOrder(db,userId,input.orderId),state=stateOf(row);
 if(row.buyerUserId!==userId)throw new ApiRequestError('Only the buyer can cancel this order.',403);
 const decision=evaluateCommercePolicy(state,now());
 if(decision.state.refundReason!=='tracking_deadline'||state.issue?.open)throw new ApiRequestError('You can cancel for a full refund only if the seller misses the shipping deadline.',409);
 const result=await refundOrder(db,userId,row.id,input.requestId,false,environment,false);
 return {...result,note:result.order.status==='refunded'?'Order cancelled. Your full refund is on its way.':'Order cancelled. Your full refund is being processed.'};
}
async function persistAndMaybeRefund(db:Db,userId:string,row:Row,next:State,type:string,note:string,requestId:string|undefined,environment:StripeSandboxEnv,allowOperator:boolean){
 const updated=await persist(db,row,next,type,{note});
 if(!requestId||!evaluateCommercePolicy(stateOf(updated),now()).refundEligible)return {sandbox:updated.sandbox===1,order:commerceOrderDto(updated,userId),note};
 try{const refunded=await refundOrder(db,userId,row.id,requestId,false,environment,allowOperator);return {...refunded,note:note+' A full refund was started automatically.'}}
 catch(error){if(error instanceof ApiRequestError&&error.status>=500)return {sandbox:updated.sandbox===1,order:commerceOrderDto(updated,userId),note:note+' The full refund is approved and will be issued when payments are connected.'};throw error}
}
/** Inspection Center actions are owner/operator-only (policy source "operator"). */
export async function commerceInspection(db:Db,userId:string,raw:Record<string,unknown>,environment:StripeSandboxEnv,fetcher?:CarrierFetch){
 if(!await commerceOperatorAllowed(userId,raw.orderId))throw new ApiRequestError('Inspection Center access required.',403);
 const input=commerceInspectionSchema.parse(raw),row=await commerceOwnedOrder(db,userId,input.orderId,true),state=stateOf(row);
 if(state.policy.tier!=='safepurchase')throw new ApiRequestError('This order is not a SafePurchase order.',409);
 const base=(suffix:string)=>eventBase(row,'inspection_'+suffix+'_'+row.id,'operator');
 if(input.step==='receive'){const next=transition(state,{...base('receive'),type:'inspection_received'});return {sandbox:row.sandbox===1,order:commerceOrderDto(await persist(db,row,next,'inspection_received',{note:'The Inspection Center received the order.'}),userId)}}
 if(input.step==='decide'){
  if(input.result!=='passed'&&!input.reasons.length)throw new ApiRequestError('Record at least one inspection finding.',400);
  if(input.result==='partial'&&(state.inspection?.totalItems??1)<2)throw new ApiRequestError('A partial result applies only to collections.',400);
  const total=state.inspection?.totalItems??1,failedItems=input.result==='passed'?0:input.result==='failed'?Math.max(1,Math.min(total,input.failedItems||total)):input.failedItems;
  const next=transition(state,{...base('decide'),type:'inspection_decided',result:input.result,reasons:input.reasons,failedItems,totalItems:total});
  const note=input.result==='passed'?'Inspection passed. The order will ship to the buyer, insured with signature required.':input.result==='failed'?'Inspection failed: '+input.reasons.join('; ')+'. The comic returns to the seller.':'Part of the collection failed inspection: '+input.reasons.join('; ')+'. The buyer chooses a pro-rated or full refund.';
  return persistAndMaybeRefund(db,userId,row,next,'inspection_decided',note,input.result==='failed'?input.requestId:undefined,environment,true);
 }
 if(input.step==='ship'){
  const next=transition(state,{...base('ship'),type:'inspection_shipped',carrier:input.carrier,trackingNumber:input.trackingNumber});
  const trackerId=await registerTracker(environment,input.carrier,input.trackingNumber,fetcher);if(trackerId)next.carrierTrackerId=trackerId;
  return {sandbox:row.sandbox===1,order:commerceOrderDto(await persist(db,row,next,'inspection_shipped',{note:'Shipped to the buyer from the Inspection Center, insured with signature required.'}),userId)};
 }
 if(!state.pickupCodeHash||!await pickupCodeMatches(row.id,state.pickupCodeHash,input.code))throw new ApiRequestError('That code doesn’t match this order.',400);
 const next=transition(state,{...base('handoff'),type:'pickup_confirmed',actor:'operator'});
 return {sandbox:row.sandbox===1,order:commerceOrderDto(await persist(db,row,next,'pickup_confirmed',{note:'Buyer picked up the order at the Inspection Center.'}),userId)};
}
/** Partial collection failure: the buyer accepts the rest with a pro-rated refund, or takes a full refund. */
export async function commerceInspectionChoice(db:Db,userId:string,raw:Record<string,unknown>,environment:StripeSandboxEnv){
 const input=commerceInspectionChoiceSchema.parse(raw),row=await commerceOwnedOrder(db,userId,input.orderId),state=stateOf(row),snapshot=snapshotOf(row);
 if(row.buyerUserId!==userId)throw new ApiRequestError('Only the buyer can make this choice.',403);
 const inspection=state.inspection;if(inspection?.result!=='partial')throw new ApiRequestError('There is no partial inspection result to respond to.',409);
 const partialRefundCents=input.choice==='accept_partial'?Math.min(state.order.totalCents-1,Math.max(1,Math.round(snapshot.itemAmountCents*inspection.failedItems/inspection.totalItems))):0;
 const next=transition(state,{...eventBase(row,'inspection_choice_'+row.id,'buyer'),type:'inspection_buyer_choice',choice:input.choice,partialRefundCents});
 const note=input.choice==='accept_partial'?'Buyer accepted the comics that passed. Support issues the pro-rated refund of '+(partialRefundCents/100).toLocaleString('en-US',{style:'currency',currency:'USD'})+'.':'Buyer chose a full refund.';
 return persistAndMaybeRefund(db,userId,row,next,'inspection_choice',note,input.choice==='full_refund'?input.requestId:undefined,environment,false);
}
/** Applies a signature-verified carrier update (EasyPost) as trusted carrier evidence. */
export async function commerceApplyCarrierUpdate(db:Db,update:CarrierUpdate){
 const rows=await db.select().from(commerceOrders).where(and(sql`(json_extract(${commerceOrders.state}, '$.shipment.trackingNumber') = ${update.trackingCode} OR json_extract(${commerceOrders.state}, '$.trackingSubmission.number') = ${update.trackingCode})`,sql`${commerceOrders.status} NOT IN ('refunded','cancelled','checkout_expired','transferred')`)).limit(5);
 const applied:string[]=[];
 for(const row of rows){
  let state=stateOf(row);const shipment=state.shipment,stamp=now(),submission=state.trackingSubmission;
  if(!state.order.paidAt||state.financial)continue;
  const carrier=shipment.carrier||submission?.carrier,submittedAt=shipment.submittedAt||submission?.submittedAt;if(!carrier||!submittedAt)continue;
  const floor=Math.max(Date.parse(submittedAt),Date.parse(state.order.paidAt)),at=new Date(Math.min(Date.parse(stamp),Math.max(floor,update.occurredAt?Date.parse(update.occurredAt):Date.parse(stamp)))).toISOString();
  const event=(type:string,when=at)=>({...eventBase(row,'easypost:'+update.trackingCode+':'+type,type==='tracking_confirmed'?'server':'carrier',when),carrier,trackingNumber:update.trackingCode});
  const before=JSON.stringify(state);
  try{
   if(update.status!=='pending'){
   if(!shipment.validatedAt){state=transition(state,{...event('tracking_confirmed'),type:'tracking_confirmed',submittedAt},stamp);if(state.holdReason==='tracking_verification_pending')state.holdReason=null}
   if(update.status==='exception')state=transition(state,{...event('exception'),type:'shipment_exception',reason:'carrier_exception'},stamp);
   else{
    if(!state.shipment.acceptedAt)state=transition(state,{...event('accepted'),type:'carrier_accepted'},stamp);
    if(update.status==='delivered'&&!state.shipment.deliveredAt)state=transition(state,{...event(update.signedBy?'delivered_signed':'delivered',new Date(Math.max(Date.parse(at),Date.parse(state.shipment.acceptedAt!))).toISOString()),type:'delivered',signatureVerified:!!update.signedBy},stamp);
    // A later update can add the signature to an already-recorded delivery (same delivery time).
    else if(update.status==='delivered'&&update.signedBy&&!state.shipment.signatureVerified)state=transition(state,{...event('delivered_signed',state.shipment.deliveredAt!),type:'delivered',signatureVerified:true},stamp);
   }
   }
  }catch(error){if(error instanceof ApiRequestError&&error.status===409)continue;throw error}
  // Forward-only milestones and scan history for the progress bar (never rewinds on late/out-of-order webhooks).
  const priorRank=state.tracking?.rank??0,tracking=mergeTracking(state.tracking,update);
  if(JSON.stringify(tracking)!==JSON.stringify(state.tracking??null))state={...state,tracking};
  // Display-only progress (status, estimate, last scan); events above are the only delivery evidence.
  // A late update for an earlier step (e.g. in_transit after out_for_delivery) never replaces the shown status.
  const updateRank=trackingRank(update.rawStatus),backwards=!!state.carrierStatus&&update.status!=='exception'&&updateRank>0&&updateRank<priorRank;
  const summary:CarrierSummary={trackerId:update.trackerId??state.carrierStatus?.trackerId??null,status:update.rawStatus||'unknown',estDeliveryAt:update.estDeliveryAt??null,lastScan:update.lastScan??null,updatedAt:stamp};
  const sameSummary=!!state.carrierStatus&&JSON.stringify({...state.carrierStatus,updatedAt:''})===JSON.stringify({...summary,updatedAt:''});
  if(!sameSummary&&!backwards)state={...state,carrierStatus:summary};
  if(JSON.stringify(state)===before)continue;
  const next=evaluateCommercePolicy(state,stamp).state as State;
  try{await persist(db,row,next,'carrier_update',{note:update.status==='delivered'?'Carrier confirmed delivery'+(update.signedBy?' with a signature':'')+'.':update.status==='accepted'?'Carrier: '+carrierStatusLabel(update.rawStatus||'in_transit')+'.':update.status==='exception'?'Carrier reported a delivery problem; release is frozen while support reviews it.':'Carrier status: '+carrierStatusLabel(update.rawStatus||'unknown')+'.',trackerId:update.trackerId})}catch(error){if(error instanceof ApiRequestError&&error.status===409)continue;throw error}
  applied.push(row.id);
 }
 return {received:true,orders:applied.length};
}
// Per-process throttle for the polling backup (webhooks remain the primary path).
const carrierPolledAt=new Map<string,number>();
export const CARRIER_POLL_INTERVAL_MS=10*60000;
const pollableStatuses=['awaiting_shipment','in_transit','shipped_to_buyer','manual_review'];
/**
 * Polling backup for missed/unreachable EasyPost webhooks: re-reads each tracker from EasyPost's API
 * (GET /v2/trackers/{id}) and applies it through the same trusted path as a signed webhook.
 */
export async function commerceRefreshCarrierStatus(db:Db,environment:StripeSandboxEnv,options:{orderIds?:string[];limit?:number;minIntervalMs?:number;fetcher?:CarrierFetch;stamp?:number}={}){
 if(!carrierConfigured(environment))return {checked:0,updated:0,skipped:'carrier_not_configured'};
 const limit=Math.min(50,Math.max(1,options.limit??25)),minInterval=options.minIntervalMs??CARRIER_POLL_INTERVAL_MS,stamp=options.stamp??Date.now();
 if(options.orderIds&&!options.orderIds.length)return {checked:0,updated:0};
 const rows=await db.select().from(commerceOrders).where(and(inArray(commerceOrders.status,pollableStatuses),sql`json_extract(${commerceOrders.state}, '$.carrierTrackerId') IS NOT NULL`,sql`json_extract(${commerceOrders.state}, '$.shipment.deliveredAt') IS NULL`,...(options.orderIds?[inArray(commerceOrders.id,options.orderIds.slice(0,100))]:[]))).orderBy(commerceOrders.updatedAt).limit(limit*3);
 let checked=0,updated=0;
 for(const row of rows){
  if(checked>=limit)break;
  if(stamp-(carrierPolledAt.get(row.id)??0)<minInterval)continue;
  let state:State;try{state=stateOf(row)}catch{continue}
  const trackerId=state.carrierTrackerId;if(!trackerId||state.financial)continue;
  carrierPolledAt.set(row.id,stamp);checked++;
  try{const update=await retrieveCarrierTracker(environment,trackerId,options.fetcher);const code=state.shipment.trackingNumber;if(!update||!code||update.trackingCode.replace(/\s/g,'').toUpperCase()!==code.replace(/\s/g,'').toUpperCase())continue;updated+=(await commerceApplyCarrierUpdate(db,{...update,trackingCode:code,trackerId})).orders}catch{}
 }
 return {checked,updated};
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
 const check=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM commerce_orders o WHERE o.id = ${row.id} AND o.version = ${row.version} AND o.sandbox = ${row.sandbox}) AND NOT EXISTS (SELECT 1 FROM commerce_money_requests m WHERE m.order_id = ${row.id} AND (m.kind = 'refund' OR m.status <> 'reversed'))`);
 try{await db.batch([check.start,db.update(commerceOrders).set({state:JSON.stringify(next),status:next.status,version:row.version+1,updatedAt:stamp}).where(eq(commerceOrders.id,row.id)),db.insert(commerceMoneyRequests).values({id:requestId,orderId:row.id,kind:'refund',status:'pending',amountCents:state.order.totalCents,providerId:null,createdAt:stamp,updatedAt:stamp}),db.insert(commerceEvents).values({id:crypto.randomUUID(),orderId:row.id,providerEventId:null,type:'refund_reserved',body:JSON.stringify({note:'Full refund reserved before contacting the processor.'}),createdAt:stamp}),check.finish])}
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
  const stamp=now(),check=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM commerce_orders o JOIN commerce_money_requests m ON m.order_id = o.id WHERE o.id = ${row.id} AND o.version = ${row.version} AND o.sandbox = ${row.sandbox} AND m.id = ${ledger.id} AND m.kind = 'refund' AND m.amount_cents = ${state.order.totalCents} AND m.status IN ('pending','reconciliation_required') AND (m.provider_id IS NULL OR m.provider_id = ${refundId}))`);
  try{await db.batch([check.start,db.update(commerceOrders).set({version:row.version+1,updatedAt:stamp}).where(eq(commerceOrders.id,row.id)),db.update(commerceMoneyRequests).set({providerId:refundId,status:refund.status==='pending'?'pending':'reconciliation_required',updatedAt:stamp}).where(eq(commerceMoneyRequests.id,ledger.id)),db.insert(commerceEvents).values({id:crypto.randomUUID(),orderId:row.id,providerEventId:receiptId,type:'refund_pending',body:JSON.stringify({note:'Processor refund completion remains unconfirmed.',...(fingerprint?{fingerprint}: {})}),createdAt:stamp}),check.finish])}catch(error){if(operationGuardFailed(error))throw new ApiRequestError('Refund pending response requires reconciliation.',409);throw error}
  return (await db.select().from(commerceOrders).where(eq(commerceOrders.id,row.id)))[0];
 }
 const stamp=now(),next=transition(state,{...eventBase(row,receiptId||'refund_confirmed_'+ledger.id,'stripe',stamp),type:'refund_confirmed',requestId:ledger.id,processorId:refundId,paymentIntentId:state.order.paymentIntentId!,currency:'USD',amountCents:ledger.amountCents},stamp);
 if(next.status!=='refunded'||!next.financial?.confirmedAt||next.financial.processorId!==refundId)throw new ApiRequestError('Refund confirmation requires reconciliation before order or inventory changes.',409);
 const check=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM commerce_orders o JOIN commerce_money_requests m ON m.order_id = o.id WHERE o.id = ${row.id} AND o.version = ${row.version} AND o.sandbox = ${row.sandbox} AND m.id = ${ledger.id} AND m.kind = 'refund' AND m.amount_cents = ${state.order.totalCents} AND m.status IN ('pending','reconciliation_required') AND (m.provider_id IS NULL OR m.provider_id = ${refundId}))`);
 try{await db.batch([check.start,db.update(commerceOrders).set({state:JSON.stringify(next),status:next.status,version:row.version+1,updatedAt:stamp}).where(eq(commerceOrders.id,row.id)),db.update(commerceMoneyRequests).set({providerId:refundId,status:'succeeded',updatedAt:stamp}).where(eq(commerceMoneyRequests.id,ledger.id)),db.update(listings).set({status:'refunded'}).where(eq(listings.id,row.listingId)),...(!state.shipment.acceptedAt&&!state.trackingSubmission?[db.delete(listingInventory).where(eq(listingInventory.listingId,row.listingId))]:[]),db.insert(commerceEvents).values({id:crypto.randomUUID(),orderId:row.id,providerEventId:receiptId,type:'refund_confirmed',body:JSON.stringify({note:'Full refund confirmed by the processor.',...(fingerprint?{fingerprint}: {})}),createdAt:stamp}),platformLedgerEntry(db,row,snapshotOf(row),'application_fee_refunded',refundId,stamp),db.execute(sql`SELECT ch_web.reconcile_order_rewards(${row.id})`),check.finish])}
 catch(error){if(operationGuardFailed(error))throw new ApiRequestError('Refund confirmation must be reconciled with the changed order.',409);throw error}
 return (await db.select().from(commerceOrders).where(eq(commerceOrders.id,row.id)))[0];
}
export async function commerceOwnerRefund(db:Db,userId:string,raw:Record<string,unknown>,environment:StripeSandboxEnv){
 if(!await commerceOperatorAllowed(userId,raw.orderId))throw new ApiRequestError('Admin access required.',403);
 const input=commerceOwnerRefundSchema.parse(raw);
 return refundOrder(db,userId,input.orderId,input.requestId,input.approveIssue===true,environment,true);
}
// --- Marketplace fee: app ledger, seller release (transfers) and reversal before a post-release refund ---
/** Append-only platform ledger rows in commerce_events (one per order and kind; amounts are signed cents). */
function platformLedgerEntry(db:Db,row:Row,snapshot:Snapshot,type:'application_fee_recorded'|'application_fee_refunded',providerReference:string|null,stamp:string){
 const fee=snapshot.platformFeeCents,sign=type==='application_fee_refunded'?-1:1;
 return db.insert(commerceEvents).values({id:'ledger:'+type+':'+row.id,orderId:row.id,providerEventId:null,type,body:JSON.stringify({ledger:'platform',amountCents:sign*fee,feeBps:snapshot.platformFeeBps??0,safePurchaseFeeCents:sign*(snapshot.inspectionFeeCents??0),storeCreditSubsidyCents:sign*(snapshot.storeCreditCents??0),providerReference,note:type==='application_fee_recorded'?'Marketplace fee earned on a confirmed payment; ComicHuddle keeps it by transferring only the seller’s net.':'Marketplace fee returned with the full refund.'}),createdAt:stamp});
}
export type SellerPayoutInput={orderId:string;paymentIntentId:string;chargeId:string;chargeCents:number;sellerNetCents:number;destination:string;keyBase:string};
/**
 * Moves the seller's net to their connected account. The leg funded by this order's charge uses
 * source_transaction (never more than the charge); any store-credit shortfall is a platform-funded top-up.
 * Idempotency keys derive from keyBase, so a retry never pays twice.
 */
export async function createSellerPayout(processor:Processor,input:SellerPayoutInput){
 const legs=payoutLegs(input.sellerNetCents,input.chargeCents);
 const transfer=legs.fromChargeCents>0?await processor.createTransfer({amountCents:legs.fromChargeCents,destination:input.destination,sourceTransaction:input.chargeId,orderId:input.orderId,paymentIntentId:input.paymentIntentId,orderAmountCents:input.chargeCents},input.keyBase+'_charge'):null;
 const topUp=legs.platformTopUpCents>0?await processor.createPlatformTopUpTransfer({amountCents:legs.platformTopUpCents,destination:input.destination,orderId:input.orderId},input.keyBase+'_topup'):null;
 return {legs,transfer,topUp};
}
export const commerceReleaseSchema=z.object({action:z.literal('owner_release'),orderId:id,requestId:uuid}).strict();
/** Owner-triggered seller release. Requires COMMERCE_PAYOUTS_ENABLED=true and a release-eligible order. */
export async function commerceOwnerRelease(db:Db,userId:string,raw:Record<string,unknown>,environment:StripeSandboxEnv){
 if(!await commerceOperatorAllowed(userId,raw.orderId))throw new ApiRequestError('Admin access required.',403);
 const input=commerceReleaseSchema.parse(raw);needReady(environment);
 if(environment.COMMERCE_PAYOUTS_ENABLED!=='true')throw new ApiRequestError('Seller payouts are disabled until carrier delivery verification and the release review are connected.',503);
 const processor=stripeSandbox(environment);let row=await commerceOwnedOrder(db,userId,input.orderId,true);needMode(row,environment);
 let state=stateOf(row);const snapshot=snapshotOf(row);
 const [existing]=await db.select().from(commerceMoneyRequests).where(and(eq(commerceMoneyRequests.orderId,row.id),eq(commerceMoneyRequests.kind,'transfer')));
 if(existing?.status==='succeeded')return {sandbox:row.sandbox===1,order:commerceOrderDto(row,userId),duplicate:true};
 const sellerAccountId=state.order.sellerAccountId,chargeId=state.order.chargeId,paymentIntentId=state.order.paymentIntentId;
 if(!sellerAccountId||!chargeId||!paymentIntentId)throw new ApiRequestError('This order has no confirmed charge or seller account to pay.',409);
 const [seller]=await db.select().from(profiles).where(eq(profiles.id,row.sellerId));
 if(!seller)throw new ApiRequestError('Seller is unavailable.',409);
 await boundSeller(db,seller,processor,environment);
 let ledger=existing;
 if(!ledger){
  const stamp=now(),next=transition(state,{...eventBase(row,'transfer_request_'+input.requestId,'server',stamp),type:'transfer_requested',requestId:input.requestId,destinationAccountId:sellerAccountId,paymentIntentId:paymentIntentId,currency:'USD',amountCents:state.order.sellerTransferCents},stamp);
  const check=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM commerce_orders o WHERE o.id = ${row.id} AND o.version = ${row.version} AND o.sandbox = ${row.sandbox}) AND NOT EXISTS (SELECT 1 FROM commerce_money_requests m WHERE m.order_id = ${row.id})`);
  try{await db.batch([check.start,db.update(commerceOrders).set({state:JSON.stringify(next),status:next.status,version:row.version+1,updatedAt:stamp}).where(eq(commerceOrders.id,row.id)),db.insert(commerceMoneyRequests).values({id:input.requestId,orderId:row.id,kind:'transfer',status:'pending',amountCents:state.order.sellerTransferCents,providerId:null,createdAt:stamp,updatedAt:stamp}),db.insert(commerceEvents).values({id:crypto.randomUUID(),orderId:row.id,providerEventId:null,type:'transfer_reserved',body:JSON.stringify({note:'Seller net reserved before contacting the processor.',sellerNetCents:state.order.sellerTransferCents,platformFeeCents:snapshot.platformFeeCents}),createdAt:stamp}),check.finish])}
  catch(error){if(operationGuardFailed(error))throw new ApiRequestError('A financial operation is already reserved or the order changed.',409);throw error}
  row=(await db.select().from(commerceOrders).where(eq(commerceOrders.id,row.id)))[0];state=stateOf(row);
  ledger=(await db.select().from(commerceMoneyRequests).where(eq(commerceMoneyRequests.id,input.requestId)))[0];
 }
 if(!ledger||state.financial?.kind!=='transfer'||state.financial.requestId!==ledger.id)throw new ApiRequestError('The transfer ledger does not match this order. Support must reconcile it.',409);
 retryWindow(ledger.createdAt);
 const payout=await createSellerPayout(processor,{orderId:row.id,paymentIntentId:paymentIntentId,chargeId:chargeId,chargeCents:state.order.totalCents,sellerNetCents:state.order.sellerTransferCents,destination:sellerAccountId,keyBase:'comichuddle_transfer_'+ledger.id});
 const primary=providerId(payout.transfer)??providerId(payout.topUp);if(!primary)throw new ApiRequestError('Transfer requires processor reconciliation.',502);
 const stamp=now(),next=transition(state,{...eventBase(row,'transfer_confirmed_'+ledger.id,'stripe',stamp),type:'transfer_confirmed',requestId:ledger.id,processorId:primary,destinationAccountId:sellerAccountId,paymentIntentId:paymentIntentId,currency:'USD',amountCents:ledger.amountCents},stamp);
 const check=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM commerce_orders o JOIN commerce_money_requests m ON m.order_id = o.id WHERE o.id = ${row.id} AND o.version = ${row.version} AND m.id = ${ledger.id} AND m.kind = 'transfer' AND m.status = 'pending')`);
 try{await db.batch([check.start,db.update(commerceOrders).set({state:JSON.stringify(next),status:next.status,transferId:primary,version:row.version+1,updatedAt:stamp}).where(eq(commerceOrders.id,row.id)),db.update(commerceMoneyRequests).set({providerId:primary,status:'succeeded',updatedAt:stamp}).where(eq(commerceMoneyRequests.id,ledger.id)),db.insert(commerceEvents).values({id:crypto.randomUUID(),orderId:row.id,providerEventId:null,type:'transfer_confirmed',body:JSON.stringify({note:'Seller net transferred; ComicHuddle keeps the marketplace fee.',transfers:[payout.transfer&&{id:providerId(payout.transfer),amountCents:payout.legs.fromChargeCents,funding:'charge'},payout.topUp&&{id:providerId(payout.topUp),amountCents:payout.legs.platformTopUpCents,funding:'platform_balance_store_credit'}].filter(Boolean),platformFeeCents:snapshot.platformFeeCents}),createdAt:stamp}),check.finish])}
 catch(error){if(operationGuardFailed(error))throw new ApiRequestError('Transfer confirmation must be reconciled with the changed order.',409);throw error}
 row=(await db.select().from(commerceOrders).where(eq(commerceOrders.id,row.id)))[0];
 // The release may change the seller's trust tier; keep their bank payout schedule in line (best effort).
 try{await syncPayoutSchedule(processor,row.sellerUserId,row.sandbox===1?1:0)}catch{/* retried by the cron job */}
 return {sandbox:row.sandbox===1,order:commerceOrderDto(row,userId),transfers:{fromChargeCents:payout.legs.fromChargeCents,platformTopUpCents:payout.legs.platformTopUpCents}};
}
/** Full refund after release: reverse every seller transfer for the order first, so the platform is whole. */
async function reverseReleasedTransfers(db:Db,row:Row,state:State,processor:Processor){
 const [ledger]=await db.select().from(commerceMoneyRequests).where(and(eq(commerceMoneyRequests.orderId,row.id),eq(commerceMoneyRequests.kind,'transfer')));
 if(!ledger||ledger.status!=='succeeded'||state.financial?.kind!=='transfer'||!state.financial.confirmedAt)throw new ApiRequestError('The seller transfer must be reconciled before this refund.',409);
 const [confirmed]=await db.select().from(commerceEvents).where(and(eq(commerceEvents.orderId,row.id),eq(commerceEvents.type,'transfer_confirmed')));
 let legs:{id:string;amountCents:number}[]=[];try{legs=(JSON.parse(confirmed?.body||'{}').transfers||[]).filter((leg:{id?:unknown;amountCents?:unknown})=>typeof leg?.id==='string'&&Number.isSafeInteger(leg.amountCents))}catch{}
 if(!legs.length||legs.reduce((sum,leg)=>sum+leg.amountCents,0)!==ledger.amountCents)throw new ApiRequestError('The seller transfer record is incomplete. Support must reconcile it before a refund.',409);
 const reversals=[];for(const leg of legs)reversals.push(await processor.createTransferReversal({transferId:leg.id,amountCents:leg.amountCents,orderId:row.id},'comichuddle_reversal_'+leg.id));
 const stamp=now(),next=transition(state,{...eventBase(row,'transfer_reversed_'+ledger.id,'server',stamp),type:'transfer_reversed',requestId:ledger.id,processorId:ledger.providerId!,destinationAccountId:state.order.sellerAccountId??undefined,paymentIntentId:state.order.paymentIntentId!,currency:'USD',amountCents:ledger.amountCents},stamp);
 const check=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM commerce_orders o WHERE o.id = ${row.id} AND o.version = ${row.version})`);
 try{await db.batch([check.start,db.update(commerceOrders).set({state:JSON.stringify(next),status:next.status,version:row.version+1,updatedAt:stamp}).where(eq(commerceOrders.id,row.id)),db.update(commerceMoneyRequests).set({status:'reversed',updatedAt:stamp}).where(eq(commerceMoneyRequests.id,ledger.id)),db.insert(commerceEvents).values({id:crypto.randomUUID(),orderId:row.id,providerEventId:null,type:'transfer_reversed',body:JSON.stringify({note:'Seller transfer reversed before the buyer refund.',reversals:reversals.map(r=>providerId(r))}),createdAt:stamp}),check.finish])}
 catch(error){if(operationGuardFailed(error))throw new ApiRequestError('Order changed while reversing the transfer. Retry; reversals are idempotent.',409);throw error}
 return (await db.select().from(commerceOrders).where(eq(commerceOrders.id,row.id)))[0];
}
/** Owner-only revenue summary for the current payment mode (amounts in cents; Stripe fee is an estimate). */
export async function commerceOwnerRevenue(db:Db,userId:string,environment:StripeSandboxEnv){
 if(userId!==ownerAccountId)throw new ApiRequestError('Owner access required.',403);
 const rows=await db.select().from(commerceOrders).where(eq(commerceOrders.sandbox,modeFlag(environment)));
 const totals={paidOrders:0,grossMerchandiseCents:0,buyerChargesCents:0,platformFeesCents:0,safePurchaseFeesCents:0,storeCreditSubsidyCents:0,refundedOrders:0,refundedCents:0,feesRefundedCents:0,estimatedStripeFeesCents:0,ownerNetCents:0};
 for(const row of rows){
  let state:State,snapshot:Snapshot;try{state=stateOf(row);snapshot=snapshotOf(row)}catch{continue}
  if(!state.order.paidAt)continue;
  const refunded=state.financial?.kind==='refund'&&!!state.financial.confirmedAt;
  totals.paidOrders++;totals.grossMerchandiseCents+=snapshot.itemAmountCents+snapshot.shippingCents;totals.buyerChargesCents+=snapshot.totalCents;
  totals.platformFeesCents+=snapshot.platformFeeCents;totals.safePurchaseFeesCents+=snapshot.inspectionFeeCents??0;totals.estimatedStripeFeesCents+=estimatedStripeFeeCents(snapshot.totalCents);
  if(refunded){totals.refundedOrders++;totals.refundedCents+=snapshot.totalCents;totals.feesRefundedCents+=snapshot.platformFeeCents+(snapshot.inspectionFeeCents??0)}
  else totals.storeCreditSubsidyCents+=snapshot.storeCreditCents??0;
 }
 totals.ownerNetCents=totals.platformFeesCents+totals.safePurchaseFeesCents-totals.feesRefundedCents-totals.storeCreditSubsidyCents-totals.estimatedStripeFeesCents;
 return {mode:modeOf(environment),...totals,note:'Stripe processing fees are an estimate (2.9% + 30¢ per charge; not returned on refunds). Exact fees are on each Stripe balance transaction.'};
}
// --- end marketplace fee ---
/** Full refund through the processor. Callers decide who may trigger it; the policy decides eligibility. */
async function refundOrder(db:Db,userId:string,orderId:string,requestId:string,approveIssue:boolean,environment:StripeSandboxEnv,allowOperator:boolean){
 needReady(environment);const processor=stripeSandbox(environment);const input={requestId};
 let row=await commerceOwnedOrder(db,userId,orderId,allowOperator),state=stateOf(row);needMode(row,environment);
 // Post-release refunds are owner-only and need an approved issue; reverse the seller's transfer first.
 if(state.financial?.kind==='transfer'&&state.financial.confirmedAt){
  if(!allowOperator||!approveIssue)throw new ApiRequestError('This order was paid out to the seller. Support must approve the refund.',409);
  // A reversal the processor refuses (seller balance gone, account closed…) never leaves money half-moved:
  // the order is held for manual review and nothing is refunded until support settles it.
  try{row=await reverseReleasedTransfers(db,row,state,processor);state=stateOf(row)}
  catch(error){
   if(error instanceof ApiRequestError&&error.status===409)throw error;
   const held={...state,holdReason:'transfer_reversal_failed'} as State;
   try{await persist(db,row,held,'transfer_reversal_failed',{note:'The seller transfer could not be reversed before the refund. Held for manual review.'})}catch{}
   throw new ApiRequestError('The seller transfer couldn’t be reversed, so nothing was refunded. The order is on hold for manual review.',502);
  }
 }
 const [held]=await db.select().from(commerceMoneyRequests).where(and(eq(commerceMoneyRequests.orderId,row.id),eq(commerceMoneyRequests.kind,'refund')));
 if(state.financial||held)exactRefundLedger(row,state,held);
 if(state.financial?.kind==='refund'&&state.financial.confirmedAt)return {sandbox:row.sandbox===1,order:commerceOrderDto(row,userId),duplicate:true};
 if(!state.order.paidAt||!state.order.paymentIntentId||state.dispute!=='none'&&state.dispute!=='won')throw new ApiRequestError('Payment requires reconciliation before any refund.',409);
 // Re-retrieve the exact paid intent; never refund a redirect/client-paid claim.
 await processor.retrievePaymentIntent(state.order.paymentIntentId,{orderId:row.id,amountCents:state.order.totalCents,paymentIntentId:state.order.paymentIntentId});
 if(approveIssue&&state.issue?.open){
  const approved=transition(state,{...eventBase(row,'approve_refund_'+input.requestId,'operator'),type:'issue_resolved',resolution:'refund'});
  // A verified operator approval can refund during a carrier outage; it cannot release funds.
  if(!approved.financial&&approved.dispute!=='open'&&approved.dispute!=='lost'&&['tracking_verification_pending','checkout_eligibility_changed'].includes(approved.holdReason||''))approved.holdReason=null;
  const decision=evaluateCommercePolicy(approved,now());row=await persist(db,row,decision.state as State,'refund_claim_approved',{note:'Support approved the buyer’s full refund claim.'});state=stateOf(row);
 }
 const evaluated=evaluateCommercePolicy(state,now());
 if(JSON.stringify(evaluated.state)!==JSON.stringify(state)){row=await persist(db,row,evaluated.state as State,'protection_evaluated',{note:'Shipping deadlines evaluated by the server.'});state=stateOf(row)}
 if(!evaluateCommercePolicy(state,now()).refundEligible&&state.financial?.kind!=='refund')throw new ApiRequestError('Refund needs a missed shipping deadline or an approved buyer claim.',409);
 const reserved=await refundLedger(db,row,state,input.requestId);row=reserved.row;state=reserved.state;
 if(reserved.ledger.status==='succeeded')return {sandbox:row.sandbox===1,order:commerceOrderDto(row,userId),duplicate:true};
 if(!reserved.ledger.providerId&&state.holdReason&&state.holdReason!=='tracking_verification_pending')throw new ApiRequestError('Unknown processor or custody state requires reconciliation before another refund POST.',409);
 if(!reserved.ledger.providerId)retryWindow(reserved.ledger.createdAt);
 const refund=reserved.ledger.providerId?await processor.retrieveRefund(reserved.ledger.providerId,{orderId:row.id,paymentIntentId:state.order.paymentIntentId!,amountCents:reserved.ledger.amountCents},{requireSucceeded:false}):await processor.createRefund({orderId:row.id,paymentIntentId:state.order.paymentIntentId!,amountCents:reserved.ledger.amountCents,orderAmountCents:state.order.totalCents,remainingAmountCents:state.order.totalCents},'comichuddle_refund_'+reserved.ledger.id);
 row=await finishRefund(db,row,reserved.ledger,refund);
 return {sandbox:row.sandbox===1,order:commerceOrderDto(row,userId),note:refund.status==='succeeded'?'Refund confirmed.':'Refund is pending processor confirmation. The seller transfer remains frozen.'};
}
export async function commerceOwnerReconcile(db:Db,userId:string,raw:Record<string,unknown>,environment:StripeSandboxEnv){
 if(!await commerceOperatorAllowed(userId,raw.orderId))throw new ApiRequestError('Admin access required.',403);const input=commerceReconcileSchema.parse(raw);needReady(environment);
 const row=await commerceOwnedOrder(db,userId,input.orderId,true);needMode(row,environment);const state=stateOf(row),[ledger]=await db.select().from(commerceMoneyRequests).where(and(eq(commerceMoneyRequests.orderId,row.id),eq(commerceMoneyRequests.kind,'refund')));
 exactRefundLedger(row,state,ledger);
 if(ledger.status==='succeeded')return {sandbox:row.sandbox===1,order:commerceOrderDto(row,userId),duplicate:true};
 if(!ledger.providerId)return commerceOwnerRefund(db,userId,{action:'owner_refund',orderId:row.id,requestId:ledger.id},environment);
 const refund=await stripeSandbox(environment).retrieveRefund(ledger.providerId,{orderId:row.id,paymentIntentId:row.paymentIntentId!,amountCents:ledger.amountCents},{requireSucceeded:false}),updated=await finishRefund(db,row,ledger,refund);
 return {sandbox:row.sandbox===1,order:commerceOrderDto(updated,userId),note:'Only the existing persisted refund was retrieved. No new financial operation was created.'};
}
async function deterministicRefundId(orderId:string){const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('comichuddle-auto-refund:'+orderId)));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const h=Array.from(bytes.slice(0,16),v=>v.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20)}
export async function commerceOwnerSweep(db:Db,userId:string,raw:Record<string,unknown>,environment:StripeSandboxEnv){
 if(userId!==ownerAccountId)throw new ApiRequestError('Owner access required.',403);commerceSweepSchema.parse(raw);needReady(environment);
 const rows=await db.select().from(commerceOrders).where(and(eq(commerceOrders.sandbox,modeFlag(environment)),inArray(commerceOrders.status,['awaiting_shipment','in_transit','delivered_review','release_eligible','refund_eligible','manual_review','refund_pending','awaiting_pickup','picked_up','shipped_to_inspection','at_inspection','inspection_passed','inspection_failed','shipped_to_buyer']))).orderBy(commerceOrders.updatedAt).limit(25),results=[];
 for(const row of rows){
  const state=stateOf(row),decision=evaluateCommercePolicy(state,now());
  // Without a live carrier adapter an entered label/number cannot be declared missing or delivered.
  if(state.trackingSubmission&&!state.shipment.validatedAt&&state.financial?.kind!=='refund'){results.push({orderId:row.id,result:'manual_review',reason:'carrier_verification_not_connected'});continue}
  if(!decision.refundEligible&&state.financial?.kind!=='refund'){results.push({orderId:row.id,result:decision.status,reason:decision.reason});continue}
  try{const result=state.financial?.kind==='refund'?await commerceOwnerReconcile(db,userId,{action:'owner_reconcile',orderId:row.id},environment):await commerceOwnerRefund(db,userId,{action:'owner_refund',orderId:row.id,requestId:await deterministicRefundId(row.id)},environment);results.push({orderId:row.id,result:result.order.status})}
  catch(error){results.push({orderId:row.id,result:'reconciliation_required',reason:error instanceof ApiRequestError?'order_or_policy_changed':error instanceof StripeSandboxError?'processor_response_unconfirmed':'operation_unconfirmed'})}
 }
 return {sandbox:modeOf(environment)==='test',results,scheduled:false,note:'Manual owner sweep only. No background scheduler or trusted carrier connector is installed.'};
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
async function recordPaid(db:Db,row:Row,event:StripeVerifiedEvent,processor:Processor,fingerprint:string,environment:StripeSandboxEnv){
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
 // Local pickup: the 6-digit code is derived from a server secret; only its hash is stored on the order.
 // Without a configured secret the payment still records; the buyer can confirm pickup by tapping instead.
 if(snapshot.fulfillment==='pickup'&&!next.pickupCodeHash)try{next.pickupCodeHash=await pickupCodeHash(row.id,await pickupCode(environment,row.id))}catch{}
 const evaluated=evaluateCommercePolicy(next,stamp).state;
 if(snapshot.auction)await ensureLocalAuctionSchema(db);
 const check=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM commerce_orders o JOIN listings l ON l.id = o.listing_id WHERE o.id = ${row.id} AND o.version = ${row.version} AND o.sandbox = ${row.sandbox} AND o.status NOT IN ('cancelled','checkout_expired') AND (o.checkout_session_id IS NULL OR o.checkout_session_id = ${sessionId}) AND (o.payment_intent_id IS NULL OR o.payment_intent_id = ${intentId})) AND NOT EXISTS (SELECT 1 FROM commerce_events e WHERE e.provider_event_id = ${event.id})`);
 try{await db.batch([check.start,db.update(commerceOrders).set({checkoutSessionId:sessionId,paymentIntentId:intentId,chargeId,state:JSON.stringify(evaluated),status:evaluated.status,version:row.version+1,updatedAt:stamp}).where(eq(commerceOrders.id,row.id)),db.update(listings).set({status:'pending'}).where(and(eq(listings.id,row.listingId),eq(listings.status,'checkout_reserved'))),...(snapshot.auction?[markAuctionPaidStatement(db,row.listingId)]:[]),db.insert(commerceEvents).values({id:crypto.randomUUID(),orderId:row.id,providerEventId:event.id,type:'payment_confirmed',body:JSON.stringify({fingerprint,note:'Signed provider event and server-retrieved session, intent and charge confirm this exact order amount.',providerCreatedAt:typeof event.created==='number'?event.created:null}),createdAt:stamp}),...(!state.order.paidAt?[platformLedgerEntry(db,row,snapshot,'application_fee_recorded',chargeId,stamp)]:[]),db.execute(sql`SELECT ch_web.reconcile_order_rewards(${row.id})`),check.finish])}
 catch(error){if(operationGuardFailed(error))throw new ApiRequestError('Order changed while confirming payment. Retry the signed event.',409);throw error}
 if(!state.order.paidAt)await import('./offers').then(m=>m.notifyOrderEvent(row.id,'paid')).catch(()=>undefined); // offers (round 4): buyer + seller "paid" notifications
 return {received:true,sandbox:row.sandbox===1};
}
/** Releases an unpaid reservation and returns the listing to the marketplace (inventory is kept). */
async function releaseCheckout(db:Db,row:Row,event:{id:string}|null,sessionId:string|null,status:'checkout_expired'|'cancelled',note:string,fingerprint:string){
 const stamp=now(),check=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM commerce_orders o WHERE o.id = ${row.id} AND o.version = ${row.version} AND o.status = 'awaiting_payment' AND o.payment_intent_id IS NULL AND o.sandbox = ${row.sandbox}) AND ${event?sql`NOT EXISTS (SELECT 1 FROM commerce_events e WHERE e.provider_event_id = ${event.id})`:sql`true`}`);
 try{await db.batch([check.start,db.update(commerceOrders).set({...(sessionId?{checkoutSessionId:sessionId}:{}),status,version:row.version+1,updatedAt:stamp}).where(eq(commerceOrders.id,row.id)),db.update(listings).set({status:sql`CASE WHEN ${listings.saleType} = 'auction' THEN 'auction_won' ELSE 'active' END`}).where(and(eq(listings.id,row.listingId),eq(listings.status,'checkout_reserved'))),db.insert(commerceEvents).values({id:crypto.randomUUID(),orderId:row.id,providerEventId:event?.id??null,type:status,body:JSON.stringify({...(fingerprint?{fingerprint}:{}),note}),createdAt:stamp}),db.execute(sql`SELECT ch_web.reconcile_order_rewards(${row.id})`),check.finish])}catch(error){if(operationGuardFailed(error))throw new ApiRequestError('Order changed while releasing checkout. Retry the signed event.',409);throw error}
 return {received:true,sandbox:row.sandbox===1};
}
async function expireCheckout(db:Db,row:Row,event:StripeVerifiedEvent,processor:Processor,fingerprint:string){
 const sessionId=providerId(event.data.object),state=stateOf(row);
 if(!sessionId||row.checkoutSessionId&&row.checkoutSessionId!==sessionId||state.order.paidAt)throw new ApiRequestError('Expired checkout does not match an unpaid order.',409);
 const session=await processor.retrieveCheckout(sessionId,{orderId:row.id,amountCents:snapshotOf(row).totalCents},{requirePaid:false});
 if(session.status!=='expired'||session.payment_status!=='unpaid')throw new ApiRequestError('Checkout has not been confirmed expired and unpaid.',409);
 return releaseCheckout(db,row,event,sessionId,'checkout_expired','Processor confirmed this checkout session expired without payment. The listing is available again.',fingerprint);
}
/** A delayed payment method (e.g. bank debit) failed after Checkout completed; release the reservation. */
async function failAsyncCheckout(db:Db,row:Row,event:StripeVerifiedEvent,processor:Processor,fingerprint:string){
 const sessionId=providerId(event.data.object),state=stateOf(row);
 if(!sessionId||row.checkoutSessionId&&row.checkoutSessionId!==sessionId||state.order.paidAt)throw new ApiRequestError('Failed payment does not match an unpaid order.',409);
 const session=await processor.retrieveCheckout(sessionId,{orderId:row.id,amountCents:snapshotOf(row).totalCents},{requirePaid:false});
 if(session.status!=='complete'||session.payment_status!=='unpaid')throw new ApiRequestError('Checkout has not been confirmed as an unpaid failed payment.',409);
 return releaseCheckout(db,row,event,sessionId,'cancelled','The buyer’s delayed payment failed. No money was collected and the listing is available again.',fingerprint);
}
/** Provider event time when it is plausible for this order; otherwise server time. */
function providerTime(event:StripeVerifiedEvent,row:Row,state:State,stamp:string){
 const ms=typeof event.created==='number'&&Number.isSafeInteger(event.created)?event.created*1000:NaN,floor=Math.max(Date.parse(row.createdAt),state.order.paidAt?Date.parse(state.order.paidAt):0);
 return Number.isSafeInteger(ms)&&ms>=floor&&ms<=Date.parse(stamp)?new Date(ms).toISOString():stamp;
}
async function processorHold(db:Db,row:Row,event:StripeVerifiedEvent,processor:Processor,fingerprint:string){
 const state=stateOf(row);if(!state.order.paidAt||!row.paymentIntentId||!row.chargeId)throw new ApiRequestError('Processor issue requires a confirmed order binding.',409);
 const charge=await processor.retrieveCharge(row.chargeId,{orderId:row.id,paymentIntentId:row.paymentIntentId,amountCents:state.order.totalCents}),data=event.data.object;
 if(event.type.startsWith('charge.dispute.')&&providerId(data.charge)!==row.chargeId||event.type==='charge.refunded'&&providerId(data)!==row.chargeId||event.type.startsWith('refund.')&&providerId(data.payment_intent)!==row.paymentIntentId)throw new ApiRequestError('Processor issue does not match the order charge.',409);
 const stamp=now(),money={paymentIntentId:row.paymentIntentId,currency:'USD' as const,amountCents:state.order.totalCents};
 if(event.type.startsWith('charge.dispute.')){
  // The re-retrieved dispute status (not the event name) decides open vs. closed.
  const disputeId=providerId(data);if(!disputeId)throw new ApiRequestError('Dispute is not bound to this order.',409);
  const dispute=await processor.retrieveDispute(disputeId,{chargeId:row.chargeId,paymentIntentId:row.paymentIntentId}),status=String(dispute.status);
  const outcome=status==='won'||status==='warning_closed'?'won' as const:status==='lost'?'lost' as const:null;
  const base={...eventBase(row,event.id,'stripe',providerTime(event,row,state,stamp)),...money};
  const next=outcome?transition(state,{...base,type:'dispute_closed',outcome},stamp):transition(state,{...base,type:'dispute_opened'},stamp);
  await persist(db,row,next,outcome?'dispute_closed':'processor_issue',{fingerprint,note:outcome?'Processor dispute closed: '+outcome+'.':'Processor dispute is open ('+status+'). Seller release remains blocked.'},event.id);
  return {received:true,sandbox:row.sandbox===1,manualReview:!outcome||outcome==='lost'};
 }
 const next=transition(state,{...eventBase(row,event.id,'stripe',stamp),type:'processor_unknown',reason:'processor_refund_reconciliation',...money},stamp);
 if(event.type==='charge.refunded'&&Number(charge.amount_refunded)<=0)throw new ApiRequestError('Refund is not reflected on the recorded charge.',409);
 await persist(db,row,next,'processor_issue',{fingerprint,note:'Processor refund outside the app requires support reconciliation. Seller release remains blocked.'},event.id);
 return {received:true,sandbox:row.sandbox===1,manualReview:true};
}
/** Connect account.updated (v1 snapshot) or a v2 thin account event: re-retrieve the bound account and refresh readiness. */
async function sellerAccountUpdated(db:Db,accountId:string|undefined,processor:Processor,mode:StripeMode,environment:StripeSandboxEnv){
 if(!accountId||!/^acct_[A-Za-z0-9]+$/.test(accountId))return {received:true,sandbox:mode==='test',ignored:true};
 const [record]=await db.select().from(commerceSellers).where(eq(commerceSellers.stripeAccountId,accountId));
 if(!record||sellerMode(record)!==mode)return {received:true,sandbox:mode==='test',ignored:true};
 const ready=await sellerAccountReady(environment,processor,record,accountId,{profileId:record.profileId,userId:record.userId});
 const check=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM commerce_sellers s WHERE s.profile_id = ${record.profileId} AND s.user_id = ${record.userId} AND s.stripe_account_id = ${accountId})`);
 try{await db.batch([check.start,db.update(commerceSellers).set({state:JSON.stringify({ready,status:ready?'verified':'onboarding_required',mode,...(sellerState(record).api==='v2'?{api:'v2'}:{})}),updatedAt:now()}).where(eq(commerceSellers.profileId,record.profileId)),check.finish])}
 catch(error){if(operationGuardFailed(error))throw new ApiRequestError('Seller binding changed. Retry the signed event.',409);throw error}
 return {received:true,sandbox:mode==='test',seller:{ready}};
}
/** Accounts v2 thin event (already signature-verified by verifyStripeThinEvent). Idempotent: state is re-derived from Stripe. */
export async function commerceApplyThinAccountEvent(db:Db,event:StripeThinAccountEvent|null,environment:StripeSandboxEnv){
 needReady(environment);const mode=modeOf(environment);
 if(!event)return {received:true,sandbox:mode==='test',ignored:true};
 if(event.livemode!==(mode==='live'))throw new ApiRequestError('Event is from the other payment mode.',400);
 return sellerAccountUpdated(db,event.accountId,stripeSandbox(environment),mode,environment);
}
export const COMMERCE_WEBHOOK_EVENTS=['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired','payment_intent.succeeded','refund.created','refund.updated','refund.failed','charge.refunded','charge.dispute.created','charge.dispute.updated','charge.dispute.closed','account.updated','payout.paid','payout.failed','payout.canceled','payout.updated'] as const;
/** Only verified raw-body Stripe events reach here; all payment proof is re-retrieved. */
export async function commerceApplyWebhook(db:Db,event:StripeVerifiedEvent,rawBody:Uint8Array,environment:StripeSandboxEnv){
 needReady(environment);const mode=modeOf(environment),sandbox=mode==='test';
 if(event.livemode!==(mode==='live'))throw new ApiRequestError('Event is from the other payment mode.',400);
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(rawBody))),fingerprint=Array.from(digest,v=>v.toString(16).padStart(2,'0')).join('');
 if(await receiptMatches(db,event.id,fingerprint))return {received:true,sandbox,duplicate:true};
 if(!(COMMERCE_WEBHOOK_EVENTS as readonly string[]).includes(event.type))return {received:true,sandbox,ignored:true};
 const processor=stripeSandbox(environment);
 if(event.type==='account.updated')return await sellerAccountUpdated(db,providerId(event.data.object),processor,mode,environment);
 // Bank payouts from sellers' connected accounts (Connect events carry the account id).
 if(event.type.startsWith('payout.')){const result=await applyPayoutEvent(event,sandbox?1:0);return {...result,sandbox}}
 // Checkout completes before a delayed payment settles; async_payment_succeeded/failed follows.
 if(event.type==='checkout.session.completed'&&event.data.object.payment_status==='unpaid')return {received:true,sandbox,pending:true};
 // The webhook application owns durable receipt dedupe; the kernel's last64 is not a ledger.
 for(let attempt=0;attempt<3;attempt++){
  const row=await processorRow(db,event);if(!row||row.sandbox!==modeFlag(environment))return {received:true,sandbox,ignored:true};
  try{
   if(['checkout.session.completed','checkout.session.async_payment_succeeded','payment_intent.succeeded'].includes(event.type))return await recordPaid(db,row,event,processor,fingerprint,environment);
   if(event.type==='checkout.session.expired')return await expireCheckout(db,row,event,processor,fingerprint);
   if(event.type==='checkout.session.async_payment_failed')return await failAsyncCheckout(db,row,event,processor,fingerprint);
   const [ledger]=await db.select().from(commerceMoneyRequests).where(and(eq(commerceMoneyRequests.orderId,row.id),eq(commerceMoneyRequests.kind,'refund')));
   // App-initiated refunds are tracked by their ledger through refund.* events; charge.refunded is redundant.
   if(event.type==='charge.refunded'&&ledger)return {received:true,sandbox,ignored:true};
   if(event.type.startsWith('refund.')){
    const refundId=providerId(event.data.object),state=stateOf(row);
    if(!refundId||!row.paymentIntentId)throw new ApiRequestError('Refund is not bound to a paid order.',409);
    if(!ledger||ledger.providerId&&ledger.providerId!==refundId){await processorHold(db,row,event,processor,fingerprint);return {received:true,sandbox,manualReview:true}}
    exactRefundLedger(row,state,ledger);
    const refund=await processor.retrieveRefund(refundId,{orderId:row.id,paymentIntentId:row.paymentIntentId,amountCents:ledger.amountCents},{requireSucceeded:false});
    if(state.financial?.requestId!==ledger.id||state.financial?.kind!=='refund')throw new ApiRequestError('Refund ledger does not match order protection state.',409);
    if(ledger.status==='succeeded'){
     await persist(db,row,state,'refund_confirmation_duplicate',{fingerprint,note:'Processor confirmed a previously completed refund.'},event.id);return {received:true,sandbox,duplicate:true};
    }
    await finishRefund(db,row,ledger,refund,event.id,fingerprint);return {received:true,sandbox};
   }
   return await processorHold(db,row,event,processor,fingerprint);
  }catch(error){
   if(await receiptMatches(db,event.id,fingerprint))return {received:true,sandbox,duplicate:true};
   if(error instanceof ApiRequestError&&error.status===409&&attempt<2)continue;
   throw error;
  }
 }
 throw new ApiRequestError('Processor event requires reconciliation.',409);
}
export function commerceError(error:unknown){
 if(error instanceof ApiRequestError)return privateJson({error:error.message},error.status);
 if(error instanceof z.ZodError)return privateJson({error:'Please check the highlighted fields and try again. Nothing was charged.'},400);
 if(error instanceof StripeSandboxError)return privateJson({error:error.message,code:error.code,pending:error.retryable,note:'Do not create a replacement request. Reconcile or retry the original persisted request.'},error.status);
 return privateJson({error:'This commerce operation was not confirmed. Refresh the order or contact maliktecks@gmail.com before retrying.'},500);
}
// --- safepurchase helper (round 4): configured admins act as the operator ---
// The site owner keeps operator access. A configured admin (lib/admin.ts, by account email) may also run
// per-order operator actions (inspection, refund, reconcile, release), but never on an order where that
// admin is the buyer or the seller. Platform-wide revenue and sweep stay owner-only.
async function commerceOperatorAllowed(userId:string,orderId:unknown):Promise<boolean>{
 if(userId===ownerAccountId)return true;
 if(typeof orderId!=='string'||!orderId||orderId.length>100)return false;
 const {isAdminUserId}=await import('./admin-audit');
 if(!await isAdminUserId(userId))return false;
 const [row]=await getDb().select({buyer:commerceOrders.buyerUserId,seller:commerceOrders.sellerUserId}).from(commerceOrders).where(eq(commerceOrders.id,orderId));
 return !row||row.buyer!==userId&&row.seller!==userId;
}
// --- end safepurchase helper (round 4) ---
// --- offers (round 4) ---------------------------------------------------------------------------
// Accepted offers pay through their own checkout (never the cart). Same reservation, protection, fee
// and payment rules as commerceCheckout, priced at the accepted offer amount, and only for that offer's
// buyer inside its 48-hour payment window. Also: seller delivery details, the 7-day pickup-code expiry
// (refunded through the owner sweep path) and the pickup-code expiry check.
export const commerceOfferCheckoutSchema=z.object({action:z.literal('offer_checkout'),offerId:id,requestId:uuid,sandboxAcknowledged:z.literal(true),fulfillment:z.enum(['shipping','pickup']).default('shipping'),shippingAddress:addressSchema.optional(),shippingService:z.string().trim().max(80).optional(),checkoutUiMode:z.enum(['hosted_page','elements']).default('hosted_page'),safePurchaseOptIn:z.boolean().default(false),waiveSafePurchase:z.boolean().default(false)}).strict().superRefine((value,ctx)=>{if(value.fulfillment==='shipping'&&!value.shippingAddress)ctx.addIssue({code:z.ZodIssueCode.custom,path:['shippingAddress'],message:'Enter a USA shipping address.'})});
type OfferSnapshot=Snapshot&{offer?:{id:string;amountCents:number}};
export async function commerceOfferCheckout(db:Db,profile:Profile,email:string,raw:Record<string,unknown>,environment:StripeSandboxEnv){
 const input=commerceOfferCheckoutSchema.parse(raw);if(environment.COMMERCE_NEW_CHECKOUT_PAUSED==='true')throw new ApiRequestError('Online checkout is temporarily paused, and nothing was charged.',503);needReady(environment);if(input.checkoutUiMode==='elements'&&!commerceSetup(environment).paymentElementEnabled)throw new ApiRequestError('Stripe Payment Element needs a valid publishable key for the current payment mode. No payment was started.',503);
 const processor=stripeSandbox(environment),flag=modeFlag(environment),live=flag===0;
 const {acceptedOfferForCheckout}=await import('./offers'),terms=await acceptedOfferForCheckout(db,input.offerId,profile.id);
 const same=(row:Row)=>{const s=snapshotOf(row) as OfferSnapshot;return row.listingId===terms.listingId&&s.offer?.id===terms.offerId&&s.itemAmountCents===terms.amountCents&&s.fulfillment===input.fulfillment&&JSON.stringify(s.shippingAddress??null)===JSON.stringify(input.shippingAddress??null)&&(s.checkoutUiMode??'hosted_page')===input.checkoutUiMode};
 let [previous]=await db.select().from(commerceOrders).where(and(eq(commerceOrders.buyerUserId,profile.userId),eq(commerceOrders.requestId,input.requestId)));
 if(!previous){const [own]=await db.select().from(commerceOrders).where(and(eq(commerceOrders.buyerUserId,profile.userId),eq(commerceOrders.listingId,terms.listingId),eq(commerceOrders.status,'awaiting_payment')));if(own){if(!same(own))throw new ApiRequestError('You already have a checkout in progress for this comic. Finish it or cancel it from Orders first.',409);previous=own}}
 if(previous){if(!same(previous))throw new ApiRequestError('This checkout request was already used for a different order.',409);needMode(previous,environment);return continuePayment(db,previous,profile,email,environment,processor)}
 const [listing]=await db.select().from(listings).where(eq(listings.id,terms.listingId));
 if(!listing||listing.status!=='active'||listing.saleType!=='fixed')throw new ApiRequestError('This listing is no longer available for checkout.',409);
 needFulfillment(listing,input.fulfillment);
 if(listing.sellerId===profile.id)throw new ApiRequestError('You cannot buy your own comic listing.',403);
 const [seller]=await db.select().from(profiles).where(eq(profiles.id,listing.sellerId));
 if(!seller?.visible||seller.moderated||seller.deletionStartedAt||seller.rulesVersion!==previewRulesVersion||!seller.rulesAcceptedAt||!listing.usaAttestedAt||await isRestricted(db,seller.userId)||await blocked(db,profile.id,seller.id))throw new ApiRequestError('Listing is unavailable for checkout.',404);
 await ensureSellerPhotos(seller.userId,JSON.parse(listing.photos));
 const itemAmount=terms.amountCents,shippingQuote=input.fulfillment==='pickup'?null:await listingShipping(listing,input,environment),shippingAmount=shippingQuote?.cents??0;
 const plan=protectionPlan(protectionConfig(environment),{itemCents:itemAmount,fulfillment:input.fulfillment,sellerOptIn:!!listing.safePurchaseOptIn,buyerOptIn:input.safePurchaseOptIn,waiveSafePurchase:input.waiveSafePurchase});
 if(input.waiveSafePurchase&&!plan.waived)throw new ApiRequestError('SafePurchase can be waived only for a local pickup it would otherwise cover.',400);
 const feeConfig=platformFeeConfig(environment);if(!feeConfig.valid)throw new ApiRequestError('The marketplace fee configuration is invalid. No order or payment was started.',503);
 const sale=saleBreakdown(itemAmount,shippingAmount,feeConfig);
 const sellerAccountId=await boundSeller(db,seller,processor,environment),items=listingItems(listing),gross=sale.sellerNetCents,total=itemAmount+shippingAmount+plan.feeCents;
 if(!items.length||items.length!==listing.itemCount||!Number.isSafeInteger(total)||itemAmount<100||total<50||shippingAmount<0||total>99_999_999)throw new ApiRequestError('Listing needs a valid bounded price and complete copy snapshot.',409);
 const [source]=await db.select().from(collections).where(eq(collections.userId,seller.userId));
 const selected=JSON.stringify(items.map(copy=>copy.bookId));
 if(!source)throw new ApiRequestError('The seller’s source collection is unavailable.',409);
 const orderId=crypto.randomUUID(),stamp=new Date(Math.floor(Date.now()/1000)*1000).toISOString();
 const state:State=createCommerceState({orderId,buyerId:profile.id,sellerId:seller.id,sellerAccountId,currency:'USD',totalCents:total,sellerTransferCents:gross,storeCreditCents:0,createdAt:stamp,paymentIntentId:null,chargeId:null,paidAt:null,fulfillment:input.fulfillment},plan.policy);
 if(plan.tier==='safepurchase')state.inspection=emptyInspection(items.length);
 const photos=z.array(z.string().uuid()).max(6).parse(JSON.parse(listing.photos)),policy=plan.policy;
 const protection:ProtectionSnapshot={tier:plan.tier,overThreshold:plan.overThreshold,safePurchaseRequested:plan.safePurchaseRequested,comingSoon:plan.comingSoon,waived:plan.waived,signatureRequired:policy.requiresSignature,insured:policy.insured===true,releaseHoldHours:policy.reviewHours,handlingBusinessDays:policy.handlingBusinessDays??null,claimDays:policy.claimDays??30};
 const snapshot:OfferSnapshot={storeCreditCents:0,checkoutUiMode:input.checkoutUiMode,title:listing.title,kind:listing.kind==='collection'?'collection':'single',fulfillment:input.fulfillment,itemCount:items.length,items,photoIds:[...new Set([...photos,...items.flatMap(copy=>copy.photoId?[copy.photoId]:[])])],itemAmountCents:itemAmount,shippingCents:shippingAmount,...(shippingQuote?.service?{shippingService:shippingQuote.service,shippingServiceId:shippingQuote.serviceId}:{}),taxCents:0,totalCents:total,currency:'USD',sellerTransferCents:gross,platformFeeCents:sale.feeCents,platformFeeBps:sale.feeBps,...(plan.feeCents?{inspectionFeeCents:plan.feeCents}:{}),...(input.fulfillment==='shipping'?{shippingAddress:input.shippingAddress}:{}),policyVersion:state.policy.version,protection,offer:{id:terms.offerId,amountCents:itemAmount}};
 // The accepted offer itself is re-checked inside the reservation transaction.
 const listingState=sql`l.status = 'active' AND l.sale_type = 'fixed' AND EXISTS (SELECT 1 FROM offers accepted_offer WHERE accepted_offer.id = ${terms.offerId} AND accepted_offer.listing_id = l.id AND accepted_offer.buyer_id = ${profile.id} AND accepted_offer.status = 'accepted' AND accepted_offer.amount = ${itemAmount})`;
 const reservation=conditionalGuard(db,sql`EXISTS (SELECT 1 FROM listings l JOIN profiles seller ON seller.id = l.seller_id JOIN profiles buyer ON buyer.id = ${profile.id} JOIN collections c ON c.user_id = seller.user_id WHERE l.id = ${listing.id} AND ${listingState} AND l.fulfillment IN (${sql.join(allowedListingFulfillment[input.fulfillment].map(value=>sql`${value}`),sql`, `)}) AND l.fulfillment = ${listing.fulfillment} AND l.price = ${listing.price} AND l.shipping = ${listing.shipping} AND l.items = ${listing.items} AND l.photos = ${listing.photos} AND l.vault_revision = ${listing.vaultRevision} AND c.revision = ${source.revision} AND l.usa_attested_at != '' AND seller.id != buyer.id AND buyer.user_id = ${profile.userId} AND seller.visible = 1 AND buyer.visible = 1 AND seller.moderated = 0 AND buyer.moderated = 0 AND seller.deletion_started_at IS NULL AND buyer.deletion_started_at IS NULL AND seller.rules_version = ${previewRulesVersion} AND buyer.rules_version = ${previewRulesVersion} AND seller.rules_accepted_at != '' AND buyer.rules_accepted_at != '' AND NOT EXISTS (SELECT 1 FROM account_restrictions r WHERE r.scope = 'account' AND r.user_id IN (seller.user_id,buyer.user_id)) AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.from_id = buyer.id AND b.to_id = seller.id) OR (b.from_id = seller.id AND b.to_id = buyer.id))) AND NOT EXISTS (SELECT 1 FROM commerce_orders o WHERE o.listing_id = ${listing.id} AND o.status NOT IN ('cancelled','refunded','checkout_expired')) AND NOT EXISTS (SELECT 1 FROM json_each(${selected}) copy WHERE copy.value NOT IN (SELECT json_extract(owned.value,'$.id') FROM collections c, json_each(c.data,'$.books') owned WHERE c.user_id = ${seller.userId}) OR NOT EXISTS (SELECT 1 FROM listing_inventory reserved WHERE reserved.seller_id = ${seller.id} AND reserved.listing_id = ${listing.id} AND reserved.book_id = copy.value)) AND NOT EXISTS (SELECT 1 FROM json_each(${JSON.stringify(snapshot.photoIds)}) photo WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.id = photo.value AND m.user_id = ${seller.userId})) AND EXISTS (SELECT 1 FROM commerce_sellers s WHERE s.profile_id = ${seller.id} AND s.user_id = ${seller.userId} AND s.stripe_account_id = ${sellerAccountId})`);
 try{await db.batch([reservation.start,db.insert(commerceOrders).values({id:orderId,buyerId:profile.id,buyerUserId:profile.userId,sellerId:seller.id,sellerUserId:seller.userId,listingId:listing.id,requestId:input.requestId,status:state.status,version:0,sandbox:flag,snapshot:JSON.stringify(snapshot),state:JSON.stringify(state),checkoutSessionId:null,paymentIntentId:null,chargeId:null,transferId:null,createdAt:stamp,updatedAt:stamp}),db.execute(sql`SELECT ch_web.reserve_store_credit(${orderId},${profile.userId},${walletMode(flag)},${0})`),db.update(listings).set({status:'checkout_reserved'}).where(eq(listings.id,listing.id)),db.update(offers).set({status:'closed'}).where(and(eq(offers.listingId,listing.id),inArray(offers.status,['pending','countered']))),db.insert(commerceEvents).values({id:crypto.randomUUID(),orderId,providerEventId:null,type:'checkout_reserved',body:JSON.stringify({note:(live?'Live order.':'Test-mode order.')+' Accepted offer checkout. No payment is confirmed yet. Protection: '+plan.tier+(plan.comingSoon?' (SafePurchase inspection coming soon)':'')+'.'}),createdAt:stamp}),reservation.finish])}
 catch(error){if(operationGuardFailed(error)||/commerce_(?:order_request|open_listing)_unique|UNIQUE constraint failed: commerce_orders/.test(String((error as Error)?.cause||error)))throw new ApiRequestError('This listing was reserved or the offer changed. Refresh and try again.',409);throw error}
 const [row]=await db.select().from(commerceOrders).where(eq(commerceOrders.id,orderId));
 return continuePayment(db,row,profile,email,environment,processor);
}

/** Days a local-pickup code stays valid after payment (owner default 7; COMMERCE_PICKUP_CODE_DAYS 1-30). */
export function pickupCodeDays(environment:StripeSandboxEnv){const raw=String((environment as Record<string,unknown>).COMMERCE_PICKUP_CODE_DAYS??'').trim();const value=/^\d+$/.test(raw)?Number(raw):7;return value>=1&&value<=30?value:7}
function pickupCodeExpiresAt(state:State,environment:StripeSandboxEnv){const paid=Date.parse(state.order.paidAt||'');return Number.isFinite(paid)?new Date(paid+pickupCodeDays(environment)*day).toISOString():null}
/** Server-side guard for the seller's code entry: a code older than the pickup window is refused. */
export async function commercePickupCodeOpen(db:Db,userId:string,orderId:unknown,environment:StripeSandboxEnv){
 const row=await commerceOwnedOrder(db,userId,id.parse(orderId)),state=stateOf(row),expires=pickupCodeExpiresAt(state,environment);
 if(state.pickup)return;
 if(expires&&Date.now()>=Date.parse(expires))throw new ApiRequestError('This pickup code expired '+pickupCodeDays(environment)+' days after payment. The buyer is refunded; no hand-off can be confirmed now.',409);
}

/**
 * Delivery details for the seller of a paid order. Paid means confirmed by a signed Stripe event
 * (state.order.paidAt is written only by recordPaid). Buyer address: Standard shipping orders only,
 * from payment until delivery. SafePurchase: the ComicHuddle receiving address, never the buyer's.
 */
export async function commerceDeliveryInfo(db:Db,userId:string,orderId:unknown,environment:StripeSandboxEnv){
 const row=await commerceOwnedOrder(db,userId,id.parse(orderId)),state=stateOf(row),snapshot=snapshotOf(row),dto=commerceOrderDto(row,userId);
 const paid=!!state.order.paidAt,refunded=state.financial?.kind==='refund'||['refunded','refund_pending','refund_eligible','cancelled','checkout_expired'].includes(dto.status),delivered=!!state.shipment.deliveredAt||!!state.pickup,safePurchase=state.policy.tier==='safepurchase';
 const base={orderId:row.id,role:dto.role,fulfillment:snapshot.fulfillment,paymentConfirmed:paid,delivered,safePurchase,
  shipBy:paid&&!delivered&&!refunded&&snapshot.fulfillment==='shipping'&&dto.paymentTimingVerified?dto.trackingDeadlineAt:null,
  handlingBusinessDays:snapshot.protection?.handlingBusinessDays??state.policy.handlingBusinessDays??null,
  method:{fulfillment:snapshot.fulfillment,shippingCents:snapshot.shippingCents,signatureRequired:!!snapshot.protection?.signatureRequired,insured:!!snapshot.protection?.insured},
  pickupCodeExpiresAt:snapshot.fulfillment==='pickup'&&paid&&!state.pickup?pickupCodeExpiresAt(state,environment):null};
 const hidden=(reason:string)=>({...base,shipTo:null,hiddenReason:reason});
 if(dto.role!=='seller')return hidden(dto.role==='buyer'?'buyer_view':'not_participant');
 if(!paid)return hidden('awaiting_payment');
 if(refunded)return hidden('refunded');
 if(snapshot.fulfillment==='pickup')return hidden('pickup');
 if(delivered)return hidden('delivered');
 if(safePurchase){
  if(state.inspection?.receivedAt)return hidden('received_at_inspection');
  const address=protectionConfig(environment).inspectionAddress;
  return {...base,shipTo:{kind:'inspection' as const,address,placeholder:!address},hiddenReason:null};
 }
 const to=snapshot.shippingAddress;if(!to)return hidden('no_address');
 const [buyer]=await db.select({name:profiles.name}).from(profiles).where(eq(profiles.id,row.buyerId));
 return {...base,shipTo:{kind:'buyer' as const,buyerName:buyer?.name||to.name,name:to.name,line1:to.line1,line2:to.line2||'',city:to.city,state:to.state,postalCode:to.postalCode,country:to.country},hiddenReason:null};
}

export const commercePickupExpirySchema=z.object({action:z.literal('pickup_expiry_sweep'),sandboxAcknowledged:z.literal(true)}).strict();
/**
 * Owner sweep: a paid Standard local-pickup order whose code went unused for the pickup window
 * (default 7 days) is approved for a full refund (operator decision recorded on the order) and
 * refunded through the same idempotent refund path as the owner sweep. Orders with an open problem
 * report, a dispute or any money movement are left for support.
 */
export async function commercePickupExpirySweep(db:Db,userId:string,raw:Record<string,unknown>,environment:StripeSandboxEnv){
 if(userId!==ownerAccountId)throw new ApiRequestError('Owner access required.',403);commercePickupExpirySchema.parse(raw);needReady(environment);
 const cutoff=Date.now()-pickupCodeDays(environment)*day,results:{orderId:string;result:string;reason?:string}[]=[];
 const rows=await db.select().from(commerceOrders).where(and(eq(commerceOrders.sandbox,modeFlag(environment)),inArray(commerceOrders.status,['awaiting_pickup','refund_eligible','refund_pending']))).orderBy(commerceOrders.updatedAt).limit(50);
 const {notifyOrderEvent}=await import('./offers');
 for(let row of rows){
  const state=stateOf(row),snapshot=snapshotOf(row),paid=Date.parse(state.order.paidAt||'');
  if(snapshot.fulfillment!=='pickup'||state.policy.tier==='safepurchase'||!Number.isFinite(paid)||paid>cutoff||state.pickup)continue;
  if(state.issue?.open||state.dispute!=='none'||state.financial&&state.financial.kind!=='refund'){results.push({orderId:row.id,result:'manual_review',reason:'open_issue_or_money_movement'});continue}
  try{
   const fresh=!state.refundReason&&!state.financial;
   if(fresh){const next={...state,refundReason:'operator_refund' as const};row=await persist(db,row,evaluateCommercePolicy(next,now()).state as State,'pickup_code_expired',{note:'The pickup code went unused for '+pickupCodeDays(environment)+' days. Full refund approved for the buyer.'})}
   const result=await refundOrder(db,userId,row.id,await deterministicRefundId(row.id),false,environment,true);
   if(fresh)await notifyOrderEvent(row.id,'pickup_expired');
   results.push({orderId:row.id,result:result.order.status});
  }catch(error){results.push({orderId:row.id,result:'reconciliation_required',reason:error instanceof ApiRequestError?'order_or_policy_changed':error instanceof StripeSandboxError?'processor_response_unconfirmed':'operation_unconfirmed'})}
 }
 return {sandbox:modeOf(environment)==='test',results,scheduled:false,note:'Manual owner sweep: unused pickup codes older than '+pickupCodeDays(environment)+' days are refunded. No background scheduler is installed.'};
}
// --- end offers (round 4) ---
