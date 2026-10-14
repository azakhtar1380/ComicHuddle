import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { z } from 'zod';
// This Node job runs weekly on Render. It does not re-enable prior catalog jobs.
// GCD dumps and distributor/Marvel feeds must be normalized through authorized
// adapters into this versioned feed shape; no fictional public API is assumed.
const release = z.object({ id: z.string().max(150), title: z.string().max(250), number: z.string().max(50), publisher: z.string().max(200), releaseDate: z.string().nullable(), upcoming: z.boolean(), variant: z.string().max(250).default('Unknown edition'), coverCandidates: z.array(z.object({ url: z.string().url(), tier: z.enum(['licensed_provider', 'authorized_publisher', 'consented_owner']), rightsReference: z.string().max(500) })).max(6) });
const feed = z.object({ version: z.literal('comichuddle.releases.v1'), releases: z.array(release).max(1000) });
const env = process.env;
async function trustedJson(url, origins, token) { const target = new URL(url); if (target.protocol !== 'https:' || !origins.includes(target.origin) || target.username || target.password)
    throw Error('Unapproved source origin'); const r = await fetch(url, { headers: token ? { Authorization: 'Bearer ' + token } : undefined, redirect: 'error', signal: AbortSignal.timeout(20000) }); if (!r.ok)
    throw Error(r.status === 429 ? 'Source quota wait; checkpoint retained' : 'Source request failed'); const raw = await r.text(); if (raw.length > 4000000)
    throw Error('Feed exceeds limit'); return JSON.parse(raw); }
