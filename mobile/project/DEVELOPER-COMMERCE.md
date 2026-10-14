# Marketplace backend implementation

This release adds owned single-copy and collection listings plus timed, nonbinding private-preview auctions. Checkout remains disconnected: no bid, accepted offer, auction expiry or preview cancellation creates an order, charge, transfer or binding sale. USA-only eligibility and shipping are explicitly confirmed for new-format listings. Actual account acceptance uses rules version `2026-10-09-marketplace-preview-2`.

`lib/marketplace.ts` builds immutable, safe per-copy snapshots from the latest owned vault. The client supplies selected IDs and optional exact condition attributes; it cannot supply snapshot titles, ownership or private cost. A collection may contain 1–1,000 distinct physical copies. A single listing contains exactly one. Conditions are captured for the listing; the existing vault schema remains compatible.

`0006_marketplace_preview.sql` adds listing snapshot/auction fields, `listing_inventory`, `auction_bids`, indexes and `operation_guard`. Each guarded operation starts an atomic D1 batch by inserting a transient row with `valid = CASE WHEN <current database validation> THEN 1 ELSE 0 END`. The named `CHECK(operation_guard.valid = 1)` and `NOT NULL` constraint abort the entire transaction when validation fails. The guard inserts always write a row; a failed predicate cannot silently skip validation. Successful transactions delete their guard rows last. No runtime schema changes occur.

Publication rechecks current ownership, vault revision, collector eligibility, every distinct selected copy and active reservations inside the batch. It reserves the entire JSON snapshot with one `INSERT SELECT json_each(...)`, without expanding 1,000 copies into bound parameters. Any guard or reservation conflict rolls back the new listing and all reservations. Before publication, an owned-seller initializer handles at most 25 active legacy singles in a five-statement batch: capture safe snapshots, reserve oldest copies, withdraw duplicate previews, close their pending offers and clear withdrawn reservations. Every read/write is scoped to that authenticated seller. The publication guard also checks uninitialized active legacy copies directly, so copies outside the bounded batch cannot be duplicated.

Two hosted attempts to apply trigger-based migration 0006 failed with `incomplete input: SQLITE_ERROR`; read-only database inspection confirmed that 0006 remained unapplied. The repaired 0006 contains 24 schema-only statements, each on one physical line, with no compound trigger bodies or data backfills. It has been checked using Drizzle breakpoints, individual physical lines and simple semicolon splitting. Applied migrations 0000–0005 are unchanged. Hosted migration success still requires verification through the Sites deployment workflow.

Public DTOs explicitly select fields. They expose neither private vault cost, commercial license references, internal revision/version columns nor bidder identities. Only the current viewer receives their own latest unretracted bid receipt and leading/outbid state. Account exports include only authored bid receipts and owned reservations. Visible, unblocked active/ended listings may display owned snapshot photos independently of the six gallery photos.

FMV totals use integer cents and count each physical copy. A value requires explicit catalog identity, exact mode/grade/label/printing, active redistribution rights and a licensed estimate no older than 30 days. Ambiguous, missing, stale, expired or malformed values are unavailable. Complete totals require every copy to be priced; partial coverage exposes only a clearly distinguished known subtotal. No priced copies means `total:null` and `knownTotal:null`. Asking prices and historical sales do not fill missing FMV.

Auction proposal insertion atomically rechecks permissions, block/restriction state, server time, minimum amount and version before recording the proposal and updating the leader. Equal concurrent proposals produce one accepted receipt. Request UUIDs are unique per bidder; identical accepted retries remain idempotent after expiry. Latest-own-bid retraction rechecks the current version and latest receipt before the server cutoff. Retracting the current proposal clears it and resets the minimum to the opening amount; earlier proposals are never promoted. Proposal count includes retained retracted history.

Seller withdrawal is guarded against newly accepted proposal history. Owner-only `cancel_auction` annuls the preview and releases copies. Owner listing/profile moderation, withdrawal and account deletion explicitly clear reservations; cancellation and withdrawal also annul unretracted auction proposals and close pending offers. Ended nonbinding auction locks release lazily in the seller's next publication batch, while preserving history. These lifecycle changes use explicit batch statements rather than triggers. Owner-only `auctions_admin` returns recent 100 previews, or an exact UUID search, without bidder identities.

Account deletion begins with two conditional guard inserts that recheck seller history and outstanding bidder proposals before any anonymization. Sellers with proposal history must request owner cancellation; bidders must retract still-open proposals. After closure/cancellation, remaining amounts/timestamps are retained anonymously and identity/request receipts are removed. The internal `deletion_started_at` marker is removed with the profile and all changes roll back if a guard fails. Support cancellation is available through `maliktecks@gmail.com`; no fixed audit-history purge period is implemented.

| Limit | Enforced value |
| --- | --- |
| Vault/listing request body | 1,000,000 bytes |
| Other social request bodies | 25,000 bytes |
| Selected owned copies | 1–1,000; single requires 1 |
| Gallery photos | 1–6 distinct owned uploads |
| Auction duration | 1–168 integer hours; default 72 |
| Bid increment | 100–1,000,000 cents; default 500 |
| Opening/fixed amount and proposals | 100–100,000,000 integer cents |
| New listing writes | 10 per account/action/minute |
| Bid/retraction writes | 20 per account/action/minute each |
| Shared authenticated writes | 120 per minute and 1,200 per day |
| Legacy initialization | At most 25 owned active singles in one five-statement transaction |
| Bounded lookup chunks | At most 64 IDs, below D1's 100-bind limit |

Validation includes isolated real-route/Drizzle/SQLite marketplace execution, previous network/privacy/negative regressions, TypeScript, clean schema generation and populated pre-migration legacy overlap/initialization cases. QA owns the current test counts and detailed evidence in `QA-COMMERCE.md`. Hosted publication, payments, production data licensing and applicable auction requirements remain separate release gates managed by the owner.
