// Isolated PGlite: cover priority order (reviewed local > provider covers > seller photo > collector cover)
// and collector-submission validation. No provider calls, no real storage.
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {Pool} from 'pg';
import sharp from 'sharp';
import {nativeGcdFixture} from './native-gcd-fixture';
import {getDb} from '../db';
import {listings,media,profiles} from '../db/schema';
import {seedStarterStatements,catalogIssuesById} from '../lib/catalog-store';
import {resolveCoverBatch} from '../lib/cover-cache';
import {COMMUNITY_COVER_CREDIT,SELLER_PHOTO_CREDIT,communityPhotoUrl,coverMediaId} from '../lib/cover-cache-types';
import {FALLBACK_COVER_ORDER,communityCoverReport,communityCoverSubmission,communitySubmissionsToday,fallbackCovers,initialCommunityCoverStatus,isPublicCoverPhoto,normalizeCommunityCover,pickFallbackCover,reportCommunityCover} from '../lib/community-covers';

let engine:PGlite;const pool=new Pool(),db=getDb();
const ISSUE=4000000123,PLANET=4000001400,OTHER=4000000124;
const METRON_IMAGE='https://static.metron.cloud/media/issue/2020/01/01/qa.jpg';
const uuid=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const now=new Date().toISOString();
async function profile(id:string,userId:string,extra:Partial<typeof profiles.$inferInsert>={}){await db.insert(profiles).values({id,userId,handle:id,name:id,bio:'',tagline:'',location:'',favorite:'',since:2020,color:'red',featured:'[]',visible:1,dmOpen:0,createdAt:now,...extra})}
async function photo(n:number,userId:string){await db.insert(media).values({id:uuid(n),userId,contentType:'image/webp',createdAt:now})}
async function listing(id:string,sellerId:string,issueId:number,status:string,photos:string[],createdAt:string){await db.insert(listings).values({id,sellerId,bookId:'book-'+id,issueId,title:'QA',grade:'VF',description:'',price:1000,shipping:0,photos:JSON.stringify(photos),cert:'',status,createdAt})}
async function community(id:string,issueId:number,mediaN:number,userId:string,status:string,createdAt:string){await engine.query(`INSERT INTO ch_web.community_covers(id,issue_id,media_id,user_id,status,width,height,content_hash,created_at) VALUES($1,$2,$3,$4,$5,800,1200,$6,$7)`,[id,issueId,uuid(mediaN),userId,status,'a'.repeat(64),createdAt])}

before(async()=>{
 engine=new PGlite();await nativeGcdFixture(engine);await engine.exec('CREATE SCHEMA ch_web');
 // Same set and order as db/local-dev.ts (PGlite dev database), so 028 is proven there too.
 for(const name of readdirSync('db/postgres-migrations').filter(n=>n.endsWith('.sql')&&!['003_catalog_ingestion.sql','005_gcd_snapshot_import.sql'].includes(n)).sort())await engine.exec(readFileSync('db/postgres-migrations/'+name,'utf8'));
 await engine.exec('SET search_path TO ch_web,gcd,public');
 const query=async(config:string|{text:string;rowMode?:string},values:unknown[]=[])=>{const r=await engine.query<Record<string,unknown>>(typeof config==='string'?config:config.text,values);return {...r,rowCount:r.affectedRows,command:'',rows:typeof config!=='string'&&config.rowMode==='array'?r.rows.map(row=>r.fields.map(field=>row[field.name])):r.rows}};
 Object.assign(pool,{query,connect:async()=>({query,release(){}})});(globalThis as typeof globalThis&{comicHuddlePool:Pool}).comicHuddlePool=pool;await db.batch(seedStarterStatements(db,now));
 await engine.exec(`INSERT INTO gcd.gcd_publisher VALUES(78,'QA Publisher',0),(79,'Fiction House',0);INSERT INTO gcd.gcd_series VALUES(17,'Secret Wars',78,0),(18,'Planet Comics',79,0);
  INSERT INTO gcd.gcd_issue(id,series_id,number,key_date,variant_name,deleted) VALUES(123,17,'1','1984-05-00','',0),(124,17,'2','1984-06-00','',0),(1400,18,'12','1941-05-00','',0)`);
 for(const view of (await engine.query<{name:string}>(`SELECT schemaname||'.'||matviewname AS name FROM pg_matviews WHERE schemaname IN ('gcd','ch_web')`)).rows)await engine.exec('REFRESH MATERIALIZED VIEW '+view.name).catch(()=>undefined);
 await profile('seller','user-seller');await profile('collector','user-collector');await profile('hidden-collector','user-hidden',{visible:0});await profile('banned','user-banned');
 await engine.exec(`INSERT INTO ch_web.account_restrictions(user_id,scope,created_at) VALUES('user-banned','account','${now}')`);
 for(const [n,user] of [[1,'user-seller'],[2,'user-seller'],[3,'user-seller'],[4,'user-collector'],[5,'user-collector'],[6,'user-hidden'],[7,'user-banned'],[8,'user-banned'],[9,'user-collector']] as const)await photo(n,user);
});
after(async()=>{await engine.close();delete(globalThis as typeof globalThis&{comicHuddlePool?:Pool}).comicHuddlePool;for(const key of ['METRON_API_TOKEN','COVER_DIRECT_DISPLAY'])delete process.env[key]});

