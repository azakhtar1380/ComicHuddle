import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import type { Pool, PoolClient } from 'pg';
import { GCD_LICENSE, GCD_ORIGIN, normalizeGcdIssue } from './gcd-catalog';
import { catalogSearchText, plainCatalogText } from './shared-catalog';
import { seriesIndexEnvelopes } from './gcd-series-index';

type SourcePage = { url: string; seriesId: number; page: number; rows: number; fetchedAt: string; responseSha256: string;
  queryName?: string; queryYear?: number; responseFile?: string; publisherFile?: string; publisherSha256?: string };
export type GcdSeedManifest = {
  schemaVersion: 'gcd-rds-seed/v1' | 'gcd-rds-series-index/v1'; provider: 'GCD';
  scope: 'selected_series_main_story_overviews' | 'selected_series_issue_indexes'; catalogComplete: false;
  license: string; expectedRecords: number; datasetSha256: string;
  sources: SourcePage[]; series: unknown[];
  artworkImported: false; valuationImported: false;
};
const sha256 = (input: string | Buffer) => createHash('sha256').update(input).digest('hex');
const hashValid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function validateSeedManifest(value: unknown): GcdSeedManifest {
  const index = object(value) && value.schemaVersion === 'gcd-rds-series-index/v1' && value.scope === 'selected_series_issue_indexes';
  if (!object(value) || (!index && (value.schemaVersion !== 'gcd-rds-seed/v1' || value.scope !== 'selected_series_main_story_overviews')) || value.provider !== 'GCD' ||
      value.catalogComplete !== false ||
      value.license !== GCD_LICENSE || value.artworkImported !== false || value.valuationImported !== false ||
      !hashValid(value.datasetSha256) || !Number.isSafeInteger(value.expectedRecords) ||
      Number(value.expectedRecords) < 1 || Number(value.expectedRecords) > 10_000_000 ||
      !Array.isArray(value.sources) || !value.sources.length || value.sources.length > 100_000 || !Array.isArray(value.series)) {
    throw new Error('Unsupported GCD seed manifest or unapproved coverage claim.');
  }
  const urls = new Set<string>(); let total = 0;
  for (const source of value.sources) {
    if (!object(source) || typeof source.url !== 'string' || urls.has(source.url) ||
        !Number.isSafeInteger(source.seriesId) || Number(source.seriesId) < 1 ||
        !Number.isSafeInteger(source.page) || Number(source.page) < 1 ||
        !Number.isSafeInteger(source.rows) || Number(source.rows) < 0 || Number(source.rows) > (index ? 100_000 : 50) ||
        !hashValid(source.responseSha256) || typeof source.fetchedAt !== 'string' ||
        !Number.isFinite(Date.parse(source.fetchedAt)) || Date.parse(source.fetchedAt) > Date.now()) {
      throw new Error('Invalid GCD seed source receipt.');
    }
    let expected = `${GCD_ORIGIN}/api/series/${source.seriesId}/overview/` + (source.page === 1 ? '' : `?page=${source.page}`);
    if (index) {
      expected = `${GCD_ORIGIN}/api/series/${source.seriesId}/`;
      if (source.queryName !== undefined) {
        if (typeof source.queryName !== 'string' || source.queryName.length > 160 || !Number.isInteger(source.queryYear) || Number(source.queryYear) < 1800 || Number(source.queryYear) > 9999) throw Error('Invalid GCD index search source.');
        expected = `${GCD_ORIGIN}/api/series/name/${encodeURIComponent(source.queryName)}/year/${source.queryYear}/`;
      }
      if (source.page !== 1 || typeof source.responseFile !== 'string' || !/^gcd-series-sources\/[a-z0-9-]+\.json$/.test(source.responseFile) ||
          typeof source.publisherFile !== 'string' || !/^gcd-series-sources\/publisher-[1-9]\d*\.json$/.test(source.publisherFile) || !hashValid(source.publisherSha256)) throw Error('Invalid GCD index witness path.');
    }
    if (source.url !== expected) throw new Error('GCD seed source cannot change provider, path or page.');
    total += Number(source.rows); urls.add(source.url);
  }
  if (total !== value.expectedRecords) throw new Error('Seed count does not reconcile with its source-page receipts.');
  return value as unknown as GcdSeedManifest;
}

