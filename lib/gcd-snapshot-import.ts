import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { normalizeGcdIssue } from './gcd-catalog';
import { catalogSearchText } from './shared-catalog';
import { gcdThumbnailUrl } from './catalog-covers';

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const MAX_BATCH = 500, MAX_BYTES = 8_000_000;
export type SnapshotReport = { format: 'GCD_API_SHAPED_JSONL'; sourceUrl: 'https://www.comics.org/download/';
  snapshotAt: string; inputSha256: string; outputSha256: string; activeIssueCount: number; exportedIssueCount: number;
  license: 'https://creativecommons.org/licenses/by-sa/4.0/'; inputModified: false; upstreamRequests: 0;
  allActiveIssueIdentitiesExported: boolean; allBibliographicFieldsExported: false; fullHistoricalCoverageClaimed: false;
  coverReferencesIncluded?: boolean; coverReferenceCount?: number; artworkBinariesCopied?: false; coversLicensedByMetadata?: false };
type Row = { id: number; gcd_id: number; title: string; number: string; publisher: string; year: number; era: string;
  kind: string; search_text: string; data: string; fetched_at: string; raw_metadata: string;
  cover: null | { issue_id: number; gcd_id: number; image_url: string; source_url: string; source_page: string;
    edition_descriptor: string; attribution: string; source_sha256: string; fetched_at: string; image_metadata: Record<string, unknown> } };

function reportValid(report: SnapshotReport, now: number) {
  if (report.format !== 'GCD_API_SHAPED_JSONL' || report.sourceUrl !== 'https://www.comics.org/download/' ||
      report.license !== 'https://creativecommons.org/licenses/by-sa/4.0/' || report.inputModified !== false || report.upstreamRequests !== 0 ||
      !/^[a-f0-9]{64}$/.test(report.inputSha256) || !/^[a-f0-9]{64}$/.test(report.outputSha256) ||
      !Number.isSafeInteger(report.activeIssueCount) || !Number.isSafeInteger(report.exportedIssueCount) ||
      report.exportedIssueCount < 1 || report.activeIssueCount < report.exportedIssueCount || report.activeIssueCount > 25_000_000 ||
      !Number.isFinite(Date.parse(report.snapshotAt)) || Date.parse(report.snapshotAt) > now ||
      report.allActiveIssueIdentitiesExported !== (report.activeIssueCount === report.exportedIssueCount) ||
      report.allBibliographicFieldsExported !== false || report.fullHistoricalCoverageClaimed !== false) throw Error('Invalid GCD snapshot conversion receipt.');
  return report;
}

