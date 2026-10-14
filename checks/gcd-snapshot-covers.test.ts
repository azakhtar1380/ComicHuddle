import {nativeGcdFixture} from './native-gcd-fixture';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { getDb } from '../db';
import { importGcdSnapshot, type SnapshotReport } from '../lib/gcd-snapshot-import';
import { readGcdCoverSeed } from '../lib/gcd-cover-seed';
import { gcdThumbnailUrl, withCatalogCovers } from '../lib/catalog-covers';
import { catalogOverview, catalogIssue, searchSharedCatalog } from '../lib/catalog-store';
import { GET as weeklyGet } from '../app/api/cron/new-releases/route';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
async function engine() {
  const database = new PGlite();await nativeGcdFixture(database); await database.exec('CREATE SCHEMA ch_web;');
  for (const name of ['001_original_comichuddle.sql','002_runtime.sql','003_catalog_ingestion.sql','004_catalog_cover_references.sql','005_gcd_snapshot_import.sql','010_native_gcd_directory.sql','013_native_directory_join.sql','014_preserve_incomplete_snapshot.sql','015_native_readiness_gate.sql','016_fast_catalog_fallback.sql']) {
    await database.exec(await readFile('db/postgres-migrations/' + name,'utf8'));
  }
  await database.exec('SET search_path TO ch_web,public;');
  const pool = new Pool();
  const query = async (config: string | { text: string; rowMode?: string }, values: unknown[] = []) => {
    const result = await database.query<Record<string, unknown>>(typeof config === 'string' ? config : config.text, values);
    return { ...result, rowCount: result.affectedRows, command: '', rows: typeof config !== 'string' && config.rowMode === 'array' ? result.rows.map(row => result.fields.map(field => row[field.name])) : result.rows };
  };
  Object.assign(pool, { query, connect: async () => ({ query, release() {} }) });
  return { database, pool };
}
function fixture(id: number, cover = false) {
  return { api_url: `https://www.comics.org/api/issue/${id}/`, series: 'https://www.comics.org/api/series/30/',
    series_name: 'Isolated QA Series (1998 series)', number: String(id), descriptor: String(id), publisher_name: 'Isolated QA Publisher',
    key_date: '1998-10-00', variant_of: null, story_set: [],
    ...(cover ? { cover: 'https://files1.comics.org/img/gcd/covers_by_id/27/w400/27847.jpg',
      cover_metadata: { coverId: 27847, issueId: id, sourceTable: 'gcd_cover', artworkBinariesCopied: false,
        thumbnailWidth: 400, mimeType: 'image/jpeg', isWraparound: false, lastUpload: null, modified: null } } : {}) };
}
async function files(folder: string, rows: unknown[], stamp = '2026-10-01T12:00:00.000Z') {
  const bytes = rows.map(row => JSON.stringify(row) + '\n').join(''), file = join(folder,crypto.randomUUID()+'.jsonl'), reportFile = file+'.json';
  const report: SnapshotReport = { format: 'GCD_API_SHAPED_JSONL', sourceUrl: 'https://www.comics.org/download/', snapshotAt: stamp,
    inputSha256: hash('ISOLATED_QA_ARCHIVE'), outputSha256: hash(bytes), activeIssueCount: rows.length, exportedIssueCount: rows.length,
    license: 'https://creativecommons.org/licenses/by-sa/4.0/', inputModified: false, upstreamRequests: 0,
    allActiveIssueIdentitiesExported: true, allBibliographicFieldsExported: false, fullHistoricalCoverageClaimed: false,
    coverReferencesIncluded: true, coverReferenceCount: rows.filter(row => !!(row as {cover?:unknown}).cover).length,
    artworkBinariesCopied: false, coversLicensedByMetadata: false };
  await writeFile(file,bytes); await writeFile(reportFile,JSON.stringify(report)); return {file,reportFile,report};
}

