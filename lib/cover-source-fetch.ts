import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {request} from 'node:https';
import {operator} from './operator';
export class CoverSourceError extends Error{constructor(public code:string,public status:number|null=null,public retryAfter:string|null=null){super(code)}}
export function publicSourceAddress(address:string){
 if(isIP(address)===4){const parts=address.split('.').map(Number),[a,b,c]=parts;return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113)}
 if(isIP(address)===6)return /^[23][0-9a-f]{0,3}:/i.test(address)&&!/^2001:|^2002:/i.test(address);
 return false;
}
export async function approvedSourceFetch(rawUrl:string,hosts:string[],options:{headers?:Record<string,string>;maxBytes?:number;timeoutMs?:number;method?:'GET'|'HEAD'}={}){
 let url=new URL(rawUrl),credentialHost=url.hostname;const deadline=Date.now()+(options.timeoutMs||12000);
 for(let redirect=0;redirect<4;redirect++){
  if(url.protocol!=='https:'||url.username||url.password||url.port||!hosts.includes(url.hostname)||isIP(url.hostname)||url.hash)throw new CoverSourceError('unsafe_source_url');
  if(Date.now()>=deadline)throw new CoverSourceError('source_timeout');
  let lookupTimer:ReturnType<typeof setTimeout>|undefined;const addresses=await Promise.race([lookup(url.hostname,{all:true}),new Promise<never>((_resolve,reject)=>{lookupTimer=setTimeout(()=>reject(new CoverSourceError('source_timeout')),Math.max(1,deadline-Date.now()))})]).finally(()=>{if(lookupTimer)clearTimeout(lookupTimer)});if(!addresses.length||addresses.some(item=>!publicSourceAddress(item.address)))throw new CoverSourceError('unsafe_source_address');
  const pinned=addresses[0],headers:Record<string,string>={...options.headers,'User-Agent':'ComicHuddle/1.0 (catalog reference resolver; '+operator.supportEmail+')'};
  if(url.hostname!==credentialHost){delete headers.Authorization;delete headers.authorization}
  const result=await new Promise<{status:number;headers:Record<string,string>;bytes:Buffer}>( (resolve,reject)=>{
   const req=request(url,{headers,method:options.method||'GET',lookup:(_hostname,_options,callback)=>callback(null,pinned.address,pinned.family)},response=>{
    const chunks:Buffer[]=[];let total=0;const resultHeaders:Record<string,string>={};for(const [key,value] of Object.entries(response.headers))if(typeof value==='string')resultHeaders[key]=value;
    response.on('data',(chunk:Buffer)=>{total+=chunk.length;if(total>(options.maxBytes||6000000)){req.destroy();reject(new CoverSourceError('source_too_large'))}else chunks.push(chunk)});
    response.on('end',()=>resolve({status:response.statusCode||0,headers:resultHeaders,bytes:Buffer.concat(chunks)}));response.on('error',reject);
   });req.setTimeout(Math.max(1,deadline-Date.now()),()=>req.destroy(new CoverSourceError('source_timeout')));req.on('error',reject);req.end();
  });
  if([301,302,303,307,308].includes(result.status)&&result.headers.location){url=new URL(result.headers.location,url);continue}
  if(result.status===401||result.status===403||result.status===1010)throw new CoverSourceError('source_access_denied',result.status);
  if(result.status===429)throw new CoverSourceError('source_rate_limited',429,result.headers['retry-after']||null);
  if(result.status<200||result.status>=300)throw new CoverSourceError('source_http_failure',result.status,result.headers['retry-after']||null);
  if(/text\/html/i.test(result.headers['content-type']||'')||/^\s*<(?:!doctype|html)/i.test(result.bytes.subarray(0,100).toString()))throw new CoverSourceError('source_html_challenge',result.status);
  return {...result,url:url.href};
 }
 throw new CoverSourceError('source_redirect_limit');
}
