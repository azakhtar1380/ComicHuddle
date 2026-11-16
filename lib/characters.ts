// Comic character data (migration 030): Metron payload parsing, search text, issue profiles
// ("Key Issue", first appearances, "Inside this issue", credits), character search, and the
// on-demand Metron issue enrichment used by app/api/issues/[id]/profile. Never throws on a
// missing migration: callers get status 'unavailable' / empty results.
import {sql} from 'drizzle-orm';
import type {CatalogDb} from './catalog-store';
import {catalog} from './catalog';
import {coverLookupId} from './curated-cover-ids';
import {metronDisplayBase,normalizeIssueNumber,normalizeSeriesName} from './metron-cover-index';
import {metronApiGet} from './metron-api-budget';
import {GCD_DIRECTORY_OFFSET} from './shared-catalog';

export const CHARACTER_ATTRIBUTION='Character data: Metron (metron.cloud) · Wikidata (CC0)';
export const PORTRAIT_KEY=/^metron-characters\/([1-9][0-9]{0,9})\/portrait\.webp$/;
export const portraitKey=(metronId:number)=>`metron-characters/${metronId}/portrait.webp`;
export const wikidataCharacterId=(qid:string)=>{const m=/^Q([1-9][0-9]{0,9})$/.exec(qid);const n=m?Number(m[1]):0;return n>0&&n<=2147483647?-n:null};

// ---------- text ----------
const clean=(v:unknown,max:number)=>typeof v==='string'&&v.trim()?v.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max):null;
/** lowercase, accents and apostrophes dropped, other punctuation -> space, collapsed. */
export function normalizeCharacterText(value:unknown):string{
 if(typeof value!=='string')return '';
 return value.normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/['’`]/g,'').replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
}
/** '|name|alias|...|': each element normalized, multi-word elements also stored without spaces ("spiderman"). */
export function characterSearchText(name:string,aliases:readonly string[]=[]){
 const parts:string[]=[];
 for(const raw of [name,...aliases]){const n=normalizeCharacterText(raw);if(!n)continue;parts.push(n);if(n.includes(' '))parts.push(n.replace(/ /g,''))}
 const unique=[...new Set(parts)].slice(0,40);
 return unique.length?'|'+unique.join('|')+'|':'';
}
/** Search query -> normalized phrase + words, or null when shorter than 2 characters after cleanup. */
export function characterQuery(q:string){
 const phrase=normalizeCharacterText(q);if(phrase.length<2)return null;
 return {phrase,words:[...new Set(phrase.split(' ').filter(Boolean))].slice(0,6)};
}
/** "first appears in <Series> #<n>" style statements in a Metron description. */
export function firstAppearanceFromDesc(desc:unknown):{series:string;number:string}|null{
 if(typeof desc!=='string')return null;
 const m=/first\s+(?:appear(?:s|ed|ance)?|seen)\b[^.#]{0,40}?\bin\s+(?:the\s+pages\s+of\s+)?([A-Z0-9][^#.\n]{1,80}?)\s*#\s*([0-9]+(?:\.[0-9]+)?[A-Za-z]?|½)/i.exec(desc);
 return m?{series:m[1].replace(/\s*\(\d{4}\)\s*$/,'').trim(),number:m[2]}:null;
}
export function sameIssueRef(a:{series:string|null;number:string|null},b:{series:string|null;number:string|null}){
 const sa=normalizeSeriesName(a.series),sb=normalizeSeriesName(b.series);
 return !!sa&&!!sb&&(sa===sb||sa.endsWith(' '+sb)||sb.endsWith(' '+sa)||sa.includes(sb)||sb.includes(sa))&&normalizeIssueNumber(a.number)===normalizeIssueNumber(b.number);
}

// ---------- Metron payloads ----------
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const pid=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0&&v<=2147483647?v:null;
const isoDate=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))?v:null;
export type MetronCharacterRef={id:number;name:string};
export type MetronCharacterDetail={id:number;name:string;aliases:string[];desc:string|null;image:string|null;modified:string|null};
export type MetronIssueRef={id:number;series:string|null;volume:number|null;yearBegan:number|null;number:string|null;coverDate:string|null};
export type MetronIssueDetail={id:number;series:string|null;volume:number|null;yearBegan:number|null;number:string|null;coverDate:string|null;desc:string|null;characters:MetronCharacterRef[];teams:string[];credits:{name:string;roles:string[]}[]};
export function metronImage(v:unknown){
 if(typeof v!=='string'||v.length>1024)return null;
 try{const u=new URL(v);return u.protocol==='https:'&&u.hostname==='static.metron.cloud'&&!u.username&&!u.password&&!u.port?u.href:null}catch{return null}
}
export function parseCharacterListPage(body:unknown):{count:number|null;next:boolean;results:{id:number;name:string;modified:string|null}[]}{
 if(!obj(body)||!Array.isArray(body.results))throw new Error('Metron character list: unexpected payload');
 const results=body.results.flatMap(r=>{if(!obj(r))return [];const id=pid(r.id),name=clean(r.name,200);return id&&name?[{id,name,modified:typeof r.modified==='string'?r.modified:null}]:[]});
 return {count:typeof body.count==='number'?body.count:null,next:!!body.next,results};
}
export function parseCharacterDetail(body:unknown):MetronCharacterDetail{
 if(!obj(body)||!pid(body.id)||!clean(body.name,200))throw new Error('Metron character: unexpected payload');
 const aliases=(Array.isArray(body.alias)?body.alias:[]).flatMap(a=>{const s=clean(a,200);return s?[s]:[]}).slice(0,30);
 return {id:body.id as number,name:clean(body.name,200)!,aliases,desc:clean(body.desc,4000),image:metronImage(body.image),modified:typeof body.modified==='string'?body.modified:null};
}
function issueRef(r:Record<string,unknown>):MetronIssueRef|null{
 const id=pid(r.id);if(!id)return null;const s=obj(r.series)?r.series:{};
 return {id,series:clean(s.name,300),volume:typeof s.volume==='number'&&Number.isInteger(s.volume)?s.volume:null,yearBegan:typeof s.year_began==='number'&&Number.isInteger(s.year_began)?s.year_began:null,number:clean(r.number,40),coverDate:isoDate(r.cover_date)};
}
export function parseIssueListPage(body:unknown):{count:number|null;next:boolean;results:MetronIssueRef[]}{
 if(!obj(body)||!Array.isArray(body.results))throw new Error('Metron issue list: unexpected payload');
 return {count:typeof body.count==='number'?body.count:null,next:!!body.next,results:body.results.flatMap(r=>{const x=obj(r)?issueRef(r):null;return x?[x]:[]})};
}
export function parseIssueDetail(body:unknown):MetronIssueDetail{
 if(!obj(body))throw new Error('Metron issue: unexpected payload');
 const ref=issueRef(body);if(!ref)throw new Error('Metron issue: missing id');
 const characters=[...new Map((Array.isArray(body.characters)?body.characters:[]).flatMap(c=>{if(!obj(c))return [];const id=pid(c.id),name=clean(c.name,200);return id&&name?[[id,{id,name}] as const]:[]})).values()].slice(0,300);
 const teams=[...new Set((Array.isArray(body.teams)?body.teams:[]).flatMap(t=>{const n=obj(t)?clean(t.name,200):clean(t,200);return n?[n]:[]}))].slice(0,60);
 const byName=new Map<string,Set<string>>();
 for(const c of Array.isArray(body.credits)?body.credits.slice(0,200):[]){
  if(!obj(c))continue;const name=obj(c.creator)?clean(c.creator.name,200):clean(c.creator,200);if(!name)continue;
  const roles=byName.get(name)||new Set<string>();byName.set(name,roles);
  for(const r of Array.isArray(c.role)?c.role.slice(0,15):[]){const n=obj(r)?clean(r.name,60):clean(r,60);if(n)roles.add(n)}
 }
 return {...ref,desc:clean(body.desc,4000),characters,teams,credits:[...byName].map(([name,roles])=>({name,roles:[...roles]})).slice(0,80)};
}

