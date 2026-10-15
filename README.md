# ComicHuddle

Current deployed scope and measured results: [Launch stabilization — 15 October 2026](project/LAUNCH-STABILIZATION-20261015.md). This report supersedes older FMV/AI/Pulse and D1/R2 handoffs. FMV and Market Pulse are deferred; new checkout is paused pending the documented payment release gates.

The original ComicHuddle application: collector homepage, shared directory, non-AI comic scanner, collections, profiles, marketplace, nonbinding auction previews, messaging, Comic Workshop inquiries, native mobile source, and platform service architecture.

Vercel serves the Next.js application at the **repository root**. Its original backend now uses AWS RDS PostgreSQL, secure account sessions and persistent photo storage. The replacement deployment sandboxes have been removed.

See [Deployment and verification](DEPLOYMENT.md) for setup, migration behavior and remaining provider requirements.

- `app/`, `lib/`, `components/`: actual application and its APIs.
- `db/`: native PostgreSQL schema, database pool and versioned migrations.
- `mobile/`: original React Native application source.
- `architecture/`: service blueprints and historical references; these are not a claim that deferred comps/photo AI or every proposed service is deployed.
- `public/`: original brand, covers, recognition index and mobile assets.

No database passwords, hosting tokens or provider secrets are included.
