import type {
  DealAnalysis, DealPosition, DealReason, ListingItemAnalysis, Queryable,
  QuoteState, PublicDealAnalysis, PublicValuationEvidence, ValuationEvidence,
} from "./types.js";

export const DEAL_MODEL_VERSION = "price-data-heuristic-v1" as const;
export const DEAL_RULES = Object.freeze({ belowAtPercent: 85, overAtPercent: 115, veryLowBelowPercent: 50 });

/** One parameterized, consistent database statement; never use the header edition to value a lot. */
export const MARKETPLACE_ANALYSIS_SQL = `
SELECT f.*, f.asking_price_cents::text AS asking_cents, f.grade::text AS grade_text,
 q.id AS quote_id,q.source_id,q.source_name,q.quote_kind,q.value_cents::text AS quote_cents,
 q.observed_at::text AS observed_at,q.expires_at::text AS expires_at,q.sample_count,
 q.evidence_uri,q.evidence_sha256,q.methodology,q.license_reference_snapshot,
 q.public_attribution,q.public_methodology,q.display_rights_current,
 comichuddle.evaluate_fmv_quote(q.id,$2::timestamptz) AS evaluated_state,
 to_jsonb(e) AS editorial_quote
FROM comichuddle.marketplace_item_facts f
LEFT JOIN LATERAL (
 SELECT c.* FROM comichuddle.fmv_quote_candidates c
 WHERE c.directory_id=f.directory_id AND c.currency=f.currency
   AND c.physical_format=f.physical_format
   AND c.raw_condition IS NOT DISTINCT FROM f.raw_condition
   AND c.grade IS NOT DISTINCT FROM f.grade
   AND c.grading_company IS NOT DISTINCT FROM f.grading_company
   AND c.label_type IS NOT DISTINCT FROM f.label_type
   AND c.comparable_attributes_key=f.comparable_attributes_key
   AND c.observed_at <= $2::timestamptz
 ORDER BY (comichuddle.evaluate_fmv_quote(c.id,$2::timestamptz)='PRICED') DESC,
   (c.quote_kind='SALE_BASELINE') DESC,c.observed_at DESC,c.recorded_at DESC,c.id
 LIMIT 1
) q ON true
LEFT JOIN LATERAL (
 SELECT c.id,c.source_id,c.source_name,c.quote_kind,c.value_cents::text AS value_cents,
   c.observed_at::text AS observed_at,c.expires_at::text AS expires_at,c.sample_count,
   c.evidence_uri,c.evidence_sha256,c.methodology,c.license_reference_snapshot,
   c.public_attribution,c.public_methodology
 FROM comichuddle.fmv_quote_candidates c
 WHERE c.directory_id=f.directory_id AND c.currency=f.currency AND c.quote_kind='EDITORIAL_ESTIMATE'
   AND c.physical_format=f.physical_format AND c.raw_condition IS NOT DISTINCT FROM f.raw_condition
   AND c.grade IS NOT DISTINCT FROM f.grade AND c.grading_company IS NOT DISTINCT FROM f.grading_company
   AND c.label_type IS NOT DISTINCT FROM f.label_type AND c.display_rights_current
   AND c.comparable_attributes_key=f.comparable_attributes_key
   AND c.observed_at <= $2::timestamptz AND c.expires_at > $2::timestamptz
 ORDER BY c.observed_at DESC,c.recorded_at DESC,c.id LIMIT 1
) e ON true
WHERE f.listing_id=$1::uuid ORDER BY f.listing_item_id`;

type AnalysisRow = Record<string, unknown>;
const MAX_DB_CENTS = BigInt("9223372036854775807");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function assertUuid(value: string): void {
  if (!UUID_PATTERN.test(value)) throw new TypeError("Expected a UUID");
}
function money(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) return null;
  const parsed = BigInt(value);
  return parsed <= MAX_DB_CENTS ? parsed : null;
}
function text(value: unknown): string { return String(value ?? ""); }
function nullable(value: unknown): string | null { return value == null ? null : String(value); }
function iso(value: unknown): string {
  const date = new Date(text(value));
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid database evidence timestamp");
  return date.toISOString();
}
function evidence(row: AnalysisRow, quoteIdKey = "quote_id"): ValuationEvidence | null {
  if (!row[quoteIdKey]) return null;
  return {
    quoteId: text(row[quoteIdKey]), sourceId: text(row.source_id), sourceName: text(row.source_name),
    kind: text(row.quote_kind) as ValuationEvidence["kind"], observedAt: iso(row.observed_at),
    expiresAt: iso(row.expires_at), sampleCount: Number(row.sample_count),
    evidenceUri: text(row.evidence_uri), evidenceSha256: text(row.evidence_sha256),
    methodology: text(row.methodology), licenseReference: text(row.license_reference_snapshot),
    publicAttribution: text(row.public_attribution), publicMethodology: text(row.public_methodology),
  };
}

