import { and, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { CatalogDb } from './catalog-store';
import { ApiRequestError } from './api-security';

export type LocationOrigin={zip:string;city:string;state:string;latitude:number;longitude:number};
export const radii=['5','15','30','50','nationwide'] as const;
export type LocationFilters={location:string;radius:typeof radii[number]};
export function locationFilters(url:URL):LocationFilters{
 const location=(url.searchParams.get('location')||'').trim(),radius=url.searchParams.get('radius')||'nationwide';
 if(location.length>100||!radii.includes(radius as typeof radii[number]))throw new ApiRequestError('Choose a city/ZIP and a supported distance.',400);
 if(radius!=='nationwide'&&!location)throw new ApiRequestError('Enter a city with state or a ZIP before selecting a radius.',400);
 return {location,radius:radius as typeof radii[number]};
}
export async function locationChoices(db:CatalogDb,query:string):Promise<LocationOrigin[]>{
 const q=query.trim();if(q.length<2||q.length>100)return [];
 const zip=/^\d{1,5}$/.test(q);
 const where=zip?sql`zip LIKE ${q+'%'}`:sql`(city ILIKE ${q.split(',')[0].trim()+'%'} OR (city||', '||state) ILIKE ${q+'%'})`;
 const result=await db.execute(sql`SELECT zip,city,state,latitude,longitude FROM ch_web.us_postal_centroids WHERE ${where} ORDER BY CASE WHEN zip=${q} THEN 0 ELSE 1 END,city,state,zip LIMIT 10`);
 return result.rows as LocationOrigin[];
}
export async function resolveLocation(db:CatalogDb,value:string):Promise<LocationOrigin|null>{
 if(!value.trim())return null;
 const q=value.trim(),zip=q.match(/(?:^|\s)(\d{5})(?:$|\s)/)?.[1];
 const parts=q.split(',').map(value=>value.trim()),city=parts[0],state=parts.length===2?parts[1].toUpperCase():'';
 const result=await db.execute(sql`SELECT zip,city,state,latitude,longitude FROM ch_web.us_postal_centroids WHERE ${zip?sql`zip=${zip}`:sql`lower(city)=lower(${city}) AND (${state}='' OR state=${state})`} ORDER BY zip LIMIT 1000`);
 const rows=result.rows as LocationOrigin[];
 if(!rows.length)throw new ApiRequestError('That US city/ZIP was not found. Choose a suggested location.',400);
 if(new Set(rows.map(row=>row.state)).size>1)throw new ApiRequestError('More than one state has that city. Add the state or choose a ZIP code.',400);
 return zip?rows[0]:{...rows[0],latitude:rows.reduce((sum,row)=>sum+row.latitude,0)/rows.length,longitude:rows.reduce((sum,row)=>sum+row.longitude,0)/rows.length};
}
/** Straight-line miles between approximate ZIP coordinates, not home addresses. */
export function distanceSql(latitude:SQLWrapper,longitude:SQLWrapper,origin:LocationOrigin|null):SQL<number|null>{
 if(!origin)return sql<number|null>`NULL::double precision`;
 return sql<number|null>`CASE WHEN ${latitude} IS NULL OR ${longitude} IS NULL THEN NULL ELSE 3958.7613*2*asin(sqrt(greatest(0.0,least(1.0,
  power(sin(radians(${latitude}-${origin.latitude})/2),2)+cos(radians(${origin.latitude}))*cos(radians(${latitude}))*power(sin(radians(${longitude}-${origin.longitude})/2),2))))) END`;
}
export function radiusPredicate(latitude:SQLWrapper,longitude:SQLWrapper,origin:LocationOrigin|null,radius:LocationFilters['radius']){
 if(!origin||radius==='nationwide')return undefined;
 const miles=Number(radius),latDelta=miles/68.5,polarLatitude=Math.min(90,Math.abs(origin.latitude)+latDelta),lonDelta=Math.min(180,miles/(68.5*Math.max(.000001,Math.cos(polarLatitude*Math.PI/180))));
 return and(sql`${latitude} BETWEEN ${origin.latitude-latDelta} AND ${origin.latitude+latDelta}`,
  sql`least(abs(${longitude}-${origin.longitude}),360-abs(${longitude}-${origin.longitude}))<=${lonDelta}`,
  sql`${distanceSql(latitude,longitude,origin)}<=${miles}`);
}