async function* lines(file: string, onBytes?: (chunk: Buffer) => void) {
  const decoder = new TextDecoder('utf-8', { fatal: true }); let pending = '';
  for await (const chunk of createReadStream(file, { highWaterMark: 65536 })) {
    const bytes = chunk as Buffer; onBytes?.(bytes); pending += decoder.decode(bytes, { stream: true });
    let split: number;
    while ((split = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, split); pending = pending.slice(split + 1);
      if (!line || Buffer.byteLength(line) > 190_000) throw new Error('Invalid or oversized GCD seed line.');
      yield JSON.parse(line) as unknown;
    }
    if (Buffer.byteLength(pending) > 190_000) throw new Error('Oversized GCD seed line.');
  }
  pending += decoder.decode();
  if (pending) throw new Error('The reviewed GCD JSONL must end with a newline.');
}

const allowed = new Set(['api_url', 'series', 'series_name', 'publisher_name', 'number', 'descriptor', 'publication_date', 'key_date', 'on_sale_date', 'variant_of', 'story_set', 'notes']);
export function seedRecord(value: unknown, manifest: GcdSeedManifest) {
  if (!object(value) || Object.keys(value).some(key => !['sourcePage', 'fetchedAt', 'record'].includes(key)) ||
      typeof value.sourcePage !== 'string' || typeof value.fetchedAt !== 'string' || !object(value.record) ||
      Object.keys(value.record).some(key => !allowed.has(key) && !(manifest.schemaVersion === 'gcd-rds-series-index/v1' && key === 'variant_name')) || value.record.variant_of !== null ||
      !Array.isArray(value.record.story_set) || value.record.story_set.length > 1 ||
      Buffer.byteLength(JSON.stringify(value.record)) > 180_000) throw new Error('Unsafe or unsupported GCD overview record.');
  const source = manifest.sources.find(source => source.url === value.sourcePage);
  if (!source || value.fetchedAt !== source.fetchedAt || value.record.series !== `${GCD_ORIGIN}/api/series/${source.seriesId}/`) {
    throw new Error('The GCD issue does not match its source receipt.');
  }
  // Only the reviewed projection reaches PostgreSQL; image fields, asking
  // prices and inferred valuations cannot enter through this seed format.
  const normalized = normalizeGcdIssue(value.record, value.fetchedAt);
  const issue = normalized.issue;
  issue.dataCredit = 'Bibliographic base issue and longest comic story from the Grand Comics Database; selected and formatted by ComicHuddle. Full issue fields and variants are incomplete.';
  if (manifest.schemaVersion === 'gcd-rds-series-index/v1') {
    delete issue.bibliography;
    issue.variant = plainCatalogText(value.record.descriptor, 2000);
    issue.dataCredit = 'Issue identity and complete edition descriptor from the Grand Comics Database series index; selected and formatted by ComicHuddle. The displayed numeric issue label is extracted from that descriptor. Raw issue numbers and variant relationships require full issue details; dates, stories, credits, artwork and valuations are not inferred.';
  }
  const metadata = JSON.parse(normalized.rawMetadata) as Record<string, unknown>;
  return {
    id: issue.id, gcd_id: issue.gcdId!, title: issue.title, number: issue.number,
    publisher: issue.publisher, year: issue.year, era: issue.era, kind: issue.kind,
    search_text: catalogSearchText(issue, manifest.schemaVersion === 'gcd-rds-series-index/v1'), data: JSON.stringify(issue), fetched_at: normalized.stamp,
    raw_metadata: JSON.stringify({ ...metadata, metadataScope: manifest.scope, sourcePage: source.url, responseSha256: source.responseSha256 }),
  };
}
type SeedRow = ReturnType<typeof seedRecord>;

