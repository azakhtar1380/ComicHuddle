// Run: node --experimental-vm-modules checks/metron-sync.mjs
// Actual catalog/sync/vault handlers and real SQLite/Drizzle. Synthetic provider
// HTTP, identities and time only; no genuine Metron account or hosted browser.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';

const root = process.cwd(), sqlite = new DatabaseSync(':memory:');
const migrations = (await readdir('drizzle')).filter(name => name.endsWith('.sql')).sort();
for (const name of migrations) sqlite.exec(await readFile(path.join('drizzle', name), 'utf8'));
sqlite.exec('PRAGMA foreign_keys = ON');
let statementsPrepared = 0, maxBinds = 0, failBatch = null, beforeBatch = null, observePrepare = null;
class Statement {
  constructor(sql, params = []) {this.sql = sql; this.params = params;}
  bind(...params) {maxBinds = Math.max(maxBinds, params.length); assert.ok(params.length <= 100, 'D1 parameter limit'); return new Statement(this.sql, params);}
  async raw() {const statement = sqlite.prepare(this.sql); statement.setReturnArrays(true); return statement.all(...this.params);}
  allSync() {return {results: sqlite.prepare(this.sql).all(...this.params), success: true, meta: {}};}
  async all() {return this.allSync();}
  async run() {const result = sqlite.prepare(this.sql).run(...this.params); return {results: [], success: true, meta: {changes: result.changes, last_row_id: Number(result.lastInsertRowid)}};}
}
const db = {
  prepare(sql) {statementsPrepared++; observePrepare?.(sql); return new Statement(sql);},
  async batch(statements) {
    if (beforeBatch) {const hook = beforeBatch; beforeBatch = null; await hook(statements);}
    sqlite.exec('BEGIN');
    try {
      const results = statements.map(statement => {
        if (failBatch && failBatch(statement)) {failBatch = null; throw Error('Synthetic storage failure');}
        return statement.allSync();
      });
      sqlite.exec('COMMIT'); return results;
    } catch (error) {sqlite.exec('ROLLBACK'); throw error;}
  }
};
const TOKEN = 'SYNTHETIC_BUSINESS_TOKEN_NO_PROVIDER_ACCOUNT';
const INITIAL_TIME = Date.parse('2026-10-10T12:00:00.000Z');
let now = INITIAL_TIME, activeUser = null, providerHandler = null, requests = [];
class ServerDate extends Date {constructor(...args) {super(...(args.length ? args : [now]));} static now() {return now;}}
const objects = new Map(), bucket = {
  async put(id, value) {objects.set(id, new Uint8Array(value));},
  async delete(ids) {for (const id of typeof ids === 'string' ? [ids] : ids) objects.delete(id);},
  async get(id) {return objects.has(id) ? {body: objects.get(id)} : null;}
};
const env = {DB: db, BUCKET: bucket, METRON_API_TOKEN: TOKEN, METRON_SYNC_ENABLED: 'true'};
async function providerFetch(url, options) {
  const parsed = new URL(url), headers = new Headers(options?.headers);
  requests.push({url: parsed.href, authorization: headers.get('Authorization'), accept: headers.get('Accept'), redirect: options?.redirect});
  assert.equal(parsed.origin, 'https://metron.cloud');
  assert.equal(headers.get('Authorization'), 'Bearer ' + env.METRON_API_TOKEN);
  assert.equal(headers.get('Accept'), 'application/json');
  assert.equal(options?.redirect, 'error');
  assert.ok(providerHandler, 'Unexpected provider request');
  return providerHandler(parsed, options);
}
const context = vm.createContext({console, crypto: webcrypto, Request, Response, Headers, URL, URLSearchParams,
  TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, Error, Date: ServerDate, AbortController, ReadableStream,
  setTimeout, clearTimeout, setInterval, clearInterval, fetch: providerFetch});
