import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { sql, eq } from 'drizzle-orm';
import { getMigrations } from 'better-auth/db/migration';
import { betterAuth } from 'better-auth';
import { getDb } from '../db';
import { authOptions } from '../lib/auth';
import { seedStarterStatements, searchSharedCatalog, catalogOverview } from '../lib/catalog-store';
import { conditionalGuard, operationGuardFailed } from '../lib/operation-guard';
import { enforceWriteLimits } from '../lib/api-security';
import { createListing, placeBid, retractBid } from '../lib/marketplace';
import { collections, profiles, media, groups, auctionBids } from '../db/schema';
import { emptyVault } from '../lib/vault';
import { previewRulesVersion } from '../lib/community';
import { GET as catalogGET } from '../app/api/catalog/route';
import { parseCatalogSearchPage } from '../lib/catalog-picker-client';

let engine: PGlite;
const pool = new Pool();
before(async () => {
  engine = new PGlite();
  await engine.exec('CREATE SCHEMA ch_web; BEGIN;');
  for (const name of ['001_original_comichuddle.sql', '002_runtime.sql', '004_catalog_cover_references.sql','006_marketplace_wallet_safepurchase.sql','007_us_postal_centroids.sql','008_safepurchase_retention.sql']) await engine.exec(readFileSync('db/postgres-migrations/' + name, 'utf8'));
  await engine.exec('COMMIT; SET search_path TO ch_web,public;');
  const query = async (config: string | { text: string; rowMode?: string }, values: unknown[] = []) => {
    const result = await engine.query<Record<string, unknown>>(typeof config === 'string' ? config : config.text, values);
    return { ...result, rowCount: result.affectedRows, command: '', rows: typeof config !== 'string' && config.rowMode === 'array' ? result.rows.map(row => result.fields.map(field => row[field.name])) : result.rows };
  };
  Object.assign(pool, { query, connect: async () => ({ query, release() {} }) });
  (globalThis as typeof globalThis & { comicHuddlePool: Pool }).comicHuddlePool = pool;
  process.env.BETTER_AUTH_SECRET = crypto.randomUUID() + crypto.randomUUID();
  process.env.BETTER_AUTH_URL = 'https://comichuddle.test';
  await (await getMigrations(authOptions(pool))).runMigrations();
  const db = getDb(); await db.batch(seedStarterStatements(db, new Date().toISOString()));
});
after(async () => { await engine.close(); delete (globalThis as typeof globalThis & { comicHuddlePool?: Pool }).comicHuddlePool; });

