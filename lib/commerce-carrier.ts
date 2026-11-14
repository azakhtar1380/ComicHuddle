// Carrier-tracking seam. EasyPost is used only when EASYPOST_API_KEY is configured; without it,
// seller tracking stays "awaiting carrier confirmation" and nothing is released automatically.
export type CarrierEnv={EASYPOST_API_KEY?:unknown;EASYPOST_WEBHOOK_SECRET?:unknown};
export type CarrierFetch=(input:string,init:RequestInit)=>Promise<Response>;
export const EASYPOST_WEBHOOK_MAX_BYTES=262144;
const carriers:Record<string,string>={USPS:'USPS',UPS:'UPS',FedEx:'FedEx',DHL:'DHLExpress'};
export function carrierConfigured(env:CarrierEnv){return typeof env.EASYPOST_API_KEY==='string'&&env.EASYPOST_API_KEY.trim().length>=10}
export function carrierWebhookConfigured(env:CarrierEnv){return typeof env.EASYPOST_WEBHOOK_SECRET==='string'&&env.EASYPOST_WEBHOOK_SECRET.length>=8}

export type CarrierTracker={id:string;trackingCode:string;carrier:string;status:string};
/** Creates (or, with EasyPost's own dedupe, re-finds) a tracker for a seller-entered number. */
export async function createCarrierTracker(env:CarrierEnv,carrier:string,trackingCode:string,fetcher:CarrierFetch=fetch):Promise<CarrierTracker|null>{
 if(!carrierConfigured(env))return null;
 const key=String(env.EASYPOST_API_KEY).trim(),auth='Basic '+btoa(key+':');
 const response=await fetcher('https://api.easypost.com/v2/trackers',{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify({tracker:{tracking_code:trackingCode,carrier:carriers[carrier]||carrier}}),signal:AbortSignal.timeout(10000)});
 const body=await response.json().catch(()=>null) as Record<string,unknown>|null;
 if(!response.ok||!body||typeof body.id!=='string'||!body.id.startsWith('trk_'))throw Error('Carrier tracking could not be registered.');
 return {id:body.id,trackingCode:String(body.tracking_code||trackingCode),carrier,status:String(body.status||'unknown')};
}

function hex(bytes:Uint8Array){return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')}
function constantEqual(a:string,b:string){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0}
export async function easyPostSignature(secret:string,body:Uint8Array){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret.normalize('NFKD')),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return 'hmac-sha256-hex='+hex(new Uint8Array(await crypto.subtle.sign('HMAC',key,new Uint8Array(body))));
}
/** Verifies EasyPost's X-Hmac-Signature header ("hmac-sha256-hex=<digest>") over the raw body. */
export async function verifyEasyPostWebhook(env:CarrierEnv,body:Uint8Array,header:string|null){
 if(!carrierWebhookConfigured(env)||!header)return false;
 return constantEqual((await easyPostSignature(String(env.EASYPOST_WEBHOOK_SECRET),body)).toLowerCase(),header.trim().toLowerCase());
}
export type CarrierScan={message:string;location:string;at:string|null};
export type CarrierUpdate={trackerId:string|null;trackingCode:string;status:'accepted'|'delivered'|'exception'|'pending';occurredAt:string|null;signedBy:string|null;rawStatus?:string;estDeliveryAt?:string|null;lastScan?:CarrierScan|null};
/** The latest carrier progress kept on an order for display. It is never used as delivery proof by itself. */
export type CarrierSummary={trackerId:string|null;status:string;estDeliveryAt:string|null;lastScan:CarrierScan|null;updatedAt:string};
const accepted=new Set(['in_transit','out_for_delivery','available_for_pickup']),failed=new Set(['return_to_sender','failure','error','cancelled']);
const statusLabels:Record<string,string>={pre_transit:'Label created',in_transit:'In transit',out_for_delivery:'Out for delivery',available_for_pickup:'Ready for pickup at the carrier',delivered:'Delivered',return_to_sender:'Returning to sender',failure:'Delivery problem',error:'Carrier error',cancelled:'Shipment cancelled',unknown:'Status unavailable'};
export function carrierStatusLabel(status:string){return statusLabels[status]||statusLabels.unknown}
export function carrierProblem(status:string){return failed.has(status)}
const isoOrNull=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(Date.parse(value)).toISOString():null;
const text=(value:unknown,max:number)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max):'';
/** Maps a verified EasyPost tracker (webhook event or API response) to the trusted carrier evidence our policy accepts. */
export function carrierUpdate(payload:unknown):CarrierUpdate|null{
 if(!payload||typeof payload!=='object')return null;
 const event=payload as Record<string,unknown>,result=event.result as Record<string,unknown>|undefined;
 if(typeof event.description!=='string'||!/^tracker\.(created|updated)$/.test(event.description)||!result||result.object!=='Tracker'||typeof result.tracking_code!=='string'||!/^[A-Za-z0-9 -]{6,60}$/.test(result.tracking_code))return null;
 const status=String(result.status||'unknown'),details=(Array.isArray(result.tracking_details)?result.tracking_details as Record<string,unknown>[]:[]).filter(detail=>detail&&typeof detail==='object');
 const match=[...details].reverse().find(detail=>detail.status===status),when=isoOrNull(match?.datetime);
 const last=details.at(-1),place=last?.tracking_location as Record<string,unknown>|undefined,location=[text(place?.city,60),text(place?.state,20)].filter(Boolean).join(', ');
 return {trackerId:typeof result.id==='string'?result.id:null,trackingCode:result.tracking_code,status:status==='delivered'?'delivered':accepted.has(status)?'accepted':failed.has(status)?'exception':'pending',occurredAt:when,signedBy:typeof result.signed_by==='string'&&result.signed_by.trim()?result.signed_by.trim().slice(0,80):null,
  rawStatus:status in statusLabels?status:'unknown',estDeliveryAt:isoOrNull(result.est_delivery_date),lastScan:last?{message:text(last.message,160)||carrierStatusLabel(String(last.status||'unknown')),location,at:isoOrNull(last.datetime)}:null};
}
/** Polling backup for missed webhooks: reads the tracker straight from EasyPost's API (never from client input). */
export async function retrieveCarrierTracker(env:CarrierEnv,trackerId:string,fetcher:CarrierFetch=fetch):Promise<CarrierUpdate|null>{
 if(!carrierConfigured(env)||!/^trk_[A-Za-z0-9]{6,64}$/.test(trackerId))return null;
 const response=await fetcher('https://api.easypost.com/v2/trackers/'+trackerId,{method:'GET',headers:{Authorization:'Basic '+btoa(String(env.EASYPOST_API_KEY).trim()+':')},signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('Carrier tracking could not be read.');
 const body=await response.json().catch(()=>null) as Record<string,unknown>|null;
 if(!body||body.id!==trackerId)throw Error('Carrier tracking response did not match.');
 return carrierUpdate({description:'tracker.updated',result:body});
}
