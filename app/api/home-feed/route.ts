import {getDb} from '../../../db';
import {sql} from 'drizzle-orm';
import {catalogIssuesById} from '../../../lib/catalog-store';
import {catalogSearchDto} from '../../../lib/catalog-search';
import {marketPulse} from '../../../lib/market-pulse';

export async function GET(){try{
 const db=getDb(),today=new Date().toISOString().slice(0,10),end=new Date(Date.now()+93*86400000).toISOString().slice(0,10);
 const [market,upcomingIds]=await Promise.all([
  marketPulse(db),
  db.execute(sql`SELECT 4000000000::bigint+id AS id FROM gcd.gcd_issue WHERE COALESCE(deleted,0)=0
   AND on_sale_date>=${today} AND on_sale_date<=${end} AND on_sale_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   ORDER BY on_sale_date,id LIMIT 6`),
 ]);
 const upcoming=await catalogIssuesById(db,upcomingIds.rows.map(row=>Number(row.id)));
 return Response.json({market,upcoming:upcoming.flatMap(issue=>issue?[catalogSearchDto(issue)]:[]),asOf:new Date().toISOString()},
  {headers:{'Cache-Control':'public, s-maxage=120, stale-while-revalidate=300'}});
}catch{return Response.json({error:'Market and release data could not be loaded.'},{status:503})}}
