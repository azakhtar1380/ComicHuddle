// Marketplace E2E v2 (guest browse, binding auctions, pickup/protection checkout, Stripe test mode)
// against the LOCAL dev server only. Usage: node e2e2.mjs <repoPath> <accountTag>
import {createRequire} from 'node:module';
const require=createRequire(process.argv[2]+'/package.json');const sharp=require('sharp');
const BASE='http://localhost:3000',tag=process.argv[3]||Date.now().toString(36);
const results=[],evidence={};const record=(name,ok,detail='')=>{results.push({name,ok,detail});console.log((ok?'PASS ':'FAIL ')+name+(detail?' :: '+detail:''))};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function client(){const jar=new Map();return {jar,async req(path,{method='GET',json,body,headers={},raw=false}={}){const h={...headers,origin:BASE};if(jar.size)h.cookie=[...jar].map(([k,v])=>k+'='+v).join('; ');if(json!==undefined){h['content-type']='application/json';body=JSON.stringify(json)}const r=await fetch(BASE+path,{method,headers:h,body,redirect:'manual'});for(const c of r.headers.getSetCookie?.()||[]){const [pair]=c.split(';');const i=pair.indexOf('=');const k=pair.slice(0,i),v=pair.slice(i+1);if(v)jar.set(k,v);else jar.delete(k)}if(raw)return r;const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text.slice(0,300)}return {status:r.status,data,headers:r.headers}}}}
async function account(c,who){const creds={email:`qa-${who}-${tag}@comichuddle.test`,password:'Qa-'+tag+'-Local!9'};for(let i=0;i<8;i++){let r=await c.req('/api/auth/sign-in/email',{method:'POST',json:creds});if(r.status!==200)r=await c.req('/api/auth/sign-up/email',{method:'POST',json:{...creds,name:'QA '+who}});if(r.status===429){await sleep(20000);continue}record(who+': account',r.status===200,String(r.status));break}
 const p=await c.req('/api/social',{method:'POST',json:{action:'profile',handle:('qa'+who+tag).toLowerCase().replace(/[^a-z0-9_]/g,'').slice(0,23),name:'QA '+who,bio:'Local QA account',tagline:'',location:'Minneapolis',favorite:'',since:2010,color:'red',featured:[],visible:true,dmOpen:true,accept:true}});record(who+': profile',p.status===200,p.data.error||'');return p.data.profile}
