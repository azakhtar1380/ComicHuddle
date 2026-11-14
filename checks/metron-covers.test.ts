// Metron cover copies on the owner's CDN: normalization + unique-match rules, manifest parsing,
// copier rendition sizing (generated image, no network), and the cover priority order in an
// isolated PGlite database. No Metron, S3 or CloudFront calls.
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {PGlite} from '@electric-sql/pglite';
import {Pool} from 'pg';
import sharp from 'sharp';
import {nativeGcdFixture} from './native-gcd-fixture';
import {getDb} from '../db';
import {listings,profiles} from '../db/schema';
import {seedStarterStatements,catalogIssuesById} from '../lib/catalog-store';
import {resolveCoverBatch} from '../lib/cover-cache';
import {readyCachedCoverRows} from '../lib/cover-cache-read';
import {METRON_COVER_ATTRIBUTION} from '../lib/data-credits';
import {SELLER_PHOTO_CREDIT} from '../lib/cover-cache-types';
import {metronCdnCovers,metronCoverCdnBase,normalizeIssueNumber,normalizeSeriesName,parseManifest,parseManifestLine,uniqueMatch} from '../lib/metron-cover-index';
import {decodeManifest,importMetronCovers,matchByName} from '../lib/metron-cover-import';
import {allowedImageUrl,buildManifest,keepLatest,makeRenditions,parseIndexLine,renditionKey,retryDelayMs,sameVersion} from '../scripts/copy-metron-covers.mjs';

const BASE='https://d123example.cloudfront.net';
const rend=(id:number,name:'card'|'dense',width:number)=>({key:`metron/${id}/${name}.webp`,width,height:Math.round(width*1.5)});
const row=(id:number,series:string,yearBegan:number|null,number:string,extra:Record<string,unknown>={})=>({id,series,volume:1,yearBegan,number,coverDate:'2000-01-01',card:rend(id,'card',480),dense:rend(id,'dense',240),coverHash:'h'+id,...extra});

test('series and issue-number normalization',()=>{
 assert.equal(normalizeSeriesName('The Amazing Spider-Man'),'amazing spider man');
 assert.equal(normalizeSeriesName('Amazing Spider-Man, The'),'amazing spider man the');
 assert.equal(normalizeSeriesName('  THE X-Men & Friends!  '),'x men and friends');
 assert.equal(normalizeSeriesName("Hawk's Quest"),'hawks quest');
 assert.equal(normalizeSeriesName('Hawk’s Quest'),'hawks quest');
 assert.equal(normalizeSeriesName('The'),'the','a bare "The" is kept');
 assert.equal(normalizeSeriesName('Theater Tales'),'theater tales','only a whole leading word "the" is removed');
 assert.equal(normalizeSeriesName(null),'');
 assert.equal(normalizeIssueNumber('001'),'1');assert.equal(normalizeIssueNumber('#12'),'12');assert.equal(normalizeIssueNumber('0'),'0');
 assert.equal(normalizeIssueNumber('00'),'0');assert.equal(normalizeIssueNumber('½'),'1/2');assert.equal(normalizeIssueNumber(' 1 A '),'1a');
 assert.equal(normalizeIssueNumber('0.5'),'0.5');assert.equal(normalizeIssueNumber(7),'7');assert.equal(normalizeIssueNumber(undefined),'');
});

test('a name match is accepted only when unique',()=>{
 assert.equal(uniqueMatch([5]),5);assert.equal(uniqueMatch([5,5]),5,'same issue twice is still one issue');
 assert.equal(uniqueMatch([5,6]),null);assert.equal(uniqueMatch([]),null);
 const series=new Map([['secret wars|1984',[17]],['dup title|2000',[20,21]]]);
 const issues=[{id:123,seriesId:17,number:'1'},{id:124,seriesId:17,number:'2'},{id:300,seriesId:20,number:'1'},{id:301,seriesId:21,number:'1'}];
 const result=matchByName([
  {metronId:1,series:'Secret Wars',yearBegan:1984,number:'001'},
  {metronId:2,series:'The Secret Wars',yearBegan:1985,number:'1'},
  {metronId:3,series:'Dup Title',yearBegan:2000,number:'1'},
  {metronId:4,series:'Secret Wars',yearBegan:null,number:'1'},
  {metronId:5,series:'Secret Wars',yearBegan:1984,number:null}],series,issues);
 assert.deepEqual(result,[{metronId:1,issueId:4000000123,method:'name'},{metronId:2,issueId:null,method:'unmatched'},{metronId:3,issueId:null,method:'ambiguous'},{metronId:4,issueId:null,method:'unmatched'},{metronId:5,issueId:null,method:'unmatched'}]);
});

