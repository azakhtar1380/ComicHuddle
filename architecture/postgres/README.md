# PostgreSQL reference backend

This is an isolated PostgreSQL 18 design and runnable implementation for the ComicHuddle blueprint. The deployed application continues to use Cloudflare D1. These files have not changed its database, migration history, credentials, hosting configuration, or production routes.

`schema.sql` creates a new `comichuddle` schema in an **empty review database**. `roles.sql` assigns only that schema's objects to a dedicated `NOLOGIN` owner and grants narrowly scoped server capabilities. Do not run either file against the existing production database. The future D1-to-PostgreSQL importer, dual-write/change capture, operational cutover, and rollback plan require a separate reviewed migration.

## Files and executable contracts

| File | Responsibility |
| --- | --- |
| `schema.sql` | Tables, exact edition and physical-copy constraints, review quarantine, immutable finance/provenance, projections, transactional moderation functions, base RLS |
| `roles.sql` | Nonowner server roles, grants, owner isolation and moderator read policies |
| `types.ts` | Versioned internal/public analysis DTOs; integer-string money; no seller-trust badge |
| `analyzer.ts` | Parameterized exact-comparable lot analysis and mandatory buyer projection |
| `moderation.ts` | Custom identity creation, identity-only approval, merge function adapters |
| `session.ts` | Pooled request transaction, fixed `SET LOCAL ROLE`, trusted actor context, commit/rollback/release |
| `api.ts` | Framework-neutral reference HTTP handlers; verified-auth dependency; no production route wiring |
| `analyzer.test.ts`, `run-unit-tests.mjs` | Focused pricing, partial coverage, privacy, request and transaction tests |
| `tests/` | Independent real PostgreSQL 18 engine/schema/role/API integration tests; engine dependencies isolated from the app |
| `ui/ComicProductCard.tsx` | Separate product-card reference owned by the frontend blueprint |

Run focused tests from the repository root:

```sh
node architecture/postgres/run-unit-tests.mjs
```

The runner uses the project's existing TypeScript compiler and writes compiled test files to a disposable temporary directory. It does not install or modify production dependencies. Independent database test invocation and limitations are recorded in `tests/` and the project's architecture QA report.

## Identity and inventory

`directory_comics` represents **one exact edition**, not a broad title or all variants of an issue. It stores title, issue, publisher, series start year, variant name/code, printing, language and publication date. A unique partial index prevents two canonical rows for the same normalized edition dimensions. `canonical_edition_key` is also unique. A provider's external edition ID maps to exactly one directory UUID through `directory_provider_crosswalk`; unreviewed OCR/search text cannot replace that UUID.

Character debuts are normalized in `directory_character_debuts`. Each claim has a type and verification status; a verified claim requires source and evidence. A cameo or disputed first appearance must not be silently promoted to an unconditional first full appearance.

Every custom submission creates a stable **PROVISIONAL directory row and PENDING review row in the same transaction**. A deferred constraint trigger prevents an orphan custom directory row. The queue submitter must equal its creator. Missing search results never authorize a null `marketplace_listings.directory_comic_id` or an unlinked free-text marketplace identity.

`user_collections` represents **one physical copy**. Its owner and UUID are stable. It contains a nonnull directory FK, raw condition or slab grade/company/label, certification number when known, explicit premium comparison key, purchase cost/currency, private notes (at most 500 characters) and disposition. Notes remain owner-private and are excluded from marketplace facts, analysis DTOs and order copy snapshots. Two copies of the same edition are valid; there is intentionally no `UNIQUE(user_id, directory_id)`. Duplicate held certificates for the same owner/grader and duplicate external inventory copy IDs are blocked independently of edition, so merging editions does not collapse distinct physical copies. Duplicate imported physical-copy records must be reconciled before import rather than silently deleting one in moderation.

Current grade sanity permits a finite numeric grade from 0.5 to 10 with at most one decimal. It does not certify an issuer's complete discrete grade scale or authenticate a certificate. Reviewed ingestion and certificate lookup must additionally validate the actual grading company's supported grades and label semantics. `metadata_verification='DECLARED'` is the default and produces an explicit warning. Collector column grants exclude this flag; sellers cannot promote their own metadata to VERIFIED. The reference contains no public copy-verification setter.