const STATE_REASON: Record<Exclude<QuoteState, "PRICED">, DealReason> = {
  MISSING: "MISSING_BASELINE", STALE: "STALE_BASELINE", LICENSE_UNAVAILABLE: "LICENSE_UNAVAILABLE",
  UNVERIFIED_SOURCE: "UNVERIFIED_SOURCE", INSUFFICIENT_SAMPLE: "INSUFFICIENT_SAMPLE",
  CUSTOM_PENDING_REVIEW: "CUSTOM_PENDING_REVIEW", CONDITION_UNKNOWN: "CONDITION_UNKNOWN",
  EDITORIAL_ONLY: "EDITORIAL_ESTIMATE_ONLY", INVALID_QUOTE: "INVALID_QUOTE",
};
const KNOWN_STATES = new Set<QuoteState>(["PRICED", ...Object.keys(STATE_REASON) as QuoteState[]]);

export class DealAnalysisError extends Error {
  readonly code = "LISTING_NOT_FOUND_OR_NOT_VISIBLE";
  constructor() { super("Listing not found or not visible to this request"); }
}

/** Positive means above baseline. BigInt avoids rounding or overflow in cent arithmetic. */
function variancePercent(asking: bigint, baseline: bigint): number {
  const numerator = (asking - baseline) * BigInt(10_000);
  const sign = numerator < BigInt(0) ? BigInt(-1) : BigInt(1);
  const magnitude = numerator * sign;
  const roundedBps = (magnitude + baseline / BigInt(2)) / baseline;
  return Number(sign * roundedBps) / 100;
}

