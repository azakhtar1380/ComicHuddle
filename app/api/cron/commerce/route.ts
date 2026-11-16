// Commerce background job (Vercel Cron, Authorization: Bearer $CRON_SECRET). Every step is safe to run twice:
// each one only acts on rows still in the state it changes, and money steps use per-order idempotency keys.
//  1. close ended auctions          2. save EXPIRED on overdue offers
//  3. poll carriers (Pending → Sold on delivery happens in the database trigger, migration 043)
//  4. refund pickup PINs unused for 7 days     5. owner sweep (deadlines, refunds owed)
//  6. release seller transfers after the review window — only when COMMERCE_PAYOUTS_ENABLED=true
//  7. manual bank payouts for new-tier sellers 7 days after delivery/pickup — same switch
// Checkout holds expire through Stripe's own checkout.session.expired webhook.
import {createHash,timingSafeEqual} from 'node:crypto';
import {and,eq} from 'drizzle-orm';
import {getDb} from '../../../../db';
import {commerceOrders} from '../../../../db/schema';
import {commerceOwnerRelease,commerceOwnerSweep,commercePickupExpirySweep,commerceRefreshCarrierStatus,type StripeSandboxEnv} from '../../../../lib/commerce';
import {resolveEndedAuctions} from '../../../../lib/marketplace-auction';
import {expireOffers} from '../../../../lib/offers';
import {ownerAccountId} from '../../../../lib/owner';
import {runManualPayouts} from '../../../../lib/seller-payouts';
import {stripeSandbox,stripeMode} from '../../../../lib/stripe-sandbox';
import {env} from '../../../../lib/runtime-env';

export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=300;

const digest=(s:string)=>createHash('sha256').update(s).digest();
function authorized(request:Request){const secret=process.env.CRON_SECRET;return !!secret&&timingSafeEqual(digest(request.headers.get('authorization')||''),digest('Bearer '+secret))}
/** Deterministic UUID per order, so a repeated release run reuses the same ledger request (no double transfer). */
function releaseRequestId(orderId:string){const h=createHash('sha256').update('comichuddle-release:'+orderId).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32)}

async function step<T>(name:string,results:Record<string,unknown>,run:()=>Promise<T>){
 try{results[name]=await run()}catch(error){results[name]={error:error instanceof Error?error.message.slice(0,160):'failed'}}
}

export async function GET(request:Request){
 if(!authorized(request))return Response.json({error:'Unauthorized'},{status:401,headers:{'Cache-Control':'no-store'}});
 const db=getDb(),environment=env as unknown as StripeSandboxEnv,results:Record<string,unknown>={},started=Date.now();
 await step('auctions',results,()=>resolveEndedAuctions(db as never,50));
 await step('offers',results,()=>expireOffers());
 await step('carriers',results,()=>commerceRefreshCarrierStatus(db,environment,{limit:25}));
 const mode=stripeMode(environment as never);
 if(mode){
  await step('pickupExpiry',results,()=>commercePickupExpirySweep(db,ownerAccountId,{action:'pickup_expiry_sweep',sandboxAcknowledged:true},environment));
  await step('sweep',results,()=>commerceOwnerSweep(db,ownerAccountId,{action:'owner_sweep',sandboxAcknowledged:true},environment));
  if(process.env.COMMERCE_PAYOUTS_ENABLED==='true'){
   const sandbox=mode==='live'?0:1;
   await step('releases',results,async()=>{
    const due=await db.select({id:commerceOrders.id,seller:commerceOrders.sellerUserId}).from(commerceOrders).where(and(eq(commerceOrders.status,'release_eligible'),eq(commerceOrders.sandbox,sandbox))).limit(20);
    const out:{orderId:string;result:string}[]=[];
    for(const row of due){
     if(Date.now()-started>200000)break;
     try{const r=await commerceOwnerRelease(db,ownerAccountId,{action:'owner_release',orderId:row.id,requestId:releaseRequestId(row.id)},environment);out.push({orderId:row.id,result:r.order.status})}
     catch(error){out.push({orderId:row.id,result:error instanceof Error?error.message.slice(0,120):'failed'})}
    }
    return out;
   });
   await step('payouts',results,()=>runManualPayouts(stripeSandbox(environment),sandbox));
  }else results.releases={skipped:'COMMERCE_PAYOUTS_ENABLED is not true'};
 }else results.payments={skipped:'Stripe is not configured'};
 return Response.json({ok:true,ms:Date.now()-started,results},{headers:{'Cache-Control':'no-store'}});
}
