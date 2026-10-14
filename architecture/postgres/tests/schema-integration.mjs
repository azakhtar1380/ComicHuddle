// Real PostgreSQL SQL, triggers, functions and analysis. No SQL responses are mocked.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {createReporter, loadTypeScriptModule, plain, projectRoot} from './runtime.mjs';
import {database, directory, copy, listing, source, quote, pricedSingle, ids, asOf, offsetDate} from './fixtures.mjs';

const db = await database(), report = createReporter('PostgreSQL schema and domain integration');
const analyzer = loadTypeScriptModule('architecture/postgres/analyzer.ts');
const moderation = loadTypeScriptModule('architecture/postgres/moderation.ts');
const analysis = id => analyzer.analyzeMarketplaceDeal(db, id, {asOf});
const rejectsCode = (promise, code) => assert.rejects(promise, error => error.code === code,
  'Expected database error ' + code);
const actor = user => db.query("SELECT set_config('app.user_id',$1,false)", [user || '']);
const uuid = randomUUID;
const count = async table => Number((await db.query('SELECT count(*)::int AS n FROM comichuddle.' + table)).rows[0].n);
const state = async () => {
  const result = {};
  for (const table of ['directory_comics','review_queue','user_collections','marketplace_listings','listing_items','moderation_audit','fmv_history','outbox_events']) {
    try {result[table] = (await db.query('SELECT to_jsonb(t) AS row FROM comichuddle.' + table + ' t ORDER BY id')).rows.map(value => value.row);}
    catch (error) {if (error.code !== '42P01') throw error;}
  }
  return plain(result);
};