// ---------- table presence ----------
let present:{expires:number;value:Promise<boolean>}|null=null;
export function characterTablesPresent(db:CatalogDb){
 if(present&&present.expires>Date.now())return present.value;
 const value=db.execute(sql`SELECT to_regclass('ch_web.characters') IS NOT NULL AND to_regclass('ch_web.character_issues') IS NOT NULL AND to_regclass('ch_web.character_enrichment_queue') IS NOT NULL AS present`).then(r=>r.rows[0]?.present===true);
 present={expires:Date.now()+60000,value};void value.catch(()=>{if(present?.value===value)present=null});
 return value;
}
export function portraitUrl(key:unknown,base=metronDisplayBase()):string|null{return base&&typeof key==='string'&&PORTRAIT_KEY.test(key)?base+'/'+key:null}

// ---------- storing issue details (crawler import + on-demand) ----------
export async function storeIssueDetails(db:CatalogDb,details:MetronIssueDetail[]){
 if(!details.length)return 0;
 const rows=details.map(d=>({metron_id:d.id,description:d.desc,characters:d.characters,teams:d.teams,credits:d.credits}));
 await db.execute(sql`INSERT INTO ch_web.metron_issue_details AS d(metron_id,issue_id,description,characters,teams,credits,fetched_at)
  SELECT x.metron_id,(SELECT l.issue_id FROM ch_web.character_metron_issues l WHERE l.metron_id=x.metron_id),x.description,x.characters,x.teams,x.credits,now()
  FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(metron_id integer,description text,characters jsonb,teams jsonb,credits jsonb)
  ON CONFLICT(metron_id) DO UPDATE SET issue_id=COALESCE(excluded.issue_id,d.issue_id),description=excluded.description,characters=excluded.characters,teams=excluded.teams,credits=excluded.credits,fetched_at=now()`);
 const chars=[...new Map(details.flatMap(d=>d.characters.map(c=>[c.id,c] as const))).values()].map(c=>({id:c.id,name:c.name,search:characterSearchText(c.name)}));
 if(chars.length)await db.execute(sql`INSERT INTO ch_web.characters(character_id,metron_id,name,search_text)
  SELECT x.id,x.id,x.name,x.search FROM jsonb_to_recordset(${JSON.stringify(chars)}::jsonb) AS x(id integer,name text,search text) ON CONFLICT(character_id) DO NOTHING`);
 const pairs=details.flatMap(d=>d.characters.map(c=>({c:c.id,m:d.id})));
 if(pairs.length){
  await db.execute(sql`INSERT INTO ch_web.character_appearances(character_id,metron_issue_id) SELECT x.c,x.m FROM jsonb_to_recordset(${JSON.stringify(pairs)}::jsonb) AS x(c integer,m integer) ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO ch_web.character_issues(character_id,issue_id) SELECT x.c,l.issue_id FROM jsonb_to_recordset(${JSON.stringify(pairs)}::jsonb) AS x(c integer,m integer)
   JOIN ch_web.character_metron_issues l ON l.metron_id=x.m AND l.issue_id IS NOT NULL ON CONFLICT DO NOTHING`);
 }
 await db.execute(sql`DELETE FROM ch_web.character_enrichment_queue WHERE metron_issue_id IN (SELECT (e)::integer FROM jsonb_array_elements_text(${JSON.stringify(details.map(d=>d.id))}::jsonb) e)`);
 return details.length;
}