test('manifest parsing validates keys, ids and fields; gzip and plain both decode',()=>{
 const good=row(42,'Secret Wars',1984,'1');
 assert.deepEqual(parseManifestLine(JSON.stringify(good)),{...good});
 assert.equal(parseManifestLine(JSON.stringify({...good,card:{...good.card,key:'metron/43/card.webp'}})),null,'key must belong to the row id');
 assert.equal(parseManifestLine(JSON.stringify({...good,card:{...good.card,key:'../secret/card.webp'}})),null);
 assert.equal(parseManifestLine(JSON.stringify({...good,dense:{...good.dense,key:'metron/42/card.webp'}})),null,'dense key must be dense.webp');
 assert.equal(parseManifestLine(JSON.stringify({...good,id:-1})),null);assert.equal(parseManifestLine('{not json'),null);
 assert.equal(parseManifestLine(JSON.stringify({...good,coverDate:'yesterday',yearBegan:'1984'}))?.coverDate,null);
 const text=[JSON.stringify(good),'garbage',JSON.stringify({...good,number:'1A'}),''].join('\n');
 const parsed=parseManifest(text);assert.equal(parsed.rows.length,1);assert.equal(parsed.rows[0].number,'1A','duplicate id keeps the last line');assert.equal(parsed.skipped,1);
 assert.equal(decodeManifest(gzipSync(Buffer.from(text))),text);assert.equal(decodeManifest(Buffer.from(text)),text);
 assert.equal(metronCoverCdnBase({METRON_COVER_CDN_BASE:BASE+'/'}),BASE);
 for(const bad of ['http://d1.cloudfront.net','https://user:pw@d1.cloudfront.net','https://d1.cloudfront.net/?x=1','javascript:alert(1)','https://localhost','',undefined])assert.equal(metronCoverCdnBase({METRON_COVER_CDN_BASE:bad}),null,String(bad));
});

