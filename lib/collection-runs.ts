// Runs a member is building (migration 052: ch_web.collection_runs): a Directory series plus an issue range.
// Owned and missing issues are always computed from the vault, never stored.
import {sql} from 'drizzle-orm';
import {z} from 'zod';
import type {CatalogDb} from './catalog-store';
import {catalogIssuesById} from './catalog-store';
import {coverLookupId} from './curated-cover-ids';
import {GCD_DIRECTORY_OFFSET} from './shared-catalog';
import {copyDirectoryId} from './vault-ledger';
import type {Vault} from './vault';

export type CollectionRun={id:string;title:string;publisher:string;seriesName:string;seriesYear:number|null;from:number;to:number;total:number;owned:number[];missing:number[];complete:boolean;missingIds?:number[]};
export const runInput=z.object({issueId:z.number().int().min(0),from:z.number().int().min(0).max(100000),to:z.number().int().min(0).max(100000),title:z.string().trim().max(80).optional()}).strict()
 .refine(v=>v.to>=v.from,'The last issue comes after the first.').refine(v=>v.to-v.from<1000,'Keep a run under 1,000 issues.');
export const MAX_RUNS=50;
type Rows<T>={rows:T[]};
type Series={gcdSeriesId:number|null;seriesName:string;publisher:string;seriesYear:number|null};
const wholeNumber=(value:string)=>{const n=value.replace(/^#/,'').trim();return /^\d{1,6}$/.test(n)?Number(n):null};
const gcdIdOf=(directoryId:number)=>{const id=coverLookupId(directoryId);return id!==null&&id>=GCD_DIRECTORY_OFFSET?id-GCD_DIRECTORY_OFFSET:null};

async function seriesOf(db:CatalogDb,directoryId:number):Promise<Series|null>{
 const gcd=gcdIdOf(directoryId);
 if(gcd!==null){try{
  const [row]=(await db.execute(sql`SELECT s.id,s.name,s.year_began,p.name AS publisher FROM gcd.gcd_issue i JOIN gcd.gcd_series s ON s.id=i.series_id LEFT JOIN gcd.gcd_publisher p ON p.id=s.publisher_id WHERE i.id=${gcd} LIMIT 1`) as Rows<{id:number;name:string;year_began:number|null;publisher:string|null}>).rows;
  if(row)return {gcdSeriesId:Number(row.id),seriesName:row.name,publisher:row.publisher||'',seriesYear:row.year_began===null||row.year_began===undefined?null:Number(row.year_began)};
 }catch{/* GCD tables missing */}}
 const [issue]=await catalogIssuesById(db,[directoryId]);
 return issue?{gcdSeriesId:null,seriesName:issue.title,publisher:issue.publisher,seriesYear:issue.year||null}:null;
}
/** (series key, issue number) for each owned copy. Series key: GCD series id when known, else title+publisher. */
async function ownedNumbers(db:CatalogDb,vault:Vault){
 const ids=[...new Set(vault.books.map(copyDirectoryId).filter((id):id is number=>id!==null))];
 const gcd=new Map<number,number>();for(const id of ids){const g=gcdIdOf(id);if(g!==null)gcd.set(id,g)}
 const bySeries=new Map<number,Set<number>>(),byTitle=new Map<string,Set<number>>();
 const add=(map:Map<number|string,Set<number>>,key:number|string,n:number|null)=>{if(n===null)return;const set=map.get(key)||new Set<number>();set.add(n);map.set(key,set)};
 if(gcd.size){try{
  const values=[...new Set(gcd.values())];
  for(let i=0;i<values.length;i+=500){
   const part=values.slice(i,i+500);
   const rows=(await db.execute(sql`SELECT id,series_id,number FROM gcd.gcd_issue WHERE id IN (${sql.join(part.map(v=>sql`${v}`),sql`, `)})`) as Rows<{id:number;series_id:number;number:string}>).rows;
   for(const row of rows)add(bySeries as Map<number|string,Set<number>>,Number(row.series_id),wholeNumber(String(row.number)));
  }
 }catch{/* GCD tables missing: title matching below */}}
 const records=await catalogIssuesById(db,ids).catch(()=>[]);
 for(const record of records)add(byTitle as Map<number|string,Set<number>>,(record.title+'|'+record.publisher).toLowerCase(),wholeNumber(record.number));
 return {bySeries,byTitle};
}
type RunRow={id:string;title:string;publisher:string;series_name:string;series_year:number|null;gcd_series_id:number|null;from_number:number;to_number:number};
export async function listRuns(db:CatalogDb,userId:string,vault:Vault):Promise<CollectionRun[]>{
 let rows:RunRow[]=[];
 try{rows=(await db.execute(sql`SELECT id,title,publisher,series_name,series_year,gcd_series_id,from_number,to_number FROM ch_web.collection_runs WHERE user_id=${userId} ORDER BY created_at,id`) as Rows<RunRow>).rows}catch{return []}
 if(!rows.length)return [];
 const {bySeries,byTitle}=await ownedNumbers(db,vault);
 return rows.map(row=>{
  const have=new Set([...(row.gcd_series_id!==null?bySeries.get(Number(row.gcd_series_id))||[]:[]),...(byTitle.get((row.series_name+'|'+row.publisher).toLowerCase())||[])]);
  const range=Array.from({length:row.to_number-row.from_number+1},(_,i)=>row.from_number+i);
  const owned=range.filter(n=>have.has(n)),missing=range.filter(n=>!have.has(n));
  return {id:row.id,title:row.title,publisher:row.publisher,seriesName:row.series_name,seriesYear:row.series_year===null?null:Number(row.series_year),from:row.from_number,to:row.to_number,total:range.length,owned,missing,complete:missing.length===0};
 });
}
export class RunError extends Error{constructor(message:string,public status=400){super(message)}}
export async function createRun(db:CatalogDb,userId:string,input:z.infer<typeof runInput>){
 const count=(await db.execute(sql`SELECT count(*)::int AS n FROM ch_web.collection_runs WHERE user_id=${userId}`) as Rows<{n:number}>).rows[0]?.n||0;
 if(count>=MAX_RUNS)throw new RunError(`You can track up to ${MAX_RUNS} runs.`);
 const series=await seriesOf(db,input.issueId);if(!series)throw new RunError('Pick an issue from the Directory to set the series.');
 const id=crypto.randomUUID(),title=input.title||`${series.seriesName}${series.seriesYear?' ('+series.seriesYear+')':''} #${input.from}–${input.to}`;
 await db.execute(sql`INSERT INTO ch_web.collection_runs(id,user_id,title,publisher,series_name,series_year,gcd_series_id,from_number,to_number) VALUES(${id},${userId},${title.slice(0,80)},${series.publisher},${series.seriesName},${series.seriesYear},${series.gcdSeriesId},${input.from},${input.to})`);
 return id;
}
export async function deleteRun(db:CatalogDb,userId:string,id:string){await db.execute(sql`DELETE FROM ch_web.collection_runs WHERE id=${id} AND user_id=${userId}`)}
/** Directory issue ids for the run's missing numbers (original printings), for "Add missing to wishlist". */
export async function missingIssueIds(db:CatalogDb,userId:string,runId:string,vault:Vault):Promise<number[]>{
 const run=(await listRuns(db,userId,vault)).find(r=>r.id===runId);if(!run||!run.missing.length)return [];
 const [row]=(await db.execute(sql`SELECT gcd_series_id FROM ch_web.collection_runs WHERE id=${runId} AND user_id=${userId}`) as Rows<{gcd_series_id:number|null}>).rows;
 if(!row||row.gcd_series_id===null)return [];
 try{
  const rows=(await db.execute(sql`SELECT min(id) AS id,number FROM gcd.gcd_issue WHERE series_id=${row.gcd_series_id} AND variant_of_id IS NULL AND COALESCE(deleted,0)=0 AND number IN (${sql.join(run.missing.map(n=>sql`${String(n)}`),sql`, `)}) GROUP BY number`) as Rows<{id:number;number:string}>).rows;
  return rows.map(r=>GCD_DIRECTORY_OFFSET+Number(r.id));
 }catch{return []}
}
