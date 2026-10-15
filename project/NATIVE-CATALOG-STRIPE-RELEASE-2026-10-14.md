# ComicHuddle native catalog and Stripe test release

Prepared October 15, 2026 (UTC). Source changes follow commit 85a7de4; implementation through 86a03cb.

## Implementation

- Migration 017 exposes every active native GCD issue through left joins. Missing series metadata receives an explicit pending label. No 6,826-row fallback selector or global result cap remains. Exact canonical IDs and already sourced bibliographic annotations are retained. API pages stay bounded at 30 items; default-sort navigation supports an issue cursor and the UI permits jumping to any page.
- The concurrent index maintainer includes issue IDs, series/number, series publisher, publisher ID, release date, and native cover issue IDs when that relation exists. Long-running snapshot imports can defer index completion; they are not interrupted.
- Native covers use explicit stored URLs/paths, never invented image filenames. The adapter combines native cover metadata with retained exact source references. HTTPS hosts and paths are bounded. Missing/failed images render escaped title/issue SVG covers with source attribution.
- Desktop navigation adds My Wallet at /wallet, removes Upcoming, and places a compact unfilled camera icon after My Profile. Mobile retains its centered scan action, adds My Wallet, and keeps My Profile at the right. The account drawer links directly to /wallet.
- Homepage Upcoming Drops & Releases shows actual native on-sale dates over the next 93 days, with a source/date notice and an explicit empty state. The roadmap remains available from that section and the footer.
- Market Pulse reads current permission-cleared quotes and seven-day history. Migration 018 records daily snapshots whenever FMV changes. Comparisons stay within the same issue, printing, slab label and grade. The marquee is clickable, pauses for hover/focus, and respects reduced motion. Absent price history is labeled rather than assigned a false gain/loss.
- The provided restricted Stripe test key and publishable key are stored in Vercel, with the signed webhook secret generated directly by Stripe. No credentials are saved in code or this document. Test restricted keys are now accepted by the sandbox adapter; live-mode keys remain rejected.
- Stripe webhook endpoint we_1UQbV6DtWxXM4ywkjfXkHNJR targets /api/commerce/webhook. Exact order/session/intent bindings and signature checks remain required before order processing or rewards. The payment domain pmd_1UQbVhDtWxXM4ywkH0DaPZm2 reports Apple Pay and Google Pay active. The UI exposes these only on eligible browsers/devices. Seller test onboarding is still required. SafePurchase custody, carrier proof and payout operations require their own connections before charging a protected transaction.
- Existing SafePurchase and Wallet information pages remain, including 100 points = $1 credit, refunds, reservations, no transfers and no cash-out.

## Data and payment limits

Exposing native issue rows does not create missing series records or artwork. The external snapshot importer is active. Exact release counts and native coverage will be recorded from the cloud build. No complete artwork or dump reconciliation claim is made without source tables and a manifest.

No current authorized sales feed was supplied. No eBay HTML scraper was activated, and no synthetic/default price is presented as current FMV. eBay requires prior express permission for automated access: https://www.ebay.com/help/default/default/user-agreement?id=4259 . Licensed or explicitly authorized completed-sale feeds can use the existing weekly median ingestion path. Historical source prices are not converted into supposed weekly market movers.

## Validation requested for this release

Optional test suites were skipped. TypeScript compilation and deployment builds are required. Existing cover source witnesses were validated when the first deployment identified a multiple-leading-slash URL compatibility issue; all 2,089 source references are accepted after the correction. The source import does not mean all remote images load.

No payment was made and no real funds were transferred. Stripe registration/configuration is an actual provider setup operation, not a simulated transaction.

## Native catalog performance follow-up

Migration 019 creates a scalar read-state cache and a native-only read view. Source counts are computed in build/protected scheduled jobs rather than by visitors. Native IDs are paged separately from comic JSON payloads. Default issue browsing uses the raw issue relation without series/publisher joins; full metadata is fetched only for the selected IDs. Keyword candidate identities come from available series names, exact retained annotations and native issue titles. Unknown series names are not invented. Publisher-to-series browsing reads series records without recounting millions of issues.

