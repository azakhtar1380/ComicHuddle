// Shopping cart (round 4, migration 038). Server-only.
//
// The cart is a list of listing ids per signed-in account. It never holds a comic by itself: holds are the
// existing commerce reservations (commerce_orders 'awaiting_payment' + listing status 'checkout_reserved'),
// which expire with the order's Stripe Checkout Session (CHECKOUT_EXPIRY_SECONDS) and are released by the
// signed webhook / owner sweep. Cart checkout reuses commerceCheckout() for every item, so every server
// guard (eligibility, ownership, blocks, seller onboarding, price snapshot, single open order per listing)
// applies unchanged. Payment stays one Stripe payment per order, because payment confirmation is bound to
// exactly one order per Checkout Session.
import {and,eq,inArray} from 'drizzle-orm';
import {z} from 'zod';
import {getPool} from '../db/postgres';
import {commerceOrders,profiles} from '../db/schema';
import {ApiRequestError} from './api-security';
import {commerceCancelCheckout,commerceCheckout,commerceOrderDto,type StripeSandboxEnv} from './commerce';
import {protectionConfig,protectionPlan} from './commerce-protection';
import {listingItems} from './marketplace';
import {CHECKOUT_EXPIRY_SECONDS} from './stripe-sandbox';
import type {getDb} from '../db';

type Db=ReturnType<typeof getDb>;
type Profile=typeof profiles.$inferSelect;

export const CART_MAX_ITEMS=50;
export const CART_CHECKOUT_MAX_ITEMS=10;

/** Thrown when migration 038 has not been applied yet. */
export class CartUnavailableError extends ApiRequestError{constructor(){super('Your cart is being set up. Please try again soon.',503)}}
function missingTable(error:unknown){let cause:unknown=error;for(let depth=0;depth<5&&cause;depth++){const value=cause as {code?:string;cause?:unknown};if(value.code==='42P01')return true;cause=value.cause}return false}
async function query<T extends Record<string,unknown>>(text:string,values:unknown[]=[]){
 try{return (await getPool().query<T>(text,values)).rows}
 catch(error){if(missingTable(error))throw new CartUnavailableError();throw error}
}

const listingId=z.string().trim().min(1).max(100);
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ListingRow={id:string;seller_id:string;title:string;grade:string;price:number;shipping:number;photos:string;status:string;sale_type:string;kind:string;items:string;item_count:number;book_id:string;issue_id:number|null;fulfillment:string;safe_purchase_opt_in:number;usa_attested_at:string;seller_user_id:string;seller_name:string;seller_handle:string;seller_visible:number;seller_moderated:number;seller_deleting:string|null;blocked:boolean};
const listingColumns=`l.id,l.seller_id,l.title,l.grade,l.price,l.shipping,l.photos,l.status,l.sale_type,l.kind,l.items,l.item_count,l.book_id,l.issue_id,l.fulfillment,l.safe_purchase_opt_in,l.usa_attested_at,
 s.user_id AS seller_user_id,s.name AS seller_name,s.handle AS seller_handle,s.visible AS seller_visible,s.moderated AS seller_moderated,s.deletion_started_at AS seller_deleting,
 EXISTS (SELECT 1 FROM ch_web.blocks b JOIN ch_web.profiles me ON me.user_id=$1 WHERE (b.from_id=me.id AND b.to_id=s.id) OR (b.from_id=s.id AND b.to_id=me.id)) AS blocked`;

/** Why a listing cannot go into the cart, or null when it can. Mirrors the checkout eligibility rules. */
function addProblem(row:ListingRow|undefined,userId:string){
 if(!row)return 'That listing no longer exists.';
 if(row.seller_user_id===userId)return 'This is your own listing.';
 if(row.sale_type!=='fixed')return 'Auctions can’t go in the cart. Bid on the listing instead.';
 if(row.status==='sold')return 'This comic has already sold.';
 if(row.status==='checkout_reserved')return 'Someone is checking out with this comic right now.';
 if(row.status!=='active')return 'This listing isn’t for sale right now.';
 if(!row.seller_visible||row.seller_moderated||row.seller_deleting||!row.usa_attested_at||row.blocked)return 'This listing is unavailable.';
 return null;
}