// ---------- issue resolution ----------
export type ResolvedIssue={requestedId:number;issueId:number|null;metronId:number|null};
/** Directory id -> catalog lookup id (4000000000 + GCD id) and Metron id; null when the issue is unknown. */
export async function resolveProfileIssue(db:CatalogDb,id:number,tables:boolean):Promise<ResolvedIssue|null>{
 let issueId:number|null=null,metronId:number|null=null;
 if(id>=GCD_DIRECTORY_OFFSET){
  const r=await db.execute(sql`SELECT 1 FROM gcd.gcd_issue WHERE id=${id-GCD_DIRECTORY_OFFSET} AND COALESCE(deleted,0)=0`);
  if(!r.rows.length)return null;issueId=id;
 }else if(catalog.some(issue=>issue.id===id)){issueId=coverLookupId(id)}
 else{
  const r=await db.execute(sql`SELECT gcd_id,metron_id FROM ch_web.catalog_issues WHERE id=${id}`);
  if(!r.rows.length)return null;
  issueId=r.rows[0].gcd_id?GCD_DIRECTORY_OFFSET+Number(r.rows[0].gcd_id):null;metronId=r.rows[0].metron_id?Number(r.rows[0].metron_id):null;
 }
 if(issueId&&!metronId){
  const links=await db.execute(sql`SELECT metron_id,rank FROM (
    SELECT metron_id,CASE WHEN COALESCE(match_method,'') LIKE 'exact%' THEN 0 ELSE 1 END AS rank FROM ch_web.metron_cover_index WHERE issue_id=${issueId}
    ${tables?sql`UNION ALL SELECT metron_id,CASE WHEN COALESCE(match_method,'') LIKE 'exact%' THEN 0 ELSE 2 END FROM ch_web.character_metron_issues WHERE issue_id=${issueId}`:sql``}
   ) x ORDER BY rank,metron_id LIMIT 1`).catch(()=>({rows:[]as Record<string,unknown>[]}));
  metronId=links.rows[0]?Number(links.rows[0].metron_id):null;
 }
 return {requestedId:id,issueId,metronId};
}

// ---------- verified first appearances ----------
/** A first-appearance fact is shown as fact only when a source states it: a Wikidata P4584
 * "first appearance" claim, or a Metron character description that names this exact issue
 * (match_method metron_desc_confirmed). "metron_issue_list" only means "earliest issue Metron has
 * indexed for the character" — an inference that is often wrong (e.g. Dick Grayson -> Batman #1,
 * Lex Luthor -> Superman #4, Darkseid -> Jimmy Olsen #134), so it is never shown as a first
 * appearance or used to call an issue a key issue. Hand-checked rows (source 'reference', lib/first-appearance-reference.ts)
 * outrank both and hide any conflicting row for that character. */
