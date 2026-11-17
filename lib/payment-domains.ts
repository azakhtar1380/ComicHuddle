// Admin check: which domains are registered with Stripe for Apple Pay / Google Pay (read-only).
import {headers} from 'next/headers';
import {stripeSandbox,type StripeSandboxEnv} from './stripe-sandbox';

export type DomainCheck={host:string;domains:{domain:string;enabled:boolean;applePay:string;googlePay:string}[];currentRegistered:boolean;error:string|null};
export async function paymentDomainCheck(env:StripeSandboxEnv):Promise<DomainCheck>{
 const host=((await headers()).get('host')||'').replace(/:\d+$/,'').toLowerCase();
 try{
  const domains=await stripeSandbox(env).listPaymentMethodDomains();
  return {host,domains,currentRegistered:domains.some(d=>d.domain.toLowerCase()===host&&d.enabled),error:null};
 }catch{return {host,domains:[],currentRegistered:false,error:'Couldn’t read domains from Stripe (payments not configured here, or Stripe is unavailable).'}}
}
