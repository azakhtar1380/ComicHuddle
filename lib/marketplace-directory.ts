import {and,asc,desc,eq,inArray,or,sql} from 'drizzle-orm';
import {commerceOrders,listings,profiles} from '../db/schema';
import {CHECKOUT_EXPIRY_SECONDS} from './stripe-sandbox';
import type {CatalogDb} from './catalog-store';
import type {Listing} from './community';
import {listingContext,listingDto} from './marketplace';
import {resolveEndedAuctions} from './marketplace-auction';
import {distanceSql,radiusPredicate,resolveLocation,type LocationFilters} from './location-search';
import {ApiRequestError} from './api-security';

/** Fields a signed-out visitor may see. Everything else (ids, ZIP, private copy ids, bids) is dropped. */
export const publicListingFields=['id','title','grade','description','price','shipping','photos','cert','status','createdAt','safePurchaseOptIn','safePurchaseVerifiedAt','locationCity','locationState','seller','fulfillment','pickupCity','pickupState','kind','saleType','items','itemCount','auction','distanceMiles'] as const;
// The seller's profile id (not their account user id) powers public feedback; it is already public on profiles.
export const publicSellerFields=['id','name','handle','createdAt'] as const;
export const publicItemFields=['id','title','issue','grade','catalogId','externalCatalog','photoId','condition'] as const;
export const publicAuctionFields=['endAt','bidIncrement','currentBid','minNextBid','bidCount','ended','binding','nonbinding','reserve','result','nextIncrement'] as const;
function pick<T extends Record<string,unknown>,K extends readonly string[]>(value:T,keys:K){return Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]))}
export type PublicListing=Record<string,unknown>;
/** Explicit allowlist projection for guests: never spread a private DTO into a public response. */
export function publicListing(listing:Listing&{distanceMiles?:number|null}):PublicListing{
 const base=pick(listing as unknown as Record<string,unknown>,publicListingFields);
 // Copy ids are the seller's private collection ids; guests get stable positional ids instead.
 return {...base,seller:pick(listing.seller as unknown as Record<string,unknown>,publicSellerFields),items:listing.items.map((item,index)=>({...pick(item as unknown as Record<string,unknown>,publicItemFields),id:listing.id+':'+(index+1)})),auction:listing.auction?pick(listing.auction as unknown as Record<string,unknown>,publicAuctionFields):null};
}