// --- count and ids (header icon, add buttons) --------------------------------------------------------
export async function cartIds(userId:string){
 const rows=await query<{listing_id:string;saved_for_later:boolean}>('SELECT listing_id,saved_for_later FROM ch_web.cart_items WHERE user_id=$1 ORDER BY added_at DESC LIMIT $2',[userId,CART_MAX_ITEMS]);
 const holds=await query<{n:number}>("SELECT count(*)::int AS n FROM ch_web.commerce_orders WHERE buyer_user_id=$1 AND status='awaiting_payment' AND created_at::timestamptz > now() - make_interval(secs => $2)",[userId,CHECKOUT_EXPIRY_SECONDS]).catch(()=>[{n:0}]);
 const active=rows.filter(row=>!row.saved_for_later).map(row=>row.listing_id),saved=rows.filter(row=>row.saved_for_later).map(row=>row.listing_id);
 return {listingIds:active,savedIds:saved,holds:Number(holds[0]?.n||0),count:active.length+Number(holds[0]?.n||0)};
}

// --- writes -----------------------------------------------------------------------------------------
export async function addToCart(userId:string,raw:unknown,saveForLater=false){
 const id=listingId.parse(raw);
 const [row]=await query<ListingRow>(`SELECT ${listingColumns} FROM ch_web.listings l JOIN ch_web.profiles s ON s.id=l.seller_id WHERE l.id=$2`,[userId,id]);
 const problem=addProblem(row,userId);if(problem)throw new ApiRequestError(problem,409);
 const [{n}]=await query<{n:number}>('SELECT count(*)::int AS n FROM ch_web.cart_items WHERE user_id=$1',[userId]);
 const existing=await query<{listing_id:string}>('SELECT listing_id FROM ch_web.cart_items WHERE user_id=$1 AND listing_id=$2',[userId,id]);
 if(!existing.length&&Number(n)>=CART_MAX_ITEMS)throw new ApiRequestError('Your cart is full ('+CART_MAX_ITEMS+' comics). Remove something first.',409);
 await query('INSERT INTO ch_web.cart_items (user_id,listing_id,saved_for_later,price_cents,shipping_cents) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id,listing_id) DO NOTHING',[userId,id,saveForLater,row!.price,row!.shipping]);
 return cartIds(userId);
}
export async function removeFromCart(userId:string,raw:unknown){
 const id=listingId.parse(raw);
 await query('DELETE FROM ch_web.cart_items WHERE user_id=$1 AND listing_id=$2',[userId,id]);
 return cartIds(userId);
}
export async function setSavedForLater(userId:string,raw:unknown,saved:boolean){
 const id=listingId.parse(raw);
 const rows=await query<{listing_id:string}>('UPDATE ch_web.cart_items SET saved_for_later=$3 WHERE user_id=$1 AND listing_id=$2 RETURNING listing_id',[userId,id,saved]);
 if(!rows.length)throw new ApiRequestError('That comic isn’t in your cart any more.',404);
 return cartIds(userId);
}
/** Guest cart (kept in the browser) merged after sign-in. Ineligible listings are skipped silently. */
export async function mergeGuestCart(userId:string,raw:unknown){
 const ids=[...new Set(z.array(listingId).max(CART_MAX_ITEMS).parse(raw))];
 let added=0;
 for(const id of ids){try{await addToCart(userId,id);added++}catch(error){if(error instanceof CartUnavailableError)throw error}}
 return {...await cartIds(userId),merged:added};
}

// --- full cart view ---------------------------------------------------------------------------------
export type CartItemStatus='available'|'held_by_you'|'reserved'|'sold'|'unavailable';
export type CartItemView={listingId:string;href:string;title:string;issue:string;condition:string;kind:'single'|'collection';itemCount:number;priceCents:number;shippingCents:number;addedPriceCents:number;priceChanged:boolean;photo:string|null;seller:{id:string;name:string;handle:string};status:CartItemStatus;problem:string|null;pickupOnly:boolean;checkoutReady:boolean;savedForLater:boolean;safePurchaseAutomatic:boolean;safePurchaseOptional:boolean};
export type CartHold={orderId:string;listingId:string;title:string;totalCents:number;reservedUntil:string|null};

