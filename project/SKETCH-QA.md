# Sketch release acceptance and QA

Date: 2026-10-13. Independent QA owns `checks/sketch-launch.mjs` and this report. Runtime implementation belongs to the parent/developer/backend agents. No commit, push, deployment, production test messages or genuine payment activity is authorized for this QA slice.

The frozen release runner exits 0: **626 named Node groups pass with 0 failures**, plus **9 Python tests**, strict TypeScript, network smoke, privacy, dialog-focus and query-budget checks. Independent native readiness also exits 0. No unresolved defect was found within this automated scope. This supports the parent’s production build and private-preview handoff; it does not certify hosted browser/device journeys or a public paid launch.

## Acceptance matrix

| ID | Journey | Acceptance | Evidence |
| --- | --- | --- | --- |
| NAV1 | Web and app navigation | Home, Directory, Marketplace, My Profile, Comic Workshop and Upcoming are the six active destinations. Internal Collectors/Pressing aliases remain compatible. Mobile has one navigation menu. | Actual navigation helpers, Hub handlers and TSX structure |
| NAV2 | Archived links | Community, FMV and GrailMatch links, account return paths and deep URLs resolve to Upcoming. No active public Community mount or matching/valuation guide remains. | Actual redirect/return helpers and Hub mount inspection |
| NAV3 | My Profile | Choosing My Profile shows the signed-in owner's showcase, even after viewing a peer. A delayed peer read cannot reopen it. | Actual profile selection/navigation callbacks with reversed responses |
| HOME1 | Home and calls to action | Comic-themed home provides directory, collection and marketplace handoffs without claiming complete data, active matching, paid checkout or verified scanning. | Actual CTA handlers and render structure |
| DIR1 | Autocomplete | Bounded query/results, current-response selection, keyboard navigation and explicit manual entry. Obsolete responses/errors cannot replace newer search input. | Actual picker session/handlers plus route response |
| DIR2 | Publisher and series browse | Browsing publisher/series returns the selected edition identities and honest indexed counts. Empty and failed searches remain explicit. Visitors need no provider token. | Actual catalog route and client controls |
| DIR3 | Issue identity | Issue/year/edition/source identities are preserved. Selected Metron records retain external provenance; manual records remain unlinked. No cover/printing identity is guessed from a title. | Actual vault route and form payloads |
| DIR4 | Directory actions | Add to collection saves one owned physical copy; Find copies selects exact issue identity. GoCollect uses a verified edition mapping, or a clearly labeled guide fallback with copyable edition search text; no undocumented exact-search URL is promised. Unknown prices are never zero-filled. | Actual action handlers and source/search helpers |
| DIR5 | Art and valuation rights | Imported metadata carries attribution; unavailable cover art stays unavailable. Personal estimates, asking prices and historical sales do not become current FMV. | Public DTO checks and render structure |
| PROFILE1 | Public city | The collector's city is public display location, not a shipping/intake address. Private financial/custody addresses remain private. | Actual profile/form/export routes and helper validation |
| PROFILE2 | Collector and provider | A provider is also a collector with their own account, collection and showcase. Registration preserves owned books and permits no access to someone else's collection. | Actual profile + vault + care registration sequence |
| WORK1 | Local discovery | Studio/collector name search and city/state filters select real supplied locations; missing or legacy locations are not geocoded or assigned invented states. | Actual location/filter helpers and TSX controls |
| WORK2 | Rankings | Area ranks use that area before additional query/service filters. Ranking requires at least three reviews and a finite 1–5 rating. Insufficient reviews show no rank. | Deterministic actual ranking helpers and render labels |
| WORK3 | Compare and contact | At most three studios compare offered services/prices; missing prices remain Custom quote and genuine zero stays zero. Message/request actions preserve account and private-care gates. | Actual helper/handler integrations and care routes |
| MARKET1 | Sale modes | Single, collection and auction paths accept only owned copies and preserve immutable snapshots/inventory reservations. A collection includes all selected copies without private costs. | Actual social/marketplace handlers and SQLite |
| MARKET2 | Messaging and trade | Private durable terms support seller Accept/Decline and proposer Cancel. Accept requires explicit agreement consent, unchanged owned copies and the current version; concurrent decisions commit once. Saved terms do not complete or protect a swap, charge, reserve or transfer inventory. | Actual proposal/read/decision/export/delete routes, commit-boundary races, rollback and TradeTerms handlers |
| MARKET3 | Local pickup | Listings distinguish shipping/pickup/both with public city/state only. Invalid regions, private-address fields and deceptive shipping charges fail. Pickup never enters an unsupported shipped-order checkout. | Actual listing DTO/validation/commerce routes |
| MARKET4 | Auctions | Server-time preview, no self/late/low/blocked bids, idempotent requests and atomic winner. Retraction/cancellation/expiry remain nonbinding and unpaid. | Retained marketplace regression plus affected actual routes |
| SCAN1 | Camera/upload entry | Camera/upload is user-initiated and unavailable permission states are explicit. Private photos stay owned. No automatic exact comic/cover identification is claimed without a real recognition service. | Actual scanner handler/helper and UI structure |
| SCAN2 | Review before save | In the disconnected state, users select an exact directory record or manual identity. Delayed lookups cannot replace a newer choice, and failure creates no phantom collection record. | Actual scanner/picker callback integration and vault route |
| SAFE1 | Account and data | Authentication, current consent, ownership, block/moderation, private addresses/photos, export and deletion safeguards remain enforced. | Affected actual routes plus retained readiness suites |
| SAFE2 | Money | No unsafe live charge, refund, seller payout or shipping claim. Existing sandbox gates remain fail-closed when configuration is absent. | Actual checkout rejection and retained payment boundary suites |

