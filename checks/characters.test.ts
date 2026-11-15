// Character data (migration 030): parsing, search text, Wikidata/Metron first-appearance rules,
// profile assembly, route validation, the shared Metron budget, and the DB paths (links, import,
// profile with on-demand enrichment via a stub fetcher, search, catalog character filter) in an
// isolated PGlite database. No Metron, Wikidata or S3 calls.
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {Pool} from 'pg';
import {nativeGcdFixture} from './native-gcd-fixture';
import {getDb} from '../db';
import {seedStarterStatements,searchSharedCatalog} from '../lib/catalog-store';
import {buildProfile,characterQuery,characterSearchParams,characterSearchText,firstAppearanceFromDesc,issueProfile,normalizeCharacterText,parseCharacterDetail,parseIssueDetail,parseIssueListPage,profileIssueId,sameIssueRef,searchCharacters,wikidataCharacterId,type FactRow} from '../lib/characters';
import {groupFacts,matchFactByName,matchFactViaMetron,parseSparqlJson,splitIssueLabel,type WikidataFact} from '../lib/characters-wikidata';
import {finalizeCharacters,importCharacterDetails,importCharacterList,importIssueLists,linkMetronIssues,matchWikidataFacts,metronFirstAppearance,metronNameIndex,storeWikidataFacts,type HarvestedIssue} from '../lib/characters-import';
import {allowedMetronPath,metronBudgetLimits,reserveMetronCalls} from '../lib/metron-api-budget';

test('character text normalization and search text',()=>{
 assert.equal(normalizeCharacterText('Spider-Man'),'spider man');
 assert.equal(normalizeCharacterText("Ra's al Ghul"),'ras al ghul');
 assert.equal(normalizeCharacterText('Señor Óscuro'),'senor oscuro');
 assert.equal(characterSearchText('Spider-Man',['Peter Parker','spider man']),'|spider man|spiderman|peter parker|peterparker|');
 assert.equal(characterSearchText(''),'');
 assert.deepEqual(characterQuery('  The Joker '),{phrase:'the joker',words:['the','joker']});
 assert.equal(characterQuery('!'),null);assert.equal(characterQuery('a'),null);
 assert.equal(wikidataCharacterId('Q79037'),-79037);assert.equal(wikidataCharacterId('P1'),null);assert.equal(wikidataCharacterId('Q0'),null);
});

test('Metron payload parsing keeps only safe, bounded fields',()=>{
 const d=parseCharacterDetail({id:5,name:' Joker ',alias:['The Clown Prince of Crime',7],desc:'x',image:'https://evil.example/a.jpg',modified:'2024-01-01T00:00:00Z'});
 assert.deepEqual(d,{id:5,name:'Joker',aliases:['The Clown Prince of Crime'],desc:'x',image:null,modified:'2024-01-01T00:00:00Z'});
 assert.equal(parseCharacterDetail({id:5,name:'J',image:'https://static.metron.cloud/media/character/j.jpg'}).image,'https://static.metron.cloud/media/character/j.jpg');
 assert.throws(()=>parseCharacterDetail({id:'5',name:'J'}));
 const issue=parseIssueDetail({id:9,series:{name:'Batman',volume:1,year_began:1940},number:'1',cover_date:'1940-04-01',desc:'Debut.',
  characters:[{id:1,name:'Batman'},{id:2,name:'Joker'},{id:2,name:'Joker'},{id:'x',name:'bad'}],teams:[{id:3,name:'Justice League'}],
  credits:[{creator:'Bob Kane',role:[{id:1,name:'Writer'},{id:2,name:'Penciller'}]},{creator:{name:'Bill Finger'},role:[{name:'Writer'}]},{creator:'Bob Kane',role:[{name:'Cover'}]}]});
 assert.deepEqual(issue.characters,[{id:1,name:'Batman'},{id:2,name:'Joker'}]);
 assert.deepEqual(issue.teams,['Justice League']);
 assert.deepEqual(issue.credits,[{name:'Bob Kane',roles:['Writer','Penciller','Cover']},{name:'Bill Finger',roles:['Writer']}]);
 const list=parseIssueListPage({count:2,next:null,results:[{id:9,series:{name:'Batman',volume:1,year_began:1940},number:'1',cover_date:'1940-04-01'},{bad:true}]});
 assert.deepEqual(list,{count:2,next:false,results:[{id:9,series:'Batman',volume:1,yearBegan:1940,number:'1',coverDate:'1940-04-01'}]});
});