Raw format requires a condition and null grade/company/label/certificate. Graded format requires grade, company and label with a null raw condition. `UNKNOWN` condition/label/comparison key cannot receive a baseline. A `comparable_attributes_key` describes reviewed page quality, signature details, restoration, pedigree and other price premiums; the analyzer requires an **exact key match**. Copies default to `UNKNOWN`; premium labels cannot use a plain no-premium key. The v1 taxonomy is an ingestion contract, not an OCR inference.

## Lots and copy reservations

The listing header has a nonnull directory ID as an **anchor**. Its `listing_items` identify every exact physical copy and exact edition in the lot. Composite FKs enforce `(listing_id, seller_id)` and `(copy_id, seller_id)` ownership. Deferred cross-table triggers enforce the line's directory identity against the current copy for unsold listings. No cross-table `CHECK` is used.

The anchor must be present among the lot lines. A `SINGLE` listing cannot contain two copies. `is_custom_entry` is an enforced aggregate over every unsold line: one provisional line makes the lot custom even when its anchor is canonical. ACTIVE/RESERVED require canonical editions and held copies. Customs may have an explicit `UNDER_REVIEW` preview, but cannot enter checkout or an OPEN bid; they are excluded from default marketplace reads. A buyer must explicitly request the review preview, which remains read only.

`one_active_listing_per_physical_copy` is a partial unique index on each active/reserved copy. Header status transitions synchronize every line reservation. SOLD releases those reservations, marks the original owner's copy record SOLD and seals the listing's physical-copy identities/header. A resale must create a new ownership record; this design does not claim physical custody.

## FMV, license and evidence rules

`fmv_history` is append only. Each row identifies the exact edition, format, raw condition or grader/grade/label, premium key, currency, observation timestamp and source. Values are positive `bigint` cents, so zero, negative, `NaN` and infinity cannot become an FMV baseline. Purchase costs and allocated order-line amounts may be zero; they are not FMV.

Quote provenance includes immutable license/verification/freshness/sample-policy snapshots, evidence URI and SHA-256, completed-sales window, methodology, recording actor and source. Baseline eligibility requires a reviewed source. Insertion snapshots source policy rather than trusting caller-supplied license flags; the ingestion role's insert policy binds the recording actor to trusted transaction context. The following rule deliberately does not claim any estimate is an official market price:

| Quote kind | Baseline behavior |
| --- | --- |
| `SALE_BASELINE` | Requires canonical edition, LICENSED_SALES/VERIFIED_SALES source, reviewed verification, current commercial display rights and sufficient samples; read time rechecks current source policy, source license expiry and freshness |
| `EDITORIAL_ESTIMATE` | May hold an explicit administrative estimate with evidence; never becomes sale-based FMV or a deal-classification baseline |
| `UNVERIFIED_CLAIM` | Preserved as provenance; never treated as a baseline |

Current policy cannot extend an old quote's snapshotted freshness or license period: evaluation uses the more restrictive current/snapshot limits. A verification downgrade, rights revocation, higher sample requirement or expired source makes a previous baseline unavailable. No example quote data or production supplier credentials are included; supplier agreements and evidence review remain actual operational work.

`directory_comics_fmv` provides the four requested convenience fields as a **live, noneditable view** over eligible quotes:

| Field | Exact projection |
| --- | --- |
| `raw_fmv_cents` | RAW, NEAR_MINT, STANDARD premium key, USD |
| `cgc_9_8_fmv_cents` | CGC 9.8, UNIVERSAL, CGC_WHITE_NO_PREMIUM, USD |
| `cgc_9_6_fmv_cents` | CGC 9.6, UNIVERSAL, CGC_WHITE_NO_PREMIUM, USD |
| `cgc_9_0_fmv_cents` | CGC 9.0, UNIVERSAL, CGC_WHITE_NO_PREMIUM, USD |

A null field means unavailable, not zero. Every other label, grade, condition, premium or currency uses normalized quote rows rather than borrowing these convenience fields. A Signature Series slab cannot use a Universal slab quote; a restored book cannot use an unrestored quote; no currency conversion or grade interpolation is implicit.

## Analyzer and public badge contract

```ts
analyzeMarketplaceDeal(db: Queryable, listingId: string, { asOf?: Date }): Promise<DealAnalysis>
publicDealAnalysis(internal: DealAnalysis): PublicDealAnalysis
```