function firstPhoto(row:ListingRow){
 try{const photos=JSON.parse(row.photos) as unknown[],items=JSON.parse(row.items) as {photoId?:unknown}[];const first=[...(Array.isArray(photos)?photos:[]),...(Array.isArray(items)?items.map(item=>item?.photoId):[])].find(value=>typeof value==='string'&&uuidPattern.test(value));return typeof first==='string'?'/api/media?id='+first+'&size=thumbnail':null}catch{return null}
}
function describe(row:ListingRow){
 try{
  const items=listingItems({...row,sellerId:row.seller_id,saleType:row.sale_type,itemCount:row.item_count,bookId:row.book_id,issueId:row.issue_id} as unknown as Parameters<typeof listingItems>[0]),first=items[0];
  const grade=first?.condition?(first.condition.mode==='CGC'?'CGC '+first.condition.grade+(first.condition.label!=='Universal'?' '+first.condition.label:''):'Raw '+first.condition.grade):(first?.grade||row.grade||'');
  return {issue:items.length===1&&first?.issue?first.issue:'',condition:items.length>1?'':grade};
 }catch{return {issue:'',condition:row.grade||''}}
}

export async function cartView(db:Db,userId:string,environment:StripeSandboxEnv){
 const rows=await query<ListingRow&{listing_id:string;saved_for_later:boolean;price_cents:number;shipping_cents:number;missing:boolean}>(
  `SELECT c.listing_id,c.saved_for_later,c.price_cents,c.shipping_cents,l.id IS NULL AS missing,${listingColumns}
   FROM ch_web.cart_items c LEFT JOIN ch_web.listings l ON l.id=c.listing_id LEFT JOIN ch_web.profiles s ON s.id=l.seller_id
   WHERE c.user_id=$1 ORDER BY c.added_at DESC LIMIT ${CART_MAX_ITEMS}`,[userId]);
 const open=await db.select().from(commerceOrders).where(and(eq(commerceOrders.buyerUserId,userId),eq(commerceOrders.status,'awaiting_payment')));
 const heldByMe=new Set(open.map(order=>order.listingId));
 const holds:CartHold[]=[];
 for(const order of open){try{const dto=commerceOrderDto(order,userId),until=(dto as {reservedUntil?:string}).reservedUntil??null;if(until&&Date.parse(until)<=Date.now())continue;holds.push({orderId:order.id,listingId:order.listingId,title:dto.title,totalCents:dto.totalCents,reservedUntil:until})}catch{/* needs operator reconciliation; Orders shows it */}}
 const protection=protectionConfig(environment);
 const items:CartItemView[]=rows.map(row=>{
  if(row.missing)return {listingId:row.listing_id,href:'/?section=Marketplace',title:'Listing removed',issue:'',condition:'',kind:'single',itemCount:1,priceCents:Number(row.price_cents),shippingCents:Number(row.shipping_cents),addedPriceCents:Number(row.price_cents),priceChanged:false,photo:null,seller:{id:'',name:'',handle:''},status:'unavailable',problem:'The seller removed this listing.',pickupOnly:false,checkoutReady:false,savedForLater:row.saved_for_later,safePurchaseAutomatic:false,safePurchaseOptional:false};
  const problem=addProblem(row,userId),held=row.status==='checkout_reserved'&&heldByMe.has(row.id);
  const status:CartItemStatus=!problem?'available':held?'held_by_you':row.status==='checkout_reserved'?'reserved':row.status==='sold'?'sold':'unavailable';
  const pickupOnly=row.fulfillment==='pickup',plan=protectionPlan(protection,{itemCents:Number(row.price),fulfillment:'shipping',sellerOptIn:!!row.safe_purchase_opt_in,buyerOptIn:false,waiveSafePurchase:false});
  const {issue,condition}=describe(row),addedPrice=Number(row.price_cents);
  return {listingId:row.id,href:'/?'+new URLSearchParams({section:'Marketplace',listing:row.id}),title:row.title,issue,condition,kind:row.kind==='collection'?'collection':'single',itemCount:Number(row.item_count)||1,priceCents:Number(row.price),shippingCents:pickupOnly?0:Number(row.shipping),addedPriceCents:addedPrice,priceChanged:addedPrice>0&&addedPrice!==Number(row.price),photo:firstPhoto(row),seller:{id:row.seller_id,name:row.seller_name||'Collector',handle:row.seller_handle||''},status,
   problem:held?'You’re already checking out with this comic. Pay for it below.':problem||(pickupOnly?'Local pickup only. Buy it from the listing page.':null),pickupOnly,checkoutReady:status==='available'&&!pickupOnly,savedForLater:row.saved_for_later,
   safePurchaseAutomatic:plan.tier==='safepurchase',safePurchaseOptional:protection.safePurchaseEnabled&&plan.tier!=='safepurchase'};
 });
 return {signedIn:true as const,items,holds,safePurchase:{enabled:protection.safePurchaseEnabled,feeCents:protection.safePurchaseEnabled?protection.feeCents:0},
  // Orders carry taxCents=0 and Stripe Checkout is created without automatic tax, so no tax line is shown.
  taxCalculated:false,limits:{maxItems:CART_MAX_ITEMS,maxCheckoutItems:CART_CHECKOUT_MAX_ITEMS}};
}

