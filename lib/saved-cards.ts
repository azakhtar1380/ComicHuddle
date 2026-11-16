// Saved cards for auctions (migration 048). A bidder saves a card through Stripe Checkout in setup mode plus a
// shipping address, before their first binding bid. If they win, the daily commerce job charges that card
// off-session (lib/commerce.ts commerceChargeAuctionWinners). Only Stripe IDs and the card's brand, last 4 digits
// and expiry are stored. A card counts as saved only after Stripe confirms the setup session server-side.
import {z} from 'zod';
import {getPool} from '../db/postgres';
import {ApiRequestError} from './api-security';
import {usAddressSchema,type UsAddress} from './us-address';
import type {StripeVerifiedEvent} from './stripe-sandbox';

export type SavedCard={brand:string;last4:string;exp:string;address:UsAddress|null;ready:boolean;pending:boolean};
type CardRow={user_id:string;profile_id:string;stripe_customer_id:string;payment_method_id:string|null;card_brand:string;card_last4:string;card_exp:string;shipping_address:string;setup_session_id:string|null;status:string};
export type SavedCardProcessor={
 createCustomer(input:{userId:string;profileId:string;email?:string},key:string):Promise<{id?:unknown}>;
 createSetupCheckout(input:{customerId:string;userId:string;successUrl:string;cancelUrl:string},key:string):Promise<{id?:unknown;url?:unknown}>;
 retrieveSavedCard(sessionId:string,binding:{userId:string;customerId:string}):Promise<{paymentMethodId:string;brand:string;last4:string;exp:string}>;
 detachPaymentMethod(paymentMethodId:string,key:string):Promise<unknown>;
};

export const saveCardSchema=z.object({action:z.literal('save_card'),shippingAddress:usAddressSchema,returnTo:z.string().max(300).optional()}).strict();
export const saveAddressSchema=z.object({action:z.literal('save_address'),shippingAddress:usAddressSchema}).strict();
export const confirmCardSchema=z.object({action:z.literal('confirm_card'),sessionId:z.string().regex(/^cs_(?:test|live)_[A-Za-z0-9]+$/).max(255)}).strict();
export const removeCardSchema=z.object({action:z.literal('remove_card')}).strict();

function parseAddress(raw:string):UsAddress|null{try{const parsed=usAddressSchema.safeParse(JSON.parse(raw));return parsed.success?parsed.data:null}catch{return null}}
async function rowFor(userId:string,sandbox:0|1){return (await getPool().query<CardRow>('SELECT * FROM ch_web.buyer_saved_cards WHERE user_id=$1 AND sandbox=$2',[userId,sandbox])).rows[0]}

/** What the buyer sees: never the Stripe IDs. */
export async function savedCardView(userId:string,sandbox:0|1):Promise<SavedCard|null>{
 const row=await rowFor(userId,sandbox).catch(()=>undefined);if(!row||row.status==='removed'&&!row.shipping_address)return null;
 const ready=row.status==='ready'&&!!row.payment_method_id;
 return {brand:ready?row.card_brand:'',last4:ready?row.card_last4:'',exp:ready?row.card_exp:'',address:parseAddress(row.shipping_address),ready,pending:!!row.setup_session_id};
}
/** Server-only: the IDs needed to charge, when the card and address are both saved. */
export async function chargeableCard(userId:string,sandbox:0|1){
 const row=await rowFor(userId,sandbox);const address=row?parseAddress(row.shipping_address):null;
 if(!row||row.status!=='ready'||!row.payment_method_id)return null;
 return {customerId:row.stripe_customer_id,paymentMethodId:row.payment_method_id,address,brand:row.card_brand,last4:row.card_last4};
}

async function customerFor(processor:SavedCardProcessor,input:{userId:string;profileId:string;email?:string|null;sandbox:0|1}){
 const existing=await rowFor(input.userId,input.sandbox);if(existing)return existing.stripe_customer_id;
 const customer=await processor.createCustomer({userId:input.userId,profileId:input.profileId,...(input.email?{email:input.email}:{})},'comichuddle_customer_'+input.sandbox+'_'+input.userId);
 if(typeof customer.id!=='string')throw new ApiRequestError('Stripe could not set up your card. Nothing was saved.',502);
 await getPool().query("INSERT INTO ch_web.buyer_saved_cards(user_id,sandbox,profile_id,stripe_customer_id,status) VALUES($1,$2,$3,$4,'pending') ON CONFLICT (user_id,sandbox) DO NOTHING",[input.userId,input.sandbox,input.profileId,customer.id]);
 return (await rowFor(input.userId,input.sandbox))!.stripe_customer_id;
}
const safeReturn=(value:string|undefined)=>value&&value.startsWith('/')&&!value.startsWith('//')&&!/[\u0000- \\]/.test(value)?value:'/wallet';

