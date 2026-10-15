// Executes the actual React hooks and callbacks with controlled HTTP; no real processor/browser claim.
import assert from 'node:assert/strict';
import {createScannerFixture} from './scanner-hooks.mjs';
import {createReporter,loadTypeScriptModule,plain} from '../architecture/postgres/tests/runtime.mjs';
const report=createReporter('Commerce UI and recovery');
const response=(body,status=200)=>Response.json(body,{status});
const setup=active=>({sandbox:true,setup:{enabled:active,ready:active,checkoutEnabled:active,reason:active?'ready':'sandbox_disabled'},carrierConnected:false,payoutsEnabled:false,productionPaymentsEnabled:false});
function payment(fetcher){const redirects=[],f=createScannerFixture({componentFile:'app/marketplace-checkout.tsx',props:{listingId:'listing-one',onNotice(){}},fetcher,globals:{URL,window:{location:{assign:value=>redirects.push(value)}}}});return {f,redirects};}
const address={name:'Synthetic Buyer',line1:'1 Test St',line2:'',city:'Minneapolis',state:'MN',postalCode:'55421',sandbox:'on'};
const submit=f=>f.find(node=>node.type==='form').props.onSubmit({preventDefault(){},currentTarget:address});
await report.test('Unconfigured payments preserve payment methods, delivery controls and an effective retry',async()=>{
 let active=false;const {f}=payment(()=>response(setup(active)));await f.flush();assert.match(f.snapshot(),/Credit \/ debit card/);assert.match(f.snapshot(),/Apple Pay/);assert.ok(f.find(node=>node.type==='form'));assert.equal(f.button('Continue to secure').props.disabled,true);active=true;await f.click('Retry payment check');await f.flush();assert.equal(f.button('Continue to secure').props.disabled,false);f.unmount();
});
await report.test('Transient setup failure recovers without replacing the rest of checkout',async()=>{
 let attempts=0;const {f}=payment(()=>++attempts===1?response({},503):response(setup(true)));await f.flush();assert.match(f.status(),/unavailable/);await f.click('Retry payment check');await f.flush();assert.equal(f.button('Continue to secure').props.disabled,false);f.unmount();
});
await report.test('Payment submissions use exact listing IDs, shipping and a stable retry identity; raw cards never reach our API',async()=>{
 const bodies=[],{f,redirects}=payment((url,options)=>{if(!options.method)return response(setup(true));bodies.push(JSON.parse(options.body));return bodies.length===1?response({error:'Try again'},503):response({checkoutUrl:'https://checkout.stripe.com/c/pay/test-session'})});await f.flush();submit(f);await f.flush();submit(f);await f.flush();assert.equal(bodies.length,2);assert.equal(bodies[0].requestId,bodies[1].requestId);assert.equal(bodies[0].listingId,'listing-one');assert.equal(bodies[0].shippingAddress.country,'US');assert.equal(Object.keys(bodies[0]).some(key=>/card|cvc|amount|price/.test(key)),false);assert.deepEqual(redirects,['https://checkout.stripe.com/c/pay/test-session']);f.unmount();
});
await report.test('Repeated clicks cannot create parallel checkout requests',async()=>{
 let complete;const {f}=payment((url,options)=>!options.method?response(setup(true)):new Promise(resolve=>complete=resolve));await f.flush();submit(f);submit(f);await f.flush();assert.equal(f.calls.requests.filter(row=>row.options.method==='POST').length,1);complete(response({checkoutUrl:'https://checkout.stripe.com/c/pay/one'}));await f.flush();f.unmount();
});
await report.test('Untrusted payment redirects remain on the site with an actionable error',async()=>{
 const {f,redirects}=payment((url,options)=>response(options.method?{checkoutUrl:'https://attacker.example/pay'}:setup(true)));await f.flush();submit(f);await f.flush();assert.equal(redirects.length,0);assert.match(f.status(),/could not be verified/);f.unmount();
});
await report.test('SafePurchase blocks charging while keeping inspection requests available',async()=>{
 const {f}=payment(()=>response(setup(true)));let inquiries=0;f.setProps({requiresInspection:true,onInspectionRequest:()=>inquiries++});await f.flush();assert.equal(f.button('Continue to secure').props.disabled,true);await f.click('Request SafePurchase inspection');assert.equal(inquiries,1);assert.equal(f.calls.requests.filter(row=>row.options.method==='POST').length,0);f.unmount();
});
await report.test('A late checkout response cannot redirect after the selected listing changes',async()=>{
 let complete;const {f,redirects}=payment((url,options)=>!options.method?response(setup(true)):new Promise(resolve=>complete=resolve));await f.flush();submit(f);await f.flush();f.setProps({listingId:'listing-two'});await f.flush();complete(response({checkoutUrl:'https://checkout.stripe.com/c/pay/old'}));await f.flush();assert.equal(redirects.length,0);f.unmount();
});
await report.test('Empty-radius search stays nationwide and reports the problem beside available controls',async()=>{
 const changes=[],f=createScannerFixture({componentFile:'app/location-radius-filter.tsx',props:{location:'',radius:'nationwide',onChange:(...args)=>changes.push(args)},fetcher:()=>response({choices:[{city:'Columbia Heights',state:'MN',zip:'55421'}]})});await f.flush();f.find(node=>node.type==='select').props.onChange({target:{value:'15'}});await f.flush();assert.equal(changes.length,0);assert.match(f.status(),/Select a valid US city/);assert.ok(f.find(node=>node.type==='input'));assert.ok(f.find(node=>node.type==='select'));f.find(node=>node.type==='input').props.onChange({target:{value:'55421'}});await f.flush();await f.advance(250);await f.flush();f.find(node=>node.type==='select').props.onChange({target:{value:'15'}});await f.flush();assert.deepEqual(changes,[['55421','15']]);await f.click('Clear location');assert.deepEqual(changes[1],['','nationwide']);f.unmount();
});
await report.test('Wallet mode switches request the matching server history and expose retry after an outage',async()=>{
 let broken=true;const f=createScannerFixture({componentFile:'app/collector-wallet.tsx',fetcher:()=>broken?response({error:'Temporary outage'},503):response({live:{availableCents:'0',pendingCents:'0'},sandbox:{availableCents:'2500',pendingCents:'500'},history:[],hasMore:false,offset:0,unreconciledOrders:0,remainingOrders:0,withdrawalEnabled:false,note:''})});await f.flush();assert.match(f.status(),/Temporary outage/);broken=false;await f.click('Retry wallet');await f.flush();assert.match(f.snapshot(),/\$0\.00/);await f.click('Test wallet');await f.flush();assert.match(f.calls.requests.at(-1).url,/mode=sandbox/);assert.match(f.snapshot(),/\$25\.00/);assert.match(f.snapshot(),/cannot be spent or withdrawn/);f.unmount();
});
// FMV product UI is deferred; its old quote-display test is outside launch scope.
// Unified ListingBuilder persistence and step flows are covered by checks/listing-builder-ui.mjs.
await report.test('Workshop fetch errors keep every filter and tab available, and Retry performs a fresh request',async()=>{
 let failure=true;const empty=plain(loadTypeScriptModule('lib/pressing.ts').emptyCare),vault=plain(loadTypeScriptModule('lib/vault.ts').emptyVault('Synthetic Collector'));
 const f=createScannerFixture({componentFile:'app/pressing.tsx',props:{tab:'Pressing',signedIn:true,net:{data:{me:{id:'actor'}}},vault,gate:()=>true,notice(){},go(){},openCollection(){},onRegister(){},onOpenThread:async()=>{},command:{id:0,view:'directory'}},globals:{setInterval:()=>0,clearInterval(){},window:{location:{search:''}}},fetcher:()=>failure?response({error:'Temporary studio outage'},503):response(empty)});await f.flush();assert.match(f.snapshot(),/Temporary studio outage/);assert.ok(f.find(node=>typeof node.type==='function'&&node.type.name==='LocationRadiusFilter'));assert.ok(f.find(node=>node.type==='select'&&node.props['aria-label']==='Filter by care service'));assert.equal(f.nodes().filter(node=>node.props?.role==='tab').length,4);failure=false;await f.click('Retry');await f.flush();assert.ok(!f.snapshot().includes('Temporary studio outage'));assert.equal(f.calls.requests.length,2);f.unmount();
});
report.finish({coverage:'Actual client hooks/callbacks with synthetic HTTP; no live card payment or signed-in browser claim'});
