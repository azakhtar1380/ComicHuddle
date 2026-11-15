// Imports comic-character first appearances from Wikidata (CC0) into migration 030's tables:
// characters with P4584 "first appearance" pointing at a comic issue, matched to catalog issues by
// GCD issue ID (P11308), else series name + issue number + year (unique / clearly dominant series),
// else through a unique harvested Metron issue. A handful of SPARQL queries per run; responses are
// cached in .metron-cache/wikidata/ (use --refresh to query again).
//
//   node --import tsx scripts/import-wikidata-first-appearances.ts [--refresh] [--dry-run]
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {getDb} from '../db';
import {WIKIDATA_FIRST_APPEARANCE_QUERIES,WIKIDATA_SPARQL,WIKIDATA_USER_AGENT,groupFacts,parseSparqlJson,wikidataCharacterInfoQuery,wikidataFictionalQuery,type SparqlRow} from '../lib/characters-wikidata';
import {finalizeCharacters,matchWikidataFacts,metronNameIndex,readHarvest,storeWikidataFacts,type WikidataInfo} from '../lib/characters-import';

const args=process.argv.slice(2),refresh=args.includes('--refresh'),dry=args.includes('--dry-run');
const dir='.metron-cache/wikidata';mkdirSync(dir,{recursive:true});
const log=(line:string)=>console.log('wikidata: '+line);
/** Cache name per batch content, so a changed character set never reuses another batch's answer. */
const batchName=(kind:string,qids:string[])=>kind+'-'+createHash('sha256').update(qids.join(',')).digest('hex').slice(0,12);
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

async function sparql(name:string,query:string):Promise<unknown>{
 const file=join(dir,name+'.json');
 if(!refresh&&existsSync(file))return JSON.parse(readFileSync(file,'utf8'));
 for(let attempt=1;;attempt++){
  const res=await fetch(WIKIDATA_SPARQL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/sparql-results+json','User-Agent':WIKIDATA_USER_AGENT},body:new URLSearchParams({query}),signal:AbortSignal.timeout(90000)}).catch(()=>null);
  if(res?.ok){const body=await res.json();writeFileSync(file,JSON.stringify(body));await sleep(1500);return body}
  const wait=Number(res?.headers.get('retry-after'))||20*attempt;
  if(attempt>=4)throw new Error(`Wikidata query ${name} failed (HTTP ${res?.status??'network'})`);
  log(`${name}: HTTP ${res?.status??'network'}; retrying in ${wait}s`);await sleep(wait*1000);
 }
}

const rows:SparqlRow[]=[];
for(const [name,query] of Object.entries(WIKIDATA_FIRST_APPEARANCE_QUERIES)){const r=parseSparqlJson(await sparql(name,query));log(`${name}: ${r.length} rows`);rows.push(...r)}
const grouped=groupFacts(rows),fictional=new Set<string>();
for(let i=0;i<grouped.length;i+=250){
 const body=await sparql(batchName('kind',grouped.slice(i,i+250).map(f=>f.qid)),wikidataFictionalQuery(grouped.slice(i,i+250).map(f=>f.qid))) as {results?:{bindings?:Record<string,{value:string}|undefined>[]}};
 for(const b of body.results?.bindings||[]){const q=/\/(Q\d+)$/.exec(b.c?.value||'')?.[1];if(q)fictional.add(q)}
}
const facts=grouped.filter(f=>fictional.has(f.qid));
log(`${grouped.length-facts.length} items skipped as not fictional characters or teams`);
log(`${facts.length} characters with a usable comic first appearance (${facts.filter(f=>f.gcdIssueId).length} with a GCD issue id)`);
const info=new Map<string,WikidataInfo>();
const qids=facts.map(f=>f.qid);
for(let i=0;i<qids.length;i+=250){
 const body=await sparql(batchName('info',qids.slice(i,i+250)),wikidataCharacterInfoQuery(qids.slice(i,i+250))) as {results?:{bindings?:Record<string,{value:string}|undefined>[]}};
 for(const b of body.results?.bindings||[]){
  const q=/\/(Q\d+)$/.exec(b.c?.value||'')?.[1];if(!q)continue;
  info.set(q,{sitelinks:b.links?Number(b.links.value):null,aliases:(b.aliases?.value||'').split('\u001f').map(s=>s.trim()).filter(s=>s&&s.length<=200).slice(0,30),description:b.desc?.value?.slice(0,500)||null});
 }
}
const db=getDb();
try{
 const harvest=existsSync('.metron-cache/metron-issues.ndjson')?await readHarvest('.metron-cache/metron-issues.ndjson'):new Map();
 const matches=await matchWikidataFacts(db,facts,metronNameIndex(harvest));
 const methods:Record<string,number>={};for(const m of matches.values())methods[m.method]=(methods[m.method]||0)+1;
 const matched=[...matches.values()].filter(m=>m.issueId);
 log(`matched ${matched.length}/${facts.length} facts to ${new Set(matched.map(m=>m.issueId)).size} catalog issues; methods ${JSON.stringify(methods)}`);
 if(dry){for(const f of facts.slice(0,25))log(`${f.qid} ${f.name}: ${f.series.join(' / ')} #${f.number} ${f.years.join(',')} -> ${JSON.stringify(matches.get(f.qid))}`)}
 else{
  const present=await db.execute(sql`SELECT to_regclass('ch_web.character_first_appearances') IS NOT NULL AS ok`);
  if(present.rows[0]?.ok!==true)throw new Error('Migration 030 is not applied.');
  log(`stored ${await storeWikidataFacts(db,facts,matches,info)} characters and facts`);
  await finalizeCharacters(db,log);
 }
}finally{
 const pool=(globalThis as typeof globalThis&{comicHuddlePool?:{end():Promise<void>}}).comicHuddlePool;await pool?.end().catch(()=>undefined);
}