/** Saves the address, then opens Stripe's card page. The current card stays in use until the new one is confirmed. */
export async function startSaveCard(processor:SavedCardProcessor,input:{userId:string;profileId:string;email?:string|null;sandbox:0|1;raw:Record<string,unknown>}){
 const value=saveCardSchema.parse(input.raw),customerId=await customerFor(processor,input),back=safeReturn(value.returnTo);
 const join=back.includes('?')?'&':'?';
 const session=await processor.createSetupCheckout({customerId,userId:input.userId,successUrl:back+join+'card=saved&card_session={CHECKOUT_SESSION_ID}',cancelUrl:back+join+'card=cancelled'},'comichuddle_setup_'+crypto.randomUUID());
 if(typeof session.id!=='string'||typeof session.url!=='string')throw new ApiRequestError('Stripe could not open the card page. Nothing was saved.',502);
 await getPool().query('UPDATE ch_web.buyer_saved_cards SET shipping_address=$3,setup_session_id=$4,updated_at=now() WHERE user_id=$1 AND sandbox=$2',[input.userId,input.sandbox,JSON.stringify(value.shippingAddress),session.id]);
 return {url:session.url};
}
export async function saveShippingAddress(userId:string,sandbox:0|1,raw:Record<string,unknown>){
 const value=saveAddressSchema.parse(raw);
 const r=await getPool().query('UPDATE ch_web.buyer_saved_cards SET shipping_address=$3,updated_at=now() WHERE user_id=$1 AND sandbox=$2 RETURNING user_id',[userId,sandbox,JSON.stringify(value.shippingAddress)]);
 if(!r.rows.length)throw new ApiRequestError('Save a card first. Your address is saved together with it.',409);
 return {saved:true,card:await savedCardView(userId,sandbox)};
}

/** Confirms a finished setup session, from the signed webhook or the buyer's return. Safe to run twice. */
export async function confirmSavedCard(processor:SavedCardProcessor,userId:string,sandbox:0|1,sessionId:string){
 const row=await rowFor(userId,sandbox);if(!row)throw new ApiRequestError('No card setup was started for this account.',404);
 // Already confirmed (by the webhook or an earlier return): nothing to do.
 if(row.setup_session_id!==sessionId)return {saved:row.status==='ready',duplicate:true,card:await savedCardView(userId,sandbox)};
 const card=await processor.retrieveSavedCard(sessionId,{userId,customerId:row.stripe_customer_id});
 const r=await getPool().query<{old:string|null}>("UPDATE ch_web.buyer_saved_cards c SET payment_method_id=$3,card_brand=$4,card_last4=$5,card_exp=$6,status='ready',setup_session_id=NULL,updated_at=now() FROM (SELECT payment_method_id AS old FROM ch_web.buyer_saved_cards WHERE user_id=$1 AND sandbox=$2) prev WHERE c.user_id=$1 AND c.sandbox=$2 AND c.setup_session_id=$7 RETURNING prev.old",[userId,sandbox,card.paymentMethodId,card.brand,card.last4,card.exp,sessionId]);
 const old=r.rows[0]?.old;
 // The replaced card is removed from Stripe too. If that fails it is simply never charged again.
 if(old&&old!==card.paymentMethodId)await processor.detachPaymentMethod(old,'comichuddle_detach_'+old).catch(()=>undefined);
 return {saved:true,duplicate:!r.rows.length,card:await savedCardView(userId,sandbox)};
}
export async function removeSavedCard(processor:SavedCardProcessor,userId:string,sandbox:0|1){
 const row=await rowFor(userId,sandbox);if(!row?.payment_method_id)return {removed:true,card:await savedCardView(userId,sandbox)};
 await processor.detachPaymentMethod(row.payment_method_id,'comichuddle_detach_'+row.payment_method_id);
 await getPool().query("UPDATE ch_web.buyer_saved_cards SET payment_method_id=NULL,card_brand='',card_last4='',card_exp='',status='removed',updated_at=now() WHERE user_id=$1 AND sandbox=$2",[userId,sandbox]);
 return {removed:true,card:await savedCardView(userId,sandbox)};
}

/** Signed webhook: checkout.session.completed for a card setup. Returns null for every other event. */
export async function applySavedCardEvent(processor:SavedCardProcessor,event:StripeVerifiedEvent,sandbox:0|1){
 const object=event.data.object as Record<string,unknown>,metadata=(object.metadata||{}) as {purpose?:unknown;user_id?:unknown};
 if(object.mode!=='setup'||metadata.purpose!=='saved_card')return null;
 if(event.type!=='checkout.session.completed'||typeof metadata.user_id!=='string'||typeof object.id!=='string')return {received:true,ignored:true};
 try{const result=await confirmSavedCard(processor,metadata.user_id,sandbox,object.id);return {received:true,savedCard:result.duplicate?'duplicate':'saved'}}
 catch(error){if(error instanceof ApiRequestError&&error.status===404)return {received:true,ignored:true};throw error}
}

/** Bidding rule: a saved card and address before the first binding bid, while online payments are on. */
export async function needSavedCardToBid(userId:string,sandbox:0|1){
 const card=await chargeableCard(userId,sandbox).catch(()=>null);
 if(!card||!card.address)throw new ApiRequestError('Save a card and shipping address before your first bid. If you win, we charge that card automatically.',428);
}
