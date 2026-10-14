import {eq,sql} from 'drizzle-orm';
import {catalogIssues,catalogGcdSeries} from '../db/schema';
import type {CatalogDb} from './catalog-store';
import type {Issue,GcdStory,GcdBibliography} from './catalog';
import {GCD_ID_MAX,gcdDirectoryId,plainCatalogText,eraForYear,catalogSearchText} from './shared-catalog';
import {ApiRequestError} from './api-security';

export const GCD_ORIGIN='https://www.comics.org';
export const GCD_LICENSE='https://creativecommons.org/licenses/by-sa/4.0/';
export const GCD_BOUNDS=Object.freeze({responseBytes:6_000_000,recordBytes:180_000,seriesIssues:100_000,rowsPerPage:100,timeoutMs:12_000,requestsPerHour:26,callsPerStep:3,recordsPerStep:8,progressPerStep:16});
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const bad=(message='GCD returned unexpected metadata. The checkpoint is preserved.')=>new ApiRequestError(message,502);

/** Hyperlinked provider identity is authoritative; a title or descriptor is not an ID. */
export function gcdProviderId(value:unknown,kind:'issue'|'series'|'publisher'):number{
 if(typeof value!=='string'||value.length>180)throw bad();
 let url:URL;try{url=new URL(value)}catch{throw bad()}
 const match=url.pathname.match(new RegExp('^/api/'+kind+'/([1-9][0-9]*)/$'));
 const id=match?Number(match[1]):NaN;
 if(url.origin!==GCD_ORIGIN||url.username||url.password||url.search||url.hash||!Number.isSafeInteger(id)||id<1||id>GCD_ID_MAX)throw bad('GCD returned an unsafe or invalid provider identity.');
 return id;
}
export function gcdYear(value:unknown):number{
 // GCD key_date legitimately uses 00 for an unknown month/day; do not invent a date.
 if(typeof value==='string'&&/^\d{4}-(?:0[0-9]|1[0-2])-(?:[0-2][0-9]|3[01])$/.test(value)){const year=Number(value.slice(0,4));if(year>=1800&&year<=9999)return year;}
 return 0;
}
function credit(value:unknown):string{const text=plainCatalogText(value,400);return !text||/^(?:none|unknown|\?)$/i.test(text)?'':text;}
export function normalizeGcdIssue(raw:unknown,stamp:string){
 if(!object(raw)||!Number.isFinite(Date.parse(stamp)))throw bad();
 const id=gcdProviderId(raw.api_url,'issue'),seriesId=gcdProviderId(raw.series,'series');
 const title=plainCatalogText(raw.series_name,160),number=plainCatalogText(raw.number,40);
 if(!title||!number||new TextEncoder().encode(JSON.stringify(raw)).byteLength>GCD_BOUNDS.recordBytes)throw bad('GCD issue metadata is incomplete or oversized.');
 const variantOf=raw.variant_of===null||raw.variant_of===undefined?null:gcdProviderId(raw.variant_of,'issue');
 const variantName=plainCatalogText(raw.variant_name,160),descriptor=plainCatalogText(raw.descriptor,240);
 const stories=(Array.isArray(raw.story_set)?raw.story_set:[]).slice(0,100).filter(object);
 const inside=stories.filter(s=>credit(s.type).toLowerCase()!=='cover'),cover=stories.filter(s=>credit(s.type).toLowerCase()==='cover');
 const join=(rows:Record<string,unknown>[],field:string)=>[...new Set(rows.map(s=>credit(s[field])).filter(Boolean))].join('; ').slice(0,400)||'Not recorded';
 const characters=[...new Set(stories.map(s=>plainCatalogText(s.characters,400)).filter(Boolean))].slice(0,40);
 const year=gcdYear(raw.key_date);
 const notes=plainCatalogText(raw.notes,700);
 const fullStories:GcdStory[]=stories.map(s=>({type:plainCatalogText(s.type,200),title:plainCatalogText(s.title,1000),feature:plainCatalogText(s.feature,1000),sequenceNumber:typeof s.sequence_number==='number'&&Number.isFinite(s.sequence_number)?s.sequence_number:null,pageCount:plainCatalogText(s.page_count,80),script:plainCatalogText(s.script,2000),pencils:plainCatalogText(s.pencils,2000),inks:plainCatalogText(s.inks,2000),colors:plainCatalogText(s.colors,2000),letters:plainCatalogText(s.letters,2000),editing:plainCatalogText(s.editing,2000),jobNumber:plainCatalogText(s.job_number,300),genre:plainCatalogText(s.genre,1000),firstLine:plainCatalogText(s.first_line,2000),characters:plainCatalogText(s.characters,2000),synopsis:plainCatalogText(s.synopsis,6000),notes:plainCatalogText(s.notes,6000),keywords:plainCatalogText(s.keywords,2000)}));
 const bibliography:GcdBibliography={publicationDate:plainCatalogText(raw.publication_date,160),keyDate:plainCatalogText(raw.key_date,40),onSaleDate:plainCatalogText(raw.on_sale_date,40),originalCoverPrice:{kind:'ORIGINAL_COVER_PRICE',text:plainCatalogText(raw.price,400)},pageCount:plainCatalogText(raw.page_count,80),isbn:plainCatalogText(raw.isbn,80),barcode:plainCatalogText(raw.barcode,120),issueTitle:plainCatalogText(raw.title,1000),volume:plainCatalogText(raw.volume,80),variantOf,seriesProviderId:seriesId,indiciaPublisher:plainCatalogText(raw.indicia_publisher,160),brandEmblem:plainCatalogText(raw.brand_emblem,500),rating:plainCatalogText(raw.rating,500),indiciaFrequency:plainCatalogText(raw.indicia_frequency,200),indiciaPrinter:plainCatalogText(raw.indicia_printer,500),keywords:plainCatalogText(raw.keywords,2000),editing:plainCatalogText(raw.editing,2000),stories:fullStories};
 const publisherName=plainCatalogText(raw.publisher_name,160);
 const issue:Issue={id:gcdDirectoryId(id),gcdId:id,title,number,publisher:plainCatalogText(raw.indicia_publisher,160)||publisherName||'Publisher not recorded',year,era:year?eraForYear(year):'Date not recorded',characters,
  writer:join(inside,'script'),artist:join(inside,'pencils'),coverArtist:join(cover,'pencils'),
  note:notes||'GCD bibliographic record. Confirm the physical edition and printing.',kind:'Catalog issue',
  variant:(variantName||(descriptor&&descriptor!==number))?(variantName||descriptor):'Edition record · printing must be confirmed',
  source:GCD_ORIGIN+'/issue/'+id+'/',dataCredit:'Bibliographic data from the Grand Comics Database; bounded text fields formatted and shortened by ComicHuddle. Recorded indicia or series publisher shown where available.',dataLicense:GCD_LICENSE,bibliography};
 // Original face price is bibliographic history, explicitly never FMV. Artwork URLs/binary excluded.
 const metadata={provider:'GCD',issueId:id,seriesId,variantOf,variantName,descriptor,publisherName,notes:plainCatalogText(raw.notes,6000),bibliography};
 return {issue,seriesId,stamp:new Date(stamp).toISOString(),rawMetadata:JSON.stringify(metadata)};
}
export function gcdRecordStatements(db:CatalogDb,record:ReturnType<typeof normalizeGcdIssue>,preserveNewer=false){
 const issue=record.issue,row={id:issue.id,gcdId:issue.gcdId!,metronId:null,seriesId:null,publisherId:null,title:issue.title,number:issue.number,publisher:issue.publisher,year:issue.year,era:issue.era,kind:issue.kind,searchText:catalogSearchText(issue),data:JSON.stringify(issue),sourceModified:'',fetchedAt:record.stamp,rawMetadata:record.rawMetadata};
 return [db.insert(catalogIssues).values(row).onConflictDoUpdate({target:catalogIssues.gcdId,set:row,...(preserveNewer?{setWhere:sql`${catalogIssues.fetchedAt}<${record.stamp}`}:{})})];
}
export function normalizeGcdSeries(raw:unknown,stamp:string){
 if(!object(raw)||!Array.isArray(raw.active_issues)||raw.active_issues.length>GCD_BOUNDS.seriesIssues)throw bad('GCD returned incomplete series metadata.');
 const id=gcdProviderId(raw.api_url,'series'),name=plainCatalogText(raw.name,160);
 if(!name)throw bad();
 const issueIds=raw.active_issues.map(value=>gcdProviderId(value,'issue'));
 if(new Set(issueIds).size!==issueIds.length)throw bad('GCD repeated an issue identity inside a series.');
 const publisherId=raw.publisher?gcdProviderId(raw.publisher,'publisher'):null;
 const descriptors=Array.isArray(raw.issue_descriptors)?raw.issue_descriptors:[];
 const data={id,name,country:plainCatalogText(raw.country,8),language:plainCatalogText(raw.language,8),yearBegan:Number.isInteger(raw.year_began)?raw.year_began:null,yearEnded:Number.isInteger(raw.year_ended)?raw.year_ended:null,publisherId,color:plainCatalogText(raw.color,400),dimensions:plainCatalogText(raw.dimensions,400),paperStock:plainCatalogText(raw.paper_stock,400),binding:plainCatalogText(raw.binding,400),publishingFormat:plainCatalogText(raw.publishing_format,400),notes:plainCatalogText(raw.notes,6000),issueDescriptors:descriptors.slice(0,1000).map(v=>plainCatalogText(v,240)),descriptorCount:descriptors.length,descriptorsShortened:descriptors.length>1000};
 return {gcdId:id,data:JSON.stringify(data),issueIds:JSON.stringify(issueIds),fetchedAt:stamp};
}
export async function gcdStoredIssue(db:CatalogDb,id:number){const [row]=await db.select().from(catalogIssues).where(eq(catalogIssues.gcdId,id));return row;}
export async function gcdStoredSeries(db:CatalogDb,id:number){const [row]=await db.select().from(catalogGcdSeries).where(eq(catalogGcdSeries.gcdId,id));return row;}

