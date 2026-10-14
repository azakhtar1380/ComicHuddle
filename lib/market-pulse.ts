import {sql} from 'drizzle-orm';
import type {CatalogDb} from './catalog-store';
import type {MarketTick} from '../architecture/platform-v2/ui/types';

/** Compare only the same issue, printing, label and grade against a seven-day observation. */
export async function marketPulse(db:CatalogDb):Promise<MarketTick[]>{
 const result=await db.execute(sql`SELECT f.issue_id,d.title,d.number,f.mode,f.grade,f.fmv_price,f.last_updated,f.source_name,
  CASE WHEN h.fmv_price>0 THEN round((f.fmv_price-h.fmv_price)*10000/h.fmv_price)::integer ELSE NULL END AS delta_bps
 FROM gcd.fmv_records f JOIN gcd.comichuddle_directory d ON d.id=f.issue_id
 LEFT JOIN LATERAL(SELECT fmv_price FROM gcd.fmv_history h WHERE h.issue_id=f.issue_id
  AND h.mode=f.mode AND h.grade=f.grade AND h.label=f.label AND h.printing=f.printing
  AND h.observed_on BETWEEN (now() AT TIME ZONE 'UTC')::date-8 AND (now() AT TIME ZONE 'UTC')::date-7
  ORDER BY h.observed_on DESC LIMIT 1)h ON true
 WHERE f.valid_until>now() AND f.last_updated>=now()-interval '7 days' AND f.sample_size>=3
 ORDER BY abs(COALESCE(round((f.fmv_price-h.fmv_price)*10000/NULLIF(h.fmv_price,0)),0)) DESC,f.issue_id LIMIT 12`);
 return result.rows.map(row=>({id:[row.issue_id,row.mode,row.grade].join('-'),comicId:String(row.issue_id),title:String(row.title)+' #'+row.number,
  gradeLabel:row.mode==='Raw'?'Raw '+row.grade:String(row.mode)+' '+row.grade,valueCents:String(Math.round(Number(row.fmv_price)*100)),
  deltaBps:row.delta_bps===null?null:Number(row.delta_bps),asOf:new Date(row.last_updated as string).toISOString(),sourceName:String(row.source_name),kind:'sold_estimate'}));
}