test('fallback order is seller photo, then collector cover',()=>{
 assert.deepEqual(FALLBACK_COVER_ORDER,['seller','community']);
 const seller={url:'/s',attribution:SELLER_PHOTO_CREDIT,source:'',origin:'seller' as const},collector={url:'/c',attribution:COMMUNITY_COVER_CREDIT,source:'',origin:'community' as const};
 assert.equal(pickFallbackCover({seller,community:collector}),seller);assert.equal(pickFallbackCover({community:collector}),collector);assert.equal(pickFallbackCover({}),null);
 assert.equal(coverMediaId(communityPhotoUrl(uuid(4))),uuid(4));assert.equal(coverMediaId('/api/media?id=x'),null);assert.equal(coverMediaId('https://evil.example/api/media?id='+uuid(4)),null);
});

test('collector cover fills a gap; most recent approved wins; hidden/rejected/pending and restricted uploaders never show',async()=>{
 await community('c-old',ISSUE,4,'user-collector','approved','2026-01-01T00:00:00Z');
 await community('c-new',ISSUE,5,'user-collector','approved','2026-02-01T00:00:00Z');
 await community('c-hidden',ISSUE,6,'user-hidden','hidden','2026-03-01T00:00:00Z');
 await community('c-banned',ISSUE,7,'user-banned','approved','2026-04-01T00:00:00Z');
 await community('c-pending',OTHER,8,'user-banned','pending','2026-04-01T00:00:00Z');
 const [resolved]=await resolveCoverBatch(db,[ISSUE]);
 assert.equal(resolved.url,communityPhotoUrl(uuid(5)));assert.equal(resolved.attribution,COMMUNITY_COVER_CREDIT);
 const [issue]=await catalogIssuesById(db,[ISSUE]);
 assert.equal(issue.cover,communityPhotoUrl(uuid(5)));assert.equal(issue.coverCredit,COMMUNITY_COVER_CREDIT);assert.ok(issue.coverSource);
 assert.equal((await fallbackCovers(db,[OTHER])).size,0,'pending and restricted submissions are not shown');
 assert.equal(await isPublicCoverPhoto(db,uuid(5)),true);assert.equal(await isPublicCoverPhoto(db,uuid(6)),false);assert.equal(await isPublicCoverPhoto(db,uuid(7)),false);
});

