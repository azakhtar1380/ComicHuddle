// Run: node --experimental-vm-modules checks/sketch-launch.mjs
// Isolated actual route/SQLite and actual helper/handler integrations.
// No hosted browser, trusted identity provider, camera device or real payments.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
import {createScannerFixture} from './scanner-hooks.mjs';
import {decodeCover} from './scan-pixels.mjs';

const root = process.cwd(), sqlite = new DatabaseSync(':memory:');
for (const file of (await readdir('drizzle')).filter(value => value.endsWith('.sql')).sort()) sqlite.exec(await readFile(path.join('drizzle', file), 'utf8'));
sqlite.exec('PRAGMA foreign_keys=ON');
let maxBinds = 0, activeUser = null, outbound = 0, beforeBatch = null, beforeStatement = null;
class Statement {
  constructor(sql, params = []) {this.sql = sql; this.params = params;}
  bind(...params) {maxBinds = Math.max(maxBinds, params.length); assert.ok(params.length <= 100); return new Statement(this.sql, params);}
  allSync() {beforeStatement?.(this); return {success: true, results: sqlite.prepare(this.sql).all(...this.params), meta: {}};}
  async all() {return this.allSync();}
  async raw() {const statement = sqlite.prepare(this.sql); statement.setReturnArrays(true); return statement.all(...this.params);}
  async run() {const result = sqlite.prepare(this.sql).run(...this.params); return {success: true, results: [], meta: {changes: result.changes, last_row_id: Number(result.lastInsertRowid)}};}
}
const db = {prepare: sql => new Statement(sql), async batch(statements) {beforeBatch?.(statements); sqlite.exec('BEGIN'); try {const results = statements.map(value => value.allSync()); sqlite.exec('COMMIT'); return results;} catch (error) {sqlite.exec('ROLLBACK'); throw error;}}};
const objects = new Map(), bucket = {async get(id) {return objects.has(id) ? {body: objects.get(id)} : null;}, async put(id, data) {objects.set(id, new Uint8Array(data));}, async delete(ids) {for (const id of typeof ids === 'string' ? [ids] : ids) objects.delete(id);}};
const env = {DB: db, BUCKET: bucket}, context = vm.createContext({console, crypto: webcrypto, Request, Response, Headers, URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, Error, Date, AbortController, ReadableStream, setTimeout, clearTimeout, setInterval, clearInterval, fetch: async () => {outbound++; throw Error('External requests forbidden in sketch QA');}}), cache = new Map();
function synthetic(id, exports) {return new vm.SyntheticModule(Object.keys(exports), function () {for (const [key, value] of Object.entries(exports)) this.setExport(key, value);}, {context, identifier: id});}
async function moduleFor(specifier, parent = '') {
  if (specifier === 'cloudflare:workers') {if (!cache.has(specifier)) cache.set(specifier, synthetic(specifier, {env})); return cache.get(specifier);}
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) {if (!cache.has(specifier)) cache.set(specifier, synthetic(specifier, await import(specifier))); return cache.get(specifier);}
  let file = path.resolve(parent ? path.dirname(parent) : root, specifier);
  if (!path.extname(file)) {try {await readFile(file + '.ts'); file += '.ts';} catch {try {await readFile(file + '.tsx'); file += '.tsx';} catch {file = path.join(file, 'index.ts');}}}
  if (cache.has(file)) return cache.get(file);
  if (file.endsWith('.css')) {const value = synthetic(file, {}); cache.set(file, value); return value;}
  if (file.endsWith('/app/chatgpt-auth.ts')) {const value = synthetic(file, {getChatGPTUser: async () => activeUser}); cache.set(file, value); return value;}
  const code = ts.transpileModule(await readFile(file, 'utf8'), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  const value = new vm.SourceTextModule(code, {context, identifier: file}); cache.set(file, value); return value;
}
async function load(file) {const value = await moduleFor(path.join(root, file)); if (value.status === 'unlinked') await value.link((specifier, parent) => moduleFor(specifier, parent.identifier)); if (value.status === 'linked') await value.evaluate(); return value.namespace;}
const social = await load('app/api/social/route.ts'), vault = await load('app/api/vault/route.ts'), catalogApi = await load('app/api/catalog/route.ts');
const care = await load('app/api/pressing/route.ts'), commerce = await load('app/api/commerce/route.ts'), media = await load('app/api/media/route.ts');
const navigation = await load('lib/section-navigation.ts'), account = await load('lib/account-intent.ts'), pressing = await load('lib/pressing.ts');
const catalog = (await load('lib/catalog.ts')).catalog, shared = await load('lib/shared-catalog.ts'), catalogStore = await load('lib/catalog-store.ts'), database = (await load('db/index.ts')).getDb();
const rules = (await load('lib/community.ts')).previewRulesVersion;
const catalogSearch = await load('lib/catalog-search.ts');
const catalogPickerClient = await load('lib/catalog-picker-client.ts');
const marketplaceText = await readFile('app/marketplace.tsx', 'utf8'), marketplaceAst = ts.createSourceFile('app/marketplace.tsx', marketplaceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const matcher = marketplaceAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'matchesMarketplaceListing'); assert.ok(matcher, 'Missing actual marketplace identity filter');
const matcherContext = vm.createContext({linkedCatalogIssue: catalogSearch.linkedCatalogIssue, metronDirectoryId: shared.metronDirectoryId, listingDirectoryId: shared.listingDirectoryId});
vm.runInContext(ts.transpileModule(matcher.getText(marketplaceAst), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText, matcherContext);
const owner = {userId: 'd185d22d-62d4-475e-87ac-fa2039a5d360', email: 'owner@example.test', displayName: 'Owner'};
const alice = {userId: 'sketch_alice', email: 'alice@example.test', displayName: 'Alice collector'}, bob = {userId: 'sketch_bob', email: 'bob@example.test', displayName: 'Bob collector'}, outsider = {userId: 'sketch_outsider', email: 'outsider@example.test', displayName: 'Other collector'};
const empty = {profile: 'Alice collector', books: [], wants: [], posts: [], likes: [], tradeBookIds: [], clubs: [], watchlist: [], tradeDrafts: []};
const plain = value => JSON.parse(JSON.stringify(value));
function reset() {beforeBatch = null; beforeStatement = null; sqlite.exec('PRAGMA foreign_keys=OFF'); for (const {name} of sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {assert.match(name, /^[a-z_0-9]+$/); sqlite.exec('DELETE FROM "' + name + '"');} sqlite.exec('PRAGMA foreign_keys=ON'); objects.clear(); activeUser = null; outbound = 0; for (const key of Object.keys(env)) if (key !== 'DB' && key !== 'BUCKET') delete env[key];}
async function call(api, method, user, body, query = '', headers = {}) {
  activeUser = user; const requestHeaders = new Headers(method === 'POST' ? {'Content-Type': 'application/json', Origin: 'https://comichuddle.test', ...headers} : headers);
  const response = await api[method](new Request('https://comichuddle.test/api/' + query, {method, headers: requestHeaders, body: method === 'POST' ? JSON.stringify(body) : undefined}));
  let data = null; try {data = await response.json();} catch {} return {status: response.status, data, etag: response.headers.get('ETag'), headers: response.headers};
}
async function profile(user, extra = {}) {const response = await call(social, 'POST', user, {action: 'profile', handle: user.userId, name: user.displayName, bio: 'Comic collector', tagline: 'My shelf.', location: 'Madison, WI', favorite: 'Saga', since: 2020, color: 'teal', featured: [], visible: true, dmOpen: true, accept: true, ...extra}); assert.equal(response.status, 200, JSON.stringify(response.data)); return (await call(social, 'GET', user)).data.me;}
function book(id, issue = catalog[4], extra = {}) {return {id, title: issue.title, issue: '#' + issue.number, grade: 'Raw VF self-reported', price: 5432.1, ...plain(shared.issueIdentity(issue)), ...extra};}
async function save(user, books, extra = {}) {const etag = (await call(vault, 'GET', user)).etag; const response = await call(vault, 'POST', user, {...empty, books, ...extra}, '', {'If-Match': etag}); assert.equal(response.status, 200, JSON.stringify(response.data)); return response;}
async function upload(user) {activeUser = user; const response = await media.POST(new Request('https://comichuddle.test/api/media', {method: 'POST', headers: {Origin: 'https://comichuddle.test', 'Content-Type': 'image/jpeg'}, body: await readFile('public/covers/planet-12.jpg')})); assert.equal(response.status, 200); return (await response.json()).id;}
async function createListing(user, ids, extra = {}) {const response = await call(social, 'POST', user, {action: 'listing', kind: ids.length === 1 ? 'single' : 'collection', saleType: 'fixed', bookIds: ids, description: 'My actual owned copies; condition self-reported.', price: 2500, shipping: 800, photos: [await upload(user)], attest: true, usaAttest: true, ...extra}); assert.equal(response.status, 200, JSON.stringify(response.data)); return response.data.listingId;}
const listing = (user, id) => call(social, 'GET', user, null, '?kind=listing&id=' + id);
function domainSnapshot() {const tables = ['collections', 'listings', 'listing_inventory', 'commerce_orders', 'commerce_sellers', 'commerce_money_requests', 'commerce_events']; return Object.fromEntries(tables.map(table => [table, sqlite.prepare('SELECT * FROM ' + table).all().map(plain)]));}
function sandboxFixture() {Object.assign(env, {COMMERCE_SANDBOX_ENABLED: 'true', COMMERCE_SANDBOX_REVIEWED: 'true', COMMERCE_STRIPE_TEST_SECRET_KEY: 'sk_test_SYNTHETICNOTAREALACCOUNT123', COMMERCE_STRIPE_TEST_WEBHOOK_SECRET: 'whsec_SYNTHETICNOTAREALSECRET123', COMMERCE_PUBLIC_ORIGIN: 'https://comichuddle.test'});}
const checkoutBody = id => ({action: 'checkout', listingId: id, requestId: webcrypto.randomUUID(), sandboxAcknowledged: true, shippingAddress: {name: 'Synthetic buyer', line1: 'PRIVATE BUYER STREET', city: 'Madison', state: 'WI', postalCode: '53703', country: 'US'}});
const terms = (user, thread, cursor) => call(social, 'GET', user, null, '?kind=trade_terms&thread=' + encodeURIComponent(thread) + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
const decide = (user, proposalId, decision, expectedVersion = 0, extra = {}) => call(social, 'POST', user, {action: 'trade_terms_decision', proposalId, decision, expectedVersion, ...(decision === 'accept' ? {agreementOnlyConsent: true} : {}), ...extra});
async function tradeSetup(send = true) {
  const seller = await profile(alice), buyer = await profile(bob), photoId = await upload(bob);
  await save(alice, [book('terms-seller-a'), book('terms-seller-b', catalog[0])]);
  await save(bob, [book('terms-buyer-a', catalog[10], {price: 8765.43, photoId}), book('PRIVATE-UNSELECTED-COPY', catalog[24], {price: 9876.54})]);
  const listingId = await createListing(alice, ['terms-seller-a', 'terms-seller-b'], {fulfillment: 'both', pickupCity: 'Madison', pickupState: 'WI'});
  const request = {action: 'trade_offer', listingId, bookIds: ['terms-buyer-a'], note: 'Review these exact editions before agreeing.', requestId: webcrypto.randomUUID()};
  const response = send ? await call(social, 'POST', bob, request) : null;
  if (send) assert.equal(response.status, 200, JSON.stringify(response.data));
  return {seller, buyer, photoId, listingId, request, proposalId: response?.data.proposalId, threadId: response?.data.threadId};
}
let passed = 0, completed = false; const failures = [];
process.on('beforeExit', () => {if (!completed) {console.error('Sketch suite did not finish'); process.exitCode = 1;}});
async function test(name, run) {reset(); let timer; console.log('RUN: ' + name); try {await Promise.race([run(), new Promise((_, reject) => {timer = setTimeout(() => reject(Error('Case timed out after 15 seconds')), 15000);})]); assert.equal(sqlite.prepare('SELECT count(*) n FROM operation_guard').get().n, 0); passed++; console.log('PASS: ' + name);} catch (error) {failures.push({name, message: error.message}); console.error('FAIL: ' + name + ' — ' + error.message);} finally {clearTimeout(timer); beforeBatch = null; beforeStatement = null;}}

await test('Sketch navigation exposes six unique destinations and archives Community, FMV and GrailMatch', async () => {
  const expected = ['Home', 'Directory', 'Marketplace', 'Collectors', 'Pressing', 'Upcoming']; assert.deepEqual(plain(navigation.activeNavigation), expected); assert.equal(new Set(navigation.mobileNavigation).size, 6); assert.deepEqual([...navigation.mobileNavigation].sort(), [...expected].sort());
  for (const source of ['Community', 'FMV', 'GrailMatch']) assert.equal(navigation.resolveSection(source), 'Upcoming');
  assert.equal(navigation.resolveSection('My Profile'), 'Collectors'); assert.equal(navigation.resolveSection('Comic Workshop'), 'Pressing'); assert.equal(navigation.resolveSection('https://evil.example'), null);
});
await test('Archived account return paths preserve role and owned context while landing on Upcoming', async () => {
  for (const source of ['Community', 'FMV', 'GrailMatch']) for (const role of ['collector', 'provider']) {const url = new URL(account.accountSignInPath('/', '?view=app&issue=4&sell=collection', role, source), 'https://comichuddle.test'); const returned = new URL(url.searchParams.get('return_to'), 'https://comichuddle.test'); assert.equal(returned.origin, 'https://comichuddle.test'); assert.equal(returned.searchParams.get('section'), 'Upcoming'); assert.equal(returned.searchParams.get('join'), role); assert.equal(returned.searchParams.get('issue'), '4'); assert.equal(returned.searchParams.get('sell'), 'collection');}
});
await test('Real directory publisher/issue filters preserve credited edition identity and honest coverage', async () => {
  const response = await call(catalogApi, 'GET', null, null, '?q=Saga%20%231&publisher=' + encodeURIComponent(catalog[4].publisher) + '&limit=12'); assert.equal(response.status, 200); assert.equal(response.data.issueCount, 43); assert.equal(response.data.scope, 'starter'); assert.equal(response.data.total, 1);
  const issue = response.data.issues[0]; assert.equal(issue.id, 4); assert.equal(issue.number, '1'); assert.equal(issue.year, catalog[4].year); assert.equal(issue.variant, catalog[4].variant); assert.equal(issue.source, catalog[4].source); assert.equal(outbound, 0);
  const none = await call(catalogApi, 'GET', null, null, '?q=Saga%20%239999&publisher=' + encodeURIComponent(catalog[4].publisher)); assert.equal(none.data.total, 0); assert.deepEqual(none.data.issues, []);
});
await test('Imported edition selection saves exact external provenance while a manual copy stays unlinked', async () => {
  const source = {id: 731, modified: '2026-10-12T00:00:00Z', number: '7', series: {id: 44, name: 'Test Variants', year_began: 2021, volume: 2}, publisher: {id: 32, name: 'Test Press'}, cover_date: '2021-01-01', credits: [], image: 'https://unlicensed.example/cover.jpg', price: 200};
  const normalized = catalogStore.normalizeMetronRecord(source, new Date().toISOString()); await database.batch(catalogStore.metronRecordStatements(database, normalized)); await profile(alice);
  const response = await call(catalogApi, 'GET', null, null, '?id=1000000731'); assert.equal(response.status, 200); const issue = response.data.issues[0]; assert.equal(issue.metronId, 731); assert.equal(issue.cover, undefined); assert.equal(issue.price, undefined);
  const selected = book('physical-imported', issue), manual = {id: 'physical-manual', title: 'Test Variants', issue: '#7 second printing unindexed', grade: 'Raw VG', price: 0}; await save(alice, [selected, manual]); const read = (await call(vault, 'GET', alice)).data;
  assert.equal(read.books[0].title, issue.title); assert.deepEqual(read.books[0].externalCatalog, {provider: 'Metron', id: 731, sourceUrl: 'https://metron.cloud/issue/731/', license: 'CC BY-SA 4.0'}); assert.equal(read.books[0].catalogId, undefined); assert.equal(read.books[1].externalCatalog, undefined); assert.equal(read.books[1].catalogId, undefined);
  await profile(bob); const selectedListing = (await listing(bob, await createListing(alice, [selected.id]))).data, manualListing = (await listing(bob, await createListing(alice, [manual.id]))).data;
  assert.equal(selectedListing.issueId, issue.id); assert.deepEqual(selectedListing.items[0].externalCatalog, selected.externalCatalog); assert.equal(manualListing.issueId, null); assert.equal(manualListing.items[0].externalCatalog, undefined);
  const filters = {query: '', category: 'All', delivery: 'All', city: '', state: '', issueId: issue.id}; assert.equal(matcherContext.matchesMarketplaceListing(selectedListing, filters), true); assert.equal(matcherContext.matchesMarketplaceListing(manualListing, filters), false, 'A same-title unlinked printing matched an exact directory edition'); assert.equal(selectedListing.items[0].price, undefined);
});
await test('Publisher-to-series browsing separates same-name series years and selects only that stored edition family', async () => {
  for (const [id, year, number] of [[741, 2021, '1'], [742, 2021, '2'], [743, 2023, '1']]) {
    const record = catalogStore.normalizeMetronRecord({id, modified: '2026-10-12T00:00:00Z', number, series: {id: year, name: 'Separate Editions', year_began: year, volume: 1}, publisher: {id: 77, name: 'Test Press'}, cover_date: year + '-01-01', credits: []}, new Date().toISOString()); await database.batch(catalogStore.metronRecordStatements(database, record));
  }
  const browse = await call(catalogApi, 'GET', null, null, '?browse=series&publisher=Test%20Press&limit=1'); assert.equal(browse.status, 200); assert.equal(browse.data.total, 2); assert.equal(browse.data.series[0].title, 'Separate Editions (2021)'); assert.equal(browse.data.series[0].count, 2); assert.equal(browse.data.hasMore, true);
  const second = await call(catalogApi, 'GET', null, null, '?browse=series&publisher=Test%20Press&limit=1&offset=1'); assert.equal(second.status, 200); assert.equal(second.data.series[0].title, 'Separate Editions (2023)'); assert.equal(second.data.hasMore, false);
  const issues = await call(catalogApi, 'GET', null, null, '?publisher=Test%20Press&series=Separate%20Editions%20(2021)&limit=12'); assert.equal(issues.status, 200); assert.equal(issues.data.total, 2); assert.deepEqual(issues.data.issues.map(issue => issue.metronId), [741, 742]);
  for (const query of ['?browse=unknown&publisher=Test%20Press', '?browse=series', '?browse=series&publisher=Test%20Press&series=Other', '?browse=series&publisher=Test%20Press&sort=title', '?series=a&series=b']) assert.equal((await call(catalogApi, 'GET', null, null, query)).status, 400); assert.equal(outbound, 0);
});
await test('Legacy external copies remain private-readable but mismatched or unindexed identities cannot become exact public listings', async () => {
  await profile(alice); const provenance = id => ({provider: 'Metron', id, sourceUrl: 'https://metron.cloud/issue/' + id + '/', license: 'CC BY-SA 4.0'});
  const legacy = [{id: 'legacy-known', title: 'Old wrong title', issue: '#99', grade: 'Raw VF', price: 1234, externalCatalog: provenance(777)}, {id: 'legacy-unknown', title: 'Unindexed source title', issue: '#5', grade: 'Raw VF', price: 4567, externalCatalog: provenance(778)}]; await save(alice, legacy);
  const record = catalogStore.normalizeMetronRecord({id: 777, modified: '2026-10-12T00:00:00Z', number: '1', series: {id: 87, name: 'Canonical Series', year_began: 2020}, publisher: {id: 78, name: 'Test Press'}, cover_date: '2020-01-01', credits: []}, new Date().toISOString()); await database.batch(catalogStore.metronRecordStatements(database, record));
  assert.deepEqual((await call(vault, 'GET', alice)).data.books, legacy); const photo = await upload(alice), before = domainSnapshot();
  for (const copy of legacy) {const result = await call(social, 'POST', alice, {action: 'listing', kind: 'single', saleType: 'fixed', bookIds: [copy.id], description: 'My actual copy.', price: 2500, shipping: 800, photos: [photo], attest: true, usaAttest: true}); assert.equal(result.status, 400, JSON.stringify(result.data)); assert.deepEqual(domainSnapshot(), before);}
  await save(alice, legacy); const canonical = (await call(vault, 'GET', alice)).data.books[0]; assert.equal(canonical.title, record.issue.title); assert.equal(canonical.issue, '#1');
  const published = (await listing(alice, await createListing(alice, [canonical.id]))).data; assert.equal(published.issueId, 1000000777); assert.equal(published.items[0].title, record.issue.title); assert.equal(published.items[0].price, undefined);
});
await test('A provider retains an owned collection and public city without exposing private intake fields', async () => {
  const p = await profile(alice); const owned = book('provider-owned-copy'); await save(alice, [owned]);
  const registration = await call(care, 'POST', alice, {action: 'provider', name: 'Madison Paper Care', bio: 'Independent pressing and cleaning.', location: 'Madison, WI', services: ['pressing'], prices: {pressing: 1500}, specialties: 'Modern books', experienceSince: 2020, turnaroundMin: 7, turnaroundMax: 14, mailIn: true, dropoff: true, accepting: true, visible: true, submissionMode: 'none', dealerReference: '', dealerAttest: false, website: '', logoId: null, portfolio: [], shippingAddress: 'PRIVATE PROVIDER STREET ADDRESS', shippingNotes: 'PRIVATE INTAKE NOTES', terms: 'Assess first. Agree terms directly.', attest: true}); assert.equal(registration.status, 200, JSON.stringify(registration.data));
  await profile(bob); const own = (await call(vault, 'GET', alice)).data; assert.equal(own.books[0].id, owned.id); assert.equal((await call(vault, 'GET', bob)).data, null);
  const publicView = await call(social, 'GET', bob, null, '?kind=profile&handle=' + p.handle); assert.equal(publicView.status, 200); assert.equal(publicView.data.location, 'Madison, WI'); assert.ok(publicView.data.provider); assert.ok(!JSON.stringify(publicView.data).includes('PRIVATE PROVIDER'));
  const directory = await call(care, 'GET', bob); assert.ok(!JSON.stringify(directory.data.providers).includes('PRIVATE PROVIDER')); assert.ok(!JSON.stringify(directory.data.providers).includes('PRIVATE INTAKE'));
});
await test('Local workshop filtering uses supplied city/state and preserves ambiguous legacy locations', async () => {
  assert.deepEqual(plain(pressing.workshopLocation('Madison, Wisconsin, USA')), {city: 'Madison', state: 'WI', stateName: 'Wisconsin'}); assert.deepEqual(plain(pressing.workshopLocation('Madison WI')), {city: 'Madison', state: 'WI', stateName: 'Wisconsin'}); assert.deepEqual(plain(pressing.workshopLocation('Madison')), {city: 'Madison', state: '', stateName: ''}); assert.deepEqual(plain(pressing.workshopLocation('Toronto, Ontario')), {city: 'Toronto', state: 'Ontario', stateName: 'Ontario'});
  const rows = [{id: 'a', name: 'Paper Care', location: 'Madison, WI', collector: {name: 'Alice', handle: 'paper_hero'}, specialties: 'Golden Age', services: ['pressing'], mailIn: true, dropoff: true, accepting: true}, {id: 'b', name: 'Paper Care', location: 'Madison, AL', collector: {name: 'Bob', handle: 'paper_bob'}, specialties: 'Modern', services: ['dry_cleaning'], mailIn: true, dropoff: false, accepting: true}];
  assert.deepEqual(plain(pressing.filterWorkshopProviders(rows, {query: 'Alice paper', city: 'Madison', state: 'Wisconsin', method: 'dropoff', service: 'pressing'})).map(value => value.id), ['a']); assert.deepEqual(plain(pressing.filterWorkshopProviders(rows, {city: 'Madison', state: 'AL'})).map(value => value.id), ['b']);
  assert.deepEqual(plain(pressing.workshopAreaOptions(rows, 'WI')).cities.map(value => value.label), ['Madison']);
});
await test('Workshop ranks the chosen area and excludes insufficient or invalid review evidence', async () => {
  const rows = [{id: 'out-of-area', location: 'Austin, TX', rating: 5, reviewCount: 20}, {id: 'local-best', location: 'Madison, WI', rating: 4.8, reviewCount: 3}, {id: 'local-second', location: 'Madison, WI', rating: 4.5, reviewCount: 8}, {id: 'two-reviews', location: 'Madison, WI', rating: 5, reviewCount: 2}, {id: 'invalid-rating', location: 'Madison, WI', rating: Infinity, reviewCount: 9}].map(row => ({name: row.id, collector: {name: row.id, handle: row.id}, specialties: '', services: ['pressing'], mailIn: true, dropoff: true, accepting: true, createdAt: '2026-10-01', ...row}));
  const ranked = plain(pressing.rankProviders(pressing.filterWorkshopProviders(rows, {city: 'Madison', state: 'WI'}))); assert.equal(ranked.find(value => value.id === 'local-best').rank, 1); assert.equal(ranked.find(value => value.id === 'local-second').rank, 2); assert.equal(ranked.find(value => value.id === 'two-reviews').rank, null); assert.equal(ranked.find(value => value.id === 'invalid-rating').rank, null); assert.equal(rows[1].rank, undefined);
});
await test('Pickup and combined-delivery listing DTOs expose public city only and omit private copy costs', async () => {
  await profile(alice); await profile(bob); await save(alice, [book('pickup-copy'), book('both-copy')]);
  const pickup = await createListing(alice, ['pickup-copy'], {fulfillment: 'pickup', pickupCity: 'Madison', pickupState: 'WI', shipping: 0}); const both = await createListing(alice, ['both-copy'], {fulfillment: 'both', pickupCity: 'Madison', pickupState: 'WI', shipping: 900});
  for (const [id, fulfillment] of [[pickup, 'pickup'], [both, 'both']]) {const response = await listing(bob, id); assert.equal(response.status, 200); assert.equal(response.data.fulfillment, fulfillment); assert.equal(response.data.pickupCity, 'Madison'); assert.equal(response.data.pickupState, 'WI'); assert.ok(response.data.seller.createdAt); assert.equal(response.data.items[0].price, undefined); assert.equal(response.data.valuation.total, null); assert.equal(response.data.valuation.status, 'unavailable');}
});
await test('Invalid pickup regions, address fields and shipping charges cannot publish or lock a copy', async () => {
  await profile(alice); await save(alice, [book('guarded-pickup')]); const photo = await upload(alice), before = domainSnapshot();
  for (const fields of [{fulfillment: 'pickup', pickupCity: 'Madison', pickupState: 'WI', shipping: 800}, {fulfillment: 'pickup', pickupCity: '', pickupState: 'WI', shipping: 0}, {fulfillment: 'pickup', pickupCity: 'Madison', pickupState: 'XX', shipping: 0}, {fulfillment: 'shipping', pickupCity: 'Madison', pickupState: 'WI'}, {fulfillment: 'pickup', pickupCity: '123 Main Street', pickupState: 'WI', shipping: 0}, {fulfillment: 'pickup', pickupCity: 'Madison', pickupState: 'WI', pickupAddress: 'PRIVATE STREET', shipping: 0}]) {
    const response = await call(social, 'POST', alice, {action: 'listing', kind: 'single', saleType: 'fixed', bookIds: ['guarded-pickup'], description: 'My actual comic.', price: 2500, shipping: 0, photos: [photo], attest: true, usaAttest: true, ...fields}); assert.equal(response.status, 400, JSON.stringify(response.data)); assert.deepEqual(domainSnapshot(), before);
  }
});
await test('Pickup-only checkout fails before any processor request or order even with synthetic sandbox configuration', async () => {
  await profile(alice); await profile(bob); await save(alice, [book('pickup-unpaid')]); const id = await createListing(alice, ['pickup-unpaid'], {fulfillment: 'pickup', pickupCity: 'Madison', pickupState: 'WI', shipping: 0}); sandboxFixture(); const before = domainSnapshot();
  const response = await call(commerce, 'POST', bob, checkoutBody(id)); assert.equal(response.status, 409, JSON.stringify(response.data)); assert.match(response.data.error, /pickup/i); assert.deepEqual(domainSnapshot(), before); assert.equal(outbound, 0);
});
await test('Collection and local auction snapshots keep all owned copies and auctions remain nonbinding and unpaid', async () => {
  await profile(alice); const bidder = await profile(bob); await save(alice, [book('lot-one'), book('lot-two'), book('local-auction')]); const lot = await createListing(alice, ['lot-one', 'lot-two']); const auction = await createListing(alice, ['local-auction'], {saleType: 'auction', fulfillment: 'pickup', pickupCity: 'Madison', pickupState: 'WI', shipping: 0, durationHours: 24, bidIncrement: 500});
  const lotDto = (await listing(bob, lot)).data; assert.equal(lotDto.kind, 'collection'); assert.equal(lotDto.itemCount, 2); assert.deepEqual(lotDto.items.map(copy => copy.id), ['lot-one', 'lot-two']); assert.ok(lotDto.items.every(copy => copy.price === undefined));
  const proposal = await call(social, 'POST', bob, {action: 'bid', listingId: auction, amount: 2500, requestId: webcrypto.randomUUID(), nonbindingConsent: true}); assert.equal(proposal.status, 200, JSON.stringify(proposal.data)); const dto = (await listing(bob, auction)).data; assert.equal(dto.auction.nonbinding, true); assert.equal(dto.auction.leading, true); assert.equal(dto.fulfillment, 'pickup');
  assert.equal((await call(social, 'POST', alice, {action: 'bid', listingId: auction, amount: 3000, requestId: webcrypto.randomUUID(), nonbindingConsent: true})).status, 403);
  assert.equal((await call(social, 'POST', bob, {action: 'retract_bid', listingId: auction, bidId: dto.auction.yourBidId, nonbindingConsent: true})).status, 200); assert.equal((await listing(bob, auction)).data.auction.currentBid, null);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM commerce_orders').get().n, 0); assert.equal(outbound, 0); assert.ok(bidder.id);
});
await test('Buyer and trade-interest messaging remains private and blocking forbids a new conversation', async () => {
  const seller = await profile(alice), buyer = await profile(bob); await profile(outsider);
  const started = await call(social, 'POST', bob, {action: 'start_thread', to: seller.id, context: 'Trade interest in a specific comic; no completed trade.'}); assert.equal(started.status, 200, JSON.stringify(started.data));
  assert.equal((await call(social, 'POST', bob, {action: 'message', threadId: started.data.threadId, body: 'Interested in a local comic swap.'})).status, 200); const received = await call(social, 'GET', alice, null, '?kind=messages&thread=' + started.data.threadId); assert.equal(received.status, 200); assert.ok(JSON.stringify(received.data).includes('Interested in a local comic swap.'));
  assert.equal((await call(social, 'GET', outsider, null, '?kind=messages&thread=' + started.data.threadId)).status, 404); assert.equal((await call(social, 'POST', alice, {action: 'block', to: buyer.id, block: true})).status, 200);
  assert.ok([403, 404].includes((await call(social, 'POST', bob, {action: 'start_thread', to: seller.id, context: 'Blocked conversation'})).status)); assert.equal(sqlite.prepare('SELECT count(*) n FROM commerce_orders').get().n, 0);
});
await test('Actual listing trade proposal creates one private owned-copy message and no financial or inventory transfer', async () => {
  await profile(alice); await profile(bob); await profile(outsider); await save(alice, [book('seller-for-trade')]); await save(bob, [book('buyer-trade-copy', catalog[10], {price: 8765.43})]); const id = await createListing(alice, ['seller-for-trade']); const before = domainSnapshot();
  const request = {action: 'trade_offer', listingId: id, bookIds: ['buyer-trade-copy'], note: 'Would you consider these owned copies?', requestId: webcrypto.randomUUID()}; const first = await call(social, 'POST', bob, request); assert.equal(first.status, 200, JSON.stringify(first.data)); assert.equal(first.data.duplicate, false); assert.equal(first.data.proposalId, request.requestId); assert.match(first.data.note, /trade terms/i);
  const repeated = await call(social, 'POST', bob, request); assert.equal(repeated.status, 200); assert.equal(repeated.data.duplicate, true); assert.equal(repeated.data.threadId, first.data.threadId); assert.equal(sqlite.prepare('SELECT count(*) n FROM messages WHERE id=?').get(request.requestId).n, 1);
  const received = await call(social, 'GET', alice, null, '?kind=messages&thread=' + first.data.threadId); assert.equal(received.status, 200); const message = received.data.messages[0].body; assert.ok(message.includes(catalog[10].title)); assert.match(message, /No payment or inventory transfer occurs/); assert.ok(!message.includes('8765.43')); assert.equal((await call(social, 'GET', outsider, null, '?kind=messages&thread=' + first.data.threadId)).status, 404); assert.deepEqual(domainSnapshot(), before);
});
await test('Concurrent trade retries cannot duplicate correspondence and changed payload cannot reuse its receipt', async () => {
  await profile(alice); await profile(bob); await save(alice, [book('seller-concurrent')]); await save(bob, [book('buyer-concurrent')]); const id = await createListing(alice, ['seller-concurrent']); const before = domainSnapshot(); const request = {action: 'trade_offer', listingId: id, bookIds: ['buyer-concurrent'], note: 'Original proposal', requestId: webcrypto.randomUUID()};
  const results = await Promise.all([call(social, 'POST', bob, request), call(social, 'POST', bob, request)]); assert.ok(results.every(response => response.status === 200), JSON.stringify(results)); assert.deepEqual(results.map(response => response.data.duplicate).sort(), [false, true]); assert.equal(sqlite.prepare('SELECT count(*) n FROM messages WHERE id=?').get(request.requestId).n, 1);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM trade_proposals WHERE id=?').get(request.requestId).n, 1);
  const changed = await call(social, 'POST', bob, {...request, note: 'Changed proposal'}); assert.equal(changed.status, 409); assert.deepEqual(domainSnapshot(), before); assert.equal(outbound, 0);
});
await test('Foreign, reserved and blocked trade copies fail before creating any message or thread', async () => {
  const seller = await profile(alice); await profile(bob); await save(alice, [book('seller-target')]); await save(bob, [book('buyer-reserved'), book('buyer-available')]); const target = await createListing(alice, ['seller-target']); await createListing(bob, ['buyer-reserved']);
  const before = domainSnapshot(), proposed = ids => ({action: 'trade_offer', listingId: target, bookIds: ids, note: '', requestId: webcrypto.randomUUID()});
  assert.equal((await call(social, 'POST', bob, proposed(['seller-target']))).status, 403); assert.equal((await call(social, 'POST', bob, proposed(['buyer-reserved']))).status, 409); assert.equal((await call(social, 'POST', bob, proposed(['buyer-available', 'buyer-available']))).status, 400);
  assert.equal((await call(social, 'POST', bob, {action: 'block', to: seller.id, block: true})).status, 200); assert.equal((await call(social, 'POST', bob, proposed(['buyer-available']))).status, 403);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM messages').get().n, 0); assert.equal(sqlite.prepare('SELECT count(*) n FROM threads').get().n, 0); assert.deepEqual(domainSnapshot(), before);
});
await test('Durable trade terms are participant-only immutable copy metadata with bounded private pagination', async () => {
  const fixture = await tradeSetup(); await profile(outsider); await profile(owner, {handle: 'sketch_owner'});
  const sellerView = await terms(alice, fixture.threadId), buyerView = await terms(bob, fixture.threadId);
  assert.equal(sellerView.status, 200, JSON.stringify(sellerView.data)); assert.equal(buyerView.status, 200);
  const sellerTerms = sellerView.data.proposals[0], buyerTerms = buyerView.data.proposals[0];
  assert.equal(sellerTerms.id, fixture.request.requestId); assert.equal(sellerTerms.status, 'pending'); assert.equal(sellerTerms.version, 0); assert.equal(sellerTerms.role, 'seller'); assert.equal(buyerTerms.role, 'buyer');
  assert.equal(sellerTerms.canAccept, true); assert.equal(sellerTerms.canDecline, true); assert.equal(sellerTerms.canCancel, false); assert.equal(buyerTerms.canAccept, false); assert.equal(buyerTerms.canCancel, true);
  assert.equal(sellerTerms.agreementOnly, true); assert.equal(sellerTerms.completed, false); assert.equal(sellerTerms.protected, false);
  assert.deepEqual(sellerTerms.requestedItems.map(copy => copy.bookId), ['terms-seller-a', 'terms-seller-b']); assert.deepEqual(sellerTerms.offeredItems.map(copy => copy.bookId), ['terms-buyer-a']);
  for (const item of [...sellerTerms.offeredItems, ...sellerTerms.requestedItems]) {assert.equal(item.price, undefined); assert.equal(item.photoId, undefined); assert.equal(item.userId, undefined);}
  const encoded = JSON.stringify(sellerTerms); for (const privateValue of ['8765.43', '9876.54', 'PRIVATE-UNSELECTED-COPY', fixture.photoId]) assert.ok(!encoded.includes(privateValue));
  assert.equal((await terms(null, fixture.threadId)).status, 401); assert.equal((await terms(outsider, fixture.threadId)).status, 404); assert.equal((await terms(owner, fixture.threadId)).status, 404);
  // Seed older saved receipts directly to test paging without bypassing write-rate
  // safeguards in a real user journey. Every page still executes the actual route.
  const saved = sqlite.prepare('SELECT * FROM trade_proposals WHERE id=?').get(fixture.proposalId), columns = Object.keys(saved), insert = sqlite.prepare('INSERT INTO trade_proposals (' + columns.join(',') + ') VALUES (' + columns.map(() => '?').join(',') + ')');
  for (let index = 0; index < 11; index++) {const copy = {...saved, id: webcrypto.randomUUID(), created_at: new Date(Date.parse(saved.created_at) - (index + 1) * 1000).toISOString()}; insert.run(...columns.map(key => copy[key]));}
  const first = (await terms(alice, fixture.threadId)).data; assert.equal(first.proposals.length, 10); assert.equal(first.hasMore, true); assert.ok(first.nextCursor);
  const last = (await terms(alice, fixture.threadId, first.nextCursor)).data; assert.equal(last.proposals.length, 2); assert.equal(last.hasMore, false); assert.equal(last.nextCursor, null); assert.equal(new Set([...first.proposals, ...last.proposals].map(value => value.id)).size, 12);
  assert.equal((await terms(bob, fixture.threadId, 'invalid-cursor')).status, 400); assert.equal((await terms(bob, fixture.threadId, webcrypto.randomUUID())).status, 404);
  assert.equal(outbound, 0);
});
await test('Only the seller can accept exact trade terms with explicit agreement consent and the current version', async () => {
  const fixture = await tradeSetup(); await profile(outsider); await profile(owner, {handle: 'sketch_owner'}); const before = domainSnapshot();
  assert.equal((await decide(bob, fixture.proposalId, 'accept')).status, 403); assert.equal((await decide(bob, fixture.proposalId, 'decline')).status, 403); assert.equal((await decide(alice, fixture.proposalId, 'cancel')).status, 403);
  assert.equal((await decide(outsider, fixture.proposalId, 'accept')).status, 404); assert.equal((await decide(owner, fixture.proposalId, 'accept')).status, 404); assert.equal((await decide(null, fixture.proposalId, 'accept')).status, 401);
  assert.equal((await decide(alice, fixture.proposalId, 'accept', 0, {agreementOnlyConsent: false})).status, 400); assert.equal((await decide(alice, fixture.proposalId, 'accept', 1)).status, 409); assert.equal((await decide(alice, fixture.proposalId, 'accept', -1)).status, 400);
  assert.equal((await call(social, 'POST', alice, {action: 'trade_terms_decision', proposalId: fixture.proposalId, decision: 'accept', expectedVersion: 0, agreementOnlyConsent: true}, '', {Origin: 'https://evil.example'})).status, 403);
  const accepted = await decide(alice, fixture.proposalId, 'accept'); assert.equal(accepted.status, 200, JSON.stringify(accepted.data)); assert.equal(accepted.data.status, 'accepted'); assert.match(accepted.data.note, /No completed trade, protection, payment or transfer/i);
  const current = (await terms(bob, fixture.threadId)).data.proposals[0]; assert.equal(current.status, 'accepted'); assert.equal(current.version, 1); assert.ok(current.decidedAt); assert.equal(current.canAccept, false); assert.equal(current.canCancel, false); assert.equal(current.completed, false);
  const originalRetry = await call(social, 'POST', bob, fixture.request); assert.equal(originalRetry.status, 200); assert.equal(originalRetry.data.duplicate, true); assert.equal(sqlite.prepare('SELECT status,version FROM trade_proposals WHERE id=?').get(fixture.proposalId).version, 1);
  assert.equal((await decide(alice, fixture.proposalId, 'accept', 0)).status, 409); assert.equal((await decide(alice, fixture.proposalId, 'decline', 1)).status, 409); assert.equal((await decide(bob, fixture.proposalId, 'cancel', 1)).status, 409); assert.deepEqual(domainSnapshot(), before);
});
await test('Seller decline and proposer cancel are explicit final states, including safe closure after a block', async () => {
  const fixture = await tradeSetup(); const second = await call(social, 'POST', bob, {...fixture.request, requestId: webcrypto.randomUUID()}); assert.equal(second.status, 200); const before = domainSnapshot();
  assert.equal((await call(social, 'POST', bob, {action: 'block', to: fixture.seller.id, block: true})).status, 200);
  const blockedTerms = (await terms(alice, fixture.threadId)).data.proposals; assert.ok(blockedTerms.every(value => !value.canAccept && value.unavailableReason));
  assert.equal((await decide(alice, fixture.proposalId, 'accept')).status, 409);
  sqlite.prepare('UPDATE profiles SET rules_version=? WHERE id IN (?,?)').run('outdated-rules', fixture.seller.id, fixture.buyer.id);
  const declined = await decide(alice, fixture.proposalId, 'decline'), cancelled = await decide(bob, second.data.proposalId, 'cancel'); assert.equal(declined.status, 200); assert.equal(cancelled.status, 200);
  assert.equal(declined.data.status, 'declined'); assert.equal(cancelled.data.status, 'cancelled');
  const current = (await terms(bob, fixture.threadId)).data.proposals; assert.deepEqual(current.map(value => value.status).sort(), ['cancelled', 'declined']); assert.ok(current.every(value => value.version === 1 && !value.canAccept && !value.canDecline && !value.canCancel && !value.completed));
  assert.equal((await decide(alice, fixture.proposalId, 'decline', 1)).status, 409); assert.equal((await decide(bob, second.data.proposalId, 'cancel', 1)).status, 409); assert.deepEqual(domainSnapshot(), before);
});
await test('Concurrent conflicting trade decisions commit one terminal version and never transfer inventory or money', async () => {
  const fixture = await tradeSetup(), before = domainSnapshot();
  const results = await Promise.all([decide(alice, fixture.proposalId, 'accept'), decide(bob, fixture.proposalId, 'cancel')]); assert.deepEqual(results.map(value => value.status).sort(), [200, 409], JSON.stringify(results));
  const row = sqlite.prepare('SELECT * FROM trade_proposals WHERE id=?').get(fixture.proposalId); assert.equal(row.version, 1); assert.ok(['accepted', 'cancelled'].includes(row.status)); assert.equal(row.decided_by, row.status === 'accepted' ? fixture.seller.id : fixture.buyer.id);
  const publicTerms = (await terms(alice, fixture.threadId)).data.proposals[0]; assert.equal(publicTerms.status, row.status); assert.equal(publicTerms.version, 1); assert.equal(publicTerms.completed, false); assert.deepEqual(domainSnapshot(), before); assert.equal(outbound, 0);
});
await test('Trade acceptance rechecks owned-copy terms, availability and consent while private cost edits stay private', async () => {
  for (const mode of ['copy', 'reserved', 'rules', 'withdrawn', 'cost-only']) {
    reset(); const fixture = await tradeSetup();
    if (mode === 'copy' || mode === 'cost-only') {const current = (await call(vault, 'GET', bob)).data; current.books[0][mode === 'copy' ? 'grade' : 'price'] = mode === 'copy' ? 'Raw condition changed after proposal' : 1.23; await save(bob, current.books, current);}
    if (mode === 'reserved') await createListing(bob, ['terms-buyer-a']);
    if (mode === 'rules') sqlite.prepare('UPDATE profiles SET rules_version=? WHERE id=?').run('outdated-rules', fixture.buyer.id);
    if (mode === 'withdrawn') assert.equal((await call(social, 'POST', alice, {action: 'withdraw_listing', listingId: fixture.listingId})).status, 200);
    const before = domainSnapshot(), response = await decide(alice, fixture.proposalId, 'accept'); assert.equal(response.status, mode === 'cost-only' ? 200 : 409, mode + ': ' + JSON.stringify(response.data));
    const saved = sqlite.prepare('SELECT status,version FROM trade_proposals WHERE id=?').get(fixture.proposalId); assert.equal(saved.status, mode === 'cost-only' ? 'accepted' : mode === 'withdrawn' ? 'cancelled' : 'pending');
    assert.deepEqual(domainSnapshot(), before); assert.equal(outbound, 0);
  }
});
await test('Trade write guards reject raced terms and failed writes roll back proposal, message and decision together', async () => {
  let fixture = await tradeSetup(false), fired = false;
  beforeBatch = statements => {if (!statements.some(value => /insert into ["`]?trade_proposals/i.test(value.sql))) return; beforeBatch = null; fired = true; sqlite.prepare('UPDATE listings SET pickup_city=? WHERE id=?').run('Milwaukee', fixture.listingId);};
  assert.equal((await call(social, 'POST', bob, fixture.request)).status, 409); assert.equal(fired, true); assert.equal(sqlite.prepare('SELECT count(*) n FROM trade_proposals').get().n, 0); assert.equal(sqlite.prepare('SELECT count(*) n FROM messages').get().n, 0); assert.equal(sqlite.prepare('SELECT count(*) n FROM threads').get().n, 0);
  reset(); fixture = await tradeSetup(false); fired = false;
  beforeStatement = statement => {if (!/insert into ["`]?messages/i.test(statement.sql)) return; beforeStatement = null; fired = true; sqlite.prepare('INSERT INTO operation_guard(id,valid) VALUES (?,0)').run(webcrypto.randomUUID());};
  assert.equal((await call(social, 'POST', bob, fixture.request)).status, 409); assert.equal(fired, true); assert.equal(sqlite.prepare('SELECT count(*) n FROM trade_proposals').get().n, 0); assert.equal(sqlite.prepare('SELECT count(*) n FROM threads').get().n, 0);
  reset(); fixture = await tradeSetup(); const before = domainSnapshot(); fired = false;
  beforeBatch = statements => {if (!statements.some(value => /update ["`]?trade_proposals/i.test(value.sql))) return; beforeBatch = null; fired = true; sqlite.prepare('INSERT INTO blocks(from_id,to_id) VALUES(?,?)').run(fixture.buyer.id, fixture.seller.id);};
  assert.equal((await decide(alice, fixture.proposalId, 'accept')).status, 409); assert.equal(fired, true); assert.equal(sqlite.prepare('SELECT status FROM trade_proposals WHERE id=?').get(fixture.proposalId).status, 'pending');
  sqlite.exec('DELETE FROM blocks'); fired = false;
  beforeStatement = statement => {if (!/update ["`]?trade_proposals/i.test(statement.sql)) return; beforeStatement = null; fired = true; sqlite.prepare('INSERT INTO operation_guard(id,valid) VALUES (?,0)').run(webcrypto.randomUUID());};
  assert.equal((await decide(alice, fixture.proposalId, 'accept')).status, 409); assert.equal(fired, true); const remaining = sqlite.prepare('SELECT status,version,decided_at FROM trade_proposals WHERE id=?').get(fixture.proposalId); assert.equal(remaining.status, 'pending'); assert.equal(remaining.version, 0); assert.equal(remaining.decided_at, null); assert.deepEqual(domainSnapshot(), before);
});
await test('Trade exports contain only participant terms and account deletion removes dependent records without touching another discussion', async () => {
  const fixture = await tradeSetup(); await profile(outsider); await save(outsider, [book('outsider-offered')]);
  const other = await call(social, 'POST', outsider, {...fixture.request, bookIds: ['outsider-offered'], requestId: webcrypto.randomUUID()}); assert.equal(other.status, 200); assert.equal((await decide(alice, fixture.proposalId, 'accept')).status, 200);
  assert.equal((await terms(bob, fixture.threadId, other.data.proposalId)).status, 404);
  const buyerExport = (await call(social, 'GET', bob, null, '?kind=export')).data, sellerExport = (await call(social, 'GET', alice, null, '?kind=export')).data, outsiderExport = (await call(social, 'GET', outsider, null, '?kind=export')).data;
  assert.equal(buyerExport.tradeTerms.length, 1); assert.equal(sellerExport.tradeTerms.length, 2); assert.equal(outsiderExport.tradeTerms.length, 1); assert.equal(buyerExport.tradeTerms[0].id, fixture.proposalId); assert.equal(outsiderExport.tradeTerms[0].id, other.data.proposalId);
  for (const value of sellerExport.tradeTerms) {assert.equal(value.requestBody, undefined); assert.equal(value.listingSnapshot, undefined); assert.equal(value.completed, false); for (const item of [...value.offeredItems, ...value.requestedItems]) {assert.equal(item.price, undefined); assert.equal(item.photoId, undefined);}}
  assert.equal((await call(social, 'POST', bob, {action: 'delete_my_data', confirm: 'DELETE'})).status, 200); assert.equal(sqlite.prepare('SELECT count(*) n FROM trade_proposals WHERE id=?').get(fixture.proposalId).n, 0); assert.equal(sqlite.prepare('SELECT count(*) n FROM messages WHERE thread_id=?').get(fixture.threadId).n, 0); assert.equal(sqlite.prepare('SELECT count(*) n FROM threads WHERE id=?').get(fixture.threadId).n, 0);
  assert.equal((await terms(alice, fixture.threadId)).status, 404); assert.equal((await terms(alice, other.data.threadId)).data.proposals[0].id, other.data.proposalId); assert.equal((await listing(outsider, fixture.listingId)).status, 200);
  assert.equal((await call(social, 'POST', alice, {action: 'delete_my_data', confirm: 'DELETE'})).status, 200); assert.equal(sqlite.prepare('SELECT count(*) n FROM trade_proposals').get().n, 0); assert.equal((await terms(outsider, other.data.threadId)).status, 404); assert.equal(sqlite.prepare('SELECT count(*) n FROM commerce_orders').get().n, 0); assert.equal(outbound, 0);
});
await test('Unconfigured shipping checkout and release actions preserve financial and inventory state', async () => {
  await profile(alice); await profile(bob); await save(alice, [book('unpaid-fixed')]); const id = await createListing(alice, ['unpaid-fixed']); const before = domainSnapshot();
  assert.equal((await call(commerce, 'POST', bob, checkoutBody(id))).status, 503); assert.equal((await call(social, 'POST', bob, {action: 'buy', listingId: id})).status, 503); assert.equal((await call(commerce, 'POST', owner, {action: 'release'})).status, 503); assert.deepEqual(domainSnapshot(), before); assert.equal(outbound, 0);
});

// Actual TSX below uses controlled camera/canvas/local-detector surfaces.
// Real recognition executes on known cover pixels; browser/device behavior is separate.
const scanHelpers = await load('lib/comic-scan.ts'), valueLinks = await load('lib/value-links.ts');
const compile = code => ts.transpileModule(code, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText;
const flush = async () => {for (let turn = 0; turn < 14; turn++) await Promise.resolve();};
async function clientSource(file, name) {
  const source = await readFile(file, 'utf8'), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name); assert.ok(component);
  const functions = component.body.statements.filter(ts.isFunctionDeclaration).map(node => node.getText(ast)); const effects = component.body.statements.filter(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === 'useEffect').map(node => node.expression.arguments[0].getText(ast));
  const callbacks = []; function walk(node) {if (ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) callbacks.push({name: node.name.getText(ast), code: node.initializer.expression.getText(ast), node}); ts.forEachChild(node, walk);} walk(component);
  return {source, ast, component, functions, effects, callbacks};
}
function actualHubDetailCard(source,context){
  const current=source.component.body.statements.filter(ts.isVariableStatement)
    .flatMap(node=>node.declarationList.declarations).find(node=>node.name.getText(source.ast)==='current');
  assert.ok(current?.initializer,'Actual Hub current issue selector missing');
  const matches=[];function inspect(node){if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(source.ast)==='ComicProductCard')matches.push(node);ts.forEachChild(node,inspect);}inspect(source.component);
  assert.equal(matches.length,1,'Expected one complete card in actual Hub issue details');
  const jsx=(type,props,key)=>({type,props:{...props,key}});
  Object.assign(context,{exports:{},require:specifier=>{assert.equal(specifier,'react/jsx-runtime');return {jsx,jsxs:jsx,Fragment:'fragment'};},
    ComicProductCard:'actual-product-card',ArchiveCard:'actual-archive-card',Bookmark:'Bookmark',...valueLinks,
    listingDirectoryId:shared.listingDirectoryId});
  const code=ts.transpileModule('globalThis.current='+current.initializer.getText(source.ast)+';globalThis.detailCard='+matches[0].getText(source.ast)+';',
    {fileName:'actual-hub-detail.tsx',compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInContext(code,context);return context.detailCard.props;
}
async function namespaceCatalog(){
  const gcd=await load('lib/gcd-catalog.ts'),stamp='2026-10-13T10:00:00.000Z';
  const metron=catalogStore.normalizeMetronRecord({id:50,series:{id:7,name:'Namespace Series',year_began:2018},
    publisher:{id:9,name:'Namespace Press'},number:'1',cover_date:'2018-11-01',modified:stamp},stamp);
  const record=gcd.normalizeGcdIssue({api_url:'https://www.comics.org/api/issue/50/',series:'https://www.comics.org/api/series/7/',
    series_name:'Namespace Series (2018)',number:'1',key_date:'2018-00-00',indicia_publisher:'Namespace Press',
    notes:'Selected synthetic bibliographic details.',variant_name:'Exact GCD printing record',
    image:'https://artwork.example.test/DO_NOT_IMPORT_IMAGE',price:'3.99 USD',
    story_set:[{type:'comic story',script:'Synthetic Writer',pencils:'Synthetic Artist',characters:'Synthetic Character',synopsis:'Synthetic source synopsis retained in issue details.'}]},stamp);
  await database.batch([...catalogStore.seedStarterStatements(database,stamp),...catalogStore.metronRecordStatements(database,metron),...gcd.gcdRecordStatements(database,record)]);
  return {gcd:record.issue,metron:metron.issue};
}
const scannerIndex = JSON.parse(await readFile('public/recognition/cover-index.json', 'utf8'));
function scannerFixture(options = {}) {
  return createScannerFixture({fetcher: async url => url === '/recognition/cover-index.json'
    ? Response.json(scannerIndex) : catalogApi.GET(new Request('https://comichuddle.test' + url)), ...options});
}
async function scannerCamera(fixture) {
  await fixture.flush(); await fixture.click('Start camera'); const live = fixture.stream();
  fixture.calls.cameras.at(-1).resolve(live); await fixture.flush(); return live;
}
async function scannerDetector(fixture) {
  await fixture.flush(); await fixture.upload({type: 'image/jpeg', size: 500});
  fixture.context.window.BarcodeDetector = class {detect(image) {return new Promise((resolve, reject) => fixture.calls.detections.push({image, resolve, reject}));}};
  await fixture.click('Read barcode / text'); assert.equal(fixture.calls.detections.length, 1);
}
const scannerPicker = fixture => fixture.find(node => typeof node.type === 'function' && node.type.name === 'ComicPicker');
await test('GoCollect uses verified base-record research mappings and falls back for alternate or imported editions', async () => {
  assert.equal(valueLinks.goCollectIssueUrl(catalog[0]), 'https://gocollect.com/comic/amazing-spider-man-300');
  for (const variant of ['Newsstand edition', 'French edition', 'Spanish edition', 'German edition', 'Third printing', 'Facsimile', 'Unknown printing']) assert.equal(valueLinks.goCollectIssueUrl({...catalog[0], variant}), null, variant);
  assert.equal(valueLinks.goCollectIssueUrl({...catalog[0], metronId: 100}), null); assert.equal(valueLinks.goCollectIssueUrl(catalog[4]), null); assert.equal(valueLinks.goCollectIssueUrl({...catalog[0], year: 2024}), null);
  assert.equal(valueLinks.goCollectComicGuideUrl, 'https://gocollect.com/comics'); const research = valueLinks.goCollectResearchText({...catalog[0], variant: 'Newsstand edition'}); assert.ok(research.includes('#300')); assert.ok(research.includes('1988')); assert.ok(research.includes('Newsstand edition')); assert.equal(outbound, 0);
});
const React = await import('react'), {renderToStaticMarkup} = await import('react-dom/server');
function children(node) {if (Array.isArray(node)) return node.flatMap(children); if (!node || typeof node !== 'object') return []; return [node, ...children(node.props?.children)];}
function text(node) {if (typeof node === 'string' || typeof node === 'number') return String(node); if (Array.isArray(node)) return node.map(text).join(''); return node && typeof node === 'object' ? text(node.props?.children) : '';}
await test('Redesigned collector home renders existing destinations without invented market activity', async () => {
  const home = (await load('app/collector-home.tsx')).default;
  const html = renderToStaticMarkup(React.createElement(home, {go() {}, onScan() {}, onProfile() {}, onProvider() {}, onOpenComic() {}, onValueCollection() {}}));
  for (const label of ['Know the book.', 'Scan a Book', 'Value Collection', 'Browse Keys', 'SafePurchase', 'Coming soon', 'Find a specialist', 'List my pressing studio']) assert.ok(html.includes(label), label);
  assert.ok(html.includes('Verified sales and FMV updates are coming soon.'));
  assert.ok(!html.includes('$0.00'));assert.equal(outbound, 0);
  const hub = await readFile('app/hub.tsx', 'utf8');
  assert.match(hub,/onOpenComic=\{id=>openIssue\(Number\(id\)\)\}/);
  assert.match(hub,/onValueCollection=/);
});
await test('Actual private trade cards gate seller consent, send exact decisions and discard late reads or unmounted writes', async () => {
  const server = await tradeSetup(), sellerData = (await terms(alice, server.threadId)).data, buyerData = (await terms(bob, server.threadId)).data;
  const source = await readFile('app/trade-terms.tsx', 'utf8'), ast = ts.createSourceFile('app/trade-terms.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && ['validTerms', 'BookList', 'TradeTerms'].includes(node.name?.text)).map(node => node.getText(ast)), states = ast.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(value => value.name.getText(ast) === 'states'));
  assert.equal(functions.length, 3); assert.ok(states);
  function fixture() {
    const state = [], refs = [], effects = [], reads = [], writes = [], notifications = []; let stateIndex = 0, refIndex = 0;
    const globals = {React, exports: {}, Date, Error, Promise, encodeURIComponent, AbortController, document: {visibilityState: 'visible'}, setInterval: () => 1, clearInterval() {},
      ...Object.fromEntries(['Check', 'ChevronLeft', 'ChevronRight', 'Repeat2', 'RefreshCw', 'X'].map(name => [name, () => React.createElement('i')])),
      useState: initial => {const index = stateIndex++; if (!(index in state)) state[index] = initial; return [state[index], value => {state[index] = typeof value === 'function' ? value(state[index]) : value;}];},
      useRef: initial => {const index = refIndex++; return refs[index] ||= {current: initial};}, useCallback: value => value, useEffect: value => effects.push(value),
      fetch: (url, options) => new Promise(resolve => reads.push({url, options, resolve}))};
    const ctx = vm.createContext(globals); vm.runInContext(ts.transpileModule(states.getText(ast) + '\n' + functions.join('\n'), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React}}).outputText, ctx);
    const props = {threadId: server.threadId, act: body => new Promise(resolve => writes.push({body: plain(body), resolve})), notify: value => notifications.push(value)};
    function render() {stateIndex = 0; refIndex = 0; effects.length = 0; return ctx.exports.default(props);}
    function respond(index, data, status = 200) {reads[index].resolve({ok: status < 400, json: async () => plain(data)});}
    render(); const cleanup = effects[0](); effects[2]();
    return {state, refs, reads, writes, notifications, props, render, respond, cleanup};
  }
  const seller = fixture(); seller.respond(0, sellerData); await flush(); let tree = seller.render(), nodes = children(tree), accept = nodes.find(node => node.type === 'button' && text(node).includes('Accept terms'));
  assert.ok(accept); assert.equal(accept.props.disabled, true); const checkbox = nodes.find(node => node.type === 'input' && node.props.type === 'checkbox'); assert.ok(checkbox); checkbox.props.onChange({target: {checked: true}});
  tree = seller.render(); accept = children(tree).find(node => node.type === 'button' && text(node).includes('Accept terms')); assert.equal(accept.props.disabled, false); accept.props.onClick(); await flush();
  assert.deepEqual(seller.writes[0].body, {action: 'trade_terms_decision', proposalId: server.proposalId, decision: 'accept', expectedVersion: 0, agreementOnlyConsent: true}); assert.ok(children(seller.render()).filter(node => node.type === 'button' && /Accept terms|Decline/.test(text(node))).every(node => node.props.disabled));
  assert.equal((await decide(alice, server.proposalId, 'accept')).status, 200); const acceptedData = (await terms(alice, server.threadId)).data;
  seller.writes[0].resolve({saved: true}); await flush(); assert.equal(seller.reads.length, 2); seller.respond(1, acceptedData); await flush(); assert.match(text(seller.render()), /Agreement recorded/); assert.equal(seller.notifications.length, 1); assert.match(seller.notifications[0], /No payment, transfer/);
  assert.ok(!children(seller.render()).some(node => node.type === 'button' && /Accept terms|Decline|Cancel my proposal/.test(text(node)))); seller.cleanup();
  const buyer = fixture(); buyer.respond(0, buyerData); await flush(); const cancel = children(buyer.render()).find(node => node.type === 'button' && text(node).includes('Cancel my proposal')); assert.ok(cancel); cancel.props.onClick(); await flush(); assert.deepEqual(buyer.writes[0].body, {action: 'trade_terms_decision', proposalId: server.proposalId, decision: 'cancel', expectedVersion: 0});
  buyer.cleanup(); buyer.writes[0].resolve({saved: true}); await flush(); assert.equal(buyer.reads.length, 1); assert.equal(buyer.notifications.length, 0);
  const race = fixture(); race.respond(0, sellerData); await flush(); const refresh = () => children(race.render()).find(node => node.type === 'button' && node.props['aria-label'] === 'Refresh private trade terms').props.onClick(); refresh(); refresh();
  assert.equal(race.reads.length, 3); race.respond(2, acceptedData); await flush(); race.respond(1, sellerData); await flush(); assert.equal(race.state[0].data.proposals[0].status, 'accepted'); assert.equal(race.state[1], false);
  refresh(); refresh(); race.respond(4, acceptedData); await flush(); race.respond(3, {error: 'Obsolete read failure'}, 404); await flush(); assert.equal(race.state[0].error, ''); assert.equal(race.state[0].data.proposals[0].status, 'accepted'); race.cleanup();
  const networkSource = await clientSource('app/network.tsx', 'CollectorNetwork'); let mounted = false; function inspect(node) {if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(networkSource.ast) === 'TradeTerms') {const values = Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute).map(value => [value.name.getText(networkSource.ast), value.initializer?.getText(networkSource.ast)])); assert.equal(values.key, '{threadId}'); assert.equal(values.threadId, '{threadId}'); mounted = true;} ts.forEachChild(node, inspect);} inspect(networkSource.component); assert.equal(mounted, true);
  assert.equal(outbound, 0);
});
await test('Actual My Profile navigation cancels an outstanding peer response and archived direct calls land on Upcoming', async () => {
  const hubSource = await clientSource('app/hub.tsx', 'Hub'), networkSource = await clientSource('app/network.tsx', 'CollectorNetwork');
  const go = hubSource.functions.find(value => value.startsWith('function go(')), profileFunctions = networkSource.functions.filter(value => /^(async )?function (selectProfile|loadProfile)\(/.test(value)); assert.ok(go); assert.equal(profileFunctions.length, 2);
  const ownEffect = networkSource.effects.find(value => value.includes('selectProfile(null)') && !value.includes("tab!==")); assert.ok(ownEffect);
  const values = {tab: 'Home', profile: null, loading: false, nonce: 0}, pending = []; const globals = {...navigation, Error, Promise, encodeURIComponent, isOwner: false, detailRequest: {current: 0}, profileRequest: {current: 0}, currentProfileSelection: {current: ''},
    window: {scrollTo() {}, matchMedia: () => ({matches: true})}, setDetail() {}, setMarketIssue() {}, setQuery() {}, setPublisher() {}, setEra() {}, setKind() {}, setPage() {}, notice() {}, setMyProfileRequest: value => values.nonce = value(values.nonce), setTab: value => values.tab = value, setProfile: value => values.profile = value, setProfileLoading: value => values.loading = value,
    fetch: url => new Promise(resolve => pending.push({url, resolve}))}; const context = vm.createContext(globals); vm.runInContext(compile(go + '\n' + profileFunctions.join('\n') + '\nglobalThis.ownIntent=' + ownEffect), context);
  const read = context.loadProfile('other_collector'); assert.equal(values.tab, 'Collectors'); context.go('My Profile'); context.ownIntent(); pending[0].resolve({ok: true, json: async () => ({id: 'other-profile', handle: 'other_collector'})}); await read;
  assert.equal(values.nonce, 1); assert.equal(values.profile, null); assert.equal(values.loading, false); assert.equal(values.tab, 'Collectors');
  for (const value of ['Community', 'FMV', 'GrailMatch']) {context.go(value); assert.equal(values.tab, 'Upcoming');}
});
await test('Scanner accepts bounded local image formats and barcode/text hints without asserting comic identity', async () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) assert.equal(scanHelpers.safeScanImage({type, size: 10 * 1024 * 1024}), true);
  for (const file of [{type: 'image/svg+xml', size: 100}, {type: 'text/html', size: 100}, {type: 'image/png', size: 0}, {type: 'image/png', size: Infinity}, {type: 'image/png', size: 10 * 1024 * 1024 + 1}]) assert.equal(scanHelpers.safeScanImage(file), false);
  assert.equal(scanHelpers.scanSearchText('  Saga\n #1\t '), 'Saga #1'); assert.equal(scanHelpers.scanSearchText('x'.repeat(200)).length, 160); assert.equal(scanHelpers.recognizedBarcode('012345678901'), '012345678901'); for (const value of ['abc', '123', 'http://evil.test', '1234567890123456789']) assert.equal(scanHelpers.recognizedBarcode(value), null);
});
await test('Scanner late camera permission cannot reopen an uploaded image or keep its obsolete media stream', async () => {
  const fixture = scannerFixture(); await fixture.flush(); await fixture.click('Start camera'); assert.equal(fixture.calls.cameras[0].options.audio, false);
  await fixture.upload({type: 'image/jpeg', size: 500}); const chosen = fixture.calls.urls.at(-1).url, stale = fixture.stream(); fixture.calls.cameras[0].resolve(stale); await fixture.flush();
  assert.equal(stale.track.stops, 1); assert.equal(fixture.find(node => node.type === 'video'), undefined); assert.equal(fixture.find(node => node.type === 'img').props.src, chosen); assert.equal(fixture.calls.collected.length, 0);
  await fixture.click('Start camera'); const abandoned = fixture.stream(); fixture.unmount(); fixture.calls.cameras[1].resolve(abandoned); await fixture.flush(); assert.equal(abandoned.track.stops, 1);
});
await test('Scanner capture bounds the guided canvas and ignores an obsolete toBlob completion', async () => {
  const fixture = scannerFixture({deferBlob: true}), live = await scannerCamera(fixture); fixture.video.videoWidth = 2000; fixture.video.videoHeight = 3000;
  await fixture.click('Use this frame'); assert.equal(fixture.calls.blobs.length, 1); assert.equal(Math.max(fixture.calls.blobs[0].canvas.width, fixture.calls.blobs[0].canvas.height), 1200); assert.equal(fixture.calls.blobs[0].mime, 'image/jpeg');
  await fixture.upload({type: 'image/png', size: 500}); const chosen = fixture.calls.urls.at(-1).url; fixture.calls.blobs[0].callback({type: 'image/jpeg'}); await fixture.flush(); assert.equal(fixture.find(node => node.type === 'img').props.src, chosen); assert.equal(live.track.stops, 1); assert.equal(fixture.calls.collected.length, 0); fixture.unmount();
});
await test('Local detector output only sets a search hint and never chooses, grades or saves a comic', async () => {
  const fixture = scannerFixture(); await scannerDetector(fixture); fixture.calls.detections[0].resolve([{rawValue: '012345678901'}]); await fixture.flush();
  assert.equal(scannerPicker(fixture).props.initialQuery, '012345678901'); assert.equal(scannerPicker(fixture).props.value, null); assert.match(fixture.status(), /confirm title, year, variant and printing/); assert.equal(fixture.calls.collected.length, 0); assert.equal(outbound, 0);
  delete fixture.context.window.BarcodeDetector; await fixture.click('Read barcode / text'); assert.match(fixture.status(), /No readable barcode or text/); assert.equal(fixture.calls.collected.length, 0); fixture.unmount();
});
await test('A newer manual scan choice survives obsolete local detection and only explicit confirmation invokes collection', async () => {
  const fixture = scannerFixture(); await scannerDetector(fixture); await fixture.click('Search directory manually'); scannerPicker(fixture).props.onChange(catalog[10]); await fixture.flush(); fixture.calls.detections[0].resolve([{rawValue: '012345678901'}]); await fixture.flush();
  assert.equal(fixture.calls.collected.length, 0); assert.ok(fixture.button('Confirm & add')); await fixture.click('Confirm & add'); await fixture.waitFor(() => fixture.calls.closed === 1, 'Real catalog confirmation'); assert.equal(fixture.calls.closed, 1); assert.equal(fixture.calls.collected.length, 1); assert.equal(fixture.calls.collected[0].id, 10); fixture.unmount();
});
await test('Scanner unmount stops live tracks, suppresses detector results and revokes the local preview URL', async () => {
  const fixture = scannerFixture(); await scannerDetector(fixture); const preview = fixture.calls.urls.at(-1).url, before = fixture.snapshot(); fixture.unmount(); fixture.calls.detections[0].resolve([{rawValue: '012345678901'}]); await fixture.flush();
  assert.equal(fixture.snapshot(), before); assert.ok(fixture.calls.revoked.includes(preview)); assert.equal(fixture.calls.collected.length, 0);
  const camera = scannerFixture(), live = await scannerCamera(camera); camera.unmount(); assert.equal(live.track.stops, 1); assert.equal(camera.calls.timers.filter(value => !value.cancelled).length, 0);
});
await test('Actual scanner initial markup explains finite automatic recognition and device-only photos before confirmation', async () => {
  const component = (await load('app/scan-comic.tsx')).default, html = renderToStaticMarkup(React.createElement(component, {onOpen() {}, onCollect() {}, onClose() {}}));
  assert.match(html, /match appears automatically/); assert.match(html, /Photos and camera frames stay on your device/); assert.match(html, /Local reference coverage: 6 covers/); assert.match(html, /No confident match means unknown/); assert.ok(!html.includes('Confirm &amp; add')); assert.ok(!html.includes('type="password"')); assert.equal(outbound, 0);
});
await test('Real JPEG recognition, actual catalog API and conditional vault save create one explicitly confirmed owned copy', async () => {
  await profile(alice); let saved; const confirmed = [];
  const fixture = scannerFixture({pixels: decodeCover('public/covers/planet-12.jpg'), props: {onCollect: issue => {confirmed.push(issue); saved = save(alice, [book('scanner-confirmed-copy', issue, {price: 0})]);}}});
  await fixture.flush(); await fixture.upload({type: 'image/jpeg', size: 500}); assert.equal(confirmed.length, 0); assert.equal(sqlite.prepare('SELECT count(*) n FROM collections').get().n, 0);
  await fixture.waitFor(() => fixture.status().includes('Recognized Planet Comics #12'), 'Real directory recognition'); assert.match(fixture.status(), /Recognized Planet Comics #12/); await fixture.click('Confirm & add'); await fixture.waitFor(() => !!saved, 'Real owned-copy callback'); await saved; assert.equal(confirmed.length, 1);
  const stored = (await call(vault, 'GET', alice)).data.books; assert.equal(stored.length, 1); assert.equal(stored[0].catalogId, 24); assert.equal(stored[0].issue, '#12'); assert.equal(stored[0].id, 'scanner-confirmed-copy'); assert.equal(outbound, 0); fixture.unmount();
});
await test('Actual compact Directory click opens Hub details and saves private ownership through D1 with exact replay protection',async()=>{
  const p=await profile(alice);await profile(bob);const issue=catalog[24],helpers=await load('lib/collection-entry.ts');
  const hubSource=await clientSource('app/hub.tsx','Hub');
  const collectCode=hubSource.functions.find(code=>code.startsWith('async function collect('));assert.ok(collectCode);
  const openCode=hubSource.functions.find(code=>code.startsWith('function openDirectoryIssue('));assert.ok(openCode);
  let writes=0;const notices=[],context=vm.createContext({Error,Promise,crypto:webcrypto,catalog,issue,issueIdentity:shared.issueIdentity,
    ...helpers,directoryRecords:{current:new Map()},detailRequest:{current:0},sharedDetail:null,detail:null,detailState:'',setDetailState:value=>context.detailState=value,saving:false,signedIn:true,
    net:{ready:true,error:null},activeDirectoryCounts:{24:2},setSharedDetail:value=>context.sharedDetail=value,setDetail:value=>context.detail=value,setDrawer(){},
    vault:empty,gate:()=>true,setNotice:value=>notices.push(value),commit:async draft=>{
      writes++;const current=await call(vault,'GET',alice),result=await call(vault,'POST',alice,draft,'',{'If-Match':current.etag});
      if(result.status!==200)return false;context.vault=plain(draft);return true;
    }});
  vm.runInContext(compile(collectCode+'\n'+openCode+'\nglobalThis.openFromDirectory=openDirectoryIssue;'),context);
  const directory=createScannerFixture({componentFile:'app/shared-directory.tsx',props:{onOpen:context.openFromDirectory,ownedIds:[],wantedIds:[],saving:false},
    fetcher:url=>catalogApi.GET(new Request('https://comichuddle.test'+url))});
  await directory.flush();directory.find(node=>typeof node.type==='function'&&node.type.name==='ComicPicker').props.onQueryChange('Planet Comics #12');
  await directory.flush();await directory.advance(300);await directory.waitFor(()=>directory.nodes().some(node=>typeof node.type==='function'&&node.type.name==='DirectoryIssueCard'&&node.props.issue.id===24),'Actual filtered Directory page');
  const compact=directory.find(node=>typeof node.type==='function'&&node.type.name==='DirectoryIssueCard'&&node.props.issue.id===24),tile=createScannerFixture({componentFile:'app/shared-directory.tsx',componentLocal:'DirectoryIssueCard',props:compact.props});
  await tile.flush();assert.ok(!tile.snapshot().includes(issue.note));await tile.click('More info');assert.equal(context.detail,24);assert.equal(context.sharedDetail.id,24);
  const props=actualHubDetailCard(hubSource,context);assert.equal(props.comic.id,'24');assert.equal(props.comic.activeListingCount,2);
  const f=createScannerFixture({componentFile:'architecture/postgres/ui/ComicProductCard.tsx',props});
  await f.flush();assert.ok(f.snapshot().includes(issue.note));assert.ok(f.snapshot().includes(issue.variant));assert.ok(f.snapshot().includes(issue.writer));
  await f.flush();await f.click('Add to Collection');await f.find(node=>node.type==='form').props.onSubmit({preventDefault(){},currentTarget:{
    rawCondition:'FINE',purchasePrice:'87654.32',acquiredOn:'2026-10-12',notes:'PRIVATE_OWNER_NOTES_FROM_CARD'}});await f.flush();
  assert.equal(writes,1);const stored=(await call(vault,'GET',alice)).data.books;assert.equal(stored.length,1);assert.equal(stored[0].catalogId,24);
  assert.equal(stored[0].ownership.purchasePriceCents,'8765432');assert.equal(stored[0].ownership.acquiredOn,'2026-10-12');assert.equal(stored[0].ownership.notes,'PRIVATE_OWNER_NOTES_FROM_CARD');
  await props.onAddToCollection(String(issue.id),stored[0].ownership,stored[0].id);assert.equal(writes,1);assert.equal((await call(vault,'GET',alice)).data.books.length,1);
  await assert.rejects(()=>props.onAddToCollection(String(issue.id),{...stored[0].ownership,notes:'CHANGED_RETRY_NOTE'},stored[0].id),/not saved/);
  await assert.rejects(()=>props.onAddToCollection('25',stored[0].ownership,webcrypto.randomUUID()),/selected issue changed/);assert.equal(writes,1);
  await profile(alice,{featured:[stored[0].id]});const publicProfile=(await call(social,'GET',bob,null,'?kind=profile&handle='+p.handle)).data;
  assert.equal(publicProfile.showcase[0].ownership,undefined);assert.equal(publicProfile.showcase[0].price,undefined);
  assert.ok(!JSON.stringify(publicProfile).includes('PRIVATE_OWNER_NOTES_FROM_CARD'));assert.ok(!JSON.stringify(publicProfile).includes('8765432'));
  const dto=(await listing(bob,await createListing(alice,[stored[0].id]))).data;assert.equal(dto.items[0].ownership,undefined);assert.ok(!JSON.stringify(dto).includes('PRIVATE_OWNER_NOTES_FROM_CARD'));
  assert.equal(outbound,0);f.unmount();tile.unmount();directory.unmount();
});
await test('GCD and Metron with identical provider IDs and labels remain distinct through real catalog, vault and exact marketplace routes',async()=>{
  await profile(alice);await profile(bob);const records=await namespaceCatalog();
  const response=await call(catalogApi,'GET',null,null,'?q=Namespace%20Series%20%231&publisher=Namespace%20Press&limit=12');
  assert.equal(response.status,200,JSON.stringify(response.data));assert.equal(response.data.issueCount,45);
  assert.equal(response.data.syncedIssueCount,1);assert.equal(response.data.gcdIssueCount,1);assert.equal(response.data.scope,'shared');
  const parsed=(await load('lib/catalog-picker-client.ts')).parseCatalogSearchPage(response.data);
  assert.deepEqual(plain(parsed.issues.map(issue=>issue.id)),[1000000050,4000000050]);
  assert.equal(parsed.issues[0].title,parsed.issues[1].title);assert.equal(parsed.issues[0].number,parsed.issues[1].number);
  const exact=await call(catalogApi,'GET',null,null,'?id=4000000050');assert.equal(exact.status,200);assert.equal(exact.data.issues[0].gcdId,50);
  assert.equal(exact.data.issues[0].metronId,undefined);assert.equal(exact.data.issues[0].cover,undefined);
  assert.ok(!JSON.stringify(exact.data).includes('DO_NOT_IMPORT_IMAGE'));assert.equal(exact.data.issues[0].price,undefined);assert.equal(exact.data.issues[0].fmv,undefined);
  assert.equal(exact.data.issues[0].bibliography.originalCoverPrice.kind,'ORIGINAL_COVER_PRICE');assert.equal(exact.data.issues[0].bibliography.originalCoverPrice.text,'3.99 USD');
  assert.equal(exact.data.issues[0].bibliography.stories[0].synopsis,'Synthetic source synopsis retained in issue details.');
  assert.equal(response.data.issues[1].bibliography,undefined,'Full bibliography must load only after exact detail selection');
  const identity=plain(shared.issueIdentity(records.gcd));assert.deepEqual(identity,{externalCatalog:{provider:'GCD',id:50,sourceUrl:'https://www.comics.org/issue/50/',license:'CC BY-SA 4.0'}});
  assert.equal(shared.sharedProviderIdentity(4000000000),null);assert.equal(shared.sharedProviderIdentity(3147483648),null);
  assert.equal(shared.sharedProviderIdentity(6147483647).id,2147483647);assert.equal(shared.sharedProviderIdentity(3147483647).provider,'Metron');
  await save(alice,[book('gcd-namespace-copy',records.gcd,{...identity,title:'Edited title must not override the indexed edition',issue:'#999'}),
    book('metron-namespace-copy',records.metron,plain(shared.issueIdentity(records.metron)))]);
  const stored=(await call(vault,'GET',alice)).data;assert.equal(stored.books[0].title,records.gcd.title);assert.equal(stored.books[0].issue,'#1');
  assert.equal(stored.books[0].catalogId,undefined);assert.equal(stored.books[0].externalCatalog.provider,'GCD');
  const invalid=[{...stored,books:[{...stored.books[0],externalCatalog:{...identity.externalCatalog,sourceUrl:'https://metron.cloud/issue/50/'}}]},
    {...stored,books:[{...stored.books[0],catalogId:4000000050}]},{...stored,wants:[4000000051]},
    {...stored,books:[{...stored.books[0],externalCatalog:{provider:'GCD',id:51,sourceUrl:'https://www.comics.org/issue/51/',license:'CC BY-SA 4.0'}}]}];
  const before=JSON.stringify(stored);for(const draft of invalid){const current=await call(vault,'GET',alice);assert.equal((await call(vault,'POST',alice,draft,'',{'If-Match':current.etag})).status,400);}
  assert.equal(JSON.stringify((await call(vault,'GET',alice)).data),before);
  const gcdListing=(await listing(bob,await createListing(alice,['gcd-namespace-copy']))).data,
    metronListing=(await listing(bob,await createListing(alice,['metron-namespace-copy']))).data;
  assert.equal(gcdListing.issueId,4000000050,'GCD listing header crossed provider namespaces');
  assert.ok(gcdListing.items[0].externalCatalog,'Public GCD listing lost its exact source identity');
  const filters={query:'',category:'All',delivery:'All',city:'',state:'',issueId:4000000050};
  assert.equal(matcherContext.matchesMarketplaceListing(gcdListing,filters),true);assert.equal(matcherContext.matchesMarketplaceListing(metronListing,filters),false);
  assert.equal(matcherContext.matchesMarketplaceListing(gcdListing,{...filters,issueId:1000000050}),false);
  assert.equal(gcdListing.items[0].externalCatalog.provider,'GCD');assert.equal(gcdListing.items[0].catalogId,undefined);assert.equal(outbound,0);
});
await test('First real importer write retains all43 starter identities, searches, compact clicks and preexisting owned links',async()=>{
  await profile(alice);await save(alice,[book('starter-owned-before-gcd',catalog[0])]);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM catalog_issues').get().n,0);
  const before=(await call(vault,'GET',alice)).data,core=await load('lib/gcd-sync.ts'),stamp=Date.parse('2026-10-13T12:00:00.000Z'),requests=[];
  const raw={api_url:'https://www.comics.org/api/issue/50/',series:'https://www.comics.org/api/series/7/',series_name:'First imported GCD Series',
    number:'1',key_date:'2026-00-00',indicia_publisher:'Namespace Press',story_set:[]};
  const status=await core.gcdSyncStep(database,'daily',{}, {now:()=>stamp,fetcher:async(url,options)=>{
    const parsed=new URL(url);assert.equal(parsed.origin,'https://www.comics.org');requests.push({url,options});
    if(parsed.pathname==='/api/issue/50/')return Response.json(raw);
    assert.match(parsed.pathname,/^\/api\/issue\/on_sale_weekly\/2026\/week\/(41|42)\/$/);
    return Response.json({count:parsed.pathname.endsWith('/42/')?1:0,next:null,previous:null,
      results:parsed.pathname.endsWith('/42/')?[{api_url:raw.api_url,series:raw.series}]:[]});
  }});
  assert.equal(status.importedIssueCount,1);assert.equal(requests.length,3);assert.equal(status.daily.stage,'complete');
  assert.equal(sqlite.prepare('SELECT count(*) n FROM catalog_issues').get().n,44);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM catalog_issues WHERE gcd_id IS NULL AND metron_id IS NULL').get().n,43);
  const overview=await call(catalogApi,'GET',null,null,'?limit=12');assert.equal(overview.data.issueCount,44);assert.equal(overview.data.gcdIssueCount,1);
  const starter=await call(catalogApi,'GET',null,null,'?q=Amazing%20Spider-Man%20%23300&publisher=Marvel&limit=12');
  assert.equal(starter.status,200);assert.equal(starter.data.total,1);assert.equal(starter.data.issues[0].id,0);
  for(const id of [0,24,42,4000000050]){const exact=await call(catalogApi,'GET',null,null,'?id='+id);assert.equal(exact.status,200);assert.equal(exact.data.issues[0].id,id);}
  assert.deepEqual((await call(vault,'GET',alice)).data,before);assert.equal(before.books[0].catalogId,0);
  const opened=[],directory=createScannerFixture({componentFile:'app/shared-directory.tsx',props:{onOpen:record=>opened.push(record),ownedIds:[0],wantedIds:[],saving:false},
    fetcher:url=>catalogApi.GET(new Request('https://comichuddle.test'+url))});
  await directory.waitFor(()=>directory.nodes().some(node=>typeof node.type==='function'&&node.type.name==='DirectoryIssueCard'&&node.props.issue.id===0),'Seeded starter compact card');
  const props=directory.find(node=>typeof node.type==='function'&&node.type.name==='DirectoryIssueCard'&&node.props.issue.id===0).props,
    tile=createScannerFixture({componentFile:'app/shared-directory.tsx',componentLocal:'DirectoryIssueCard',props});
  await tile.flush();await tile.click('More info');assert.equal(opened[0].id,0);assert.equal(opened[0].title,before.books[0].title);
  tile.unmount();directory.unmount();assert.equal(outbound,0);
});
await test('GCD listings work without a Metron counterpart and the real SQL race guard watches only the selected canonical provider',async()=>{
  await profile(alice);await profile(bob);const records=await namespaceCatalog();
  sqlite.prepare('DELETE FROM catalog_issues WHERE metron_id=50').run();
  await save(alice,['gcd-alone','gcd-unrelated-race','gcd-selected-race'].map(id=>book(id,records.gcd)));
  const alone=(await listing(bob,await createListing(alice,['gcd-alone']))).data;
  assert.equal(alone.issueId,4000000050);assert.equal(alone.items[0].externalCatalog.provider,'GCD');
  await namespaceCatalog();const photo=await upload(alice),request=bookId=>({action:'listing',kind:'single',saleType:'fixed',bookIds:[bookId],
    description:'My exact GCD copy.',price:2500,shipping:800,photos:[photo],attest:true,usaAttest:true});
  let fired=false;beforeBatch=statements=>{if(!statements.some(statement=>/insert\s+into\s+["`]?listings/i.test(statement.sql)))return;
    beforeBatch=null;fired=true;sqlite.prepare('UPDATE catalog_issues SET title=? WHERE metron_id=50').run('Unrelated provider changed');};
  const unrelated=await call(social,'POST',alice,request('gcd-unrelated-race'));assert.equal(fired,true);assert.equal(unrelated.status,200,JSON.stringify(unrelated.data));
  assert.equal((await listing(bob,unrelated.data.listingId)).data.issueId,4000000050);
  const before=domainSnapshot();fired=false;beforeBatch=statements=>{if(!statements.some(statement=>/insert\s+into\s+["`]?listings/i.test(statement.sql)))return;
    beforeBatch=null;fired=true;sqlite.prepare('UPDATE catalog_issues SET title=? WHERE gcd_id=50').run('Selected GCD edition changed');};
  const raced=await call(social,'POST',alice,request('gcd-selected-race'));assert.equal(fired,true);assert.equal(raced.status,409,JSON.stringify(raced.data));
  assert.deepEqual(domainSnapshot(),before);assert.equal(sqlite.prepare('SELECT count(*) n FROM listing_inventory WHERE book_id=?').get('gcd-selected-race').n,0);assert.equal(outbound,0);
});
await test('Imported GCD compact click preserves exact CGC copy identity and private metadata through actual Hub save and ownership editing',async()=>{
  const profileRecord=await profile(alice);await profile(bob);const records=await namespaceCatalog(),helpers=await load('lib/collection-entry.ts'),source=await clientSource('app/hub.tsx','Hub');
  const functions=source.functions.filter(code=>code.startsWith('async function collect(')||code.startsWith('function openDirectoryIssue(')||code.startsWith('function go('));assert.equal(functions.length,3);
  let writes=0;const values={marketIssue:null,tab:'Directory'},context=vm.createContext({...navigation,Error,Promise,crypto:webcrypto,catalog,...helpers,
    issueIdentity:shared.issueIdentity,directoryRecords:{current:new Map()},detailRequest:{current:0},sharedDetail:null,detail:null,detailState:'',setDetailState:value=>context.detailState=value,
    parseCatalogSearchPage:catalogPickerClient.parseCatalogSearchPage,fetch:url=>catalogApi.GET(new Request('https://comichuddle.test'+url)),
    vault:empty,saving:false,signedIn:true,isOwner:false,net:{ready:false,error:null},activeDirectoryCounts:{},gate:()=>true,setNotice(){},
    setSharedDetail:value=>context.sharedDetail=value,setDetail:value=>context.detail=value,setDrawer(){},setMyProfileRequest(){},setTab:value=>values.tab=value,
    setMarketIssue:value=>values.marketIssue=value,setQuery(){},setPublisher(){},setEra(){},setKind(){},setPage(){},window:{scrollTo(){},matchMedia:()=>({matches:true})},
    commit:async draft=>{const current=await call(vault,'GET',alice),result=await call(vault,'POST',alice,draft,'',{'If-Match':current.etag});if(result.status!==200)return false;writes++;context.vault=plain(draft);return true;}});
  vm.runInContext(compile(functions.join('\n')+'\nglobalThis.openFromDirectory=openDirectoryIssue;'),context);
  const directory=createScannerFixture({componentFile:'app/shared-directory.tsx',props:{onOpen:context.openFromDirectory,ownedIds:[],wantedIds:[],saving:false},
    fetcher:url=>catalogApi.GET(new Request('https://comichuddle.test'+url))});
  await directory.flush();directory.find(node=>typeof node.type==='function'&&node.type.name==='ComicPicker').props.onQueryChange('Namespace Series #1');await directory.flush();await directory.advance(300);
  await directory.waitFor(()=>directory.nodes().some(node=>typeof node.type==='function'&&node.type.name==='DirectoryIssueCard'&&node.props.issue.id===4000000050),'GCD compact record');
  const tileProps=directory.find(node=>typeof node.type==='function'&&node.type.name==='DirectoryIssueCard'&&node.props.issue.id===4000000050).props,
    tile=createScannerFixture({componentFile:'app/shared-directory.tsx',componentLocal:'DirectoryIssueCard',props:tileProps});
  await tile.flush();await tile.click('More info');assert.equal(context.detail,4000000050);assert.equal(context.sharedDetail.gcdId,50);
  const props=actualHubDetailCard(source,context),card=createScannerFixture({componentFile:'architecture/postgres/ui/ComicProductCard.tsx',props});
  await card.flush();assert.match(card.snapshot(),/Grand Comics Database/);assert.match(card.snapshot(),/Exact GCD printing record/);
  await card.click('CGC 9.8 FMV');assert.match(card.snapshot(),/Coming soon/);assert.ok(!card.snapshot().includes('$0.00'));await card.click('Add to Collection');
  card.find(node=>node.type==='select'&&node.props.name==='format').props.onChange({target:{value:'GRADED'}});await card.flush();
  await card.find(node=>node.type==='form').props.onSubmit({preventDefault(){},currentTarget:{grade:'9.6',labelType:'Restored',certificationNumber:'9876543210987654321',
    purchasePrice:'12.34',acquiredOn:'2026-10-12',notes:'GCD_PRIVATE_OWNER_NOTE'}});await card.flush();assert.equal(writes,1);
  const owned=(await call(vault,'GET',alice)).data,copy=owned.books[0];assert.equal(copy.externalCatalog.provider,'GCD');assert.equal(copy.externalCatalog.id,50);
  assert.equal(copy.catalogId,undefined);assert.equal(copy.grade,'CGC 9.6 Restored');assert.equal(copy.ownership.purchasePriceCents,'1234');
  let edited=0;const editor=createScannerFixture({componentFile:'app/add-comic.tsx',componentExport:'OwnedComicForm',props:{vault:owned,bookId:copy.id,saving:false,listed:false,onSaved:()=>edited++,
    commit:async draft=>{const current=await call(vault,'GET',alice);return(await call(vault,'POST',alice,draft,'',{'If-Match':current.etag})).status===200;}},
    fetcher:url=>catalogApi.GET(new Request('https://comichuddle.test'+url))});
  await editor.waitFor(()=>editor.nodes().some(node=>typeof node.type==='function'&&node.type.name==='ComicPicker'&&node.props.value?.id===4000000050),'Exact GCD ownership editor lookup');
  assert.equal(editor.calls.requests[0].url,'/api/catalog?id=4000000050');
  await editor.find(node=>node.type==='form').props.onSubmit({preventDefault(){},currentTarget:{grade:'9.8',labelType:'Universal',certificationNumber:'9876543210987654321',
    purchasePrice:'12.34',acquiredOn:'2026-10-12',notes:'GCD_PRIVATE_OWNER_NOTE',price:'0'}});await editor.flush();assert.equal(edited,1);
  const updated=(await call(vault,'GET',alice)).data.books[0];assert.equal(updated.id,copy.id);assert.equal(updated.externalCatalog.provider,'GCD');assert.equal(updated.externalCatalog.id,50);assert.equal(updated.grade,'CGC 9.8 Universal');
  props.onBuy({preventDefault(){}});assert.equal(values.marketIssue,4000000050);assert.equal(values.tab,'Marketplace');
  await profile(alice,{featured:[copy.id]});const showcase=(await call(social,'GET',bob,null,'?kind=profile&handle='+profileRecord.handle)).data,
    listingDto=(await listing(bob,await createListing(alice,[copy.id]))).data;
  for(const publicData of [showcase,listingDto])for(const secret of ['GCD_PRIVATE_OWNER_NOTE','9876543210987654321','"purchasePriceCents"','"acquiredOn"'])assert.ok(!JSON.stringify(publicData).includes(secret));
  assert.equal(listingDto.issueId,4000000050,'Edited GCD copy was listed under another provider');
  assert.ok(listingDto.items[0].externalCatalog,'Public edited GCD copy lost its exact source identity');
  assert.equal(listingDto.items[0].externalCatalog.provider,'GCD');assert.equal(outbound,0);card.unmount();tile.unmount();directory.unmount();editor.unmount();assert.equal(records.gcd.id,4000000050);
});
await test('Actual OwnedComicForm updates slab ownership and displayed grade together through the conditional vault route',async()=>{
  await profile(alice);const own={format:'RAW',rawCondition:'FINE',gradingCompany:null,grade:null,labelType:null,certificationNumber:null,
    purchasePriceCents:'1234',acquiredOn:'2026-10-12',notes:'PRIVATE_ORIGINAL_NOTES'},helpers=await load('lib/collection-entry.ts');
  const owned=book('owned-metadata-editor',catalog[24],{grade:helpers.collectionGrade(own),ownership:own});await save(alice,[owned]);
  let writes=0,saved=0;const current=(await call(vault,'GET',alice)).data;
  const f=createScannerFixture({componentFile:'app/add-comic.tsx',componentExport:'OwnedComicForm',props:{vault:current,
    bookId:owned.id,saving:false,listed:false,onSaved:()=>saved++,commit:async draft=>{writes++;const etag=(await call(vault,'GET',alice)).etag;
      return(await call(vault,'POST',alice,draft,'',{'If-Match':etag})).status===200;}}});
  await f.flush();f.find(node=>node.type==='select'&&node.props.value==='RAW').props.onChange({target:{value:'GRADED'}});await f.flush();
  const fields={grade:'9.6',labelType:'Restored',certificationNumber:'9876543210123456',purchasePrice:'12.34',acquiredOn:'2026-10-11',notes:'PRIVATE_UPDATED_NOTES',price:'42'};
  await f.find(node=>node.type==='form').props.onSubmit({preventDefault(){},currentTarget:fields});await f.flush();assert.equal(writes,1);assert.equal(saved,1);
  const updated=(await call(vault,'GET',alice)).data.books[0];assert.equal(updated.grade,'CGC 9.6 Restored');assert.equal(updated.ownership.format,'GRADED');
  assert.equal(updated.ownership.rawCondition,null);assert.equal(updated.ownership.grade,'9.6');assert.equal(updated.ownership.labelType,'Restored');
  assert.equal(updated.ownership.certificationNumber,fields.certificationNumber);assert.equal(updated.ownership.notes,fields.notes);
  await f.find(node=>node.type==='form').props.onSubmit({preventDefault(){},currentTarget:{...fields,grade:'9.7'}});await f.flush();assert.equal(writes,1);assert.match(f.status(),/Check the recorded condition/);
  f.setProps({listed:true});await f.flush();await f.find(node=>node.type==='form').props.onSubmit({preventDefault(){},currentTarget:fields});await f.flush();assert.equal(writes,1);assert.match(f.status(),/Withdraw or cancel/);f.unmount();assert.equal(outbound,0);
});
await test('Private slab certification/cost/acquisition/notes never enter public showcases or participant trade snapshots/messages',async()=>{
  const seller=await profile(alice);await profile(bob);const helpers=await load('lib/collection-entry.ts');
  const raw={format:'RAW',rawCondition:'FINE',gradingCompany:null,grade:null,labelType:null,certificationNumber:null,purchasePriceCents:'8765432',acquiredOn:'2026-10-11',notes:'PRIVATE_SELLER_OWNERSHIP'};
  const slab={format:'GRADED',rawCondition:null,gradingCompany:'CGC',grade:'9.8',labelType:'Universal',certificationNumber:'9876543210123456',purchasePriceCents:'6543210',acquiredOn:'2026-10-10',notes:'PRIVATE_BUYER_OWNERSHIP'};
  await save(alice,[book('private-seller-copy',catalog[24],{grade:helpers.collectionGrade(raw),ownership:raw})]);
  await save(bob,[book('private-slab-trade-copy',catalog[10],{grade:helpers.collectionGrade(slab),ownership:slab})]);
  const target=await createListing(alice,['private-seller-copy']),offer=await call(social,'POST',bob,{action:'trade_offer',listingId:target,
    bookIds:['private-slab-trade-copy'],note:'Review these exact editions.',requestId:webcrypto.randomUUID()});assert.equal(offer.status,200,JSON.stringify(offer.data));
  const detail=(await terms(alice,offer.data.threadId)).data,thread=(await call(social,'GET',alice,null,'?kind=messages&thread='+offer.data.threadId)).data;
  const encoded=JSON.stringify({detail,thread});for(const secret of [raw.notes,slab.notes,slab.certificationNumber,raw.purchasePriceCents,slab.purchasePriceCents,raw.acquiredOn,slab.acquiredOn])assert.ok(!encoded.includes(secret),secret);
  for(const line of [...detail.proposals[0].offeredItems,...detail.proposals[0].requestedItems])assert.equal(line.ownership,undefined);
  await profile(bob,{featured:['private-slab-trade-copy']});const peer=(await call(social,'GET',alice,null,'?kind=profile&handle='+bob.userId)).data;
  assert.equal(peer.showcase[0].ownership,undefined);assert.ok(!JSON.stringify(peer).includes(slab.certificationNumber));
  assert.equal((await call(vault,'GET',bob)).data.books[0].ownership.certificationNumber,slab.certificationNumber);assert.equal(outbound,0);assert.ok(seller.id);
});
await test('Actual publisher-tree cleanup discards old responses and emits bounded publisher/series requests', async () => {
  const source = await clientSource('app/directory-tree.tsx', 'DirectoryTree'), read = source.effects.find(value => value.includes("fetch('/api/catalog?'")); assert.ok(read);
  const pending = [], timers = [], values = {search: '', offset: 0, data: null, error: '', loading: false, publisher: 'Marvel'};
  const globals = {Error, Promise, URLSearchParams, AbortController, setTimeout: callback => {const timer = {callback, cancelled: false}; timers.push(timer); return timer;}, clearTimeout: timer => timer.cancelled = true, fetch: (url, options) => new Promise(resolve => pending.push({url, options, resolve}))};
  for (const key of ['search', 'offset', 'data', 'error', 'loading']) globals['set' + key[0].toUpperCase() + key.slice(1)] = value => {values[key] = typeof value === 'function' ? value(values[key]) : value;};
  const context = vm.createContext(globals); vm.runInContext(compile('globalThis.read=function({publisher,search,offset}){return (' + read + ')();}'), context);
  const oldCleanup = context.read(values); timers[0].callback(); assert.equal(pending.length, 1); oldCleanup(); values.publisher = 'Image'; context.read(values); timers[1].callback(); assert.equal(pending.length, 2);
  const query = new URL(pending[1].url, 'https://comichuddle.test').searchParams; assert.equal(query.get('browse'), 'series'); assert.equal(query.get('publisher'), 'Image'); assert.equal(query.get('limit'), '30'); assert.equal(pending[0].options.signal.aborted, true);
  pending[1].resolve({ok: true, json: async () => ({series: [{title: 'Saga', publisher: 'Image', count: 1, firstYear: 2012, lastYear: 2012}], total: 1, offset: 0, limit: 30, hasMore: false})}); await flush(); pending[0].resolve({ok: false, json: async () => ({error: 'Old publisher failed'})}); await flush(); assert.equal(values.data.series[0].title, 'Saga'); assert.equal(values.error, ''); assert.equal(values.loading, false);
});
await test('Actual Hub detail card saves one physical copy and Buy carries its exact identity into the marketplace', async () => {
  await profile(alice); const source = await clientSource('app/hub.tsx', 'Hub'), collect = source.functions.find(value => value.startsWith('async function collect(')), go = source.functions.find(value => value.startsWith('function go(')), open=source.functions.find(value=>value.startsWith('function openDirectoryIssue(')); assert.ok(collect); assert.ok(go);assert.ok(open);
  const helpers=await load('lib/collection-entry.ts');
  const values = {marketIssue: null, tab: 'Directory', saved: null}, globals = {...navigation, crypto: webcrypto, issueIdentity: shared.issueIdentity, catalog, directoryRecords: {current: new Map()}, detailRequest: {current: 0}, vault: empty, isOwner: false, gate: () => true,
    ...helpers,signedIn:false,net:{ready:false,error:null},activeDirectoryCounts:{},saving:false,detailState:'',setDetailState:value=>context.detailState=value,
    setNotice() {},setSharedDetail:value=>context.sharedDetail=value,setDrawer(){},setDetail:value=>context.detail=value,setMyProfileRequest() {}, setMarketIssue: value => values.marketIssue = value, setTab: value => values.tab = value, setQuery() {}, setPublisher() {}, setEra() {}, setKind() {}, setPage() {}, window: {scrollTo() {}, matchMedia: () => ({matches: true})}};
  const context = vm.createContext(globals); context.commit = async draft => {await save(alice, plain(draft.books));context.vault=plain(draft); values.saved = (await call(vault, 'GET', alice)).data; return true;};
  vm.runInContext(compile(go + '\n' + collect+'\n'+open+'\nglobalThis.openFromDirectory=openDirectoryIssue;'), context);
  context.openFromDirectory(catalog[0]);const props=actualHubDetailCard(source,context);
  assert.equal(props.comic.activeListingCount,null);assert.equal(new URL(props.marketplaceHref,'https://comichuddle.test').searchParams.get('issue'),'0');
  const f=createScannerFixture({componentFile:'architecture/postgres/ui/ComicProductCard.tsx',props});await f.flush();await f.click('Add to Collection');
  await f.find(node=>node.type==='form').props.onSubmit({preventDefault(){},currentTarget:{rawCondition:'FINE',purchasePrice:'',acquiredOn:'',notes:''}});await f.flush();
  assert.ok(values.saved); assert.equal(values.saved.books.length, 1); assert.equal(values.saved.books[0].catalogId, 0); assert.equal(values.saved.books[0].title, catalog[0].title); assert.equal(values.saved.books[0].price, 0);
  let prevented=false;f.find(node=>node.type==='a'&&node.props['aria-label']?.startsWith('Find exact copies')).props.onClick({preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(values.marketIssue,0);assert.equal(values.tab,'Marketplace');assert.equal(context.detail,null);assert.equal(context.directoryRecords.current.get(0).id,0);f.unmount();
});
await test('Actual owned-copy explicit Unlisted choice removes external provenance while an automatic fallback preserves it', async () => {
  await profile(alice); const original = {id: 'unlink-physical', title: 'Unindexed legacy book', issue: '#3', grade: 'Raw VF', price: 20, externalCatalog: {provider: 'Metron', id: 900, sourceUrl: 'https://metron.cloud/issue/900/', license: 'CC BY-SA 4.0'}}; await save(alice, [original]);
  const source = await clientSource('app/add-comic.tsx', 'OwnedComicForm'), submit = source.callbacks.find(value => value.name === 'onSubmit'), mode = source.callbacks.find(value => value.name === 'setManual'); assert.ok(submit); assert.ok(mode);
  let current = original, saved = 0; class Inputs {constructor(fields) {this.fields = fields;} get(key) {return this.fields[key] ?? null;}}
  const globals = {FormData: Inputs, issueIdentity: shared.issueIdentity, listed: false, manual: true, selected: null, unlink: false, copy: current, vault: {...empty, books: [current]}, bookId: current.id, linkedLookup: {current: 0}, setError() {}, setSelected() {}, onSaved: () => saved++}; const context = vm.createContext(globals);
  context.setManual = value => context.manual = value; context.setUnlink = value => context.unlink = value; context.commit = async draft => {await save(alice, plain(draft.books)); current = (await call(vault, 'GET', alice)).data.books[0]; context.copy = current; context.vault = {...empty, books: [current]}; return true;};
  vm.runInContext(compile('globalThis.submit=' + submit.code + ';globalThis.chooseMode=' + mode.code), context); const event = {preventDefault() {}, currentTarget: {title: original.title, issue: original.issue, grade: 'Raw VG', price: '10'}};
  await context.submit(event); assert.deepEqual(current.externalCatalog, original.externalCatalog); context.chooseMode(true); await context.submit(event); assert.equal(current.externalCatalog, undefined); assert.equal(current.catalogId, undefined); assert.equal(current.id, original.id); assert.equal(saved, 2);
});
await test('Add-comic close during saving is ignored and Marketplace completion does not reopen the collection drawer', async () => {
  const source = await clientSource('app/hub.tsx', 'Hub'); let dialog;
  function walk(node) {if (ts.isJsxOpeningElement(node) && node.tagName.getText(source.ast) === 'Dialog' && node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source.ast) === 'label' && attribute.initializer?.getText(source.ast) === '"Add comic"')) dialog = node; ts.forEachChild(node, walk);} walk(source.component); assert.ok(dialog);
  const close = dialog.attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.getText(source.ast) === 'onClose').initializer.expression.getText(source.ast), values = {add: true, drawer: false}, context = vm.createContext({saving: true, addOrigin: 'marketplace', setAdd: value => values.add = value, setDrawer: value => values.drawer = value}); vm.runInContext(compile('globalThis.close=' + close), context);
  context.close(); assert.equal(values.add, true); assert.equal(values.drawer, false); context.saving = false; context.close(); assert.equal(values.add, false); assert.equal(values.drawer, false); context.addOrigin = 'collection'; context.close(); assert.equal(values.drawer, true);
});
await test('Profile city input is explicitly public and mobile source provides one bottom menu with hidden upper menus', async () => {
  const source = await readFile('app/network.tsx', 'utf8'); assert.match(source, /Public city and state/); assert.match(source, /Never enter a street address/); assert.ok(source.includes('name="location"'));
  const hub = await readFile('app/hub.tsx', 'utf8'); assert.equal((hub.match(/<MobileDock\s/g) || []).length, 1); assert.equal((hub.match(/className="mobile-nav"/g) || []).length, 0);
  const dock = (await load('app/mobile-dock.tsx')).default, rendered = renderToStaticMarkup(React.createElement(dock, {tab: 'Home', scanOpen: false, onNavigate() {}, onScan() {}})); assert.equal((rendered.match(/<nav\s/g) || []).length, 1); assert.equal((rendered.match(/aria-label="Scan a comic"/g) || []).length, 1);
  const css = await readFile('app/globals.css', 'utf8'); assert.match(css, /\.site-header nav\{display:none/); assert.match(css, /\.mobile-nav\{display:none/); assert.equal(navigation.mobileNavigation.length, 6);
  // This is a source contract, not a rendered viewport assertion.
});

completed = true; sqlite.close(); console.log('\nSketch launch results: ' + passed + ' passed, ' + failures.length + ' failed.');
console.log('Maximum D1 binds: ' + maxBinds + '. Genuine external/provider/payment requests: 0.');
if (failures.length) {console.error(JSON.stringify(failures, null, 2)); process.exitCode = 1;}
