import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import { gcdThumbnailUrl } from './catalog-covers';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
type Source = { file: string; url: string; seriesId: number; sha256: string; fetchedAt: string; rows: number };
export type CoverReference = { issue_id: number; gcd_id: number; image_url: string; source_url: string;
  source_page: string; edition_descriptor: string; attribution: string; source_sha256: string; fetched_at: string };
type Manifest = { schemaVersion: 'gcd-cover-references/v1'; scope: 'selected_series_base_issue_thumbnails';
  expectedReferences: number; sources: Source[]; artworkBinariesCopied: false; coversLicensedByMetadata: false;
  catalogComplete: false; remainingCheckpoint: unknown };

/** Rebuild every reference from retained exact response bytes before writing. */
export async function readGcdCoverSeed(root: string): Promise<{ manifest: Manifest; references: CoverReference[] }> {
  const manifest = JSON.parse(await readFile(resolve(root, 'db/gcd-cover-references.manifest.json'), 'utf8')) as Manifest;
  if (manifest.schemaVersion !== 'gcd-cover-references/v1' || manifest.scope !== 'selected_series_base_issue_thumbnails' ||
      manifest.artworkBinariesCopied !== false || manifest.coversLicensedByMetadata !== false || manifest.catalogComplete !== false ||
      !Number.isSafeInteger(manifest.expectedReferences) || manifest.expectedReferences < 1 || manifest.expectedReferences > 100_000 ||
      !Array.isArray(manifest.sources) || !manifest.sources.length || manifest.sources.length > 1000) throw Error('Invalid cover-reference manifest.');
  const references: CoverReference[] = [], seen = new Set<number>();
  for (const source of manifest.sources) {
    if (!/^series-\d+-overview-\d+\.json$/.test(source.file) || !/^[a-f0-9]{64}$/.test(source.sha256) ||
        !Number.isSafeInteger(source.seriesId) || source.seriesId < 1 || !Number.isFinite(Date.parse(source.fetchedAt))) throw Error('Invalid cover source witness.');
    const base = `https://www.comics.org/api/series/${source.seriesId}/overview/`;
    if (source.url !== base && !new RegExp('^' + base.replaceAll('.', '\\.') + '\\?page=[1-9][0-9]*$').test(source.url)) throw Error('Unexpected cover source URL.');
    const bytes = await readFile(resolve(root, 'db/gcd-cover-sources', source.file));
    if (bytes.length > 6_000_000 || sha256(bytes) !== source.sha256) throw Error('Cover response failed its checksum.');
    const response = JSON.parse(bytes.toString('utf8')) as { results: { issue_id: number; cover_url: unknown; descriptor: unknown }[] };
    if (!Array.isArray(response.results) || response.results.length !== source.rows || source.rows > 50) throw Error('Invalid cover response rows.');
    for (const row of response.results) {
      if (!Number.isSafeInteger(row.issue_id) || row.issue_id < 1 || row.issue_id > 2147483647 || seen.has(row.issue_id)) throw Error('Invalid or repeated cover issue identity.');
      seen.add(row.issue_id);
      if (!row.cover_url) continue;
      const url = gcdThumbnailUrl(row.cover_url);
      if (!url || typeof row.descriptor !== 'string' || row.descriptor.length > 2000) throw Error('Invalid exact cover reference.');
      references.push({ issue_id: 4_000_000_000 + row.issue_id, gcd_id: row.issue_id, image_url: url,
        source_url: `https://www.comics.org/issue/${row.issue_id}/`, source_page: source.url,
        edition_descriptor: row.descriptor, attribution: 'Cover thumbnail reference from Grand Comics Database. Artwork © the respective publisher and artist; shown for edition identification.',
        source_sha256: source.sha256, fetched_at: new Date(source.fetchedAt).toISOString() });
    }
  }
  if (references.length !== manifest.expectedReferences) throw Error('Cover-reference count failed reconciliation.');
  return { manifest, references };
}

export async function importGcdCoverSeed(pool: Pool, root: string) {
  const { manifest, references } = await readGcdCoverSeed(root), client = await pool.connect();
  let changed = 0, matched = 0, excluded = 0;
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('comichuddle-cover-references'))");
    // Each batch is atomic. Replay retains takedowns and newer provider refs.
    for (let offset = 0; offset < references.length; offset += 100) {
      const batch = references.slice(offset, offset + 100);
      await client.query('BEGIN');
      try {
        const known = await client.query<{ id: string | number; gcd_id: string | number }>(
          'SELECT id,gcd_id FROM ch_web.catalog_issues WHERE id=ANY($1::bigint[])', [batch.map(row => row.issue_id)]);
        const identities = new Map(known.rows.map(row => [Number(row.id), Number(row.gcd_id)]));
        const selected = batch.filter(row => identities.get(row.issue_id) === row.gcd_id);
        matched += selected.length; excluded += batch.length - selected.length;
        if (selected.length) {
          const result = await client.query(`INSERT INTO ch_web.catalog_cover_references AS existing
            (issue_id,gcd_id,image_url,source_url,source_page,edition_descriptor,attribution,source_sha256,fetched_at)
            SELECT issue_id,gcd_id,image_url,source_url,source_page,edition_descriptor,attribution,source_sha256,fetched_at
            FROM jsonb_to_recordset($1::jsonb) AS incoming(issue_id bigint,gcd_id bigint,image_url text,source_url text,
              source_page text,edition_descriptor text,attribution text,source_sha256 text,fetched_at timestamptz)
            ON CONFLICT (issue_id) DO UPDATE SET image_url=excluded.image_url,source_url=excluded.source_url,
              source_page=excluded.source_page,edition_descriptor=excluded.edition_descriptor,attribution=excluded.attribution,
              source_sha256=excluded.source_sha256,fetched_at=excluded.fetched_at,imported_at=now()
            WHERE existing.status='active' AND existing.fetched_at<=excluded.fetched_at AND
              (existing.image_url IS DISTINCT FROM excluded.image_url OR existing.source_sha256 IS DISTINCT FROM excluded.source_sha256)
            RETURNING issue_id`, [JSON.stringify(selected)]);
          changed += result.rowCount || 0;
        }
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
    const result = await client.query<{ references: string | number; issues: string | number; withdrawn: string | number }>(
      `SELECT (SELECT count(*) FROM ch_web.catalog_cover_references WHERE status='active') AS references,
       (SELECT count(*) FROM ch_web.catalog_issues) AS issues,
       (SELECT count(*) FROM ch_web.catalog_cover_references WHERE status='withdrawn') AS withdrawn`);
    return { capturedReferences: references.length, matchedReferences: matched, excludedNotInDirectory: excluded,
      changedReferences: changed, activeGcdCoverReferences: Number(result.rows[0].references),
      indexedIssues: Number(result.rows[0].issues), withdrawnReferences: Number(result.rows[0].withdrawn),
      artworkBinariesCopied: false, catalogComplete: false, remainingCheckpoint: manifest.remainingCheckpoint };
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('comichuddle-cover-references'))");
    client.release();
  }
}
