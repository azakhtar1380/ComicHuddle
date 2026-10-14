import {DomainError,serializable,sha256,type SqlPool} from './db';
export async function boundedJson(request:Request,maxBytes=16384){
 if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))throw new DomainError('unsupported_media','JSON is required.',415);
 const reader=request.body?.getReader();if(!reader)throw new DomainError('body_missing','JSON body is required.',400);
 let length=0;const parts:Uint8Array[]=[];
 while(true){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.byteLength;if(length>maxBytes){await reader.cancel();throw new DomainError('body_too_large','Request body exceeds the limit.',413)}parts.push(chunk.value)}
 const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown}catch{throw new DomainError('invalid_json','Valid UTF-8 JSON is required.',400)}
}
export function requireOrigin(request:Request,publicOrigin:string){
 if(request.headers.get('Origin')!==new URL(publicOrigin).origin)throw new DomainError('invalid_origin','This action must originate from the application.',403);
}
export async function verifyStripeSignature(raw:Uint8Array,header:string,secret:string,nowSeconds=Math.floor(Date.now()/1000),toleranceSeconds=300){
 const parts=header.split(',').map(p=>p.split('=')),timestamp=parts.find(p=>p[0]==='t')?.[1],signatures=parts.filter(p=>p[0]==='v1').map(p=>p[1]);
 if(!timestamp||!/^\d+$/.test(timestamp)||Math.abs(nowSeconds-Number(timestamp))>toleranceSeconds||signatures.length===0)throw new DomainError('invalid_webhook_signature','Webhook signature is invalid.',400);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const prefix=new TextEncoder().encode(timestamp+'.'),input=new Uint8Array(prefix.length+raw.length);input.set(prefix);input.set(raw,prefix.length);
 const mac=new Uint8Array(await crypto.subtle.sign('HMAC',key,input));
 const valid=signatures.some(s=>{if(!/^[a-f0-9]{64}$/.test(s))return false;const received=new Uint8Array(s.match(/../g)!.map(h=>parseInt(h,16)));let diff=0;for(let i=0;i<mac.length;i++)diff|=mac[i]^received[i];return diff===0});
 if(!valid)throw new DomainError('invalid_webhook_signature','Webhook signature is invalid.',400);
}
export async function persistVerifiedWebhook(pool:SqlPool,raw:Uint8Array,header:string,secret:string){
 if(raw.byteLength>262144)throw new DomainError('webhook_too_large','Webhook payload exceeds the limit.',413);
 await verifyStripeSignature(raw,header,secret);
 const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)) as {id?:string;type?:string;data?:{object?:{id?:string}}};
 if(!body.id||!body.type||!body.data?.object?.id)throw new DomainError('webhook_shape_invalid','Webhook event is invalid.',400);
 const hash=await sha256(new TextDecoder().decode(raw));
 return serializable(pool,async db=>{
  const prior=(await db.query<{payload_hash:string}>('SELECT payload_hash FROM ch_platform.provider_events WHERE provider=\'stripe\' AND event_id=$1',[body.id])).rows[0];
  if(prior){if(prior.payload_hash!==hash)throw new DomainError('webhook_id_conflict','Webhook ID has different payload.');return {accepted:true,duplicate:true};}
  await db.query('INSERT INTO ch_platform.provider_events(provider,event_id,payload_hash,object_id,event_type) VALUES(\'stripe\',$1,$2,$3,$4)',[body.id,hash,body.data!.object!.id,body.type]);
  // A worker retrieves the current provider object, checks amount/account/currency, then transitions.
  // Only IDs are persisted: no payment PII or plaintext credentials in the queue.
  await db.query('INSERT INTO ch_platform.outbox_jobs(kind,aggregate_id,operation_key,payload) VALUES(\'reconcile_stripe_event\',gen_random_uuid(),$1,$2::jsonb)',['stripe:event:'+body.id,JSON.stringify({provider:'stripe',eventId:body.id,objectId:body.data!.object!.id,type:body.type})]);
  return {accepted:true,duplicate:false};
 });
}