export const VERIFIED_FIRST_APPEARANCE=sql`NOT suppressed AND (source='reference' OR source='wikidata' AND match_method NOT IN ('name_only','name_only_dominant') OR match_method='metron_desc_confirmed')`;
const VERIFIED_FIRST_APPEARANCE_F=sql`NOT f.suppressed AND (f.source='reference' OR f.source='wikidata' AND f.match_method NOT IN ('name_only','name_only_dominant') OR f.match_method='metron_desc_confirmed')`;
const VERIFIED_FIRST_ORDER=sql`(source='reference') DESC,(match_method='metron_desc_confirmed') DESC,(source='wikidata') DESC`;

// ---------- profile ----------
export type ProfileCharacter={characterId:number;name:string;portraitUrl:string|null;debut:boolean};
export type ProfileFirstAppearance={characterId:number;name:string;portraitUrl:string|null;source:'metron'|'wikidata'|'reference'};
export type IssueProfile={issueId:number;metronId:number|null;status:'ready'|'pending'|'unavailable';keyIssue:boolean;keyReasons:string[];description:string|null;
 firstAppearances:ProfileFirstAppearance[];characters:ProfileCharacter[];teams:string[];credits:{name:string;roles:string[]}[];attribution:string;catalogIssueId?:number|null};
export const emptyProfile=(issueId:number,metronId:number|null=null,status:IssueProfile['status']='unavailable'):IssueProfile=>({issueId,metronId,status,keyIssue:false,keyReasons:[],description:null,firstAppearances:[],characters:[],teams:[],credits:[],attribution:CHARACTER_ATTRIBUTION});

export type FactRow={characterId:number;name:string;source:'metron'|'wikidata'|'reference';portraitKey:string|null;issueCount:number|null;sitelinks:number|null};
export type CharacterRow={characterId:number;name:string;portraitKey:string|null;issueCount:number|null;aliases?:string[]};
export type ProfileInput={issueId:number;metronId:number|null;status:IssueProfile['status'];detail:{description:string|null;characters:MetronCharacterRef[];teams:string[];credits:{name:string;roles:string[]}[]}|null;
 facts:FactRow[];known:Map<number,CharacterRow>;listed:CharacterRow[];base:string|null};
/** Pure assembly of the profile contract (unit-tested). */
export function buildProfile(input:ProfileInput):IssueProfile{
 const {base}=input,url=(key:string|null)=>portraitUrl(key,base);
 const detailChars:CharacterRow[]=(input.detail?.characters||[]).map(c=>input.known.get(c.id)||{characterId:c.id,name:c.name,portraitKey:null,issueCount:null});
 const pool=new Map<number,CharacterRow>();for(const c of [...detailChars,...input.listed])if(!pool.has(c.characterId))pool.set(c.characterId,c);
 // Twins are Metron characters (id > 0) listed in this issue.
 const metron=[...pool.values()].filter(c=>c.characterId>0);
 const byName=new Map<string,CharacterRow>();for(const c of metron){const n=normalizeCharacterText(c.name);if(n&&!byName.has(n))byName.set(n,c)}
 // Aliases second, so a real name always wins ("Peter Parker" -> Spider-Man only if no Peter Parker is listed).
 for(const c of metron)for(const a of c.aliases||[]){const n=normalizeCharacterText(a);if(n&&!byName.has(n))byName.set(n,c)}
 // One entry per character: Metron facts win over Wikidata; a Wikidata-only fact whose name matches a
 // Metron character listed in this issue is shown as that character (portrait, id).
 const weight=(f:FactRow)=>f.issueCount??-1;
 const facts=[...input.facts].sort((a,b)=>(a.source==='reference'?0:a.source==='metron'?1:2)-(b.source==='reference'?0:b.source==='metron'?1:2)||weight(b)-weight(a)||(b.sitelinks??0)-(a.sitelinks??0)||a.name.localeCompare(b.name));
 const seenIds=new Set<number>(),seenNames=new Set<string>(),factIds=new Set(facts.map(f=>f.characterId)),first:(ProfileFirstAppearance&{w:number;s:number})[]=[];
 for(const f of facts){
  const twin=f.characterId<0?byName.get(normalizeCharacterText(f.name)):undefined;
  const id=twin?twin.characterId:f.characterId,name=twin?twin.name:f.name,key=normalizeCharacterText(name);
  if(seenIds.has(id)||seenNames.has(key))continue;seenIds.add(id);seenNames.add(key);
  first.push({characterId:id,name,portraitUrl:url(twin?twin.portraitKey:f.portraitKey),source:f.source,w:twin?.issueCount??f.issueCount??-1,s:f.sitelinks??0});
 }
 first.sort((a,b)=>b.w-a.w||b.s-a.s||a.name.localeCompare(b.name));
 const firstAppearances:ProfileFirstAppearance[]=first.map(f=>({characterId:f.characterId,name:f.name,portraitUrl:f.portraitUrl,source:f.source}));
 const characters:ProfileCharacter[]=[];const listedIds=new Set<number>();
 for(const f of firstAppearances){characters.push({characterId:f.characterId,name:f.name,portraitUrl:f.portraitUrl,debut:true});listedIds.add(f.characterId)}
 const rest=[...detailChars,...[...input.listed].sort((a,b)=>(b.issueCount??-1)-(a.issueCount??-1)||a.name.localeCompare(b.name))];
 for(const c of rest){if(characters.length>=40)break;if(listedIds.has(c.characterId)||factIds.has(c.characterId)||seenNames.has(normalizeCharacterText(c.name)))continue;listedIds.add(c.characterId);characters.push({characterId:c.characterId,name:c.name,portraitUrl:url(c.portraitKey),debut:false})}
 return {issueId:input.issueId,metronId:input.metronId,status:input.status,keyIssue:firstAppearances.length>0,keyReasons:firstAppearances.slice(0,12).map(f=>'First appearance of '+f.name),
  description:input.detail?.description??null,firstAppearances,characters:characters.slice(0,40),teams:input.detail?.teams.slice(0,30)||[],credits:input.detail?.credits.slice(0,40)||[],attribution:CHARACTER_ATTRIBUTION};
}

