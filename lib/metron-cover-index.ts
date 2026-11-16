// Metron cover copies on the owner's own CDN (METRON_COVER_CDN_BASE, S3 behind CloudFront).
// Small read path: no AWS SDK, no image codec, no provider calls. The copier is
// scripts/copy-metron-covers.mjs; the manifest importer is lib/metron-cover-import.ts.
import {sql} from 'drizzle-orm';
import type {CatalogDb} from './catalog-store';
import {METRON_COVER_ATTRIBUTION} from './data-credits';
import {catalogArtCovers} from './cover-policy';

/** Validated https origin (optionally with a path prefix), without trailing slash; else null. */
export function metronCoverCdnBase(env:Record<string,string|undefined>=process.env):string|null{
 const raw=env.METRON_COVER_CDN_BASE;if(!raw||raw.length>512)return null;
 try{
  const url=new URL(raw);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.port||!url.hostname.includes('.'))return null;
  return url.href.replace(/\/+$/,'');
 }catch{return null}
}

/** The CDN base for showing our Metron copies (covers, character portraits); null while catalog art is off. */
export const metronDisplayBase=()=>catalogArtCovers()?metronCoverCdnBase():null;

// ---- Normalization (mirrored exactly by the SQL in lib/metron-cover-import.ts) ----
/** lowercase, drop apostrophes, '&' -> 'and', other punctuation -> space, collapse, strip a leading "the". */
export function normalizeSeriesName(value:unknown):string{
 if(typeof value!=='string')return '';
 return value.toLowerCase().replace(/['’`]/g,'').replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim().replace(/^the /,'');
}
/** lowercase, drop spaces and a leading '#', '½' -> '1/2', strip leading zeros ("001" -> "1", "0" stays). */
export function normalizeIssueNumber(value:unknown):string{
 if(typeof value!=='string'&&typeof value!=='number')return '';
 return String(value).toLowerCase().replace(/½/g,'1/2').replace(/\s+/g,'').replace(/^#+/,'').replace(/^0+(?=[0-9])/,'');
}
/** A name match is accepted only when exactly one distinct catalog issue qualifies. */
export function uniqueMatch(candidates:readonly number[]):number|null{
 const distinct=new Set(candidates.filter(id=>Number.isSafeInteger(id)&&id>0));
 return distinct.size===1?[...distinct][0]:null;
}

// ---- Manifest ----
export type MetronRendition={key:string;width:number;height:number};
export type MetronManifestRow={id:number;series:string|null;volume:number|null;yearBegan:number|null;number:string|null;coverDate:string|null;card:MetronRendition;dense:MetronRendition;coverHash:string|null};
const KEY=/^metron\/([0-9]{1,10})\/(card|dense)\.webp$/;
export function validRenditionKey(key:unknown,id?:number,name?:'card'|'dense'):key is string{
 if(typeof key!=='string')return false;const m=KEY.exec(key);
 return !!m&&(id===undefined||Number(m[1])===id)&&(name===undefined||m[2]===name);
}
const int=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isInteger(v)&&v>=min&&v<=max?v:null;
const str=(v:unknown,max:number)=>typeof v==='string'&&v.trim()?v.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max):null;
function rendition(v:unknown,id:number,name:'card'|'dense'):MetronRendition|null{
 if(!v||typeof v!=='object')return null;const r=v as Record<string,unknown>;
 const width=int(r.width,1,4000),height=int(r.height,1,8000);
 return validRenditionKey(r.key,id,name)&&width&&height?{key:r.key as string,width,height}:null;
}
export function parseManifestLine(line:string):MetronManifestRow|null{
 let raw:unknown;try{raw=JSON.parse(line)}catch{return null}
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;const r=raw as Record<string,unknown>;
 const id=int(r.id,1,2147483647);if(!id)return null;
 const card=rendition(r.card,id,'card'),dense=rendition(r.dense,id,'dense');if(!card||!dense)return null;
 const coverDate=typeof r.coverDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(r.coverDate)&&!Number.isNaN(Date.parse(r.coverDate))?r.coverDate:null;
 const coverHash=typeof r.coverHash==='string'&&/^[A-Za-z0-9]{1,128}$/.test(r.coverHash)?r.coverHash:null;
 return {id,series:str(r.series,300),volume:int(r.volume,0,100000),yearBegan:int(r.yearBegan,1800,2200),number:str(r.number,40),coverDate,card,dense,coverHash};
}
/** Invalid lines are skipped; a duplicated id keeps its last line. */
export function parseManifest(text:string):{rows:MetronManifestRow[];skipped:number}{
 const byId=new Map<number,MetronManifestRow>();let skipped=0;
 for(const line of text.split(/\r?\n/)){if(!line.trim())continue;const row=parseManifestLine(line);if(row)byId.set(row.id,row);else skipped++}
 return {rows:[...byId.values()],skipped};
}

// ---- Read path ----
export type MetronCdnCover={url:string;srcSet?:string;attribution:string;source:string};
let tablePresent:{expires:number;value:Promise<boolean>}|null=null;
function hasIndexTable(db:CatalogDb){
 if(tablePresent&&tablePresent.expires>Date.now())return tablePresent.value;
 const value=db.execute(sql`SELECT to_regclass('ch_web.metron_cover_index') IS NOT NULL AS present`).then(r=>r.rows[0]?.present===true);
 tablePresent={expires:Date.now()+60000,value};
 void value.catch(()=>{if(tablePresent?.value===value)tablePresent=null});
 return value;
}
/** Matched CDN copies by catalog issue id. Never throws: missing config/migration means none. */
export async function metronCdnCovers(db:CatalogDb,issueIds:number[]):Promise<Map<number,MetronCdnCover>>{
 const out=new Map<number,MetronCdnCover>(),base=metronDisplayBase();
 const ids=[...new Set(issueIds.filter(id=>Number.isSafeInteger(id)&&id>0))];
 if(!base||!ids.length)return out;
 try{
  if(!await hasIndexTable(db))return out;
  const rows=await db.execute(sql`SELECT DISTINCT ON(issue_id) issue_id,metron_id,card,dense FROM ch_web.metron_cover_index
   WHERE issue_id IN (${sql.join(ids.map(id=>sql`${id}`),sql`,`)}) AND card IS NOT NULL
   ORDER BY issue_id,(COALESCE(match_method,'') LIKE 'exact%') DESC,metron_id`);
  for(const row of rows.rows){
   const id=Number(row.metron_id),card=rendition(row.card,id,'card');if(!card)continue;
   const dense=rendition(row.dense,id,'dense');
   out.set(Number(row.issue_id),{url:base+'/'+card.key,srcSet:dense?base+'/'+dense.key+' '+dense.width+'w, '+base+'/'+card.key+' '+card.width+'w':undefined,attribution:METRON_COVER_ATTRIBUTION,source:'https://metron.cloud/'});
  }
 }catch{console.warn('Metron CDN cover lookup deferred; apply migration 029.')}
 return out;
}