The analyzer issues one parameterized SQL statement. `listingId` and the server's `asOf` timestamp are values, not SQL interpolation. It obtains all sanitized copy facts and the best eligible exact quote per line, then sums integer cents with `BigInt`. Prices are serialized as integer decimal strings to avoid JavaScript money precision loss.

`schemaVersion='1.0'` and `modelVersion='price-data-heuristic-v1'` are separate. Changing thresholds or the caution formula requires a new model version. Positive variance means asking above baseline: `(asking - baseline) / baseline * 100`, rounded to 0.01 percentage points. Comparisons themselves use exact integer ratios, not the rounded display value.

| Full exact coverage price ratio | Position | Base caution score |
| --- | --- | --- |
| Asking <= 85% of baseline | Below Market | 20 |
| 85% < asking < 115% | Fair | 0 |
| Asking >= 115% | Overpriced | 30 |
| Asking < 50% | Below Market plus very-low-price warning | 90 |
| Any missing, stale, unlicensed, insufficient, unknown, invalid or custom line | Unknown | 60 |

Seller-declared metadata imposes a minimum score of 10; review-only previews impose a minimum 60. Scores are deterministic **PRICE/DATA CAUTION**, not fraud probabilities, authenticity assessments, seller verification or transaction guarantees. A zero score can only mean no caution rule fired for the available data. The contract's badge enum permits Below Market/Fair/Overpriced/Unknown; it cannot emit a price-derived "Secure Deal" badge. An inexpensive book can remain a low-price caution case.

If only part of a lot is priced, `baselineCents` and `variancePercent` are null and the position is Unknown. `pricedSubtotalCents`, `pricedCopies`, `totalCopies`, `coveragePercent`, per-line states and evidence remain available. A subtotal of `"0"` describes no priced lines and is never a zero FMV. Editorial estimates, when their display rights and freshness permit display, are separately labeled and do not fill coverage gaps.

The internal DTO contains private proof URI/hash and license references. **Never pass it directly to HTTP or a buyer card.** `publicDealAnalysis()` removes those fields and private supplier/method text; its evidence contains only approved public attribution, quote kind, dates, sample count and reviewed public methodology. No purchase cost, certificate or contributor proof appears in `marketplace_item_facts`.

## Moderation transaction

```sql
comichuddle.merge_custom_edition(
  review_id uuid, target_directory_id uuid,
  expected_source_version bigint, expected_target_version bigint,
  request_id uuid, authenticated_actor_user_id uuid
)
```

Only the moderator server capability may execute this function. The function independently checks that the trusted transaction actor matches an active MODERATOR/ADMIN membership. The role alone is insufficient. Its owner is a dedicated NOLOGIN schema owner; `search_path` is pinned to trusted schemas with `pg_temp` last, and PUBLIC execution is revoked.

Within the caller's transaction it:

1. Locks the idempotency request key and replays the previous exact request outcome, rejecting key reuse with different inputs.
2. Locks the review and both stable edition UUIDs in order; verifies pending/provisional source, canonical target and both expected versions.
3. Locks affected unsold listing headers and physical-copy records; remaps collection directory FKs and unsold line/anchor IDs.
4. Recomputes custom status across the entire lot. A fully resolved UNDER_REVIEW listing becomes DRAFT, leaving publication an explicit seller action.
5. Keeps the source UUID as an ALIASED row pointing directly to the canonical UUID, resolves the review and writes one append-only audit outcome. `resolve_directory_id(uuid)` resolves old/provider IDs to that canonical UUID without exposing another submitter's provisional metadata; `resolveDirectoryId()` is its parameterized TypeScript adapter.

Sold lines, bid prices, order totals, order edition/copy/evidence snapshots and previous FMV history are preserved. Financial identities cannot be mutated or deleted; order-item snapshots automatically capture actual directory/copy metadata. Order allocations must sum to the immutable total and cover every physical-copy line. A partial unique order index prevents a second live order for the same listing.

The entire merge rolls back if any late check/audit insert fails. A retry using the same request UUID returns the same audit outcome; an obsolete version or detected lock deadlock returns HTTP 409. The copy-assignment trigger locks and rechecks the edition before accepting its current FK, so a concurrent merge cannot leave a new copy pointing to an alias. Merge header recomputation is limited to the captured affected listings; unrelated canonical listings keep their versions. Production must retry SQLSTATE 40P01/40001 with bounded backoff and the same request identity after reloading required versions; index/FK/trigger guarantees do not replace separate multi-connection race testing under the chosen driver and isolation level.

