// Imports the Metron cover-copy manifest (written by scripts/copy-metron-covers.mjs to
// <bucket>/metron/manifest.ndjson.gz) into ch_web.metron_cover_index, then links rows to
// catalog issues. Idempotent and time-bounded: used by scripts/import-metron-covers.ts
// (build) and the daily /api/cron/enrichment run.
import {gunzipSync} from 'node:zlib';
import {sql} from 'drizzle-orm';
import type {CatalogDb} from './catalog-store';
import {metronCoverCdnBase,normalizeIssueNumber,normalizeSeriesName,parseManifest,uniqueMatch,type MetronManifestRow} from './metron-cover-index';

export const METRON_MANIFEST_KEY='metron/manifest.ndjson.gz';
const MAX_MANIFEST_BYTES=200*1024*1024;
export type MetronImportOptions={budgetMs?:number;fetcher?:typeof fetch;env?:Record<string,string|undefined>;rematch?:boolean;batchSize?:number;log?:(line:string)=>void};
export type MetronImportResult={status:'disabled'|'table_missing'|'complete'|'partial';manifestRows:number;skippedLines:number;upserted:number;exact:number;named:number;ambiguous:number;unmatched:number;elapsedMs:number};

/** Manifest bytes: gzip (by magic number) or plain NDJSON. */
export function decodeManifest(bytes:Uint8Array){
 const buffer=Buffer.from(bytes);
 return (buffer[0]===0x1f&&buffer[1]===0x8b?gunzipSync(buffer,{maxOutputLength:MAX_MANIFEST_BYTES*4}):buffer).toString('utf8');
}
export async function fetchMetronManifest(base:string,fetcher:typeof fetch=fetch,timeoutMs=120000){
 const url=new URL(base+'/'+METRON_MANIFEST_KEY);if(url.protocol!=='https:')throw new Error('Metron cover manifest must be served over https.');
 const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{Accept:'application/gzip, application/x-ndjson, */*'}});
 if(!response.ok)throw new Error('Metron cover manifest unavailable (HTTP '+response.status+').');
 const length=Number(response.headers.get('content-length')||0);if(length>MAX_MANIFEST_BYTES)throw new Error('Metron cover manifest too large.');
 const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>MAX_MANIFEST_BYTES)throw new Error('Metron cover manifest too large.');
 return parseManifest(decodeManifest(bytes));
}

const fingerprint=(r:{series:unknown;volume:unknown;yearBegan:unknown;number:unknown;coverDate:unknown;coverHash:unknown;card:unknown;dense:unknown})=>{
 const rend=(v:unknown)=>{const o=(v&&typeof v==='object'?v:{}) as Record<string,unknown>;return [o.key??null,o.width??null,o.height??null]};
 return JSON.stringify([r.series??null,r.volume??null,r.yearBegan??null,r.number??null,r.coverDate??null,r.coverHash??null,rend(r.card),rend(r.dense)]);
};

async function upsertRows(db:CatalogDb,rows:MetronManifestRow[],deadline:number,batchSize:number){
 const existing=await db.execute(sql`SELECT metron_id,series,volume,year_began,number,cover_date::text AS cover_date,cover_hash,card,dense FROM ch_web.metron_cover_index`);
 const known=new Map(existing.rows.map(r=>[Number(r.metron_id),fingerprint({series:r.series,volume:r.volume,yearBegan:r.year_began,number:r.number,coverDate:r.cover_date,coverHash:r.cover_hash,card:r.card,dense:r.dense})]));
 const changed=rows.filter(row=>known.get(row.id)!==fingerprint(row));
 let upserted=0;
 for(let i=0;i<changed.length;i+=batchSize){
  if(Date.now()>deadline)return {upserted,complete:false};
  const batch=changed.slice(i,i+batchSize).map(r=>({metron_id:r.id,series:r.series,volume:r.volume,year_began:r.yearBegan,number:r.number,cover_date:r.coverDate,cover_hash:r.coverHash,card:r.card,dense:r.dense}));
  // A changed series/year/number clears a name match so it is re-evaluated; exact links stay.
  await db.execute(sql`INSERT INTO ch_web.metron_cover_index AS m(metron_id,series,volume,year_began,number,cover_date,cover_hash,card,dense)
   SELECT x.metron_id,x.series,x.volume,x.year_began,x.number,x.cover_date,x.cover_hash,x.card,x.dense
   FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS x(metron_id integer,series text,volume integer,year_began integer,number text,cover_date date,cover_hash text,card jsonb,dense jsonb)
   ON CONFLICT(metron_id) DO UPDATE SET series=excluded.series,volume=excluded.volume,year_began=excluded.year_began,number=excluded.number,cover_date=excluded.cover_date,
    cover_hash=excluded.cover_hash,card=excluded.card,dense=excluded.dense,imported_at=now(),
    issue_id=CASE WHEN COALESCE(m.match_method,'') LIKE 'exact%' OR (m.series,m.year_began,m.number) IS NOT DISTINCT FROM (excluded.series,excluded.year_began,excluded.number) THEN m.issue_id ELSE NULL END,
    match_method=CASE WHEN COALESCE(m.match_method,'') LIKE 'exact%' OR (m.series,m.year_began,m.number) IS NOT DISTINCT FROM (excluded.series,excluded.year_began,excluded.number) THEN m.match_method ELSE NULL END`);
  upserted+=batch.length;
 }
 return {upserted,complete:true};
}

