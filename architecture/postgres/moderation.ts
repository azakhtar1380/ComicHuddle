import { assertUuid } from "./analyzer.js";
import type { MergeCustomEditionInput, MergeCustomEditionResult, Queryable } from "./types.js";

export interface CustomDirectoryInput {
  title: string;
  issueNumber: string;
  publisher: string;
  variantName?: string;
  variantCode?: string;
  seriesStartYear?: number | null;
  submissionEvidence?: Record<string, unknown>;
}
export interface CustomDirectoryResult { directoryId: string; reviewId: string; version: string; status: "PROVISIONAL" }
export interface ApproveCustomEditionInput {
  reviewId: string;
  canonicalEditionKey: string;
  seriesStartYear: number;
  expectedVersion: string;
  requestId: string;
  actorUserId: string;
}
export interface ApproveCustomEditionResult { outcomeId: string; outcome: "APPROVED"; directoryId: string; version: string }

/** Use before assigning a current-copy FK or redirecting an old directory URL. */
export async function resolveDirectoryId(db: Queryable, directoryId: string): Promise<string | null> {
  assertUuid(directoryId);
  const { rows } = await db.query<Record<string,unknown>>(
    "SELECT comichuddle.resolve_directory_id($1::uuid)::text AS directory_id", [directoryId]);
  return rows[0]?.directory_id == null ? null : String(rows[0].directory_id);
}

function version(value: string): void {
  if (!/^[1-9][0-9]*$/.test(value) || BigInt(value) > BigInt("9223372036854775807")) {
    throw new TypeError("Expected a positive PostgreSQL bigint version string");
  }
}
function nonempty(value: string): string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError("Required text is missing");
  return value.trim();
}

/** Must run in the authenticated request transaction. Every custom has a real directory FK immediately. */
export async function createCustomDirectoryEntry(
  db: Queryable, input: CustomDirectoryInput, actorUserId: string,
): Promise<CustomDirectoryResult> {
  assertUuid(actorUserId);
  const { rows } = await db.query<Record<string, unknown>>(`
    SELECT directory_id::text,review_id::text,version::text
    FROM comichuddle.create_custom_directory_entry($1,$2,$3,$4,$5,$6,$7::jsonb,$8::uuid)`,
    [nonempty(input.title), nonempty(input.issueNumber), nonempty(input.publisher),
      nonempty(input.variantName ?? "Unverified variant"), nonempty(input.variantCode ?? "unverified"),
      input.seriesStartYear ?? null, JSON.stringify(input.submissionEvidence ?? {}), actorUserId]);
  if (rows.length !== 1) throw new Error("Custom entry contract returned no identity");
  return { directoryId: String(rows[0].directory_id), reviewId: String(rows[0].review_id), version: String(rows[0].version), status: "PROVISIONAL" };
}

/** SQL owns the locks, optimistic version check, remap, alias and one idempotent audit outcome. */
export async function mergeCustomEdition(db: Queryable, input: MergeCustomEditionInput): Promise<MergeCustomEditionResult> {
  [input.reviewId,input.targetDirectoryId,input.requestId,input.actorUserId].forEach(assertUuid);
  version(input.expectedSourceVersion); version(input.expectedTargetVersion);
  const { rows } = await db.query<Record<string, unknown>>(`
    SELECT outcome_id::text,outcome,source_directory_id::text,target_directory_id::text,
      source_version::text,target_version::text,moved_copies,moved_listing_items
    FROM comichuddle.merge_custom_edition($1::uuid,$2::uuid,$3::bigint,$4::bigint,$5::uuid,$6::uuid)`,
    [input.reviewId,input.targetDirectoryId,input.expectedSourceVersion,input.expectedTargetVersion,input.requestId,input.actorUserId]);
  if (rows.length !== 1) throw new Error("Merge contract returned no outcome");
  const row = rows[0];
  return { outcomeId: String(row.outcome_id), outcome: "MERGED", sourceDirectoryId: String(row.source_directory_id),
    targetDirectoryId: String(row.target_directory_id), sourceVersion: String(row.source_version), targetVersion: String(row.target_version),
    movedCopies: Number(row.moved_copies), movedListingItems: Number(row.moved_listing_items) };
}

/** Identity approval has no FMV input and creates no quote. An estimate is a separate evidence workflow. */
export async function approveCustomEdition(db: Queryable, input: ApproveCustomEditionInput): Promise<ApproveCustomEditionResult> {
  [input.reviewId,input.requestId,input.actorUserId].forEach(assertUuid); version(input.expectedVersion);
  if (!Number.isInteger(input.seriesStartYear) || input.seriesStartYear < 1800 || input.seriesStartYear > 9999) {
    throw new TypeError("Invalid series start year");
  }
  const { rows } = await db.query<Record<string, unknown>>(`
    SELECT outcome_id::text,outcome,directory_id::text,version::text
    FROM comichuddle.approve_custom_edition($1::uuid,$2,$3::integer,$4::bigint,$5::uuid,$6::uuid)`,
    [input.reviewId,nonempty(input.canonicalEditionKey),input.seriesStartYear,input.expectedVersion,input.requestId,input.actorUserId]);
  if (rows.length !== 1) throw new Error("Approval contract returned no outcome");
  return { outcomeId: String(rows[0].outcome_id), outcome: "APPROVED", directoryId: String(rows[0].directory_id), version: String(rows[0].version) };
}