function snapshotRow(raw: unknown, report: SnapshotReport): Row {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Invalid snapshot issue.');
  const record = raw as Record<string, unknown>, normalized = normalizeGcdIssue(record, report.snapshotAt), issue = normalized.issue;
  issue.dataCredit = 'Bibliographic fields from the Grand Comics Database SQLite snapshot; selected, bounded and formatted by ComicHuddle. Linked-field and story-coverage limitations are retained in the import report.';
  const row: Row = { id: issue.id, gcd_id: issue.gcdId!, title: issue.title, number: issue.number, publisher: issue.publisher,
    year: issue.year, era: issue.era, kind: issue.kind, search_text: catalogSearchText(issue, true), data: JSON.stringify(issue),
    fetched_at: report.snapshotAt, raw_metadata: JSON.stringify({ ...JSON.parse(normalized.rawMetadata),
      metadataScope: 'gcd_snapshot_bibliography', snapshotSha256: report.inputSha256 }), cover: null };
  if (record.cover) {
    const url = gcdThumbnailUrl(record.cover), metadata = record.cover_metadata;
    if (report.coverReferencesIncluded !== true || !url || !metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw Error('Unverified snapshot cover mapping.');
    const m = metadata as Record<string, unknown>, match = url.match(/covers_by_id\/(\d+)\/w400\/(\d+)\.jpg$/);
    if (!match || !Number.isSafeInteger(m.coverId) || Number(m.coverId) < 1 || Number(m.coverId) > 2147483647 ||
        Number(match[2]) !== m.coverId || Number(match[1]) !== Math.floor(Number(m.coverId) / 1000) ||
        m.issueId !== issue.gcdId || m.sourceTable !== 'gcd_cover' || m.artworkBinariesCopied !== false ||
        m.thumbnailWidth !== 400 || m.mimeType !== 'image/jpeg' || typeof m.isWraparound !== 'boolean' ||
        [m.lastUpload, m.modified].some(value => value !== null && (typeof value !== 'string' || value.length > 50))) throw Error('A cover must match its own GCD issue and scan ID.');
    row.cover = { issue_id: issue.id, gcd_id: issue.gcdId!, image_url: url, source_url: issue.source,
      source_page: report.sourceUrl, edition_descriptor: issue.variant,
      attribution: 'Cover reference from Grand Comics Database. Artwork © the respective publisher and artist; shown for edition identification.',
      source_sha256: report.inputSha256, fetched_at: report.snapshotAt,
      image_metadata: { coverId: m.coverId, issueId: m.issueId, isWraparound: m.isWraparound,
        lastUpload: m.lastUpload, modified: m.modified, thumbnailWidth: 400, mimeType: 'image/jpeg', sourceTable: 'gcd_cover' } };
  }
  return row;
}

/** Strict UTF-8, bounded records, mandatory trailing newline, no whole-file load. */
async function* rawLines(file: string, consume?: (chunk: Buffer) => void) {
  const decoder = new TextDecoder('utf-8', { fatal: true }); let pending = '';
  for await (const input of createReadStream(file, { highWaterMark: 64 * 1024 })) {
    const bytes = input as Buffer; consume?.(bytes); pending += decoder.decode(bytes, { stream: true });
    let split: number;
    while ((split = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, split); pending = pending.slice(split + 1);
      if (!line || Buffer.byteLength(line) > 180_000) throw Error('Invalid or oversized snapshot record.');
      yield JSON.parse(line) as unknown;
    }
    if (Buffer.byteLength(pending) > 180_000) throw Error('Oversized snapshot record.');
  }
  pending += decoder.decode(); if (pending) throw Error('The reviewed snapshot must end with a newline.');
}
async function* batches(file: string, report: SnapshotReport, consume?: (chunk: Buffer) => void) {
  let batch: Row[] = [], bytes = 0, last = 0;
  for await (const raw of rawLines(file, consume)) {
    const row = snapshotRow(raw, report);
    if (row.gcd_id <= last) throw Error('Snapshot issues must have unique ascending GCD IDs.');
    last = row.gcd_id; const size = Buffer.byteLength(JSON.stringify(row));
    if (batch.length && (batch.length >= MAX_BATCH || bytes + size > MAX_BYTES)) { yield batch; batch = []; bytes = 0; }
    batch.push(row); bytes += size;
  }
  if (batch.length) yield batch;
}

export async function importGcdSnapshot(pool: Pool, file: string, reportFile: string, options: { now?: number; onProgress?: (value: Record<string, unknown>) => void } = {}) {
  const report = reportValid(JSON.parse(await readFile(reportFile, 'utf8')) as SnapshotReport, options.now || Date.now());
  const originalStat = await stat(file), digest = createHash('sha256'), hashes: string[] = [];
  let expected = 0, covers = 0;
  // Preflight EVERY record and URL before the first PostgreSQL write.
  for await (const batch of batches(file, report, bytes => digest.update(bytes))) {
    expected += batch.length; covers += batch.filter(row => row.cover).length; hashes.push(hash(JSON.stringify(batch)));
  }
  if (digest.digest('hex') !== report.outputSha256 || expected !== report.exportedIssueCount ||
      report.coverReferencesIncluded && covers !== report.coverReferenceCount) throw Error('Snapshot rows or checksum failed reconciliation.');
  const id = hash(JSON.stringify({ version: 'gcd-postgres-snapshot/v1', input: report.inputSha256, output: report.outputSha256,
    snapshotAt: report.snapshotAt, batchSize: MAX_BATCH, batchBytes: MAX_BYTES }));
  const manifestSha = hash(JSON.stringify(report)), client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('comichuddle-gcd-snapshot'))");
    await client.query(`INSERT INTO ch_web.catalog_snapshot_imports (id,manifest,manifest_sha256,snapshot_at,expected_records)
      VALUES ($1,$2::jsonb,$3,$4,$5) ON CONFLICT (id) DO NOTHING`, [id, JSON.stringify(report), manifestSha, report.snapshotAt, expected]);
    const run = await client.query<{ manifest_sha256: string }>('SELECT manifest_sha256 FROM ch_web.catalog_snapshot_imports WHERE id=$1', [id]);
    if (run.rows[0].manifest_sha256 !== manifestSha) throw Error('Snapshot resume manifest differs from its saved receipt.');
    let index = 0;
    for await (const batch of batches(file, report)) {
      const payload = JSON.stringify(batch), payloadSha = hash(payload);
      if (payloadSha !== hashes[index]) throw Error('Snapshot changed after preflight; committed batches remain resumable.');
      await client.query('BEGIN');
      try {
        const receipt = await client.query<{ payload_sha256: string }>('SELECT payload_sha256 FROM ch_web.catalog_snapshot_batches WHERE import_id=$1 AND batch_index=$2', [id, index]);
        if (receipt.rows[0]) {
          if (receipt.rows[0].payload_sha256 !== payloadSha) throw Error('Snapshot replay differs from its committed batch.');
          await confirmIds(client, batch); await client.query('COMMIT'); index++; continue;
        }
        const state = await client.query<{ next_batch: number | string; stage: string }>('SELECT next_batch,stage FROM ch_web.catalog_snapshot_imports WHERE id=$1 FOR UPDATE', [id]);
        if (Number(state.rows[0].next_batch) !== index || state.rows[0].stage !== 'OPEN') throw Error('Snapshot checkpoint changed.');
        const existing = await client.query<{ id: number | string }>('SELECT id FROM ch_web.catalog_issues WHERE id=ANY($1::bigint[])', [batch.map(row => row.id)]);
        const old = new Set(existing.rows.map(row => Number(row.id)));
        const writes = await client.query<{ id: number | string }>(`INSERT INTO ch_web.catalog_issues AS existing
          (id,gcd_id,title,number,publisher,year,era,kind,search_text,data,fetched_at,raw_metadata)
          SELECT id,gcd_id,title,number,publisher,year,era,kind,search_text,data,fetched_at,raw_metadata
          FROM jsonb_to_recordset($1::jsonb) AS incoming(id bigint,gcd_id bigint,title text,number text,publisher text,
            year bigint,era text,kind text,search_text text,data text,fetched_at text,raw_metadata text)
          ON CONFLICT (gcd_id) DO UPDATE SET title=excluded.title,number=excluded.number,publisher=excluded.publisher,
            year=excluded.year,era=excluded.era,kind=excluded.kind,search_text=excluded.search_text,data=excluded.data,
            fetched_at=excluded.fetched_at,raw_metadata=excluded.raw_metadata
          WHERE (coalesce(nullif(existing.raw_metadata,''),'{}')::jsonb->>'metadataScope'='selected_series_issue_indexes') OR
            (coalesce(nullif(existing.raw_metadata,''),'{}')::jsonb->>'metadataScope'='gcd_snapshot_bibliography' AND existing.fetched_at<excluded.fetched_at)
          RETURNING id`, [payload]);
        const inserted = writes.rows.filter(row => !old.has(Number(row.id))).length;
        const enriched = writes.rows.length - inserted, retained = batch.length - writes.rows.length;
        const references = batch.flatMap(row => row.cover ? [row.cover] : []);
        if (references.length) await writeSnapshotCovers(client, references);
        await confirmIds(client, batch);
        await client.query(`INSERT INTO ch_web.catalog_snapshot_batches
          (import_id,batch_index,payload_sha256,record_count,inserted_records,enriched_records,retained_records) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [id, index, payloadSha, batch.length, inserted, enriched, retained]);
        await client.query(`UPDATE ch_web.catalog_snapshot_imports SET accepted_records=accepted_records+$2,
          inserted_records=inserted_records+$3,enriched_records=enriched_records+$4,retained_records=retained_records+$5,next_batch=next_batch+1 WHERE id=$1`,
          [id, batch.length, inserted, enriched, retained]);
        await client.query('COMMIT'); index++;
        options.onProgress?.({ importId: id, committedBatches: index, acceptedThisBatch: batch.length, inserted, enriched, retained });
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
    const after = await stat(file);
    if (after.size !== originalStat.size || after.mtimeMs !== originalStat.mtimeMs) throw Error('Snapshot changed during import; no completion is claimed.');
    await client.query(`UPDATE ch_web.catalog_snapshot_imports SET stage='COMPLETED',completed_at=now()
      WHERE id=$1 AND stage='OPEN' AND accepted_records=expected_records`, [id]);
    const status = await client.query('SELECT id,stage,expected_records,accepted_records,inserted_records,enriched_records,retained_records,next_batch,completed_at FROM ch_web.catalog_snapshot_imports WHERE id=$1', [id]);
    const counts = await client.query(`SELECT count(*) AS indexed_issues,count(gcd_id) AS gcd_issues,
      (SELECT count(*) FROM ch_web.catalog_cover_references WHERE status='active') AS gcd_cover_references FROM ch_web.catalog_issues`);
    return { ...status.rows[0], ...counts.rows[0], coversInSnapshot: covers,
      completeSnapshotIdentityCoverage: report.allActiveIssueIdentitiesExported, fullFieldCoverage: false };
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('comichuddle-gcd-snapshot'))"); client.release();
  }
}

async function confirmIds(client: PoolClient, batch: Row[]) {
  const result = await client.query<{ id: number | string; gcd_id: number | string }>('SELECT id,gcd_id FROM ch_web.catalog_issues WHERE id=ANY($1::bigint[])', [batch.map(row => row.id)]);
  const byId = new Map(result.rows.map(row => [Number(row.id), Number(row.gcd_id)]));
  if (batch.some(row => byId.get(row.id) !== row.gcd_id)) throw Error('Stored snapshot IDs failed reconciliation.');
}
async function writeSnapshotCovers(client: PoolClient, references: NonNullable<Row['cover']>[]) {
  await client.query(`INSERT INTO ch_web.catalog_cover_references AS existing
    (issue_id,gcd_id,image_url,source_url,source_page,edition_descriptor,attribution,source_sha256,fetched_at,image_metadata)
    SELECT issue_id,gcd_id,image_url,source_url,source_page,edition_descriptor,attribution,source_sha256,fetched_at,image_metadata
    FROM jsonb_to_recordset($1::jsonb) AS incoming(issue_id bigint,gcd_id bigint,image_url text,source_url text,source_page text,
      edition_descriptor text,attribution text,source_sha256 text,fetched_at timestamptz,image_metadata jsonb)
    ON CONFLICT (issue_id) DO UPDATE SET image_url=excluded.image_url,source_url=excluded.source_url,
      source_page=excluded.source_page,edition_descriptor=excluded.edition_descriptor,attribution=excluded.attribution,
      source_sha256=excluded.source_sha256,fetched_at=excluded.fetched_at,image_metadata=excluded.image_metadata,imported_at=now()
    WHERE existing.status='active' AND existing.fetched_at<excluded.fetched_at`, [JSON.stringify(references)]);
}