export async function preflightSeed(file: string, manifest: GcdSeedManifest) {
  const digest = createHash('sha256'), bySource = new Map<string, number>(), batchHashes: string[] = [];
  let count = 0, last = 0, batch: SeedRow[] = [];
  const witnessed = new Map<number, unknown>();
  if (manifest.schemaVersion === 'gcd-rds-series-index/v1') {
    for (const source of manifest.sources) {
      const responseBytes = await readFile(resolve(dirname(file), source.responseFile!));
      const publisherBytes = await readFile(resolve(dirname(file), source.publisherFile!));
      if (responseBytes.length > 6_000_000 || publisherBytes.length > 100_000 || sha256(responseBytes) !== source.responseSha256 || sha256(publisherBytes) !== source.publisherSha256) throw Error('GCD source witness failed its recorded checksum.');
      const index = seriesIndexEnvelopes(JSON.parse(responseBytes.toString('utf8')), source.seriesId, JSON.parse(publisherBytes.toString('utf8')),
        { url: source.url, fetchedAt: source.fetchedAt, sha256: source.responseSha256, bytes: responseBytes.length, httpStatus: 200 });
      if (index.records.length !== source.rows) throw Error('GCD source witness does not reconcile with the accepted issue count.');
      for (const record of index.records) {
        const id = Number(record.record.api_url.match(/\/([1-9]\d*)\/$/)![1]);
        if (witnessed.has(id)) throw Error('GCD source witnesses repeat an issue identity.');
        witnessed.set(id, record);
      }
    }
  }
  for await (const raw of lines(file, bytes => digest.update(bytes))) {
    const row = seedRecord(raw, manifest);
    if (manifest.schemaVersion === 'gcd-rds-series-index/v1' && JSON.stringify(raw) !== JSON.stringify(witnessed.get(row.gcd_id))) throw Error('GCD index row differs from its actual provider source witness.');
    if (row.gcd_id <= last) throw new Error('GCD seed identities must be unique and ascending.');
    last = row.gcd_id; count++;
    batch.push(row);
    if (batch.length === 100) { batchHashes.push(sha256(JSON.stringify(batch))); batch = []; }
    const source = (raw as { sourcePage: string }).sourcePage;
    bySource.set(source, (bySource.get(source) || 0) + 1);
  }
  if (count !== manifest.expectedRecords || digest.digest('hex') !== manifest.datasetSha256 ||
      manifest.sources.some(source => (bySource.get(source.url) || 0) !== source.rows)) {
    throw new Error('GCD seed count, source counts or file checksum does not match the reviewed manifest.');
  }
  if (batch.length) batchHashes.push(sha256(JSON.stringify(batch)));
  return { count, batchHashes };
}

async function confirmRows(client: PoolClient, rows: SeedRow[]) {
  const result = await client.query<{ n: string | number }>(
    'SELECT count(*) AS n FROM ch_web.catalog_issues WHERE gcd_id=ANY($1::bigint[]) AND id=4000000000+gcd_id',
    [rows.map(row => row.gcd_id)]);
  if (Number(result.rows[0].n) !== rows.length) throw new Error('Imported GCD identities failed database reconciliation.');
}

