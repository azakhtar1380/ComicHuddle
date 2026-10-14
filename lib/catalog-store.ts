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
export async function catalogIssue(db:CatalogDb,id:number):Promise<Issue|undefined>{
 const readCatalog=await readableCatalog(db);
 const [row]=await db.select({data:readCatalog.data}).from(readCatalog).where(eq(readCatalog.id,id));
 const issue=row?directoryIssueData(row.data!):catalog.find(issue=>issue.id===id);
 return issue?(await withCatalogCovers(db,[issue]))[0]:undefined;
}
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
 const where=terms.length?and(...terms):undefined;
 const [count]=await db.select({n:sql<number>`count(*)`}).from(readCatalog).where(where);
 const coverRank=readCatalog.coverRank;
 const order=filter.sort==='title'?[asc(readCatalog.title),asc(readCatalog.id)]:filter.sort==='oldest'?[asc(readCatalog.year),asc(readCatalog.id)]:filter.sort==='newest'?[desc(readCatalog.year),asc(readCatalog.id)]:[asc(readCatalog.id)];
 if(filter.offset>=Number(count?.n||0))return {...meta,issues:[],total:Number(count?.n||0),limit:filter.limit,offset:filter.offset,hasMore:false};
 const rowWhere=filter.after!==undefined?and(where,sql`${readCatalog.id}>${filter.after}`):where;
 // Page cheap identities first: never build/sort millions of JSON issue payloads.
 const selected=await db.select({id:readCatalog.id}).from(readCatalog).where(rowWhere).orderBy(...order).limit(filter.limit).offset(filter.after===undefined?filter.offset:0);
 const found=selected.length?await db.select({id:readCatalog.id,data:readCatalog.data}).from(readCatalog).where(inArray(readCatalog.id,selected.map(row=>row.id))):[];
 const byId=new Map(found.map(row=>[row.id,row]));
 const rows=selected.flatMap(row=>{const record=byId.get(row.id);return record?[record]:[]});
 const total=Number(count?.n||0);
 const issues=await withCatalogCovers(db,rows.map(row=>directoryIssueData(row.data!)));
 return {...meta,issues:issues.map(issue=>catalogSearchDto(issue)),total,limit:filter.limit,offset:filter.offset,hasMore:filter.offset+filter.limit<total};
}
// A bounded publisher > series tree. Never download the entire catalog to a browser.
export async function browseSharedSeries(db:CatalogDb,filter:{publisher:string;q:string;limit:number;offset:number}){
 const readCatalog=await readableCatalog(db);
 const [stored]=await db.select({n:sql<number>`count(*)`}).from(readCatalog);
 if(!Number(stored?.n)){
  const byTitle=new Map<string,{title:string;publisher:string;count:number;firstYear:number;lastYear:number}>();
  for(const issue of catalog){
   if(issue.publisher!==filter.publisher||!issue.title.toLowerCase().includes(filter.q.toLowerCase()))continue;
   const previous=byTitle.get(issue.title);
   if(previous){previous.count++;previous.firstYear=Math.min(previous.firstYear,issue.year);previous.lastYear=Math.max(previous.lastYear,issue.year);}
   else byTitle.set(issue.title,{title:issue.title,publisher:issue.publisher,count:1,firstYear:issue.year,lastYear:issue.year});
  }
  const series=[...byTitle.values()].sort((a,b)=>a.title.localeCompare(b.title));
  return {series:series.slice(filter.offset,filter.offset+filter.limit),total:series.length,limit:filter.limit,offset:filter.offset,hasMore:filter.offset+filter.limit<series.length};
 }
 const where=and(eq(readCatalog.publisher,filter.publisher),filter.q?ilike(readCatalog.title,'%'+filter.q+'%'):undefined);
 const [total]=await db.select({n:sql<number>`count(distinct ${readCatalog.title})`}).from(readCatalog).where(where);
 const series=await db.select({title:readCatalog.title,publisher:readCatalog.publisher,count:sql<number>`count(*)`,firstYear:sql<number>`min(${readCatalog.year})`,lastYear:sql<number>`max(${readCatalog.year})`}).from(readCatalog).where(where).groupBy(readCatalog.title,readCatalog.publisher).orderBy(asc(readCatalog.title)).limit(filter.limit).offset(filter.offset);
 return {series,total:Number(total?.n||0),limit:filter.limit,offset:filter.offset,hasMore:filter.offset+filter.limit<Number(total?.n||0)};
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