// --- checkout ---------------------------------------------------------------------------------------
const cartCheckoutSchema=z.object({
 action:z.literal('checkout'),requestId:z.string().uuid(),sandboxAcknowledged:z.literal(true),safePurchaseOptIn:z.boolean().default(false),
 shippingAddress:z.record(z.unknown()),
 checkoutUiMode:z.enum(['hosted_page','elements']).default('hosted_page'),
 items:z.array(z.object({listingId,priceCents:z.number().int().min(0),shippingCents:z.number().int().min(0)}).strict()).min(1).max(CART_CHECKOUT_MAX_ITEMS)
}).strict();

/** Deterministic per-item request id, so a retried cart checkout resumes the same orders (never a second order). */
async function itemRequestId(cartRequestId:string,listing:string){
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('comichuddle-cart:'+cartRequestId+':'+listing))).slice(0,16);
 bytes[6]=(bytes[6]&0x0f)|0x40;bytes[8]=(bytes[8]&0x3f)|0x80;
 const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
 return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
}

/**
 * Holds every comic in the cart first, then hands back one payment per order.
 * All-or-nothing: if any item can't be held, the holds made by this attempt are cancelled again
 * (if a cancel fails, that hold still expires with its Checkout Session).
 */
export async function cartCheckout(db:Db,profile:Profile,email:string,raw:Record<string,unknown>,environment:StripeSandboxEnv){
 const input=cartCheckoutSchema.parse(raw);
 const ids=input.items.map(item=>item.listingId);if(new Set(ids).size!==ids.length)throw new ApiRequestError('Each comic can only be in your cart once.',400);
 const view=await cartView(db,profile.userId,environment),byId=new Map(view.items.map(item=>[item.listingId,item]));
 for(const requested of input.items){
  const item=byId.get(requested.listingId);
  if(!item||item.savedForLater)throw new ApiRequestError('Your cart changed. Refresh it and check again.',409);
  if(!item.checkoutReady)throw new ApiRequestError('“'+item.title+'” can’t be checked out from the cart: '+(item.problem||'it isn’t available.'),409);
  if(item.priceCents!==requested.priceCents||item.shippingCents!==requested.shippingCents)throw new ApiRequestError('The price or shipping of “'+item.title+'” changed. Review your cart and check out again.',409);
 }
 const before=new Set((await db.select({id:commerceOrders.id}).from(commerceOrders).where(and(eq(commerceOrders.buyerUserId,profile.userId),eq(commerceOrders.status,'awaiting_payment')))).map(row=>row.id));
 const created:string[]=[],held:{orderId:string;listingId:string;title:string;totalCents:number;checkoutUrl:string|null}[]=[];
 const safePurchaseOptIn=input.safePurchaseOptIn&&view.safePurchase.enabled;
 for(const requested of input.items){
  const item=byId.get(requested.listingId)!;
  try{
   const result=await commerceCheckout(db,profile,email,{action:'checkout',listingId:item.listingId,requestId:await itemRequestId(input.requestId,item.listingId),sandboxAcknowledged:true,fulfillment:'shipping',shippingAddress:input.shippingAddress,storeCreditCents:0,checkoutUiMode:input.checkoutUiMode,safePurchaseOptIn,waiveSafePurchase:false},environment);
   const order=result.order;
   if(!before.has(order.id))created.push(order.id);
   if(order.status!=='awaiting_payment')throw new ApiRequestError('This checkout attempt was already used. Start checkout again.',409);
   held.push({orderId:order.id,listingId:item.listingId,title:order.title,totalCents:order.totalCents,checkoutUrl:result.checkoutUrl??null});
  }catch(error){
   let released=true;
   for(const orderId of created){try{await commerceCancelCheckout(db,profile.userId,{action:'cancel_checkout',orderId},environment)}catch{released=false}}
   const reason=error instanceof ApiRequestError?error.message:error instanceof z.ZodError?'Check your shipping address.':'It couldn’t be held.';
   throw new ApiRequestError('“'+item.title+'”: '+reason+' Nothing was charged'+(released?' and no comics are held.':'. Any comic still held is released automatically within an hour.'),error instanceof ApiRequestError?error.status:409);
  }
 }
 // Held comics leave the cart; the cart page lists them under "Pay for your held comics" until paid or expired.
 const heldIds=held.map(item=>item.listingId);
 if(heldIds.length)await query('DELETE FROM ch_web.cart_items WHERE user_id=$1 AND listing_id = ANY($2::text[])',[profile.userId,heldIds]);
 const reservedUntil=held.length?(await db.select({createdAt:commerceOrders.createdAt}).from(commerceOrders).where(inArray(commerceOrders.id,held.map(item=>item.orderId)))).map(row=>new Date(Date.parse(row.createdAt)+CHECKOUT_EXPIRY_SECONDS*1000).toISOString()).sort()[0]??null:null;
 return {held,reservedUntil,note:'Every comic is held for you. Pay for each one below before the hold ends.'};
}