test('first appearance: description statements, ties and conflicts',()=>{
 assert.deepEqual(firstAppearanceFromDesc('The Joker first appeared in Batman #1 (Spring 1940).'),{series:'Batman',number:'1'});
 assert.deepEqual(firstAppearanceFromDesc('He first appears in The Amazing Spider-Man (1963) #129.'),{series:'The Amazing Spider-Man',number:'129'});
 assert.equal(firstAppearanceFromDesc('A villain.'),null);
 assert.ok(sameIssueRef({series:'Amazing Spider-Man',number:'129'},{series:'The Amazing Spider-Man',number:'129'}));
 assert.ok(!sameIssueRef({series:'Batman',number:'1'},{series:'Detective Comics',number:'27'}));
 const ref=(id:number,coverDate:string,series='Batman',number='1')=>({id,series,volume:1,yearBegan:1940,number,coverDate});
 assert.equal(metronFirstAppearance({characterId:1,page:1,count:2,results:[ref(9,'1940-04-01'),ref(10,'1940-05-01','Batman','2')]},null)?.method,'metron_issue_list');
 assert.equal(metronFirstAppearance({characterId:1,page:1,count:2,results:[ref(9,'1940-04-01'),ref(11,'1940-04-01','Detective Comics','38')]},null)?.method,'metron_issue_list_tie');
 assert.equal(metronFirstAppearance({characterId:1,page:1,count:2,results:[ref(9,'1940-04-01'),ref(11,'1940-04-01','Detective Comics','38')]},'First appeared in Batman #1.')?.method,'metron_desc_confirmed');
 assert.equal(metronFirstAppearance({characterId:1,page:1,count:1,results:[ref(9,'1940-04-01')]},'First appeared in Detective Comics #27.')?.method,'metron_desc_conflict');
 assert.equal(metronFirstAppearance({characterId:1,page:1,count:0,results:[]},null),null);
});

test('Wikidata rows group into one fact per character and match uniquely',()=>{
 assert.deepEqual(splitIssueLabel('Amazing Fantasy #15'),{series:'Amazing Fantasy',number:'15'});
 assert.equal(splitIssueLabel('Amazing Fantasy'),null);
 const b=(o:Record<string,string>)=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,{value:v}]));
 const E='http://www.wikidata.org/entity/';
 const rows=parseSparqlJson({results:{bindings:[
  b({char:E+'Q79037',charL:'Spider-Man',t:E+'Q118419196',tL:'Amazing Fantasy #15',serL:'Amazing Fantasy',gcd:'17099',date:'1962-08-01T00:00:00Z'}),
  b({char:E+'Q79037',charL:'Spider-Man',t:E+'Q118419196',tL:'Amazing Fantasy #15',serL:'Amazing Fantasy',gcd:'17099',date:'1962-06-05T00:00:00Z'}),
  b({char:E+'Q79037',charL:'Spider-Man',t:E+'Q5',tL:'Some Cartoon'}),
  b({char:E+'Q534153',charL:'Captain Marvel',t:E+'Q8',tL:'Whiz Comics',qnum:'2',qdate:'1940-02-01T00:00:00Z'}),
  b({char:E+'Q9',charL:'Q9',t:E+'Q10',tL:'X #1'}),
 ]}});
 const facts=groupFacts(rows);
 assert.deepEqual(facts.map(f=>[f.qid,f.series,f.number,f.years,f.gcdIssueId]),[['Q534153',['Whiz Comics'],'2',[1940],null],['Q79037',['Amazing Fantasy'],'15',[1962],17099]]);
 const fact=(series:string[],number:string,years:number[]):WikidataFact=>({qid:'Q1',name:'X',issueQid:'Q2',issueLabel:null,series,number,years,gcdIssueId:null});
 const byName=new Map([['whiz comics',[{id:1,name:'Whiz Comics',yearBegan:1940,issueCount:155}]],['batman',[{id:141,name:'Batman',yearBegan:1940,issueCount:715},{id:999,name:'Batman',yearBegan:2016,issueCount:150},{id:777,name:'Batman',yearBegan:1940,issueCount:500}]]]);
 const issues=new Map([[1,[{id:10,seriesId:1,number:'2',year:1940},{id:11,seriesId:1,number:'3',year:1940}]],[141,[{id:724,seriesId:141,number:'1',year:1940}]],[999,[{id:5,seriesId:999,number:'1',year:2016}]],[777,[{id:6,seriesId:777,number:'1',year:1941}]]]);
 assert.deepEqual(matchFactByName(fact(['Whiz Comics'],'2',[1940]),byName,issues),{issueId:4000000010,method:'name_year'});
 assert.deepEqual(matchFactByName(fact(['Batman'],'1',[1940]),byName,issues),{issueId:4000000724,method:'name_year'},'year picks the 1940 series');
 assert.deepEqual(matchFactByName(fact(['Batman'],'1',[]),byName,issues),{issueId:null,method:'ambiguous'},'no year, three similar series');
 assert.deepEqual(matchFactByName(fact(['Batman'],'1',[1939]),byName,issues),{issueId:4000000724,method:'name_year1'},'cover year may be the year after publication');
 assert.equal(matchFactByName(fact(['Nope'],'1',[1940]),byName,issues).issueId,null);
 const index=new Map([['batman|1',[{metronId:34067,series:'Batman',number:'1',coverYear:1940},{metronId:5,series:'Batman',number:'1',coverYear:2016}]]]);
 assert.equal(matchFactViaMetron(fact(['Batman'],'1',[1940]),index),34067);
 assert.equal(matchFactViaMetron(fact(['Batman'],'1',[]),index),null);
});