The existing protected weekly job and daily checkpoint-resume job refresh the coverage cache. Stored counts include an observation timestamp and never impose a result offset cap. While the external snapshot import is incomplete, pages still query the actual native relations.

At 23:52:44 UTC on October 14 the unified SQL view contained 2,290,385 records. The separate earlier raw issue count found 2,290,000 distinct IDs. The active import can change counts between statements. Series rows remained zero; the native cover table was absent; 2,088 retained GCD cover references existed. This earlier checkpoint preceded completion of the native ID and directory-expression indexes. Remaining series/date maintenance was separated from the web release; the snapshot import was not stopped.

Stripe public setup returned sandbox ready and Payment Element enabled. No card transaction was submitted.

## Public release observation

The saved native coverage observation is **2,390,305 accessible directory records**, including 2,390,262 GCD-linked records, at **2026-10-15T00:06:09.943Z**. The raw snapshot had 2,390,000 distinct issue identities. Import activity continues independently; this is an observed count, not a source-manifest completeness assertion.

The native series table still contains **zero rows**, and **gcd.gcd_cover does not exist**. There are 2,088 retained issue-specific GCD cover references and six locally served public-domain covers. GCD image delivery rejected this cloud browser earlier, so references do not imply working image delivery. Missing covers use styled title/issue SVGs; missing series names are explicitly pending. These missing source tables, image availability and artwork permissions block a claim that every title and cover is complete.

The final native paging fix bounds each ordered union branch before merge. Public requests returned 12 records for the first page and two native records beyond offset 7,000, with the full 2,390,305 count. An exact-title search then exposed a separate unindexed native text scan; concurrent lower(issue number) and trigram title/name indexes are included in the final maintenance build. Final deployment and route results are recorded in project/evidence/NATIVE-STRIPE-PREVIEW-2026-10-14.json.

Stripe test configuration and Payment Element availability were observed via the public setup endpoint. Apple Pay and Google Pay domain registration are active, but actual wallet availability depends on the device/browser and Stripe. No payment or order settlement has been exercised in this release, per the request to skip optional tests. Full production checkout, SafePurchase physical custody and seller payouts are not claimed.

There are no permission-cleared current valuation quotes in this deployment. The FMV and seven-day ticker UI remain explicitly unavailable until a licensed or authorized sold-price source is connected; no default amount is labeled a real market valuation. The existing signed weekly new-release and FMV routes remain configured. Missing upstream credentials/data and the paused prior API imports are not bypassed.

## Final published result

- Ready Vercel deployment: `dpl_6Eq6mQiPR5noeGuWAT2i8HRx1m3q`, source commit `86a03cb`. Public address: https://comichuddle-abdul-aziz-akhtars-projects.vercel.app/ .
- The search maintenance build completed all three concurrent number/title/series-name indexes and the required production build. Native directory-ID and issue-ID indexes are also valid; the separately deferred series/date join maintenance is not represented as complete.
- Public first page: HTTP 200, 12 issues, total 2,390,305, 3.15 seconds including network. Offset 7,000: HTTP 200, two native issue records, 3.05 seconds. Exact Amazing Spider-Man #300 search: HTTP 200, three edition records, 3.97 seconds. Stripe setup: HTTP 200, sandbox ready, Payment Element enabled, production payments disabled.
- The browser rendered the full count and 12 interactive cards on the final public build. Screenshot: `project/evidence/comichuddle-native-directory-20261015-0039.jpg`.
- These are deployment/read checks, not full end-to-end account, transaction, refund, auction, scanner or settlement certification. Optional suites and transactions were not run.
- Actual supplied secrets were scanned and were absent from tracked/untracked source artifacts. Pattern-only hits were explicitly synthetic webhook fixtures in existing checks; no real credential was committed.