test('original schema and central directory survive native PostgreSQL queries', async () => {
  const db = getDb(), overview = await catalogOverview(db);
  assert.ok(overview.issueCount > 40);
  const result = await searchSharedCatalog(db, { q: 'Amazing Spider-Man', limit: 12, offset: 0 });
  assert.ok(result.total > 1); assert.ok(result.issues.some(issue => issue.title === 'Amazing Spider-Man'));
});
test('the actual catalog ID endpoint returns parser-compatible pages and real starter cover identities',async()=>{
 const response=await catalogGET(new Request('https://comichuddle.test/api/catalog?ids=24,25,26,27,28,29,0,3,7,10'));
 assert.equal(response.status,200);const page=parseCatalogSearchPage(await response.json());
 assert.equal(page.total,10);assert.equal(page.limit,10);assert.equal(page.offset,0);assert.equal(page.hasMore,false);
 assert.deepEqual(page.issues.slice(0,6).map(issue=>issue.number),['12','21','27','42','53','55']);
 assert.ok(page.issues.slice(0,6).every(issue=>issue.cover?.startsWith('/covers/')));
 const empty=await catalogGET(new Request('https://comichuddle.test/api/catalog?ids=999999'));
 assert.equal(parseCatalogSearchPage(await empty.json()).total,0);
});
test('guarded multi-statement writes roll back every statement on failed validation', async () => {
  const db = getDb(), guard = conditionalGuard(db, sql`false`);
  await assert.rejects(db.batch([db.insert(groups).values({ id: 'rolled-back', ownerId: null, name: 'QA', description: 'Rollback', color: 'red', createdAt: new Date().toISOString() }), guard.start, guard.finish]), operationGuardFailed);
  assert.equal((await db.select().from(groups).where(eq(groups.id, 'rolled-back'))).length, 0);
});
test('persistent write budgets handle millisecond timestamps and enforce limits', async () => {
  const db = getDb(); assert.equal(await enforceWriteLimits(db, 'qa-budget', 'action', 2), null);
  assert.equal(await enforceWriteLimits(db, 'qa-budget', 'action', 2), null);
  const rejected = await enforceWriteLimits(db, 'qa-budget', 'action', 2);
  assert.equal(rejected?.status, 429); assert.ok(Number(rejected?.headers.get('retry-after')) > 0);
});
test('real account creation and cookie verification work without trusting identity headers', async () => {
  const auth = betterAuth(authOptions(pool));
  const request = new Request('https://comichuddle.test/api/auth/sign-up/email', { method: 'POST', headers: { Origin: 'https://comichuddle.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'QA Collector', email: 'migration-qa@example.invalid', password: crypto.randomUUID() }) });
  const response = await auth.handler(request); assert.equal(response.status, 200);
  const data = await response.json() as { user: { id: string } };
  const cookie = response.headers.get('set-cookie'); assert.ok(cookie);
  const session = await auth.api.getSession({ headers: new Headers({ Cookie: cookie! }) });
  assert.equal(session?.user.id, data.user.id);
  const spoof = await auth.api.getSession({ headers: new Headers({ 'oai-authenticated-user-id': data.user.id, 'oai-authenticated-user-email': 'migration-qa@example.invalid' }) });
  assert.equal(spoof, null);
  const migration = await getMigrations(authOptions(pool)); assert.equal(migration.toBeCreated.length, 0); assert.equal(migration.toBeAdded.length, 0);
});
test('listing an owned comic reserves its copy and blocks duplicate listings', async () => {
  const db = getDb(), stamp = new Date().toISOString();
  const userId = crypto.randomUUID(), profileId = crypto.randomUUID(), photoId = crypto.randomUUID();
  const [profile] = await db.insert(profiles).values({ id: profileId, userId, handle: 'pg_seller', name: 'PG Seller', bio: '', tagline: '', location: 'Minnesota', favorite: '', since: 2026, color: 'red', featured: '[]', visible: 1, dmOpen: 1, createdAt: stamp, rulesVersion: previewRulesVersion, rulesAcceptedAt: stamp }).returning();
  const vault = { ...emptyVault('PG Seller'), books: [{ id: 'owned-1', title: 'Amazing Spider-Man', issue: '#300', grade: 'Raw 9.0', price: 200, catalogId: 0 }] };
  await db.insert(collections).values({ userId, data: JSON.stringify(vault), revision: 'pg-revision' });
  await db.insert(media).values({ id: photoId, userId, contentType: 'image/jpeg', createdAt: stamp });
  const input = { action: 'listing', kind: 'single', saleType: 'fixed', bookIds: ['owned-1'], description: 'Actual owned comic with photographed defects.', price: 60000, shipping: 1500, photos: [photoId], attest: true, usaAttest: true };
  const result = await createListing(db, profile, input); assert.ok(result.listingId);
  await assert.rejects(createListing(db, profile, input), error => (error as { status?: number }).status === 409);
});
test('auction bids enforce seller restrictions, idempotency and retraction', async () => {
  const db = getDb(), stamp = new Date().toISOString();
  const [seller] = await db.select().from(profiles).where(eq(profiles.handle, 'pg_seller'));
  const photoId = (await db.select().from(media).where(eq(media.userId, seller.userId)))[0].id;
  const [stored] = await db.select().from(collections).where(eq(collections.userId, seller.userId));
  const vault = JSON.parse(stored.data); vault.books.push({ ...vault.books[0], id: 'auction-copy' });
  await db.update(collections).set({ data: JSON.stringify(vault), revision: 'auction-revision' }).where(eq(collections.userId, seller.userId));
  const auction = await createListing(db, seller, { action: 'listing', kind: 'single', saleType: 'auction', bookIds: ['auction-copy'], description: 'QA isolated auction fixture.', price: 30000, shipping: 1500, photos: [photoId], attest: true, usaAttest: true });
  const [buyer] = await db.insert(profiles).values({ ...seller, id: crypto.randomUUID(), userId: crypto.randomUUID(), handle: 'pg_bidder', name: 'PG Bidder', createdAt: stamp }).returning();
  const bid = { listingId: auction.listingId, amount: 30000, requestId: crypto.randomUUID(), nonbindingConsent: true };
  await assert.rejects(placeBid(db, seller, bid), error => (error as { status?: number }).status === 403);
  await placeBid(db, buyer, bid); const duplicate = await placeBid(db, buyer, bid); assert.equal(duplicate.duplicate, true);
  const [row] = await db.select().from(auctionBids).where(eq(auctionBids.requestId, bid.requestId));
  await retractBid(db, buyer, { listingId: auction.listingId, bidId: row.id, nonbindingConsent: true });
  assert.equal((await db.select().from(auctionBids).where(eq(auctionBids.id, row.id)))[0].status, 'retracted');
});