test('profile assembly: debuts first, Metron over Wikidata, name twins, limits',()=>{
 const fact=(characterId:number,name:string,source:'metron'|'wikidata',issueCount:number|null,sitelinks:number|null=null,portraitKey:string|null=null):FactRow=>({characterId,name,source,portraitKey,issueCount,sitelinks});
 const p=buildProfile({issueId:4000000724,metronId:34067,status:'ready',base:'https://cdn.example.com',
  detail:{description:'Debut.',characters:[{id:1,name:'Batman'},{id:2,name:'Joker'},{id:3,name:'Catwoman'},{id:4,name:'Robin'}],teams:['Team'],credits:[{name:'Bob Kane',roles:['Writer']}]},
  facts:[fact(-9,'Bruce Wayne','wikidata',null,30),fact(2,'Joker','metron',2000),fact(-1,'Catwoman','wikidata',null,40),fact(2,'Joker','wikidata',null,90),fact(-7,'Hugo Strange','wikidata',null,5)],
  known:new Map([[3,{characterId:3,name:'Catwoman',portraitKey:'metron-characters/3/portrait.webp',issueCount:900}],[1,{characterId:1,name:'Batman',portraitKey:'../x',issueCount:5000,aliases:['Bruce Wayne']}]]),
  listed:[{characterId:-9,name:'Bruce Wayne',portraitKey:null,issueCount:null},{characterId:5,name:'Alfred',portraitKey:null,issueCount:100},{characterId:1,name:'Batman',portraitKey:null,issueCount:5000}]});
 assert.deepEqual(p.firstAppearances.slice(1),[{characterId:2,name:'Joker',portraitUrl:null,source:'metron'},{characterId:3,name:'Catwoman',portraitUrl:'https://cdn.example.com/metron-characters/3/portrait.webp',source:'wikidata'},{characterId:-7,name:'Hugo Strange',portraitUrl:null,source:'wikidata'}]);
 assert.deepEqual(p.keyReasons,['First appearance of Batman','First appearance of Joker','First appearance of Catwoman','First appearance of Hugo Strange'],'a Wikidata fact named like an alias is shown as that character');
 assert.equal(p.keyIssue,true);
 assert.deepEqual(p.characters.map(c=>[c.characterId,c.debut]),[[1,true],[2,true],[3,true],[-7,true],[4,false],[5,false]]);
 assert.equal(p.firstAppearances[0].portraitUrl,null,'invalid portrait keys are never served');
 assert.deepEqual([p.description,p.teams,p.credits,p.attribution],['Debut.',['Team'],[{name:'Bob Kane',roles:['Writer']}],'Character data: Metron (metron.cloud) · Wikidata (CC0)']);
 const many=buildProfile({issueId:1,metronId:null,status:'ready',base:null,detail:{description:null,characters:Array.from({length:80},(_,i)=>({id:i+1,name:'C'+i})),teams:[],credits:[]},facts:[],known:new Map(),listed:[]});
 assert.equal(many.characters.length,40);assert.equal(many.keyIssue,false);
});

