import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { listings,profiles,commerceOrders,listingInventory,offers,auctionBids,tradeProposals,threads,messages } from '../db/schema';
import type { CatalogDb } from './catalog-store';
import { ApiRequestError,isRestricted } from './api-security';
import {blocked} from './conversations';
import {previewRulesVersion} from './community';
import { conditionalGuard,operationGuardFailed } from './operation-guard';

export async function markListingSold(db:CatalogDb,me:typeof profiles.$inferSelect,raw:Record<string,unknown>){
 const input=z.object({listingId:z.string().uuid(),soldVia:z.enum(['platform','cash_local'])}).parse(raw);
 const [row]=await db.select().from(listings).where(and(eq(listings.id,input.listingId),eq(listings.sellerId,me.id)));
 if(!row)throw new ApiRequestError('Listing not found.',404);
 if(row.status==='sold')return {saved:true,duplicate:true,listingId:row.id,note:'This listing is already in Sold Items.'};
 if(!['active','ended'].includes(row.status))throw new ApiRequestError('This listing is reserved or closed and cannot be marked sold.',409);
 const [order]=await db.select().from(commerceOrders).where(and(eq(commerceOrders.listingId,row.id),sql`${commerceOrders.status} NOT IN ('cancelled','refunded','checkout_expired')`));
 if(order&&!['cancelled','refunded','checkout_expired'].includes(order.status))throw new ApiRequestError('Resolve the current platform order before changing this listing.',409);
 // Manual sale reports close inventory; they never verify payment or sold-price comps.
 const stamp=new Date().toISOString(),guard=conditionalGuard(db,sql`EXISTS(SELECT 1 FROM listings l WHERE l.id=${row.id} AND l.seller_id=${me.id} AND l.status IN ('active','ended')) AND NOT EXISTS(SELECT 1 FROM commerce_orders o WHERE o.listing_id=${row.id} AND o.status NOT IN ('cancelled','refunded','checkout_expired'))`);
 try{await db.batch([
  guard.start,
  db.update(listings).set({status:'sold',leaderId:null,leadingBidId:null,auctionVersion:sql`${listings.auctionVersion}+1`}).where(eq(listings.id,row.id)),
  db.execute(sql`INSERT INTO ch_web.marketplace_sales(listing_id,seller_user_id,source,gross_cents,payment_verified,order_id,sold_at) VALUES(${row.id},${me.userId},${input.soldVia},${row.price},0,NULL,${stamp}::timestamptz) ON CONFLICT(listing_id) DO NOTHING`),
  db.delete(listingInventory).where(eq(listingInventory.listingId,row.id)),
  db.update(offers).set({status:'closed'}).where(and(eq(offers.listingId,row.id),eq(offers.status,'pending'))),
  db.update(auctionBids).set({status:'cancelled'}).where(and(eq(auctionBids.listingId,row.id),inArray(auctionBids.status,['leading','outbid']))),
  db.update(tradeProposals).set({status:'cancelled',version:sql`${tradeProposals.version}+1`,updatedAt:stamp,decidedAt:stamp,decidedBy:me.id}).where(and(eq(tradeProposals.listingId,row.id),eq(tradeProposals.status,'pending'))),
  guard.finish
 ] as never)}catch(error){if(operationGuardFailed(error))throw new ApiRequestError('The listing changed. Refresh before marking it sold.',409);throw error}
 return {saved:true,listingId:row.id,paymentVerified:false,note:input.soldVia==='cash_local'?'Cash/local sale recorded. Offline payments do not change your wallet.':'Sale recorded. Wallet credits require a confirmed platform payment; this action does not create funds.'};
}

export async function requestSafePurchase(db:CatalogDb,me:typeof profiles.$inferSelect,raw:Record<string,unknown>){
 const listingId=z.string().uuid().parse(raw.listingId);
 const [listing]=await db.select().from(listings).where(and(eq(listings.id,listingId),eq(listings.status,'active')));
 if(!listing||!listing.safePurchaseOptIn)throw new ApiRequestError('SafePurchase is not selected for this active listing.',409);
 const [seller]=await db.select().from(profiles).where(eq(profiles.id,listing.sellerId));
 if(!seller||seller.id===me.id||!seller.visible||!seller.dmOpen||seller.moderated||seller.deletionStartedAt||seller.rulesVersion!==previewRulesVersion||!seller.rulesAcceptedAt||await isRestricted(db,seller.userId)||await blocked(db,me.id,seller.id))throw new ApiRequestError('This inspection request is unavailable.',403);
 const id=crypto.randomUUID(),[left,right]=[me.id,seller.id].sort(),pair=left+':'+right,stamp=new Date().toISOString();
 const check=conditionalGuard(db,sql`EXISTS(SELECT 1 FROM listings l JOIN profiles s ON s.id=l.seller_id WHERE l.id=${listingId} AND l.status='active' AND l.safe_purchase_opt_in=1 AND s.id=${seller.id} AND s.visible=1 AND s.dm_open=1 AND s.moderated=0 AND s.deletion_started_at IS NULL)
  AND NOT EXISTS(SELECT 1 FROM account_restrictions r WHERE r.user_id IN (${me.userId},${seller.userId}) AND r.scope='account')
  AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.from_id=${me.id} AND b.to_id=${seller.id}) OR (b.from_id=${seller.id} AND b.to_id=${me.id}))`);
 try{await db.batch([
  check.start,
  db.insert(threads).values({id:crypto.randomUUID(),pair,a:left,b:right,context:'SafePurchase · '+listing.title,createdAt:stamp}).onConflictDoNothing(),
  db.execute(sql`INSERT INTO ch_web.safe_purchase_requests(id,listing_id,buyer_user_id,seller_user_id) VALUES(${id},${listingId},${me.userId},${seller.userId}) ON CONFLICT(listing_id,buyer_user_id) DO NOTHING`),
  db.execute(sql`INSERT INTO messages(id,thread_id,profile_id,body,created_at) SELECT ${crypto.randomUUID()},t.id,${me.id},${'SafePurchase inspection requested for '+listing.title+'. Please agree on service terms and official intake instructions before shipping. No payment has been taken.'},${stamp} FROM threads t WHERE t.pair=${pair} AND EXISTS(SELECT 1 FROM ch_web.safe_purchase_requests r WHERE r.id=${id})`),
  check.finish
 ] as never)}catch(error){if(operationGuardFailed(error))throw new ApiRequestError('The listing or account changed. Refresh before requesting inspection.',409);throw error}
 const [thread]=await db.select({id:threads.id}).from(threads).where(eq(threads.pair,pair));
 return {saved:true,threadId:thread?.id,note:'SafePurchase inspection requested in your private conversation. Wait for accepted service terms and shipping instructions before sending a book. No payment was taken.'};
}