export async function marketplaceDirectory(db:CatalogDb,viewer:typeof profiles.$inferSelect|undefined,filters:LocationFilters&{view:string;q:string;category:string;issueId:number|null;offset:number;listingId?:string},options:{guest?:boolean}={}){
 if(filters.q.length>160||!['active','mine','sold','won'].includes(filters.view)||!['all','single','collection','auction'].includes(filters.category)||!Number.isSafeInteger(filters.offset)||filters.offset<0)throw new ApiRequestError('Choose valid marketplace filters.',400);
 if(filters.view!=='active'&&!viewer)throw new ApiRequestError(options.guest?'Sign in to see your listings.':'Create a collector profile to view your listings.',options.guest?401:403);
 await resolveEndedAuctions(db).catch(()=>[]);
 const origin=await resolveLocation(db,filters.location),distance=distanceSql(listings.latitude,listings.longitude,origin);
 const publicSeller=and(eq(profiles.visible,1),eq(profiles.moderated,0),sql`${profiles.deletionStartedAt} IS NULL`,sql`NOT EXISTS(SELECT 1 FROM account_restrictions r WHERE r.user_id=${profiles.userId} AND r.scope='account')`);
 const visible=filters.view==='active'?and(publicSeller,
  viewer?sql`NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.from_id=${viewer.id} AND b.to_id=${profiles.id}) OR (b.from_id=${profiles.id} AND b.to_id=${viewer.id}))`:undefined):filters.view==='won'?and(eq(listings.leaderId,viewer!.id),eq(listings.saleType,'auction')):eq(listings.sellerId,viewer!.id);
 const status=filters.view==='sold'?eq(listings.status,'sold'):filters.view==='mine'?inArray(listings.status,['active','ended','checkout_reserved','auction_won']):filters.view==='won'?inArray(listings.status,['auction_won','checkout_reserved']):and(eq(listings.status,'active'),sql`(${listings.saleType}<>'auction' OR ${listings.endAt}>${new Date().toISOString()})`);
 // A buyer looking up a listing they are paying for right now still sees it (reserved for them).
 const ownReservation=viewer&&filters.listingId&&filters.view==='active'?sql`(${listings.status}='checkout_reserved' AND EXISTS(SELECT 1 FROM commerce_orders o WHERE o.listing_id=${listings.id} AND o.buyer_id=${viewer.id} AND o.status='awaiting_payment'))`:undefined;
 const criteria=and(visible,filters.listingId?eq(listings.id,filters.listingId):undefined,ownReservation?or(status,ownReservation):status,
  filters.q?sql`(${listings.title} ILIKE ${'%'+filters.q+'%'} OR ${listings.description} ILIKE ${'%'+filters.q+'%'} OR ${profiles.name} ILIKE ${'%'+filters.q+'%'})`:undefined,
  filters.category==='auction'?eq(listings.saleType,'auction'):filters.category!=='all'?eq(listings.kind,filters.category):undefined,
  filters.issueId===null?undefined:sql`(${listings.issueId}=${filters.issueId} OR EXISTS(SELECT 1 FROM jsonb_array_elements(${listings.items}::jsonb) item WHERE (item->>'catalogId')::bigint=${filters.issueId} OR (CASE item->'externalCatalog'->>'provider' WHEN 'GCD' THEN 4000000000 WHEN 'Metron' THEN 1000000000 ELSE NULL END)+(item->'externalCatalog'->>'id')::bigint=${filters.issueId}))`,
  radiusPredicate(listings.latitude,listings.longitude,origin,filters.radius));
 const [counts]=await db.select({n:sql<number>`count(*)`.as('listing_count')}).from(listings).innerJoin(profiles,eq(profiles.id,listings.sellerId)).where(criteria);
 const pickupRank=origin?sql`CASE WHEN ${listings.fulfillment} IN ('pickup','both') AND ${distance}<=50 THEN 0 ELSE 1 END`:sql`0::integer`;
 const rows=await db.select({listing:listings,seller:{id:sql<string>`${profiles.id}`.as('seller_profile_id'),name:sql<string>`${profiles.name}`.as('seller_profile_name'),handle:sql<string>`${profiles.handle}`.as('seller_profile_handle'),createdAt:sql<string>`${profiles.createdAt}`.as('seller_profile_created_at')},distance}).from(listings).innerJoin(profiles,eq(profiles.id,listings.sellerId)).where(criteria).orderBy(asc(pickupRank),sql`${distance} ASC NULLS LAST`,desc(listings.createdAt),asc(listings.id)).limit(30).offset(filters.offset);
 const context=await listingContext(db,rows.map(row=>row.listing),viewer?.id),total=Number(counts?.n||0);
 const reserved=new Map<string,string>();
 if(viewer&&rows.some(row=>row.listing.status==='checkout_reserved'))for(const order of await db.select({listingId:commerceOrders.listingId,createdAt:commerceOrders.createdAt}).from(commerceOrders).where(and(eq(commerceOrders.buyerId,viewer.id),eq(commerceOrders.status,'awaiting_payment'),inArray(commerceOrders.listingId,rows.map(row=>row.listing.id)))))reserved.set(order.listingId,new Date(Date.parse(order.createdAt)+CHECKOUT_EXPIRY_SECONDS*1000).toISOString());
 const dtos=rows.map(row=>({...listingDto(row.listing,row.seller,viewer?.id,context),distanceMiles:row.distance===null?null:Math.round(row.distance*10)/10,...(reserved.has(row.listing.id)?{reservedForYouUntil:reserved.get(row.listing.id)}:{})}));
 return {listings:options.guest?dtos.map(publicListing):dtos,total,offset:filters.offset,limit:30,hasMore:filters.offset+30<total,origin:origin?{city:origin.city,state:origin.state}:null,approximateDistances:true,guest:!!options.guest};
}
