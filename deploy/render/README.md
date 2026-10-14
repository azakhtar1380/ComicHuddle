# ComicHuddle Render sandbox

This is a deployable **interactive demonstration**, not a completed live marketplace integration. It serves a responsive frontend and Node endpoints from one Render web service; its state is saved to an isolated `ch_demo` schema in the supplied AWS PostgreSQL database. The three complete architecture migrations are checked by checksum, run once under a migration lock on startup, and never dropped/reapplied. An existing untracked `ch_platform` namespace requires review rather than automatic overwrite.

## What you can test

- Sample directory with retained US public-domain Planet Comics covers and grade selectors.
- Illustrative Raw NM, CGC 9.6 and CGC 9.8 prices, clearly labeled as samples; no live market-price source is configured.
- Creating listings, adding copies to a session, and walking demo purchases through vault inspection/delivery/settlement.
- Demo wallet proceeds, points, discounts, refund and withdrawal state transitions. No real card charge, refund, transfer or bank payout occurs.
- Real CSV/JSON listing downloads with **no eBay API token requirement**. These are export handoffs; publication/sync needs your actual importer contract and acknowledgment endpoint. No fabricated eBay listing ID is generated.
- Photo uploads return an explicit inconclusive result until an actual `VISION_GATEWAY_URL` / `VISION_GATEWAY_KEY` is set. A configured gateway returns visible condition/defect observations; no automated authenticity or CGC grade guarantee is made.

## Deployment prerequisites and next step

Render is connected and the owner selected **My Workspace**. The deployment target is `https://github.com/azakhtar1380/ComicHuddle`. The source import preserves its original README commit and includes the website and native mobile source. An authenticated GitHub write connection is required to push the prepared commit. No service is created from the repository until that source is published.

Apply the repository-root `render.yaml` as a Blueprint; its Docker context and Dockerfile are under `deploy/render`. Web hosting is free; the weekly cron has Render's minimum paid cron billing. Set DB_PASSWORD only through Render's environment configuration; it is deliberately absent from source. Other supplied DB values are in the blueprint. The original password was shared in chat; rotate it before production and move the public runtime to a restricted database login after migrations.

Startup downloads the regional AWS RDS CA bundle during the Docker build and connects with hostname and CA verification. It never uses `rejectUnauthorized:false`. The execution environment could not resolve the supplied AWS hostname, so actual AWS reachability, login, migration and live backend execution have not been tested. This is a connectivity limit here, not proof that the RDS instance is misconfigured.

## Weekly release ingestion and cover storage

`jobs/sync-new-releases.ts` runs Mondays at 09:00 UTC. It supports an authenticated Metron first-page sweep and versioned normalized GCD/Marvel/distributor feeds supplied by authorized upstream adapters. No public Marvel distributor endpoint or database-dump parser is fabricated. A complete GCD dump requires the existing dump-normalization tooling and the actual licensed dump file. Pagination/backfill beyond the saved Metron next cursor needs quota-aware expansion; the current job does not imply a complete catalog sweep.

The four cover tiers are licensed provider -> authorized publisher -> consented owner image -> metadata placeholder. Image origins and rights references must be explicitly allowlisted. JPEG/PNG bytes are bounded and uploaded by content hash to S3/R2 through the AWS SDK when storage credentials/bucket/CDN are set. GCD metadata access does not grant modern cover copying rights. All importer records retain the operator's metadata rights reference. No existing catalog automation is re-enabled.

Current ingestion is isolated in the sandbox release staging table. Production canonical catalog reconciliation, provenance mapping and activation need the existing central catalog importer; staging rows are not represented as verified canonical editions or as live FMV.

## Test and build

`npm install && npm run build && npm test`. A live RDS-backed startup additionally needs the Render secret/environment settings and successful DNS/TCP/TLS access. The package contains a migration integration test runnable with the isolated PGlite engine from the prior project. Unit checks run without connecting to AWS or eBay. The package has not been Docker-built or deployed in this execution environment; missing hosting source/workspace selection must be resolved first.
