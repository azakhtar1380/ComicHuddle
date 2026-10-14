import {z} from 'zod';
import {createHash} from 'node:crypto';
import {sql} from 'drizzle-orm';
import type {CatalogDb} from './catalog-store';
const https=z.string().url().refine(value=>{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port});
export const soldCompSchema=z.object({issueId:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),source:z.enum(['authorized_ebay','licensed_feed','platform']),sourceReference:z.string().min(1).max(200),sourceUrl:https,mode:z.enum(['Raw','CGC','CBCS']),grade:z.string().regex(/^(?:[0-9]\.[0-9]|10\.0|Unspecified)$/),label:z.enum(['Raw','Universal']),printing:z.enum(['First printing','Later printing']),soldAt:z.string().datetime().refine(value=>Date.parse(value)<=Date.now()),priceCents:z.number().int().min(1).max(100000000),currency:z.literal('USD'),bestOfferAccepted:z.boolean(),actualPriceConfirmed:z.boolean()}).strict().refine(sale=>(sale.mode==='Raw')===(sale.label==='Raw')&&(sale.mode==='Raw'||sale.grade!=='Unspecified'),'Only exact Raw or Universal grade comps are supported.');
export type SoldComp=z.infer<typeof soldCompSchema>;
const quantile=(sorted:number[],p:number)=>{const index=(sorted.length-1)*p,low=Math.floor(index);return sorted[low]+(sorted[Math.ceil(index)]-sorted[low])*(index-low)};
export function rollingMedian(comps:SoldComp[],at=Date.now(),windowDays=90){
 const unique=new Map<string,SoldComp>();
 for(const raw of comps){const parsed=soldCompSchema.safeParse(raw);if(!parsed.success)continue;const sale=parsed.data,time=Date.parse(sale.soldAt);if(!sale.actualPriceConfirmed||time>at||time<at-windowDays*86400000)continue;const key=sale.source+':'+sale.sourceReference;if(!unique.has(key))unique.set(key,sale)}
 const identities=new Set([...unique.values()].map(sale=>[sale.issueId,sale.mode,sale.grade,sale.label,sale.printing].join('|')));if(identities.size>1)throw Error('Do not combine different issues, grades, labels or printings.');
 let values=[...unique.values()].map(sale=>sale.priceCents).sort((a,b)=>a-b);if(values.length<3)return null;
 const q1=quantile(values,.25),q3=quantile(values,.75),iqr=q3-q1;
 if(values.length>=5&&iqr>0)values=values.filter(value=>value>=Math.max(1,q1-1.5*iqr)&&value<=q3+1.5*iqr);
 if(values.length<3)return null;return {fmvCents:Math.round(quantile(values,.5)),lowCents:values[0],highCents:values[values.length-1],sampleSize:values.length,windowDays,method:'ROLLING_MEDIAN_IQR' as const};
}
export async function importSoldComps(db:CatalogDb,comps:SoldComp[],rightsReference:string,rightsExpiresAt:string){
 if(rightsReference.length<5||rightsReference.length>300||!Number.isFinite(Date.parse(rightsExpiresAt))||Date.parse(rightsExpiresAt)<=Date.now())throw Error('Active redistribution permission is required.');
 const ids=[...new Set(comps.map(sale=>sale.issueId))],groups=new Map<string,SoldComp>();
 const writes=ids.map(id=>db.execute(sql`INSERT INTO gcd.comichuddle_issue_refs(id,gcd_issue_id) SELECT id,gcd_id FROM gcd.comichuddle_directory WHERE id=${id} ON CONFLICT DO NOTHING`));
 for(const raw of comps){const sale=soldCompSchema.parse(raw);if(sale.source==='platform')throw Error('Platform comps require the internal verified completed-order adapter; external uploads cannot attest a platform sale.');const id=createHash('sha256').update([sale.source,sale.sourceReference,sale.issueId,sale.mode,sale.grade,sale.label,sale.printing].join('|')).digest('hex');groups.set([sale.issueId,sale.mode,sale.grade,sale.label,sale.printing].join('|'),sale);
  writes.push(db.execute(sql`INSERT INTO gcd.sales_comps(id,issue_id,source,source_reference,source_url,mode,grade,label,printing,sold_at,price_cents,best_offer_accepted,actual_price_confirmed,rights_reference,rights_expires_at,verified) VALUES(${id},${sale.issueId},${sale.source},${sale.sourceReference},${sale.sourceUrl},${sale.mode},${sale.grade},${sale.label},${sale.printing},${sale.soldAt}::timestamptz,${sale.priceCents},${sale.bestOfferAccepted},${sale.actualPriceConfirmed},${rightsReference},${rightsExpiresAt}::timestamptz,true) ON CONFLICT(id) DO UPDATE SET price_cents=EXCLUDED.price_cents,actual_price_confirmed=EXCLUDED.actual_price_confirmed,rights_reference=EXCLUDED.rights_reference,rights_expires_at=EXCLUDED.rights_expires_at,verified=EXCLUDED.verified`));
 }
 if(writes.length)await db.batch(writes);
 let updated=0;const stamp=new Date().toISOString();
 for(const sale of groups.values()){
  const result=await db.execute(sql`SELECT source,source_reference,source_url,mode,grade,label,printing,sold_at,price_cents,best_offer_accepted,actual_price_confirmed,rights_expires_at FROM gcd.sales_comps WHERE issue_id=${sale.issueId} AND mode=${sale.mode} AND grade=${sale.grade} AND label=${sale.label} AND printing=${sale.printing} AND verified AND rights_expires_at>now() AND sold_at BETWEEN now()-interval '90 days' AND now() ORDER BY sold_at DESC LIMIT 1000`);
  const all=result.rows.map(row=>({issueId:sale.issueId,source:row.source as SoldComp['source'],sourceReference:String(row.source_reference),sourceUrl:String(row.source_url),mode:sale.mode,grade:sale.grade,label:sale.label,printing:sale.printing,soldAt:new Date(row.sold_at as string).toISOString(),priceCents:Number(row.price_cents),currency:'USD' as const,bestOfferAccepted:row.best_offer_accepted===true,actualPriceConfirmed:row.actual_price_confirmed===true}));
  const quote=rollingMedian(all);if(!quote)continue;
  const validUntil=new Date(Math.min(Date.now()+7*86400000,...result.rows.map(row=>Date.parse(String(row.rights_expires_at))))).toISOString();
  const names=[...new Set(all.map(row=>row.source==='authorized_ebay'?'eBay completed sales (authorized)':row.source==='platform'?'ComicHuddle verified completed sales':'Licensed completed sales'))].join(' + ');
  await db.execute(sql`INSERT INTO gcd.fmv_records(issue_id,mode,grade,label,printing,fmv_price,low_price,high_price,last_updated,sample_size,window_days,source_name,source_url,valid_until) VALUES(${sale.issueId},${sale.mode},${sale.grade},${sale.label},${sale.printing},${quote.fmvCents/100},${quote.lowCents/100},${quote.highCents/100},${stamp}::timestamptz,${quote.sampleSize},90,${names},${sale.sourceUrl},${validUntil}::timestamptz) ON CONFLICT(issue_id,mode,grade,label,printing) DO UPDATE SET fmv_price=EXCLUDED.fmv_price,low_price=EXCLUDED.low_price,high_price=EXCLUDED.high_price,last_updated=EXCLUDED.last_updated,sample_size=EXCLUDED.sample_size,source_name=EXCLUDED.source_name,source_url=EXCLUDED.source_url,valid_until=EXCLUDED.valid_until`);updated++;
 }
 return {accepted:comps.length,updated,method:'ROLLING_MEDIAN_IQR',minSamples:3};
}
export {ebaySoldSearch} from './sold-search-links';