test('copier: host allowlist, dedupe, Retry-After, renditions (480/240 WebP, no EXIF, no upscaling) and manifest',async()=>{
 assert.equal(allowedImageUrl('https://static.metron.cloud/media/issue/2022/09/19/x.jpg'),'https://static.metron.cloud/media/issue/2022/09/19/x.jpg');
 for(const bad of ['http://static.metron.cloud/a.jpg','https://evil.example/a.jpg','https://static.metron.cloud.evil.example/a.jpg','https://u:p@static.metron.cloud/a.jpg','https://static.metron.cloud:8443/a.jpg',null])assert.equal(allowedImageUrl(bad),null,String(bad));
 assert.equal(parseIndexLine('{"id":1,"image":"https://evil.example/a.jpg"}')?.image,null,'other hosts are rejected at parse time');
 assert.equal(parseIndexLine('{"id":1,"series":"A","num'),null,'a partially written line is ignored');
 const map=new Map();
 for(const line of ['{"id":7,"number":"1","modified":"2024-01-02T00:00:00Z"}','{"id":7,"number":"OLD","modified":"2023-01-01T00:00:00Z"}','{"id":8,"number":"1"}','{"id":8,"number":"2"}'])keepLatest(map,parseIndexLine(line));
 assert.equal(map.get(7).number,'1','latest modified wins regardless of line order');assert.equal(map.get(8).number,'2');
 assert.equal(sameVersion({coverHash:'a',image:'x'},{coverHash:'a',image:'y'}),true);assert.equal(sameVersion({coverHash:'a',image:'x'},{coverHash:'b',image:'x'}),false);assert.equal(sameVersion({coverHash:null,image:'x'},{coverHash:null,image:'x'}),true);
 assert.equal(retryDelayMs('120',1),120000);assert.equal(retryDelayMs(new Date(Date.now()+30000).toUTCString(),1,Date.now())<=30000,true);assert.equal(retryDelayMs(null,1),30000);assert.equal(retryDelayMs(null,3),120000);assert.equal(retryDelayMs(null,20),900000);
 const big=await sharp({create:{width:1000,height:1540,channels:3,background:'#c33'}}).jpeg().withMetadata({exif:{IFD0:{Copyright:'QA secret owner'}}}).toBuffer();
 assert.ok((await sharp(big).metadata()).exif,'fixture carries EXIF');
 const out=await makeRenditions(big);
 for(const [name,width] of [['card',480],['dense',240]] as const){const meta=await sharp(out[name].bytes).metadata();assert.equal(meta.format,'webp');assert.equal(meta.width,width);assert.equal(out[name].width,width);assert.equal(meta.height,Math.round(1540*width/1000));assert.equal(meta.exif,undefined);assert.ok(!out[name].bytes.includes(Buffer.from('QA secret owner')))}
 const small=await makeRenditions(await sharp({create:{width:300,height:450,channels:3,background:'#36c'}}).png().toBuffer());
 assert.equal(small.card.width,300,'never upscaled');assert.equal(small.dense.width,240);
 const sideways=await makeRenditions(await sharp({create:{width:1500,height:1000,channels:3,background:'#000'}}).jpeg().withMetadata({orientation:6}).toBuffer());
 assert.ok(sideways.card.height>sideways.card.width,'EXIF orientation applied before resizing');
 await assert.rejects(makeRenditions(await sharp({create:{width:300,height:450,channels:3,background:'#000'}}).gif().toBuffer()));
 assert.equal(renditionKey(5,'card'),'metron/5/card.webp');
 const done=new Map([[9,{id:9,coverHash:'abc',card:rend(9,'card',480),dense:rend(9,'dense',240),series:'Old'}]]);
 const index=new Map([[9,{id:9,series:'New Name',volume:2,yearBegan:1999,number:'3',coverDate:'1999-05-01'}]]);
 const manifest=parseManifest(decodeManifest(buildManifest(done,index)));
 assert.deepEqual(manifest.rows,[{id:9,series:'New Name',volume:2,yearBegan:1999,number:'3',coverDate:'1999-05-01',card:rend(9,'card',480),dense:rend(9,'dense',240),coverHash:'abc'}],'copier manifest round-trips through the importer parser');
});

// ---------- isolated database: import, matching and priority ----------
let engine:PGlite;const pool=new Pool(),db=getDb();
const now=new Date().toISOString();
const METRON_IMAGE='https://static.metron.cloud/media/issue/2020/01/01/qa.jpg';
const manifestRows=[
 row(1001,'Secret Wars',1984,'1'),             // name match to 123, but 1006 is an exact link to 123
 row(1002,'Secret Wars',1984,'2'),row(1003,'Marvel Super Heroes Secret Wars',1984,'2'), // 1003 does not match
 row(1004,'X-Men and Friends',1990,'1'),        // normalized name match to 200 ('The X-Men & Friends', '001')
 row(1005,'Planet Comics',1940,'12'),           // matches 1400, but reviewed local file stays first
 row(1006,'Unrelated Title',1984,'1'),          // exact_catalog via ch_web.catalog_issues.metron_id
 row(1007,'Nothing Similar',2010,'9'),          // exact_metron_lookup via metron_identifier_lookups
 row(1008,'Dup Title',2000,'1'),                // two GCD series share name+year: ambiguous
 row(1009,'No Such Series',1970,'1'),           // unmatched
 row(1010,'Second Claim',1984,'2'),row(1011,'Second Claim',1984,'2'), // two Metron rows -> one issue: ambiguous_issue
];
let manifestText=manifestRows.map(r=>JSON.stringify(r)).join('\n')+'\n';
let fetched:string[]=[];
const fetcher=(async(url:URL|string)=>{fetched.push(String(url));return new Response(gzipSync(Buffer.from(manifestText)),{status:200,headers:{'content-type':'application/gzip'}})}) as typeof fetch;