## Existing safeguards and regression changes

Current routes use trusted authentication, same-origin mutation checks, current rule receipts, persisted write budgets, owned-copy/media validation and vault ETag compare-and-swap. Marketplace inventory, bids and financial history use atomic database guards. Care custody and shipping/intake addresses are participant-scoped; financial records cannot be silently removed by account deletion. These must remain independently verified; a redesigned interface is not evidence that they passed.

`checks/navigation-community.mjs` was narrowly adapted to the six-destination scope and Community-to-Upcoming return paths. All 28 groups pass, including retained isolated Community-controller regressions. Those retained cases are dormant-code checks, not active public Community journeys. Existing server Community privacy checks remain because archival navigation does not remove stored records or route safeguards.

Native `ComicHuddle-App/checks/native-journeys.mjs` was adapted by its runtime owner. Independent `npm run test:readiness` exits 0: strict TypeScript, cover bounds at seven modeled viewports, and 14 actual native handler groups pass. Community/FMV/GrailMatch links land on Upcoming, while profile/provider handoffs retain their intent. These are isolated native surfaces and geometry checks, not hardware or signed-store tests.

The SharedDirectory fixture now provides the actual new series/matched state; central-catalog migration assertions target migration9 explicitly instead of assuming it is the newest entry. Its 37 behavioral assertions remain intact. The migration10 test was corrected by its owner to match the hosted-compatible final-line convention and the installed Drizzle statement splitter. Those fixture changes are separate from runtime defects.

## Findings verified during this revision

Runtime owners resolved and focused checks verify:

- Imported listings retain explicit Metron provenance and exact directory identity. Same-title manual copies cannot match a linked edition; unknown or mismatched legacy external links cannot become public edition claims.
- Scanner capture/upload clears obsolete selection, and late camera/detector callbacks cannot replace a newer manual choice. Confirmation alone adds a selected comic; detector results remain search hints.
- GoCollect links require a known base-record mapping. Alternate languages, later printings and imported identities use the labeled guide fallback with edition search text.
- Explicit Unlisted removes external provenance, while an automatic lookup failure can preserve the existing private link. Closing Add comic during a save cannot reopen the wrong drawer.
- Concurrent trade retries return one original receipt and one duplicate; each request saves one proposal and one message. Initial proposal guards now bind the complete saved listing terms, including pickup city.
- The first durable-trade integration returned 500 because its Drizzle insert-select omitted nullable decision fields. The owner corrected that projection; eligible proposal creation, decisions and atomic rollback now pass.

