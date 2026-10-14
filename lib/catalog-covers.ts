import { and, eq, inArray } from 'drizzle-orm';
import { directoryCoverReferences } from '../db/schema';
import type { CatalogDb } from './catalog-store';
import type { Issue } from './catalog';

/** Only URLs supplied for an exact GCD issue, never guessed cover IDs. */
export function gcdThumbnailUrl(value: unknown): string | null {
  if(typeof value!=='string'||value.length>1024||/[\u0000-\u0020\u007f\\]/.test(value))return null;
  try{
    const url=new URL(value.startsWith('//')?'https:'+value:value,'https://www.comics.org');
    if(url.username||url.password||url.port)return null;
    const host=url.hostname;
    if(!(host==='www.comics.org'||/^files[0-9]+\.comics\.org$/.test(host)))return null;
    if(!/^\/(?:covers|img|images)\//.test(url.pathname))return null;
    if(!['http:','https:'].includes(url.protocol))return null;
    url.protocol='https:';return url.href;
  }catch{return null;}
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
