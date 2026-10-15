# ComicHuddle original application on Vercel

Current release record: [Launch stabilization — 15 October 2026](project/LAUNCH-STABILIZATION-20261015.md).
It contains the actual production deployment, RDS/media diagnosis, real Stripe
TEST receipts, screenshots, source prerequisites and non-destructive rollback.
Older architecture packages and D1/R2 handoffs are historical, not this runtime.

Build the **repository root**, not a deployment subfolder. Framework: Next.js;
install: `npm ci --include=dev`; build: `npm run build`; Node.js: 22.

The original `app/` React interface, directory views, scanner, account drawer,
marketplace, auctions, messages, pressing workflow and native `mobile/` source
are retained. The alternative Render/Vercel sandbox packages were removed.

## Server environment

Keep the existing `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`,
`DB_SSL=true`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` and `CRON_SECRET` in scoped
Vercel environment settings. For this existing production database use
`MIGRATE_ON_BUILD=false`, `MIGRATE_ENRICHMENT_ON_BUILD=true` and
`COMMERCE_NEW_CHECKOUT_PAUSED=true`. Do not run the initial seed/index pipeline
again for a UI release. No secret is committed. The build
downloads the official regional RDS trust bundle and verifies TLS certificates
and hostnames. The Next.js function bundle includes the CA file.

The canonical origin is
`https://comichuddle-abdul-aziz-akhtars-projects.vercel.app`. Keep auth cookies,
CSRF checks, checkout returns and webhook registration aligned to it. The short
Vercel alias redirects there. Production deployments currently use the scoped
Vercel CLI; this project has no active Git integration. Push the source separately
and inspect the actual deployed revision rather than assuming a push deploys it.

## PostgreSQL migration

`scripts/migrate-postgres.ts` is the initial application migration path, not the
routine release command for the already migrated production database. The current
additive build path runs `migrate-enrichment.ts` and `migrate-launch.ts`, checks
the applied SQL checksums and applies migration 023 if absent. This preserves
native `gcd`, application `ch_web`, older schemas and all financial history.
Guarded operations use serializable, same-connection transactions. Never modify
an applied migration or drop tables to roll back a website.

The owner explicitly approved copying the stored central catalog to this public
repository on October 14, 2026. `db/catalog-export.json` contains bibliographic
records only, including their existing provenance and attribution. Account,
collection, message and private photo data are not transferred. No FMV or covers
are scraped. Actual directory reads query the native RDS catalog, not just this
retained export. The 15 October public readback is 2,620,274 indexed records.

Migration 023 adds derived barcode/ISBN indexing, its resumable checkpoint and
media-rendition metadata. The bounded first index bootstrap is incomplete by
design. Actual seller image bytes remain in `ch_web.photo_bytes`; the media route
checks visibility/ownership. Six reviewed local reference covers are exact-edition
mapped. Modern GCD art is not ready: the production `gcd_cover` table is absent,
and approved source access/S3/CloudFront cover-cache settings are missing. Follow
the current report's source-access checklist; never invent CDN URLs or rights.

## Accounts and provider setup

Email/password registration persists in AWS RDS with Better Auth sessions,
password hashing, secure cookies and database-backed request limits. Original
Sites identity headers are ignored. Login is at `/sign-in`; the old login route
redirects there. New users create their collector profile and may register their
pressing studio using the same original UI. Email verification and password
recovery await an operator email provider. Administrator access is never granted
from an unverified email; set `COMICHUDDLE_OWNER_USER_ID` after an owner review.

## Availability and checks

The directory, collections, profiles, listings, nonbinding auction proposals,
messages and Workshop inquiries use the application's real RDS APIs. The scanner
uses on-device decoding/OCR, a small real cover index and manual catalog search;
it makes no AI/authenticity/grade claim. SafePurchase is an opt-in request until
an operator accepts real service terms. Workshop requests are quotes, not paid
bookings. The wallet exposes actual receipt/ledger state and noncash reward credit,
not invented funds or cashable points. FMV and Market Pulse public workloads are
removed; FMV is only a Coming Soon item on Upcoming.

New checkout is explicitly paused. Stripe TEST card collection/3-D Secure and
provider-only refunds were verified, but connected seller creation returned
`more_permissions_required`; the full application order-to-refund/release test is
not complete. Do not enable paid marketplace or Workshop service transactions
from a passing build or provider-only test. Existing refunds/webhooks/reconciliation
must remain available while new checkout is paused. Live payments and payouts
are disabled; typed tracking is not carrier-verified delivery.

Weekly Cron retains the permitted current/previous-week GCD metadata sweep and
its checkpoint continuation, honoring owner pause/quota. Daily enrichment now
indexes identifiers and drains cover jobs only. No FMV/Pulse cron remains. Actual
scheduler authorization/execution still needs operator verification: unauthenticated
requests and an attempted manual service invocation returned 401. Do not remove
the gate or disclose/change unrelated secrets to bypass it. Paused private Site
and Metron tasks were not restarted.

Use focused checks in the current report, `npm run typecheck` and the production
build. Local PostgreSQL/PGlite and controlled-hook suites do not establish real
provider/device acceptance. `node checks/live-public-launch.mjs` checks read-only
public RDS/API/cover bytes and workload gates. `/health` checks RDS from the
deployed runtime. Use only the isolated QA database for financial fixtures; never
run QA preparation against production. Signed-in browser, physical phone/wallet,
complete payment/ledger/refund and operational recovery acceptance remain
documented release gates.

For rollback, preserve additive schemas and history, pause new checkout, keep
support/refunds/webhooks online, and promote a reviewed previous stabilized
runtime only after checking database compatibility. See the current report for
the actual prior deployment and a separate backup/restore procedure.
