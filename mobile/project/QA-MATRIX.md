# ComicHuddle QA matrix

Automated route checks execute the actual TypeScript APIs in an isolated SQLite/D1-style and R2 fixture. Client race checks execute extracted actual component functions with delayed responses. They do not assert hosted multi-user authentication, browser rendering, device interactions or provider/payment integrations.

| Area | Automated / source checks | Required physical or hosted follow-up |
| --- | --- | --- |
| Identity and roles | Missing identity, cross-origin writes, object ownership, owner-only imports/reviews/export boundaries | Actual visitor sign-in/out and access policy on deployed site |
| Collections | Schema, photo ownership, empty initial state, ETag/If-Match, stale/concurrent saves and export/delete | Two real devices/tabs with interrupted saves and real user accounts |
| Directory and values | Exact starter IDs, licensed freshness/expiry, private refs, historical labels and API data | Authorized vendor sample reconciliation and real feed refresh |
| Community | Joined-member posts, inaccessible reports, block filters, moderation, atomic rate limits | Keyboard/screen-reader posting, moderation response and mature-content policy |
| Messages | Participant-only read/write, blocked sender behavior, latest response selection and draft clearing | Repeated peer switching on slow network; notifications and sign-out privacy |
| GrailMatch | Reciprocal owns/wants/trade pair, mutual-only conversation, changed inventory rejection | Touch gestures, keyboard alternative and actual match usefulness |
| Marketplace | Owned photos/copy, pending offer state, withdrawal/races, disconnected buy clearly fails | Real seller onboarding, payment/refund/dispute/tax/order reconciliation |
| Comic Workshop | Quote acceptance and address privacy, stage transitions, credential disclosure, reviews/custody photos | Provider contracts, insured shipping and true CGC eligibility |
| Media | Container bounds, metadata removal, malformed upload limits, public discovery vs custody exceptions | Actual phone photo formats/orientation, successful render, upload interruptions |
| Mobile UI | Seven viewport cover bounds, native type checks/export, safe-area/layout source review | iPhone/Android portrait/landscape, large text, VoiceOver/TalkBack, soft keyboard |
| Web UI | Focus/drawer regression, skip link, current navigation and async/error handling | Desktop/mobile browser visual checks, 200% zoom, screen reader and keyboard |
| Offline/cache | Service-worker auth/API bypass; private media no-store | Installed PWA after logout and switching real accounts |
| Performance | Dense fixtures and query budgets | Hosted concurrency, quotas, latency and failover/recovery rehearsal |
| Dependencies | Production dependency audits and compatible patch install/build | Native build/signing advisories resolution; refreshed audit before store submission |

## Release rules

Record command, result, fixture scope and code version. Keep baseline failures and patched passes separate. Do not count a build/export as a UI test or audit findings as proof of a reachable exploit. A failed critical check blocks the corresponding release; a test that cannot run is unverified, not passed.

Private engineering publication preserves current owner access. Free public beta, commerce, licensed values and native stores have separate gates in TEAM.md and BACKLOG.md.

## Marketplace expansion — 9 October 2026

The new isolated actual-route/client-helper suite contains 49 passing groups, documented in QA-COMMERCE.md.

| Area | Automated evidence | Remaining device/hosted evidence |
| --- | --- | --- |
| Single and whole-collection listings | Up to 1,000 copies, immutable safe manifests, overlap rejection, stale-vault publication conflict and all-or-nothing reservations | Select/edit large lots on actual phones and verify hosted migration/query behavior |
| FMV on product cards | Exact explicit issue/condition, physical quantities, full/partial/unavailable totals, current rights/date expiry, no private costs | Provider-contracted samples and actual rendered cards, slow/offline feed recovery |
| Auction preview | Atomic simultaneous bids/retries, late cutoff, retraction without prior promotion, self/block/restriction controls, malformed deadlines | Real multi-device timing/network interruption, accessibility, production identity |
| Owner support and deletion | Owner-only queue/exact hidden older lookup, cancellation/reuse, own-only exports, anonymized history, deletion/bid races | Staffed support procedure, final retention/appeal policy and recovery rehearsal |

These are nonbinding previews. The suite does not establish payment settlement, auction licensing, load capacity, complete security or native store acceptance. No licensed QA fixture estimates are deployed as real values.

## Sandbox payment and independent valuation coverage

| Area | Automated evidence | External acceptance still required |
| --- | --- | --- |
| Checkout/order storage | Real route/Drizzle handlers with fake Stripe transport; immutable single/lot totals, US address, copy reservation, competing buyers and rollback | Genuine Checkout success/decline/challenge and hosted multi-account sign-in |
| Webhooks/refunds | Real signatures, durable receipts, exact session/intent/charge binding, pending/unknown refunds, disputes, original-key reconciliation and version guards | Real Stripe delivery/retry/refund objects and balance/account reconciliation |
| Shipping/support | Paid participant-only address/photos; seller tracking labeled unverified; owner lookup; protected deletion and moderation inventory | Trusted carrier/delivery/signatures, scheduled evaluations, returns/custody, live seller transfers |
| FMV prototype | Synthetic licensed grants and exact cohorts; filters, recency median, evidence thresholds, expiry and insufficient-data states | Permission-cleared sale feed, real backtesting, calibrated support and current coverage |

PAYMENT-QA.md and verification.json record exact final results. No genuine processor transactions or browser/device E2E are implied.
