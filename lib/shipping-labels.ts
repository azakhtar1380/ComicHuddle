// Shipping labels bought inside an order through EasyPost (the same account used for rates and tracking).
// The label's cost comes out of the seller's payout; the buyer already paid the quoted shipping rate.
import {z} from 'zod';
import {carrierConfigured,type CarrierEnv,type CarrierFetch} from './commerce-carrier';
import type {Parcel} from './shipping-rates';

const states=new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR'.split(' '));
export const labelAddressSchema=z.object({name:z.string().trim().min(2).max(100),line1:z.string().trim().min(3).max(160),line2:z.string().trim().max(160).default(''),
 city:z.string().trim().min(2).max(100),state:z.string().trim().toUpperCase().refine(v=>states.has(v),'Choose a US state.'),postalCode:z.string().trim().regex(/^\d{5}(?:-\d{4})?$/,'Enter a US ZIP code.'),
 phone:z.string().trim().regex(/^[0-9()+.\-\s]{7,20}$/,'Enter a phone number for the carrier.').optional()}).strict();
export type LabelAddress=z.infer<typeof labelAddressSchema>;
export type PurchasedLabel={shipmentId:string;trackerId:string|null;carrier:'USPS'|'UPS'|'FedEx';service:string;trackingCode:string;labelUrl:string;costCents:number;createdAt:string};
export class LabelError extends Error{status=422}

const carrierNames:Record<string,'USPS'|'UPS'|'FedEx'>={USPS:'USPS',UPS:'UPS',UPSDAP:'UPS',FedEx:'FedEx',FedExDefault:'FedEx',FedExSmartPost:'FedEx'};
const hidden=new Set(['MediaMail','LibraryMail']);
const toEasyPost=(a:{name:string;line1:string;line2?:string;city:string;state:string;postalCode:string;phone?:string})=>({name:a.name,street1:a.line1,street2:a.line2||undefined,city:a.city,state:a.state,zip:a.postalCode,country:'US',phone:a.phone||undefined});

/** Buys a label from `from` to `to`. Prefers the service the buyer chose at checkout ("USPS:GroundAdvantage"),
 * otherwise the cheapest suitable rate. Throws LabelError with a readable message on any carrier problem. */
export async function buyShippingLabel(env:CarrierEnv,input:{from:LabelAddress;to:{name:string;line1:string;line2?:string;city:string;state:string;postalCode:string};parcel:Parcel;preferred?:string|null;reference:string},fetcher:CarrierFetch=fetch):Promise<PurchasedLabel>{
 if(!carrierConfigured(env))throw new LabelError('Shipping labels aren’t available right now.');
 const auth='Basic '+btoa(String(env.EASYPOST_API_KEY).trim()+':'),headers={Authorization:auth,'Content-Type':'application/json'};
 const call=async(url:string,body:unknown)=>{let response:Response;try{response=await fetcher(url,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(20000)})}catch{throw new LabelError('The carrier didn’t respond. Please try again.')}
  const json=await response.json().catch(()=>null) as Record<string,unknown>|null;
  if(!response.ok||!json){const message=(json?.error as {message?:string}|undefined)?.message;throw new LabelError(message?'The carrier said: '+message:'The label couldn’t be created. Check the addresses and try again.')}
  return json};
 const shipment=await call('https://api.easypost.com/v2/shipments',{shipment:{reference:input.reference,from_address:toEasyPost(input.from),to_address:toEasyPost(input.to),
  parcel:{length:input.parcel.length,width:input.parcel.width,height:input.parcel.height,weight:input.parcel.weightOz}}});
 const rates=((shipment.rates as {id?:string;carrier?:string;service?:string;rate?:string}[])||[]).filter(rate=>rate.id&&carrierNames[String(rate.carrier)]&&!hidden.has(String(rate.service))&&Number(rate.rate)>0)
  .sort((a,b)=>Number(a.rate)-Number(b.rate));
 const chosen=rates.find(rate=>carrierNames[String(rate.carrier)]+':'+rate.service===input.preferred)||rates[0];
 if(!chosen||typeof shipment.id!=='string')throw new LabelError('No carrier offered a label for these addresses.');
 const bought=await call('https://api.easypost.com/v2/shipments/'+encodeURIComponent(shipment.id)+'/buy',{rate:{id:chosen.id}});
 const label=bought.postage_label as {label_url?:string}|undefined,selected=bought.selected_rate as {rate?:string;carrier?:string;service?:string}|undefined,tracker=bought.tracker as {id?:string}|undefined;
 const costCents=Math.round(Number(selected?.rate??chosen.rate)*100),trackingCode=String(bought.tracking_code||'');
 if(!label?.label_url||!/^https:\/\//.test(label.label_url)||!trackingCode||!Number.isSafeInteger(costCents)||costCents<=0)throw new LabelError('The label was not confirmed by the carrier. Nothing was saved; please try again.');
 return {shipmentId:shipment.id,trackerId:typeof tracker?.id==='string'?tracker.id:null,carrier:carrierNames[String(selected?.carrier||chosen.carrier)],service:String(selected?.service||chosen.service),
  trackingCode,labelUrl:label.label_url,costCents,createdAt:new Date().toISOString()};
}
