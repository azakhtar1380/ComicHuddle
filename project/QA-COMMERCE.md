# ComicHuddle marketplace QA — 9 October 2026

Report compiled by the project lead from the independent QA agent's frozen suite, reported findings and successful test executions. The team reviewed the actual changed routes and client helpers; these results do not represent rendered browser/device or live hosted testing.

## Outcome

**49 of 49 marketplace groups passed**, with no unresolved automated route failures. The existing **34 backend negative groups**, **26 actual client response-order groups**, broad functional network smoke, private-cache checks and dialog/focus checks also pass. Web TypeScript passes. The native prototype passes its seven viewport image-bound checks and TypeScript; web/iOS/Android bundle exports succeed.

The new suite is `checks/marketplace-smoke.mjs`, included in `checks/run-readiness.mjs`. It executes actual route modules in an isolated SQLite/D1-style fixture with an R2-style media fixture and controlled server time. Four groups execute actual client valuation/countdown helpers extracted from source. Fixture estimates are explicitly synthetic licensed-data test records, not a commercial data contract, real market prices or data deployed to the website.

## Behaviors verified

| Area | Evidence |
| --- | --- |
| Singles and collection lots | Owned selection, immutable safe snapshots, every selected copy preserved, physical quantities summed correctly, whole 1,000-copy vault, bounded payloads and owned photos |
| Current card FMV | Exact explicit catalog identity and structured condition; no title inference, grade/label/printing substitution or private purchase costs; full/partial/unavailable coverage; stale, expired and malformed rights rejected |
| Inventory integrity | Conflicting singles/lots/auctions rejected, simultaneous lot creation has one winner with complete rollback of the loser, stale-vault publication rejected transactionally, withdrawal/cancellation and expired relisting release reservations appropriately |
| Auction acceptance | USD integer cents, server cutoff, disclosed increments, explicit consent, self/block/visibility/restriction controls, malformed deadlines fail closed, fixed-price purchase/offer actions rejected for auctions |
| Concurrent bids and retries | Equal competing proposals produce one accepted leader; identical concurrent request IDs produce one receipt plus duplicate success; changed retry payload rejected; newly imposed blocks rechecked in the atomic batch |
| Retraction | Own latest receipt only, no late or foreign retraction, leading proposal reset without reinstating earlier proposals, outbid retraction preserves the current leader, bid audit count retained |
| Privacy and portability | Bidder identity and request receipts excluded from other members' DTOs; private costs/license details excluded; exports contain only the account's bids and inventory reservations; listing/photo retrieval obeys identity, blocks, visibility and withdrawal |
| Deletion and history | Still-open proposals prevent bidder deletion until retraction; seller accepted history requires owner cancellation; closed/cancelled bidder history anonymized; seller/bidder deletion races roll back rather than erasing a newly accepted proposal or profile/photo state |
| Owner support | Owner-only cancellation and recent queue; exact older/hidden lookup beyond the latest 100; malformed lookup ID rejected; active proposals annulled and inventory reusable after cancellation |
| Existing message overview | Each thread returns its own latest private message rather than a correlated-query shadowing error |

The dense read fixture stays within established prepared-query budgets: **social 23/40**, **Workshop 20/40**, **private care detail 6/10**. These are local query counts, not hosted latency or capacity measurements.

## Findings corrected during review

The first marketplace QA run had 31 passing groups of 38. It found that accepted bids updated the current amount but the bidder's own receipt was missing from returned listing data. That prevented retraction through the UI. The developer corrected the qualified correlated query, and receipt/privacy/retraction cases pass. Review also corrected the analogous latest-message query and added malformed-deadline checks so invalid stored auction times fail closed.

The lead corrected the client value-refresh failure path to clear previously loaded estimates and mask aggregate values during feed failure, guarded bid actions at the amount cap, and aligned listing drafts with explicit catalog/condition matching. Source review and the helper cases establish the implemented logic; these changes have not received visual hardware QA.