const cache = new Map();
function synthetic(id, exports) {return new vm.SyntheticModule(Object.keys(exports), function () {for (const [key, value] of Object.entries(exports)) this.setExport(key, value);}, {context, identifier: id});}
async function moduleFor(specifier, parent = '') {
  if (specifier === 'cloudflare:workers') {if (!cache.has(specifier)) cache.set(specifier, synthetic(specifier, {env})); return cache.get(specifier);}
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) {if (!cache.has(specifier)) cache.set(specifier, synthetic(specifier, await import(specifier))); return cache.get(specifier);}
  let file = path.resolve(parent ? path.dirname(parent) : root, specifier);
  if (!path.extname(file)) {try {await readFile(file + '.ts'); file += '.ts';} catch {file = path.join(file, 'index.ts');}}
  if (cache.has(file)) return cache.get(file);
  if (file.endsWith('/app/chatgpt-auth.ts')) {const value = synthetic(file, {getChatGPTUser: async () => activeUser}); cache.set(file, value); return value;}
  const code = ts.transpileModule(await readFile(file, 'utf8'), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022}}).outputText;
  const value = new vm.SourceTextModule(code, {context, identifier: file}); cache.set(file, value); return value;
}
async function load(file) {const value = await moduleFor(path.join(root, file)); if (value.status === 'unlinked') await value.link((specifier, parent) => moduleFor(specifier, parent.identifier)); if (value.status === 'linked') await value.evaluate(); return value.namespace;}
const syncRoute = await load('app/api/catalog-sync/route.ts'), catalogRoute = await load('app/api/catalog/route.ts');
const vault = await load('app/api/vault/route.ts'), social = await load('app/api/social/route.ts');
const store = await load('lib/catalog-store.ts'), sync = await load('lib/metron-sync.ts');
const shared = await load('lib/shared-catalog.ts'), database = (await load('db/index.ts')).getDb();
const owner = {userId: 'd185d22d-62d4-475e-87ac-fa2039a5d360', email: 'owner@example.test', displayName: 'Synthetic owner'};
const collector = {userId: 'central_collector', email: 'collector@example.test', displayName: 'Synthetic collector'};
const other = {userId: 'central_other', email: 'other@example.test', displayName: 'Other collector'};
const plain = value => JSON.parse(JSON.stringify(value));
const emptyVault = {profile: 'Synthetic collector', books: [], wants: [], posts: [], likes: [], tradeBookIds: [], clubs: [], watchlist: [], tradeDrafts: []};
const state = () => {const row = sqlite.prepare('SELECT * FROM catalog_sync WHERE id=?').get('metron'); return row ? {...row, value: JSON.parse(row.state)} : null;};
const issueCount = () => Number(sqlite.prepare('SELECT count(*) n FROM catalog_issues WHERE metron_id IS NOT NULL').get().n);
function reset() {
  sqlite.exec('PRAGMA foreign_keys = OFF');
  for (const {name} of sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {assert.match(name, /^[a-z_0-9]+$/); sqlite.exec('DELETE FROM "' + name + '"');}
  sqlite.exec('PRAGMA foreign_keys = ON'); objects.clear(); requests = []; providerHandler = null; now = INITIAL_TIME; activeUser = null; failBatch = null; beforeBatch = null; observePrepare = null;
  env.METRON_API_TOKEN = TOKEN; env.METRON_SYNC_ENABLED = 'true'; delete env.METRON_PRIVATE_SERVICE_ENABLED; delete env.METRON_NIGHTLY_SCHEDULE_ENABLED;
}
async function call(api, method = 'GET', user = owner, body, query = '', options = {}) {
  activeUser = user;
  const headers = new Headers(method === 'POST' ? {'Content-Type': 'application/json', Origin: 'https://comichuddle.test'} : {});
  for (const [key, value] of Object.entries(options.headers || {})) {if (value === null) headers.delete(key); else headers.set(key, value);}
  const response = await api[method](new Request('https://comichuddle.test/api/' + query, {method, headers,
    body: method === 'POST' ? (options.rawBody ?? JSON.stringify(body)) : undefined}));
  let data = null; try {data = await response.json();} catch {}
  return {status: response.status, data, headers: response.headers, etag: response.headers.get('ETag')};
}
const action = (name, scope, options) => call(syncRoute, 'POST', owner, {action: name, ...(scope === undefined ? {} : {scope})}, '', options);
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json', ...headers}});
function record(id, options = {}) {
  return {id, modified: '2026-10-01T08:00:00Z', number: String(id), cover_date: '2020-03-01', store_date: '2020-02-26',
    series: {id: 800, name: '<b>Central Heroes</b>', year_began: 2020, volume: 2}, publisher: {id: 42, name: 'Independent &amp; Co'},
    credits: [{creator: {id: 901, name: '<i>Ada Writer</i>'}, role: [{name: 'Writer'}]}, {creator: {id: 902, name: 'Bea Artist'}, role: [{name: 'Penciller'}, {name: 'Cover'}]}],
    characters: [{name: '<b>Hero</b>'}], desc: '<p>A bibliographic &amp; credited issue.</p>', image: 'https://unlicensed.example.test/cover.jpg', price: 999, ...options};
}
function provider(records, {pageSize = 2, listRecords, listResponse, detailResponse} = {}) {
  const recordsById = new Map(records.map(value => [value.id, value]));
  return async url => {
    const match = url.pathname.match(/^\/api\/issue\/([1-9]\d*)\/$/);
    if (match) {const value = recordsById.get(Number(match[1])); return detailResponse ? detailResponse(value, url) : value ? json(value) : json({detail: 'Not found'}, 404);}
    assert.equal(url.pathname, '/api/issue/');
    const values = listRecords ? listRecords(state()?.value.pass, url) : records;
    const page = Number(url.searchParams.get('page')), pageValues = values.slice((page - 1) * pageSize, page * pageSize);
    const next = page * pageSize < values.length ? new URL(url) : null; if (next) next.searchParams.set('page', String(page + 1));
    const body = {count: values.length, next: next?.href || null, previous: null, results: pageValues.map(value => ({id: value.id, modified: value.modified}))};
    return listResponse ? listResponse(body, url) : json(body);
  };
}
async function start(scope) {const result = await action('start', scope); assert.equal(result.status, 200, JSON.stringify(result.data)); return result;}
async function step() {
  const before = requests.length, checked = state()?.value.checkedRecords || 0, result = await action('step');
  assert.ok(requests.length - before <= 4, 'Step exceeded four external requests');
  assert.ok((state()?.value.checkedRecords || 0) - checked <= 8, 'Step exceeded eight processed records');
  assert.equal(sqlite.prepare('SELECT count(*) n FROM operation_guard').get().n, 0, 'Transient guards leaked');
  return result;
}
async function complete(records, options = {}) {
  providerHandler = provider(records, options); await start(options.scope);
  for (let attempts = 0; attempts < 50; attempts++) {
    const result = await step(); assert.equal(result.status, 200, JSON.stringify(result.data));
    if (result.data.stage === 'complete') return result;
    assert.notEqual(result.data.stage, 'paused', JSON.stringify(result.data)); now += 60000;
  }
  assert.fail('Import did not complete within bounded test steps');
}
async function profile(user = collector) {
  const result = await call(social, 'POST', user, {action: 'profile', handle: user.userId, name: user.displayName, bio: 'Collector', tagline: 'Comics', location: 'Test City', favorite: 'Comics', since: 2020, color: 'red', featured: [], visible: true, dmOpen: true, accept: true});
  assert.equal(result.status, 200, JSON.stringify(result.data));
}
async function save(value, user = collector, etag) {return call(vault, 'POST', user, value, '', {headers: {'If-Match': etag || (await call(vault, 'GET', user)).etag}});}
async function installRecord(value) {await database.batch(store.metronRecordStatements(database, store.normalizeMetronRecord(value, new ServerDate().toISOString(), TOKEN)));}

let passed = 0, completed = false; const failures = [];
process.on('beforeExit', () => {if (!completed) {console.error('Central catalog suite did not finish'); process.exitCode = 1;}});
async function test(name, run) {
  reset(); let timer; console.log('RUN: ' + name);
  try {await Promise.race([run(), new Promise((_, reject) => {timer = setTimeout(() => reject(Error('Case timed out after 20 seconds')), 20000);})]); passed++; console.log('PASS: ' + name);}
  catch (error) {failures.push({name, message: error.message}); console.error('FAIL: ' + name + ' — ' + error.message);}
  finally {clearTimeout(timer);}
}

await test('Schema migration applies through installed breakpoints and individual hosted physical lines', async () => {
  const name = migrations.find(value => value.startsWith('0009_')); assert.ok(name);
  const raw = await readFile(path.join('drizzle', name), 'utf8');
  const check = new DatabaseSync(':memory:');
  try {
    for (const prior of migrations.filter(value => value < name)) check.exec(await readFile(path.join('drizzle', prior), 'utf8'));
    for (const line of raw.split(/\r?\n/).map(value => value.trim()).filter(Boolean)) check.exec(line);
    assert.equal(check.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name LIKE 'catalog_%'").get().n, 7);
  } finally {check.close();}
  const {readMigrationFiles} = await import('drizzle-orm/migrator');
  const migration = readMigrationFiles({migrationsFolder: 'drizzle'}).at(9);
  assert.ok(migration.sql.every(statement => statement.trim()), 'Empty installed migration statement');
});
await test('Starter seed is idempotent and public fallback requires no provider request or account', async () => {
  delete env.METRON_API_TOKEN; delete env.METRON_SYNC_ENABLED;
  const fallback = await call(catalogRoute, 'GET', null); assert.equal(fallback.status, 200); assert.equal(fallback.data.issues.length, 43);
  assert.equal((await action('seed_starter')).status, 200);
  const rows = sqlite.prepare('SELECT id,data,fetched_at FROM catalog_issues ORDER BY id').all(); assert.equal(rows.length, 43);
  now += 60000; assert.equal((await action('seed_starter')).status, 200);
  assert.deepEqual(sqlite.prepare('SELECT id,data,fetched_at FROM catalog_issues ORDER BY id').all(), rows);
  assert.equal((await call(catalogRoute, 'GET', null, null, '?q=Spider-Man%20%23300')).data.issues[0].number, '300'); assert.equal(requests.length, 0);
});
await test('Owner route enforces visitor identity, same-origin writes, strict body and no secret disclosure', async () => {
  for (const [method, user, headers, status] of [['GET', null, {}, 401], ['POST', collector, {}, 403], ['GET', collector, {}, 403], ['POST', owner, {Origin: null}, 403], ['POST', owner, {Origin: 'https://evil.test'}, 403]]) {
    const result = await call(syncRoute, method, user, {action: 'start'}, '', {headers}); assert.equal(result.status, status); assert.ok(!JSON.stringify(result.data).includes(TOKEN));
  }
  for (const [body, query, headers, rawBody, status] of [[{action: 'start', token: TOKEN}, '', {}, undefined, 400], [{action: 'step', scope: {}}, '', {}, undefined, 400], [{action: 'unknown'}, '', {}, undefined, 400], [{action: 'start'}, '?x=1', {}, undefined, 400], [{action: 'start'}, '', {'Content-Type': 'text/plain'}, undefined, 415], [null, '', {}, 'null', 400], [{action: 'start'}, '', {}, 'x'.repeat(4001), 413]]) {
    const result = await call(syncRoute, 'POST', owner, body, query, {headers, rawBody}); assert.equal(result.status, status, JSON.stringify(result.data));
  }
  const status = await call(syncRoute); assert.equal(status.status, 200); assert.match(status.headers.get('Cache-Control'), /no-store/); assert.ok(!JSON.stringify(status.data).includes(TOKEN)); assert.equal(status.data.schedulerEnabled, false);
  env.METRON_NIGHTLY_SCHEDULE_ENABLED = 'true'; assert.equal((await call(syncRoute)).data.schedulerEnabled, true); assert.equal(requests.length, 0);
});
await test('Private service path is explicitly enabled, originless and never overrides a browser or signed-in nonowner', async () => {
  const service = {'x-comichuddle-catalog-run': 'owner-private-service', Origin: null};
  assert.equal((await call(syncRoute, 'POST', null, {action: 'seed_starter'}, '', {headers: service})).status, 401);
  env.METRON_PRIVATE_SERVICE_ENABLED = 'true';
  assert.equal((await call(syncRoute, 'POST', null, {action: 'seed_starter'}, '', {headers: service})).status, 200);
  assert.equal((await call(syncRoute, 'POST', null, {action: 'start'}, '', {headers: {...service, Origin: 'https://comichuddle.test'}})).status, 401);
  assert.equal((await call(syncRoute, 'POST', null, {action: 'start'}, '', {headers: {...service, Origin: ''}})).status, 401);
  assert.equal((await call(syncRoute, 'POST', collector, {action: 'start'}, '', {headers: service})).status, 403);
  assert.equal((await call(syncRoute, 'POST', null, {action: 'start'}, '', {headers: {Origin: null}})).status, 401);
});
await test('Business token and activation gates fail before any provider or sync checkpoint mutation', async () => {
  for (const change of [{METRON_API_TOKEN: undefined}, {METRON_API_TOKEN: 'short'}, {METRON_API_TOKEN: TOKEN + '\n'}, {METRON_SYNC_ENABLED: 'false'}]) {
    Object.assign(env, {METRON_API_TOKEN: TOKEN, METRON_SYNC_ENABLED: 'true'}, change);
    for (const name of ['start', 'step', 'nightly_step']) assert.equal((await action(name)).status, 424);
    assert.equal(state(), null); assert.equal(requests.length, 0);
  }
});
await test('Scope validates calendar dates and sends the exact server-selected publisher/date filters', async () => {
  for (const scope of [null, [], {extra: true}, {publisherName: 1}, {publisherName: 'x'.repeat(101)}, {publisherName: 'bad\nname'}, {startDate: '2026-02-30'}, {endDate: '2026-10-01T00:00:00Z'}, {startDate: '2026-10-02', endDate: '2026-10-01'}]) assert.equal((await action('start', scope)).status, 400);
  providerHandler = provider([]); await start({publisherName: '  Independent & Co  ', startDate: '2020-01-01', endDate: '2020-12-31'});
  const first = await step(); assert.equal(first.status, 200); assert.equal(first.data.stage, 'complete');
  assert.deepEqual(state().value.scope, {publisherName: 'Independent & Co', startDate: '2020-01-01', endDate: '2020-12-31'});
  for (const request of requests) {const params = new URL(request.url).searchParams; assert.equal(params.get('publisher_name'), 'Independent & Co'); assert.equal(params.get('store_date_range_after'), '2020-01-01'); assert.equal(params.get('store_date_range_before'), '2020-12-31');}
});
await test('Paged shared import checkpoints both scans with stable IDs, bounded steps and no duplicates', async () => {
  await action('seed_starter'); const records = Array.from({length: 7}, (_, index) => record(index + 1));
  const final = await complete(records); assert.equal(final.data.imported, 7); assert.equal(final.data.checkedRecords, 14); assert.equal(final.data.pass, 2);
  assert.equal(issueCount(), 7); assert.equal(sqlite.prepare('SELECT count(*) n FROM catalog_issues').get().n, 50);
  assert.deepEqual(sqlite.prepare('SELECT id,metron_id FROM catalog_issues WHERE metron_id IS NOT NULL ORDER BY metron_id').all().map(plain), records.map(value => ({id: 1_000_000_000 + value.id, metron_id: value.id})));
  assert.ok(state().value.watermark); assert.equal(state().lease_id, ''); assert.equal(requests.filter(value => /\/\d+\/$/.test(new URL(value.url).pathname)).length, 7, 'Fresh records were unnecessarily fetched on reconciliation pass');
});
await test('Normalized imported publisher, series and unique creator-role relations retain provenance without artwork or FMV', async () => {
  const value = record(51, {credits: [...record(51).credits, record(51).credits[0]], desc: '<p>Text\u202e &amp; metadata.</p>'}); await complete([value]);
  const normalized = sqlite.prepare('SELECT data,raw_metadata,series_id,publisher_id FROM catalog_issues WHERE metron_id=51').get();
  assert.equal(normalized.series_id, 800); assert.equal(normalized.publisher_id, 42);
  assert.equal(sqlite.prepare('SELECT name FROM catalog_publishers WHERE metron_id=42').get().name, 'Independent & Co');
  assert.equal(sqlite.prepare('SELECT name,year_began,volume FROM catalog_series WHERE metron_id=800').get().name, 'Central Heroes');
  assert.equal(sqlite.prepare('SELECT count(*) n FROM catalog_creators').get().n, 2); assert.equal(sqlite.prepare('SELECT count(*) n FROM catalog_issue_creators').get().n, 3);
  const result = await call(catalogRoute, 'GET', null, null, '?id=1000000051'); assert.equal(result.status, 200);
  const issue = result.data.issues[0]; assert.equal(issue.title, 'Central Heroes (2020)'); assert.equal(issue.writer, 'Ada Writer'); assert.equal(issue.artist, 'Bea Artist'); assert.equal(issue.coverArtist, 'Bea Artist'); assert.equal(issue.note, 'Text & metadata.');
  assert.equal(issue.source, 'https://metron.cloud/issue/51/'); assert.match(issue.dataLicense, /creativecommons\.org\/licenses\/by-sa\/4\.0/); assert.equal(result.data.scope, 'shared');
  for (const key of ['cover', 'image', 'images', 'price', 'fmv', 'rawMetadata', 'raw_metadata']) assert.equal(issue[key], undefined, key + ' leaked');
  assert.ok(normalized.raw_metadata.includes('unlicensed.example.test')); assert.ok(!JSON.stringify(result.data).includes('unlicensed.example.test')); assert.ok(!JSON.stringify(result.data).includes(TOKEN));
});
await test('Public search indexes imported series, issue, creator and characters with filters and stable pagination', async () => {
  await action('seed_starter'); await complete([record(11), record(12, {cover_date: '1965-01-01', publisher: {id: 43, name: 'Other Press'}}), record(13)]);
  for (const query of ['Central%20Heroes%20%2311', 'Ada%20Writer%20%2311', 'Hero%20%2311']) {const result = await call(catalogRoute, 'GET', null, null, '?q=' + query); assert.equal(result.status, 200); assert.equal(result.data.total, 1); assert.equal(result.data.issues[0].metronId, 11);}
  const filtered = await call(catalogRoute, 'GET', null, null, '?q=Central&publisher=Other%20Press&era=Silver%20Age&kind=Catalog%20issue&sort=oldest'); assert.equal(filtered.data.total, 1); assert.equal(filtered.data.issues[0].metronId, 12);
  const page1 = (await call(catalogRoute, 'GET', null, null, '?q=Central&limit=2&offset=0&sort=title')).data, page2 = (await call(catalogRoute, 'GET', null, null, '?q=Central&limit=2&offset=2&sort=title')).data;
  assert.equal(page1.total, 3); assert.equal(page1.hasMore, true); assert.equal(page2.hasMore, false); assert.equal(new Set([...page1.issues, ...page2.issues].map(issue => issue.id)).size, 3);
  assert.ok(page1.publishers.includes('Other Press')); assert.equal((await call(catalogRoute, 'GET', null, null, '?q=Central%20%23999')).data.total, 0);
});
await test('Public catalog rejects malformed and duplicate parameters or unknown exact IDs without provider lookups', async () => {
  for (const query of ['?q=x&q=y', '?id=1&q=x', '?id=1.1', '?id=-1', '?limit=0', '?limit=31', '?offset=-1', '?offset=2147483648', '?sort=unsafe', '?token=' + TOKEN, '?q=' + 'x'.repeat(161)]) assert.equal((await call(catalogRoute, 'GET', null, null, query)).status, 400, query);
  assert.equal((await call(catalogRoute, 'GET', null, null, '?id=1000000777')).status, 404); assert.equal(requests.length, 0);
  assert.equal((await action('seed_starter')).status, 200); const prepared = []; observePrepare = sql => prepared.push(sql);
  for (const offset of [100001, 2147483647]) {
    const result = await call(catalogRoute, 'GET', null, null, '?q=&offset=' + offset); assert.equal(result.status, 200); assert.equal(result.data.offset, offset); assert.equal(result.data.total, 43); assert.deepEqual(result.data.issues, []); assert.equal(result.data.hasMore, false);
  }
  observePrepare = null; assert.ok(!prepared.some(sql => /\boffset\b/i.test(sql)), 'An out-of-range result offset issued a row-scan query'); assert.equal(requests.length, 0);
});
await test('Idle and completed step errors preserve lifecycle state and allow the next explicit scope', async () => {
  assert.equal((await action('step')).status, 409); assert.equal(state().value.stage, 'idle');
  providerHandler = provider([]); await start(); assert.equal((await step()).data.stage, 'complete'); const prior = state().value;
  assert.equal((await step()).status, 409); assert.equal(state().value.stage, 'complete'); assert.equal(state().value.watermark, prior.watermark); assert.equal(state().value.lastCompletedAt, prior.lastCompletedAt);
  now += 60000; assert.equal((await action('start', {publisherName: 'Next scope'})).status, 200);
});
await test('Source changes between passes pause reconciliation and retain imported rows without advancing the watermark', async () => {
  providerHandler = provider([record(21), record(22)], {listRecords: pass => pass === 1 ? [record(21)] : [record(22)]}); await start();
  let result; for (let count = 0; count < 10; count++) {result = await step(); assert.equal(result.status, 200); if (result.data.stage === 'paused') break; now += 60000;}
  assert.equal(result.data.stage, 'paused'); assert.match(result.data.error, /source changed/i); assert.equal(state().value.watermark, null); assert.equal(state().value.lastCompletedAt, null); assert.equal(issueCount(), 2);
  providerHandler = provider([record(21), record(22)]);
  for (let count = 0; count < 10; count++) {now += 60000; result = await step(); assert.equal(result.status, 200); if (result.data.stage === 'complete') break;}
  assert.equal(result.data.stage, 'complete'); assert.equal(issueCount(), 2); assert.ok(state().value.watermark);
});
await test('Manual pause resumes the same cursor and rejects starting another scope before reconciliation finishes', async () => {
  providerHandler = provider(Array.from({length: 6}, (_, index) => record(index + 31)), {pageSize: 6}); await start({publisherName: 'Independent & Co'}); assert.equal((await step()).status, 200);
  const prior = state().value; assert.ok(prior.pending.length > 0); assert.equal((await action('pause')).data.stage, 'paused');
  const pausedRequests = requests.length; const nightly = await action('nightly_step'); assert.equal(nightly.status, 200); assert.equal(nightly.data.stage, 'paused'); assert.equal(nightly.data.pausedByOwner, true); assert.equal(requests.length, pausedRequests);
  assert.equal((await action('start', {publisherName: 'New publisher'})).status, 409); assert.equal(state().value.runId, prior.runId); assert.deepEqual(state().value.pending, prior.pending);
  now += 60000; const resumed = await step(); assert.equal(resumed.status, 200); assert.equal(resumed.data.pausedByOwner, false); assert.equal(state().value.runId, prior.runId); assert.ok(state().value.checkedRecords > prior.checkedRecords);
});
await test('Nightly follow-up preserves scope and uses overlap until the weekly full-refresh boundary', async () => {
  await complete([record(41)], {scope: {publisherName: 'Independent & Co'}}); const watermark = state().value.watermark;
  now += 86400000; requests = []; providerHandler = provider([]); let result = await action('nightly_step'); assert.equal(result.status, 200); assert.equal(result.data.stage, 'complete');
  assert.equal(new URL(requests[0].url).searchParams.get('modified_gt'), new Date(Date.parse(watermark) - 7 * 86400000).toISOString()); assert.equal(new URL(requests[0].url).searchParams.get('publisher_name'), 'Independent & Co');
  now += 8 * 86400000; requests = []; result = await action('nightly_step'); assert.equal(result.status, 200); assert.equal(new URL(requests[0].url).searchParams.has('modified_gt'), false); assert.ok(state().value.lastFullAt);
});
await test('Source count contradictions cannot certify an empty or truncated complete scan', async () => {
  for (const body of [{count: 1, next: null, results: []}, {count: 0, next: null, results: [{id: 61, modified: record(61).modified}]}]) {
    reset(); providerHandler = provider([record(61)], {listResponse: () => json(body)}); await start(); const result = await step();
    assert.equal(result.status, 502, 'Contradictory list count was accepted'); assert.equal(state().value.watermark, null); assert.equal(state().value.lastCompletedAt, null);
  }
  for (const variant of ['truncated', 'repeat-across-pages', 'changed-count']) {
    reset(); providerHandler = provider([record(61), record(63)], {pageSize: 1, listResponse: (body, url) => {
      const page = Number(url.searchParams.get('page')); if (variant === 'truncated') return json({...body, next: null});
      if (variant === 'repeat-across-pages' && page === 2) return json({...body, results: [{id: 61, modified: record(61).modified}]});
      return json(variant === 'changed-count' && page === 2 ? {...body, count: 3} : body);
    }}); await start(); let result;
    for (let count = 0; count < 5; count++) {result = await step(); if (result.status !== 200 || result.data.stage === 'complete') break; now += 60000;}
    assert.equal(result.status, 502, variant + ' incorrectly completed'); assert.equal(state().value.watermark, null); assert.equal(state().value.pass, 1); assert.equal(state().value.nextPage, 1); assert.equal(state().value.stage, 'paused');
    assert.equal(issueCount(), variant === 'changed-count' ? 2 : 1, 'Validated records were discarded or traversal stopped before the final coverage check');
    if (variant === 'changed-count') assert.ok(requests.some(request => new URL(request.url).pathname === '/api/issue/63/'), 'The later valid detail was never requested');
  }
});
await test('Within-pass source growth retains later pages and completes after a stable second manifest', async () => {
  const records = [record(64), record(65), record(66), record(67)]; let observedGrowth = false;
  const result = await complete(records, {pageSize: 2, listResponse: (body, url) => {
    const pass = state().value.pass, page = Number(url.searchParams.get('page'));
    if (pass === 1 && page === 1) return json({...body, count: 3});
    if (pass === 1 && page === 2) observedGrowth = true;
    return json(body);
  }});
  assert.equal(observedGrowth, true); assert.equal(result.data.stage, 'complete'); assert.equal(result.data.pass, 2); assert.equal(result.data.checkedRecords, 8); assert.equal(issueCount(), 4);
  assert.deepEqual(sqlite.prepare('SELECT metron_id FROM catalog_issues WHERE metron_id IS NOT NULL ORDER BY metron_id').all().map(row => row.metron_id), [64, 65, 66, 67]);
  assert.ok(state().value.watermark); assert.ok(state().value.lastCompletedAt); assert.equal(requests.filter(request => /\/\d+\/$/.test(new URL(request.url).pathname)).length, 4, 'Growth caused an unnecessary early replay');
});
await test('A detail older than its list modification cannot advance the pending checkpoint or certify freshness', async () => {
  providerHandler = provider([record(62, {modified: '2026-10-09T00:00:00Z'})], {detailResponse: value => json({...value, modified: '2026-10-01T00:00:00Z'})}); await start();
  const result = await step(); assert.equal(result.status, 502, 'Stale detail accepted'); assert.equal(state().value.pending[0].id, 62); assert.equal(issueCount(), 0); assert.equal(state().value.watermark, null);
});
await test('429 and rate headers preserve pending work, forbid early requests and resume after retry time', async () => {
  let limited = false; providerHandler = provider([record(71)], {detailResponse: value => {if (!limited) {limited = true; return json({detail: TOKEN}, 429, {'Retry-After': '90'});} return json(value);}}); await start();
  const limitedResult = await step(); assert.equal(limitedResult.status, 429); assert.equal(state().value.pending[0].id, 71); assert.equal(issueCount(), 0); assert.ok(!JSON.stringify(limitedResult.data).includes(TOKEN));
  const before = requests.length; assert.equal((await step()).status, 429); assert.equal(requests.length, before); assert.equal((await call(syncRoute)).data.retryAfter, 90);
  now += 90000; const result = await step(); assert.equal(result.status, 200); assert.equal(result.data.stage, 'complete'); assert.equal(issueCount(), 1);
});
await test('Local provider request budgets fail closed even when provider headers advertise higher limits', async () => {
  providerHandler = provider([record(72)]); await start();
  sqlite.prepare('UPDATE catalog_sync SET minute_start=?,minute_requests=20 WHERE id=?').run(Math.floor(now / 60000) * 60000, 'metron');
  assert.equal((await step()).status, 429); assert.equal(requests.length, 0); now += 60000;
  sqlite.prepare('UPDATE catalog_sync SET day_start=?,day_requests=5000 WHERE id=?').run(Math.floor(now / 86400000) * 86400000, 'metron');
  assert.equal((await step()).status, 429); assert.equal(requests.length, 0); assert.ok((await call(syncRoute)).data.retryAfter > 3600);
});
await test('Provider authentication failures pause without echoing credentials or replacing imported records', async () => {
  await installRecord(record(73)); const prior = sqlite.prepare('SELECT * FROM catalog_issues').all();
  for (const status of [401, 403]) {providerHandler = async () => json({token: TOKEN, detail: TOKEN}, status); if (!state()) await start(); const result = await step(); assert.equal(result.status, 424); assert.ok(!JSON.stringify(result.data).includes(TOKEN)); assert.deepEqual(sqlite.prepare('SELECT * FROM catalog_issues').all(), prior); assert.equal(state().value.stage, 'paused'); now += 60000;}
});
await test('Unsafe pagination, changed scope and empty continuing pages fail without external redirects or cursor advancement', async () => {
  const nexts = ['https://evil.test/api/issue/?page=2', 'http://metron.cloud/api/issue/?page=2', 'https://metron.cloud:444/api/issue/?page=2', 'https://user:pass@metron.cloud/api/issue/?page=2', 'https://metron.cloud/api/issue/?page=2#secret', 'https://metron.cloud/api/issue/?page=3', 'https://metron.cloud/api/issue/?page=2&page=2', 'https://metron.cloud/api/issue/?page=2&token=' + TOKEN, 'https://metron.cloud/api/issue/?page=2&publisher_name=Wrong'];
  for (const next of nexts) {reset(); providerHandler = provider([record(74)], {listResponse: body => json({...body, next})}); await start(); const result = await step(); assert.ok([502, 503].includes(result.status), JSON.stringify(result.data)); assert.equal(requests.length, 1); assert.equal(state().value.nextPage, 1); assert.equal(state().value.pending.length, 0); assert.equal(issueCount(), 0);}
  reset(); providerHandler = provider([], {listResponse: body => json({...body, next: 'https://metron.cloud/api/issue/?page=2'})}); await start(); assert.equal((await step()).status, 502); assert.equal(requests.length, 1);
});
await test('Malformed, oversized, redirected and vanished provider responses preserve a retryable checkpoint', async () => {
  const variants = [() => new Response('no json', {headers: {'Content-Type': 'text/html'}}), () => new Response('{invalid', {headers: {'Content-Type': 'application/json'}}), () => json({detail: TOKEN}, 302, {Location: 'https://evil.test'}), () => json({detail: TOKEN}, 404), () => json({}, 200, {'Content-Length': '1500001'}), () => json({results: Array.from({length: 101}, () => ({id: 1, modified: record(1).modified})), count: 101, next: null}), () => json({count: 2, next: null, results: [{id: 1, modified: record(1).modified}, {id: 1, modified: record(1).modified}]})];
  for (const variant of variants) {reset(); providerHandler = async () => variant(); await start(); const result = await step(); assert.ok([502, 503].includes(result.status), JSON.stringify(result.data)); assert.equal(state().value.pending.length, 0); assert.equal(state().value.watermark, null); assert.equal(state().value.stage, 'paused'); assert.ok(!JSON.stringify(result.data).includes(TOKEN));}
  reset(); providerHandler = async () => new Response(new ReadableStream({start(controller) {controller.enqueue(new TextEncoder().encode('x'.repeat(1500001))); controller.close();}}), {headers: {'Content-Type': 'application/json'}}); await start(); assert.equal((await step()).status, 502);
});
await test('Wrong identity, unsafe token echo or incomplete details do not leave normalized partial records', async () => {
  for (const change of [{id: 999}, {series: null}, {modified: 'invalid'}, {number: ''}, {desc: TOKEN}]) {reset(); providerHandler = provider([record(75)], {detailResponse: value => json({...value, ...change})}); await start(); const result = await step(); assert.ok([502, 503].includes(result.status)); assert.equal(state().value.pending[0].id, 75); assert.equal(issueCount(), 0); for (const table of ['catalog_publishers', 'catalog_series', 'catalog_creators', 'catalog_issue_creators']) assert.equal(sqlite.prepare('SELECT count(*) n FROM ' + table).get().n, 0); assert.ok(!JSON.stringify(result.data).includes(TOKEN));}
});
await test('Atomic record-storage failure rolls back relations and retains the exact pending record for retry', async () => {
  providerHandler = provider([record(81)]); await start(); failBatch = statement => /insert into "catalog_issues"/i.test(statement.sql);
  const result = await step(); assert.equal(result.status, 503); assert.equal(state().value.pending[0].id, 81); assert.equal(state().value.checkedRecords, 0); assert.equal(issueCount(), 0);
  for (const table of ['catalog_publishers', 'catalog_series', 'catalog_creators', 'catalog_issue_creators']) assert.equal(sqlite.prepare('SELECT count(*) n FROM ' + table).get().n, 0);
  now += 60000; const retry = await step(); assert.equal(retry.status, 200); assert.equal(retry.data.stage, 'complete'); assert.equal(issueCount(), 1);
});
await test('Concurrent owner steps respect the persisted lease and only the winning step requests or writes', async () => {
  let release, entered; const signal = new Promise(resolve => {entered = resolve;}); const pending = new Promise(resolve => {release = resolve;});
  providerHandler = async () => {entered(); await pending; return json({count: 0, next: null, results: []});}; await start();
  const first = step(); await signal; const lease = state().lease_id; assert.ok(lease);
  const second = await step(); assert.equal(second.status, 409); assert.equal(requests.length, 1); assert.equal(state().lease_id, lease);
  release(); assert.equal((await first).status, 200); assert.equal(state().lease_id, ''); assert.equal(issueCount(), 0);
});
await test('A lost lease cannot commit metadata, advance another job or release its newer lease', async () => {
  providerHandler = provider([record(82)], {detailResponse: value => {beforeBatch = statements => {assert.ok(statements.some(statement => /insert into "catalog_issues"/i.test(statement.sql))); sqlite.prepare('UPDATE catalog_sync SET lease_id=?,lease_until=? WHERE id=?').run('newer-operator-lease', now + 120000, 'metron');}; return json(value);}}); await start();
  const result = await step(); assert.equal(result.status, 503); assert.equal(issueCount(), 0); assert.equal(state().value.pending[0].id, 82); assert.equal(state().value.checkedRecords, 0); assert.equal(state().lease_id, 'newer-operator-lease'); assert.equal(sqlite.prepare('SELECT count(*) n FROM operation_guard').get().n, 0);
});
await test('Refresh updates normalized relations without changing public identity or downgrading a newer stored record', async () => {
  await complete([record(83)]); const publicId = sqlite.prepare('SELECT id FROM catalog_issues').get().id;
  now += 8 * 86400000; providerHandler = provider([record(83, {modified: '2026-10-09T00:00:00Z', credits: [{creator: {id: 903, name: 'New Writer'}, role: [{name: 'Writer'}]}]})]);
  let result = await action('nightly_step'); for (let count = 0; result.status === 200 && result.data.stage !== 'complete' && count < 10; count++) {now += 60000; result = await step();} assert.equal(result.status, 200); assert.equal(result.data.stage, 'complete');
  assert.equal(sqlite.prepare('SELECT id FROM catalog_issues').get().id, publicId); assert.equal(sqlite.prepare('SELECT count(*) n FROM catalog_issue_creators').get().n, 1); assert.equal((await call(catalogRoute, 'GET', null, null, '?id=' + publicId)).data.issues[0].writer, 'New Writer');
});
await test('Imported physical copies save canonically with external provenance and no invented starter price link', async () => {
  await complete([record(91)]); await profile(); await profile(other); const issue = (await call(catalogRoute, 'GET', null, null, '?id=1000000091')).data.issues[0];
  const book = {id: 'imported-owned-copy', title: 'Client supplied title', issue: '#wrong', grade: 'Raw VF self reported', price: 350, ...plain(shared.issueIdentity(issue))};
  const result = await save({...emptyVault, books: [book], tradeBookIds: [book.id], wants: [issue.id]}); assert.equal(result.status, 200, JSON.stringify(result.data));
  const read = await call(vault, 'GET', collector); assert.equal(read.data.books[0].title, issue.title); assert.equal(read.data.books[0].issue, '#' + issue.number); assert.equal(read.data.books[0].price, 350); assert.deepEqual(read.data.books[0].externalCatalog, {provider: 'Metron', id: 91, sourceUrl: 'https://metron.cloud/issue/91/', license: 'CC BY-SA 4.0'}); assert.equal(read.data.books[0].catalogId, undefined); assert.deepEqual(read.data.wants, [issue.id]); assert.equal(read.etag, result.etag);
  const exported = await call(social, 'GET', collector, null, '?kind=export'); assert.deepEqual(exported.data.collection.books, read.data.books); assert.equal((await call(vault, 'GET', other)).data, null);
  const wanted = await call(catalogRoute, 'GET', null, null, '?ids=' + issue.id + ',' + issue.id + ',1000000999,0'); assert.equal(wanted.status, 200); assert.deepEqual(wanted.data.issues.map(value => value.id), [issue.id, 0]); assert.equal(wanted.data.issues[0].title, issue.title);
});
await test('Imported wants must exist in the shared index and invalid identity combinations leave the vault unchanged', async () => {
  await installRecord(record(92)); await profile(); const valid = {id: 'valid-imported-copy', title: 'Central Heroes (2020)', issue: '#92', grade: 'Condition not recorded', price: 0, externalCatalog: {provider: 'Metron', id: 92, sourceUrl: 'https://metron.cloud/issue/92/', license: 'CC BY-SA 4.0'}};
  assert.equal((await save({...emptyVault, books: [valid], wants: [1000000092]})).status, 200); const previous = sqlite.prepare('SELECT data,revision FROM collections WHERE user_id=?').get(collector.userId);
  const invalid = [{...emptyVault, books: [valid], wants: [1000000999]}, {...emptyVault, books: [valid], wants: [1000000000]}, {...emptyVault, books: [valid], wants: [1000000092, 1000000092]}, {...emptyVault, books: [{...valid, catalogId: 1}]}, {...emptyVault, books: [{...valid, externalCatalog: undefined, catalogId: 1000000092}]}];
  for (const value of invalid) {assert.equal((await save(value)).status, 400); assert.deepEqual(sqlite.prepare('SELECT data,revision FROM collections WHERE user_id=?').get(collector.userId), previous);}
});

// Client callbacks below are extracted from the actual TSX. Each render creates
// the real closure around that render's values; responses are controlled by QA.
// These integrations do not exercise browser layout, DOM events or OAuth.
function clientSource(file, componentName) {
  return readFile(file, 'utf8').then(source => {
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === componentName); assert.ok(component);
    // This fixture executes pure request/state helpers, not rendering functions.
    // The compact local card is exercised by shared-directory-compact.mjs.
    function containsJsx(node) {if(ts.isJsxElement(node)||ts.isJsxSelfClosingElement(node)||ts.isJsxFragment(node))return true;return ts.forEachChild(node,containsJsx)||false;}
    const helpers = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node !== component && !containsJsx(node)).map(node => node.getText(ast));
    const functions = component.body.statements.filter(ts.isFunctionDeclaration).map(node => node.getText(ast));
    const derived = component.body.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(value => ['seconds', 'ready', 'hasCheckpoint', 'disabled'].includes(value.name.getText(ast)))).map(node => node.getText(ast));
    const effects = component.body.statements.filter(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === 'useEffect').map(node => node.expression.arguments[0].getText(ast));
    return {source, helpers, functions, effects, derived};
  });
}
const directoryClient = await clientSource('app/shared-directory.tsx', 'SharedDirectory');
const panelClient = await clientSource('app/catalog-sync-panel.tsx', 'CatalogSyncPanel');
const compile = code => ts.transpileModule(code, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText;
const flush = async () => {for (let turn = 0; turn < 12; turn++) await Promise.resolve();};
const pageDto = (id, offset = 0) => ({issues: [plain(store.normalizeMetronRecord(record(id), new ServerDate().toISOString()).issue)], publishers: ['Independent & Co'], total: offset + 1, limit: 12, offset, hasMore: false, issueCount: 43, syncedIssueCount: 1, scope: 'shared', lastSyncedAt: null});
const statusDto = overrides => ({configured: true, accessReady: true, imported: 0, active: false, stage: 'idle', pending: 0, nextPage: 1, retryAfter: 0, error: null, lastCompletedAt: null, ...overrides});
function directoryFixture() {
  const pending = [], values = {query: '', debouncedQuery: '', publisher: '', series: '', matched: null, era: '', kind: '', sort: 'featured', offset: 0, retry: 0, data: null, loading: false, error: ''};
  const globals = {Error, Promise, JSON, URL, URLSearchParams, AbortController, pageSize: 12, generation: {current: 0}, controller: {current: null}, fetch: (url, options) => new Promise((resolve, reject) => pending.push({url, options, resolve, reject}))};
  for (const name of Object.keys(values)) globals['set' + name[0].toUpperCase() + name.slice(1)] = value => {values[name] = typeof value === 'function' ? value(values[name]) : value;};
  const context = vm.createContext(globals), effect = directoryClient.effects.find(value => value.includes("fetch('/api/catalog?'")); assert.ok(effect);
  vm.runInContext(compile(directoryClient.helpers.join('\n') + '\nglobalThis.renderDirectory=function({query,debouncedQuery,publisher,series,matched,era,kind,sort,offset,retry}){' + directoryClient.functions.join('\n') + '\nreturn {invalidate,changeQuery,changeFilter,resetFilters,read:' + effect + '};}'), context);
  return {values, context, pending, render: () => context.renderDirectory(values), answer: (index, data, status = 200) => pending[index].resolve(json(data, status))};
}
function panelFixture() {
  const pending = [], notices = [], values = {status: null, loading: false, busy: null, error: '', publisherName: 'Marvel', startDate: '', endDate: '', retryUntil: 0, clock: now, updated: 0};
  const globals = {Error, Promise, JSON, Date: ServerDate, URL, URLSearchParams, AbortController, Headers,
    mounted: {current: true}, generation: {current: 0}, reading: {current: null}, writing: {current: false},
    callbacks: {current: {notify: message => notices.push(message), onUpdated: () => values.updated++}},
    fetch: (url, options) => new Promise((resolve, reject) => pending.push({url, options, resolve, reject}))};
  for (const name of ['status', 'loading', 'busy', 'error', 'retryUntil', 'clock']) globals['set' + name[0].toUpperCase() + name.slice(1)] = value => {values[name] = typeof value === 'function' ? value(values[name]) : value;};
  const context = vm.createContext(globals), mount = panelClient.effects.find(value => value.includes('mounted.current = true')); assert.ok(mount);
  vm.runInContext(compile(panelClient.helpers.join('\n') + '\nglobalThis.renderPanel=function({status,loading,busy,retryUntil,clock,publisherName,startDate,endDate}){' + panelClient.functions.join('\n') + '\n' + panelClient.derived.join('\n') + '\nreturn {refresh,action,start,mount:' + mount + '};}'), context);
  return {values, context, pending, notices, render: () => context.renderPanel(values), answer: (index, data, status = 200, headers = {}) => pending[index].resolve(json(data, status, headers))};
}
await test('Directory input invalidates the old response immediately during debounce and latest filter response wins', async () => {
  const fixture = directoryFixture(), first = fixture.render(), oldCleanup = first.read(); assert.equal(fixture.pending.length, 1);
  first.changeQuery('Central'); fixture.answer(0, pageDto(1)); await flush(); assert.equal(fixture.values.data, null); assert.equal(fixture.values.loading, true);
  assert.equal(fixture.render().read(), undefined, 'New search requested before debounce completion'); assert.equal(fixture.pending.length, 1);
  fixture.values.debouncedQuery = 'Central'; const next = fixture.render(); next.read(); next.changeFilter(fixture.context.setPublisher, 'Independent & Co'); oldCleanup();
  fixture.render().read(); fixture.answer(2, pageDto(3)); await flush(); fixture.answer(1, pageDto(2)); await flush();
  assert.equal(fixture.values.data.issues[0].metronId, 3); assert.equal(fixture.values.loading, false); assert.equal(fixture.values.error, '');
});
await test('Directory late errors and unmounted success cannot replace newer results or clear active loading', async () => {
  const fixture = directoryFixture(), old = fixture.render(); old.read(); old.changeFilter(fixture.context.setEra, 'Silver Age'); const cleanup = fixture.render().read();
  fixture.answer(0, {error: 'Old search failed'}, 503); await flush(); assert.equal(fixture.values.error, ''); assert.equal(fixture.values.loading, true);
  cleanup(); fixture.answer(1, pageDto(2)); await flush(); assert.equal(fixture.values.data, null); assert.equal(fixture.values.error, ''); assert.equal(fixture.values.loading, true);
});
await test('Directory uses bounded server filters and rejects malformed responses or a mismatched page', async () => {
  for (const body of [null, {issues: []}, {...pageDto(1), total: -1}, {...pageDto(1), issues: [{id: '1', title: 'Invalid', number: '1'}]}, pageDto(1, 12)]) {
    const fixture = directoryFixture(); Object.assign(fixture.values, {query: '  Central #1  ', debouncedQuery: '  Central #1  ', publisher: 'Independent & Co', era: 'Modern Age', kind: 'Catalog issue', sort: 'title'});
    fixture.render().read(); const url = new URL(fixture.pending[0].url, 'https://comichuddle.test'); assert.equal(url.searchParams.get('q'), 'Central #1'); assert.equal(url.searchParams.get('publisher'), 'Independent & Co'); assert.equal(url.searchParams.get('limit'), '12'); assert.equal(url.searchParams.get('offset'), '0'); assert.equal(url.searchParams.get('sort'), 'title');
    fixture.answer(0, body); await flush(); assert.equal(fixture.values.data, null); assert.ok(fixture.values.error); assert.equal(fixture.values.loading, false);
  }
});
await test('Directory reset invalidates outstanding requests and public source links remain canonical provider identities', async () => {
  const fixture = directoryFixture(); Object.assign(fixture.values, {query: 'Central', debouncedQuery: 'Central', publisher: 'Independent & Co', era: 'Modern Age', kind: 'Catalog issue', sort: 'title', offset: 12}); const render = fixture.render(); render.read(); render.resetFilters();
  fixture.answer(0, pageDto(1, 12)); await flush(); for (const key of ['query', 'publisher', 'era', 'kind']) assert.equal(fixture.values[key], ''); assert.equal(fixture.values.offset, 0); assert.equal(fixture.values.sort, 'featured'); assert.equal(fixture.values.data, null);
  // Source links moved into Hub details. The actual importer/API now supplies
  // their exact provider URL rather than accepting an upstream reference URL.
  for(const supplied of ['javascript:alert(1)','data:text/html,unsafe','https://untrusted.example/source']){
    const normalized=store.normalizeMetronRecord({...record(1),resource_url:supplied,source:supplied},new ServerDate().toISOString(),TOKEN);
    await database.batch(store.metronRecordStatements(database,normalized));
    const response=await call(catalogRoute,'GET',null,null,'?id=1000000001');assert.equal(response.status,200);
    assert.equal(response.data.issues[0].source,'https://metron.cloud/issue/1/');assert.ok(!JSON.stringify(response.data).includes(supplied));
  }
});
await test('Owner panel mount reads status only and unmount ignores unfinished writes and callbacks', async () => {
  const fixture = panelFixture(), render = fixture.render(), cleanup = render.mount(); assert.equal(fixture.pending.length, 1); assert.equal(fixture.pending[0].options.method, undefined);
  fixture.answer(0, statusDto()); await flush(); assert.equal(fixture.values.status.stage, 'idle'); assert.equal(fixture.pending.length, 1);
  const write = fixture.render().action('step'); assert.equal(fixture.pending.length, 2); cleanup(); fixture.answer(1, statusDto({imported: 2, stage: 'complete'})); await write;
  assert.equal(fixture.values.status.imported, 0); assert.deepEqual(fixture.notices, []); assert.equal(fixture.values.updated, 0); assert.equal(fixture.context.writing.current, false);
});
await test('Owner mutation supersedes old status reads and prevents duplicate posts or refreshes while busy', async () => {
  const fixture = panelFixture(), render = fixture.render(), read = render.refresh(), write = render.action('step');
  await render.action('step'); await render.refresh(); assert.equal(fixture.pending.length, 2);
  fixture.answer(1, statusDto({imported: 4, pending: 2, active: true, stage: 'details'})); await write; fixture.answer(0, statusDto()); await read;
  assert.equal(fixture.values.status.imported, 4); assert.equal(fixture.values.busy, null); assert.equal(fixture.values.loading, false); assert.equal(fixture.values.updated, 1); assert.equal(fixture.notices.length, 1);
});
await test('Owner latest refresh rejects unreadable status while delayed errors and retry timers stay contextual', async () => {
  const fixture = panelFixture(), render = fixture.render(), old = render.refresh(), current = render.refresh(); fixture.answer(1, statusDto({retryAfter: 30})); await current; fixture.answer(0, {error: 'Stale failure'}, 503); await old;
  assert.equal(fixture.values.error, ''); assert.equal(fixture.values.retryUntil, now + 30000); assert.equal(fixture.values.loading, false);
  const invalid = fixture.render().refresh(); fixture.answer(2, {configured: true}); await invalid; assert.match(fixture.values.error, /incomplete/); assert.equal(fixture.values.status.retryAfter, 30);
  const limited = fixture.render().action('step'); fixture.answer(3, {error: 'Rate limited'}, 429); await flush(); assert.equal(fixture.pending.length, 5); assert.equal(fixture.pending[4].options.method, undefined);
  await fixture.render().action('step'); assert.equal(fixture.pending.length, 5, 'Recovery caused a duplicate write');
  fixture.answer(4, statusDto({retryAfter: 90, imported: 2, stage: 'details', active: true})); await limited; assert.equal(fixture.values.retryUntil, now + 90000); assert.equal(fixture.values.error, 'Rate limited'); assert.equal(fixture.values.busy, null); assert.equal(fixture.values.updated, 1); assert.equal(fixture.values.status.imported, 2);
});
await test('Owner scope submission excludes blank values and credentials and rejects reversed dates before posting', async () => {
  const fixture = panelFixture(); fixture.values.status = statusDto(); fixture.values.publisherName = '  Independent & Co  '; fixture.values.startDate = '2020-01-01'; fixture.values.endDate = '2020-12-31';
  fixture.render().start({preventDefault() {}}); assert.deepEqual(JSON.parse(fixture.pending[0].options.body), {action: 'start', scope: {publisherName: 'Independent & Co', startDate: '2020-01-01', endDate: '2020-12-31'}}); fixture.answer(0, statusDto({stage: 'complete'})); await flush();
  Object.assign(fixture.values, {publisherName: ' ', startDate: '', endDate: ''}); fixture.render().start({preventDefault() {}}); assert.deepEqual(JSON.parse(fixture.pending[1].options.body), {action: 'start', scope: {}}); fixture.answer(1, statusDto({stage: 'complete'})); await flush();
  Object.assign(fixture.values, {startDate: '2020-12-31', endDate: '2020-01-01'}); fixture.render().start({preventDefault() {}}); assert.equal(fixture.pending.length, 2); assert.match(fixture.values.error, /start date/i); assert.ok(!fixture.pending.some(value => value.options.body?.includes(TOKEN)));
  Object.assign(fixture.values, {status: statusDto({stage: 'paused'}), startDate: '', endDate: ''}); fixture.render().start({preventDefault() {}}); assert.equal(fixture.pending.length, 2);
});

completed = true; sqlite.close();
console.log('\nCentral Metron catalog results: ' + passed + ' passed, ' + failures.length + ' failed.');
console.log('Synthetic provider requests only. Maximum D1 binds: ' + maxBinds + '; statements prepared: ' + statementsPrepared + '. Genuine Metron requests: 0.');
if (failures.length) {console.error(JSON.stringify(failures, null, 2)); process.exitCode = 1;}
