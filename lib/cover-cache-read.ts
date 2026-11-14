import {sql} from 'drizzle-orm';
import type {CatalogDb} from './catalog-store';
import {metronConfig,metronImageUrl} from './metron-config';
import {metronCdnCovers} from './metron-cover-index';
type Ready=Map<number,{url:string;attribution:string;source:string}>;
/** Small read path: no AWS SDK, provider calls, queue work or model imports. */
export async function readyCachedCoverRows(db:CatalogDb,ids:number[]):Promise<Ready>{
 const ready:Ready=new Map();if(!ids.length)return ready;
 const list=sql.join(ids.map(id=>sql`${id}`),sql`,`),base=process.env.COVER_CDN_BASE_URL;
 let origin:URL|null=null;try{if(base){origin=new URL(base);if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash)origin=null}}catch{origin=null}
 if(origin){
  const rows=await db.execute(sql`SELECT DISTINCT ON(c.issue_id) c.issue_id,c.renditions,c.attribution,c.source_url FROM ch_web.cover_cache c JOIN ch_web.source_permissions p ON p.provider=c.source_provider
  WHERE c.issue_id IN (${list}) AND c.status='CACHED' AND p.enabled AND p.display_allowed AND p.cache_allowed AND p.access_allowed AND p.revoked_at IS NULL AND p.valid_until>now() AND c.permission_expires_at>now() AND c.permission_reference=p.evidence_reference ORDER BY c.issue_id,c.updated_at DESC`);
  for(const row of rows.rows){const key=(row.renditions as {card?:{key?:string}})?.card?.key;if(typeof key!=='string'||!/^comic-covers\/[A-Za-z0-9/%_.-]+$/.test(key)||key.includes('..'))continue;ready.set(Number(row.issue_id),{url:origin.href.replace(/\/$/,'')+'/'+key,attribution:String(row.attribution),source:String(row.source_url||'')})}
 }
 // Owner's permanent copy of Metron's cover on its own CDN (METRON_COVER_CDN_BASE; never throws).
 const uncached=ids.filter(id=>!ready.has(id));
 if(uncached.length)for(const [id,cover] of await metronCdnCovers(db,uncached))ready.set(id,{url:cover.url,attribution:cover.attribution,source:cover.source});
 // Interim owner-enabled mode: Metron's own image URL, never a guessed path.
 if(metronConfig().directCovers){
  const missing=ids.filter(id=>!ready.has(id));
  if(missing.length)try{
   const rows=await db.execute(sql`SELECT issue_id,source_url,attribution FROM ch_web.cover_cache WHERE issue_id IN (${sql.join(missing.map(id=>sql`${id}`),sql`,`)}) AND source_provider='METRON' AND source_cover_id='direct' AND status='CACHED' AND permission_expires_at>now()`);
   for(const row of rows.rows){const url=metronImageUrl(row.source_url);if(url)ready.set(Number(row.issue_id),{url,attribution:String(row.attribution),source:'https://metron.cloud/'})}
  }catch{/* Migration 025 not applied yet. */}
 }
 return ready;
}