export function gcdNextPage(value:unknown,basePath:string,currentPage:number):number|null{
 if(value===null||value===undefined)return null;
 if(typeof value!=='string'||value.length>500)throw bad('GCD pagination is invalid.');
 let url:URL;try{url=new URL(value)}catch{throw bad()}
 const page=url.searchParams.get('page');
 if(url.origin!==GCD_ORIGIN||url.pathname!==basePath||url.username||url.password||url.hash||url.searchParams.size!==1||url.searchParams.getAll('page').length!==1||!page||!/^\d+$/.test(page)||Number(page)!==currentPage+1)throw bad('GCD pagination cannot change origin, endpoint or skip pages.');
 return Number(page);
}
export function gcdPage(raw:unknown,path:string,page:number){
 if(!object(raw)||!Array.isArray(raw.results)||raw.results.length>GCD_BOUNDS.rowsPerPage||!Number.isSafeInteger(raw.count)||Number(raw.count)<raw.results.length)throw bad('GCD returned an invalid paginated response.');
 const next=gcdNextPage(raw.next,path,page);
 if(next!==null&&!raw.results.length||page===1&&Number(raw.count)>0&&!raw.results.length)throw bad('GCD returned an empty incomplete page.');
 return {results:raw.results,count:Number(raw.count),next};
}
export function isoWeek(now:number){
 const date=new Date(now);if(!Number.isFinite(date.getTime()))throw new Error('Invalid sync clock.');
 const day=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()));
 day.setUTCDate(day.getUTCDate()+4-(day.getUTCDay()||7));const year=day.getUTCFullYear();
 return {year,week:Math.ceil((((day.getTime()-Date.UTC(year,0,1))/86400000)+1)/7)};
}
export function weeklyPath(week:{year:number;week:number}){return '/api/issue/on_sale_weekly/'+week.year+'/week/'+week.week+'/';}
