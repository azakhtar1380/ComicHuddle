// Server-side protection configuration (docs/BUYER-PROTECTION-POLICY.md) and pickup codes.
// Checkout snapshots the resulting policy onto each order; later config changes never alter it.
import {commercePolicyVersion,type CommercePolicy,type Fulfillment,type ProtectionTier} from './commerce-policy';

export type ProtectionEnv={
 SAFEPURCHASE_ENABLED?:unknown;SAFEPURCHASE_THRESHOLD_CENTS?:unknown;SAFEPURCHASE_FEE_CENTS?:unknown;SAFEPURCHASE_INBOUND_SHIPPING_FALLBACK_CENTS?:unknown;SAFEPURCHASE_RELEASE_HOLD_HOURS?:unknown;SAFEPURCHASE_INSPECTION_ADDRESS?:unknown;
 COMMERCE_RELEASE_HOLD_HOURS?:unknown;COMMERCE_HANDLING_DAYS?:unknown;COMMERCE_CLAIM_DAYS?:unknown;
 COMMERCE_PICKUP_CODE_SECRET?:unknown;BETTER_AUTH_SECRET?:unknown;
};
function integer(value:unknown,fallback:number,min:number,max:number){const text=typeof value==='string'?value.trim():typeof value==='number'?String(value):'';if(!/^\d+$/.test(text))return fallback;const parsed=Number(text);return Number.isSafeInteger(parsed)&&parsed>=min&&parsed<=max?parsed:fallback}
export type ProtectionConfig={safePurchaseEnabled:boolean;thresholdCents:number;feeCents:number;inboundFallbackCents:number;safePurchaseHoldHours:number;standardHoldHours:number;handlingBusinessDays:number;claimDays:number;inspectionAddress:string|null};
export function protectionConfig(env:ProtectionEnv):ProtectionConfig{
 const address=typeof env.SAFEPURCHASE_INSPECTION_ADDRESS==='string'&&env.SAFEPURCHASE_INSPECTION_ADDRESS.trim().length>=10?env.SAFEPURCHASE_INSPECTION_ADDRESS.trim().slice(0,300):null;
 // An inspection center without an address cannot receive books, so it stays "coming soon".
 return {safePurchaseEnabled:env.SAFEPURCHASE_ENABLED==='true'&&!!address,thresholdCents:integer(env.SAFEPURCHASE_THRESHOLD_CENTS,100000,100,100000000),feeCents:integer(env.SAFEPURCHASE_FEE_CENTS,2500,0,100000),inboundFallbackCents:integer(env.SAFEPURCHASE_INBOUND_SHIPPING_FALLBACK_CENTS,1500,0,100000),safePurchaseHoldHours:integer(env.SAFEPURCHASE_RELEASE_HOLD_HOURS,48,48,336),standardHoldHours:integer(env.COMMERCE_RELEASE_HOLD_HOURS,72,48,336),handlingBusinessDays:integer(env.COMMERCE_HANDLING_DAYS,3,1,10),claimDays:integer(env.COMMERCE_CLAIM_DAYS,30,1,90),inspectionAddress:address};
}
export type ProtectionChoice={itemCents:number;fulfillment:Fulfillment;sellerOptIn:boolean;buyerOptIn:boolean;waiveSafePurchase:boolean};
export type ProtectionPlan={tier:ProtectionTier;overThreshold:boolean;safePurchaseRequested:boolean;comingSoon:boolean;waived:boolean;feeCents:number;policy:CommercePolicy};
/**
 * SafePurchase is optional: offered only when the item price (not shipping) is at or above the threshold, and only
 * when the buyer chooses it (Standard is the default). The buyer pays the extra; the seller's payout is unchanged.
 * Over-threshold Standard orders still ship insured with a signature.
 */
