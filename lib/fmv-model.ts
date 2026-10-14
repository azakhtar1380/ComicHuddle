/**
 * Independent, uncalibrated research prototype. This module fetches no data and
 * is intentionally not wired to the public price guide or licensed-value import.
 * A source grant is a reviewed contract/ownership assertion supplied by intake;
 * a developer token, a subscription or seller consent alone is not such a grant.
 */
export const FMV_MODEL_VERSION = 'comichuddle-research-1' as const;
export const FMV_MODEL_RULES = Object.freeze({
  windowDays: 90,
  halfLifeDays: 30,
  minimumSales: 5,
  minimumIndependentSellers: 3,
  newestSaleMaximumAgeDays: 30,
  maximumSellerWeightShare: 0.4,
  outlierMinimumSales: 9,
  logMadMultiplier: 3 * 1.4826,
  strongerSales: 15,
  strongerIndependentSellers: 5,
  strongerNewestSaleMaximumAgeDays: 14,
  strongerEffectiveSampleSize: 10,
  strongerMaximumSellerWeightShare: 0.3,
  strongerMaximumObservedIqrToMedian: 0.5,
});

export type ComicComparableTuple = {
  /** Canonical series/volume/issue identifier; no fuzzy title matching here. */
  comicId: string;
  editionId: string;
  variantId: string;
  printingId: string;
  mode: 'Raw' | 'CGC';
  gradingCompany: 'None' | 'CGC';
  /** Exact numeric grade key, e.g. '8.0', never LOW/MID/HIGH interpolation. */
  grade: string;
  label: 'Raw' | 'Universal' | 'Signature Series' | 'Qualified' | 'Restored' | 'Conserved';
  /** Exact page quality, pedigree, signatures and restoration/premium identity. */
  attributesKey: string;
};

export type ReviewedSourceGrant = {
  grantId: string;
  sourceId: string;
  status: 'active' | 'inactive' | 'revoked';
  /** Reference to an independently reviewed contract or first-party rights. */
  evidenceReference: string;
  permittedCollection: boolean;
  derivativeValuation: boolean;
  publicDisplay: boolean;
  validFrom: string;
  validUntil: string;
};

export type ComicComparableSale = {
  /** Stable normalized economic transaction ID, shared across duplicate feeds. */
  transactionId: string;
  sourceId: string;
  sourceGrantId: string;
  tuple: ComicComparableTuple;
  comparabilityVerified: boolean;
  sellerId: string;
  /** Intake verifies independent economic seller entities, not just usernames. */
  sellerIndependenceVerified: boolean;
  soldAt: string;
  settledAt: string;
  status: 'settled' | 'pending' | 'cancelled' | 'refunded';
  kind: 'single' | 'lot';
  quantity: number;
  currency: string;
  /** Actual known paid item amount, excluding shipping, tax and buyer premiums. */
  itemPriceUsd: number;
  priceBasis: 'item-only' | 'asking' | 'total-with-fees' | 'unknown';
  acceptedOffer: boolean;
  acceptedOfferAmountKnown: boolean;
  wasCancelled: boolean;
  wasRefunded: boolean;
};

export type FmvResearchInput = {
  /** Trusted evaluation clock from the caller. Strict ISO UTC; no system clock. */
  asOf: string;
  target: ComicComparableTuple;
  grants: ReviewedSourceGrant[];
  sales: ComicComparableSale[];
};

export type FmvExclusion = {
  transactionId: string | null;
  sourceId: string | null;
  reason: string;
};