test('real retained API witnesses reconcile all exact cover references without image downloads', async () => {
  const result=await readGcdCoverSeed(process.cwd());
  assert.equal(result.references.length,result.manifest.expectedReferences); assert.ok(result.references.length>2000);
  assert.equal(result.manifest.artworkBinariesCopied,false);assert.equal(result.manifest.coversLicensedByMetadata,false);
  assert.equal(new Set(result.references.map(row=>row.gcd_id)).size,result.references.length);
  assert.ok(result.references.every(row=>row.issue_id===4_000_000_000+row.gcd_id&&gcdThumbnailUrl(row.image_url)));
});
test('thumbnail URLs cannot inject arbitrary hosts, credentials, scripts or unbounded artwork', () => {
  assert.ok(gcdThumbnailUrl('https://files1.comics.org//img/gcd/covers_by_id/27/w400/27847.jpg'));
  for(const value of ['javascript:alert(1)','https://files1.comics.org.evil.example/img/gcd/covers_by_id/27/w400/27847.jpg',
    'http://files1.comics.org/img/gcd/covers_by_id/27/w400/27847.jpg','https://user:pass@files1.comics.org/img/gcd/covers_by_id/27/w400/27847.jpg',
    'https://files1.comics.org/img/gcd/covers_by_id/27/w1200/27847.jpg',null]) assert.equal(gcdThumbnailUrl(value),null);
});
test('1001 snapshot issues import atomically in 500-row batches and replay without duplicates', async () => {
  const {database,pool}=await engine(),folder=await mkdtemp(join(tmpdir(),'gcd-snapshot-qa-'));
  try {
    const input=await files(folder,Array.from({length:1001},(_,index)=>fixture(index+1,index===0)));
    const result=await importGcdSnapshot(pool,input.file,input.reportFile); assert.equal(Number(result.indexed_issues),1001);
    assert.equal(Number(result.inserted_records),1001);assert.equal(Number(result.next_batch),3);assert.equal(result.stage,'COMPLETED');
    const again=await importGcdSnapshot(pool,input.file,input.reportFile);assert.equal(Number(again.indexed_issues),1001);assert.equal(Number(again.next_batch),3);
    assert.equal((await database.query('SELECT * FROM ch_web.catalog_snapshot_batches')).rows.length,3);
    const [cover]=(await database.query<{image_metadata:{coverId:number}}>('SELECT image_metadata FROM ch_web.catalog_cover_references')).rows;
    assert.equal(cover.image_metadata.coverId,27847);
    (globalThis as typeof globalThis&{comicHuddlePool?:Pool}).comicHuddlePool=pool;
    const issue=await catalogIssue(getDb(),4_000_000_001);assert.ok(issue?.cover);assert.match(issue!.coverCredit!,/Grand Comics Database/);
    const page=await searchSharedCatalog(getDb(),{q:'#1',limit:12,offset:0});assert.equal(page.issues[0].cover,issue!.cover);
    assert.equal((await catalogOverview(getDb())).coverIssueCount,1);
    await database.query("UPDATE ch_web.catalog_cover_references SET status='withdrawn'");
    assert.equal((await withCatalogCovers(getDb(),[issue!]))[0].id,issue!.id);
    // API starts with stored bibliography (which contains no image URL), so a
    // withdrawn overlay disappears immediately rather than remaining cached.
    assert.equal((await catalogIssue(getDb(),issue!.id))?.cover,undefined);
    assert.equal((await catalogOverview(getDb())).coverIssueCount,0);
  }finally{delete(globalThis as typeof globalThis&{comicHuddlePool?:Pool}).comicHuddlePool;await database.close();await rm(folder,{recursive:true,force:true});}
});
test('checksum errors and borrowed variant covers fail before any database write', async () => {
  const {database,pool}=await engine(),folder=await mkdtemp(join(tmpdir(),'gcd-snapshot-invalid-'));
  try {
    const bad=fixture(1,true);bad.cover_metadata!.issueId=2;
    const input=await files(folder,[bad]);await assert.rejects(importGcdSnapshot(pool,input.file,input.reportFile),/own GCD issue/);
    const valid=await files(folder,[fixture(1)]);await writeFile(valid.file,JSON.stringify(fixture(2))+'\n');
    await assert.rejects(importGcdSnapshot(pool,valid.file,valid.reportFile),/checksum/);
    assert.equal((await database.query('SELECT * FROM ch_web.catalog_issues')).rows.length,0);
    assert.equal((await database.query('SELECT * FROM ch_web.catalog_snapshot_imports')).rows.length,0);
  }finally{await database.close();await rm(folder,{recursive:true,force:true});}
});
test('50000-record isolated snapshot scales through 100 durable PostgreSQL batches', async () => {
  const {database,pool}=await engine(),folder=await mkdtemp(join(tmpdir(),'gcd-snapshot-scale-'));
  try{
    const input=await files(folder,Array.from({length:50000},(_,index)=>fixture(index+1)));
    const result=await importGcdSnapshot(pool,input.file,input.reportFile);
    assert.equal(Number(result.indexed_issues),50000);assert.equal(Number(result.accepted_records),50000);
    assert.equal(Number(result.next_batch),100);assert.equal(result.stage,'COMPLETED');
    assert.equal((await database.query('SELECT count(*) AS n FROM ch_web.catalog_snapshot_batches')).rows[0].n,100);
  }finally{await database.close();await rm(folder,{recursive:true,force:true});}
});
test('snapshot updates retain richer API bibliography and preserve explicit image withdrawals', async () => {
  const {database,pool}=await engine(),folder=await mkdtemp(join(tmpdir(),'gcd-snapshot-retention-'));
  try {
    const original=await files(folder,[fixture(1,true),fixture(2)]);await importGcdSnapshot(pool,original.file,original.reportFile);
    await database.query("UPDATE ch_web.catalog_issues SET raw_metadata='',data=jsonb_set(data::jsonb,'{note}','\"RICHER_API_SENTINEL\"')::text WHERE gcd_id=1");
    await database.query("UPDATE ch_web.catalog_cover_references SET status='withdrawn'");
    await database.query("UPDATE ch_web.catalog_issues SET raw_metadata='{\"metadataScope\":\"selected_series_issue_indexes\"}' WHERE gcd_id=2");
    const newer=await files(folder,[fixture(1,true),fixture(2)],'2026-10-02T12:00:00.000Z');
    const result=await importGcdSnapshot(pool,newer.file,newer.reportFile);assert.equal(Number(result.retained_records),1);assert.equal(Number(result.enriched_records),1);
    assert.match((await database.query<{data:string}>('SELECT data FROM ch_web.catalog_issues WHERE gcd_id=1')).rows[0].data,/RICHER_API_SENTINEL/);
    assert.equal((await database.query<{status:string}>('SELECT status FROM ch_web.catalog_cover_references')).rows[0].status,'withdrawn');
  }finally{await database.close();await rm(folder,{recursive:true,force:true});}
});
test('weekly Cron rejects unauthenticated callers before opening a database connection', async () => {
  const previous=process.env.CRON_SECRET;process.env.CRON_SECRET=crypto.randomUUID();
  try{assert.equal((await weeklyGet(new Request('https://comichuddle.test/api/cron/new-releases'))).status,401);}
  finally{if(previous===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=previous;}
});
test('authorized weekly job imports actual provider-shaped releases and their own cover references', async () => {
  const {database,pool}=await engine();
  const previousFetch=globalThis.fetch,previousSecret=process.env.CRON_SECRET,previousFlag=process.env.GCD_WEEKLY_SYNC_ENABLED;
  const token=crypto.randomUUID();process.env.CRON_SECRET=token;process.env.GCD_WEEKLY_SYNC_ENABLED='true';
  (globalThis as typeof globalThis&{comicHuddlePool?:Pool}).comicHuddlePool=pool;
  let weeklyPages=0,requests=0;
  globalThis.fetch=async input=>{
    requests++;const url=String(input);
    if(url.includes('/on_sale_weekly/'))return Response.json(weeklyPages++===0?{count:1,next:null,results:[{api_url:'https://www.comics.org/api/issue/1/',series:'https://www.comics.org/api/series/30/'}]}:{count:0,next:null,results:[]});
    if(url==='https://www.comics.org/api/issue/1/')return Response.json(fixture(1,true));
    throw Error('Unexpected fixture provider URL.');
  };
  try{
    const response=await weeklyGet(new Request('https://comichuddle.test/api/cron/new-releases',{headers:{Authorization:'Bearer '+token}}));
    assert.equal(response.status,200);assert.equal((await response.json()).status,'completed');assert.equal(requests,3);
    const record=await catalogIssue(getDb(),4_000_000_001);assert.ok(record?.cover);assert.match(record!.coverCredit!,/Grand Comics Database/);
    const status=await weeklyGet(new Request('https://comichuddle.test/api/cron/new-releases?status=1',{headers:{Authorization:'Bearer '+token}}));
    assert.equal((await status.json()).status,'configured');assert.equal(requests,3);
  }finally{
    globalThis.fetch=previousFetch;delete(globalThis as typeof globalThis&{comicHuddlePool?:Pool}).comicHuddlePool;
    if(previousSecret===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=previousSecret;
    if(previousFlag===undefined)delete process.env.GCD_WEEKLY_SYNC_ENABLED;else process.env.GCD_WEEKLY_SYNC_ENABLED=previousFlag;
    await database.close();
  }
});
