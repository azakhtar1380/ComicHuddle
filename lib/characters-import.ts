// Character data import (migration 030): links every harvested Metron issue to a catalog issue,
// loads the crawler's cache files (.metron-cache/characters/*.ndjson), stores Wikidata facts,
// then derives character_issues, merges Wikidata-only characters into their Metron twins and
// recomputes which first-appearance facts are shown. Idempotent; safe to re-run.
import {createReadStream,existsSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {sql} from 'drizzle-orm';
import type {CatalogDb} from './catalog-store';
import {matchByName,seriesIdsFor,type NameCandidate} from './metron-cover-import';
import {normalizeIssueNumber,normalizeSeriesName} from './metron-cover-index';
import {characterSearchText,firstAppearanceFromDesc,sameIssueRef,storeIssueDetails,wikidataCharacterId,type MetronCharacterDetail,type MetronIssueDetail,type MetronIssueRef} from './characters';
import {matchFactByName,matchFactViaMetron,type FactMatch,type GcdIssue,type GcdSeries,type MetronIndexEntry,type WikidataFact} from './characters-wikidata';

type Log=(line:string)=>void;
const chunks=<T,>(list:T[],size:number)=>Array.from({length:Math.ceil(list.length/size)},(_,i)=>list.slice(i*size,i*size+size));
export async function* ndjson<T=unknown>(file:string,fromByte=0):AsyncGenerator<{value:T;end:number}>{
 if(!existsSync(file))return;
 let offset=fromByte;
 const lines=createInterface({input:createReadStream(file,{encoding:'utf8',start:fromByte}),crlfDelay:Infinity});
 for await(const line of lines){
  offset+=Buffer.byteLength(line,'utf8')+1;
  if(!line.trim())continue;
  try{yield {value:JSON.parse(line) as T,end:offset}}catch{/* partial trailing line while the crawler writes */}
 }
}

// ---------- Metron issue -> catalog issue ----------
export type HarvestedIssue={id:number;series:string|null;volume:number|null;yearBegan:number|null;number:string|null;coverDate:string|null};
export function parseHarvestLine(raw:unknown):HarvestedIssue|null{
 const r=raw as Record<string,unknown>;if(!r||typeof r!=='object'||!Number.isSafeInteger(r.id)||(r.id as number)<=0||(r.id as number)>2147483647)return null;
 return {id:r.id as number,series:typeof r.series==='string'?r.series.slice(0,300):null,volume:Number.isInteger(r.volume)?r.volume as number:null,yearBegan:Number.isInteger(r.yearBegan)?r.yearBegan as number:null,
  number:typeof r.number==='string'?r.number.slice(0,40):null,coverDate:typeof r.coverDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(r.coverDate)?r.coverDate:null};
}
export async function readHarvest(file:string){const map=new Map<number,HarvestedIssue>();for await(const {value} of ndjson(file)){const e=parseHarvestLine(value);if(e)map.set(e.id,e)}return map}
export function metronNameIndex(harvest:Map<number,HarvestedIssue>){
 const index=new Map<string,MetronIndexEntry[]>();
 for(const e of harvest.values()){const k=normalizeSeriesName(e.series)+'|'+normalizeIssueNumber(e.number);const entry={metronId:e.id,series:e.series,number:e.number,coverYear:e.coverDate?Number(e.coverDate.slice(0,4)):null};const l=index.get(k);if(l)l.push(entry);else index.set(k,[entry])}
 return index;
}
async function seriesIndex(db:CatalogDb){
 const rows=await db.execute(sql`SELECT s.id,s.name,CASE WHEN COALESCE(to_jsonb(s)->>'year_began','') ~ '^[0-9]{4}$' THEN (to_jsonb(s)->>'year_began')::integer END AS year_began,
  CASE WHEN COALESCE(to_jsonb(s)->>'issue_count','') ~ '^[0-9]+$' THEN (to_jsonb(s)->>'issue_count')::integer ELSE 0 END AS issue_count FROM gcd.gcd_series s WHERE COALESCE(s.deleted,0)=0`);
 const byNameYear=new Map<string,number[]>(),byName=new Map<string,GcdSeries[]>();
 for(const r of rows.rows){
  const name=normalizeSeriesName(r.name);if(!name)continue;const year=r.year_began===null?null:Number(r.year_began);
  const s={id:Number(r.id),name:String(r.name),yearBegan:year,issueCount:Number(r.issue_count)||0};
  const l=byName.get(name);if(l)l.push(s);else byName.set(name,[s]);
  if(year){const k=name+'|'+year;const ids=byNameYear.get(k);if(ids)ids.push(s.id);else byNameYear.set(k,[s.id])}
 }
 return {byNameYear,byName};
}
async function gcdIssues(db:CatalogDb,seriesIds:number[]){
 const out:GcdIssue[]=[];
 for(const part of chunks(seriesIds,2000)){
  const r=await db.execute(sql`SELECT id,series_id,number,CASE WHEN key_date ~ '^[0-9]{4}' THEN substring(key_date,1,4)::integer END AS year FROM gcd.gcd_issue
   WHERE series_id IN (SELECT (e)::integer FROM jsonb_array_elements_text(${JSON.stringify(part)}::jsonb) e) AND COALESCE(deleted,0)=0 AND variant_of_id IS NULL`);
  for(const x of r.rows)out.push({id:Number(x.id),seriesId:Number(x.series_id),number:x.number as string|null,year:x.year===null?null:Number(x.year)});
 }
 return out;
}

/** Links all harvested Metron issues (exact cover-index links win), unique matches only. */
export async function linkMetronIssues(db:CatalogDb,harvest:Map<number,HarvestedIssue>,log:Log=()=>undefined){
 const {byNameYear}=await seriesIndex(db);
 const entries=[...harvest.values()].sort((a,b)=>a.id-b.id);
 const exact=new Map<number,{issueId:number;method:string}>();
 try{
  const r=await db.execute(sql`SELECT metron_id,issue_id,match_method FROM ch_web.metron_cover_index WHERE issue_id IS NOT NULL`);
  for(const x of r.rows)exact.set(Number(x.metron_id),{issueId:Number(x.issue_id),method:'cover_'+String(x.match_method||'name')});
 }catch{/* migration 029 missing */}
 try{
  const r=await db.execute(sql`SELECT metron_id,CASE WHEN gcd_id IS NOT NULL THEN 4000000000::bigint+gcd_id ELSE id END AS issue_id FROM ch_web.catalog_issues WHERE metron_id IS NOT NULL`);
  for(const x of r.rows)exact.set(Number(x.metron_id),{issueId:Number(x.issue_id),method:'exact_catalog'});
 }catch{/* no catalog_issues */}
 let named=0,linked=0;
 for(const batch of chunks(entries,3000)){
  const pending:NameCandidate[]=batch.filter(e=>!exact.has(e.id)).map(e=>({metronId:e.id,series:e.series,yearBegan:e.yearBegan,number:e.number}));
  const ids=seriesIdsFor(pending,byNameYear);
  const issues=ids.length?(await gcdIssues(db,ids)).map(i=>({id:i.id,seriesId:i.seriesId,number:i.number})):[];
  const matched=new Map(matchByName(pending,byNameYear,issues).map(m=>[m.metronId,m]));
  const rows=batch.map(e=>{const x=exact.get(e.id),m=matched.get(e.id);const issueId=x?.issueId??m?.issueId??null;if(issueId)linked++;if(!x&&m?.issueId)named++;
   return {metron_id:e.id,series:e.series,volume:e.volume,year_began:e.yearBegan,number:e.number,cover_date:e.coverDate,issue_id:issueId,match_method:x?.method??m?.method??'unmatched'}});
  await db.execute(sql`INSERT INTO ch_web.character_metron_issues AS l(metron_id,series,volume,year_began,number,cover_date,issue_id,match_method,updated_at)
   SELECT x.metron_id,x.series,x.volume,x.year_began,x.number,x.cover_date,x.issue_id,x.match_method,now()
   FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(metron_id integer,series text,volume integer,year_began integer,number text,cover_date date,issue_id bigint,match_method text)
   ON CONFLICT(metron_id) DO UPDATE SET series=excluded.series,volume=excluded.volume,year_began=excluded.year_began,number=excluded.number,cover_date=excluded.cover_date,issue_id=excluded.issue_id,match_method=excluded.match_method,updated_at=now()
   WHERE (l.series,l.volume,l.year_began,l.number,l.cover_date,l.issue_id,l.match_method) IS DISTINCT FROM (excluded.series,excluded.volume,excluded.year_began,excluded.number,excluded.cover_date,excluded.issue_id,excluded.match_method)`);
 }
 // Two Metron issues claiming one catalog issue by name: both dropped (exact links kept).
 const dropped=await db.execute(sql`UPDATE ch_web.character_metron_issues SET issue_id=NULL,match_method='ambiguous_issue'
  WHERE match_method='name' AND issue_id IN (SELECT issue_id FROM ch_web.character_metron_issues WHERE issue_id IS NOT NULL GROUP BY issue_id HAVING count(*)>1)`);
 log(`Metron issues: ${entries.length} harvested, ${linked} linked (${exact.size} exact/cover-index, ${named} by name), ${Number(dropped.rowCount||0)} dropped as duplicate claims`);
 return {harvested:entries.length,linked:linked-Number(dropped.rowCount||0),exact:exact.size,named};
}

// ---------- Wikidata facts ----------
export type WikidataInfo={sitelinks:number|null;aliases:string[];description:string|null};
export async function matchWikidataFacts(db:CatalogDb,facts:WikidataFact[],metronIndex:Map<string,MetronIndexEntry[]>){
 const out=new Map<string,FactMatch>();
 const gcdIds=[...new Set(facts.flatMap(f=>f.gcdIssueId?[f.gcdIssueId]:[]))];
 const valid=new Map<number,number>();
 for(const part of chunks(gcdIds,2000)){
  const r=await db.execute(sql`SELECT id,COALESCE(variant_of_id,id) AS main FROM gcd.gcd_issue WHERE id IN (SELECT (e)::integer FROM jsonb_array_elements_text(${JSON.stringify(part)}::jsonb) e) AND COALESCE(deleted,0)=0`);
  for(const x of r.rows)valid.set(Number(x.id),Number(x.main));
 }
 const {byName}=await seriesIndex(db);
 const seriesIds=[...new Set(facts.flatMap(f=>f.series.flatMap(s=>(byName.get(normalizeSeriesName(s))||[]).map(x=>x.id))))];
 const issuesBySeries=new Map<number,GcdIssue[]>();for(const i of await gcdIssues(db,seriesIds)){const l=issuesBySeries.get(i.seriesId);if(l)l.push(i);else issuesBySeries.set(i.seriesId,[i])}
 const viaMetron=new Map<string,number>();
 for(const f of facts){
  const g=f.gcdIssueId?valid.get(f.gcdIssueId):undefined;
  if(g){out.set(f.qid,{issueId:4000000000+g,method:'wikidata_gcd_id'});continue}
  const m=matchFactByName(f,byName,issuesBySeries);
  if(m.issueId){out.set(f.qid,m);continue}
  const metronId=matchFactViaMetron(f,metronIndex);
  if(metronId){viaMetron.set(f.qid,metronId);out.set(f.qid,{issueId:null,method:'metron_unlinked',metronId})}else out.set(f.qid,m);
 }
 if(viaMetron.size){
  const r=await db.execute(sql`SELECT metron_id,issue_id FROM ch_web.character_metron_issues WHERE issue_id IS NOT NULL AND metron_id IN (SELECT (e)::integer FROM jsonb_array_elements_text(${JSON.stringify([...viaMetron.values()])}::jsonb) e)`);
  const links=new Map(r.rows.map(x=>[Number(x.metron_id),Number(x.issue_id)]));
  for(const [q,m] of viaMetron){const issueId=links.get(m);if(issueId)out.set(q,{issueId,method:'via_metron',metronId:m})}
 }
 return out;
}
export async function storeWikidataFacts(db:CatalogDb,facts:WikidataFact[],matches:Map<string,FactMatch>,info:Map<string,WikidataInfo>){
 const rows=facts.flatMap(f=>{
  const id=wikidataCharacterId(f.qid);if(!id)return [];const m=matches.get(f.qid),i=info.get(f.qid);
  return [{id,qid:f.qid,name:f.name.slice(0,200),aliases:(i?.aliases||[]).slice(0,30),search:characterSearchText(f.name,i?.aliases||[]),description:i?.description??null,sitelinks:i?.sitelinks??null,
   ref:f.issueQid,issue_id:m?.issueId??null,metron_issue_id:m?.metronId??null,series:f.series[0]?.slice(0,300)??null,number:f.number?.slice(0,40)??null,year:f.years[0]??null,method:m?.method??'unmatched'}];
 });
 for(const part of chunks(rows,1000)){
  const json=JSON.stringify(part);
  await db.execute(sql`INSERT INTO ch_web.characters AS c(character_id,wikidata_qid,name,aliases,search_text,description,sitelinks,updated_at)
   SELECT x.id,x.qid,x.name,ARRAY(SELECT jsonb_array_elements_text(x.aliases)),x.search,x.description,x.sitelinks,now()
   FROM jsonb_to_recordset(${json}::jsonb) AS x(id integer,qid text,name text,aliases jsonb,search text,description text,sitelinks integer)
   ON CONFLICT(character_id) DO UPDATE SET name=excluded.name,aliases=excluded.aliases,search_text=excluded.search_text,description=excluded.description,sitelinks=excluded.sitelinks,updated_at=now()`);
  // The fact is stored on the Wikidata row and, once merged, on its Metron twin.
  await db.execute(sql`INSERT INTO ch_web.character_first_appearances AS f(character_id,source,source_ref,issue_id,metron_issue_id,series,number,year,match_method,updated_at)
   SELECT COALESCE(c.merged_into,x.id),'wikidata',x.ref,x.issue_id,x.metron_issue_id,x.series,x.number,x.year,x.method,now()
   FROM jsonb_to_recordset(${json}::jsonb) AS x(id integer,ref text,issue_id bigint,metron_issue_id integer,series text,number text,year integer,method text)
   JOIN ch_web.characters c ON c.character_id=x.id
   ON CONFLICT(character_id,source) DO UPDATE SET source_ref=excluded.source_ref,issue_id=excluded.issue_id,metron_issue_id=excluded.metron_issue_id,series=excluded.series,number=excluded.number,year=excluded.year,match_method=excluded.match_method,updated_at=now()`);
 }
 return rows.length;
}

// ---------- crawler cache files ----------
export type CrawlFiles={list:string;details:string;issueLists:string;issues:string};
export async function importCharacterList(db:CatalogDb,rows:{id:number;name:string;modified:string|null}[]){
 for(const part of chunks(rows,2000)){
  const json=JSON.stringify(part.map(r=>({id:r.id,name:r.name,search:characterSearchText(r.name),modified:r.modified&&!Number.isNaN(Date.parse(r.modified))?r.modified:null})));
  await db.execute(sql`INSERT INTO ch_web.characters AS c(character_id,metron_id,name,search_text,modified,updated_at)
   SELECT x.id,x.id,x.name,x.search,x.modified::timestamptz,now() FROM jsonb_to_recordset(${json}::jsonb) AS x(id integer,name text,search text,modified text)
   ON CONFLICT(character_id) DO UPDATE SET name=excluded.name,modified=excluded.modified,updated_at=now(),
    search_text=CASE WHEN c.detail_fetched_at IS NULL THEN excluded.search_text ELSE c.search_text END
   WHERE (c.name,c.modified) IS DISTINCT FROM (excluded.name,excluded.modified)`);
 }
 return rows.length;
}
export async function importCharacterDetails(db:CatalogDb,rows:MetronCharacterDetail[]){
 for(const part of chunks(rows,1000)){
  const json=JSON.stringify(part.map(d=>({id:d.id,name:d.name,aliases:d.aliases,search:characterSearchText(d.name,d.aliases),description:d.desc,image:d.image,modified:d.modified&&!Number.isNaN(Date.parse(d.modified))?d.modified:null})));
  await db.execute(sql`INSERT INTO ch_web.characters AS c(character_id,metron_id,name,aliases,search_text,description,image_url,modified,detail_fetched_at,updated_at)
   SELECT x.id,x.id,x.name,ARRAY(SELECT jsonb_array_elements_text(x.aliases)),x.search,x.description,x.image,x.modified::timestamptz,now(),now()
   FROM jsonb_to_recordset(${json}::jsonb) AS x(id integer,name text,aliases jsonb,search text,description text,image text,modified text)
   ON CONFLICT(character_id) DO UPDATE SET name=excluded.name,aliases=excluded.aliases,search_text=excluded.search_text,description=excluded.description,
    portrait_key=CASE WHEN c.image_url IS DISTINCT FROM excluded.image_url THEN NULL ELSE c.portrait_key END,
    image_url=excluded.image_url,modified=excluded.modified,detail_fetched_at=now(),updated_at=now()`);
 }
 return rows.length;
}
export type IssueListPage={characterId:number;page:number;count:number|null;results:MetronIssueRef[]};
/** First appearance from page 1 of a character's issue list (cover-date order), checked against the description. */
export function metronFirstAppearance(page:IssueListPage,desc:string|null){
 const first=page.results[0];if(!first)return null;
 const named=firstAppearanceFromDesc(desc);
 const tie=!!page.results[1]&&!!first.coverDate&&page.results[1].coverDate===first.coverDate;
 const confirmed=!!named&&sameIssueRef(named,first);
 const method=named?(confirmed?'metron_desc_confirmed':'metron_desc_conflict'):tie?'metron_issue_list_tie':'metron_issue_list';
 return {metronIssueId:first.id,series:first.series,number:first.number,year:first.coverDate?Number(first.coverDate.slice(0,4)):null,method};
}
export async function importIssueLists(db:CatalogDb,pages:IssueListPage[]){
 for(const part of chunks(pages,300)){
  const ids=[...new Set(part.map(p=>p.characterId))];
  const descs=new Map((await db.execute(sql`SELECT character_id,description FROM ch_web.characters WHERE character_id IN (SELECT (e)::integer FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb) e)`)).rows.map(r=>[Number(r.character_id),typeof r.description==='string'?r.description:null]));
  const pairs=part.flatMap(p=>p.results.map(r=>({c:p.characterId,m:r.id})));
  if(pairs.length)await db.execute(sql`INSERT INTO ch_web.character_appearances(character_id,metron_issue_id) SELECT x.c,x.m FROM jsonb_to_recordset(${JSON.stringify(pairs)}::jsonb) AS x(c integer,m integer) ON CONFLICT DO NOTHING`);
  const firsts=part.filter(p=>p.page===1).map(p=>({id:p.characterId,count:p.count,fa:metronFirstAppearance(p,descs.get(p.characterId)??null)}));
  if(!firsts.length)continue;
  await db.execute(sql`UPDATE ch_web.characters c SET issue_count=x.count,first_metron_issue_id=x.first,issues_fetched_at=now(),updated_at=now()
   FROM jsonb_to_recordset(${JSON.stringify(firsts.map(f=>({id:f.id,count:f.count,first:f.fa?.metronIssueId??null})))}::jsonb) AS x(id integer,count integer,first integer) WHERE c.character_id=x.id`);
  const facts=firsts.flatMap(f=>f.fa?[{id:f.id,...f.fa}]:[]);
  if(facts.length)await db.execute(sql`INSERT INTO ch_web.character_first_appearances AS f(character_id,source,source_ref,issue_id,metron_issue_id,series,number,year,match_method,updated_at)
   SELECT x.id,'metron',x."metronIssueId"::text,(SELECT l.issue_id FROM ch_web.character_metron_issues l WHERE l.metron_id=x."metronIssueId"),x."metronIssueId",x.series,x.number,x.year,x.method,now()
   FROM jsonb_to_recordset(${JSON.stringify(facts)}::jsonb) AS x(id integer,"metronIssueId" integer,series text,number text,year integer,method text)
   ON CONFLICT(character_id,source) DO UPDATE SET source_ref=excluded.source_ref,issue_id=excluded.issue_id,metron_issue_id=excluded.metron_issue_id,series=excluded.series,number=excluded.number,year=excluded.year,match_method=excluded.match_method,updated_at=now()`);
 }
 return pages.length;
}
export async function importIssueDetails(db:CatalogDb,rows:MetronIssueDetail[]){let n=0;for(const part of chunks(rows,200))n+=await storeIssueDetails(db,part);return n}

/** Derived data: link refresh, character_issues, Wikidata merges, which facts are shown. */
export async function finalizeCharacters(db:CatalogDb,log:Log=()=>undefined){
 await db.execute(sql`UPDATE ch_web.character_first_appearances f SET issue_id=l.issue_id FROM ch_web.character_metron_issues l
  WHERE f.source='metron' AND l.metron_id=f.metron_issue_id AND f.issue_id IS DISTINCT FROM l.issue_id`);
 await db.execute(sql`UPDATE ch_web.metron_issue_details d SET issue_id=l.issue_id FROM ch_web.character_metron_issues l WHERE l.metron_id=d.metron_id AND d.issue_id IS DISTINCT FROM l.issue_id`);
 // Wikidata-only characters -> the Metron character of the same name in that issue (unique).
 const merged=await db.execute(sql`WITH cand AS (
   SELECT w.character_id AS w,m.character_id AS m FROM ch_web.characters w
   JOIN ch_web.character_first_appearances f ON f.character_id=w.character_id AND f.source='wikidata' AND f.issue_id IS NOT NULL
   JOIN ch_web.characters m ON m.character_id>0 AND split_part(m.search_text,'|',2)=split_part(w.search_text,'|',2)
   WHERE w.character_id<0 AND w.merged_into IS NULL AND split_part(w.search_text,'|',2)<>''
    AND (EXISTS(SELECT 1 FROM ch_web.character_first_appearances mf WHERE mf.character_id=m.character_id AND mf.source='metron' AND mf.issue_id=f.issue_id)
     OR EXISTS(SELECT 1 FROM ch_web.character_issues ci WHERE ci.character_id=m.character_id AND ci.issue_id=f.issue_id))
  ), one AS (SELECT w,min(m) AS m FROM cand GROUP BY w HAVING count(DISTINCT m)=1),
  -- At most one Wikidata item per Metron character (the best known), and only while it has no Wikidata twin yet.
  uniq AS (SELECT DISTINCT ON(o.m) o.w,o.m FROM one o JOIN ch_web.characters x ON x.character_id=o.w JOIN ch_web.characters t ON t.character_id=o.m
   WHERE t.wikidata_qid IS NULL OR t.wikidata_qid=x.wikidata_qid ORDER BY o.m,x.sitelinks DESC NULLS LAST,o.w),
  facts AS (INSERT INTO ch_web.character_first_appearances AS f(character_id,source,source_ref,issue_id,metron_issue_id,series,number,year,match_method,updated_at)
   SELECT u.m,'wikidata',f.source_ref,f.issue_id,f.metron_issue_id,f.series,f.number,f.year,f.match_method,now() FROM uniq u JOIN ch_web.character_first_appearances f ON f.character_id=u.w AND f.source='wikidata'
   ON CONFLICT(character_id,source) DO UPDATE SET source_ref=excluded.source_ref,issue_id=excluded.issue_id,metron_issue_id=excluded.metron_issue_id,series=excluded.series,number=excluded.number,year=excluded.year,match_method=excluded.match_method,updated_at=now() RETURNING 1),
  twins AS (UPDATE ch_web.characters m SET wikidata_qid=w.wikidata_qid,sitelinks=w.sitelinks,updated_at=now() FROM uniq u JOIN ch_web.characters w ON w.character_id=u.w WHERE m.character_id=u.m RETURNING 1)
  UPDATE ch_web.characters w SET merged_into=u.m,updated_at=now() FROM uniq u WHERE w.character_id=u.w`);
 // Shown facts: Metron ties / description conflicts hidden; when a character has two facts on different
 // issues the earlier year wins; a little-known Wikidata-only character sharing its name with a
 // well-known one (an alternate version) is hidden when its fact points at a different issue.
 await db.execute(sql`UPDATE ch_web.character_first_appearances SET suppressed=(match_method IN ('metron_issue_list_tie','metron_desc_conflict')) WHERE suppressed IS DISTINCT FROM (match_method IN ('metron_issue_list_tie','metron_desc_conflict'))`);
 await db.execute(sql`UPDATE ch_web.character_first_appearances f SET suppressed=true FROM ch_web.character_first_appearances o
  WHERE o.character_id=f.character_id AND o.source<>f.source AND NOT o.suppressed AND o.issue_id IS NOT NULL AND f.issue_id IS NOT NULL AND o.issue_id<>f.issue_id
   AND (COALESCE(o.year,9999)<COALESCE(f.year,9999) OR (COALESCE(o.year,9999)=COALESCE(f.year,9999) AND o.source='metron'))`);
 await db.execute(sql`UPDATE ch_web.character_first_appearances f SET suppressed=true FROM ch_web.characters w
  WHERE w.character_id=f.character_id AND w.character_id<0 AND w.merged_into IS NULL AND COALESCE(w.sitelinks,0)<=3 AND f.issue_id IS NOT NULL
   AND EXISTS(SELECT 1 FROM ch_web.characters o JOIN ch_web.character_first_appearances of ON of.character_id=o.character_id AND NOT of.suppressed AND of.issue_id IS NOT NULL
    WHERE o.character_id<>w.character_id AND o.merged_into IS NULL AND split_part(o.search_text,'|',2)=split_part(w.search_text,'|',2) AND of.issue_id<>f.issue_id
     AND (COALESCE(o.issue_count,0)>=50 OR COALESCE(o.sitelinks,0)>=10))`);
 const issues=await db.execute(sql`INSERT INTO ch_web.character_issues(character_id,issue_id)
  SELECT a.character_id,l.issue_id FROM ch_web.character_appearances a JOIN ch_web.character_metron_issues l ON l.metron_id=a.metron_issue_id AND l.issue_id IS NOT NULL
  UNION SELECT f.character_id,f.issue_id FROM ch_web.character_first_appearances f JOIN ch_web.characters c ON c.character_id=f.character_id AND c.merged_into IS NULL WHERE f.issue_id IS NOT NULL AND NOT f.suppressed
  ON CONFLICT DO NOTHING`);
 const counts=(await db.execute(sql`SELECT (SELECT count(*) FROM ch_web.characters) AS characters,(SELECT count(*) FROM ch_web.characters WHERE character_id>0) AS metron,
  (SELECT count(*) FROM ch_web.characters WHERE portrait_key IS NOT NULL) AS portraits,(SELECT count(*) FROM ch_web.character_first_appearances WHERE issue_id IS NOT NULL AND NOT suppressed) AS facts,
  (SELECT count(DISTINCT issue_id) FROM ch_web.character_first_appearances WHERE issue_id IS NOT NULL AND NOT suppressed) AS key_issues,(SELECT count(*) FROM ch_web.character_issues) AS character_issues,
  (SELECT count(*) FROM ch_web.metron_issue_details) AS issue_details`)).rows[0];
 log(`finalized: ${Number(merged.rowCount||0)} Wikidata characters merged, ${Number(issues.rowCount||0)} new character/issue links; totals ${JSON.stringify(counts)}`);
 return counts;
}