export function protectionPlan(config:ProtectionConfig,choice:ProtectionChoice):ProtectionPlan{
 const overThreshold=choice.itemCents>=config.thresholdCents,requested=overThreshold&&choice.buyerOptIn;
 const waived=requested&&choice.waiveSafePurchase&&choice.fulfillment==='pickup';
 const base={version:commercePolicyVersion,trackingHours:48 as const,carrierHours:72 as const,highValue:false,highValueConfigured:false,requiresSignature:false,claimDays:config.claimDays};
 if(requested&&config.safePurchaseEnabled&&!waived)return {tier:'safepurchase',overThreshold,safePurchaseRequested:true,comingSoon:false,waived:false,feeCents:config.feeCents,policy:{...base,tier:'safepurchase',reviewHours:config.safePurchaseHoldHours,requiresSignature:true,insured:true}};
 const signature=overThreshold&&!waived&&choice.fulfillment==='shipping';
 return {tier:'standard',overThreshold,safePurchaseRequested:requested,comingSoon:requested&&!config.safePurchaseEnabled,waived,feeCents:0,policy:{...base,tier:'standard',reviewHours:config.standardHoldHours,handlingBusinessDays:config.handlingBusinessDays,...(signature?{highValue:true,highValueConfigured:true,requiresSignature:true,insured:true}:{})}};
}

/** The 5-digit ZIP of the inspection address (where sellers ship SafePurchase orders), or null. */
export function inspectionZip(config:ProtectionConfig){const zips=config.inspectionAddress?.match(/\b\d{5}(?=(?:-\d{4})?\b)/g);return zips?.length?zips[zips.length-1]:null}
export type SafePurchaseExtra={checkFeeCents:number;inboundCents:number;estimated:boolean;totalCents:number};
/** The SafePurchase extra the buyer pays: shipping from the seller to our check (the carrier rate, or the flat
 *  fallback marked "estimated") + the check fee. It goes to ComicHuddle; it's not part of the platform fee. */
export function safePurchaseExtra(config:ProtectionConfig,inboundRateCents:number|null):SafePurchaseExtra{
 const estimated=!(typeof inboundRateCents==='number'&&Number.isSafeInteger(inboundRateCents)&&inboundRateCents>=0),inbound=estimated?config.inboundFallbackCents:inboundRateCents!;
 return {checkFeeCents:config.feeCents,inboundCents:inbound,estimated,totalCents:config.feeCents+inbound};
}

// Pickup codes are derived from a server secret, so the plaintext is never stored: the order keeps
// only a SHA-256 hash for verification, and the buyer's view re-derives the code on read.
function secret(env:ProtectionEnv){const value=typeof env.COMMERCE_PICKUP_CODE_SECRET==='string'&&env.COMMERCE_PICKUP_CODE_SECRET.length>=16?env.COMMERCE_PICKUP_CODE_SECRET:typeof env.BETTER_AUTH_SECRET==='string'&&env.BETTER_AUTH_SECRET.length>=16?env.BETTER_AUTH_SECRET:null;if(!value)throw Error('Pickup codes need COMMERCE_PICKUP_CODE_SECRET.');return value}
async function hmac(key:string,message:string){const imported=await crypto.subtle.importKey('raw',new TextEncoder().encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);return new Uint8Array(await crypto.subtle.sign('HMAC',imported,new TextEncoder().encode(message)))}
export async function pickupCode(env:ProtectionEnv,orderId:string){const bytes=await hmac(secret(env),'comichuddle-pickup:'+orderId),value=((bytes[0]<<24)>>>0)+(bytes[1]<<16)+(bytes[2]<<8)+bytes[3];return String(value%1000000).padStart(6,'0')}
export async function pickupCodeHash(orderId:string,code:string){const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('pickup:'+orderId+':'+code)));return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')}
/** Constant-time comparison of two equal-format hex digests. */
export function sameDigest(a:string,b:string){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0}
export async function pickupCodeMatches(orderId:string,storedHash:string,candidate:string){if(!/^\d{6}$/.test(candidate))return false;return sameDigest(await pickupCodeHash(orderId,candidate),storedHash)}
