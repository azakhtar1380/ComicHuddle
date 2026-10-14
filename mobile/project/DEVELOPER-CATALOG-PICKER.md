# Catalog picker and account journey backend

The Add Comic picker can search the existing starter bibliography, select a specific directory ID, and save that identity with a physical owned-copy record. No catalog rows, modern cover artwork, live prices or image rights were invented. Existing authorized covers and their provenance remain available; absent covers require the UI placeholder.

## Catalog contract

`GET /api/catalog?q=Spider-Man%20%23300&limit=12&offset=0` returns:

```ts
{
  issues: CatalogSearchIssue[],
  total: number, limit: number, offset: number, hasMore: boolean,
  scope: 'starter', issueCount: number, asOf: string, rights: string
}
```

`CatalogSearchIssue` retains the existing `Issue` fields and adds `series` (the canonical title), `issue` (`#` plus the issue number), `edition` (the existing variant description), and `keyInfo: {kind, note}`. Publisher, year, creators, characters and source/credit/license fields remain available. Cover fields appear only when the existing record includes authorized artwork. The edition wording honestly states when printing remains unconfirmed.

Search ignores punctuation and whitespace between title words, supports explicit issue numbers such as `#300`, and preserves separate records for ambiguous editions such as the 1963 and 1991 X-Men #1. Results have deterministic ranking with the stable directory ID as the tie breaker. Pagination never merges those IDs.

| Parameter | Contract |
| --- | --- |
| `q` | At most 160 characters after trimming |
| `limit` | Integer 1–30; default 12 |
| `offset` | Integer 0–100,000; default 0 |
| `id` | Exact nonnegative integer; used separately from search parameters |

Malformed, repeated or conflicting recognized parameters return a controlled 400. Unknown exact IDs return 404. No-query GET preserves the previous complete small starter-list response. Responses use `Cache-Control: no-store`.

## Owned-copy identity

`vaultSaveSchema` validates POSTs separately from legacy-compatible `vaultSchema` reads. Explicit catalog IDs must exist and match the submitted series and issue number. Compatible case, punctuation and optional issue `#` formatting are accepted, then canonical title/issue labels are stored from the server catalog. Unknown IDs and conflicting labels fail before storage. Distinct physical copies retain distinct copy IDs even when they select the same directory issue.

Canonicalization preserves condition text, the collector's private estimate, owned photo ID, trade selection and the existing ETag/If-Match concurrency protection. Manual records omit `catalogId`, retain their entered labels and do not become licensed FMV records. A legacy mislabeled link remains readable so the collector can correct or unlink it; it cannot be used to publish a new mismatched listing or contribute to licensed FMV. An explicit mismatched link also cannot resolve to the wrong directory identity in trade/display helpers.

The existing unique-title/issue fallback remains for unlinked legacy display and trade matching. It never persists a catalog ID or supplies FMV, and ambiguous editions cannot resolve through that fallback. The new Add Comic form deliberately distinguishes explicit selection from manual entry.

## Verified journey fixes

Actual-route QA reproduced seven defects, which this change corrects:

- Account export now uses the same provider-intake-address masking as pressing request reads. An unaccepted quote does not reveal the provider's private shipping address or notes to the collector.
- New care requests create their conversation, job and initial event in one atomic batch. A storage failure leaves no new orphan conversation or request.
- Quote, approval and custody-stage changes commit their timeline receipt in the same batch. Guards recheck the current status, quote revision and actor before mutation; stale or raced operations return 409.
- Account deletion checks active custody inside its deletion transaction. A quote accepted after the preliminary read prevents deletion and preserves the request and both participants.
- Dependent cleanup always resolves current job events/review associations, provider reviews, listing offers and thread messages inside the deletion transaction. A newly arriving unaccepted request or message cannot leave orphan records because an earlier read was empty. Cleanup runs before historical seller IDs are anonymized.

The shared `lib/operation-guard.ts` uses the already applied `operation_guard` table. Conditional guard inserts always write a `CASE` value so a false condition trips the named CHECK and rolls back the batch; successful batches remove their guard rows last. Marketplace behavior and idempotency remain intact. No migration, schema, seed or runtime DDL changed; applied migrations 0000–0006 are untouched.

## Validation and limits

Developer verification passes TypeScript, network smoke and 35 actual-route/client-payload journey groups. Those journeys cover collector account creation/edit/consent, exact and manual catalog selection, photo/private-estimate ownership, presser registration and management, mail/drop-off custody, role/quote races, failed receipt storage, account export/deletion, late-record cleanup, reviews, fixed-price offers and private messages. QA owns the additional commerce/privacy/client regressions and their final counts.

These checks use the actual route and Drizzle code with isolated SQLite/R2 fixtures; they do not claim device or hosted identity/browser testing. Auctions remain timed, nonbinding private previews. Fixed-price checkout still returns its explicit disconnected response, creating no order or charge. Real payments, complete licensed catalog/FMVs, image permissions and public/store launch remain owner-controlled release work.
