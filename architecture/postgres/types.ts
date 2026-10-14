/** Reference contract only: the deployed application still uses D1. */
export type UUID = string;
export type Cents = string; // integer decimal string; never a floating-point money value
export type Queryable = {
  query<T extends Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
};

export type ListingStatus =
  | "DRAFT" | "UNDER_REVIEW" | "ACTIVE" | "RESERVED" | "SOLD" | "WITHDRAWN";
export type QuoteState =
  | "PRICED" | "MISSING" | "STALE" | "LICENSE_UNAVAILABLE"
  | "UNVERIFIED_SOURCE" | "INSUFFICIENT_SAMPLE" | "CUSTOM_PENDING_REVIEW"
  | "CONDITION_UNKNOWN" | "EDITORIAL_ONLY" | "INVALID_QUOTE";
export type DealPosition = "BELOW_MARKET" | "FAIR" | "OVERPRICED" | "UNKNOWN";
export type DealReason =
  | "EXACT_CURRENT_BASELINE" | "PARTIAL_COVERAGE" | "CUSTOM_PENDING_REVIEW"
  | "MISSING_BASELINE" | "STALE_BASELINE" | "LICENSE_UNAVAILABLE"
  | "UNVERIFIED_SOURCE" | "INSUFFICIENT_SAMPLE" | "CONDITION_UNKNOWN"
  | "EDITORIAL_ESTIMATE_ONLY" | "INVALID_QUOTE" | "VERY_LOW_ASKING_PRICE"
  | "DECLARED_COPY_METADATA" | "REVIEW_ONLY_LISTING";

export interface ValuationEvidence {
  quoteId: UUID;
  sourceId: UUID;
  sourceName: string;
  kind: "SALE_BASELINE" | "EDITORIAL_ESTIMATE" | "UNVERIFIED_CLAIM";
  observedAt: string;
  expiresAt: string;
  sampleCount: number;
  evidenceUri: string;
  evidenceSha256: string;
  methodology: string;
  licenseReference: string;
  publicAttribution: string; // reviewed display text; supplier contracts remain private
  publicMethodology: string;
}

export interface ListingItemAnalysis {
  listingItemId: UUID;
  copyId: UUID;
  directoryComicId: UUID;
  title: string;
  issueNumber: string;
  variant: string;
  format: "RAW" | "GRADED";
  rawCondition: string | null;
  gradingCompany: string | null;
  grade: string | null;
  labelType: string | null;
  comparableAttributesKey: string;
  isCustomEntry: boolean;
  quoteState: QuoteState;
  fmvCents: Cents | null;
  editorialEstimateCents: Cents | null;
  editorialEvidence: ValuationEvidence | null;
  evidence: ValuationEvidence | null;
}

export interface DealAnalysis {
  schemaVersion: "1.0";
  modelVersion: "price-data-heuristic-v1";
  listingId: UUID;
  directoryComicId: UUID; // lot anchor; never the valuation of the whole lot
  listingType: "SINGLE" | "LOT";
  listingStatus: ListingStatus;
  isCustomEntry: boolean; // aggregate: any noncanonical line
  asOf: string;
  currency: string;
  askingPriceCents: Cents;
  baselineCents: Cents | null; // present only with 100% exact current coverage
  pricedSubtotalCents: Cents;
  totalCopies: number;
  pricedCopies: number;
  coveragePercent: number;
  variancePercent: number | null; // (asking - baseline) / baseline, rounded to .01%
  position: DealPosition;
  badge: { kind: DealPosition; label: string };
  riskScore: number; // deterministic 0..100 PRICE/DATA CAUTION heuristic
  riskKind: "PRICE_DATA_CAUTION";
  riskExplanation: string; // never fraud probability, seller verification, or proof
  reasons: DealReason[];
  warnings: string[];
  items: ListingItemAnalysis[];
  evidence: ValuationEvidence[];
  purchaseEligible: boolean;
}

export interface PublicValuationEvidence {
  source: string;
  kind: ValuationEvidence["kind"];
  observedAt: string;
  expiresAt: string;
  sampleCount: number;
  methodology: string;
}
export type PublicListingItemAnalysis = Omit<ListingItemAnalysis, "evidence" | "editorialEvidence"> & {
  evidence: PublicValuationEvidence | null;
  editorialEvidence: PublicValuationEvidence | null;
};
export type PublicDealAnalysis = Omit<DealAnalysis, "items" | "evidence"> & {
  items: PublicListingItemAnalysis[];
  evidence: PublicValuationEvidence[];
};

export interface MergeCustomEditionInput {
  reviewId: UUID;
  targetDirectoryId: UUID;
  expectedSourceVersion: string;
  expectedTargetVersion: string;
  requestId: UUID;
  actorUserId: UUID; // from authenticated server context; never request JSON
}

export interface MergeCustomEditionResult {
  outcomeId: UUID;
  outcome: "MERGED";
  sourceDirectoryId: UUID;
  targetDirectoryId: UUID;
  sourceVersion: string;
  targetVersion: string;
  movedCopies: number;
  movedListingItems: number;
}
