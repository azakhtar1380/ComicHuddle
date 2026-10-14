// Run: node checks/fmv-model.mjs
// All transactions and source grants here are SYNTHETIC TEST FIXTURES ONLY.
// Executes the real TypeScript prototype in an isolated VM; no API, live sale,
// public FMV import, payment or third-party data is read or written.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(path.join(process.cwd(), 'lib/fmv-model.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  reportDiagnostics: true,
});
assert.equal((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
const module = { exports: {} };
const context = vm.createContext({ module, exports: module.exports });
new vm.Script(compiled.outputText, { filename: 'lib/fmv-model.ts' }).runInContext(context);
const { estimateComicFmv: estimate, FMV_MODEL_VERSION } = module.exports;
const asOf = '2026-10-09T12:00:00.000Z', day = 86_400_000;
const target = {
  comicId: 'SYNTHETIC-SERIES-1963-001', editionId: 'test-first-edition',
  variantId: 'test-cover-a', printingId: 'test-first-printing',
  mode: 'CGC', gradingCompany: 'CGC', grade: '9.8', label: 'Universal',
  attributesKey: 'standard-white-no-premiums',
};
const grant = {
  grantId: 'SYNTHETIC-GRANT-A', sourceId: 'SYNTHETIC-SOURCE-A', status: 'active',
  evidenceReference: 'SYNTHETIC TEST PERMISSION; NOT A COMMERCIAL LICENSE',
  permittedCollection: true, derivativeValuation: true, publicDisplay: true,
  validFrom: '2026-01-01T00:00:00.000Z', validUntil: '2027-01-01T00:00:00.000Z',
};
const grantB = { ...grant, grantId: 'SYNTHETIC-GRANT-B', sourceId: 'SYNTHETIC-SOURCE-B' };
const isoAge = age => new Date(Date.parse(asOf) - age * day).toISOString();
const plain = value => JSON.parse(JSON.stringify(value));
const clone = value => structuredClone(value);
function sale(n, price = 100 + n * 10, age = 0, seller = ['seller-A', 'seller-B', 'seller-C'][n % 3]) {
  return {
    transactionId: 'SYNTHETIC-TXN-' + String(n).padStart(3, '0'),
    sourceId: grant.sourceId, sourceGrantId: grant.grantId, tuple: clone(target),
    comparabilityVerified: true, sellerId: seller, sellerIndependenceVerified: true,
    soldAt: isoAge(age), settledAt: isoAge(age), status: 'settled', kind: 'single',
    quantity: 1, currency: 'USD', itemPriceUsd: price, priceBasis: 'item-only',
    acceptedOffer: false, acceptedOfferAmountKnown: true, wasCancelled: false, wasRefunded: false,
  };
}
const baseSales = () => Array.from({ length: 5 }, (_, n) => sale(n));
const input = (sales = baseSales(), grants = [clone(grant)], nextTarget = clone(target)) => ({
  asOf, target: nextTarget, grants, sales,
});
const unavailable = result => {
  assert.equal(result.status, 'unavailable');
  assert.equal(result.fmvUsd, null);
  assert.equal(result.observedRangeUsd, null);
  assert.equal(result.reliability, 'unavailable');
};
const close = (actual, expected, epsilon = 1e-7) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
const reason = (result, key, count) => assert.equal(result.exclusionCounts[key], count);
let passed = 0;
const failures = [];
async function test(name, run) {
  try { await run(); passed++; console.log('PASS: ' + name); }
  catch (error) { failures.push({ name, error: error.message }); console.error('FAIL: ' + name + ' — ' + error.message); }
}

await test('Original research output has exact weighted median and observed quartiles, with no purchase discount', () => {
  const result = estimate(input());
  assert.equal(result.fmvUsd, 120);
  assert.deepEqual(plain(result.observedRangeUsd), { lowerQuartile: 110, upperQuartile: 130 });
  assert.equal(result.modelVersion, FMV_MODEL_VERSION);
  assert.equal(result.researchOnly, true); assert.equal(result.calibrated, false);
  assert.equal(result.reliability, 'limited-observation-support');
  assert.match(result.rangeMeaning, /not a confidence or prediction interval/);
  assert.equal(estimate(input(baseSales().map(row => ({ ...row, itemPriceUsd: 100 })))).fmvUsd, 100);
});

await test('Thirty-day half-life changes the result predictably without averaging the old high sales', () => {
  const rows = [sale(0, 100, 0, 'A'), sale(1, 110, 0, 'B'), sale(2, 1000, 30, 'C'), sale(3, 1200, 30, 'D'), sale(4, 1400, 30, 'E')];
  const result = estimate(input(rows));
  assert.equal(result.fmvUsd, 110);
  assert.deepEqual(plain(result.observedRangeUsd), { lowerQuartile: 100, upperQuartile: 1200 });
  close(result.effectiveSampleSize, 3.5 ** 2 / 2.75);
  close(result.maximumSellerWeightShare, 1 / 3.5);
  assert.equal(result.halfLifeDays, 30); assert.equal(result.windowDays, 90);
});

await test('Missing data leaves numeric FMV and range null, and reports unavailable support', () => {
  const result = estimate(input([])); unavailable(result);
  assert.equal(result.inputRows, 0); assert.equal(result.includedCount, 0);
  assert.ok(result.unavailableReasons.includes('insufficient-comparable-sales'));
  assert.ok(result.unavailableReasons.includes('no-recent-comparable-sale'));
});

await test('Incomplete exact target identities and unknown grades fail closed', () => {
  for (const key of Object.keys(target)) {
    const broken = clone(target); delete broken[key];
    const result = estimate(input(baseSales(), [grant], broken)); unavailable(result);
    assert.ok(result.unavailableReasons.includes('incomplete-target-tuple'));
  }
  for (const grade of ['LOW', 'MID', 'HIGH', '9.7', '9.8 ', '', 'unknown']) unavailable(estimate(input(baseSales(), [grant], { ...target, grade })));
});

await test('Raw and CGC tuples require consistent company and canonical label', () => {
  for (const change of [{ mode: 'Raw' }, { gradingCompany: 'None' }, { label: 'Raw' }, { mode: 'CBCS', gradingCompany: 'CBCS' }])
    unavailable(estimate(input(baseSales(), [grant], { ...target, ...change })));
  const rawTarget = { ...target, mode: 'Raw', gradingCompany: 'None', grade: '8.0', label: 'Raw', attributesKey: 'raw-vf-no-premiums' };
  const rows = baseSales().map(row => ({ ...row, tuple: rawTarget }));
  assert.equal(estimate(input(rows, [grant], rawTarget)).fmvUsd, 120);
});

await test('Every edition, variant, printing, grade, label and specialty attribute must match exactly', () => {
  const changes = [
    { comicId: 'different-volume-or-issue' }, { editionId: 'different-edition' },
    { variantId: 'cover-b' }, { printingId: 'second-printing' }, { grade: '9.6' },
    { label: 'Signature Series', attributesKey: 'signed-specific-creator-no-pedigree' },
    { attributesKey: 'cream-pages-specific-pedigree' },
    { mode: 'Raw', gradingCompany: 'None', label: 'Raw', grade: '8.0' },
  ];
  for (const change of changes) {
    const result = estimate(input(baseSales().map(row => ({ ...row, tuple: { ...target, ...change } }))));
    unavailable(result); reason(result, 'different-comparable-tuple', 5);
  }
});

await test('Missing comparable identities or exact-comparability verification cannot supply estimates', () => {
  const rows = baseSales().map(row => ({ ...row, tuple: { ...row.tuple, variantId: 'unknown' } }));
  reason(estimate(input(rows)), 'incomplete-comparable-tuple', 5);
  const result = estimate(input(baseSales().map(row => ({ ...row, comparabilityVerified: false }))));
  unavailable(result); reason(result, 'unverified-exact-comparability', 5);
});

await test('Collection and access permission are independently mandatory', () => {
  for (const value of [false, undefined, 'true']) {
    const result = estimate(input(baseSales(), [{ ...grant, permittedCollection: value }]));
    unavailable(result); reason(result, 'source-permission-unavailable', 5);
  }
});

await test('Derivation permission is independently mandatory; a token or developer account does not suffice', () => {
  for (const rights of [{ ...grant, derivativeValuation: false }, { sourceId: grant.sourceId, grantId: grant.grantId, apiKey: 'SYNTHETIC-DEVELOPER-TOKEN' }]) {
    const result = estimate(input(baseSales(), [rights])); unavailable(result);
    reason(result, 'source-permission-unavailable', 5);
  }
});

await test('Public display permission is independently mandatory', () => {
  for (const value of [false, undefined, 1]) {
    const result = estimate(input(baseSales(), [{ ...grant, publicDisplay: value }]));
    unavailable(result); reason(result, 'source-permission-unavailable', 5);
  }
});

await test('Missing, wrong-source, inactive, revoked and undocumented grants fail closed', () => {
  for (const grants of [[], [{ ...grant, sourceId: 'other-source' }], [{ ...grant, status: 'inactive' }], [{ ...grant, status: 'revoked' }], [{ ...grant, evidenceReference: '' }]]) {
    const result = estimate(input(baseSales(), grants)); unavailable(result);
    reason(result, 'source-permission-unavailable', 5);
  }
});

await test('Expired and future-starting grants including exact expiry boundary cannot authorize inputs', () => {
  for (const change of [
    { validUntil: asOf }, { validUntil: '2026-10-08T12:00:00.000Z' },
    { validFrom: '2026-10-09T12:00:00.001Z' },
    { validFrom: '2027-01-02T00:00:00.000Z', validUntil: '2027-01-01T00:00:00.000Z' },
  ]) unavailable(estimate(input(baseSales(), [{ ...grant, ...change }])));
});

await test('Malformed and impossible permission dates are refused rather than Date.parse-normalized', () => {
  for (const date of ['2026-02-30T00:00:00.000Z', '2025-02-29T00:00:00.000Z', 'January 1, 2026', '2026-01-01', 'invalid']) {
    const result = estimate(input(baseSales(), [{ ...grant, validFrom: date }])); unavailable(result);
    reason(result, 'source-permission-unavailable', 5);
  }
});

await test('Conflicting duplicate grant IDs are never resolved by record order', () => {
  const yesThenNo = estimate(input(baseSales(), [grant, { ...grant, publicDisplay: false }]));
  const noThenYes = estimate(input(baseSales(), [{ ...grant, publicDisplay: false }, grant]));
  unavailable(yesThenNo); assert.deepEqual(plain(yesThenNo), plain(noThenYes));
  assert.equal(estimate(input(baseSales(), [grant, clone(grant)])).fmvUsd, 120);
});

await test('Unverified independent sellers or missing seller identities cannot supply support', () => {
  for (const change of [{ sellerIndependenceVerified: false }, { sellerIndependenceVerified: undefined }, { sellerId: '' }]) {
    const result = estimate(input(baseSales().map(row => ({ ...row, ...change })))); unavailable(result);
    reason(result, 'unverified-independent-seller', 5);
  }
});

await test('Lots, collections and multiple-copy transaction totals are excluded', () => {
  for (const change of [{ kind: 'lot' }, { quantity: 2 }, { quantity: 0 }, { quantity: undefined }]) {
    const result = estimate(input(baseSales().map(row => ({ ...row, ...change })))); unavailable(result);
    reason(result, 'lot-or-multiple-copy-sale', 5);
  }
});

await test('Pending, cancelled, refunded and unknown transaction states are excluded', () => {
  for (const change of [{ status: 'pending' }, { status: 'cancelled' }, { status: 'refunded' }, { wasCancelled: true }, { wasRefunded: true }, { wasCancelled: undefined }]) {
    const result = estimate(input(baseSales().map(row => ({ ...row, ...change })))); unavailable(result);
    reason(result, 'unsettled-cancelled-or-refunded', 5);
  }
});

await test('Non-USD prices are never mixed or implicitly converted', () => {
  for (const currency of ['EUR', 'CAD', 'usd', '', undefined]) {
    const result = estimate(input(baseSales().map(row => ({ ...row, currency })))); unavailable(result);
    reason(result, 'non-usd-sale', 5);
  }
});

await test('Asking prices and totals including fees, shipping, tax or buyer premiums are excluded', () => {
  for (const priceBasis of ['asking', 'total-with-fees', 'unknown', undefined]) {
    const result = estimate(input(baseSales().map(row => ({ ...row, priceBasis })))); unavailable(result);
    reason(result, 'unknown-or-non-item-price', 5);
  }
});

await test('Unknown accepted-offer amounts fail closed; known actual paid offer amounts can be comparable', () => {
  const unknown = estimate(input(baseSales().map(row => ({ ...row, acceptedOffer: true, acceptedOfferAmountKnown: false }))));
  unavailable(unknown); reason(unknown, 'unknown-paid-amount', 5);
  const known = estimate(input(baseSales().map(row => ({ ...row, acceptedOffer: true }))));
  assert.equal(known.fmvUsd, 120);
  const absentStatus = estimate(input(baseSales().map(row => ({ ...row, acceptedOffer: undefined }))));
  unavailable(absentStatus); reason(absentStatus, 'unknown-offer-status', 5);
});

await test('Nonfinite, nonpositive, nonnumeric, unsafe and subcent amounts cannot supply a valuation', () => {
  for (const itemPriceUsd of [NaN, Infinity, -Infinity, 0, -1, 1e-9, Number.MIN_VALUE, 0.004, 0.005, '100', null, 1e100, 100.001]) {
    const result = estimate(input(baseSales().map(row => ({ ...row, itemPriceUsd })))); unavailable(result);
    reason(result, 'invalid-item-price', 5);
  }
  assert.equal(estimate(input(baseSales().map(row => ({ ...row, itemPriceUsd: 100.05 })))).fmvUsd, 100.05);
  assert.equal(estimate(input(baseSales().map(row => ({ ...row, itemPriceUsd: 0.01 })))).fmvUsd, 0.01);
});

await test('Malformed and impossible sale or settlement calendar dates are rejected', () => {
  for (const date of ['2026-09-31T12:00:00.000Z', '2026-02-30T12:00:00.000Z', '2026-10-09', 'today', '2026-10-09T13:00:00+01:00']) {
    for (const key of ['soldAt', 'settledAt']) {
      const result = estimate(input(baseSales().map(row => ({ ...row, [key]: date })))); unavailable(result);
      reason(result, 'malformed-sale-or-settlement-date', 5);
    }
  }
});

await test('Future sales and future settlements are excluded relative to the supplied evaluation clock', () => {
  for (const key of ['soldAt', 'settledAt']) {
    const result = estimate(input(baseSales().map(row => ({ ...row, [key]: '2026-10-09T12:00:00.001Z' }))));
    unavailable(result); reason(result, 'future-sale-or-settlement', 5);
  }
});

await test('Settlement preceding a sale cannot be treated as a settled comparable', () => {
  const result = estimate(input(baseSales().map(row => ({ ...row, settledAt: isoAge(1) }))));
  unavailable(result); reason(result, 'settlement-before-sale', 5);
});

await test('The 90-day window includes its boundary and excludes records one millisecond older', () => {
  const boundary = estimate(input(baseSales().map(row => ({ ...row, soldAt: isoAge(90), settledAt: isoAge(90) }))));
  assert.equal(boundary.includedCount, 5); assert.equal(boundary.oldestSaleAt, isoAge(90));
  assert.equal(boundary.exclusionCounts['outside-sale-window'], undefined);
  const tooOld = new Date(Date.parse(isoAge(90)) - 1).toISOString();
  const result = estimate(input(baseSales().map(row => ({ ...row, soldAt: tooOld, settledAt: tooOld }))));
  unavailable(result); reason(result, 'outside-sale-window', 5);
});

await test('Newest sale must be within30 days; the exact30-day boundary is allowed', () => {
  assert.equal(estimate(input(baseSales().map(row => ({ ...row, soldAt: isoAge(30), settledAt: isoAge(30) })))).fmvUsd, 120);
  const stale = new Date(Date.parse(isoAge(30)) - 1).toISOString();
  const result = estimate(input(baseSales().map(row => ({ ...row, soldAt: stale, settledAt: stale }))));
  unavailable(result); assert.equal(result.includedCount, 5);
  assert.ok(result.unavailableReasons.includes('no-recent-comparable-sale'));
});

await test('Fewer than five unique comparable sales never create an estimate', () => {
  const result = estimate(input(baseSales().slice(0, 4))); unavailable(result);
  assert.ok(result.unavailableReasons.includes('insufficient-comparable-sales'));
});

await test('Fewer than three independent sellers never create an estimate', () => {
  const result = estimate(input(baseSales().map((row, n) => ({ ...row, sellerId: n % 2 ? 'A' : 'B' }))));
  unavailable(result); assert.ok(result.unavailableReasons.includes('insufficient-independent-sellers'));
});

await test('Identical transaction repeats within one feed do not inflate sample size or support', () => {
  const rows = baseSales().flatMap(row => [row, clone(row), clone(row)]);
  const result = estimate(input(rows));
  assert.equal(result.fmvUsd, 120); assert.equal(result.includedCount, 5);
  assert.equal(result.excludedCount, 10); reason(result, 'duplicate-transaction', 10);
  assert.equal(result.effectiveSampleSize, 5);
});

await test('Identical economic transactions from different licensed feeds and UTC spellings are deduplicated', () => {
  const copy = { ...clone(baseSales()[0]), sourceId: grantB.sourceId, sourceGrantId: grantB.grantId,
    soldAt: asOf.replace('.000Z', 'Z'), settledAt: asOf.replace('.000Z', 'Z') };
  const result = estimate(input([...baseSales(), copy], [grant, grantB]));
  assert.equal(result.fmvUsd, 120); assert.equal(result.includedCount, 5); reason(result, 'duplicate-transaction', 1);
});

await test('A duplicate from an unlicensed feed is excluded without discarding an identical permitted sale', () => {
  const copy = { ...clone(baseSales()[0]), sourceId: 'UNLICENSED-SOURCE', sourceGrantId: 'NO-GRANT' };
  const result = estimate(input([...baseSales(), copy]));
  assert.equal(result.fmvUsd, 120); assert.equal(result.includedCount, 5);
  reason(result, 'source-permission-unavailable', 1);
});

await test('Conflicting duplicate economic transaction IDs reject all copies instead of choosing a feed', () => {
  for (const change of [{ itemPriceUsd: 999 }, { sellerId: 'different-seller' }, { currency: 'EUR' }, { wasRefunded: true }, { tuple: { ...target, grade: '9.6' } }]) {
    const copy = { ...clone(baseSales()[0]), sourceId: grantB.sourceId, sourceGrantId: grantB.grantId, ...change };
    const result = estimate(input([...baseSales(), copy], [grant, grantB])); unavailable(result);
    assert.equal(result.includedCount, 4); reason(result, 'conflicting-transaction-records', 2);
    assert.ok(!result.includedTransactionIds.includes(copy.transactionId));
  }
});

await test('Missing or malformed stable transaction IDs do not become invented unique transactions', () => {
  for (const transactionId of ['', ' ', null, undefined, 123]) {
    const result = estimate(input(baseSales().map(row => ({ ...row, transactionId }))));
    unavailable(result); reason(result, 'invalid-transaction-id', 5);
  }
});

await test('Seller concentration rejects aggregate recency weight over40%, including recent dominant sellers', () => {
  const concentrated = Array.from({ length: 6 }, (_, n) => sale(n, 100 + n, 0, n < 4 ? 'A' : n === 4 ? 'B' : 'C'));
  const result = estimate(input(concentrated)); unavailable(result);
  assert.ok(result.unavailableReasons.includes('seller-weight-concentration'));
  const recentDominant = [sale(0, 100, 0, 'A'), sale(1, 101, 90, 'B'), sale(2, 102, 90, 'B'), sale(3, 103, 90, 'C'), sale(4, 104, 90, 'C')];
  const weighted = estimate(input(recentDominant)); unavailable(weighted);
  close(weighted.maximumSellerWeightShare, 2 / 3);
});

await test('Exactly40% seller recency weight is allowed without artificial seller reweighting', () => {
  const result = estimate(input()); assert.equal(result.status, 'available');
  assert.equal(result.maximumSellerWeightShare, 0.4);
  assert.deepEqual(plain(result.sellerShares).map(row => [row.sellerId, row.saleCount, row.weightedShare]),
    [['seller-A', 2, 0.4], ['seller-B', 2, 0.4], ['seller-C', 1, 0.2]]);
});

await test('At least nine observations permit robust log-MAD outlier filtering with transparent exclusions', () => {
  const prices = [95, 96, 97, 98, 99, 100, 101, 102, 10000];
  const rows = prices.map((price, n) => sale(n, price, 0, 'seller-' + n));
  const result = estimate(input(rows));
  assert.equal(result.fmvUsd, 98); assert.equal(result.eligibleBeforeOutliers, 9);
  assert.equal(result.includedCount, 8); assert.equal(result.outlierFilterApplied, true);
  assert.deepEqual(plain(result.outlierTransactionIds), [rows[8].transactionId]);
  reason(result, 'robust-log-price-outlier', 1);
  assert.ok(result.outlierLogMad > 0);
});

await test('Sparse samples and zero log-MAD do not invent an outlier cutoff', () => {
  const sparse = estimate(input([95, 96, 97, 98, 99, 100, 101, 10000].map((price, n) => sale(n, price, 0, 'seller-' + n))));
  assert.equal(sparse.outlierFilterApplied, false); assert.equal(sparse.includedCount, 8);
  const zeroMad = estimate(input(Array.from({ length: 9 }, (_, n) => sale(n, n === 8 ? 10000 : 100, 0, 'seller-' + n))));
  assert.equal(zeroMad.outlierFilterApplied, true); assert.equal(zeroMad.outlierLogMad, 0);
  assert.equal(zeroMad.includedCount, 9); assert.equal(zeroMad.fmvUsd, 100);
  assert.equal(zeroMad.outlierTransactionIds.length, 0);
});

await test('Freshness is checked again after removing a recent extreme sale', () => {
  const rows = [95, 96, 97, 98, 99, 100, 101, 102, 10000]
    .map((price, n) => sale(n, price, n === 8 ? 0 : 32, 'seller-' + n));
  const result = estimate(input(rows)); unavailable(result);
  assert.equal(result.includedCount, 8); reason(result, 'robust-log-price-outlier', 1);
  assert.ok(result.unavailableReasons.includes('no-recent-comparable-sale'));
});

await test('Stronger support requires fifteen fresh comparable sales, five sellers and restrained observed spread', () => {
  const rows = Array.from({ length: 15 }, (_, n) => sale(n, 95 + n, 7, 'seller-' + n % 5));
  const result = estimate(input(rows));
  assert.equal(result.fmvUsd, 102); assert.equal(result.reliability, 'stronger-observation-support');
  assert.equal(result.effectiveSampleSize, 15); assert.equal(result.independentSellerCount, 5);
  assert.equal(result.latestSaleAt, isoAge(7)); assert.equal(result.oldestSaleAt, isoAge(7));
  const dispersed = estimate(input(Array.from({ length: 15 }, (_, n) => sale(n, 50 + n * 10, 7, 'seller-' + n % 5))));
  assert.equal(dispersed.includedCount, 15); assert.equal(dispersed.status, 'available');
  assert.equal(dispersed.reliability, 'limited-observation-support');
});

await test('Many mostly old sales cannot manufacture stronger support from a small effective sample', () => {
  const rows = Array.from({ length: 15 }, (_, n) => sale(n, 100, n === 0 ? 0 : 90,
    n === 0 ? 'new-seller' : 'old-seller-' + n % 7));
  const result = estimate(input(rows));
  assert.equal(result.status, 'available'); assert.equal(result.includedCount, 15);
  assert.ok(result.effectiveSampleSize < 10);
  assert.equal(result.reliability, 'limited-observation-support');
});

await test('Conflicts, source selection, audit counts and numeric output are invariant under input order', () => {
  const rows = [
    ...baseSales(),
    { ...clone(baseSales()[1]), sourceId: grantB.sourceId, sourceGrantId: grantB.grantId },
    { ...sale(9, 199, 0, 'seller-D'), status: 'refunded', wasRefunded: true },
    { ...sale(10, 200, 0, 'seller-E'), transactionId: 'CONFLICT-ID' },
    { ...sale(10, 201, 0, 'seller-E'), transactionId: 'CONFLICT-ID' },
  ];
  const a = estimate(input(rows, [grant, grantB]));
  for (const reordered of [[...rows].reverse(), [...rows.slice(3), ...rows.slice(0, 3)], [...rows].sort((a, b) => b.sourceId.localeCompare(a.sourceId))])
    assert.deepEqual(plain(estimate(input(reordered, [grantB, grant]))), plain(a));
  assert.equal(a.includedCount + a.excludedCount, a.inputRows);
  assert.equal(Object.values(a.exclusionCounts).reduce((sum, n) => sum + n, 0), a.excludedCount);
});

await test('The prototype does not mutate caller records or depend on the current system clock', () => {
  const fixture = input();
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  freeze(fixture);
  const result = estimate(fixture);
  assert.equal(result.fmvUsd, 120);
  assert.equal(result.asOf, asOf);
  assert.equal(result.windowStart, isoAge(90));
  assert.deepEqual(plain(estimate(fixture)), plain(result));
});

await test('Invalid envelopes and malformed evaluation clocks return unavailable without fabricated observations', () => {
  for (const fixture of [null, {}, { ...input(), sales: null }, { ...input(), grants: null }, { ...input(), asOf: '2026-02-30T12:00:00.000Z' }, { ...input(), asOf: 'October 9, 2026' }])
    unavailable(estimate(fixture));
  const malformedRows = estimate(input([null, undefined, 'sale', [], {}])); unavailable(malformedRows);
  reason(malformedRows, 'invalid-transaction-id', 5);
});

console.log(`FMV prototype: ${passed} named groups passed; ${failures.length} failed. SYNTHETIC FIXTURES ONLY; no live FMV calibrated or published.`);
if (failures.length) process.exitCode = 1;