async function photo(c,hue){const img=await sharp({create:{width:600,height:900,channels:3,background:{r:hue,g:90,b:160}}}).jpeg().toBuffer();const r=await c.req('/api/media',{method:'POST',body:img,headers:{'content-type':'image/jpeg'}});return r.data.id}
async function books(c,list){const v=await c.req('/api/vault');const ver=v.headers.get('x-comichuddle-vault-version');const existing=v.data&&v.data.books?v.data:{profile:'QA',books:[],wants:[],posts:[],likes:[],tradeBookIds:[],clubs:[],watchlist:[],tradeDrafts:[]};const r=await c.req('/api/vault',{method:'POST',json:{...existing,books:[...existing.books,...list]},headers:{'X-ComicHuddle-Vault-Version':ver||'"empty"'}});return r.status}
const listingBody=(ids,photoId,extra={})=>({action:'listing',kind:ids.length>1?'collection':'single',saleType:'fixed',bookIds:ids,conditions:{},description:'QA local listing.',price:2500,shipping:500,photos:[photoId],cert:'',attest:true,usaAttest:true,fulfillment:'shipping',pickupCity:'',pickupState:'',locationZip:'55421',safePurchaseOptIn:false,...(ids.length>1?{title:'QA lot '+tag}:{}),...extra});
async function main(){
 const guest=client(),seller=client(),buyer=client(),bidder=client();
 const sp=await account(seller,'seller');await account(buyer,'buyer');await account(bidder,'bidder');
 const pid=await photo(seller,60),ids=Array.from({length:7},(_,i)=>'e2e2-'+tag+'-'+i);
 record('seller: save copies',await books(seller,ids.map((id,i)=>({id,title:'QA Protection Test',issue:'#'+(i+1),grade:'',price:0})))===200);
 let r=await seller.req('/api/social',{method:'POST',json:listingBody([ids[0]],pid)});const fixed=r.data.listingId;record('seller: fixed listing with ZIP 55421 (postal data loaded)',r.status===200,r.data.error||fixed);
 r=await seller.req('/api/social',{method:'POST',json:listingBody([ids[1]],pid,{fulfillment:'pickup',shipping:0,pickupCity:'Minneapolis',pickupState:'MN'})});const pickupListing=r.data.listingId;record('seller: pickup-only listing',r.status===200,r.data.error||'');
 r=await seller.req('/api/social',{method:'POST',json:listingBody([ids[2]],pid,{price:60000})});const highValue=r.data.listingId;record('seller: $600 listing (over SafePurchase threshold)',r.status===200,r.data.error||'');
 r=await seller.req('/api/social',{method:'POST',json:listingBody([ids[3]],pid,{saleType:'auction',price:1000,durationHours:72,reserveCents:3000})});const auction=r.data.listingId;record('seller: binding auction (3 days, hidden reserve)',r.status===200,r.data.error||'');
 r=await seller.req('/api/social',{method:'POST',json:listingBody([ids[4]],pid,{saleType:'auction',price:1000,durationHours:48})});record('seller: 2-day auction rejected (1/3/5/7/10 only)',r.status===400,r.data.error);
 // Guest browsing
 r=await guest.req('/api/marketplace?view=active&q=QA%20Protection');const g=r.data.listings||[];record('guest: browse + search',r.status===200&&g.length>=3,`${r.status} total=${r.data.total}`);
 const allow=new Set(['id','title','grade','description','price','shipping','photos','cert','status','createdAt','safePurchaseOptIn','safePurchaseVerifiedAt','locationCity','locationState','seller','fulfillment','pickupCity','pickupState','kind','saleType','items','itemCount','auction','distanceMiles']);
 record('guest: payload follows the field allowlist',g.every(l=>Object.keys(l).every(k=>allow.has(k)))&&!JSON.stringify(g).includes('"sellerId"')&&!JSON.stringify(g).includes('locationZip'),Object.keys(g[0]||{}).join(','));
 r=await guest.req('/api/marketplace?listingId='+fixed);record('guest: listing detail',r.data.listings?.[0]?.id===fixed);
 r=await guest.req('/api/media?id='+pid+'&size=thumbnail',{raw:true});record('guest: published listing photo visible',r.status===200,String(r.status));
 r=await guest.req('/api/marketplace?view=mine');record('guest: My Listings requires sign-in',r.status===401,r.data.error);
 r=await guest.req('/api/social',{method:'POST',json:{action:'bid',listingId:auction,amount:2000,requestId:crypto.randomUUID(),bindingConsent:true}});record('guest: bid requires sign-in',r.status===401,String(r.status));
 // Binding auction over HTTP
 const bid=(c,amount,extra={})=>c.req('/api/social',{method:'POST',json:{action:'bid',listingId:auction,amount,requestId:crypto.randomUUID(),bindingConsent:true,...extra}});
 r=await bid(seller,2000);record('auction: seller cannot bid on own auction',r.status===403,r.data.error);
 r=await seller.req('/api/social',{method:'POST',json:{action:'bid',listingId:auction,amount:2000,requestId:crypto.randomUUID(),nonbindingConsent:true}});record('auction: binding consent required',r.status===400,String(r.status));
 r=await bid(buyer,2500);record('auction: buyer max $25 leads at the $10 start',r.status===200&&r.data.currentBid===1000,JSON.stringify([r.status,r.data.currentBid,r.data.error]));
 r=await bid(bidder,2000);record('auction: lower max is outbid; price = $20 + $0.50 band increment',r.status===200&&r.data.outcome==='outbid'&&r.data.currentBid===2050,JSON.stringify([r.data.outcome,r.data.currentBid]));
 r=await bid(bidder,5000);record('auction: higher max takes the lead at $25 + increment, reserve met → $30',r.status===200&&r.data.outcome==='leading'&&r.data.currentBid===3000,JSON.stringify([r.data.outcome,r.data.currentBid]));
 r=await buyer.req('/api/marketplace?bids='+auction);record('auction: masked bid history, no maximums',r.status===200&&r.data.bids.length===3&&r.data.bids.every(b=>/\*/.test(b.bidder))&&!r.data.bids.some(b=>b.amountCents===5000),JSON.stringify(r.data.bids?.map(b=>b.bidder+':'+b.amountCents)));
 r=await guest.req('/api/marketplace?listingId='+auction);const ga=r.data.listings?.[0]?.auction;record('auction: public view shows reserve status only',ga?.reserve==='met'&&ga.binding===true&&!('yourMax' in ga),JSON.stringify(ga));
 // Checkout (Stripe test mode). Seller onboarding is required first.
 r=await seller.req('/api/commerce',{method:'POST',json:{action:'seller_onboard',sandboxAcknowledged:true}});evidence.onboarding={status:r.status,url:r.data.onboardingUrl?String(r.data.onboardingUrl).replace(/#.*/,'#…'):null,error:r.data.error,ready:r.data.ready};
 record('seller: Stripe Connect onboarding link created (test mode)',r.status===200&&!!r.data.onboardingUrl,JSON.stringify(evidence.onboarding));
 r=await buyer.req('/api/commerce',{method:'POST',json:{action:'checkout',listingId:pickupListing,requestId:crypto.randomUUID(),sandboxAcknowledged:true,fulfillment:'pickup',storeCreditCents:0,checkoutUiMode:'hosted_page'}});
 evidence.pickupCheckout={status:r.status,error:r.data.error,session:r.data.checkoutUrl?String(r.data.checkoutUrl).split('/').pop().slice(0,40):null};
 record('buyer: pickup checkout (no address) reaches Stripe or a clear seller-onboarding message',r.status===200&&!!r.data.checkoutUrl||r.status===409&&/seller/i.test(r.data.error||''),JSON.stringify(evidence.pickupCheckout));
 r=await buyer.req('/api/commerce',{method:'POST',json:{action:'checkout',listingId:fixed,requestId:crypto.randomUUID(),sandboxAcknowledged:true,fulfillment:'pickup',storeCreditCents:0}});record('buyer: pickup on a shipping-only listing is refused',r.status===409,r.data.error);
 r=await buyer.req('/api/commerce',{method:'POST',json:{action:'confirm_pickup',orderId:'00000000-0000-0000-0000-000000000000'}});record('buyer: unknown order pickup → 404',r.status===404,r.data.error);
 console.log('\nSUMMARY '+results.filter(x=>x.ok).length+'/'+results.length+' passed');console.log(JSON.stringify({fixed,pickupListing,highValue,auction,seller:sp?.id,evidence},null,1));
}
main().catch(e=>{console.error(e);process.exit(1)});
