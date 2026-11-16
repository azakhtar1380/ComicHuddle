// Which Directory issues are keys, with a short note ("1st Wolverine"). A key is a curated key issue
// (lib/catalog.ts) or an issue with a verified first appearance (character_first_appearances, the same
// trust rules as the issue page). Used by the profile stats, the glass case and the Key Master trophy.
// Tolerant: if the character tables are missing, only curated keys are reported.
import {sql} from 'drizzle-orm';
import type {CatalogDb} from './catalog-store';
import {catalog} from './catalog';
import {coverLookupId} from './curated-cover-ids';
import {GCD_DIRECTORY_OFFSET,sharedMetronId} from './shared-catalog';
import {VERIFIED_FIRST_APPEARANCE} from './characters';

export type IssueKey={note:string;reasons:string[]};
const curatedNote=(id:number)=>{const entry=catalog[id];return entry&&['Key issue','First appearance'].includes(entry.kind)&&entry.note?entry.note:null};
/** "First full appearance of Wolverine…" → "1st Wolverine" style short label for small spaces. */
export function shortKeyNote(names:string[],curated:string|null):string{
 if(names.length)return '1st '+names.slice(0,2).join(' & ')+(names.length>2?' +'+(names.length-2):'');
 if(!curated)return 'Key issue';
 const first=/^first (?:full |cameo )?appearance of (?:the )?([^,.;(]+)/i.exec(curated);
 return first?'1st '+first[1].trim().split(/\s+/).slice(0,3).join(' '):curated.split(/[.;]/)[0].slice(0,40);
}
type Rows<T>={rows:T[]};
export async function issueKeys(db:CatalogDb,directoryIds:readonly number[]):Promise<Map<number,IssueKey>>{
 const out=new Map<number,IssueKey>();
 const ids=[...new Set(directoryIds.filter(id=>Number.isSafeInteger(id)&&id>=0))];
 if(!ids.length)return out;
 // Directory id → GCD-keyed issue id used by character_first_appearances.
 const target=new Map<number,number>(),metron:number[]=[];
 for(const id of ids){
  if(id>=GCD_DIRECTORY_OFFSET){target.set(id,id);continue}
  const m=sharedMetronId(id);if(m!==null){metron.push(m);continue}
  const gcd=coverLookupId(id);if(gcd!==null)target.set(id,gcd);
 }
 const names=new Map<number,string[]>();
 try{
  if(metron.length){
   const links=(await db.execute(sql`SELECT metron_id,issue_id FROM ch_web.character_metron_issues WHERE issue_id IS NOT NULL AND metron_id IN (${sql.join(metron.map(m=>sql`${m}`),sql`, `)})`) as Rows<{metron_id:number;issue_id:string|number}>).rows;
   for(const link of links)target.set(1_000_000_000+Number(link.metron_id),Number(link.issue_id));
  }
  const issueIds=[...new Set(target.values())];
  for(let i=0;i<issueIds.length;i+=500){
   const part=issueIds.slice(i,i+500);
   const rows=(await db.execute(sql`SELECT f.issue_id,c.name FROM ch_web.character_first_appearances f JOIN ch_web.characters c ON c.character_id=f.character_id AND c.merged_into IS NULL
    WHERE f.issue_id IN (${sql.join(part.map(v=>sql`${v}`),sql`, `)}) AND ${VERIFIED_FIRST_APPEARANCE} ORDER BY f.issue_id,(f.source='reference') DESC,c.issue_count DESC NULLS LAST,c.name`) as Rows<{issue_id:string|number;name:string}>).rows;
   for(const row of rows){const key=Number(row.issue_id),list=names.get(key)||[];if(!list.includes(row.name))list.push(row.name);names.set(key,list)}
  }
 }catch{/* character tables not migrated: curated keys only */}
 for(const id of ids){
  const curated=curatedNote(id),found=names.get(target.get(id)??-1)||[];
  if(!curated&&!found.length)continue;
  out.set(id,{note:shortKeyNote(found,curated),reasons:[...(curated?[curated]:[]),...found.map(name=>'First appearance of '+name)]});
 }
 return out;
}
