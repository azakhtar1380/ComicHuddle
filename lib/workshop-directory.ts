import {and,asc,desc,eq,sql} from 'drizzle-orm';
import {careProviders,profiles} from '../db/schema';
import type {CatalogDb} from './catalog-store';
import {distanceSql,radiusPredicate,resolveLocation,type LocationFilters} from './location-search';

export function studioVisibleFields(row:typeof careProviders.$inferSelect,own=false){
 const {shippingAddress,shippingNotes,moderated,locationZip,latitude,longitude,...visible}=row;
 return {...visible,...(own?{shippingAddress,shippingNotes,locationZip}:{})};
}

/** Location filtering happens in PostgreSQL before the bounded directory read.
 * Detailed profiles are looked up independently of the current radius. */
export async function workshopDirectoryRows(db:CatalogDb,viewerId:string|undefined,filters:LocationFilters,providerId?:string){
 const origin=providerId?null:await resolveLocation(db,filters.location);
 const distance=distanceSql(careProviders.latitude,careProviders.longitude,origin);
 const rows=await db.select({provider:careProviders,distance}).from(careProviders)
  .innerJoin(profiles,eq(profiles.id,careProviders.profileId))
  .where(and(eq(careProviders.visible,1),eq(careProviders.moderated,0),eq(profiles.visible,1),eq(profiles.moderated,0),
   sql`${profiles.deletionStartedAt} IS NULL`,
   sql`NOT EXISTS(SELECT 1 FROM account_restrictions r WHERE r.user_id=${profiles.userId} AND r.scope IN ('account','provider'))`,
   viewerId?sql`NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.from_id=${viewerId} AND b.to_id=${profiles.id}) OR (b.from_id=${profiles.id} AND b.to_id=${viewerId}))`:undefined,
   providerId?eq(careProviders.id,providerId):radiusPredicate(careProviders.latitude,careProviders.longitude,origin,filters.radius)))
  .orderBy(sql`${distance} ASC NULLS LAST`,desc(careProviders.createdAt),asc(careProviders.id)).limit(201);
 return {rows:rows.slice(0,200),hasMore:rows.length>200};
}