before(async()=>{
 engine=new PGlite();await nativeGcdFixture(engine);await engine.exec('CREATE SCHEMA ch_web');
 for(const name of readdirSync('db/postgres-migrations').filter(n=>n.endsWith('.sql')&&!['003_catalog_ingestion.sql','005_gcd_snapshot_import.sql'].includes(n)).sort())await engine.exec(readFileSync('db/postgres-migrations/'+name,'utf8'));
 await engine.exec('SET search_path TO ch_web,gcd,public');
 const query=async(config:string|{text:string;rowMode?:string},values:unknown[]=[])=>{const r=await engine.query<Record<string,unknown>>(typeof config==='string'?config:config.text,values);return {...r,rowCount:r.affectedRows,command:'',rows:typeof config!=='string'&&config.rowMode==='array'?r.rows.map(row=>r.fields.map(field=>row[field.name])):r.rows}};
 Object.assign(pool,{query,connect:async()=>({query,release(){}})});(globalThis as typeof globalThis&{comicHuddlePool:Pool}).comicHuddlePool=pool;await db.batch(seedStarterStatements(db,now));
 // Real GCD snapshots carry gcd_series.year_began; the shared fixture omits it.
 await engine.exec(`ALTER TABLE gcd.gcd_series ADD COLUMN year_began integer;
  INSERT INTO gcd.gcd_publisher VALUES(78,'QA Publisher',0),(79,'Fiction House',0);
  INSERT INTO gcd.gcd_series(id,name,publisher_id,deleted,year_began) VALUES(17,'Secret Wars',78,0,1984),(18,'Planet Comics',79,0,1940),(19,'The X-Men & Friends',78,0,1990),(20,'Dup Title',78,0,2000),(21,'Dup Title',78,0,2000),(22,'Second Claim',78,0,1984),(23,'Old Deleted',78,1,1984);
  INSERT INTO gcd.gcd_issue(id,series_id,number,key_date,variant_name,variant_of_id,deleted) VALUES(123,17,'1','1984-05-00','',NULL,0),(124,17,'2','1984-06-00','',NULL,0),(125,17,'2','1984-06-00','Newsstand',124,0),(126,17,'3','1984-07-00','',NULL,0),
   (1400,18,'12','1941-05-00','',NULL,0),(200,19,'001','1990-01-00','',NULL,0),(300,20,'1','2000-01-00','',NULL,0),(301,21,'1','2000-01-00','',NULL,0),(400,22,'2','1984-01-00','',NULL,0)`);
 await engine.exec(`INSERT INTO ch_web.catalog_issues(id,metron_id,gcd_id,title,number,publisher,year,era,kind,search_text,data,fetched_at) VALUES(990001,1006,123,'Secret Wars','1','QA Publisher',1984,'Copper Age','Catalog issue','secret wars','{}','${now}')`);
 await engine.exec(`INSERT INTO ch_web.metron_identifier_lookups(lookup_key,supplement,status,issue_ids,candidates,total,expires_at) VALUES('7590000000000','','EXTERNAL','[]','[{"metronId":1007,"gcdId":126,"title":"x"},{"metronId":"bad","gcdId":1}]',1,now()+interval '1 day')`);
 for(const view of (await engine.query<{name:string}>(`SELECT schemaname||'.'||matviewname AS name FROM pg_matviews WHERE schemaname IN ('gcd','ch_web')`)).rows)await engine.exec('REFRESH MATERIALIZED VIEW '+view.name).catch(()=>undefined);
});
after(async()=>{await engine.close();delete(globalThis as typeof globalThis&{comicHuddlePool?:Pool}).comicHuddlePool;for(const key of ['METRON_COVER_CDN_BASE','METRON_API_TOKEN','COVER_DIRECT_DISPLAY','COVER_CDN_BASE_URL'])delete process.env[key]});
const indexRows=async()=>Object.fromEntries((await engine.query<{metron_id:number;issue_id:number|null;match_method:string|null}>('SELECT metron_id,issue_id,match_method FROM ch_web.metron_cover_index ORDER BY metron_id')).rows.map(r=>[r.metron_id,[r.issue_id===null?null:Number(r.issue_id),r.match_method]]));

test('import is disabled without a valid https CDN base, and the read path fails soft without the table',async()=>{
 assert.equal((await importMetronCovers(db,{fetcher,env:{METRON_COVER_CDN_BASE:'http://insecure.example'}})).status,'disabled');assert.equal(fetched.length,0);
 process.env.METRON_COVER_CDN_BASE=BASE;
 const broken={execute:async()=>{throw new Error('relation "ch_web.metron_cover_index" does not exist')}} as unknown as typeof db;
 assert.equal((await metronCdnCovers(broken,[4000000123])).size,0,'missing table: no CDN covers, no throw');
});

