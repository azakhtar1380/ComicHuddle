// Resumable Metron character crawler. Every API call is reserved in the shared daily budget
// (ch_web.metron_api_budget via lib/metron-api-budget.ts), so this crawler and the deployed app
// together stay under ~4,500 calls/day; the crawler alone stops at METRON_CRAWLER_DAILY_MAX (3,700).
// It stops cleanly when the day's budget is used and continues from its cache next run.
//
//   node --import tsx scripts/crawl-metron-characters.ts [--max-calls N] [--list-pages N]
//        [--seed-issues 34067,87669] [--only-seeds] [--phases queue,list,seeds,priority,keys,tail,pages,issues]
//
// Priority: (0) issues queued by the profile API; (1) the full character list (names for search);
// (2) issue details of seed issues: the curated key issues, Wikidata first-appearance issues and
// --seed-issues; (3) details + first issue-list page (first appearance, issue count) for the
// characters of those issues and for characters named like a Wikidata comic character; (4) issue
// details of first-appearance issues; (5) the long tail of characters (details only when they have
// >= 3 issues); (6) further issue-list pages of characters with > 100 issues; (7) issue details of
// the remaining linked Metron issues, oldest first.
// Cache (gitignored): .metron-cache/characters/{list,details,issue-lists,issues,missing}.ndjson + state.json.
// Then load it into the database with scripts/import-characters.ts. METRON_API_TOKEN comes from the
// environment or .env.local and is never printed.
import {appendFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {sql} from 'drizzle-orm';
import {getDb} from '../db';
import {CURATED_GCD_IDS} from '../lib/curated-cover-ids';
import {metronApiGet,metronBudgetToday} from '../lib/metron-api-budget';
import {normalizeCharacterText,parseCharacterDetail,parseCharacterListPage,parseIssueDetail,parseIssueListPage} from '../lib/characters';
import {ndjson} from '../lib/characters-import';

const args=process.argv.slice(2),flag=(n:string)=>{const i=args.indexOf(n);return i>=0?args[i+1]:undefined};
const maxCalls=Number(flag('--max-calls')||Infinity),listPages=Number(flag('--list-pages')||Infinity);
const seedArg=(flag('--seed-issues')||'').split(',').map(Number).filter(n=>Number.isSafeInteger(n)&&n>0);
const onlySeeds=args.includes('--only-seeds');
const phases=new Set((flag('--phases')||'queue,list,seeds,priority,keys,tail,pages,issues').split(','));
const gapMs=Math.max(0,Number(process.env.METRON_CRAWL_GAP_MS??3500));
const detailMinIssues=Math.max(0,Number(process.env.METRON_DETAIL_MIN_ISSUES??3));
const dir='.metron-cache/characters';mkdirSync(dir,{recursive:true});
const files={list:join(dir,'list.ndjson'),details:join(dir,'details.ndjson'),issueLists:join(dir,'issue-lists.ndjson'),issues:join(dir,'issues.ndjson'),missing:join(dir,'missing.ndjson'),state:join(dir,'state.json')};
if(!process.env.METRON_API_TOKEN&&existsSync('.env.local'))for(const line of readFileSync('.env.local','utf8').split(/\r?\n/)){const m=/^METRON_API_TOKEN="?([^"]*)"?$/.exec(line);if(m)process.env.METRON_API_TOKEN=m[1]}

type State={listNextPage:number;listDone:boolean;listTotal:number|null;updatedAt?:string};
const state:State=existsSync(files.state)?JSON.parse(readFileSync(files.state,'utf8')):{listNextPage:1,listDone:false,listTotal:null};
const saveState=()=>{state.updatedAt=new Date().toISOString();writeFileSync(files.state,JSON.stringify(state,null,1))};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const db=getDb();
let calls=0,stopReason:string|null=null,lastCall=0;
class Stop extends Error{}