const asDetail=(row:Record<string,unknown>|undefined)=>row?{description:typeof row.description==='string'?row.description:null,
 characters:Array.isArray(row.characters)?(row.characters as unknown[]).flatMap(c=>obj(c)&&pid(c.id)&&typeof c.name==='string'?[{id:c.id as number,name:c.name}]:[]):[],
 teams:Array.isArray(row.teams)?(row.teams as unknown[]).filter((t):t is string=>typeof t==='string'):[],
 credits:Array.isArray(row.credits)?(row.credits as unknown[]).flatMap(c=>obj(c)&&typeof c.name==='string'&&Array.isArray(c.roles)?[{name:c.name,roles:(c.roles as unknown[]).filter((r):r is string=>typeof r==='string')}]:[]):[]}:null;

async function loadDetail(db:CatalogDb,issueId:number|null,metronId:number|null){
 if(!issueId&&!metronId)return null;
 const r=await db.execute(sql`SELECT description,characters,teams,credits FROM ch_web.metron_issue_details
  WHERE ${metronId?sql`metron_id=${metronId}`:sql`false`} OR ${issueId?sql`issue_id=${issueId}`:sql`false`} ORDER BY (metron_id=${metronId??0}) DESC,fetched_at DESC LIMIT 1`);
 return asDetail(r.rows[0]);
}
/** Fetches issue/{id}/ once within the deadline (shared budget); otherwise queues it. */
export async function enrichIssueOnDemand(db:CatalogDb,metronId:number,issueId:number|null,deadlineMs:number,deps:{fetcher?:typeof fetch;env?:Record<string,string|undefined>}={}){
 const claim=await db.execute(sql`INSERT INTO ch_web.character_enrichment_queue AS q(metron_issue_id,issue_id,last_attempt_at,attempts) VALUES(${metronId},${issueId},now(),1)
  ON CONFLICT(metron_issue_id) DO UPDATE SET last_attempt_at=now(),attempts=q.attempts+1
  WHERE q.last_attempt_at IS NULL OR q.last_attempt_at<now()-interval '10 minutes' RETURNING attempts`);
 if(!claim.rows.length)return false; // another request tried recently: stay pending
 const timeoutMs=Math.min(2000,deadlineMs-Date.now());
 if(timeoutMs<400)return false;
 const result=await metronApiGet(db,`issue/${metronId}/`,{caller:'app',timeoutMs,fetcher:deps.fetcher,env:deps.env});
 if(result.status!=='ok'){
  await db.execute(sql`UPDATE ch_web.character_enrichment_queue SET last_error=${result.status==='error'?result.code:result.status==='budget'?'budget_'+result.reason:'not_found'} WHERE metron_issue_id=${metronId}`);
  return false;
 }
 try{await storeIssueDetails(db,[parseIssueDetail(result.body)]);return true}
 catch{await db.execute(sql`UPDATE ch_web.character_enrichment_queue SET last_error='bad_response' WHERE metron_issue_id=${metronId}`);return false}
}

