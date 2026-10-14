import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { CatalogDb } from './catalog-store';
import type { Issue } from './catalog';
import { catalogCoverReferences } from '../db/schema';
import { gcdThumbnailUrl } from './catalog-covers';

export function gcdIssueCoverStatements(db: CatalogDb, raw: unknown, issue: Issue, stamp: string) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !issue.gcdId) return [];
  const record = raw as Record<string, unknown>;
  if (!record.cover) return [];
  const url = gcdThumbnailUrl(record.cover);
  if (!url || record.api_url !== `https://www.comics.org/api/issue/${issue.gcdId}/` || issue.id !== 4_000_000_000 + issue.gcdId) throw Error('A cover must match its actual GCD issue.');
  const values = { issueId: issue.id, gcdId: issue.gcdId, imageUrl: url, sourceUrl: issue.source,
    sourcePage: record.api_url as string, editionDescriptor: issue.variant,
    attribution: 'Cover thumbnail reference from Grand Comics Database. Artwork © the respective publisher and artist; shown for edition identification.',
    sourceSha256: createHash('sha256').update(JSON.stringify(record)).digest('hex'), fetchedAt: stamp, importedAt: new Date().toISOString() };
  return [db.insert(catalogCoverReferences).values(values).onConflictDoUpdate({ target: catalogCoverReferences.issueId, set: values,
    setWhere: and(eq(catalogCoverReferences.status, 'active'), sql`${catalogCoverReferences.fetchedAt}<${stamp}::timestamptz`) })];
}
