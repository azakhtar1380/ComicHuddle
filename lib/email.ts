// Sends transactional email through Resend's HTTP API (https://resend.com). Off until RESEND_API_KEY and
// EMAIL_FROM (for example "ComicHuddle <orders@your-domain>") are set; then it sends. It never throws: a failed
// email must not undo or block the payment or order that caused it.
// EMAIL_TEST_OUTBOX=1 keeps messages in memory instead (end-to-end tests), never sending anything.
import type {EmailMessage} from './email-templates';
import {getPool} from '../db/postgres';

type Outbox={to:string;message:EmailMessage;at:string}[];
export function testOutbox():Outbox{const g=globalThis as typeof globalThis&{chEmailOutbox?:Outbox};return g.chEmailOutbox??=[]}
export function emailConfigured(env:Record<string,unknown>=process.env){return process.env.EMAIL_TEST_OUTBOX==='1'||!!String(env.RESEND_API_KEY||'').trim()&&!!String(env.EMAIL_FROM||'').trim()}
const validEmail=(value:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)&&value.length<=254;

export async function sendEmail(to:string|null|undefined,message:EmailMessage):Promise<{sent:boolean;reason?:string}>{
 try{
  if(!to||!validEmail(to))return {sent:false,reason:'no_address'};
  if(process.env.EMAIL_TEST_OUTBOX==='1'){testOutbox().push({to,message,at:new Date().toISOString()});return {sent:true}}
  const key=String(process.env.RESEND_API_KEY||'').trim(),from=String(process.env.EMAIL_FROM||'').trim();
  if(!key||!from)return {sent:false,reason:'not_configured'};
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},signal:AbortSignal.timeout(10_000),
   body:JSON.stringify({from,to:[to],subject:message.subject,html:message.html,text:message.text,...(process.env.EMAIL_REPLY_TO?{reply_to:process.env.EMAIL_REPLY_TO}:{})})});
  await response.body?.cancel().catch(()=>undefined); // never log the provider's body: it can echo addresses
  return response.ok?{sent:true}:{sent:false,reason:'provider_'+response.status};
 }catch{return {sent:false,reason:'unavailable'}}
}

/** Account email for a user id (Better Auth's user table). */
export async function accountEmail(userId:string){
 try{return (await getPool().query<{email:string}>('SELECT email FROM ch_web."user" WHERE id=$1',[userId])).rows[0]?.email||null}catch{return null}
}