test('seller front photo outranks collector covers; active beats most recent sold; other photos stay private',async()=>{
 await listing('sold-old',"seller",ISSUE,'sold',[uuid(1),uuid(3)],'2026-01-01T00:00:00Z');
 let [resolved]=await resolveCoverBatch(db,[ISSUE]);
 assert.equal(resolved.url,communityPhotoUrl(uuid(1)));assert.equal(resolved.attribution,SELLER_PHOTO_CREDIT);
 assert.equal(await isPublicCoverPhoto(db,uuid(1)),true,'front photo of a sold listing is a public catalog cover');
 assert.equal(await isPublicCoverPhoto(db,uuid(3)),false,'later photos of a sold listing stay private');
 await listing('active-older','seller',ISSUE,'active',[uuid(2)],'2025-06-01T00:00:00Z');
 [resolved]=await resolveCoverBatch(db,[ISSUE]);assert.equal(resolved.url,communityPhotoUrl(uuid(2)),'an active listing wins over a newer sold one');
 const [issue]=await catalogIssuesById(db,[ISSUE]);assert.equal(issue.cover,communityPhotoUrl(uuid(2)));assert.equal(issue.coverCredit,SELLER_PHOTO_CREDIT);
 // A seller who is no longer publicly visible stops supplying covers.
 await engine.exec(`UPDATE ch_web.profiles SET visible=0 WHERE id='seller'`);
 [resolved]=await resolveCoverBatch(db,[ISSUE]);assert.equal(resolved.url,communityPhotoUrl(uuid(5)));assert.equal(await isPublicCoverPhoto(db,uuid(1)),false);
 await engine.exec(`UPDATE ch_web.profiles SET visible=1 WHERE id='seller'`);
});

test('Metron direct display outranks both fallbacks; a pending Metron lookup keeps polling with the fallback shown',async()=>{
 Object.assign(process.env,{METRON_API_TOKEN:'qa_token_'+'x'.repeat(30),COVER_DIRECT_DISPLAY:'metron'});
 let [resolved]=await resolveCoverBatch(db,[ISSUE]);
 assert.equal(resolved.status,'PENDING');assert.equal(resolved.url,communityPhotoUrl(uuid(2)),'fallback shown while Metron resolves');
 await engine.exec(`UPDATE ch_web.cover_cache SET status='CACHED',source_url='${METRON_IMAGE}',permission_expires_at=now()+interval '1 day' WHERE issue_id=${ISSUE} AND source_provider='METRON' AND source_cover_id='direct'`);
 [resolved]=await resolveCoverBatch(db,[ISSUE]);assert.equal(resolved.status,'CACHED');assert.equal(resolved.url,METRON_IMAGE);
 const [issue]=await catalogIssuesById(db,[ISSUE]);assert.equal(issue.cover,METRON_IMAGE);
 delete process.env.COVER_DIRECT_DISPLAY;
});

test('reviewed local /covers/ files stay first',async()=>{
 await listing('planet','seller',PLANET,'active',[uuid(2)],now);
 await community('c-planet',PLANET,9,'user-collector','approved',now);
 const [issue]=await catalogIssuesById(db,[PLANET]);
 assert.equal(issue.cover,'/covers/planet-12.jpg');
 const [resolved]=await resolveCoverBatch(db,[PLANET]);assert.equal(resolved.url,'/covers/planet-12.jpg');
});