await report.test('Four pillars and every listing/copy edition are genuine nonnull UUID foreign keys', async () => {
  const rows = (await db.query(`SELECT table_name,column_name,is_nullable,data_type
    FROM information_schema.columns WHERE table_schema='comichuddle'
    AND (table_name,column_name) IN (('directory_comics','id'),('user_collections','directory_id'),
      ('marketplace_listings','directory_comic_id'),('listing_items','directory_id'),('fmv_history','directory_id'))`)).rows;
  assert.equal(rows.length, 5); assert.ok(rows.every(value => value.is_nullable === 'NO' && value.data_type === 'uuid'));
  assert.ok((await db.query("SELECT count(*)::int AS n FROM pg_constraint WHERE connamespace='comichuddle'::regnamespace AND contype='f'")).rows[0].n >= 20);
});
await report.test('Custom edition cannot commit without a matching pending review row', async () => {
  const before = await count('directory_comics');
  await rejectsCode(db.query(`INSERT INTO comichuddle.directory_comics(title,issue_number,publisher,created_by_user_id)
    VALUES('Unqueued custom','1','QA Press',$1)`, [ids.alice]), '23514');
  assert.equal(await count('directory_comics'), before);
});
await report.test('Two separate physical copies may share one canonical edition', async () => {
  const edition = await directory(db), a = await copy(db, edition), b = await copy(db, edition);
  assert.notEqual(a, b); assert.equal((await db.query('SELECT count(*)::int AS n FROM comichuddle.user_collections WHERE directory_id=$1', [edition])).rows[0].n, 2);
});
await report.test('Null/dangling directory identity and changes to a physical-copy owner fail atomically', async () => {
  const edition = await directory(db), owned = await copy(db, edition);
  await rejectsCode(db.query('UPDATE comichuddle.user_collections SET directory_id=NULL WHERE id=$1', [owned]), '23514');
  await rejectsCode(db.query('UPDATE comichuddle.user_collections SET directory_id=$1 WHERE id=$2', [uuid(), owned]), '23514');
  await rejectsCode(db.query('UPDATE comichuddle.user_collections SET user_id=$1 WHERE id=$2', [ids.bob, owned]), '23514');
  assert.equal((await db.query('SELECT user_id,directory_id FROM comichuddle.user_collections WHERE id=$1', [owned])).rows[0].user_id, ids.alice);
});
await report.test('A seller cannot attach another owner’s physical copy to a listing', async () => {
  const edition = await directory(db), owned = await copy(db, edition, {owner: ids.bob}), before = await count('marketplace_listings');
  await rejectsCode(listing(db, [owned], {owner: ids.alice}), '23503'); assert.equal(await count('marketplace_listings'), before);
});
await report.test('Listing edition mismatch and a lot anchor outside its manifest are rejected at commit', async () => {
  const edition = await directory(db), other = await directory(db), owned = await copy(db, edition), valid = await listing(db, [owned], {status: 'DRAFT'});
  await rejectsCode(db.query('UPDATE comichuddle.listing_items SET directory_id=$1 WHERE listing_id=$2', [other, valid.id]), '23514');
  await rejectsCode(listing(db, [owned], {status: 'DRAFT', anchor: other}), '23514');
  assert.equal((await db.query('SELECT directory_id FROM comichuddle.listing_items WHERE listing_id=$1', [valid.id])).rows[0].directory_id, edition);
});
await report.test('Provisional custom listings remain quarantined and cannot spoof the official marker', async () => {
  const edition = await directory(db, {custom: true}), owned = await copy(db, edition), row = await listing(db, [owned]);
  assert.equal(row.isCustom, true); await rejectsCode(db.query("UPDATE comichuddle.marketplace_listings SET status='ACTIVE' WHERE id=$1", [row.id]), '23514');
  await rejectsCode(db.query('UPDATE comichuddle.marketplace_listings SET is_custom_entry=false WHERE id=$1', [row.id]), '23514');
  await actor(ids.alice); const result = await analysis(row.id); assert.equal(result.isCustomEntry, true);
  assert.equal(result.items[0].quoteState, 'CUSTOM_PENDING_REVIEW'); assert.equal(result.baselineCents, null);
  assert.equal(result.position, 'UNKNOWN'); assert.equal(result.purchaseEligible, false); assert.ok(result.riskScore >= 60);
});
await report.test('A mixed lot aggregates every custom line rather than trusting its canonical anchor', async () => {
  const canonical = await directory(db), custom = await directory(db, {custom: true});
  const row = await listing(db, [await copy(db, canonical), await copy(db, custom)]);
  await actor(ids.alice); const result = await analysis(row.id);
  assert.equal(result.directoryComicId, canonical); assert.equal(result.isCustomEntry, true);
  assert.equal(result.totalCopies, 2); assert.equal(result.purchaseEligible, false);
  await rejectsCode(db.query('UPDATE comichuddle.marketplace_listings SET is_custom_entry=false WHERE id=$1', [row.id]), '23514');
});
await report.test('The unique physical-copy reservation rejects a second active offer, then withdrawal releases it', async () => {
  const edition = await directory(db), owned = await copy(db, edition), first = await listing(db, [owned]);
  const second = await listing(db, [owned], {status: 'DRAFT'});
  await rejectsCode(db.query("UPDATE comichuddle.marketplace_listings SET status='ACTIVE' WHERE id=$1", [second.id]), '23505');
  await db.query("UPDATE comichuddle.marketplace_listings SET status='WITHDRAWN' WHERE id=$1", [first.id]);
  await db.query("UPDATE comichuddle.marketplace_listings SET status='ACTIVE' WHERE id=$1", [second.id]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM comichuddle.listing_items WHERE copy_id=$1 AND reservation_active', [owned])).rows[0].n, 1);
});
await report.test('Exact current baseline uses signed variance and never returns seller purchase cost', async () => {
  const row = await pricedSingle(db, {ask: 18000}), result = await analysis(row.id);
  assert.equal(result.baselineCents, '20000'); assert.equal(result.variancePercent, -10); assert.equal(result.position, 'FAIR');
  assert.equal(result.modelVersion, 'price-data-heuristic-v1'); assert.equal(result.items[0].fmvCents, '20000');
  assert.ok(!JSON.stringify(result).includes('87654321')); assert.ok(result.riskExplanation.includes('not a fraud probability'));
});
for (const [ask, position, variance] of [[17000,'BELOW_MARKET',-15],[17001,'FAIR',-15],[22999,'FAIR',15],[23000,'OVERPRICED',15]]) {
  await report.test('Exact cents threshold: ' + ask + ' cents is ' + position + ' against20000', async () => {
    const row = await pricedSingle(db, {ask}), result = await analysis(row.id);
    assert.equal(result.position, position); assert.equal(result.variancePercent, variance);
  });
}
await report.test('An extreme low ask raises explicit caution without declaring fraud', async () => {
  const row = await pricedSingle(db, {ask: 5000}), result = await analysis(row.id);
  assert.equal(result.position, 'BELOW_MARKET'); assert.equal(result.variancePercent, -75);
  assert.equal(result.riskScore, 90); assert.ok(result.reasons.includes('VERY_LOW_ASKING_PRICE'));
  assert.equal(result.fraudProbability, undefined);
  const boundary = await pricedSingle(db, {ask: 10000}); assert.ok(!(await analysis(boundary.id)).reasons.includes('VERY_LOW_ASKING_PRICE'));
});
await report.test('Whole lots sum exact per-copy quotes; partial lots expose subtotal and no whole-lot badge', async () => {
  const a = await directory(db), b = await directory(db), s = await source(db);
  await quote(db, a, s, {value: 10000}); await quote(db, b, s, {value: 30000});
  const full = await listing(db, [await copy(db, a), await copy(db, b)], {ask: 34000}), fullResult = await analysis(full.id);
  assert.equal(fullResult.baselineCents, '40000'); assert.equal(fullResult.variancePercent, -15); assert.equal(fullResult.coveragePercent, 100);
  const missing = await directory(db), partial = await listing(db, [await copy(db, a), await copy(db, missing)], {ask: 5000});
  const result = await analysis(partial.id); assert.equal(result.totalCopies, 2); assert.equal(result.pricedCopies, 1);
  assert.equal(result.pricedSubtotalCents, '10000'); assert.equal(result.coveragePercent, 50);
  assert.equal(result.baselineCents, null); assert.equal(result.variancePercent, null); assert.equal(result.position, 'UNKNOWN');
  assert.ok(result.reasons.includes('PARTIAL_COVERAGE')); assert.ok(result.riskScore >= 60);
});
await report.test('Missing quote remains null with zero priced coverage rather than a zero FMV', async () => {
  const row = await pricedSingle(db, {missing: true}), result = await analysis(row.id);
  assert.equal(result.baselineCents, null); assert.equal(result.items[0].fmvCents, null); assert.equal(result.items[0].quoteState, 'MISSING');
  assert.equal(result.position, 'UNKNOWN'); assert.equal(result.coveragePercent, 0); assert.ok(result.riskScore >= 60);
});
await report.test('A recent import cannot freshen an old quote; future observations cannot price a listing', async () => {
  const row = await pricedSingle(db, {quote: {observedAt: offsetDate(-200)}}), result = await analysis(row.id);
  assert.equal(result.items[0].quoteState, 'STALE'); assert.equal(result.baselineCents, null);
  const future = await pricedSingle(db, {quote: {observedAt: offsetDate(1)}}); assert.equal((await analysis(future.id)).baselineCents, null);
});
await report.test('Revoked rights, verification or stricter sample requirements remove eligibility immediately', async () => {
  for (const [field, value, expected] of [['commercial_display_permitted',false,'LICENSE_UNAVAILABLE'],
    ['verification_status','UNVERIFIED','UNVERIFIED_SOURCE'],['minimum_sample_count',99,'INSUFFICIENT_SAMPLE']]) {
    const row = await pricedSingle(db); await db.query('UPDATE comichuddle.valuation_sources SET ' + field + '=$1 WHERE id=$2', [value, row.sourceId]);
    const result = await analysis(row.id); assert.equal(result.items[0].quoteState, expected); assert.equal(result.baselineCents, null);
  }
});
await report.test('Raw, grade, company, label, currency and premium keys cannot substitute for exact coverage', async () => {
  for (const [copyFields, quoteFields] of [[{format:'GRADED',grade:'9.6'},{format:'GRADED',grade:'9.8'}],
    [{format:'GRADED',company:'CBCS'},{format:'GRADED',company:'CGC'}],
    [{format:'GRADED',label:'SIGNATURE',attributes:'SIGNATURE_REVIEWED'},{format:'GRADED'}],
    [{condition:'VERY_FINE'},{}], [{attributes:'UNKNOWN'},{}],
    [{format:'GRADED',attributes:'CGC_OW_NO_PREMIUM'},{format:'GRADED'}]]) {
    const row = await pricedSingle(db, {copy: copyFields, quote: quoteFields});
    const result = await analysis(row.id); assert.equal(result.baselineCents, null); assert.equal(result.pricedCopies, 0);
  }
  const currency = await pricedSingle(db, {listing: {currency: 'EUR'}}); assert.equal((await analysis(currency.id)).baselineCents, null);
});
await report.test('Source evidence snapshots come from the source, not imported JSON; FMV history is immutable', async () => {
  const row = await pricedSingle(db), stored = (await db.query('SELECT * FROM comichuddle.fmv_history WHERE id=$1', [row.quoteId])).rows[0];
  assert.equal(stored.license_reference_snapshot, 'PRIVATE_SYNTHETIC_QA_LICENSE'); assert.equal(stored.verification_snapshot, 'VERIFIED');
  await rejectsCode(db.query('UPDATE comichuddle.fmv_history SET value_cents=1 WHERE id=$1', [row.quoteId]), '23514');
  await rejectsCode(db.query('DELETE FROM comichuddle.fmv_history WHERE id=$1', [row.quoteId]), '23514');
  assert.equal((await db.query('SELECT value_cents::text AS value FROM comichuddle.fmv_history WHERE id=$1', [row.quoteId])).rows[0].value, '20000');
});
await report.test('Nonpositive, insufficient-sample or unsupported custom sale baseline quotes are rejected', async () => {
  const d = await directory(db), s = await source(db), custom = await directory(db, {custom: true});
  for (const value of [0,-1]) await rejectsCode(quote(db, d, s, {value}), '23514');
  await rejectsCode(quote(db, d, s, {samples: 1}), '23514'); await rejectsCode(quote(db, custom, s), '23514');
});
await report.test('Editorial estimates are separate evidence and do not become official FMV or a deal rating', async () => {
  const d = await directory(db), s = await source(db, {kind: 'EDITORIAL'}), row = await listing(db, [await copy(db, d)]);
  await quote(db, d, s, {kind: 'EDITORIAL_ESTIMATE', value: 7500}); const result = await analysis(row.id);
  assert.equal(result.baselineCents, null); assert.equal(result.position, 'UNKNOWN'); assert.equal(result.items[0].editorialEstimateCents, '7500');
  assert.equal(result.items[0].quoteState, 'EDITORIAL_ONLY'); assert.equal(result.items[0].fmvCents, null);
});
await report.test('Public deal projection strips restricted evidence/license/internal methodology and private cost', async () => {
  const row = await pricedSingle(db), internal = await analysis(row.id), result = analyzer.publicDealAnalysis(internal);
  const encoded = JSON.stringify(result); for (const secret of ['PRIVATE_QUOTE_PROOF','PRIVATE_SYNTHETIC_QA_LICENSE','PRIVATE_INTERNAL_QUOTE_METHOD','87654321']) assert.ok(!encoded.includes(secret), secret);
  assert.equal(result.evidence[0].source, 'Synthetic QA attribution'); assert.equal(result.evidence[0].methodology, 'Synthetic QA public methodology');
  assert.equal(result.evidence[0].sourceId, undefined); assert.equal(result.evidence[0].evidenceUri, undefined);
});
await report.test('Moderation refuses nonadmin/spoofed actor and stale versions without partial changes', async () => {
  const reviewId = uuid(), custom = await directory(db, {custom: true, reviewId}), target = await directory(db);
  const input = {reviewId,targetDirectoryId: target,expectedSourceVersion:'1',expectedTargetVersion:'1',requestId:uuid(),actorUserId:ids.admin};
  await actor(ids.bob); const before = await state(); await rejectsCode(moderation.mergeCustomEdition(db, input), '42501'); assert.deepEqual(await state(), before);
  await actor(ids.admin); await rejectsCode(moderation.mergeCustomEdition(db, {...input, expectedSourceVersion:'999'}), '40001'); assert.deepEqual(await state(), before);
  await rejectsCode(moderation.mergeCustomEdition(db, {...input,targetDirectoryId:custom}), '23514'); assert.deepEqual(await state(), before);
});
await report.test('One merge transaction retains an alias, remaps distinct copies/lot lines and records one idempotent audit', async () => {
  const reviewId = uuid(), custom = await directory(db, {custom: true, reviewId}), target = await directory(db);
  const unaffected=await listing(db,[await copy(db,target)]),unaffectedVersion=(await db.query('SELECT version::text AS version FROM comichuddle.marketplace_listings WHERE id=$1',[unaffected.id])).rows[0].version;
  const a = await copy(db, custom), b = await copy(db, custom), row = await listing(db, [a,b]);
  const input = {reviewId,targetDirectoryId:target,expectedSourceVersion:'1',expectedTargetVersion:'1',requestId:uuid(),actorUserId:ids.admin};
  await actor(ids.admin); const result = await moderation.mergeCustomEdition(db, input);
  assert.equal(result.movedCopies, 2); assert.equal(result.movedListingItems, 2); assert.equal(result.sourceDirectoryId, custom);
  const alias = (await db.query('SELECT status,redirect_directory_id FROM comichuddle.directory_comics WHERE id=$1', [custom])).rows[0];
  assert.equal(alias.status, 'ALIASED'); assert.equal(alias.redirect_directory_id, target);
  const copies = (await db.query('SELECT id,directory_id FROM comichuddle.user_collections WHERE id=ANY($1::uuid[]) ORDER BY id', [[a,b]])).rows;
  assert.equal(copies.length, 2); assert.ok(copies.every(value => value.directory_id === target));
  const header = (await db.query('SELECT status,is_custom_entry,directory_comic_id FROM comichuddle.marketplace_listings WHERE id=$1', [row.id])).rows[0];
  assert.equal(header.status, 'DRAFT'); assert.equal(header.is_custom_entry, false); assert.equal(header.directory_comic_id, target);
  assert.equal((await db.query('SELECT version::text AS version FROM comichuddle.marketplace_listings WHERE id=$1',[unaffected.id])).rows[0].version,unaffectedVersion,'Unrelated canonical listing was changed by source merge');
  const before = await state(); assert.deepEqual(plain(await moderation.mergeCustomEdition(db, input)), plain(result)); assert.deepEqual(await state(), before);
  await rejectsCode(moderation.mergeCustomEdition(db, {...input,targetDirectoryId:await directory(db)}), '23514');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM comichuddle.moderation_audit WHERE request_id=$1', [input.requestId])).rows[0].n, 1);
  await rejectsCode(copy(db, custom), '23514');
});
await report.test('Late audit failure rolls the entire merge back, including aliases, copies and review/listing state', async () => {
  const reviewId = uuid(), custom = await directory(db, {custom: true, reviewId}), target = await directory(db);
  await listing(db, [await copy(db, custom)]); await actor(ids.admin); const before = await state();
  await db.exec(`CREATE FUNCTION comichuddle.qa_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'QA injected durable audit failure' USING ERRCODE='P0001'; END $$;
    CREATE TRIGGER qa_fail_audit BEFORE INSERT ON comichuddle.moderation_audit FOR EACH ROW EXECUTE FUNCTION comichuddle.qa_fail_audit();`);
  try {await rejectsCode(moderation.mergeCustomEdition(db, {reviewId,targetDirectoryId:target,expectedSourceVersion:'1',
    expectedTargetVersion:'1',requestId:uuid(),actorUserId:ids.admin}), 'P0001'); assert.deepEqual(await state(), before);}
  finally {await db.exec('DROP TRIGGER qa_fail_audit ON comichuddle.moderation_audit; DROP FUNCTION comichuddle.qa_fail_audit();');}
});
async function order(row, options = {}) {
  const orderId = uuid(), amount = options.amount || 20000;
  await db.transaction(async tx => {
    await tx.query(`INSERT INTO comichuddle.marketplace_orders(id,listing_id,seller_id,buyer_id,amount_cents,currency,status)
      VALUES($1,$2,$3,$4,$5,'USD','PENDING')`, [orderId,row.id,ids.alice,ids.bob,String(amount)]);
    await tx.query(`INSERT INTO comichuddle.order_items(order_id,listing_id,listing_item_id,seller_id,copy_id,
      directory_id,currency,allocated_price_cents,edition_snapshot,copy_snapshot,valuation_snapshot)
      VALUES($1,$2,$3,$4,$5,$6,'USD',$7,$8::jsonb,$9::jsonb,$10::jsonb)`,
      [orderId,row.id,row.manifests[0].itemId,ids.alice,row.copyId,row.directoryId,String(options.allocation ?? amount),
        JSON.stringify({title:'SPOOFED_TITLE'}),JSON.stringify({grade:'FAKE_GRADE'}),JSON.stringify({fixture:'NO_PAYMENT_EXECUTED',quoteId:row.quoteId})]);
  });
  return orderId;
}
await report.test('Order line identity is server-snapshotted and allocation/duplicate-order contracts reject partial writes', async () => {
  const row = await pricedSingle(db), before = await count('marketplace_orders');
  await rejectsCode(order(row, {allocation:19999}), '23514'); assert.equal(await count('marketplace_orders'), before);
  const id = await order(row); const item = (await db.query('SELECT edition_snapshot,copy_snapshot FROM comichuddle.order_items WHERE order_id=$1', [id])).rows[0];
  assert.equal(item.edition_snapshot.directoryId, row.directoryId); assert.notEqual(item.edition_snapshot.title, 'SPOOFED_TITLE');
  assert.equal(item.copy_snapshot.copyId, row.copyId); assert.notEqual(item.copy_snapshot.grade, 'FAKE_GRADE');
  await rejectsCode(order(row), '23505'); assert.equal(await count('marketplace_orders'), before + 1);
});
await report.test('Sold release marks physical copies sold and immutable order/listing/bid snapshots preserve the agreed record', async () => {
  const row = await pricedSingle(db,{copy:{notes:'PRIVATE_ORDER_COPY_NOTES'}}), orderId = await order(row);
  const before = plain((await db.query('SELECT * FROM comichuddle.order_items WHERE order_id=$1', [orderId])).rows[0]);
  assert.ok(!JSON.stringify(before.copy_snapshot).includes('PRIVATE_ORDER_COPY_NOTES'));assert.equal(before.copy_snapshot.privateNotes,undefined);
  await db.query("UPDATE comichuddle.marketplace_listings SET status='SOLD' WHERE id=$1", [row.id]);
  assert.equal((await db.query('SELECT disposition FROM comichuddle.user_collections WHERE id=$1', [row.copyId])).rows[0].disposition, 'SOLD');
  assert.equal((await db.query('SELECT reservation_active FROM comichuddle.listing_items WHERE listing_id=$1', [row.id])).rows[0].reservation_active, false);
  await rejectsCode(listing(db,[row.copyId]), '23514');
  await rejectsCode(db.query('UPDATE comichuddle.marketplace_orders SET amount_cents=1 WHERE id=$1',[orderId]), '23514');
  await rejectsCode(db.query("UPDATE comichuddle.order_items SET edition_snapshot='{}'::jsonb WHERE order_id=$1",[orderId]), '23514');
  await rejectsCode(db.query('UPDATE comichuddle.marketplace_listings SET asking_price_cents=1 WHERE id=$1',[row.id]), '23514');
  await rejectsCode(db.query('DELETE FROM comichuddle.listing_items WHERE listing_id=$1',[row.id]), '23514');
  const reviewId = uuid(), custom = await directory(db,{custom:true,reviewId}); await copy(db,custom); await actor(ids.admin);
  await moderation.mergeCustomEdition(db,{reviewId,targetDirectoryId:row.directoryId,expectedSourceVersion:'1',expectedTargetVersion:'1',requestId:uuid(),actorUserId:ids.admin});
  assert.deepEqual(plain((await db.query('SELECT * FROM comichuddle.order_items WHERE order_id=$1',[orderId])).rows[0]), before);
});
await report.test('Bid anchor, currency, active status and bidder ownership are checked; financial amount cannot be edited', async () => {
  const row = await pricedSingle(db), other = await directory(db);
  const bid = async options => {
    const id=uuid(); await db.query(`INSERT INTO comichuddle.marketplace_bids
      (id,listing_id,bidder_id,directory_id_snapshot,amount_cents,currency,baseline_cents_snapshot,valuation_snapshot,status)
      VALUES($1,$2,$3,$4,15000,$5,20000,$6::jsonb,'OPEN')`,
      [id,row.id,options.bidder||ids.bob,options.directoryId||row.directoryId,options.currency||'USD',JSON.stringify({fixture:'NO_PAYMENT_EXECUTED'})]);
    return id;
  };
  for (const options of [{bidder:ids.alice},{directoryId:other},{currency:'EUR'}]) await rejectsCode(bid(options),'23514');
  const id=await bid({}); await rejectsCode(db.query('UPDATE comichuddle.marketplace_bids SET amount_cents=1 WHERE id=$1',[id]),'23514');
  await db.query("UPDATE comichuddle.marketplace_listings SET status='WITHDRAWN' WHERE id=$1",[row.id]);
  await rejectsCode(bid({}),'23514');
});

report.finish({engineKind: db.engineKind, genuineProviderCalls: 0, paymentExecutions: 0,
  connectionConcurrency: db.openSecondary ? 'See concurrency.mjs' : 'NOT EXECUTED: single PGlite backend',
  httpIntegration: 'Reference API tests are separate; deployed app remains D1'});
await db.close();