export async function issueProfile(db:CatalogDb,id:number,options:{enrich?:boolean;deadlineMs?:number;fetcher?:typeof fetch;env?:Record<string,string|undefined>}={}):Promise<IssueProfile|null>{
 const deadline=options.deadlineMs??Date.now()+2500;
 const tables=await characterTablesPresent(db).catch(()=>false);
 const resolved=await resolveProfileIssue(db,id,tables);if(!resolved)return null;
 const {issueId,metronId}=resolved;
 if(!tables)return {...emptyProfile(id,metronId),catalogIssueId:issueId};
 try{
  let detail=await loadDetail(db,issueId,metronId),status:IssueProfile['status']='ready';
  if(!detail&&metronId){
   if(options.enrich!==false&&await enrichIssueOnDemand(db,metronId,issueId,deadline,options).catch(()=>false))detail=await loadDetail(db,issueId,metronId);
   if(!detail)status='pending';
  }
  const [factRows,listedRows]=issueId?await Promise.all([
   db.execute(sql`SELECT f.character_id,f.source,c.name,c.portrait_key,c.issue_count,c.sitelinks FROM ch_web.character_first_appearances f
    JOIN ch_web.characters c ON c.character_id=f.character_id WHERE f.issue_id=${issueId} AND ${VERIFIED_FIRST_APPEARANCE_F} AND c.merged_into IS NULL LIMIT 60`),
   db.execute(sql`SELECT c.character_id,c.name,c.portrait_key,c.issue_count,c.aliases FROM ch_web.character_issues ci JOIN ch_web.characters c ON c.character_id=ci.character_id
    WHERE ci.issue_id=${issueId} AND c.merged_into IS NULL ORDER BY c.issue_count DESC NULLS LAST,c.character_id LIMIT 120`),
  ]):[{rows:[]},{rows:[]}];
  const ids=(detail?.characters||[]).map(c=>c.id).slice(0,300);
  const knownRows=ids.length?(await db.execute(sql`SELECT character_id,name,portrait_key,issue_count,aliases FROM ch_web.characters WHERE character_id IN (${sql.join(ids.map(i=>sql`${i}`),sql`,`)})`)).rows:[];
  const row=(r:Record<string,unknown>):CharacterRow=>({characterId:Number(r.character_id),name:String(r.name),portraitKey:typeof r.portrait_key==='string'?r.portrait_key:null,issueCount:r.issue_count===null||r.issue_count===undefined?null:Number(r.issue_count),aliases:Array.isArray(r.aliases)?(r.aliases as unknown[]).filter((a):a is string=>typeof a==='string'):[]});
  const facts:FactRow[]=factRows.rows.map(r=>({...row(r),source:r.source==='metron'?'metron':r.source==='reference'?'reference':'wikidata',sitelinks:r.sitelinks===null||r.sitelinks===undefined?null:Number(r.sitelinks)}));
  if(!detail&&!metronId&&!facts.length&&!listedRows.rows.length)status='unavailable';
  const profile=buildProfile({issueId:id,metronId,status,detail,facts,known:new Map(knownRows.map(r=>[Number(r.character_id),row(r)])),listed:listedRows.rows.map(row),base:metronDisplayBase()});
  return {...profile,catalogIssueId:issueId};
 }catch(error){
  console.warn('Issue profile character data deferred: '+((error as {code?:string})?.code||'error'));
  return {...emptyProfile(id,metronId),catalogIssueId:issueId};
 }
}

// ---------- search ----------
export type CharacterSearchResult={characterId:number;name:string;portraitUrl:string|null;issueCount:number|null;firstAppearance:{issueId:number;title:string;number:string;year:number|null}|null};
export async function searchCharacters(db:CatalogDb,q:string,limit:number):Promise<CharacterSearchResult[]>{
 const query=characterQuery(q);if(!query)return [];
 if(!await characterTablesPresent(db).catch(()=>false))return [];
 const {phrase,words}=query;
 const all=sql.join(words.map(w=>sql`c.search_text LIKE ${'%'+w+'%'}`),sql` AND `);
 const rows=await db.execute(sql`WITH hits AS (
   SELECT c.character_id,c.name,c.portrait_key,c.issue_count,c.sitelinks,
    CASE WHEN c.search_text LIKE ${'|'+phrase+'|%'} THEN 0 WHEN c.search_text LIKE ${'%|'+phrase+'|%'} THEN 1
     WHEN c.search_text LIKE ${'|'+phrase+'%'} THEN 2 WHEN c.search_text LIKE ${'%|'+phrase+'%'} THEN 3
     WHEN c.search_text LIKE ${'% '+phrase+'%'} THEN 4 WHEN c.search_text LIKE ${'%'+phrase+'%'} THEN 5 ELSE 6 END AS rank
   FROM ch_web.characters c WHERE c.merged_into IS NULL AND ${all}
   ORDER BY rank,(c.character_id<0 AND COALESCE(c.sitelinks,0)<=3),c.issue_count DESC NULLS LAST,c.sitelinks DESC NULLS LAST,length(c.name),c.character_id LIMIT ${limit})
  SELECT h.*,f.issue_id,s.name AS series,i.number,CASE WHEN i.key_date ~ '^[0-9]{4}' THEN substring(i.key_date,1,4)::integer END AS year
  FROM hits h
  LEFT JOIN LATERAL (SELECT issue_id FROM ch_web.character_first_appearances WHERE character_id=h.character_id AND issue_id IS NOT NULL AND ${VERIFIED_FIRST_APPEARANCE} ORDER BY ${VERIFIED_FIRST_ORDER} LIMIT 1) f ON true
  LEFT JOIN gcd.gcd_issue i ON i.id=f.issue_id-${GCD_DIRECTORY_OFFSET}
  LEFT JOIN gcd.gcd_series s ON s.id=i.series_id
  ORDER BY h.rank,(h.character_id<0 AND COALESCE(h.sitelinks,0)<=3),h.issue_count DESC NULLS LAST,h.sitelinks DESC NULLS LAST,length(h.name),h.character_id`);
 const base=metronDisplayBase();
 return rows.rows.map(r=>({characterId:Number(r.character_id),name:String(r.name),portraitUrl:portraitUrl(r.portrait_key,base),issueCount:r.issue_count===null||r.issue_count===undefined?null:Number(r.issue_count),
  firstAppearance:r.issue_id&&r.series?{issueId:Number(r.issue_id),title:String(r.series),number:String(r.number??''),year:r.year===null||r.year===undefined?null:Number(r.year)}:null}));
}