The focused suite also checks private trade pagination, role and consent gates, stale versions, concurrent Accept/Cancel, permitted Decline/Cancel after blocking or expired rules, changed/reserved copies, withdrawal cancellation, participant-only exports and dependent cleanup on deletion. Accepted terms leave the owned collections, listings, inventory locks and commerce ledger unchanged.

## Focused execution evidence

Final aggregate command: `node checks/run-readiness.mjs > project/evidence/SKETCH-READINESS-2026-10-13.txt 2>&1`. Exit code: **0**. The complete 73,776-byte log is retained at [SKETCH-READINESS-2026-10-13.txt](evidence/SKETCH-READINESS-2026-10-13.txt).

All 533 previously named web groups remain in the runner. The 93 added groups are sketch 41, Workshop 20, pickup/trade 11, trade terms 12 and pickup-payment 9, producing 626 named Node groups. Python’s nine checks and the native results are reported separately. Repeated focused runs are not added to those totals.

| Command | Result | Classification |
| --- | --- | --- |
| `node checks/run-readiness.mjs` | 626 named Node groups and 9 Python tests pass; exit 0 | Complete automated web regression, including strict TS and supporting checks |
| `node --experimental-vm-modules checks/sketch-launch.mjs` | 41 passed, 0 failed; exit 0; maximum 36 D1 binds | Actual isolated routes/SQLite, helpers, source-extracted client callbacks and limited render/source contracts |
| `node --experimental-vm-modules checks/marketplace-pickup-trade.mjs` | 11 passed, 0 failed; maximum 66 D1 binds | Actual listing/trade routes, commit races and Marketplace helper/render checks |
| `node --experimental-vm-modules checks/trade-terms.mjs` | 12 passed, 0 failed; maximum 66 D1 binds | Actual durable agreement routes, snapshots, roles, CAS, export/deletion and migration format |
| `node --experimental-vm-modules checks/pickup-payment.mjs` | 9 passed, 0 failed | Actual checkout guard with synthetic provider transport |
| `node checks/workshop-discovery.mjs` | 20 passed, 0 failed | Actual location/ranking/price helpers and Workshop TSX controls |
| `node checks/navigation-community.mjs` | 28 passed, 0 failed; exit 0 | Actual client/navigation and retained dormant-controller integrations |
| `node --experimental-vm-modules checks/metron-sync.mjs` | 37 passed, 0 failed; exit 0; maximum 30 D1 binds | Synthetic provider plus real catalog/controller integration |
| Native `npm run test:readiness` | Exit 0; strict TS, seven modeled cover viewports and 14 handler groups pass | Isolated native handlers and cover geometry |

Measured dense query counts remain social **23/40**, Workshop **20/40**, and private job detail **6/10**. Community’s retained feed/discovery checks measure **6/5 queries** and at most **24 binds**. New listing/trade checks stay at most **66 binds**, below the fixture-enforced D1 limit of 100. Both successful operations and forced transaction failures leave no transient guard rows.

Final `git diff --check` exits 0. The parent independently checked additive migrations10/11 and unchanged0–9; Drizzle reports no pending schema changes. No genuine provider requests, payment transactions, production profiles or real messages were used. No new dependency audit was performed in this revision; previous audit findings remain prior-assessment evidence.

## Execution limits

No official browser controller was available in the supported skill inventory, and no browser installation, improvised controller, preview server or production write was used. Trusted identities, the SQLite/D1 adapter, camera/canvas/native surfaces and provider transports are isolated fixtures. Their actual route/helper/client code execution is not hosted browser E2E or production load testing.

Visual layouts and keyboard/screen-reader behavior in real browsers, device camera decoding/permissions, hosted OAuth, genuine recognition, live provider data access and real processor/carrier outcomes remain unverified. The directory check proves the 43-record starter index and synthetic imported identities, not a complete hosted catalog. Imported covers and current FMV were not invented; FMV, Community and GrailMatch remain Upcoming in public navigation. Collector/studio locations are self-reported; the public-city label does not verify a real location. Trade acceptance remains a saved agreement rather than completed delivery, buyer protection or ownership transfer. Genuine payment transactions executed: **0**.