async function call(path:string):Promise<unknown|null>{
 if(calls>=maxCalls)throw new Stop('max calls reached ('+maxCalls+')');
 for(let attempt=1;;attempt++){
  const wait=lastCall+gapMs-Date.now();if(wait>0)await sleep(wait);
  const r=await metronApiGet(db,path,{caller:'crawler',timeoutMs:60000});lastCall=Date.now();
  if(r.status==='budget'){
   if(r.reason==='minute'){await sleep(r.retryAfterMs+500);continue}
   if(r.reason==='blocked'&&r.retryAfterMs<15*60000){console.log(`Metron paused for ${Math.ceil(r.retryAfterMs/1000)}s`);await sleep(r.retryAfterMs+1000);continue}
   throw new Stop(r.reason==='day'?'daily budget used; re-run tomorrow to resume':'Metron budget '+r.reason);
  }
  calls++;
  if(r.status==='ok'){if(r.sustainedRemaining!==null&&r.sustainedRemaining<50)stopReason='Metron reports under 50 calls left today';return r.body}
  if(r.status==='not_found')return null;
  if(r.code==='no_token'||r.code==='token_rejected')throw new Stop('Metron token missing or rejected');
  if(r.code==='rate_limited'){const ms=r.retryAfterMs??60000;if(ms>15*60000)throw new Stop('rate limited for a long time');console.log(`429; waiting ${Math.ceil(ms/1000)}s`);await sleep(ms+1000);continue}
  if(attempt>=3){console.log(`  ${path}: ${r.code}; skipped this run`);return undefined}
  await sleep((r.retryAfterMs??30000)*attempt);
 }
}
const check=()=>{if(stopReason)throw new Stop(stopReason)};
const append=(file:string,value:unknown)=>appendFileSync(file,JSON.stringify(value)+'\n');

async function ids(file:string,key:(v:Record<string,unknown>)=>number|null){const set=new Set<number>();for await(const {value} of ndjson<Record<string,unknown>>(file)){const k=key(value);if(k)set.add(k)}return set}
const doneDetails=await ids(files.details,v=>Number(v.id)||null);
const doneLists=new Set<string>();for await(const {value} of ndjson<{characterId:number;page:number}>(files.issueLists))doneLists.add(value.characterId+':'+value.page);
const doneIssues=await ids(files.issues,v=>Number(v.id)||null);
const missing=new Set<string>();for await(const {value} of ndjson<{kind:string;id:number;page?:number}>(files.missing))missing.add(value.kind+':'+value.id+(value.page?':'+value.page:''));

async function issueDetail(id:number){
 if(doneIssues.has(id)||missing.has('issue:'+id))return;
 const body=await call(`issue/${id}/`);if(body===undefined)return;
 if(body===null){append(files.missing,{kind:'issue',id});missing.add('issue:'+id);return}
 try{const d=parseIssueDetail(body);append(files.issues,{...d,fetchedAt:new Date().toISOString()});doneIssues.add(id)}catch(e){console.log(`  issue ${id}: ${(e as Error).message}`)}
 check();
}
async function issueList(characterId:number,page:number){
 if(doneLists.has(characterId+':'+page)||missing.has('issue_list:'+characterId+':'+page))return null;
 const body=await call(`character/${characterId}/issue_list/?page=${page}`);if(body===undefined)return null;
 if(body===null){append(files.missing,{kind:'issue_list',id:characterId,page});missing.add('issue_list:'+characterId+':'+page);return null}
 const p=parseIssueListPage(body);append(files.issueLists,{characterId,page,count:p.count,results:p.results,fetchedAt:new Date().toISOString()});doneLists.add(characterId+':'+page);
 check();return p;
}
async function characterDetail(id:number){
 if(doneDetails.has(id)||missing.has('character:'+id))return;
 const body=await call(`character/${id}/`);if(body===undefined)return;
 if(body===null){append(files.missing,{kind:'character',id});missing.add('character:'+id);return}
 try{append(files.details,{...parseCharacterDetail(body),fetchedAt:new Date().toISOString()});doneDetails.add(id)}catch(e){console.log(`  character ${id}: ${(e as Error).message}`)}
 check();
}
async function character(id:number,always:boolean){
 const p=await issueList(id,1);
 const count=p?.count??null;
 if(always||count===null||count>=detailMinIssues)await characterDetail(id);
}
async function issueCharacters(){const out:number[]=[];for await(const {value} of ndjson<{characters?:{id:number}[]}>(files.issues))for(const c of value.characters||[])out.push(c.id);return out}
async function listCharacters(){const map=new Map<number,string>();for await(const {value} of ndjson<{id:number;name:string}>(files.list))map.set(value.id,value.name);return map}
async function firstIssueIds(){const out:number[]=[];for await(const {value} of ndjson<{page:number;results:{id:number}[]}>(files.issueLists))if(value.page===1&&value.results[0])out.push(value.results[0].id);return out}