// --- guest cart ------------------------------------------------------------------------------------
/** A signed-out visitor's cart (listing ids kept in their browser): public listing details only, no holds.
 *  Checkout still needs an account; after sign-in these ids merge into the account cart (mergeGuestCart). */
export async function guestCartView(rawIds:unknown,environment:StripeSandboxEnv){
 const ids=z.array(listingId).max(CART_MAX_ITEMS).parse(rawIds);
 const rows=ids.length?await query<ListingRow>(`SELECT ${listingColumns} FROM ch_web.listings l LEFT JOIN ch_web.profiles s ON s.id=l.seller_id WHERE l.id = ANY($2::text[])`,['',ids]):[];
 const byId=new Map(rows.map(row=>[row.id,row])),protection=protectionConfig(environment);
 const items:CartItemView[]=ids.flatMap(id=>{
  const row=byId.get(id);if(!row)return [];
  const problem=addProblem(row,''),pickupOnly=row.fulfillment==='pickup';
  const status:CartItemStatus=!problem?'available':row.status==='checkout_reserved'?'reserved':row.status==='sold'?'sold':'unavailable';
  const plan=protectionPlan(protection,{itemCents:Number(row.price),fulfillment:'shipping',sellerOptIn:!!row.safe_purchase_opt_in,buyerOptIn:false,waiveSafePurchase:false});
  const {issue,condition}=describe(row);
  return [{listingId:row.id,href:'/?'+new URLSearchParams({section:'Marketplace',listing:row.id}),title:row.title,issue,condition,kind:row.kind==='collection'?'collection':'single',itemCount:Number(row.item_count)||1,priceCents:Number(row.price),shippingCents:pickupOnly?0:Number(row.shipping),addedPriceCents:Number(row.price),priceChanged:false,photo:firstPhoto(row),seller:{id:row.seller_id,name:row.seller_name||'Collector',handle:row.seller_handle||''},status,
   problem:problem||(pickupOnly?'Local pickup only. Buy it from the listing page.':null),pickupOnly,checkoutReady:status==='available'&&!pickupOnly,savedForLater:false,safePurchaseAutomatic:plan.tier==='safepurchase',safePurchaseOptional:protection.safePurchaseEnabled&&plan.tier!=='safepurchase'}];
 });
 return {signedIn:false as const,items,holds:[] as CartHold[],safePurchase:{enabled:protection.safePurchaseEnabled,feeCents:protection.safePurchaseEnabled?protection.feeCents:0},taxCalculated:false,limits:{maxItems:CART_MAX_ITEMS,maxCheckoutItems:CART_CHECKOUT_MAX_ITEMS}};
}