export async function importGcdSeed(pool: Pool, file: string, manifestFile: string) {
  const manifestText = await readFile(manifestFile, 'utf8');
  const manifest = validateSeedManifest(JSON.parse(manifestText));
  const reviewed = await preflightSeed(file, manifest); // Validate every byte/record before any database write.
  const id = manifest.datasetSha256, manifestHash = sha256(manifestText), client = await pool.connect();
  let locked = false;
  try {
    const lease = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock(hashtext('comichuddle-gcd-seed')) AS acquired");
    if (!lease.rows[0].acquired) throw new Error('Another GCD seed is running. Its checkpoint is preserved.');
    locked = true;
    await client.query(`INSERT INTO ch_web.catalog_ingestion_runs(id,manifest_sha256,manifest,expected_records)
      VALUES($1,$2,$3::jsonb,$4) ON CONFLICT(id) DO NOTHING`, [id, manifestHash, manifestText, manifest.expectedRecords]);
    const run = await client.query<{ manifest_sha256: string }>('SELECT manifest_sha256 FROM ch_web.catalog_ingestion_runs WHERE id=$1', [id]);
    if (run.rows[0].manifest_sha256 !== manifestHash) throw new Error('An existing seed manifest was modified.');
    let batchIndex = 0, chunk: SeedRow[] = [];
    async function commitBatch(rows: SeedRow[]) {
      const payload = JSON.stringify(rows), payloadHash = sha256(payload);
      if (payloadHash !== reviewed.batchHashes[batchIndex]) throw new Error('Seed input changed after preflight validation.');
      await client.query('BEGIN');
      try {
        const old = await client.query<{ payload_sha256: string }>(
          'SELECT payload_sha256 FROM ch_web.catalog_ingestion_batches WHERE run_id=$1 AND batch_index=$2', [id, batchIndex]);
        if (old.rows[0]) {
          if (old.rows[0].payload_sha256 !== payloadHash) throw new Error('Seed replay differs from the committed batch.');
          await confirmRows(client, rows); await client.query('COMMIT'); batchIndex++; return;
        }
        const state = await client.query<{ next_batch: string | number; stage: string }>(
          'SELECT next_batch,stage FROM ch_web.catalog_ingestion_runs WHERE id=$1 FOR UPDATE', [id]);
        if (Number(state.rows[0].next_batch) !== batchIndex || state.rows[0].stage !== 'OPEN') throw new Error('Seed checkpoint changed.');
        const inserted = await client.query(`INSERT INTO ch_web.catalog_issues
          (id,gcd_id,title,number,publisher,year,era,kind,search_text,data,fetched_at,raw_metadata)
          SELECT id,gcd_id,title,number,publisher,year,era,kind,search_text,data,fetched_at,raw_metadata
          FROM jsonb_to_recordset($1::jsonb) AS input(id bigint,gcd_id bigint,title text,number text,publisher text,
            year bigint,era text,kind text,search_text text,data text,fetched_at text,raw_metadata text)
          ON CONFLICT(gcd_id) DO NOTHING RETURNING id`, [payload]);
        const written = inserted.rows.length, retained = rows.length - written;
        await confirmRows(client, rows);
        await client.query(`INSERT INTO ch_web.catalog_ingestion_batches
          (run_id,batch_index,payload_sha256,record_count,inserted_records,retained_records) VALUES($1,$2,$3,$4,$5,$6)`,
          [id, batchIndex, payloadHash, rows.length, written, retained]);
        await client.query(`UPDATE ch_web.catalog_ingestion_runs SET accepted_records=accepted_records+$2,
          inserted_records=inserted_records+$3,retained_records=retained_records+$4,next_batch=next_batch+1 WHERE id=$1`,
          [id, rows.length, written, retained]);
        await client.query('COMMIT'); batchIndex++;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
    for await (const raw of lines(file)) {
      chunk.push(seedRecord(raw, manifest));
      if (chunk.length === 100) { await commitBatch(chunk); chunk = []; }
    }
    if (chunk.length) await commitBatch(chunk);
    const completed = await client.query(`UPDATE ch_web.catalog_ingestion_runs SET stage='COMPLETED',completed_at=coalesce(completed_at,now())
      WHERE id=$1 AND accepted_records=expected_records RETURNING accepted_records,inserted_records,retained_records,completed_at`, [id]);
    if (!completed.rows[0]) throw new Error('GCD seed did not meet its declared record count.');
    const totals = await client.query('SELECT count(*) AS indexed, count(gcd_id) AS gcd, count(metron_id) AS metron FROM ch_web.catalog_issues');
    return { importId: id, catalogComplete: false, source: manifest.schemaVersion === 'gcd-rds-series-index/v1' ? 'Official GCD selected-series issue indexes' : 'Official GCD selected-series main-story overviews',
      ...completed.rows[0], ...totals.rows[0], scope: manifest.series };
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtext('comichuddle-gcd-seed'))");
    client.release();
  }
}
