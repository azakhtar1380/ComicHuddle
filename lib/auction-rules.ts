// Auction rules (cleanup round 2), like eBay: once an auction is live the seller can't end, cancel, delete or hide it.
// While live they can only add photos or a note ("Added by seller on {date}"). An auction with no bids ends unsold
// and can be relisted (same details, new dates) or changed to Buy Now. A missed shipping deadline records a seller
// strike that admins can see. Admins can still remove an auction for a rules violation (audited, bidders notified).
// Auctions start when they're published (there's no scheduled start), so every active auction is live.
import {and,eq} from 'drizzle-orm';
import {z} from 'zod';
import type {getDb} from '../db';
import {getPool} from '../db/postgres';
import {listings} from '../db/schema';
import {ApiRequestError} from './api-security';
import {offensiveReason} from './name-rules';
import {createListing,listingItems} from './marketplace';
import type {profiles} from '../db/schema';
type Profile=typeof profiles.$inferSelect;

type Db=ReturnType<typeof getDb>;
export const AUCTION_LOCKED_MESSAGE='Once your auction starts, it can’t be ended early. If someone bids, you must sell and ship.';
export const isLiveAuction=(row:{saleType:string;status:string})=>row.saleType==='auction'&&row.status==='active';
const ADDENDUM_MARK='Added by seller on ';

async function ownListing(db:Db,me:Profile,listingId:string){
 const [row]=await db.select().from(listings).where(and(eq(listings.id,listingId),eq(listings.sellerId,me.id)));
 if(!row)throw new ApiRequestError('Listing not found.',404);
 return row;
}

/** While live: add photos (up to 6 in total) and/or a dated note under the description. Nothing else changes. */
export async function addAuctionAddendum(db:Db,me:Profile,raw:Record<string,unknown>){
 const value=z.object({listingId:z.string().min(1).max(100),note:z.string().trim().max(500).default(''),photos:z.array(z.string().uuid()).max(6).default([])}).strict().parse(raw);
 if(!value.note&&!value.photos.length)throw new ApiRequestError('Add a note or a photo.',400);
 const row=await ownListing(db,me,value.listingId);
 if(!isLiveAuction(row))throw new ApiRequestError('You can add photos or notes only while your auction is live.',409);
 if(value.note){const why=offensiveReason(value.note);if(why)throw new ApiRequestError(why,400)}
 const photos=[...new Set([...(JSON.parse(row.photos) as string[]),...value.photos])];
 if(photos.length>6)throw new ApiRequestError('A listing can have up to 6 photos.',400);
 if(value.photos.length){
  const owned=await getPool().query<{id:string}>('SELECT id FROM ch_web.media WHERE id = ANY($1::text[]) AND user_id=$2',[value.photos,me.userId]);
  if(owned.rows.length!==new Set(value.photos).size)throw new ApiRequestError('Use photos you uploaded.',403);
 }
 const date=new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'America/Chicago'});
 const description=value.note?(row.description+'\n\n'+ADDENDUM_MARK+date+': '+value.note).slice(0,6000):row.description;
 await db.update(listings).set({photos:JSON.stringify(photos),description}).where(and(eq(listings.id,row.id),eq(listings.status,'active')));
 return {saved:true};
}

/** An unsold auction (ended, no bids): list it again with the same details and new dates, as an auction or Buy Now. */
export async function relistUnsoldAuction(db:Db,me:Profile,raw:Record<string,unknown>){
 const value=z.object({listingId:z.string().min(1).max(100),as:z.enum(['auction','fixed']),price:z.number().int().min(100).max(100_000_000).optional()}).strict().parse(raw);
 const row=await ownListing(db,me,value.listingId);
 if(row.saleType!=='auction'||row.status!=='ended'||row.bidCount>0)throw new ApiRequestError('Only an auction that ended with no bids can be relisted.',409);
 const items=listingItems(row),copies=items.filter(item=>item.source!=='custom');
 const conditions=Object.fromEntries(copies.flatMap(item=>item.condition?[[item.bookId,item.condition]]:[]));
 const hours=Math.round((Date.parse(row.endAt)-Date.parse(row.createdAt))/3_600_000),durationHours=[24,72,120,168,240].reduce((best,h)=>Math.abs(h-hours)<Math.abs(best-hours)?h:best,72);
 return createListing(db as never,me,{
  action:'listing',kind:row.kind,saleType:value.as,bookIds:copies.map(item=>item.bookId),
  ...(items.length>copies.length?{customItems:items.filter(item=>item.source==='custom').map(item=>({title:item.title,description:item.description||''}))}:{}),
  conditions,title:row.title,description:row.description,price:value.as==='fixed'&&value.price?value.price:row.price,shipping:row.shipping,
  shippingCalculated:row.shippingCalculated===1,...(row.weightOz?{weightOz:row.weightOz}:{}),...(row.lengthIn?{lengthIn:row.lengthIn,widthIn:row.widthIn,heightIn:row.heightIn}:{}),
  ...(row.locationZip?{locationZip:row.locationZip}:{}),photos:JSON.parse(row.photos),cert:row.cert,attest:true,usaAttest:true,
  fulfillment:row.fulfillment,pickupCity:row.pickupCity,pickupState:row.pickupState,safePurchaseOptIn:row.safePurchaseOptIn===1,
  ...(value.as==='auction'?{durationHours}:{}),
 });
}
