// Calculated shipping (like eBay's): the seller never types a shipping price. The server asks EasyPost for
// live carrier rates from the seller's ZIP to the buyer's ZIP for a package sized to the listing, and the
// buyer picks a service. Checkout always re-quotes on the server, so a price sent by the browser is never trusted.
import {carrierConfigured,type CarrierEnv,type CarrierFetch} from './commerce-carrier';

export type Parcel={length:number;width:number;height:number;weightOz:number;label:string};
export type ShippingOption={id:string;carrier:string;service:string;cents:number;days:number|null};

/** Package sized to what is being sold: a bagged-and-boarded comic in a mailer, a graded slab in a box, or a
 * box for a collection (about 6 oz per comic plus packing, capped at 70 lb). */
export function parcelFor(listing:{kind:string;itemCount:number;cert?:string|null;items?:unknown}):Parcel{
 const items=Array.isArray(listing.items)?listing.items as {condition?:{mode?:string}|null}[]:[];
 const graded=!!(listing.cert&&String(listing.cert).trim())||items.some(item=>item?.condition?.mode==='graded'||item?.condition?.mode==='CGC');
 const count=Math.max(1,Math.min(Number(listing.itemCount)||1,500));
 if(listing.kind!=='collection'||count===1)return graded?{length:13,width:10,height:3,weightOz:24,label:'Graded slab in a box'}:{length:12,width:9,height:2,weightOz:12,label:'Comic in a rigid mailer'};
 const height=Math.min(4+Math.ceil(count/25)*2,24);
 return {length:15,width:11,height,weightOz:Math.min(16+count*(graded?18:6),1120),label:count+' comics in a box'};
}

const carrierNames:Record<string,string>={USPS:'USPS',UPS:'UPS',UPSDAP:'UPS',FedEx:'FedEx',FedExDefault:'FedEx',FedExSmartPost:'FedEx'};
const serviceNames:Record<string,string>={GroundAdvantage:'Ground Advantage',Priority:'Priority Mail',Express:'Priority Mail Express',MediaMail:'Media Mail',
 Ground:'Ground','2ndDayAir':'2nd Day Air',NextDayAir:'Next Day Air',UPSGroundsaver:'Ground Saver',FEDEX_GROUND:'Ground',GROUND_HOME_DELIVERY:'Home Delivery',SMART_POST:'Ground Economy',FEDEX_2_DAY:'2Day',FEDEX_EXPRESS_SAVER:'Express Saver',STANDARD_OVERNIGHT:'Standard Overnight'};
// Comics are not "media" for USPS Media Mail purposes, and overnight-premium tiers are noise for collectors.
const hidden=new Set(['MediaMail','LibraryMail','FIRST_OVERNIGHT','PRIORITY_OVERNIGHT','FEDEX_2_DAY_AM','NextDayAirEarlyAM','NextDayAirSaver']);

const cache=new Map<string,{at:number;value:ShippingOption[]}>();
const zip5=(value:string)=>/^\d{5}/.exec(String(value||'').trim())?.[0]||null;

/** Live rates, cheapest first (at most 5). Throws when rates can't be calculated, so checkout never guesses. */
export async function quoteShippingRates(env:CarrierEnv,fromZip:string,toZip:string,parcel:Parcel,fetcher:CarrierFetch=fetch):Promise<ShippingOption[]>{
 const from=zip5(fromZip),to=zip5(toZip);
 if(!from||!to)throw new ShippingQuoteError('Enter a 5-digit US ZIP code.');
 if(!carrierConfigured(env))throw new ShippingQuoteError('Shipping rates aren’t available right now. Please try again later.');
 const key=[from,to,parcel.length,parcel.width,parcel.height,parcel.weightOz].join(':'),hit=cache.get(key);
 if(hit&&Date.now()-hit.at<15*60000)return hit.value;
 const auth='Basic '+btoa(String(env.EASYPOST_API_KEY).trim()+':');
 let body:{rates?:{carrier?:string;service?:string;rate?:string;delivery_days?:number|null}[]}|null=null;
 try{
  const response=await fetcher('https://api.easypost.com/v2/shipments',{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json'},
   body:JSON.stringify({shipment:{from_address:{zip:from,country:'US'},to_address:{zip:to,country:'US'},parcel:{length:parcel.length,width:parcel.width,height:parcel.height,weight:parcel.weightOz}}}),signal:AbortSignal.timeout(12000)});
  body=response.ok?await response.json():null;
 }catch{body=null}
 const seen=new Set<string>(),options:ShippingOption[]=[];
 for(const rate of (body?.rates||[]).slice().sort((a,b)=>Number(a.rate)-Number(b.rate))){
  const carrier=carrierNames[String(rate.carrier)]||null,service=String(rate.service||''),cents=Math.round(Number(rate.rate)*100);
  if(!carrier||!service||hidden.has(service)||!Number.isSafeInteger(cents)||cents<=0||cents>100000)continue;
  const id=carrier+':'+service;if(seen.has(id))continue;seen.add(id);
  options.push({id,carrier,service:serviceNames[service]||service.replace(/_/g,' '),cents,days:Number.isInteger(rate.delivery_days)?rate.delivery_days!:null});
  if(options.length>=5)break;
 }
 if(!options.length)throw new ShippingQuoteError('We couldn’t get shipping rates for that ZIP code. Check it and try again.');
 cache.set(key,{at:Date.now(),value:options});if(cache.size>500)cache.delete(cache.keys().next().value!);
 return options;
}
export class ShippingQuoteError extends Error{status=422}

/** The option the buyer picked, or the cheapest when none (or an unknown one) was sent. */
export function chooseShippingOption(options:ShippingOption[],wanted:string|undefined|null){return options.find(option=>option.id===wanted)||options[0]}