export async function analyzeMarketplaceDeal(
  db: Queryable,
  listingId: string,
  options: { asOf?: Date } = {},
): Promise<DealAnalysis> {
  assertUuid(listingId);
  const asOf = options.asOf ?? new Date();
  if (!Number.isFinite(asOf.getTime())) throw new TypeError("Invalid asOf date");
  const { rows } = await db.query<AnalysisRow>(MARKETPLACE_ANALYSIS_SQL, [listingId, asOf.toISOString()]);
  if (rows.length === 0) throw new DealAnalysisError();
  const header = rows[0];
  const asking = money(header.asking_cents);
  if (asking === null) throw new Error("Database contract violation: asking price must be positive integer cents");
  const reasons = new Set<DealReason>();
  const warnings = new Set<string>();
  const itemIds = new Set<string>();
  let declared = false;
  const items: ListingItemAnalysis[] = rows.map((row) => {
    if (text(row.listing_id) !== listingId || text(row.asking_cents) !== asking.toString() ||
      row.currency !== header.currency || row.listing_status !== header.listing_status ||
      itemIds.has(text(row.listing_item_id))) {
      throw new Error("Database contract violation: inconsistent or duplicate lot lines");
    }
    itemIds.add(text(row.listing_item_id));
    declared ||= row.metadata_verification !== "VERIFIED";
    const isCustom = row.directory_status !== "CANONICAL";
    let state: QuoteState = isCustom ? "CUSTOM_PENDING_REVIEW"
      : (row.raw_condition === "UNKNOWN" || row.label_type === "UNKNOWN" || row.comparable_attributes_key === "UNKNOWN") ? "CONDITION_UNKNOWN"
      : row.evaluated_state == null ? "MISSING"
      : KNOWN_STATES.has(row.evaluated_state as QuoteState) ? row.evaluated_state as QuoteState : "INVALID_QUOTE";
    const quote = money(row.quote_cents);
    if (state === "PRICED" && (quote === null || row.display_rights_current !== true)) state = "INVALID_QUOTE";
    if (state !== "PRICED") reasons.add(STATE_REASON[state]);
    const editorial = row.editorial_quote as AnalysisRow | null;
    const editorialCents = editorial ? money(editorial.value_cents) : null;
    return {
      listingItemId: text(row.listing_item_id), copyId: text(row.copy_id), directoryComicId: text(row.directory_id),
      title: text(row.title), issueNumber: text(row.issue_number), variant: text(row.variant_name),
      format: row.physical_format as ListingItemAnalysis["format"], rawCondition: nullable(row.raw_condition),
      gradingCompany: nullable(row.grading_company), grade: nullable(row.grade_text), labelType: nullable(row.label_type),
      comparableAttributesKey: text(row.comparable_attributes_key),
      isCustomEntry: isCustom, quoteState: state, fmvCents: state === "PRICED" ? quote!.toString() : null,
      editorialEstimateCents: editorialCents?.toString() ?? null,
      editorialEvidence: editorialCents !== null && editorial ? evidence(editorial, "id") : null,
      evidence: row.display_rights_current === true ? evidence(row) : null,
    };
  });
  const priced = items.filter((item) => item.quoteState === "PRICED");
  const subtotal = priced.reduce((sum, item) => sum + BigInt(item.fmvCents!), BigInt(0));
  const complete = priced.length === items.length && subtotal > BigInt(0);
  const baseline = complete ? subtotal : null;
  let position: DealPosition = "UNKNOWN";
  let riskScore = complete ? 0 : 60;
  let variance: number | null = null;
  if (complete) {
    reasons.add("EXACT_CURRENT_BASELINE");
    variance = variancePercent(asking, subtotal);
    if (asking * BigInt(100) <= subtotal * BigInt(DEAL_RULES.belowAtPercent)) { position = "BELOW_MARKET"; riskScore = 20; }
    else if (asking * BigInt(100) >= subtotal * BigInt(DEAL_RULES.overAtPercent)) { position = "OVERPRICED"; riskScore = 30; }
    else position = "FAIR";
    if (asking * BigInt(100) < subtotal * BigInt(DEAL_RULES.veryLowBelowPercent)) {
      reasons.add("VERY_LOW_ASKING_PRICE"); riskScore = 90;
      warnings.add("The asking price is below half the comparable baseline. Inspect the stated edition, condition and transaction terms carefully.");
    }
  } else {
    if (priced.length > 0) reasons.add("PARTIAL_COVERAGE");
    warnings.add("A complete, current comparable baseline is unavailable. The priced subtotal is not the market value of the whole listing.");
  }
  if (declared) {
    reasons.add("DECLARED_COPY_METADATA"); riskScore = Math.max(riskScore, 10);
    warnings.add("Copy metadata is seller declared. Price comparison does not authenticate the comic or verify the seller.");
  }
  const isCustomEntry = items.some((item) => item.isCustomEntry);
  if (isCustomEntry || header.listing_status === "UNDER_REVIEW") {
    reasons.add("REVIEW_ONLY_LISTING"); riskScore = Math.max(riskScore, 60);
    warnings.add("Custom edition under review: no verified FMV. This preview cannot be purchased.");
  }
  const labels: Record<DealPosition, string> = { BELOW_MARKET: "Below Market", FAIR: "Fair", OVERPRICED: "Overpriced", UNKNOWN: "Unknown" };
  const allEvidence = items.flatMap((item) => [item.evidence, item.editorialEvidence]).filter((e): e is ValuationEvidence => e !== null);
  const uniqueEvidence = [...new Map(allEvidence.map((e) => [e.quoteId, e])).values()];
  return {
    schemaVersion: "1.0", modelVersion: DEAL_MODEL_VERSION, listingId,
    directoryComicId: text(header.directory_comic_id), listingType: header.listing_type as DealAnalysis["listingType"],
    listingStatus: header.listing_status as DealAnalysis["listingStatus"], isCustomEntry, asOf: asOf.toISOString(),
    currency: text(header.currency), askingPriceCents: asking.toString(), baselineCents: baseline?.toString() ?? null,
    pricedSubtotalCents: subtotal.toString(), totalCopies: items.length, pricedCopies: priced.length,
    coveragePercent: Math.round(priced.length / items.length * 10_000) / 100,
    variancePercent: variance, position, badge: { kind: position, label: labels[position] }, riskScore,
    riskKind: "PRICE_DATA_CAUTION",
    riskExplanation: "Heuristic price/data caution from 0 to 100. This is not a fraud probability, seller verification, authenticity assessment, or transaction guarantee.",
    reasons: [...reasons], warnings: [...warnings], items, evidence: uniqueEvidence,
    purchaseEligible: header.listing_status === "ACTIVE" && !isCustomEntry,
  };
}

function publicEvidence(e: ValuationEvidence): PublicValuationEvidence {
  return { source: e.publicAttribution, kind: e.kind, observedAt: e.observedAt, expiresAt: e.expiresAt,
    sampleCount: e.sampleCount, methodology: e.publicMethodology };
}
/** Mandatory boundary before any buyer HTTP response or product-card props. */
export function publicDealAnalysis(result: DealAnalysis): PublicDealAnalysis {
  return {
    ...result,
    items: result.items.map(({ evidence: e, editorialEvidence, ...item }) => ({ ...item,
      evidence: e ? publicEvidence(e) : null, editorialEvidence: editorialEvidence ? publicEvidence(editorialEvidence) : null })),
    evidence: result.evidence.map(publicEvidence),
  };
}
