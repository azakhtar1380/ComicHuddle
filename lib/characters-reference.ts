// Applies the hand-checked first appearances (lib/first-appearance-reference.ts) on top of the imported
// Metron/Wikidata data. For each listed character it stores a source='reference' row pointing at the right issue
// and hides every other first-appearance row for that character, so neither the character page nor an issue page
// can make a conflicting claim. Runs at the end of every character import and is safe to run any number of times.
import {sql} from 'drizzle-orm';
import type {CatalogDb} from './catalog-store';
import {GCD_DIRECTORY_OFFSET} from './shared-catalog';
import {FIRST_APPEARANCE_REFERENCE,type FirstAppearanceFact} from './first-appearance-reference';

const norm=(value:string)=>value.toLowerCase().replace(/^the\s+/,'').replace(/[^a-z0-9]+/g,' ').trim();
/** Character names to look for: the name, its aliases, explicit names, and "Name (Alias)" / "Name (Surname)". */
export function referenceNames(fact:FirstAppearanceFact){
 const names=new Set<string>([fact.name,...(fact.aliases||[]),...(fact.names||[])].map(value=>value.toLowerCase()));
 for(const alias of fact.aliases||[]){const surname=alias.trim().split(/\s+/).at(-1)!;names.add((fact.name+' ('+alias+')').toLowerCase());names.add((fact.name+' ('+surname+')').toLowerCase())}
 return [...names];
}
type Rows<T>={rows:T[]};
export async function applyFirstAppearanceReference(db:CatalogDb,facts:readonly FirstAppearanceFact[]=FIRST_APPEARANCE_REFERENCE){
 const report={applied:0,characters:0,noIssue:[] as string[],noCharacter:[] as string[]};
 for(const fact of facts){
  // The original printing: same series (ignoring a leading "The"), same number, cover year, not a variant.
  const candidates=(await db.execute(sql`SELECT i.id,s.name AS series,i.number,COALESCE(NULLIF(substr(i.key_date,1,4),''),substr(i.publication_date,1,4)) AS year
   FROM gcd.gcd_issue i JOIN gcd.gcd_series s ON s.id=i.series_id
   WHERE COALESCE(i.deleted,0)=0 AND COALESCE(s.deleted,0)=0 AND i.variant_of_id IS NULL
    AND lower(regexp_replace(s.name,'^(The|the) ','')) = ${fact.series.toLowerCase().replace(/^the\s+/,'')}
    AND (i.number=${fact.number} OR i.number LIKE ${'%['+fact.number+']'})
   ORDER BY i.id LIMIT 20`) as Rows<{id:number;series:string;number:string;year:string|null}>).rows;
  const issue=candidates.find(row=>Number(row.year)===fact.year)||candidates.find(row=>Math.abs(Number(row.year)-fact.year)<=1);
  if(!issue){report.noIssue.push(fact.name+' → '+fact.series+' #'+fact.number+' ('+fact.year+')');continue}
  const characters=(await db.execute(sql`SELECT character_id FROM ch_web.characters WHERE merged_into IS NULL AND lower(name) IN (${sql.join(referenceNames(fact).map(name=>sql`${name}`),sql`, `)})`) as Rows<{character_id:number}>).rows;
  if(!characters.length){report.noCharacter.push(fact.name);continue}
  const issueId=GCD_DIRECTORY_OFFSET+Number(issue.id);
  for(const {character_id:id} of characters){
   await db.execute(sql`INSERT INTO ch_web.character_first_appearances AS f(character_id,source,source_ref,issue_id,series,number,year,match_method,suppressed,updated_at)
    VALUES(${id},'reference',${'reference:'+norm(fact.name)},${issueId},${issue.series},${fact.number},${fact.year},'hand_checked',false,now())
    ON CONFLICT(character_id,source) DO UPDATE SET issue_id=excluded.issue_id,series=excluded.series,number=excluded.number,year=excluded.year,suppressed=false,updated_at=now()
    WHERE f.issue_id IS DISTINCT FROM excluded.issue_id OR f.suppressed`);
   await db.execute(sql`UPDATE ch_web.character_first_appearances SET suppressed=true WHERE character_id=${id} AND source<>'reference' AND NOT suppressed`);
   report.applied++;
  }
  report.characters++;
 }
 return report;
}
