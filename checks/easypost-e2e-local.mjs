// Real EasyPost TEST-mode check against the LOCAL dev server (http://localhost:3000 only).
// Prerequisite: three PAID shipping orders sold by the seller account (Stripe test mode).
// Usage: node checks/easypost-e2e-local.mjs <sellerEmail> <buyerEmail> <orderId1> <orderId2> <orderId3>
// The QA password is read from .env.local (LOCAL_QA_PASSWORD) and never printed.
import {readFileSync} from 'node:fs';
const BASE='http://localhost:3000';
const [sellerEmail,buyerEmail,...orderIds]=process.argv.slice(2);
if(!sellerEmail||!buyerEmail||orderIds.length!==3)throw Error('Usage: node checks/easypost-e2e-local.mjs <sellerEmail> <buyerEmail> <order1> <order2> <order3>');
const password=readFileSync('.env.local','utf8').split(/\r?\n/).find(line=>line.startsWith('LOCAL_QA_PASSWORD='))?.slice('LOCAL_QA_PASSWORD='.length).replace(/^["']|["']$/g,'');
if(!password)throw Error('LOCAL_QA_PASSWORD is not set in .env.local');
function client(){const jar=new Map();return async(path,{method='GET',json}={})=>{const headers={origin:BASE};if(jar.size)headers.cookie=[...jar].map(([k,v])=>k+'='+v).join('; ');if(json!==undefined)headers['content-type']='application/json';const r=await fetch(BASE+path,{method,headers,body:json===undefined?undefined:JSON.stringify(json),redirect:'manual'});for(const c of r.headers.getSetCookie?.()||[]){const [pair]=c.split(';');const i=pair.indexOf('=');if(pair.slice(i+1))jar.set(pair.slice(0,i),pair.slice(i+1));else jar.delete(pair.slice(0,i))}const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text.slice(0,200)}return {status:r.status,data}}}
const results=[];const record=(name,ok,detail='')=>{results.push(ok);console.log((ok?'PASS ':'FAIL ')+name+(detail?' :: '+detail:''))};
const seller=client(),buyer=client();
for(const [req,email] of [[seller,sellerEmail],[buyer,buyerEmail]]){const r=await req('/api/auth/sign-in/email',{method:'POST',json:{email,password}});record('sign in '+email.replace(/@.*/,'@…'),r.status===200,String(r.status))}
const codes=['EZ2000000002','EZ4000000004','EZ6000000006'],expected=['in_transit','delivered','failure'];
for(const [index,orderId] of orderIds.entries()){
 const r=await seller('/api/commerce',{method:'POST',json:{action:'submit_tracking',orderId,carrier:'USPS',trackingNumber:codes[index]}});
 record(`seller: tracking ${codes[index]} on ${orderId.slice(0,8)}`,r.status===200,r.data.error||r.data.note);
}
const view=async req=>(await req('/api/commerce')).data.orders||[];
const sellerOrders=await view(seller),buyerOrders=await view(buyer);
for(const [index,orderId] of orderIds.entries()){
 const s=sellerOrders.find(o=>o.id===orderId),b=buyerOrders.find(o=>o.id===orderId);
 console.log(JSON.stringify({order:orderId,code:codes[index],status:s?.status,carrier:s?.carrier,fundsAvailableAt:s?.fundsAvailableAt,reviewUntil:b?.reviewUntil,protectionReason:s?.protectionReason}));
 record(`EasyPost ${codes[index]} → ${expected[index]}`,s?.carrier?.status===expected[index],s?.carrier?.label);
 if(expected[index]==='delivered'){record('delivered: order in review window',s?.status==='delivered_review',s?.status);record('delivered: seller sees Funds available on <date> (72h after delivery)',!!s?.fundsAvailableAt,s?.fundsAvailableAt);record('delivered: buyer review window shown',!!b?.reviewUntil,b?.reviewUntil)}
 if(expected[index]==='in_transit')record('in transit: nothing released',s?.fundsAvailableAt===null&&['in_transit','awaiting_shipment'].includes(s?.status),s?.status);
 if(expected[index]==='failure')record('failure: flagged for support, release frozen',s?.status==='manual_review'&&s?.carrier?.problem===true,s?.protectionReason);
}
console.log(`\nSUMMARY ${results.filter(Boolean).length}/${results.length} passed`);