const started=Date.now();
try{
 if(phases.has('queue')){
  const q=await db.execute(sql`SELECT metron_issue_id FROM ch_web.character_enrichment_queue ORDER BY requested_at LIMIT 500`).catch(()=>({rows:[]as Record<string,unknown>[]}));
  if(q.rows.length)console.log(`queue: ${q.rows.length} issues requested by the profile API`);
  for(const r of q.rows)await issueDetail(Number(r.metron_issue_id));
 }
 if(phases.has('list')&&!state.listDone){
  for(let n=0;n<listPages&&!state.listDone;n++){
   const body=await call(`character/?page=${state.listNextPage}`);if(body===undefined)break;
   if(body===null){state.listDone=true;break}
   const p=parseCharacterListPage(body);state.listTotal=p.count;
   for(const r of p.results)append(files.list,r);
   if(!p.next)state.listDone=true;else state.listNextPage++;
   saveState();if(state.listNextPage%25===0||state.listDone)console.log(`character list: page ${state.listNextPage}${state.listTotal?' of '+Math.ceil(state.listTotal/100):''}`);
   check();
  }
 }
 if(phases.has('seeds')){
  const seeds=[...seedArg];
  if(!onlySeeds){
   const curated=Object.values(CURATED_GCD_IDS).map(g=>4000000000+g);
   const linked=await db.execute(sql`SELECT l.metron_id FROM ch_web.character_metron_issues l WHERE l.issue_id IN (SELECT (e)::bigint FROM jsonb_array_elements_text(${JSON.stringify(curated)}::jsonb) e)
    UNION SELECT l.metron_id FROM ch_web.character_metron_issues l JOIN ch_web.character_first_appearances f ON f.issue_id=l.issue_id AND f.source='wikidata' AND NOT f.suppressed`).catch(()=>({rows:[]as Record<string,unknown>[]}));
   seeds.push(...linked.rows.map(r=>Number(r.metron_id)));
  }
  const todo=[...new Set(seeds)].filter(id=>!doneIssues.has(id));
  if(todo.length)console.log(`seed issues: ${todo.length} to fetch`);
  for(const id of todo)await issueDetail(id);
 }
 if(phases.has('priority')){
  const order=await issueCharacters();
  if(!onlySeeds){
   const names=await db.execute(sql`SELECT name FROM ch_web.characters WHERE character_id<0 AND merged_into IS NULL ORDER BY sitelinks DESC NULLS LAST`).catch(()=>({rows:[]as Record<string,unknown>[]}));
   const wanted=new Map(names.rows.map((r,i)=>[normalizeCharacterText(r.name),i]));
   const matches=[...(await listCharacters())].flatMap(([id,name])=>{const rank=wanted.get(normalizeCharacterText(name));return rank===undefined?[]:[[id,rank] as const]}).sort((a,b)=>a[1]-b[1]).map(([id])=>id);
   order.push(...matches);
  }
  const todo=[...new Set(order)].filter(id=>!doneLists.has(id+':1')||!doneDetails.has(id));
  if(todo.length)console.log(`priority characters: ${todo.length} to fetch`);
  for(const id of todo)await character(id,true);
 }
 if(phases.has('keys')&&!onlySeeds)for(const id of [...new Set(await firstIssueIds())])await issueDetail(id);
 if(phases.has('tail')&&!onlySeeds){
  const all=[...(await listCharacters()).keys()].sort((a,b)=>a-b).filter(id=>!doneLists.has(id+':1'));
  if(all.length)console.log(`tail characters: ${all.length} left`);
  for(const id of all)await character(id,false);
 }
 if(phases.has('pages')&&!onlySeeds){
  const big=new Map<number,number>();for await(const {value} of ndjson<{characterId:number;page:number;count:number|null}>(files.issueLists))if(value.page===1&&(value.count||0)>100)big.set(value.characterId,value.count!);
  for(const [id,count] of [...big].sort((a,b)=>b[1]-a[1]))for(let page=2;page<=Math.ceil(count/100);page++)await issueList(id,page);
 }
 if(phases.has('issues')&&!onlySeeds){
  const tail=await db.execute(sql`SELECT metron_id FROM ch_web.character_metron_issues WHERE issue_id IS NOT NULL ORDER BY cover_date NULLS LAST,metron_id`);
  const todo=tail.rows.map(r=>Number(r.metron_id)).filter(id=>!doneIssues.has(id));
  if(todo.length)console.log(`tail issues: ${todo.length} left`);
  for(const id of todo)await issueDetail(id);
 }
 console.log('crawl complete for the selected phases.');
}catch(error){
 if(error instanceof Stop)console.log('stopping: '+error.message);else throw error;
}finally{
 saveState();
 const today=await metronBudgetToday(db).catch(()=>null);
 console.log(`calls this run: ${calls} in ${Math.round((Date.now()-started)/1000)}s; budget today: ${today?JSON.stringify(today):'n/a'}; cached: ${doneDetails.size} character details, ${doneLists.size} issue-list pages, ${doneIssues.size} issue details`);
 const pool=(globalThis as typeof globalThis&{comicHuddlePool?:{end():Promise<void>}}).comicHuddlePool;await pool?.end().catch(()=>undefined);
}