test('route parameter validation',()=>{
 assert.equal(profileIssueId('4000000724'),4000000724);assert.equal(profileIssueId('35'),35);
 for(const bad of ['-1','1.5','abc','','12345678901234567'])assert.equal(profileIssueId(bad),null,bad);
 const p=(s:string)=>characterSearchParams(new URLSearchParams(s));
 assert.deepEqual(p('q=joker'),{q:'joker',limit:8});assert.deepEqual(p('q=jo&limit=20'),{q:'jo',limit:20});
 for(const bad of ['q=j','limit=3','q=joker&limit=0','q=joker&limit=21','q=joker&limit=x','q=joker&x=1','q=a&q=b','q='+'x'.repeat(81)])assert.equal(p(bad),null,bad);
 assert.ok(allowedMetronPath('character/?page=3'));assert.ok(allowedMetronPath('character/12/'));assert.ok(allowedMetronPath('character/12/issue_list/?page=1'));assert.ok(allowedMetronPath('issue/34067/'));
 for(const bad of ['issue/?page=1','character/0/','user/1/','issue/1/../../x','character/1/issue_list/'])assert.ok(!allowedMetronPath(bad),bad);
 assert.deepEqual(metronBudgetLimits('crawler',{}),{shared:4500,own:3700,minute:18});
 assert.deepEqual(metronBudgetLimits('app',{METRON_SHARED_DAILY_MAX:'99999'}),{shared:4900,own:4900,minute:18});
});

// ---------- database paths ----------
let engine:PGlite;const pool=new Pool(),db=getDb();
before(async()=>{
 engine=new PGlite();await nativeGcdFixture(engine);await engine.exec('CREATE SCHEMA ch_web');
 for(const name of readdirSync('db/postgres-migrations').filter(n=>n.endsWith('.sql')&&!['003_catalog_ingestion.sql','005_gcd_snapshot_import.sql'].includes(n)).sort())await engine.exec(readFileSync('db/postgres-migrations/'+name,'utf8'));
 await engine.exec('SET search_path TO ch_web,gcd,public');
 const query=async(config:string|{text:string;rowMode?:string},values:unknown[]=[])=>{const r=await engine.query<Record<string,unknown>>(typeof config==='string'?config:config.text,values);return {...r,rowCount:r.affectedRows,command:'',rows:typeof config!=='string'&&config.rowMode==='array'?r.rows.map(row=>r.fields.map(field=>row[field.name])):r.rows}};
 Object.assign(pool,{query,connect:async()=>({query,release(){}})});(globalThis as typeof globalThis&{comicHuddlePool:Pool}).comicHuddlePool=pool;
 await db.batch(seedStarterStatements(db,new Date().toISOString()));
 await engine.exec(`ALTER TABLE gcd.gcd_series ADD COLUMN IF NOT EXISTS year_began integer;ALTER TABLE gcd.gcd_series ADD COLUMN IF NOT EXISTS issue_count integer;
  INSERT INTO gcd.gcd_publisher VALUES(54,'DC',0);
  INSERT INTO gcd.gcd_series(id,name,publisher_id,deleted,year_began,issue_count) VALUES(141,'Batman',54,0,1940,715),(142,'Detective Comics',54,0,1937,1000);
  INSERT INTO gcd.gcd_issue(id,series_id,number,key_date,variant_name,variant_of_id,deleted) VALUES(724,141,'1','1940-04-00','',NULL,0),(865152,141,'1','1940-04-00','No period',724,0),(725,141,'2','1940-06-00','',NULL,0),(5068,142,'27','1939-05-00','',NULL,0)`);
 process.env.METRON_COVER_CDN_BASE='https://cdn.example.com';
});
after(async()=>{await engine.close();delete(globalThis as typeof globalThis&{comicHuddlePool?:Pool}).comicHuddlePool;for(const k of ['METRON_COVER_CDN_BASE','METRON_API_TOKEN'])delete process.env[k]});

