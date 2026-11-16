// Audit: what the site shows as a character's first appearance, compared with well-established facts for famous
// characters (lib/first-appearance-reference.ts). Read-only. Run against QA with the scratchpad runner.
import {getPool} from '../db/postgres';
import {FIRST_APPEARANCE_REFERENCE} from '../lib/first-appearance-reference';
import {referenceNames} from '../lib/characters-reference';

const pool=getPool();
const norm=(value:string)=>value.toLowerCase().replace(/^the\s+/,'').replace(/[^a-z0-9]+/g,' ').trim();
let ok=0,wrong=0,missing=0;const lines:string[]=[];
for(const ref of FIRST_APPEARANCE_REFERENCE){
 const candidates=(await pool.query<{character_id:number;name:string;issue_count:number|null}>(`SELECT character_id,name,issue_count FROM ch_web.characters WHERE merged_into IS NULL AND lower(name)=ANY($1::text[]) ORDER BY issue_count DESC NULLS LAST LIMIT 1`,[referenceNames(ref)])).rows;
 const c=candidates[0];if(!c){missing++;lines.push(`NO CHARACTER  ${ref.name}`);continue}
 const shown=(await pool.query<{series:string;number:string;year:number|null;source:string;match_method:string}>(`SELECT series,number,year,source,match_method FROM ch_web.character_first_appearances WHERE character_id=$1 AND issue_id IS NOT NULL AND NOT suppressed AND (source='reference' OR source='wikidata' AND match_method NOT IN ('name_only','name_only_dominant') OR match_method='metron_desc_confirmed') ORDER BY (source='reference') DESC,(match_method='metron_desc_confirmed') DESC,(source='wikidata') DESC LIMIT 1`,[c.character_id])).rows[0];
 const all=(await pool.query<{series:string;number:string;year:number|null;source:string;match_method:string;suppressed:boolean}>(`SELECT series,number,year,source,match_method,suppressed FROM ch_web.character_first_appearances WHERE character_id=$1 ORDER BY source`,[c.character_id])).rows;
 const right=(s?:{series:string;number:string})=>!!s&&norm(s.series).includes(norm(ref.series))&&String(s.number).replace(/^#/,'')===ref.number;
 const fmt=(s:{series:string;number:string;year:number|null;source:string;match_method:string;suppressed?:boolean})=>`${s.series} #${s.number} (${s.year??'?'}) [${s.source}/${s.match_method}${s.suppressed?'/hidden':''}]`;
 if(!shown){missing++;lines.push(`NOT SHOWN     ${ref.name} (expected ${ref.series} #${ref.number}) | rows: ${all.map(fmt).join(' ; ')||'none'}`)}
 else if(right(shown)){ok++}
 else{wrong++;lines.push(`WRONG         ${ref.name}: shows ${fmt(shown)} | expected ${ref.series} #${ref.number} ${ref.year} | rows: ${all.map(fmt).join(' ; ')}`)}
}
console.log(`correct ${ok} · wrong ${wrong} · not shown ${missing} · of ${FIRST_APPEARANCE_REFERENCE.length}`);
for(const line of lines)console.log(line);
process.exit(0);
