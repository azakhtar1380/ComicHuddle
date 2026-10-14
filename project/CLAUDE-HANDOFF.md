# ComicHuddle complete source handoff

## Open the project

Two separate archives are supplied: ComicHuddle-Web-Source.zip is the complete website at the exact published Git revision; ComicHuddle-Mobile-App.zip is the complete Expo/React Native project with unsigned web/iOS/Android exports. Extract them into separate folders and use each project's own package.json. The combined launch kit retains the prior branding and both handoffs. No provider/payment/signing credentials or private customer database is included.

The source website uses React, Tailwind component utilities, Vinext/Vite, Cloudflare D1/R2 and Sites identity. Preserve .openai/hosting.json if continuing this same owned Site. A deployment elsewhere needs an explicit hosting/auth/storage adapter, not a guessed shared service token. The PostgreSQL blueprint/reference lives under architecture/postgres; it is tested locally but is not the running database.

## Current behavior

Directory cards show only a cover or neutral missing-cover icon, issue title/#, publisher and More info. Mobile shows two portrait cards per row, including a previously selected desktop List layout. The breadcrumb bar and mobile publisher/series strip are removed; search and Publisher filters remain. Contained desktop publisher/series browsing remains. The clicked view contains stored GCD stories/credits, source attribution, ownership form and exact-issue Buy. The middle of the mobile dock is a raised Scan action; it continuously recognizes six authorized vintage covers on the web, with confirmation. The native device prototype hands off to the web scanner.

GCD metadata is imported centrally, with stable GCD IDs distinct from starter/Metron IDs, rate/Retry-After handling, checkpoints and reported counts. Original cover price is publisher bibliography, never FMV. Imported cover images and live FMV are absent pending separate rights. FMV, Community and GrailMatch remain Coming soon. Hosted native web preview reads the actual central catalog; iOS/Android retain a starter snapshot and website handoff pending native auth.

## Full GCD catalog work

The GitHub wiki is API documentation, not the database itself. The official anonymous limit is 30/hour, unsuitable for fast full-history ingestion. Use the supported authenticated GCD bulk-download route at https://www.comics.org/download/ and retain its attribution/license. The full dump is not included in this kit.

Load the authorized snapshot into an isolated staging database, map exact edition/variant identities without inventing printings or merging titles blindly, import in resumable batches, and preserve existing ownership/listing references. Do not claim full coverage until counts reconcile. The weekly API feed supplies new-release metadata but is not a global historical change stream; historical revalidation or refreshed bulk snapshots are needed.

The one-time ingestion path is implemented in scripts/gcd_sqlite_to_jsonl.py → scripts/gcd_bulk_convert.mjs → scripts/gcd_bulk_upload.mjs → /api/gcd-bulk. Read project/GCD-BULK-IMPORT.md before running. The SQLite adapter validates actual table/column presence, opens its supplied file read-only, exports active issue identities/core bibliography/legacy story text and produces a mapping report. It does not reconstruct every linked Django display field. The actual complete licensed archive is absent; capacity and schema must be checked against that file. Equal or newer API records are retained, and weekly checkpoints/quota are separate.

The included data/ComicHuddle-Current-Catalog.csv in the mobile package is a dated export of the public catalog actually stored on the website. It is not the complete GCD database and is not the normalized bulk-import CSV schema. Its export record gives the actual count and date.

## Validation and unfinished integrations

See project/PRODUCTION-ARCHITECTURE.md, project/FINAL-HANDOFF-QA.md and the mobile package's project/PUBLICATION-RECORD.json. Earlier scan and GCD reports are retained as dated records. Use the final release's actual counts. Native exports are unsigned. Physical-device/browser, real OAuth, actual processor payments/refunds/payouts, separate-server concurrency/load/restore and a PostgreSQL cutover need actual verification; synthetic fixtures do not establish those outcomes.

## Entry points for continued development

- Website UI: app/hub.tsx; compact cards and responsive directory: app/shared-directory.tsx and app/shared-directory.css; clicked details: architecture/postgres/ui/ComicProductCard.tsx and app/directory-product-card.css.
- Catalog persistence/provider namespaces: lib/catalog-store.ts, lib/shared-catalog.ts, lib/gcd-catalog.ts; weekly checkpoint: lib/gcd-sync.ts; bulk provenance/receipts: lib/gcd-bulk.ts.
- Native UI: NativeApp.tsx and app-styles.ts; cover and dock geometry: art-layout.ts; platform/account handoffs and hosted catalog behavior are tested in checks/native-journeys.mjs.
- Database: db/schema.ts and ordered drizzle migrations. architecture/postgres is an isolated reference, not the deployed database.
- Frontend/source tests: checks/run-readiness.mjs. The prepared browser acceptance suite is architecture/e2e and has not been run here.

Before live money, connect verified seller onboarding, inventory/payment reconciliation, refunds/disputes and carrier evidence. Before all-cover scan, obtain authorized cover references and evaluate reprints/variants and physical camera behavior. Existing account/private projection and provider identity checks must be preserved.