test('import upserts the manifest, links exact ids first and sets only unique name matches; re-run is idempotent',async()=>{
 const first=await importMetronCovers(db,{fetcher,env:{METRON_COVER_CDN_BASE:BASE}});
 assert.equal(first.status,'complete');assert.equal(first.manifestRows,manifestRows.length);assert.equal(first.upserted,manifestRows.length);
 assert.deepEqual(fetched,[BASE+'/metron/manifest.ndjson.gz']);
 assert.deepEqual(await indexRows(),{
  1001:[null,'ambiguous_issue'],1002:[4000000124,'name'],1003:[null,'unmatched'],1004:[4000000200,'name'],1005:[4000001400,'name'],
  1006:[4000000123,'exact_catalog'],1007:[4000000126,'exact_metron_lookup'],1008:[null,'ambiguous'],1009:[null,'unmatched'],
  1010:[null,'ambiguous_issue'],1011:[null,'ambiguous_issue']});
 const second=await importMetronCovers(db,{fetcher,env:{METRON_COVER_CDN_BASE:BASE}});
 assert.equal(second.upserted,0,'unchanged rows are not rewritten');assert.equal(second.exact,0);assert.equal(second.named,0);
 assert.deepEqual((await indexRows())[1004],[4000000200,'name']);
 // A changed number clears a name match so it is re-evaluated; exact links are kept.
 manifestText=manifestRows.map(r=>JSON.stringify(r.id===1004?{...r,number:'2'}:r.id===1006?{...r,number:'99'}:r)).join('\n');
 const third=await importMetronCovers(db,{fetcher,env:{METRON_COVER_CDN_BASE:BASE}});
 assert.equal(third.upserted,2);const rows=await indexRows();assert.deepEqual(rows[1004],[null,'unmatched']);assert.deepEqual(rows[1006],[4000000123,'exact_catalog']);
 manifestText=manifestRows.map(r=>JSON.stringify(r)).join('\n');await importMetronCovers(db,{fetcher,env:{METRON_COVER_CDN_BASE:BASE}});
 assert.deepEqual((await indexRows())[1004],[4000000200,'name']);
});

