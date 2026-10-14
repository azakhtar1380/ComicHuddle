# ComicHuddle: GCD directory, rewards and checkout release

The public preview retains the original ComicHuddle comic theme and introduces dedicated SafePurchase and Wallet information pages, a centered Scan / Lens control, profile navigation at the right, a validated US city/ZIP combobox, and a closed-loop promotional credit ledger. The homepage rewards widget is active and links to `/wallet`.

## Database and data coverage

RDS migrations 010–016 are applied. `gcd.comichuddle_directory` reads the native `gcd.gcd_issue`, `gcd.gcd_series` and `gcd.gcd_publisher` tables. The catalog, owned-copy validation and listing validation preserve the existing canonical ID convention: 4,000,000,000 + GCD issue ID. Application accounts, orders and private ledgers remain in `ch_web`.

The last SQL check before the final build found 1,490,000 active native issue rows (SQL verification: October 14, 2026 at 22:37:17 UTC), 17,725 publishers, **zero series rows**, and no `gcd_cover` table. A separate import is adding issue rows during this release. Those unjoined rows cannot produce verified series titles. Until the native series table is populated, catalog reads use `gcd.comichuddle_legacy_directory`, a read-only view of the retained sourced catalog. This preserves all **6,826 searchable entries**, including **6,783 GCD records**, and avoids scanning the entire incomplete dump for every visitor search. The adapter switches to the native view when series metadata is available.

Three native issue indexes remain at checkpoints because concurrent snapshot activity prevents their completion. The three publisher/series indexes are valid. The maintenance script uses concurrent index creation, retains checkpoints on lock/quota-style waits and does not interrupt the external import.

There are **2,088 exact GCD cover references** and **six local US-public-domain covers**. References are not evidence that every remote image loads. The GCD CDN rejects this cloud browser; missing images show a clean fallback. Cover attribution appears beside the display. Next.js permits the configured GCD and publisher cover domains. No guessed cover paths or unlicensed artwork binaries were added.

## Wallet and payment behavior

`reward_accounts`, `reward_ledger` and `credit_reservations` implement separate live and sandbox rewards. Confirmed payment receipts earn 1 point per whole dollar of net item price, excluding shipping/tax. 100 points convert to $1 of on-site credit. Conversion is idempotent and transactional; reserved credit cannot be spent twice. Full confirmed refunds restore applied credit and reverse earned points. Points already converted before a refund can create a points debt that future earnings clear. Credit has no cash-out or transfer endpoint.

The embedded Stripe Payment Element and Express Checkout Element use the current `elements` Checkout Session API mode. Stripe collects card details and exposes Apple Pay / Google Pay only when the merchant, domain and device support them. The existing exact order/session/intent/charge binding, signed-webhook verification and provider-event deduplication remain. Payment confirmation and reward reconciliation commit together. Expired unpaid sessions release credit reservations.

**Stripe is not configured on this deployment.** No real or genuine Stripe sandbox transaction was made. Activation settings and limitations are documented in `PAYMENT-ACTIVATION-2026-10-14.md`. Live-money keys remain rejected by this sandbox adapter. Carrier verification, actual inspection operations and seller payout services are not connected. Orders using promotional credit require settlement of the platform-funded credit subsidy before release. Credit-only orders, paid auction settlement and workshop credit checkout are not enabled. Auction proposals remain nonbinding; normal shipping checkout requires at least $0.50 of processor payment.

## FMV

`gcd.sales_comps` and `gcd.fmv_records` store attributable USD completed-sales evidence and valuations linked to actual directory identities. The engine separates issues, printing, grade and slab label, excludes unconfirmed best-offer prices and stale sales, deduplicates source sale IDs, removes IQR outliers and calculates a rolling 90-day median with at least three eligible samples. Values carry source, sample size, update date and expiry.

The protected weekly `/api/cron/fmv` job accepts a configured, authorized, bounded structured feed. Operator imports use `/api/values` with documented redistribution permission. No authorized feed credentials or actual prices were supplied; the deployment has zero current FMV quotes. Cards and issue details display unavailable values instead of invented prices. Human-driven eBay completed-sales research links remain available.

Automated scraping of public eBay sold-search pages was not enabled: eBay's User Agreement requires prior express permission for automated access. Primary reference: https://www.ebay.com/help/policies/member-behavior-policies/user-agreement-and-privacy-policy?id=4259 . Marketplace Insights sales history is limited to approved partners under a formal agreement: https://developer.ebay.com/develop/get-started/get-started-on-a-buying-application .

Existing weekly GCD release and checkpoint-resume jobs remain configured and protected. The stopped private Site/Metron tasks were not restarted.

## Verification

- 27 PostgreSQL tests: native identity reads and listings, migration/authentication, source preservation, rewards conversion/reservation/refunds, location privacy and marketplace ownership.
- 8 snapshot/cover/cron tests, including a 50,000-record isolated PostgreSQL import across 100 batches.
- 55 Stripe adapter groups with synthetic HTTP and real signature cryptography, including embedded session binding; 36 pure commerce protection policy groups.
- 12 client commerce/recovery checks, 7 collection/listing checks, 12 scanner lifecycle checks, 4 mobile navigation checks and 7 responsive card geometry checks.
- 28 authenticated live API checks on the public preview: collector signup, specialist registration, collection version control, private images, listings, sold status, location filters, wallet isolation and payment failure recovery. Temporary application fixtures were removed. Clearly named QA authentication identities remain for operator-managed retention.
- Browser inspection confirmed the two information pages, seven icon destinations with Scan centered, profile last, readable issue details, a loaded vintage cover, a red Add to Collection action, and no horizontal overflow at the inspected desktop viewport.

The scanner supports camera and upload/drag-and-drop workflows, but automatic cover recognition currently has six local reference covers. It does not authenticate printing, grade or condition. Hardware camera and device-specific payment wallets were not tested in this cloud browser. No claim of complete production or financial-provider E2E verification is made.

## Final deployment

Vercel deployment `dpl_BQqGoYU7SH1NScreuJ3vpBEwx8wK` completed at 22:38:26 UTC on October 14, 2026 and was explicitly promoted. Runtime source commit: `95295a7`. Verified public homepage: https://comichuddle-abdul-aziz-akhtars-projects.vercel.app/?section=Home .

All seven final route checks returned their expected status (200 for public directory, search, valuations, setup and city choices; 401 for unauthenticated scheduled jobs). Exact Amazing Spider-Man #300 search returned three matching edition records in 3.68 seconds. Checkout setup explicitly reports disabled until processor configuration is supplied. The native GCD snapshot remains incomplete and is not advertised as 1.49 million searchable comics.

Evidence: `evidence/LIVE-CATALOG-ROUTES-2026-10-14.json`, `evidence/LIVE-GCD-REWARDS-2026-10-14.json` and `evidence/comichuddle-home-rewards-2026-10-14.jpg`.