export async function chooseCover(candidates, approved, allowedOrigins, download, upload) {
    const order = ['licensed_provider', 'authorized_publisher', 'consented_owner'];
    for (const candidate of [...candidates].sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier))) {
        if (!approved.has(candidate.rightsReference))
            continue;
        const url = new URL(candidate.url);
        if (url.protocol !== 'https:' || !allowedOrigins.includes(url.origin) || url.username || url.password)
            continue;
        try {
            const bytes = await download(url.href);
            if (bytes.length > 10000000 || bytes.length < 16)
                continue;
            const type = bytes[0] === 255 && bytes[1] === 216 ? 'image/jpeg' : bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 ? 'image/png' : null;
            if (!type)
                continue;
            return { url: await upload(bytes, type), rightsReference: candidate.rightsReference, tier: candidate.tier };
        }
        catch {
            continue;
        }
    }
    return { url: null, rightsReference: null, tier: 'metadata_placeholder' };
}
export async function run({ maxRecords = 1000, timeBudgetMs = 300000 } = {}) {
    const started = Date.now();
    const { database } = await import('../server/database.mjs');
    const pool = await database();
    const db = await pool.connect();
    try {
        const locked = (await db.query("SELECT pg_try_advisory_lock(hashtextextended('comichuddle-weekly-releases',0)) AS locked")).rows[0].locked;
        if (!locked)
            return;
        if (!env.SOURCE_METADATA_RIGHTS_REFERENCE)
            throw Error('Metadata rights configuration is missing. Catalog unchanged.');
        const origins = (env.SOURCE_ALLOWED_ORIGINS || '').split(',').filter(Boolean), imageOrigins = (env.IMAGE_ALLOWED_ORIGINS || '').split(',').filter(Boolean), rights = new Set(JSON.parse(env.COVER_RIGHTS_MANIFEST_JSON || '[]'));
        const sources = [];
        for (const [source, url] of [['gcd', env.GCD_RELEASE_FEED_URL], ['marvel', env.MARVEL_RELEASE_FEED_URL]])
            if (url)
                sources.push({ source: source, releases: feed.parse(await trustedJson(url, origins)).releases });
        if (env.METRON_API_TOKEN) {
            const date = new Date().toISOString().slice(0, 10), to = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
            const url = new URL('https://metron.cloud/api/issue/');
            url.search = new URLSearchParams({ store_date_range_after: date, store_date_range_before: to }).toString();
            const page = await trustedJson(url.href, ['https://metron.cloud'], env.METRON_API_TOKEN);
            if (!Array.isArray(page.results))
                throw Error('Invalid Metron list response');
            const releases = [];
            // One page per run; save its next cursor. Detail expansion and subsequent
            // pages require the approved quota-aware adapter, not an unbounded backfill.
            for (const row of page.results.slice(0, 100)) {
                if (!Number.isInteger(row.id))
                    continue;
                releases.push(release.parse({ id: String(row.id), title: row.series?.name || row.name || 'Unspecified series', number: String(row.number || '?'), publisher: row.publisher?.name || 'Unspecified publisher', releaseDate: row.store_date || null, upcoming: !!row.store_date && row.store_date > date, variant: 'Edition not confirmed', coverCandidates: [] }));
            }
            sources.push({ source: 'metron', releases });
            await db.query("INSERT INTO ch_demo.releases(source,source_id,metadata) VALUES('checkpoint','metron-next',$1::jsonb) ON CONFLICT(source,source_id) DO UPDATE SET metadata=EXCLUDED.metadata", [JSON.stringify({ next: page.next || null, lastSweep: date })]);
        }
        if (!sources.length)
            throw Error('No authorized release feed or Metron token configured.');
        const storage = env.S3_BUCKET ? new S3Client({ region: env.AWS_REGION || 'us-east-2', ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}) }) : null;
        const download = async (url) => { const r = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) }); if (!r.ok || !r.body)
            throw Error('Cover unavailable'); const reader = r.body.getReader(), parts = []; let total = 0; while (true) {
            const c = await reader.read();
            if (c.done)
                break;
            total += c.value.length;
            if (total > 10000000) {
                await reader.cancel();
                throw Error('Cover too large');
            }
            parts.push(c.value);
        } return new Uint8Array(Buffer.concat(parts)); };
        const upload = async (bytes, type) => { if (!storage || !env.COVER_CDN_ORIGIN)
            throw Error('Object storage/CDN missing'); const key = 'covers/' + createHash('sha256').update(bytes).digest('hex') + (type === 'image/jpeg' ? '.jpg' : '.png'); await storage.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: bytes, ContentType: type })); return new URL(key, env.COVER_CDN_ORIGIN.endsWith('/') ? env.COVER_CDN_ORIGIN : env.COVER_CDN_ORIGIN + '/').href; };
        let count = 0;
        let checkpoint = null;
        work: for (const source of sources)
            for (const [index, item] of source.releases.entries()) {
                if (count >= maxRecords || Date.now() - started >= timeBudgetMs) {
                    checkpoint = { source: source.source, nextIndex: index };
                    break work;
                }
                const image = await chooseCover(item.coverCandidates, rights, imageOrigins, download, upload);
                await db.query('INSERT INTO ch_demo.releases(source,source_id,metadata) VALUES($1,$2,$3::jsonb) ON CONFLICT(source,source_id) DO UPDATE SET metadata=EXCLUDED.metadata,updated_at=now()', [source.source, item.id, JSON.stringify({ ...item, image, metadataRights: env.SOURCE_METADATA_RIGHTS_REFERENCE })]);
                count++;
            }
        if (checkpoint)
            await db.query("INSERT INTO ch_demo.releases(source,source_id,metadata) VALUES('checkpoint','vercel-budget',$1::jsonb) ON CONFLICT(source,source_id) DO UPDATE SET metadata=EXCLUDED.metadata,updated_at=now()", [JSON.stringify(checkpoint)]);
        const result = { updated: count, sourceNames: sources.map(s => s.source), covers: 'approved-rights-only', checkpoint };
        console.log(JSON.stringify(result));
        return result;
    }
    finally {
        await db.query("SELECT pg_advisory_unlock(hashtextextended('comichuddle-weekly-releases',0))").catch(() => { });
        db.release();
        await pool.end();
    }
}
if (import.meta.url === new URL('file://' + process.argv[1]).href)
    run().catch(e => { console.error('Release sync stopped:', e.message); process.exitCode = 1; });
