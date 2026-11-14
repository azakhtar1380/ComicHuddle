/**
 * ComicHuddle marketplace fee (pure; safe for server and browser).
 *
 * Money model (Stripe separate charges and transfers):
 *   buyer pays     = item + shipping + SafePurchase fee - store credit
 *   platform fee   = round(item x bps / 10000), clamped to [min, max] and never above the item price
 *   seller earns   = item + shipping - platform fee          (snapshotted at checkout)
 *   platform keeps = buyer charge - transfers to the seller   (fee + SafePurchase fee - credit subsidy)
 * Stripe processing fees are paid by the platform (fees_collector=application) out of what it keeps.
 * Shipping and tax are never subject to the fee.
 */
export type PlatformFeeConfig={bps:number;minCents:number;maxCents:number|null;valid:boolean};
export type PlatformFeeEnv={COMMERCE_PLATFORM_FEE_BPS?:unknown;COMMERCE_PLATFORM_FEE_MIN_CENTS?:unknown;COMMERCE_PLATFORM_FEE_MAX_CENTS?:unknown};
export const DEFAULT_PLATFORM_FEE_BPS=800,DEFAULT_PLATFORM_FEE_MIN_CENTS=50,MAX_PLATFORM_FEE_BPS=3000;
const integer=(value:unknown,fallback:number|null)=>value===undefined||value===''?fallback:typeof value==='string'&&/^\d{1,9}$/.test(value.trim())?Number(value.trim()):typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:NaN;

/** Invalid owner configuration is reported (valid=false) so checkout can refuse instead of guessing a rate. */
export function platformFeeConfig(env:PlatformFeeEnv):PlatformFeeConfig{
 const bps=integer(env.COMMERCE_PLATFORM_FEE_BPS,DEFAULT_PLATFORM_FEE_BPS) as number,minCents=integer(env.COMMERCE_PLATFORM_FEE_MIN_CENTS,DEFAULT_PLATFORM_FEE_MIN_CENTS) as number,maxCents=integer(env.COMMERCE_PLATFORM_FEE_MAX_CENTS,null);
 const valid=Number.isSafeInteger(bps)&&bps>=0&&bps<=MAX_PLATFORM_FEE_BPS&&Number.isSafeInteger(minCents)&&minCents<=100_000&&(maxCents===null||Number.isSafeInteger(maxCents)&&maxCents>=minCents);
 return valid?{bps,minCents,maxCents,valid}:{bps:DEFAULT_PLATFORM_FEE_BPS,minCents:DEFAULT_PLATFORM_FEE_MIN_CENTS,maxCents:null,valid:false};
}

/** Half-up rounding on integer cents; minimum applies only when a fee is charged at all (bps > 0). */
export function platformFeeCents(itemCents:number,config:Pick<PlatformFeeConfig,'bps'|'minCents'|'maxCents'>){
 if(!Number.isSafeInteger(itemCents)||itemCents<0)throw new Error('Item amount must be integer cents.');
 if(config.bps===0||itemCents===0)return 0;
 let fee=Math.floor((itemCents*config.bps+5000)/10000);
 fee=Math.max(fee,config.minCents);if(config.maxCents!==null)fee=Math.min(fee,config.maxCents);
 return Math.min(fee,itemCents);
}

export type SaleBreakdown={itemCents:number;shippingCents:number;feeBps:number;feeCents:number;sellerNetCents:number};
export function saleBreakdown(itemCents:number,shippingCents:number,config:Pick<PlatformFeeConfig,'bps'|'minCents'|'maxCents'>):SaleBreakdown{
 const feeCents=platformFeeCents(itemCents,config);
 return {itemCents,shippingCents,feeBps:config.bps,feeCents,sellerNetCents:itemCents+shippingCents-feeCents};
}

/**
 * Seller payout legs. A transfer tied to the charge (source_transaction) can never exceed the charge,
 * so when store credit made the buyer's charge smaller than the seller's net, the platform funds the
 * difference from its own Stripe balance with a second, unlinked transfer.
 */
export function payoutLegs(sellerNetCents:number,chargeCents:number){
 if(!Number.isSafeInteger(sellerNetCents)||!Number.isSafeInteger(chargeCents)||sellerNetCents<0||chargeCents<0)throw new Error('Payout amounts must be integer cents.');
 const fromCharge=Math.min(sellerNetCents,chargeCents);
 return {fromChargeCents:fromCharge,platformTopUpCents:sellerNetCents-fromCharge};
}

/** Pro-rated platform fee returned for a partial refund (floor; the remainder rounds in the platform's favour by at most 1 cent). */
export function proratedFeeRefundCents(feeCents:number,refundCents:number,chargeCents:number){
 if(![feeCents,refundCents,chargeCents].every(value=>Number.isSafeInteger(value)&&value>=0)||refundCents>chargeCents)throw new Error('Refund amounts must be integer cents within the charge.');
 if(chargeCents===0)return 0;
 return refundCents===chargeCents?feeCents:Math.floor(feeCents*refundCents/chargeCents);
}

/** Owner estimate only (US card list price 2.9% + 30c); real fees are on the Stripe balance transaction. */
export function estimatedStripeFeeCents(chargeCents:number){return chargeCents>0?Math.round(chargeCents*0.029)+30:0}
export const formatBps=(bps:number)=>(bps/100).toFixed(bps%100===0?0:2)+'%';
