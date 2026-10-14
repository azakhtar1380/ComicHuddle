import { and, eq, inArray } from 'drizzle-orm';
import { directoryCoverReferences } from '../db/schema';
import type { CatalogDb } from './catalog-store';
import type { Issue } from './catalog';

/** Only URLs supplied for an exact GCD issue, never guessed cover IDs. */
export function gcdThumbnailUrl(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 400 &&
    /^https:\/\/files[0-9]+\.comics\.org\/+img\/gcd\/covers_by_id\/[0-9]+\/w400\/[0-9]+\.jpg$/.test(value) ? value : null;
}

export async function withCatalogCovers(db: CatalogDb, issues: Issue[]): Promise<Issue[]> {
  if (!issues.length) return issues;
  const rows = await db.select().from(directoryCoverReferences).where(and(
    inArray(directoryCoverReferences.issueId, issues.map(issue => issue.id)),
    eq(directoryCoverReferences.status, 'active')));
  const byId = new Map(rows.map(row => [row.issueId, row]));
  return issues.map(issue => {
    const reference = byId.get(issue.id), url = reference && gcdThumbnailUrl(reference.imageUrl);
    if (!reference || !url || reference.gcdId !== issue.gcdId || issue.id !== 4_000_000_000 + reference.gcdId) return issue;
    return { ...issue, cover: url, coverSource: reference.sourceUrl!, coverCredit: reference.attribution! };
  });
}