`approve_custom_edition()` is a separate identity-only resolution for an independently verified new edition. It preserves the provisional UUID, verifies version/admin membership, makes the edition canonical, resolves its review and records an idempotent audit. It has no price input and inserts no FMV quote. Administrative evidence can subsequently create a separately labeled editorial estimate, or an actually licensed verified-sales baseline through the ingestion capability.

## Authenticated server boundary

| Capability role | Access |
| --- | --- |
| `comichuddle_owner` | NOLOGIN object owner; used only by narrowly reviewed definer functions and migrations |
| `comichuddle_reader` | Canonical directory/projection and sanitized marketplace facts |
| `comichuddle_collector` | Own copies/listings/reviews via RLS; provisional custom creation; no valuation/identity approval |
| `comichuddle_valuator` | Sanitized facts and privileged quote candidates; server-only analyzer |
| `comichuddle_moderator` | Active-admin queue read, audited moderation functions and active-admin source-policy RLS; no unrestricted directory writes |
| `comichuddle_ingest` | Read-only approved supplier policy and append-only valuation ingestion; cannot license or verify itself |
| `comichuddle_commerce` | Separately authenticated financial service integration; party RLS and immutable snapshots |

RLS applies to nonowner roles. Owners and superusers can bypass it, so a production request connection must never run as the schema owner, superuser or BYPASSRLS role. `roles.sql` intentionally leaves the owner outside forced RLS so the reviewed moderation functions can remap all affected owners' copies atomically. Sanitized owner-executed views use explicit visibility filters; they do not expose private collection columns.

`app.user_id` and `app.review_preview` are trusted **server context**, not self-authenticating PostgreSQL settings. An untrusted SQL client can set custom GUCs. Browser clients must never receive database credentials, choose roles or execute arbitrary SQL. `api.ts` requires an injected verified session/JWT authenticator. Route parameters/body cannot supply the acting user. `session.ts` binds the verified actor and fixed capability in a request transaction and resets pooled state through COMMIT/ROLLBACK.

Reference routes are GET `/api/marketplace/:id/deal-analysis`, POST `/api/directory/custom`, POST `/api/admin/directory-reviews/:id/merge` and POST `/api/admin/directory-reviews/:id/approve`. Review-only buyer reads require `?preview=under-review`. Responses are private/no-store, do not leak raw SQL/license errors, and return meaningful 401/403/404/409 states. A not-found ID is never synthesized into a zero-value comic.

Cookie/BFF mutations require an `Origin` header that exactly matches `ApiDependencies.publicOrigin`, a canonical trusted deployment origin; request Host/forwarded headers cannot choose it. Missing or foreign origin fails closed with 403. Mutations require `application/json` and read actual streamed UTF-8 bytes with a default 16 KiB cap (`maxMutationBodyBytes` is trusted server config). Malformed/invalid UTF-8 JSON returns 400, non-JSON returns 415, oversized bodies return 413; a false Content-Length cannot evade the streaming cap. These checks run before database work. Rate limits, actual issuer/session verification and cookie settings, validated ingestion, payment state transitions/outbox and operational audit shipping remain production integration work.

The reference does not implement custody, physical grading, escrow, authenticated seller fraud scoring, a licensed pricing feed, or the production D1 cutover. Those are separate capabilities and cannot be inferred from price similarity.

## PostgreSQL design sources

The implementation uses `NOT NULL` plus row-local checks because [PostgreSQL CHECK constraints permit a null result and do not enforce cross-table data](https://www.postgresql.org/docs/18/ddl-constraints.html). Composite FKs and deferred triggers enforce cross-table identities. Referencing-side FK indexes are explicit; PostgreSQL does not create them automatically.

[PostgreSQL row-security documentation](https://www.postgresql.org/docs/18/ddl-rowsecurity.html) explains default deny, command/role policies and owner/superuser bypass. [CREATE FUNCTION security guidance](https://www.postgresql.org/docs/18/sql-createfunction.html) informs fixed search paths and revoked PUBLIC execution for definer functions. [View privilege rules](https://www.postgresql.org/docs/18/rules-privileges.html) explain why sanitized owner-executed read models require explicit filters rather than an assumption that base-table RLS will protect them.