test('priority: reviewed local > GCD/S3 cache > Metron CDN copy > Metron direct > seller photo / collector cover',async()=>{
 process.env.METRON_COVER_CDN_BASE=BASE;
 // CDN copy with srcSet and the Metron attribution.
 let [r]=await resolveCoverBatch(db,[4000000200]);
 assert.equal(r.status,'CACHED');assert.equal(r.url,BASE+'/metron/1004/card.webp');assert.equal(r.srcSet,BASE+'/metron/1004/dense.webp 240w, '+BASE+'/metron/1004/card.webp 480w');assert.equal(r.attribution,METRON_COVER_ATTRIBUTION);
 let [issue]=await catalogIssuesById(db,[4000000200]);assert.equal(issue.cover,BASE+'/metron/1004/card.webp');assert.equal(issue.coverCredit,METRON_COVER_ATTRIBUTION);
 // The exact link wins for an issue also claimed by name.
 assert.equal((await resolveCoverBatch(db,[4000000123]))[0].url,BASE+'/metron/1006/card.webp');
 // Reviewed local /covers/ file stays first.
 assert.equal((await resolveCoverBatch(db,[4000001400]))[0].url,'/covers/planet-12.jpg');assert.equal((await catalogIssuesById(db,[4000001400]))[0].cover,'/covers/planet-12.jpg');
 // CDN copy outranks a seller photo.
 await db.insert(profiles).values({id:'seller',userId:'user-seller',handle:'seller',name:'seller',bio:'',tagline:'',location:'',favorite:'',since:2020,color:'red',featured:'[]',visible:1,dmOpen:0,createdAt:now});
 await engine.exec(`INSERT INTO ch_web.media(id,user_id,content_type,created_at) VALUES('00000000-0000-4000-8000-000000000001','user-seller','image/webp','${now}')`);
 for(const id of [4000000200,4000000300])await db.insert(listings).values({id:'l'+id,sellerId:'seller',bookId:'b'+id,issueId:id,title:'QA',grade:'VF',description:'',price:1000,shipping:0,photos:JSON.stringify(['00000000-0000-4000-8000-000000000001']),cert:'',status:'active',createdAt:now});
 assert.equal((await resolveCoverBatch(db,[4000000200]))[0].url,BASE+'/metron/1004/card.webp');
 [r]=await resolveCoverBatch(db,[4000000300]);assert.equal(r.attribution,SELLER_PHOTO_CREDIT,'ambiguous rows give no CDN cover; the seller fallback still shows');
 // CDN copy outranks Metron direct display; direct still fills issues without a copy.
 Object.assign(process.env,{METRON_API_TOKEN:'qa_token_'+'x'.repeat(30),COVER_DIRECT_DISPLAY:'metron'});
 await engine.exec(`INSERT INTO ch_web.enrichment_catalog_refs(issue_id,source_provider,source_id) VALUES(4000000200,'METRON',200),(4000000300,'METRON',300) ON CONFLICT DO NOTHING;
  INSERT INTO ch_web.cover_cache(id,issue_id,source_provider,source_cover_id,source_url,permission_reference,status,attribution,permission_expires_at) VALUES
  ('00000000-0000-4000-8000-0000000000a1',4000000200,'METRON','direct','${METRON_IMAGE}','COVER_DIRECT_DISPLAY=metron','CACHED','direct',now()+interval '1 day'),
  ('00000000-0000-4000-8000-0000000000a2',4000000300,'METRON','direct','${METRON_IMAGE}','COVER_DIRECT_DISPLAY=metron','CACHED','direct',now()+interval '1 day')`);
 assert.equal((await resolveCoverBatch(db,[4000000200]))[0].url,BASE+'/metron/1004/card.webp');assert.equal((await catalogIssuesById(db,[4000000200]))[0].cover,BASE+'/metron/1004/card.webp');
 assert.equal((await resolveCoverBatch(db,[4000000300]))[0].url,METRON_IMAGE,'Metron direct outranks the seller photo');
 delete process.env.COVER_DIRECT_DISPLAY;
 // An existing GCD/S3 cache copy outranks the Metron CDN copy.
 process.env.COVER_CDN_BASE_URL='https://qa-cache.example.com';
 await engine.exec(`INSERT INTO ch_web.source_permissions(provider,enabled,access_allowed,cache_allowed,display_allowed,ai_allowed,valuation_allowed,evidence_reference,attribution,approved_hosts,valid_until) VALUES('GCD',true,true,true,true,false,false,'qa grant','GCD QA cache','["www.comics.org"]',now()+interval '1 day') ON CONFLICT(provider) DO UPDATE SET enabled=true,access_allowed=true,cache_allowed=true,display_allowed=true,revoked_at=NULL,evidence_reference='qa grant',valid_until=now()+interval '1 day';
  INSERT INTO ch_web.enrichment_catalog_refs(issue_id,source_provider,source_id) VALUES(4000000200,'GCD',200) ON CONFLICT DO NOTHING;
  INSERT INTO ch_web.cover_cache(id,issue_id,source_provider,source_cover_id,permission_reference,status,renditions,attribution,permission_expires_at) VALUES('00000000-0000-4000-8000-0000000000b1',4000000200,'GCD','77','qa grant','CACHED','{"card":{"key":"comic-covers/GCD/200/77/x/card.webp","width":240,"height":360}}','GCD QA cache',now()+interval '1 day')`);
 assert.equal((await readyCachedCoverRows(db,[4000000200])).get(4000000200)?.url,'https://qa-cache.example.com/comic-covers/GCD/200/77/x/card.webp');
 [issue]=await catalogIssuesById(db,[4000000200]);assert.equal(issue.cover,'https://qa-cache.example.com/comic-covers/GCD/200/77/x/card.webp');
 // Without METRON_COVER_CDN_BASE nothing from the copy is shown.
 delete process.env.COVER_CDN_BASE_URL;delete process.env.METRON_COVER_CDN_BASE;
 [r]=await resolveCoverBatch(db,[4000000124]);assert.equal(r.url,null);
});