test('import, profile with on-demand enrichment, search and the catalog character filter',async()=>{
 const harvest=new Map<number,HarvestedIssue>([[34067,{id:34067,series:'Batman',volume:1,yearBegan:1940,number:'1',coverDate:'1940-04-01'}],[34068,{id:34068,series:'Batman',volume:1,yearBegan:1940,number:'2',coverDate:'1940-06-01'}],
  [50,{id:50,series:'Detective Comics',volume:1,yearBegan:1937,number:'27',coverDate:'1939-05-01'}],[51,{id:51,series:'Nothing',volume:1,yearBegan:1990,number:'1',coverDate:null}]]);
 const links=await linkMetronIssues(db,harvest);
 assert.equal(links.linked,3);
 assert.deepEqual((await engine.query<{metron_id:number;issue_id:number|null}>('SELECT metron_id,issue_id FROM ch_web.character_metron_issues ORDER BY metron_id')).rows,[{metron_id:50,issue_id:4000005068},{metron_id:51,issue_id:null},{metron_id:34067,issue_id:4000000724},{metron_id:34068,issue_id:4000000725}]);
 await importCharacterList(db,[{id:1,name:'Batman',modified:null},{id:2,name:'Joker',modified:null},{id:3,name:'Catwoman',modified:null},{id:4,name:'Jokerz',modified:null}]);
 await importCharacterDetails(db,[{id:2,name:'Joker',aliases:['Clown Prince of Crime'],desc:'The Joker first appeared in Batman #1.',image:'https://static.metron.cloud/media/character/joker.jpg',modified:null}]);
 const ref=(id:number,series:string,number:string,coverDate:string)=>({id,series,volume:1,yearBegan:1940,number,coverDate});
 await importIssueLists(db,[{characterId:2,page:1,count:250,results:[ref(34067,'Batman','1','1940-04-01'),ref(34068,'Batman','2','1940-06-01')]},{characterId:1,page:1,count:5000,results:[ref(50,'Detective Comics','27','1939-05-01'),ref(34067,'Batman','1','1940-04-01')]}]);
 // Wikidata: Catwoman (merged into Metron id 3 once she appears there) and a Wikidata-only character.
 const wf=(qid:string,name:string,gcd:number):WikidataFact=>({qid,name,issueQid:'Q1',issueLabel:'Batman #1',series:['Batman'],number:'1',years:[1940],gcdIssueId:gcd});
 const facts=[wf('Q2','Catwoman',724),wf('Q3','Hugo Strange',724)];
 const matches=await matchWikidataFacts(db,facts,metronNameIndex(harvest));
 assert.deepEqual([...matches.values()].map(m=>m.method),['wikidata_gcd_id','wikidata_gcd_id']);
 await storeWikidataFacts(db,facts,matches,new Map([['Q2',{sitelinks:60,aliases:['Selina Kyle'],description:null}],['Q3',{sitelinks:20,aliases:[],description:null}]]));
 await finalizeCharacters(db);

 // On-demand: issue 34067 has no details yet -> one budgeted fetch through the stub.
 process.env.METRON_API_TOKEN='qa-token-0123456789abcdefghij';
 const calls:string[]=[];
 const fetcher=(async(url:URL|string,init?:RequestInit)=>{calls.push(String(url));assert.match(String((init?.headers as Record<string,string>).Authorization),/^Bearer /);
  return Response.json({id:34067,series:{name:'Batman',volume:1,year_began:1940},number:'1',cover_date:'1940-04-01',desc:'Batman battles the Joker.',characters:[{id:1,name:'Batman'},{id:2,name:'Joker'},{id:3,name:'Catwoman'},{id:6,name:'Robin'}],teams:[],credits:[{creator:'Bob Kane',role:[{name:'Penciller'}]}]})}) as typeof fetch;
 const profile=await issueProfile(db,4000000724,{fetcher});
 assert.deepEqual(calls,['https://metron.cloud/api/issue/34067/']);
 assert.equal(profile?.status,'ready');assert.equal(profile?.metronId,34067);assert.equal(profile?.description,'Batman battles the Joker.');
 assert.deepEqual(profile?.firstAppearances.map(f=>[f.characterId,f.name,f.source]),[[2,'Joker','metron'],[3,'Catwoman','wikidata'],[-3,'Hugo Strange','wikidata']],'the Wikidata Catwoman is shown as the Metron Catwoman listed in this issue');
 assert.deepEqual(profile?.characters.slice(0,4).map(c=>[c.name,c.debut]),[['Joker',true],['Catwoman',true],['Hugo Strange',true],['Batman',false]]);
 assert.deepEqual(profile?.credits,[{name:'Bob Kane',roles:['Penciller']}]);
 // After the next import the Wikidata Catwoman merges into Metron Catwoman (same name, same issue).
 await finalizeCharacters(db);
 const merged=await issueProfile(db,35,{fetcher});
 assert.equal(merged?.catalogIssueId,4000000724,'curated id 35 maps through coverLookupId');
 assert.deepEqual(merged?.firstAppearances.map(f=>[f.characterId,f.source]),[[2,'metron'],[3,'wikidata'],[-3,'wikidata']]);
 assert.equal(calls.length,1,'stored details are reused');
 assert.equal(merged?.issueId,35);
 // Pending: a linked Metron issue that cannot be fetched (no token) is queued.
 delete process.env.METRON_API_TOKEN;
 const pending=await issueProfile(db,4000000725);
 assert.equal(pending?.status,'pending');
 assert.equal((await engine.query('SELECT 1 FROM ch_web.character_enrichment_queue WHERE metron_issue_id=34068')).rows.length,1);
 assert.equal(await issueProfile(db,4000009999),null,'unknown issue');
 assert.equal((await issueProfile(db,4000005068))?.keyIssue,false,'an unconfirmed Metron issue-list inference (earliest indexed issue) is not shown as a first appearance');

 const search=await searchCharacters(db,'joker',8);
 assert.deepEqual(search.map(r=>r.name),['Joker','Jokerz']);
 assert.deepEqual(search[0].firstAppearance,{issueId:4000000724,title:'Batman',number:'1',year:1940});
 assert.equal(search[0].issueCount,250);
 assert.deepEqual((await searchCharacters(db,'clown prince',8)).map(r=>r.name),['Joker'],'aliases match');
 assert.deepEqual((await searchCharacters(db,'selina',8)).map(r=>r.name),[],'merged Wikidata rows are hidden; their aliases live on the Wikidata row');
 assert.deepEqual((await searchCharacters(db,'strange hugo',8)).map(r=>r.characterId),[-3],'all words, any order');

 const byCharacter=await searchSharedCatalog(db,{q:'',limit:10,offset:0,character:1});
 assert.deepEqual(byCharacter.issues.map(i=>i.id).sort(),[4000000724,4000005068]);
 assert.equal(byCharacter.total,2);
 const combined=await searchSharedCatalog(db,{q:'detective',limit:10,offset:0,character:1});
 assert.deepEqual(combined.issues.map(i=>i.id),[4000005068]);
 const none=await searchSharedCatalog(db,{q:'',limit:10,offset:0,character:424242});
 assert.equal(none.total,0);
});

test('shared Metron budget: caller ceiling, shared ceiling and minute window',async()=>{
 await engine.exec('DELETE FROM ch_web.metron_api_budget');
 const env={METRON_CRAWLER_DAILY_MAX:'3',METRON_SHARED_DAILY_MAX:'5',METRON_SHARED_MINUTE_MAX:'19'};
 for(let i=0;i<3;i++)assert.equal((await reserveMetronCalls(db,'crawler',1,env)).ok,true);
 const denied=await reserveMetronCalls(db,'crawler',1,env);assert.equal(denied.ok,false);assert.equal(!denied.ok&&denied.reason,'day');
 assert.equal((await reserveMetronCalls(db,'app',2,env)).ok,true,'the app keeps its headroom');
 assert.equal((await reserveMetronCalls(db,'app',1,env)).ok,false,'shared ceiling reached');
 await engine.exec('DELETE FROM ch_web.metron_api_budget');
 const minute={METRON_SHARED_MINUTE_MAX:'2'};
 assert.equal((await reserveMetronCalls(db,'app',2,minute)).ok,true);
 const slow=await reserveMetronCalls(db,'app',1,minute);assert.equal(!slow.ok&&slow.reason,'minute');
});