export type FmvResearchResult = {
  modelVersion: typeof FMV_MODEL_VERSION;
  researchOnly: true;
  calibrated: false;
  status: 'available' | 'unavailable';
  reliability: 'unavailable' | 'limited-observation-support' | 'stronger-observation-support';
  fmvUsd: number | null;
  observedRangeUsd: { lowerQuartile: number; upperQuartile: number } | null;
  rangeMeaning: 'Weighted observed transaction quartiles; not a confidence or prediction interval.';
  asOf: string | null;
  target: ComicComparableTuple | null;
  windowStart: string | null;
  windowDays: number;
  halfLifeDays: number;
  oldestSaleAt: string | null;
  latestSaleAt: string | null;
  newestSaleAgeDays: number | null;
  inputRows: number;
  eligibleBeforeOutliers: number;
  includedCount: number;
  excludedCount: number;
  outlierFilterApplied: boolean;
  outlierLogMedian: number | null;
  outlierLogMad: number | null;
  outlierTransactionIds: string[];
  includedTransactionIds: string[];
  independentSellerCount: number;
  effectiveSampleSize: number;
  maximumSellerWeightShare: number;
  sellerShares: { sellerId: string; saleCount: number; weightedShare: number }[];
  exclusionCounts: Record<string, number>;
  exclusions: FmvExclusion[];
  unavailableReasons: string[];
};

const DAY = 86_400_000;
const tupleKeys: (keyof ComicComparableTuple)[] = [
  'comicId', 'editionId', 'variantId', 'printingId', 'mode',
  'gradingCompany', 'grade', 'label', 'attributesKey',
];
const numericGrades = new Set([
  '0.5', '1.0', '1.5', '1.8', '2.0', '2.5', '3.0', '3.5', '4.0',
  '4.5', '5.0', '5.5', '6.0', '6.5', '7.0', '7.5', '8.0', '8.5',
  '9.0', '9.2', '9.4', '9.6', '9.8', '9.9', '10.0',
]);
const gradedLabels = new Set(['Universal', 'Signature Series', 'Qualified', 'Restored', 'Conserved']);
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const textId = (v: unknown): v is string =>
  typeof v === 'string' && v === v.trim() && v.length > 0 && v.length <= 300;
const completeIdentity = (v: unknown): v is string =>
  textId(v) && !/^(unknown|unspecified|n\/a|\?)$/i.test(v);
const roundMetric = (v: number) => Math.round(v * 1e8) / 1e8;
const money = (v: number) => Math.round(v * 100) / 100;
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Reject impossible calendar dates as well as permissive Date.parse coercions. */
function strictUtc(v: unknown): number | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v)) return null;
  const time = Date.parse(v);
  if (!Number.isFinite(time)) return null;
  const canonical = new Date(time).toISOString();
  return canonical === (v.includes('.') ? v : v.replace('Z', '.000Z')) ? time : null;
}

function validTuple(v: unknown): v is ComicComparableTuple {
  if (!record(v) || !tupleKeys.every(k => completeIdentity(v[k]))) return false;
  if (!numericGrades.has(v.grade as string)) return false;
  return v.mode === 'Raw'
    ? v.gradingCompany === 'None' && v.label === 'Raw'
    : v.mode === 'CGC' && v.gradingCompany === 'CGC' && gradedLabels.has(v.label as string);
}

/** Stable type-aware serialization prevents NaN/null or key-order collisions. */
function stable(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (record(v)) return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return typeof v + ':' + String(v);
}

function economicFingerprint(v: Record<string, unknown>): string {
  const fields: Record<string, unknown> = {};
  for (const key of [
    'tuple', 'comparabilityVerified', 'sellerId', 'sellerIndependenceVerified',
    'soldAt', 'settledAt', 'status', 'kind', 'quantity', 'currency', 'itemPriceUsd',
    'priceBasis', 'acceptedOffer', 'acceptedOfferAmountKnown', 'wasCancelled', 'wasRefunded',
  ]) fields[key] = v[key];
  for (const key of ['soldAt', 'settledAt']) {
    const parsed = strictUtc(fields[key]);
    if (parsed !== null) fields[key] = new Date(parsed).toISOString();
  }
  // Source, source grant and incidental annotations are not economic identities.
  if (record(fields.tuple)) fields.tuple = Object.fromEntries(tupleKeys.map(k => [k, (fields.tuple as Record<string, unknown>)[k]]));
  return stable(fields);
}

