import { and, eq, inArray, sql } from 'drizzle-orm';
import { catalogCoverReferences } from '../db/schema';
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
    if(!/^\/+(?:covers|img|images)\//.test(url.pathname))return null;
    if(!['http:','https:'].includes(url.protocol))return null;
    url.protocol='https:';return url.href;
  }catch{return null;}
}

let nativeCoverTable:{expires:number;value:Promise<boolean>}|null=null;
async function hasNativeCoverTable(db:CatalogDb){
  if(nativeCoverTable&&nativeCoverTable.expires>Date.now())return nativeCoverTable.value;
  const value=db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_schema='gcd' AND table_name='gcd_cover' AND column_name IN ('id','issue_id')`)
    .then(result=>result.rows.length===2);
  nativeCoverTable={expires:Date.now()+60000,value};
  void value.catch(()=>{if(nativeCoverTable?.value===value)nativeCoverTable=null});
  return value;
}

/** A companion table loaded after deployment becomes readable without another
 * release. Native restriction/deletion flags take precedence over old refs. */
async function withNativeCoverRows(db:CatalogDb,issues:Issue[]):Promise<Issue[]>{
  const identities=issues.filter(issue=>issue.gcdId&&issue.id===4000000000+issue.gcdId);
  if(!identities.length)return issues;
  try{
    if(!await hasNativeCoverTable(db))return issues;
    const permitted=sql`COALESCE(to_jsonb(c)->>'deleted','0') NOT IN ('1','true') AND COALESCE(to_jsonb(c)->>'limit_display','0') NOT IN ('1','true') AND NOT EXISTS(SELECT 1 FROM ch_web.catalog_cover_references withdrawn WHERE withdrawn.issue_id=4000000000::bigint+c.issue_id AND withdrawn.status='withdrawn')`;
    const origin=process.env.GCD_COVER_ORIGIN||'https://files1.comics.org';
    if(!/^https:\/\/files[0-9]+\.comics\.org$/.test(origin))throw new Error('Invalid native cover origin.');
    const rows=await db.execute(sql`SELECT DISTINCT ON(c.issue_id) c.issue_id,(${permitted}) AS permitted,
      COALESCE(NULLIF(to_jsonb(c)->>'image_url',''),NULLIF(to_jsonb(c)->>'cover_url',''),NULLIF(to_jsonb(c)->>'url',''),NULLIF(to_jsonb(c)->>'image_path',''),
       CASE WHEN c.id>0 THEN ${origin}||'/img/gcd/covers_by_id/'||(c.id::bigint/1000)::text||'/w400/'||c.id::text||'.jpg' END) AS image_url
      FROM gcd.gcd_cover c WHERE c.issue_id IN (${sql.join(identities.map(issue=>sql`${issue.gcdId}`),sql`,`)})
      ORDER BY c.issue_id,(${permitted}) DESC,c.id`);
    const byId=new Map(rows.rows.map(row=>[Number(row.issue_id),row]));
    return issues.map(issue=>{
      if(issue.id!==4000000000+Number(issue.gcdId))return issue;
      const row=byId.get(Number(issue.gcdId));if(!row)return issue;
      const cover=row.permitted===true?gcdThumbnailUrl(row.image_url):null;
      return {...issue,cover:cover||undefined,coverSource:cover?'https://www.comics.org/issue/'+issue.gcdId+'/':undefined,
        coverCredit:cover?'Cover image source: Grand Comics Database (GCD) / Publisher':undefined};
    });
  }catch{
    console.warn('Native cover lookup deferred; comic metadata remains available.');
    // A failed cover lookup must not hide the catalog or display a possibly
    // withdrawn retained image while the native authority is unavailable.
    return issues.map(issue=>issue.gcdId?{...issue,cover:undefined,coverSource:undefined,coverCredit:undefined}:issue);
  }
}

export async function withCatalogCovers(db: CatalogDb, issues: Issue[]): Promise<Issue[]> {
  if (!issues.length) return issues;
  // Read the small retained source independently. Native rows are queried by
  // raw issue_id below so its ordinary FK index can serve an exact page;
  // filtering the canonical-ID UNION view would scan the full cover table.
  const rows = await db.select().from(catalogCoverReferences).where(and(
    inArray(catalogCoverReferences.issueId, issues.map(issue => issue.id)),
    eq(catalogCoverReferences.status, 'active')));
  const byId = new Map(rows.map(row => [row.issueId, row]));
  const retained=issues.map(issue => {
    const reference = byId.get(issue.id), url = reference && gcdThumbnailUrl(reference.imageUrl);
    if (!reference || !url || reference.gcdId !== issue.gcdId || issue.id !== 4_000_000_000 + reference.gcdId) return issue;
    return { ...issue, cover: url, coverSource: reference.sourceUrl!, coverCredit: reference.attribution! };
  });
  return withNativeCoverRows(db,retained);
}