/** Exact links first: a catalog row that already carries this Metron id, then a cached Metron lookup that named its GCD id. */
async function exactLinks(db:CatalogDb){
 const catalog=await db.execute(sql`UPDATE ch_web.metron_cover_index m SET match_method='exact_catalog',
   issue_id=CASE WHEN c.gcd_id IS NOT NULL AND EXISTS(SELECT 1 FROM gcd.gcd_issue i WHERE i.id=c.gcd_id AND COALESCE(i.deleted,0)=0) THEN 4000000000::bigint+c.gcd_id ELSE c.id END
  FROM ch_web.catalog_issues c WHERE c.metron_id=m.metron_id AND m.match_method IS DISTINCT FROM 'exact_catalog'`);
 let lookup={rowCount:0} as {rowCount?:number|null};
 try{
  lookup=await db.execute(sql`UPDATE ch_web.metron_cover_index m SET match_method='exact_metron_lookup',issue_id=4000000000::bigint+x.gcd_id
   FROM (SELECT DISTINCT ON(metron_id) metron_id,gcd_id FROM (SELECT (e->>'metronId')::integer AS metron_id,(e->>'gcdId')::bigint AS gcd_id
     FROM ch_web.metron_identifier_lookups l CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(l.candidates)='array' THEN l.candidates ELSE '[]'::jsonb END) e
     WHERE (e->>'metronId') ~ '^[0-9]{1,9}$' AND (e->>'gcdId') ~ '^[0-9]{1,10}$') c ORDER BY metron_id,gcd_id) x
   JOIN gcd.gcd_issue i ON i.id=x.gcd_id AND COALESCE(i.deleted,0)=0
   WHERE m.metron_id=x.metron_id AND COALESCE(m.match_method,'') NOT LIKE 'exact%'`);
 }catch{/* Migration 025 not applied: no barcode lookups to use. */}
 return Number(catalog.rowCount||0)+Number(lookup.rowCount||0);
}

type SeriesIndex=Map<string,number[]>;
async function loadSeriesIndex(db:CatalogDb):Promise<SeriesIndex>{
 // to_jsonb keeps this readable on snapshots/fixtures that omit year_began.
 const rows=await db.execute(sql`SELECT s.id,s.name,CASE WHEN COALESCE(to_jsonb(s)->>'year_began','') ~ '^[0-9]{4}$' THEN (to_jsonb(s)->>'year_began')::integer END AS year_began FROM gcd.gcd_series s WHERE COALESCE(s.deleted,0)=0`);
 const index:SeriesIndex=new Map();
 for(const row of rows.rows){const name=normalizeSeriesName(row.name),year=Number(row.year_began);if(!name||!Number.isInteger(year)||!year)continue;const key=name+'|'+year;const list=index.get(key);if(list)list.push(Number(row.id));else index.set(key,[Number(row.id)])}
 return index;
}
export type NameCandidate={metronId:number;series:string|null;yearBegan:number|null;number:string|null};
export type GcdIssueRow={id:number;seriesId:number;number:string|null};
/** Pure name matcher: normalized series + series year_began + normalized number, unique only. */
export function matchByName(rows:NameCandidate[],series:SeriesIndex,issues:GcdIssueRow[]){
 const bySeries=new Map<number,GcdIssueRow[]>();for(const issue of issues){const list=bySeries.get(issue.seriesId);if(list)list.push(issue);else bySeries.set(issue.seriesId,[issue])}
 return rows.map(row=>{
  const number=normalizeIssueNumber(row.number),ids=row.yearBegan?series.get(normalizeSeriesName(row.series)+'|'+row.yearBegan)||[]:[];
  const candidates=number?ids.flatMap(id=>(bySeries.get(id)||[]).filter(issue=>normalizeIssueNumber(issue.number)===number).map(issue=>4000000000+issue.id)):[];
  const issueId=uniqueMatch(candidates);
  return {metronId:row.metronId,issueId,method:issueId?'name':new Set(candidates).size>1?'ambiguous':'unmatched'};
 });
}
export function seriesIdsFor(rows:NameCandidate[],series:SeriesIndex){return [...new Set(rows.flatMap(row=>row.yearBegan?series.get(normalizeSeriesName(row.series)+'|'+row.yearBegan)||[]:[]))]}