/** Directory character filter: catalog issue ids (4000000000 + GCD id) known to contain the character. */
export const characterIssueIds=(characterId:number)=>sql`SELECT issue_id FROM ch_web.character_issues WHERE character_id=${characterId}`;

// ---------- route parameter validation ----------
/** Directory issue id path segment (curated 0–42, Metron/legacy, or 4000000000 + GCD id); null when malformed. */
export function profileIssueId(raw:string):number|null{
 if(!/^\d{1,16}$/.test(raw))return null;
 const id=Number(raw);return Number.isSafeInteger(id)?id:null;
}
/** /api/characters/search: q 2–80 characters, limit 1–20 (default 8), no other parameters; null when invalid. */
export function characterSearchParams(params:URLSearchParams):{q:string;limit:number}|null{
 if([...params.keys()].some(k=>k!=='q'&&k!=='limit')||params.getAll('q').length!==1||params.getAll('limit').length>1)return null;
 const q=(params.get('q')||'').trim(),rawLimit=params.get('limit');
 if(q.length<2||q.length>80)return null;
 if(rawLimit!==null&&!/^\d{1,2}$/.test(rawLimit))return null;
 const limit=rawLimit===null?8:Number(rawLimit);
 return limit>=1&&limit<=20?{q,limit}:null;
}

/** One character for its public page (/characters/[id]). Follows merges to the surviving row. */
export type CharacterPage={characterId:number;name:string;aliases:string[];description:string|null;portraitUrl:string|null;issueCount:number|null;knownIssues:number;
 firstAppearance:{issueId:number;title:string;number:string;year:number|null;publisher:string|null}|null;source:string};
export async function characterPage(db:CatalogDb,characterId:number):Promise<CharacterPage|null>{
 if(!Number.isSafeInteger(characterId)||characterId===0||!await characterTablesPresent(db).catch(()=>false))return null;
 const found=await db.execute(sql`SELECT COALESCE(merged_into,character_id) AS id FROM ch_web.characters WHERE character_id=${characterId}`);
 if(!found.rows[0])return null;
 const id=Number(found.rows[0].id);
 const rows=await db.execute(sql`SELECT c.character_id,c.name,c.aliases,c.description,c.portrait_key,c.issue_count,c.metron_id,c.wikidata_qid,
   (SELECT count(*) FROM ch_web.character_issues ci WHERE ci.character_id=c.character_id)::integer AS known,
   f.issue_id,s.name AS series,i.number,p.name AS publisher,CASE WHEN i.key_date ~ '^[0-9]{4}' THEN substring(i.key_date,1,4)::integer END AS year
  FROM ch_web.characters c
  LEFT JOIN LATERAL (SELECT issue_id FROM ch_web.character_first_appearances WHERE character_id=c.character_id AND issue_id IS NOT NULL AND ${VERIFIED_FIRST_APPEARANCE} ORDER BY ${VERIFIED_FIRST_ORDER} LIMIT 1) f ON true
  LEFT JOIN gcd.gcd_issue i ON i.id=f.issue_id-${GCD_DIRECTORY_OFFSET}
  LEFT JOIN gcd.gcd_series s ON s.id=i.series_id
  LEFT JOIN gcd.gcd_publisher p ON p.id=s.publisher_id
  WHERE c.character_id=${id}`);
 const r=rows.rows[0];if(!r)return null;
 const aliases=Array.isArray(r.aliases)?(r.aliases as unknown[]).filter((a):a is string=>typeof a==='string'&&!!a.trim()):[];
 return {characterId:Number(r.character_id),name:String(r.name),aliases:aliases.slice(0,12),description:typeof r.description==='string'&&r.description.trim()?r.description.trim():null,
  portraitUrl:portraitUrl(r.portrait_key),issueCount:r.issue_count===null||r.issue_count===undefined?null:Number(r.issue_count),knownIssues:Number(r.known||0),
  firstAppearance:r.issue_id&&r.series?{issueId:Number(r.issue_id),title:String(r.series),number:String(r.number??''),year:r.year===null||r.year===undefined?null:Number(r.year),publisher:r.publisher?String(r.publisher):null}:null,
  source:[r.metron_id?'Metron (metron.cloud)':null,r.wikidata_qid?'Wikidata (CC0)':null].filter(Boolean).join(' · ')||'ComicHuddle'};
}