test('submission validation: zod input, type/size/dimension checks, re-encode to WebP ≤1200px without EXIF',async()=>{
 assert.equal(communityCoverSubmission.safeParse({issueId:String(ISSUE),contentType:'image/jpeg'}).success,true);
 for(const bad of [{issueId:'abc',contentType:'image/jpeg'},{issueId:'-1',contentType:'image/png'},{issueId:'1.5',contentType:'image/png'},{issueId:'9999999999',contentType:'image/png'},{issueId:'1',contentType:'image/gif'},{issueId:'1',contentType:'image/svg+xml'},{issueId:'1',contentType:'image/png',extra:1}])assert.equal(communityCoverSubmission.safeParse(bad).success,false,JSON.stringify(bad));
 assert.equal(communityCoverReport.safeParse({mediaId:uuid(1)}).success,true);assert.equal(communityCoverReport.safeParse({mediaId:'../x'}).success,false);assert.equal(communityCoverReport.safeParse({mediaId:uuid(1),reason:'x'.repeat(501)}).success,false);
 const big=await sharp({create:{width:2000,height:3000,channels:3,background:'#c33'}}).jpeg().withMetadata({exif:{IFD0:{Copyright:'QA secret owner',Artist:'QA'}},orientation:1}).toBuffer();
 assert.ok((await sharp(big).metadata()).exif,'fixture carries EXIF');
 const out=await normalizeCommunityCover(big,'image/jpeg'),meta=await sharp(out.bytes).metadata();
 assert.equal(out.contentType,'image/webp');assert.equal(meta.format,'webp');assert.ok(Math.max(meta.width!,meta.height!)<=1200);assert.equal(meta.height,1200);
 assert.equal(meta.exif,undefined,'EXIF stripped');assert.ok(!out.bytes.includes(Buffer.from('QA secret owner')));assert.match(out.hash,/^[a-f0-9]{64}$/);
 assert.ok((await sharp(out.thumbnail).metadata()).width!<=480);
 // Rotated phone photos are baked upright before resizing.
 const sideways=await sharp({create:{width:1500,height:1000,channels:3,background:'#36c'}}).jpeg().withMetadata({orientation:6}).toBuffer();
 const upright=await sharp((await normalizeCommunityCover(sideways,'image/jpeg')).bytes).metadata();assert.ok(upright.height!>upright.width!);
 const png=await sharp({create:{width:400,height:600,channels:4,background:'#fff'}}).png().toBuffer();
 assert.equal((await normalizeCommunityCover(png,'image/png')).width,400,'small photos are not enlarged');
 await assert.rejects(normalizeCommunityCover(png,'image/jpeg'),/JPEG, PNG or WebP/,'declared type must match the decoded image');
 await assert.rejects(normalizeCommunityCover(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),'image/png'),/JPEG, PNG or WebP/);
 await assert.rejects(normalizeCommunityCover(await sharp({create:{width:150,height:220,channels:3,background:'#000'}}).png().toBuffer(),'image/png'),/at least 200 pixels/);
 await assert.rejects(normalizeCommunityCover(await sharp({create:{width:2000,height:300,channels:3,background:'#000'}}).png().toBuffer(),'image/png'),/Crop/);
 await assert.rejects(normalizeCommunityCover(new Uint8Array(10*1024*1024+1),'image/png'),/10 MB/);
 const gif=await sharp({create:{width:400,height:600,channels:3,background:'#000'}}).gif().toBuffer();
 await assert.rejects(normalizeCommunityCover(gif,'image/gif'),/JPEG, PNG or WebP/);
 assert.equal(initialCommunityCoverStatus({}),'approved');assert.equal(initialCommunityCoverStatus({COMMUNITY_COVERS_REVIEW:'manual'}),'pending');
});

test('daily submission count and Report image hide the cover after one signed-in report',async()=>{
 assert.equal(await communitySubmissionsToday(db,'user-collector'),1,'only the submission created today counts');
 await engine.exec(`DELETE FROM ch_web.listings`);
 assert.equal((await resolveCoverBatch(db,[ISSUE]))[0].url,communityPhotoUrl(uuid(5)));
 assert.deepEqual(await reportCommunityCover(db,'user-seller',{mediaId:uuid(5)}),{hidden:true});
 await reportCommunityCover(db,'user-seller',{mediaId:uuid(5)});
 const row=(await engine.query<{status:string;report_count:number}>(`SELECT status,report_count FROM ch_web.community_covers WHERE id='c-new'`)).rows[0];
 assert.deepEqual(row,{status:'hidden',report_count:1},'one report per reporter');
 assert.equal((await resolveCoverBatch(db,[ISSUE]))[0].url,communityPhotoUrl(uuid(4)),'the next most recent approved cover takes over');
 assert.equal(await isPublicCoverPhoto(db,uuid(5)),false,'a reported cover is no longer public');
 await assert.rejects(reportCommunityCover(db,'user-seller',{mediaId:uuid(99)}),/not found/);
});
