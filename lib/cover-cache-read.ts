import {sql} from 'drizzle-orm';
import type {CatalogDb} from './catalog-store';
/** Small read path: no AWS SDK, provider calls, queue work or model imports. */
export async function readyCachedCoverRows(db:CatalogDb,ids:number[]){
 const base=process.env.COVER_CDN_BASE_URL;if(!base||!ids.length)return new Map<number,{url:string;attribution:string;source:string}>();
 let origin:URL;try{origin=new URL(base);if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash)throw Error()}catch{return new Map<number,{url:string;attribution:string;source:string}>()}
 const rows=await db.execute(sql`SELECT DISTINCT ON(c.issue_id) c.issue_id,c.renditions,c.attribution,c.source_url FROM ch_web.cover_cache c JOIN ch_web.source_permissions p ON p.provider=c.source_provider
 WHERE c.issue_id IN (${sql.join(ids.map(id=>sql`${id}`),sql`,`)}) AND c.status='CACHED' AND p.enabled AND p.display_allowed AND p.cache_allowed AND p.access_allowed AND p.revoked_at IS NULL AND p.valid_until>now() AND c.permission_expires_at>now() AND c.permission_reference=p.evidence_reference ORDER BY c.issue_id,c.updated_at DESC`);
 return new Map(rows.rows.flatMap(row=>{const key=(row.renditions as {card?:{key?:string}})?.card?.key;if(typeof key!=='string'||!/^comic-covers\/[A-Za-z0-9/%_.-]+$/.test(key)||key.includes('..'))return [];return [[Number(row.issue_id),{url:origin.href.replace(/\/$/,'')+'/'+key,attribution:String(row.attribution),source:String(row.source_url||'')}]] as [number,{url:string;attribution:string;source:string}][]}));
}