The final six focused cases verify stale-vault publication, eligibility changing before publication, concurrent identical retries, seller and bidder deletion races, and malformed auction deadlines. They exercise the actual transactional guards with controlled changes before the atomic batch begins. A transaction cannot interleave another transaction midway through its statements. They are regression groups, not a claim of six distinct production defects or a full penetration test.

## Release limits

The automated candidate is suitable for the existing owner-private preview. It does **not** grant public-production, binding-auction, paid-commerce or native-store approval.

- Actual desktop/iPhone/Android/PWA and installed native journeys, large text, keyboard/screen-reader use, visual cover bounds, slow/offline networks and repeated account/modal interactions still need supported real-browser/device testing.
- Hosted identity, migration/storage behavior, limits, load, monitoring, backup/restore and incident response have not been tested against live customer records. Schema migrations were verified in isolated SQLite fixtures. The legacy listing-data conversion runs separately as bounded, authenticated-seller initialization; it is not an all-seller migration backfill.
- Checkout, authoritative paid orders, seller onboarding, webhooks, settlement, refunds/disputes, shipping and tax services are disconnected. Auction bids remain explicitly nonbinding previews.
- Complete live Raw/CGC data and modern covers require actual contracted access/rights and provider mapping. No test estimate is a live FMV substitute.
- Native account features remain browser handoffs. Bundles are unsigned, and the previously recorded braces/node-forge build-tool advisories and store/device gates remain open.
- Final operating policies, retention, support staffing, brand/auction eligibility and legal review remain in BUSINESS-COMMERCE.md and BACKLOG.md. Founder operator/contact/USA facts have been supplied and should not be requested again.

No customer record was modified by these fixture tests; no public audience setting, provider contact, purchase or legal filing was performed.

## Hosted migration compatibility correction

Two production candidates built successfully but deployment rejected the trigger-based migration6 with `incomplete input: SQLITE_ERROR`, including after each compound trigger was placed on one physical line. Fresh read-only schema inspection after both failures confirmed that migration6 remained unapplied. The exact hosted importer implementation was unavailable; the suspected compound-statement parsing cause is an inference.

The repaired, unapplied migration6 has **24 schema-only statements and zero triggers**. Applied migrations0–5 remain unchanged. A migration-owned `operation_guard` table uses `NOT NULL` and a named `CHECK(valid = 1)` constraint. The first statement in each protected batch always inserts a guard row evaluated against current database state. Validation, ledger/reservation changes and guard removal occur in the same atomic batch. A failed guard or later constraint aborts the entire transaction. No runtime table DDL is used.

Independent QA reran **49 of 49 marketplace groups and 6 of 6 populated pre6 cases** against this strategy. The suite verifies both rejected pre-transaction races and rollback after a late constraint fails following listing insertion; a clean retry succeeds. Every completed group leaves the guard table empty. Account moderation of a bid-bearing auction and a fixed lot verifies explicit cancellation, receipt and reservation cleanup.

The authenticated seller's initializer handles at most 25 legacy active single listings per call in one five-statement transaction. It freezes safe snapshots without private costs, reserves the oldest copies and closes conflicting later previews/offers only within that seller's selected batch. The publication guard independently rejects overlap with still-uninitialized legacy copies, including rows outside that batch. The compatibility cases verify execution by Drizzle breakpoints, physical lines and plain semicolons, the named CHECK, seller isolation, immutable snapshots, duplicate cleanup and the 25-row boundary. The largest captured legacy statement has 32 binds; the uninitialized 26th copy stays protected and initializes on the next call. This reproducible check is retained as checks/marketplace-legacy.mjs in the readiness runner.

Primary transaction reference: https://developers.cloudflare.com/d1/worker-api/d1-database/#batch . The launch kit's final publication record separately documents the actual hosted deployment result. Local fixtures and a successful migration deployment do not establish hosted identity/load/recovery or real-device readiness.