type Candidate = {
  transactionId: string;
  sourceId: string;
  sellerId: string;
  price: number;
  soldTime: number;
  ageDays: number;
  weight: number;
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Inverse weighted empirical CDF: observed prices, no grade/price interpolation. */
function weightedQuantile(values: Candidate[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a.price - b.price || compareText(a.transactionId, b.transactionId));
  const threshold = sorted.reduce((sum, row) => sum + row.weight, 0) * fraction;
  let accumulated = 0;
  for (const row of sorted) {
    accumulated += row.weight;
    if (accumulated >= threshold) return row.price;
  }
  return sorted[sorted.length - 1].price;
}

/**
 * Return an original observation-based estimate only after every input gate.
 * IDs and verification flags must be established by trusted licensed intake.
 * This arithmetic cannot verify legal rights, condition, fraud or seller identity.
 */
export function estimateComicFmv(input: FmvResearchInput): FmvResearchResult {
  const supplied: Record<string, unknown> = record(input) ? input : {};
  const rows: unknown[] = Array.isArray(supplied.sales) ? supplied.sales : [];
  const asOfTime = strictUtc(supplied.asOf);
  const target: ComicComparableTuple | null = validTuple(supplied.target)
    ? Object.fromEntries(tupleKeys.map(k => [k, (supplied.target as ComicComparableTuple)[k]])) as ComicComparableTuple
    : null;
  const exclusions: FmvExclusion[] = [];
  const exclude = (row: unknown, reason: string) => {
    const v = record(row) ? row : {};
    exclusions.push({
      transactionId: textId(v.transactionId) ? v.transactionId : null,
      sourceId: textId(v.sourceId) ? v.sourceId : null,
      reason,
    });
  };
  const base: FmvResearchResult = {
    modelVersion: FMV_MODEL_VERSION, researchOnly: true, calibrated: false,
    status: 'unavailable', reliability: 'unavailable', fmvUsd: null, observedRangeUsd: null,
    rangeMeaning: 'Weighted observed transaction quartiles; not a confidence or prediction interval.',
    asOf: asOfTime === null ? null : new Date(asOfTime).toISOString(), target,
    windowStart: asOfTime === null ? null : new Date(asOfTime - FMV_MODEL_RULES.windowDays * DAY).toISOString(),
    windowDays: FMV_MODEL_RULES.windowDays, halfLifeDays: FMV_MODEL_RULES.halfLifeDays,
    oldestSaleAt: null, latestSaleAt: null, newestSaleAgeDays: null,
    inputRows: rows.length, eligibleBeforeOutliers: 0, includedCount: 0, excludedCount: rows.length,
    outlierFilterApplied: false, outlierLogMedian: null, outlierLogMad: null,
    outlierTransactionIds: [], includedTransactionIds: [], independentSellerCount: 0,
    effectiveSampleSize: 0, maximumSellerWeightShare: 0, sellerShares: [],
    exclusionCounts: {}, exclusions: [], unavailableReasons: [],
  };
  const finalize = () => {
    base.exclusions = exclusions.sort((a, b) => compareText(stable(a), stable(b)));
    const counts: Record<string, number> = {};
    for (const x of base.exclusions) counts[x.reason] = (counts[x.reason] || 0) + 1;
    base.exclusionCounts = Object.fromEntries(Object.keys(counts).sort().map(k => [k, counts[k]]));
    return base;
  };
  if (asOfTime === null || target === null || !Array.isArray(supplied.sales) || !Array.isArray(supplied.grants)) {
    base.unavailableReasons = [asOfTime === null ? 'invalid-as-of' : target === null ? 'incomplete-target-tuple' : 'invalid-input-arrays'];
    rows.forEach(row => exclude(row, base.unavailableReasons[0]));
    return finalize();
  }

  // A conflicting grant ID cannot be resolved by choosing whichever row is first.
  const grants = new Map<string, Record<string, unknown>>();
  const conflictingGrants = new Set<string>();
  for (const raw of supplied.grants) {
    if (!record(raw) || !textId(raw.grantId)) continue;
    const previous = grants.get(raw.grantId);
    if (previous && stable(previous) !== stable(raw)) conflictingGrants.add(raw.grantId);
    else grants.set(raw.grantId, raw);
  }

  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    if (!record(row) || !textId(row.transactionId)) { exclude(row, 'invalid-transaction-id'); continue; }
    const list = groups.get(row.transactionId) || [];
    list.push(row);
    groups.set(row.transactionId, list);
  }

  function permitted(v: Record<string, unknown>): boolean {
    if (!textId(v.sourceId) || !textId(v.sourceGrantId) || conflictingGrants.has(v.sourceGrantId)) return false;
    const grant = grants.get(v.sourceGrantId);
    if (!grant || grant.sourceId !== v.sourceId || grant.status !== 'active' || !textId(grant.evidenceReference)) return false;
    if (grant.permittedCollection !== true || grant.derivativeValuation !== true || grant.publicDisplay !== true) return false;
    const start = strictUtc(grant.validFrom), end = strictUtc(grant.validUntil);
    return start !== null && end !== null && start <= asOfTime! && end > asOfTime! && end > start;
  }

  function validate(v: Record<string, unknown>): string | null {
    if (!permitted(v)) return 'source-permission-unavailable';
    if (!validTuple(v.tuple)) return 'incomplete-comparable-tuple';
    const tuple = v.tuple;
    if (!tupleKeys.every(k => tuple[k] === target![k])) return 'different-comparable-tuple';
    if (v.comparabilityVerified !== true) return 'unverified-exact-comparability';
    if (!textId(v.sellerId) || v.sellerIndependenceVerified !== true) return 'unverified-independent-seller';
    if (v.kind !== 'single' || v.quantity !== 1) return 'lot-or-multiple-copy-sale';
    if (v.status !== 'settled' || v.wasCancelled !== false || v.wasRefunded !== false) return 'unsettled-cancelled-or-refunded';
    if (v.currency !== 'USD') return 'non-usd-sale';
    if (v.priceBasis !== 'item-only') return 'unknown-or-non-item-price';
    if (v.acceptedOffer !== false && v.acceptedOffer !== true) return 'unknown-offer-status';
    if (v.acceptedOfferAmountKnown !== true) return 'unknown-paid-amount';
    const price = v.itemPriceUsd;
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0 ||
      Math.round(price * 100) < 1 || !Number.isSafeInteger(Math.round(price * 100)) ||
      Math.abs(Math.round(price * 100) - price * 100) > 1e-6) return 'invalid-item-price';
    const sold = strictUtc(v.soldAt), settled = strictUtc(v.settledAt);
    if (sold === null || settled === null) return 'malformed-sale-or-settlement-date';
    if (sold > asOfTime! || settled > asOfTime!) return 'future-sale-or-settlement';
    if (settled < sold) return 'settlement-before-sale';
    if (asOfTime! - sold > FMV_MODEL_RULES.windowDays * DAY) return 'outside-sale-window';
    return null;
  }

  let candidates: Candidate[] = [];
  for (const transactionId of [...groups.keys()].sort()) {
    const copies = groups.get(transactionId)!;
    if (new Set(copies.map(economicFingerprint)).size > 1) {
      copies.forEach(row => exclude(row, 'conflicting-transaction-records'));
      continue;
    }
    // Sorting selects a permitted representative deterministically across feeds.
    const ordered = [...copies].sort((a, b) => compareText(stable(a), stable(b)));
    let included = false;
    for (const row of ordered) {
      const reason = validate(row);
      if (reason) { exclude(row, reason); continue; }
      if (included) { exclude(row, 'duplicate-transaction'); continue; }
      included = true;
      const soldTime = strictUtc(row.soldAt)!;
      const ageDays = (asOfTime - soldTime) / DAY;
      candidates.push({ transactionId, sourceId: row.sourceId as string, sellerId: row.sellerId as string,
        price: row.itemPriceUsd as number, soldTime, ageDays,
        weight: 2 ** (-ageDays / FMV_MODEL_RULES.halfLifeDays) });
    }
  }

  base.eligibleBeforeOutliers = candidates.length;
  if (candidates.length >= FMV_MODEL_RULES.outlierMinimumSales) {
    base.outlierFilterApplied = true;
    const logMedian = median(candidates.map(row => Math.log(row.price)));
    const mad = median(candidates.map(row => Math.abs(Math.log(row.price) - logMedian)));
    base.outlierLogMedian = roundMetric(logMedian);
    base.outlierLogMad = roundMetric(mad);
    // No invented fallback when dispersion is zero, or too small to resolve.
    if (mad > 1e-12) {
      candidates = candidates.filter(row => {
        if (Math.abs(Math.log(row.price) - logMedian) <= FMV_MODEL_RULES.logMadMultiplier * mad) return true;
        base.outlierTransactionIds.push(row.transactionId);
        exclude(row, 'robust-log-price-outlier');
        return false;
      });
    }
  }
  base.outlierTransactionIds.sort();
  base.includedCount = candidates.length;
  base.excludedCount = rows.length - candidates.length;
  base.includedTransactionIds = candidates.map(row => row.transactionId).sort();
  const weightTotal = candidates.reduce((sum, row) => sum + row.weight, 0);
  const weightSquares = candidates.reduce((sum, row) => sum + row.weight ** 2, 0);
  const effectiveSampleSize = weightSquares ? weightTotal ** 2 / weightSquares : 0;
  base.effectiveSampleSize = roundMetric(effectiveSampleSize);
  const sellers = new Map<string, { weight: number; count: number }>();
  for (const row of candidates) {
    const seller = sellers.get(row.sellerId) || { weight: 0, count: 0 };
    seller.weight += row.weight; seller.count++; sellers.set(row.sellerId, seller);
  }
  let maximumShare = 0;
  base.sellerShares = [...sellers.keys()].sort().map(sellerId => {
    const seller = sellers.get(sellerId)!;
    const share = seller.weight / weightTotal;
    maximumShare = Math.max(maximumShare, share);
    return { sellerId, saleCount: seller.count, weightedShare: roundMetric(share) };
  });
  base.independentSellerCount = sellers.size;
  base.maximumSellerWeightShare = roundMetric(maximumShare);
  let newestAge = Infinity;
  if (candidates.length) {
    const newest = candidates.reduce((time, row) => Math.max(time, row.soldTime), -Infinity);
    const oldest = candidates.reduce((time, row) => Math.min(time, row.soldTime), Infinity);
    newestAge = (asOfTime - newest) / DAY;
    base.newestSaleAgeDays = roundMetric(newestAge);
    base.latestSaleAt = new Date(newest).toISOString();
    base.oldestSaleAt = new Date(oldest).toISOString();
  }
  if (candidates.length < FMV_MODEL_RULES.minimumSales) base.unavailableReasons.push('insufficient-comparable-sales');
  if (sellers.size < FMV_MODEL_RULES.minimumIndependentSellers) base.unavailableReasons.push('insufficient-independent-sellers');
  if (newestAge > FMV_MODEL_RULES.newestSaleMaximumAgeDays) base.unavailableReasons.push('no-recent-comparable-sale');
  if (maximumShare > FMV_MODEL_RULES.maximumSellerWeightShare + 1e-12) base.unavailableReasons.push('seller-weight-concentration');
  if (base.unavailableReasons.length) return finalize();

  const fmv = weightedQuantile(candidates, 0.5);
  const low = weightedQuantile(candidates, 0.25);
  const high = weightedQuantile(candidates, 0.75);
  base.status = 'available';
  base.fmvUsd = money(fmv);
  base.observedRangeUsd = { lowerQuartile: money(low), upperQuartile: money(high) };
  base.reliability = candidates.length >= FMV_MODEL_RULES.strongerSales &&
    sellers.size >= FMV_MODEL_RULES.strongerIndependentSellers &&
    newestAge <= FMV_MODEL_RULES.strongerNewestSaleMaximumAgeDays &&
    effectiveSampleSize >= FMV_MODEL_RULES.strongerEffectiveSampleSize &&
    maximumShare <= FMV_MODEL_RULES.strongerMaximumSellerWeightShare + 1e-12 &&
    (high - low) / fmv <= FMV_MODEL_RULES.strongerMaximumObservedIqrToMedian
    ? 'stronger-observation-support' : 'limited-observation-support';
  return finalize();
}
