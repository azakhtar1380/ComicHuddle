import {and,asc,desc,eq,inArray,sql,type SQL} from 'drizzle-orm';
import {listings,profiles} from '../db/schema';
import type {CatalogDb} from './catalog-store';
import {listingContext,listingDto} from './marketplace';
import {distanceSql,radiusPredicate,resolveLocation,type LocationFilters} from './location-search';
import {ApiRequestError} from './api-security';

export async function marketplaceDirectory(db:CatalogDb,viewer:typeof profiles.$inferSelect|undefined,filters:LocationFilters&{view:string;q:string;category:string;issueId:number|null;offset:number}){
 if(filters.q.length>160||!['active','mine','sold'].includes(filters.view)||!['all','single','collection','auction'].includes(filters.category)||!Number.isSafeInteger(filters.offset)||filters.offset<0)throw new ApiRequestError('Choose valid marketplace filters.',400);
 if(filters.view!=='active'&&!viewer)throw new ApiRequestError('Create a collector profile to view your listings.',403);
 const origin=await resolveLocation(db,filters.location),distance=distanceSql(listings.latitude,listings.longitude,origin);
 const visible=filters.view==='active'?and(eq(profiles.visible,1),eq(profiles.moderated,0),sql`${profiles.deletionStartedAt} IS NULL`,
  sql`NOT EXISTS(SELECT 1 FROM account_restrictions r WHERE r.user_id=${profiles.userId} AND r.scope='account')`,
  viewer?sql`NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.from_id=${viewer.id} AND b.to_id=${profiles.id}) OR (b.from_id=${profiles.id} AND b.to_id=${viewer.id}))`:undefined):eq(listings.sellerId,viewer!.id);
 const criteria=and(visible,filters.view==='sold'?eq(listings.status,'sold'):filters.view==='mine'?inArray(listings.status,['active','ended','checkout_reserved']):and(eq(listings.status,'active'),sql`(${listings.saleType}<>'auction' OR ${listings.endAt}>${new Date().toISOString()})`),
  filters.q?sql`(${listings.title} ILIKE ${'%'+filters.q+'%'} OR ${listings.description} ILIKE ${'%'+filters.q+'%'} OR ${profiles.name} ILIKE ${'%'+filters.q+'%'})`:undefined,
  filters.category==='auction'?eq(listings.saleType,'auction'):filters.category!=='all'?eq(listings.kind,filters.category):undefined,
  filters.issueId===null?undefined:sql`(${listings.issueId}=${filters.issueId} OR EXISTS(SELECT 1 FROM jsonb_array_elements(${listings.items}::jsonb) item WHERE (item->>'catalogId')::bigint=${filters.issueId} OR (CASE item->'externalCatalog'->>'provider' WHEN 'GCD' THEN 4000000000 WHEN 'Metron' THEN 1000000000 ELSE NULL END)+(item->'externalCatalog'->>'id')::bigint=${filters.issueId}))`,
  radiusPredicate(listings.latitude,listings.longitude,origin,filters.radius));
 const [counts]=await db.select({n:sql<number>`count(*)`.as('listing_count')}).from(listings).innerJoin(profiles,eq(profiles.id,listings.sellerId)).where(criteria);
 const pickupRank=origin?sql`CASE WHEN ${listings.fulfillment} IN ('pickup','both') AND ${distance}<=50 THEN 0 ELSE 1 END`:sql`0::integer`;
 const rows=await db.select({listing:listings,seller:{id:sql<string>`${profiles.id}`.as('seller_profile_id'),name:sql<string>`${profiles.name}`.as('seller_profile_name'),handle:sql<string>`${profiles.handle}`.as('seller_profile_handle'),createdAt:sql<string>`${profiles.createdAt}`.as('seller_profile_created_at')},distance}).from(listings).innerJoin(profiles,eq(profiles.id,listings.sellerId)).where(criteria).orderBy(asc(pickupRank),sql`${distance} ASC NULLS LAST`,desc(listings.createdAt),asc(listings.id)).limit(30).offset(filters.offset);
 const context=await listingContext(db,rows.map(row=>row.listing),viewer?.id),total=Number(counts?.n||0);
 return {listings:rows.map(row=>({...listingDto(row.listing,row.seller,viewer?.id,context),distanceMiles:row.distance===null?null:Math.round(row.distance*10)/10})),total,offset:filters.offset,limit:30,hasMore:filters.offset+30<total,origin:origin?{city:origin.city,state:origin.state}:null,approximateDistances:true};
}
