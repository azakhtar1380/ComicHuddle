# ComicHuddle on Vercel

Import `azakhtar1380/ComicHuddle` with Root Directory `deploy/vercel`, Framework **Other**, Install Command `npm install --include=dev`, Build Command `npm run build`, Output Directory `public`, Node.js 22.

Serverless functions use a verified AWS RDS CA certificate downloaded during the build. Configure `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` (Secret), `DB_SSL=true`, and `MIGRATE_ON_BUILD=true` for **Production only**. Production builds execute the three versioned PostgreSQL migrations under a checksum ledger and advisory lock. Preview builds do not modify the production database. No database password is stored in the repository.

`vercel.json` configures a weekly Monday 09:00 UTC production Cron invocation of `/api/cron/new-releases`. Set a random server-side `CRON_SECRET` (Secret); the endpoint requires the automatic Vercel Bearer header. Cron does not run on preview deployments. Missing approved feed configuration returns `skipped` without importing anything. Authorized Metron or normalized GCD/Marvel feeds, metadata rights and licensed cover storage still require their actual provider settings. The worker stages at most 25 releases per invocation and retains budget checkpoints; full historical ingestion and canonical-directory reconciliation are separate tasks.

The UI remains an interactive sandbox: public-domain sample covers, illustrative multi-grade valuations, simulated escrow and wallet state, and real token-free CSV/JSON listing exports. Photo uploads return inconclusive until a vision gateway is configured. No real payments, eBay publication or authenticity guarantee is implied.

Run `npm test` for Cron authentication, feed setup, routing, same-origin enforcement and health tests. Actual RDS migrations, cloud scheduling and live API verification must be confirmed from deployment logs after Vercel project configuration.
