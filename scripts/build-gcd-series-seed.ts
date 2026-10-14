import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { seriesIndexEnvelopes, type IndexReceipt } from '../lib/gcd-series-index';
import { GCD_LICENSE, gcdProviderId } from '../lib/gcd-catalog';
import type { GcdSeedManifest } from '../lib/gcd-postgres-seed';

// Capture these responses from the official API, retaining the response
// bytes and HTTP receipts. This converter performs zero upstream requests.
const inputs = [
  { stem: 'series-1570', id: 1570 },
  { stem: 'batman-1940-search', id: 141, name: 'Batman', year: 1940 },
  { stem: 'spawn-1992-search', id: 4611, name: 'Spawn', year: 1992 },
  { stem: 'xmen-1991-search', id: 4254, name: 'X-Men', year: 1991 },
  { stem: 'detective-1937-search', id: 87, name: 'Detective Comics', year: 1937 },
  { stem: 'fantastic-four-1961-search', id: 1482, name: 'Fantastic Four', year: 1961 },
  { stem: 'avengers-1963-search', id: 1571, name: 'Avengers', year: 1963 },
  { stem: 'hellboy-seed-1994-search', id: 5109, name: 'Hellboy: Seed of Destruction', year: 1994 },
  // Further explicitly selected source IDs can be added after inspecting
  // their official responses; a guessed provider ID is never admitted.
];
const cache = process.argv[2]; if (!cache) throw Error('Provide the directory containing captured official GCD responses and receipts.');
const destination = resolve('db/gcd-series-sources'); await mkdir(destination, { recursive: true });
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const sources: GcdSeedManifest['sources'] = [], series: unknown[] = [], records: ReturnType<typeof seriesIndexEnvelopes>['records'] = [];
const identities = new Set<number>();
for (const input of inputs) {
  const raw = await readFile(resolve(cache, input.stem + '.json'));
  const receipt = JSON.parse(await readFile(resolve(cache, input.stem + '.receipt.json'), 'utf8')) as IndexReceipt;
  if (receipt.bytes !== raw.length || digest(raw) !== receipt.sha256 || receipt.httpStatus !== 200) throw Error('A GCD capture failed its HTTP receipt/checksum.');
  const response = JSON.parse(raw.toString('utf8')) as { results?: { api_url: string; publisher: string }[]; api_url?: string; publisher?: string };
  const selected = response.results?.find(row => row.api_url === `https://www.comics.org/api/series/${input.id}/`) || response;
  const publisherId = gcdProviderId(selected.publisher, 'publisher');
  const publisherBytes = await readFile(resolve(cache, `publisher-${publisherId}.json`));
  const publisherReceipt = JSON.parse(await readFile(resolve(cache, `publisher-${publisherId}.receipt.json`), 'utf8')) as IndexReceipt;
  if (publisherReceipt.bytes !== publisherBytes.length || digest(publisherBytes) !== publisherReceipt.sha256 || publisherReceipt.httpStatus !== 200) throw Error('Publisher capture failed its checksum.');
  const result = seriesIndexEnvelopes(response, input.id, JSON.parse(publisherBytes.toString('utf8')), receipt);
  for (const entry of result.records) {
    const id = gcdProviderId(entry.record.api_url, 'issue');
    if (identities.has(id)) throw Error('Duplicate GCD issue ID across the selected sources.');
    identities.add(id); records.push(entry);
  }
  await writeFile(resolve(destination, input.stem + '.json'), raw);
  await writeFile(resolve(destination, `publisher-${publisherId}.json`), publisherBytes);
  sources.push({ url: receipt.url, seriesId: input.id, page: 1, rows: result.records.length,
    fetchedAt: receipt.fetchedAt, responseSha256: receipt.sha256,
    ...(input.name ? { queryName: input.name, queryYear: input.year } : {}),
    responseFile: `gcd-series-sources/${input.stem}.json`, publisherFile: `gcd-series-sources/publisher-${publisherId}.json`,
    publisherSha256: digest(publisherBytes) });
  series.push({ gcdSeriesId: input.id, title: result.series.name, publisher: result.records[0]?.record.publisher_name,
    providerIssueCount: result.providerIssueCount, acceptedIssueCount: result.records.length,
    excludedAmbiguousIds: result.excluded, metadataLevel: 'SERIES_ISSUE_INDEX',
    fullIssueDetails: false });
}
records.sort((a, b) => gcdProviderId(a.record.api_url, 'issue') - gcdProviderId(b.record.api_url, 'issue'));
const lines = records.map(record => JSON.stringify(record)).join('\n') + '\n';
const manifest = { schemaVersion: 'gcd-rds-series-index/v1', provider: 'GCD', scope: 'selected_series_issue_indexes',
  catalogComplete: false, license: GCD_LICENSE, expectedRecords: records.length, datasetSha256: digest(lines),
  sources, series, artworkImported: false, valuationImported: false, syntheticRecords: 0,
  attribution: 'Grand Comics Database. Actual issue IDs and descriptors selected/formatted by ComicHuddle under CC BY-SA 4.0.',
  serializerSource: 'https://github.com/GrandComicsDatabase/gcd-django/blob/beta/apps/api/serializers.py',
  fieldCoverage: 'Series, publisher, issue identity and edition descriptor only. Individual publication dates, credits, story descriptions, artwork and valuations are not inferred.' };
await writeFile(resolve('db/gcd-series-index-seed.jsonl'), lines);
await writeFile(resolve('db/gcd-series-index-seed.manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ sourcedRecords: records.length, syntheticRecords: 0, catalogComplete: false, series }, null, 2));
