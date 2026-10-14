import { GCD_ORIGIN, gcdProviderId } from './gcd-catalog';
import { plainCatalogText } from './shared-catalog';

export type IndexReceipt = { url: string; fetchedAt: string; sha256: string; httpStatus: number; bytes: number };
export type IndexEnvelope = { sourcePage: string; fetchedAt: string; record: {
  api_url: string; series: string; series_name: string; publisher_name: string;
  number: string; descriptor: string; variant_name: string; notes: string;
  key_date: ''; variant_of: null; story_set: [];
} };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** GCD's published serializer obtains both arrays from active_issues(), in
 * model ordering (series, sort_code). Never pair separate HTTP responses. */
export function seriesIndexEnvelopes(response: unknown, seriesId: number, publisher: unknown, receipt: IndexReceipt) {
  if (!object(response) || !object(publisher) || typeof publisher.name !== 'string' || receipt.httpStatus !== 200) throw Error('Invalid GCD source response.');
  const candidates = Array.isArray(response.results) ? response.results.filter(object) : [response];
  const selected = candidates.filter(row => row.api_url === `${GCD_ORIGIN}/api/series/${seriesId}/`);
  if (selected.length !== 1) throw Error('The selected GCD series must have one source identity.');
  const series = selected[0];
  if (series.publisher !== publisher.api_url || !Array.isArray(series.active_issues) || !Array.isArray(series.issue_descriptors) ||
      series.active_issues.length !== series.issue_descriptors.length || series.active_issues.length > 100_000 ||
      typeof series.name !== 'string' || !Number.isInteger(series.year_began)) throw Error('GCD series index cannot be reconciled.');
  gcdProviderId(series.api_url, 'series'); gcdProviderId(publisher.api_url, 'publisher');
  const seen = new Set<number>(), records: IndexEnvelope[] = [], excluded: number[] = [];
  for (let position = 0; position < series.active_issues.length; position++) {
    const identity = series.active_issues[position], id = gcdProviderId(identity, 'issue');
    if (seen.has(id)) throw Error('Repeated provider issue identity in a series index.');
    seen.add(id);
    if (typeof series.issue_descriptors[position] !== 'string') throw Error('Missing GCD issue descriptor.');
    const descriptor = plainCatalogText(series.issue_descriptors[position], 2000);
    // The source model prepends volume# when configured, then issue.number,
    // optionally an issue title, variant label and publisher code. Admit only
    // the unambiguous numeric grammar; report all other IDs as excluded.
    const number = descriptor.match(/^(?:(?:\[v[^\]#]+\]|v[^#\s]+)#)?(-?\d+(?:\.\d+)?(?:\/\d+)?[A-Za-z]?)(?=\s|$)/)?.[1];
    if (!number || number.length > 40) { excluded.push(id); continue; }
    const seriesNotes = plainCatalogText(series.notes, 600);
    records.push({ sourcePage: receipt.url, fetchedAt: receipt.fetchedAt, record: {
      api_url: identity as string, series: series.api_url as string,
      series_name: `${plainCatalogText(series.name, 130)} (${series.year_began} series)`,
      publisher_name: plainCatalogText(publisher.name, 160), number, descriptor,
      // A bracket can be part of GCD's raw number or a variant label. Do not
      // infer variant_name/variant_of from it; retain the entire descriptor.
      variant_name: '', key_date: '', variant_of: null, story_set: [],
      notes: 'Sourced GCD issue index. Dates, creator credits and story details are not supplied by this feed.' +
        (seriesNotes ? ' Series context from GCD: ' + seriesNotes : ''),
    } });
  }
  return { records, excluded, series, providerIssueCount: series.active_issues.length };
}