/** Character browse for /characters: popular (portraits and most appearances first) or A–Z, optional first letter. */
export type CharacterBrowse={characters:CharacterSearchResult[];total:number;offset:number;limit:number};
export function characterBrowseParams(params:URLSearchParams):{letter:string|null;sort:'popular'|'az';offset:number;limit:number}|null{
 const allowed=['letter','sort','offset','limit'];if([...params.keys()].some(k=>!allowed.includes(k)))return null;
 const letter=params.get('letter'),sort=params.get('sort')||'popular',offset=Number(params.get('offset')||0),limit=Number(params.get('limit')||24);
 if(letter!==null&&!/^([a-z]|#)$/i.test(letter))return null;
 if(sort!=='popular'&&sort!=='az')return null;
 if(!Number.isSafeInteger(offset)||offset<0||offset>200000||!Number.isSafeInteger(limit)||limit<1||limit>60)return null;
 return {letter:letter?letter.toLowerCase():null,sort,offset,limit};
}
export async function browseCharacters(db:CatalogDb,options:{letter:string|null;sort:'popular'|'az';offset:number;limit:number}):Promise<CharacterBrowse>{
 const empty={characters:[],total:0,offset:options.offset,limit:options.limit};
 if(!await characterTablesPresent(db).catch(()=>false))return empty;
 const letter=options.letter==='#'?sql`AND lower(c.name) !~ '^[a-z]'`:options.letter?sql`AND lower(c.name) LIKE ${options.letter+'%'}`:sql``;
 // Wikidata-only minor entries (few sitelinks, no Metron record) are left out of browsing; they stay searchable.
 const visible=sql`c.merged_into IS NULL AND (c.metron_id IS NOT NULL OR COALESCE(c.sitelinks,0)>3) ${letter}`;
 const order=options.sort==='az'?sql`lower(c.name),c.character_id`:sql`(c.portrait_key IS NULL),c.issue_count DESC NULLS LAST,c.sitelinks DESC NULLS LAST,lower(c.name),c.character_id`;
 const [count,rows]=await Promise.all([
  db.execute(sql`SELECT count(*)::integer AS n FROM ch_web.characters c WHERE ${visible}`),
  db.execute(sql`WITH page AS (SELECT c.character_id,c.name,c.portrait_key,c.issue_count FROM ch_web.characters c WHERE ${visible} ORDER BY ${order} LIMIT ${options.limit} OFFSET ${options.offset})
   SELECT p.*,f.issue_id,s.name AS series,i.number,CASE WHEN i.key_date ~ '^[0-9]{4}' THEN substring(i.key_date,1,4)::integer END AS year FROM page p
   LEFT JOIN LATERAL (SELECT issue_id FROM ch_web.character_first_appearances WHERE character_id=p.character_id AND issue_id IS NOT NULL AND ${VERIFIED_FIRST_APPEARANCE} ORDER BY ${VERIFIED_FIRST_ORDER} LIMIT 1) f ON true
   LEFT JOIN gcd.gcd_issue i ON i.id=f.issue_id-${GCD_DIRECTORY_OFFSET} LEFT JOIN gcd.gcd_series s ON s.id=i.series_id`)]);
 const base=metronDisplayBase(),position=new Map<number,number>();
 const list=rows.rows.map((r,index)=>{position.set(Number(r.character_id),index);return {characterId:Number(r.character_id),name:String(r.name),portraitUrl:portraitUrl(r.portrait_key,base),issueCount:r.issue_count===null||r.issue_count===undefined?null:Number(r.issue_count),
  firstAppearance:r.issue_id&&r.series?{issueId:Number(r.issue_id),title:String(r.series),number:String(r.number??''),year:r.year===null||r.year===undefined?null:Number(r.year)}:null}});
 return {characters:list,total:Number(count.rows[0]?.n||0),offset:options.offset,limit:options.limit};
}
