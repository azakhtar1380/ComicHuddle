import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { importGcdSeed, preflightSeed, seedRecord, validateSeedManifest } from '../lib/gcd-postgres-seed';
import { seedStarterStatements, searchSharedCatalog, catalogOverview } from '../lib/catalog-store';
import { getDb } from '../db';

const file = resolve('db/gcd-overview-seed.jsonl'), manifestFile = resolve('db/gcd-overview-seed.manifest.json');
let engine: PGlite, temporary: string, pool: Pool, failNextCatalogInsert = false;
const manifest = validateSeedManifest(JSON.parse(await readFile(manifestFile, 'utf8')));
const raw = (await readFile(file, 'utf8')).trimEnd().split('\n').map(line => JSON.parse(line));

before(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'comichuddle-gcd-seed-'));
  engine = new PGlite();
  await engine.exec('CREATE SCHEMA ch_web; BEGIN;');
  for (const name of ['001_original_comichuddle.sql', '002_runtime.sql', '003_catalog_ingestion.sql']) {
    await engine.exec(await readFile('db/postgres-migrations/' + name, 'utf8'));
  }
  await engine.exec('COMMIT; SET search_path TO ch_web,public;');
  const query = async (config: string | { text: string; rowMode?: string }, values: unknown[] = []) => {
    const text = typeof config === 'string' ? config : config.text;
    if (failNextCatalogInsert && text.startsWith('INSERT INTO ch_web.catalog_issues')) {
      failNextCatalogInsert = false; throw new Error('Simulated transient database failure.');
    }
    const result = await engine.query<Record<string, unknown>>(text, values);
    return { ...result, rowCount: result.affectedRows, command: '', rows: typeof config !== 'string' && config.rowMode === 'array'
      ? result.rows.map(row => result.fields.map(field => row[field.name])) : result.rows };
  };
  pool = { query, connect: async () => ({ query, release() {} }) } as unknown as Pool;
  (globalThis as typeof globalThis & { comicHuddlePool: Pool }).comicHuddlePool = pool;
  await getDb().batch(seedStarterStatements(getDb(), new Date().toISOString()));
});
after(async () => {
  await engine.close(); await rm(temporary, { recursive: true, force: true });
  delete (globalThis as typeof globalThis & { comicHuddlePool?: Pool }).comicHuddlePool;
});

test('all real captured records reconcile with their hashes and page receipts', async () => {
  const checked = await preflightSeed(file, manifest);
  assert.equal(checked.count, 993); assert.equal(checked.batchHashes.length, 10);
  const row = seedRecord(raw[0], manifest), issue = JSON.parse(row.data);
  assert.ok(issue.gcdId > 0); assert.equal(row.id, 4_000_000_000 + issue.gcdId);
  assert.equal(issue.dataLicense, 'https://creativecommons.org/licenses/by-sa/4.0/');
  assert.equal(issue.cover, undefined); assert.equal(issue.fmv, undefined);
  assert.match(issue.dataCredit, /Full issue fields and variants are incomplete/);
});
test('unsafe sources, artwork and fabricated complete-catalog claims are rejected before writes', async () => {
  assert.throws(() => validateSeedManifest({ ...manifest, catalogComplete: true }));
  assert.throws(() => validateSeedManifest({ ...manifest, sources: [{ ...manifest.sources[0], url: 'https://attacker.invalid/data' }] }));
  assert.throws(() => seedRecord({ ...raw[0], record: { ...raw[0].record, cover: 'https://example.invalid/cover.jpg' } }, manifest));
  const altered = join(temporary, 'altered.jsonl');
  await writeFile(altered, (await readFile(file, 'utf8')).replace('Official GCD series overview:', 'Altered description:'));
  await assert.rejects(preflightSeed(altered, manifest), /checksum/);
  const duplicate = join(temporary, 'duplicate.jsonl');
  await writeFile(duplicate, JSON.stringify(raw[0]) + '\n' + JSON.stringify(raw[0]) + '\n');
  await assert.rejects(preflightSeed(duplicate, manifest), /unique and ascending/);
  const counts = await engine.query<{ n: number }>('SELECT count(*)::int AS n FROM ch_web.catalog_ingestion_runs');
  assert.equal(counts.rows[0].n, 0);
});
test('interrupted batches roll back and the same seed resumes with existing richer metadata retained', async () => {
  const richer = seedRecord(raw[0], manifest);
  richer.data = JSON.stringify({ ...JSON.parse(richer.data), note: 'Previously reviewed complete issue bibliography.' });
  await engine.query(`INSERT INTO ch_web.catalog_issues(id,gcd_id,title,number,publisher,year,era,kind,search_text,data,fetched_at,raw_metadata)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, Object.values(richer));
  failNextCatalogInsert = true;
  await assert.rejects(importGcdSeed(pool, file, manifestFile), /Simulated transient/);
  const before = await engine.query<{ accepted_records: number }>('SELECT accepted_records::int FROM ch_web.catalog_ingestion_runs');
  assert.equal(before.rows[0].accepted_records, 0);
  const result = await importGcdSeed(pool, file, manifestFile);
  assert.equal(Number(result.accepted_records), 993);
  assert.equal(Number(result.inserted_records), 992); assert.equal(Number(result.retained_records), 1);
  assert.equal(Number(result.indexed), 1036); assert.equal(Number(result.gcd), 993);
  const preserved = await engine.query<{ data: string }>('SELECT data FROM ch_web.catalog_issues WHERE gcd_id=$1', [richer.gcd_id]);
  assert.equal(JSON.parse(preserved.rows[0].data).note, 'Previously reviewed complete issue bibliography.');
  const batches = await engine.query<{ n: number }>('SELECT count(*)::int AS n FROM ch_web.catalog_ingestion_batches');
  assert.equal(batches.rows[0].n, 10);
});
test('replaying a completed seed is idempotent and cannot accept a modified manifest', async () => {
  const replay = await importGcdSeed(pool, file, manifestFile);
  assert.equal(Number(replay.indexed), 1036); assert.equal(Number(replay.inserted_records), 992);
  assert.equal(Number(replay.accepted_records), 993); assert.ok(replay.completed_at);
  const changed = join(temporary, 'changed.manifest.json');
  await writeFile(changed, JSON.stringify({ ...manifest, attribution: 'Modified receipt' }));
  await assert.rejects(importGcdSeed(pool, file, changed), /manifest was modified/);
});
test('the existing directory search queries all imported PostgreSQL rows with pagination', async () => {
  const overview = await catalogOverview(getDb());
  assert.equal(overview.issueCount, 1036); assert.equal(overview.gcdIssueCount, 993);
  const result = await searchSharedCatalog(getDb(), { q: 'Amazing Spider-Man #50', limit: 12, offset: 0 });
  assert.ok(result.issues.some(issue => issue.gcdId && issue.number === '50'));
  const tail = await searchSharedCatalog(getDb(), { q: '', limit: 12, offset: 1024 });
  assert.equal(tail.issues.length, 12); assert.equal(tail.total, 1036); assert.equal(tail.hasMore, false);
  const spawn = await searchSharedCatalog(getDb(), { q: 'Spawn', publisher: 'Image', limit: 12, offset: 0 });
  assert.ok(spawn.total >= 150);
});
