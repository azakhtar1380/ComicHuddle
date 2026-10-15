import {ilike,and,asc,desc,eq,inArray,isNotNull,like,sql} from 'drizzle-orm';
import {getDb} from '../db';
import {catalogCreators,catalogIssueCreators,catalogIssues,catalogPublishers,catalogSeries,catalogSync,catalogCoverReferences,directoryIssues,legacyDirectoryIssues} from '../db/schema';
import {withCatalogCovers} from './catalog-covers';
import {catalog,type Issue} from './catalog';
import {catalogSearchDto,searchCatalog} from './catalog-search';
import {catalogSearchText,eraForYear,metronDirectoryId,plainCatalogText} from './shared-catalog';

export type CatalogDb=ReturnType<typeof getDb>;
export type CatalogFilters={q:string;limit:number;offset:number;publisher?:string;series?:string;era?:string;kind?:string;sort?:string;after?:number};
export async function readableCatalog(_db:CatalogDb){return directoryIssues;}
async function loadCatalogOverview(db:CatalogDb){
 const cached=await db.execute(sql`SELECT metadata FROM gcd.comichuddle_catalog_read_state WHERE id='directory'`);
 if(cached.rows[0]?.metadata)return cached.rows[0].metadata as Awaited<ReturnType<typeof uncachedCatalogOverview>>;
 return uncachedCatalogOverview(db);
}
async function uncachedCatalogOverview(db:CatalogDb){
 const readCatalog=await readableCatalog(db);
 const native=await db.execute(sql`SELECT GREATEST(0,reltuples)::bigint AS raw_count FROM pg_class WHERE oid='gcd.gcd_issue'::regclass`);const nativeIssueCountEstimate=Number(native.rows[0]?.raw_count||0);
 const [counts]=await db.select({total:sql<number>`count(*)`.as('total_count'),imported:sql<number>`coalesce(sum(case when ${readCatalog.metronId} is not null then 1 else 0 end),0)`.as('metron_count'),gcd:sql<number>`coalesce(sum(case when ${readCatalog.gcdId} is not null then 1 else 0 end),0)`.as('gcd_count'),index:sql<number>`coalesce(sum(case when ${readCatalog.rawMetadata} like '%"metadataScope":"selected_series_issue_indexes"%' then 1 else 0 end),0)`.as('index_count'),lastGcd:sql<string|null>`max(case when ${readCatalog.gcdId} is not null then ${readCatalog.fetchedAt} else null end)`}).from(readCatalog);
 const publishers=await db.selectDistinct({name:readCatalog.publisher}).from(readCatalog).orderBy(asc(readCatalog.publisher));
 const [sync]=await db.select({state:catalogSync.state}).from(catalogSync).where(eq(catalogSync.id,'metron'));
 let lastSyncedAt:string|null=null;if(sync){try{lastSyncedAt=JSON.parse(sync.state).lastCompletedAt||null}catch{}}
 const coverResult=await db.execute(sql`SELECT (SELECT count(*) FROM gcd.comichuddle_cover_references WHERE status='active')+(SELECT count(*) FROM ch_web.catalog_issues WHERE gcd_id IS NULL AND data LIKE '%/covers/%') AS n`);const covers=coverResult.rows[0] as {n:number};
 const total=Number(counts?.total||0),imported=Number(counts?.imported||0),gcd=Number(counts?.gcd||0);
 return {scope:imported||gcd?'shared':'starter',issueCount:total||catalog.length,syncedIssueCount:imported,lastSyncedAt,gcdIssueCount:gcd,gcdIndexIssueCount:Number(counts?.index||0),coverIssueCount:Number(covers?.n||0),lastGcdSyncedAt:counts?.lastGcd||null,catalogSchema:'gcd',nativeIssueCountEstimate,nativeSnapshotStatus: 'All active native issue rows are accessible. Missing series or image metadata is labeled and does not hide records.',gcdCoverage:'All active issues in the native GCD snapshot, with incremental additions. Missing linked metadata is not inferred. Series-index records provide actual issue IDs and edition descriptors; missing issue dates, stories, credits and valuations are not inferred. Issue-specific cover references are enriched separately. No complete catalog or historical freshness claim.',publishers:total?publishers.flatMap(p=>p.name?[p.name]:[]):[...new Set(catalog.map(p=>p.publisher))].sort(),rights:[imported?'Metron metadata adapted and formatted under CC BY-SA 4.0.':null,gcd?'Bibliographic data from the Grand Comics Database, selected and formatted under CC BY-SA 4.0.':null,'Cover thumbnails identify editions. Artwork copyright stays with the respective publisher and artist; metadata licensing does not include artwork. Existing starter sources retain their credits. No FMV imported.'].filter(Boolean).join(' ')};
}
let overviewCache:{expires:number;value:ReturnType<typeof loadCatalogOverview>}|null=null;
export function catalogOverview(db:CatalogDb){
 if(process.env.VERCEL!=='1')return loadCatalogOverview(db);
 if(overviewCache&&overviewCache.expires>Date.now())return overviewCache.value;
 const value=loadCatalogOverview(db);overviewCache={expires:Date.now()+30000,value};void value.catch(()=>{if(overviewCache?.value===value)overviewCache=null});return value;
}
function directoryIssueData(data:string):Issue{
 const issue=JSON.parse(data) as Issue,b=issue.bibliography;
 if(b){const limits:Record<string,number>={issueTitle:1000,editing:2000,keywords:2000};const next={...b};for(const key of ['publicationDate','keyDate','onSaleDate','pageCount','isbn','barcode','issueTitle','volume','indiciaPublisher','brandEmblem','rating','indiciaFrequency','indiciaPrinter','keywords','editing'] as const)next[key]=plainCatalogText(b[key],limits[key]||400);next.originalCoverPrice={kind:'ORIGINAL_COVER_PRICE',text:plainCatalogText(b.originalCoverPrice?.text,400)};issue.bibliography=next;}
 return issue;
}
export async function catalogIssuesById(db:CatalogDb,ids:number[]):Promise<Issue[]>{
 if(!ids.length)return [];
 const nativeIds=ids.filter(id=>id>=4000000000).map(id=>id-4000000000);
 const [native,legacy]=await Promise.all([
  nativeIds.length?db.execute(sql`SELECT id,data FROM gcd.comichuddle_native_directory WHERE id IN (${sql.join(ids.filter(id=>id>=4000000000).map(id=>sql`${id}`),sql`,`)})`):Promise.resolve({rows:[]}),
  db.select({id:legacyDirectoryIssues.id,data:legacyDirectoryIssues.data}).from(legacyDirectoryIssues).where(inArray(legacyDirectoryIssues.id,ids)),
 ]);
 const byId=new Map<number,Issue>();
 for(const row of legacy)byId.set(Number(row.id),directoryIssueData(row.data!));
 for(const row of native.rows)byId.set(Number(row.id),directoryIssueData(String(row.data)));
 const issues=ids.flatMap(id=>{const issue=byId.get(id)||catalog.find(issue=>issue.id===id);return issue?[issue]:[]});
 return withCatalogCovers(db,issues);
}
export async function catalogIssue(db:CatalogDb,id:number):Promise<Issue|undefined>{return (await catalogIssuesById(db,[id]))[0];}
export async function searchSharedCatalog(db:CatalogDb,filter:CatalogFilters){
 const readCatalog=await readableCatalog(db);
 const meta=await catalogOverview(db);
 if(!meta.issueCount){
   const base=searchCatalog(filter.q,catalog.length,0).issues.filter(i=>(!filter.publisher||i.publisher===filter.publisher)&&(!filter.series||i.title===filter.series)&&(!filter.era||i.era===filter.era)&&(!filter.kind||i.kind===filter.kind));
  base.sort((a,b)=>filter.sort==='title'?a.title.localeCompare(b.title)||a.id-b.id:filter.sort==='oldest'?a.year-b.year||a.id-b.id:filter.sort==='newest'?b.year-a.year||a.id-b.id:a.id-b.id);
  return {...meta,issues:base.slice(filter.offset,filter.offset+filter.limit),total:base.length,limit:filter.limit,offset:filter.offset,hasMore:filter.offset+filter.limit<base.length};
 }
 const numbers=[...filter.q.matchAll(/#\s*([a-z0-9./-]+)/gi)].map(m=>m[1].toLowerCase());
 const words=filter.q.replace(/#\s*([a-z0-9./-]+)/gi,' ').normalize('NFKD').toLowerCase().match(/[a-z0-9]+/g)||[];
 const terms=[...numbers.map(n=>sql`lower(${readCatalog.number}) = ${n}`),...words.map(w=>like(readCatalog.searchText,'%'+w+'%'))];
 if(filter.publisher)terms.push(eq(readCatalog.publisher,filter.publisher));
  if(filter.series)terms.push(eq(readCatalog.title,filter.series));
 if(filter.era)terms.push(eq(readCatalog.era,filter.era));
 if(filter.kind)terms.push(eq(readCatalog.kind,filter.kind));
 const nativeTerms=(alias:string)=>{
  const ref=(column:string)=>sql.raw(alias+'.'+column);
  const result=[...numbers.map(n=>sql`lower(${ref('number')})=${n}`),...words.map(w=>sql`${ref('search_text')} LIKE ${'%'+w+'%'}`)];
  if(filter.publisher)result.push(sql`${ref('publisher')}=${filter.publisher}`);
  if(filter.series)result.push(sql`${ref('title')}=${filter.series}`);
  if(filter.era)result.push(sql`${ref('era')}=${filter.era}`);
  if(filter.kind)result.push(sql`${ref('kind')}=${filter.kind}`);
  return result.length?sql.join(result,sql` AND `):sql`true`;
 };
 const state=await db.execute(sql`SELECT retained_ids FROM gcd.comichuddle_catalog_read_state WHERE id='directory'`);
 const retained=Array.isArray(state.rows[0]?.retained_ids)?state.rows[0].retained_ids.map(Number).filter(Number.isSafeInteger):[];
 const retainedGcd=retained.filter(id=>id>=4000000000).map(id=>id-4000000000);
 const excluded=retainedGcd.length?sql`AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY[${sql.join(retainedGcd.map(id=>sql`${id}`),sql`,`)}]::bigint[]) excluded(gcd_id) WHERE excluded.gcd_id=n.gcd_id)`:sql``;
 const extra=retained.length?sql`SELECT e.id,e.title,e.year FROM gcd.comichuddle_legacy_directory e WHERE e.id IN (${sql.join(retained.map(id=>sql`${id}`),sql`,`)}) AND ${nativeTerms('e')}`:sql`SELECT 0::bigint AS id,''::text AS title,0 AS year WHERE false`;
 let nativeBase=sql`SELECT n.id,n.title,n.year FROM gcd.comichuddle_native_directory n WHERE ${nativeTerms('n')} ${excluded}`;
 if((!filter.sort||filter.sort==='featured')&&!filter.era&&!filter.kind){
  const rawTerms=[sql`(i.deleted=0 OR i.deleted IS NULL)`,...numbers.map(n=>sql`lower(i.number)=${n}`)];
  if(retainedGcd.length)rawTerms.push(sql`NOT EXISTS(SELECT 1 FROM unnest(ARRAY[${sql.join(retainedGcd.map(id=>sql`${id}`),sql`,`)}]::bigint[]) excluded(gcd_id) WHERE excluded.gcd_id=i.id)`);
  if(words.length||filter.publisher||filter.series){
   const st=words.map(w=>sql`lower(s.name) LIKE ${'%'+w+'%'}`);
   if(filter.publisher)st.push(sql`p.name=${filter.publisher}`);
   if(filter.series)st.push(sql`s.name=${filter.series}`);
   const candidates=await db.execute(sql`SELECT s.id FROM gcd.gcd_series s LEFT JOIN gcd.gcd_publisher p ON p.id=s.publisher_id WHERE COALESCE(s.deleted,0)=0 AND ${st.length?sql.join(st,sql` AND `):sql`true`}`);
   const known=await db.execute(sql`SELECT e.gcd_id FROM gcd.comichuddle_legacy_directory e WHERE e.gcd_id IS NOT NULL AND ${nativeTerms('e')}`);
   const seriesIds=candidates.rows.map(row=>Number(row.id)),knownIds=known.rows.map(row=>Number(row.gcd_id));
   const matches=[];
   if(seriesIds.length)matches.push(sql`i.series_id IN (${sql.join(seriesIds.map(id=>sql`${id}`),sql`,`)})`);
   if(knownIds.length)matches.push(sql`i.id IN (${sql.join(knownIds.map(id=>sql`${id}`),sql`,`)})`);
   if(words.length&&!filter.publisher&&!filter.series)matches.push(sql.join(words.map(w=>sql`lower(i.title) LIKE ${'%'+w+'%'}`),sql` AND `));
   rawTerms.push(matches.length?sql`(${sql.join(matches,sql` OR `)})`:sql`false`);
  }
  nativeBase=sql`SELECT 4000000000::bigint+i.id AS id,''::text AS title,0 AS year FROM gcd.gcd_issue i WHERE ${sql.join(rawTerms,sql` AND `)}`;
 }
 const base=sql`${nativeBase} UNION ALL ${extra}`;
 const filtered=!!(filter.q||filter.publisher||filter.series||filter.era||filter.kind);
 const countTask=filtered?db.execute(sql`SELECT count(*)::bigint AS n FROM (${base}) matches`):Promise.resolve({rows:[{n:meta.issueCount}]});
 const order=filter.sort==='title'?sql`title,id`:filter.sort==='oldest'?sql`year,id`:filter.sort==='newest'?sql`year DESC,id`:sql`id`;
 const cursor=filter.after===undefined?sql``:sql`WHERE id>${filter.after}`;
 const [count,selection]=await Promise.all([countTask,db.execute(sql`SELECT id FROM (${base}) matches ${cursor} ORDER BY ${order} LIMIT ${filter.limit+1} OFFSET ${filter.after===undefined?filter.offset:0}`)]);
 const selected=selection.rows.slice(0,filter.limit).map(row=>Number(row.id));
 const issues=await catalogIssuesById(db,selected);
 return {...meta,issues:issues.flatMap(issue=>issue?[catalogSearchDto(issue)]:[]),total:Number(count.rows[0]?.n||0),limit:filter.limit,offset:filter.offset,hasMore:selection.rows.length>filter.limit};
}

// A bounded publisher > series tree. Never download the entire catalog to a browser.
export async function browseSharedSeries(db:CatalogDb,filter:{publisher:string;q:string;limit:number;offset:number}){
 const rows=await db.execute(sql`WITH native_series AS (
  SELECT s.name AS title,p.name AS publisher,
   CASE WHEN COALESCE(to_jsonb(s)->>'issue_count','') ~ '^[0-9]+$' THEN (to_jsonb(s)->>'issue_count')::bigint ELSE 0 END AS count,
   CASE WHEN COALESCE(to_jsonb(s)->>'year_began','') ~ '^[0-9]{4}$' THEN (to_jsonb(s)->>'year_began')::integer ELSE 0 END AS first_year,
   CASE WHEN COALESCE(to_jsonb(s)->>'year_ended','') ~ '^[0-9]{4}$' THEN (to_jsonb(s)->>'year_ended')::integer ELSE 0 END AS last_year
  FROM gcd.gcd_series s JOIN gcd.gcd_publisher p ON p.id=s.publisher_id WHERE COALESCE(s.deleted,0)=0
 ), retained AS (
  SELECT c.title,c.publisher,count(*)::bigint AS count,min(c.year)::integer AS first_year,max(c.year)::integer AS last_year
  FROM ch_web.catalog_issues c WHERE c.publisher=${filter.publisher} AND NOT EXISTS(SELECT 1 FROM native_series n WHERE n.title=c.title AND n.publisher=c.publisher)
  GROUP BY c.title,c.publisher
 ), available AS(SELECT * FROM native_series UNION ALL SELECT * FROM retained)
 SELECT title,publisher,count,first_year,last_year,count(*) OVER()::bigint AS total
 FROM available WHERE publisher=${filter.publisher} AND title ILIKE ${'%'+filter.q+'%'} ORDER BY title LIMIT ${filter.limit} OFFSET ${filter.offset}`);
 const series=rows.rows.map(row=>({title:String(row.title),publisher:String(row.publisher),count:Number(row.count),firstYear:Number(row.first_year),lastYear:Number(row.last_year)}));
 return {series,total:Number(rows.rows[0]?.total||0),limit:filter.limit,offset:filter.offset,hasMore:filter.offset+series.length<Number(rows.rows[0]?.total||0)};
}

export function seedStarterStatements(db:CatalogDb,stamp:string){
 return catalog.map(issue=>db.insert(catalogIssues).values({id:issue.id,title:issue.title,number:issue.number,publisher:issue.publisher,year:issue.year,era:issue.era,kind:issue.kind,searchText:catalogSearchText(issue),data:JSON.stringify(issue),fetchedAt:stamp}).onConflictDoNothing());
}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const providerId=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0&&value<=2147483647?value:null;
const name=(value:unknown,max=160)=>plainCatalogText(value,max);
export function normalizeMetronRecord(raw:unknown,stamp:string,secret=''){
 if(!object(raw)||!object(raw.series)||!providerId(raw.id)||!providerId(raw.series.id))throw new Error('Metron returned an invalid issue identity.');
 const title=name(raw.series.name,120),number=name(raw.number,24);
 if(!title||!number||typeof raw.modified!=='string'||!Number.isFinite(Date.parse(raw.modified)))throw new Error('Metron returned incomplete issue metadata.');
 const serialized=JSON.stringify(raw);
 if(serialized.length>256000||secret&&serialized.includes(secret))throw new Error('Metron returned unsafe or oversized issue metadata.');
 const sourceModified=new Date(raw.modified).toISOString(),id=raw.id as number,seriesId=raw.series.id as number;
 const publisher=object(raw.publisher)?raw.publisher:object(raw.series.publisher)?raw.series.publisher:null;
 const publisherId=publisher?providerId(publisher.id):null,publisherName=publisher?name(publisher.name):'';
 const yearDate=[raw.cover_date,raw.store_date].find(v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v)));
 const year=typeof yearDate==='string'?Number(yearDate.slice(0,4)):0;
 const seriesYear=typeof raw.series.year_began==='number'&&Number.isInteger(raw.series.year_began)?raw.series.year_began:null;
 const volume=typeof raw.series.volume==='number'&&Number.isInteger(raw.series.volume)&&raw.series.volume>0?raw.series.volume:null;
 const creators=new Map<number,{id:number;name:string}>(),credits:{creatorId:number;role:string}[]=[];
 const roleNames=new Map<string,string[]>();
 for(const credit of Array.isArray(raw.credits)?raw.credits.slice(0,100):[]){
  if(!object(credit)||!object(credit.creator))continue;const cid=providerId(credit.creator.id),cname=name(credit.creator.name);if(!cid||!cname)continue;
  creators.set(cid,{id:cid,name:cname});
  for(const role of Array.isArray(credit.role)?credit.role.slice(0,15):[]){if(!object(role))continue;const text=name(role.name,60);if(!text)continue;credits.push({creatorId:cid,role:text});const k=text.toLowerCase();roleNames.set(k,[...new Set([...(roleNames.get(k)||[]),cname])]);}
 }
 const roleText=(patterns:RegExp[])=>[...new Set([...roleNames].filter(([r])=>patterns.some(p=>p.test(r))).flatMap(([,n])=>n))].join(', ').slice(0,400)||'Not recorded';
 const characters=(Array.isArray(raw.characters)?raw.characters:[]).slice(0,100).flatMap(c=>object(c)&&name(c.name)?[name(c.name)]:[]);
 const issue:Issue={id:metronDirectoryId(id),metronId:id,title:title+(seriesYear?' ('+seriesYear+')':''),number,publisher:publisherName||'Publisher not recorded',year,era:year?eraForYear(year):'Date not recorded',characters,writer:roleText([/writ/,/script/]),artist:roleText([/pencil/,/interior/,/^art$/, /^artist$/]),coverArtist:roleText([/cover/]),note:name(raw.desc,1000)||'Bibliographic issue record. Confirm the physical edition and printing.',kind:'Catalog issue',variant:(volume?'Series volume '+volume+'. ':'')+'Issue record · printing must be confirmed',source:'https://metron.cloud/issue/'+id+'/',dataCredit:'Metadata from Metron; formatted, text shortened and bibliographic fields selected by ComicHuddle',dataLicense:'https://creativecommons.org/licenses/by-sa/4.0/'};
 return {issue,publisherId,publisherName,seriesId,seriesName:title,seriesYear,volume,creators:[...creators.values()],credits:[...new Map(credits.map(c=>[c.creatorId+':'+c.role,c])).values()],sourceModified,stamp,rawMetadata:serialized};
}
export function metronRecordStatements(db:CatalogDb,record:ReturnType<typeof normalizeMetronRecord>){
 const {issue}=record,statements=[];
 if(record.publisherId)statements.push(db.insert(catalogPublishers).values({metronId:record.publisherId,name:record.publisherName||issue.publisher}).onConflictDoUpdate({target:catalogPublishers.metronId,set:{name:record.publisherName||issue.publisher}}));
 statements.push(db.insert(catalogSeries).values({metronId:record.seriesId,publisherId:record.publisherId,name:record.seriesName,yearBegan:record.seriesYear,volume:record.volume}).onConflictDoUpdate({target:catalogSeries.metronId,set:{publisherId:record.publisherId,name:record.seriesName,yearBegan:record.seriesYear,volume:record.volume}}));
 for(const c of record.creators)statements.push(db.insert(catalogCreators).values({metronId:c.id,name:c.name}).onConflictDoUpdate({target:catalogCreators.metronId,set:{name:c.name}}));
 const row={id:issue.id,metronId:issue.metronId!,seriesId:record.seriesId,publisherId:record.publisherId,title:issue.title,number:issue.number,publisher:issue.publisher,year:issue.year,era:issue.era,kind:issue.kind,searchText:catalogSearchText(issue),data:JSON.stringify(issue),sourceModified:record.sourceModified,fetchedAt:record.stamp,rawMetadata:record.rawMetadata};
 statements.push(db.insert(catalogIssues).values(row).onConflictDoUpdate({target:catalogIssues.metronId,set:row}));
 statements.push(db.delete(catalogIssueCreators).where(eq(catalogIssueCreators.issueId,issue.id)));
 for(const c of record.credits)statements.push(db.insert(catalogIssueCreators).values({issueId:issue.id,creatorId:c.creatorId,role:c.role}).onConflictDoNothing());
 return statements;
}
export async function metronRecordsByIds(db:CatalogDb,ids:number[]){return ids.length?db.select().from(catalogIssues).where(and(isNotNull(catalogIssues.metronId),inArray(catalogIssues.metronId,ids))):[]}
