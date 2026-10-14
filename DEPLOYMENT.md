# ComicHuddle original application on Vercel

Build the **repository root**, not a deployment subfolder. Framework: Next.js;
install: `npm ci --include=dev`; build: `npm run build`; Node.js: 22.

The original `app/` React interface, directory views, scanner, account drawer,
marketplace, auctions, messages, pressing workflow and native `mobile/` source
are retained. The alternative Render/Vercel sandbox packages were removed.

## Server environment

Set `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL=true`,
`MIGRATE_ON_BUILD=true`, `BETTER_AUTH_SECRET` (a random secret of at least 32
characters) and `CRON_SECRET` on Vercel. No secret is committed. The build
downloads the official regional RDS trust bundle and verifies TLS certificates
and hostnames. The Next.js function bundle includes the CA file.

## PostgreSQL migration

`scripts/migrate-postgres.ts` migrates the **original application's** 41 tables
into `ch_web`, adds bounded photo storage and initializes Better Auth's account
tables. A checksum ledger and advisory lock make builds idempotent. Existing
`ch_platform` and old sandbox schemas are preserved without copying their data.
Original guarded operations run in serializable, same-connection transactions.

The bundled central directory metadata and licensed/public-domain local assets
are seeded. The owner explicitly approved copying the stored central catalog to this public
repository on October 14, 2026. `db/catalog-export.json` contains bibliographic
records only, including their existing provenance and attribution. Account,
collection, message and private photo data are not transferred. No FMV or covers
are scraped.

## Accounts and provider setup

Email/password registration persists in AWS RDS with Better Auth sessions,
password hashing, secure cookies and database-backed request limits. Original
Sites identity headers are ignored. Login is at `/sign-in`; the old login route
redirects there. New users create their collector profile and may register their
pressing studio using the same original UI. Email verification and password
recovery await an operator email provider. Administrator access is never granted
from an unverified email; set `COMICHUDDLE_OWNER_USER_ID` after an owner review.

## Availability and checks

The directory, collections, profile, listings, auction proposals, messages and
Comic Workshop use the actual original application APIs. Browser scanner matching
uses the existing cover reference index; it is not an authenticity guarantee.
SafeTrade, rewards and FMV remain marked as planned where they were planned in
the original app. No live payments, physical inspection or invented AI grades are
enabled. Stripe test checkout still requires the original documented Stripe
sandbox settings. Weekly Cron remains authenticated and skips ingestion while
provider authorization and migration review are missing; previously paused GCD
and Metron tasks remain paused.

Run `npm run build`, `npm run typecheck`, and `npm run test:postgres`. The latter
executes the original PostgreSQL migration and account/catalog/listing/rollback
checks in a local PostgreSQL engine. `/health` verifies actual RDS access after
deployment. Cloud browser QA must also verify desktop/mobile original UI and
account → profile → collection → listing flows before promotion.