async function nameMatches(db:CatalogDb,deadline:number,batchSize:number){
 let series:SeriesIndex|null=null,cursor=0;const totals={named:0,ambiguous:0,unmatched:0};
 for(;;){
  if(Date.now()>deadline)return {...totals,complete:false};
  const pending=(await db.execute(sql`SELECT metron_id,series,year_began,number FROM ch_web.metron_cover_index WHERE issue_id IS NULL AND match_method IS NULL AND metron_id>${cursor} ORDER BY metron_id LIMIT ${batchSize}`)).rows
   .map(r=>({metronId:Number(r.metron_id),series:r.series as string|null,yearBegan:r.year_began===null?null:Number(r.year_began),number:r.number as string|null}));
  if(!pending.length)break;cursor=pending[pending.length-1].metronId;
  series??=await loadSeriesIndex(db);
  const seriesIds=seriesIdsFor(pending,series);
  const issues=seriesIds.length?(await db.execute(sql`SELECT id,series_id,number FROM gcd.gcd_issue WHERE series_id IN (${sql.join(seriesIds.map(id=>sql`${id}`),sql`,`)}) AND COALESCE(deleted,0)=0 AND variant_of_id IS NULL`)).rows
   .map(r=>({id:Number(r.id),seriesId:Number(r.series_id),number:r.number as string|null})):[];
  const results=matchByName(pending,series,issues);
  for(const r of results)totals[r.method==='name'?'named':r.method as 'ambiguous'|'unmatched']++;
  await db.execute(sql`UPDATE ch_web.metron_cover_index m SET issue_id=x.issue_id,match_method=x.method
   FROM jsonb_to_recordset(${JSON.stringify(results.map(r=>({metron_id:r.metronId,issue_id:r.issueId,method:r.method})))}::jsonb) AS x(metron_id integer,issue_id bigint,method text)
   WHERE m.metron_id=x.metron_id AND m.issue_id IS NULL AND m.match_method IS NULL`);
 }
 // Uniqueness in the other direction: two Metron rows claiming one catalog issue by name are both dropped
 // (an exact link to that issue is kept).
 await db.execute(sql`UPDATE ch_web.metron_cover_index SET issue_id=NULL,match_method='ambiguous_issue'
  WHERE match_method='name' AND issue_id IN (SELECT issue_id FROM ch_web.metron_cover_index WHERE issue_id IS NOT NULL GROUP BY issue_id HAVING count(*)>1)`);
 return {...totals,complete:true};
}

export async function importMetronCovers(db:CatalogDb,options:MetronImportOptions={}):Promise<MetronImportResult>{
 const started=Date.now(),deadline=started+(options.budgetMs??10*60000),batchSize=options.batchSize??1000,log=options.log||(()=>undefined);
 const result:MetronImportResult={status:'disabled',manifestRows:0,skippedLines:0,upserted:0,exact:0,named:0,ambiguous:0,unmatched:0,elapsedMs:0};
 const done=(status:MetronImportResult['status'])=>({...result,status,elapsedMs:Date.now()-started});
 const base=metronCoverCdnBase(options.env||process.env);if(!base)return done('disabled');
 const present=await db.execute(sql`SELECT to_regclass('ch_web.metron_cover_index') IS NOT NULL AS t,to_regclass('gcd.gcd_issue') IS NOT NULL AND to_regclass('gcd.gcd_series') IS NOT NULL AS g`);
 if(present.rows[0]?.t!==true)return done('table_missing');
 const manifest=await fetchMetronManifest(base,options.fetcher,Math.max(5000,Math.min(120000,deadline-Date.now())));
 result.manifestRows=manifest.rows.length;result.skippedLines=manifest.skipped;log(`manifest: ${manifest.rows.length} covers (${manifest.skipped} invalid lines skipped)`);
 const upsert=await upsertRows(db,manifest.rows,deadline,batchSize);result.upserted=upsert.upserted;log(`upserted ${upsert.upserted} new/changed rows`);
 if(!upsert.complete)return done('partial');
 if(present.rows[0]?.g!==true){log('GCD tables missing; matching skipped');return done('partial')}
 if(options.rematch)await db.execute(sql`UPDATE ch_web.metron_cover_index SET match_method=NULL WHERE issue_id IS NULL AND match_method IN ('unmatched','ambiguous','ambiguous_issue')`);
 result.exact=await exactLinks(db);log(`exact links set: ${result.exact}`);
 const named=await nameMatches(db,deadline,Math.min(batchSize,500));
 Object.assign(result,{named:named.named,ambiguous:named.ambiguous,unmatched:named.unmatched});
 log(`name matches: ${named.named} unique, ${named.ambiguous} ambiguous, ${named.unmatched} unmatched`);
 return done(named.complete?'complete':'partial');
}
