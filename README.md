# ComicHuddle

The complete original ComicHuddle application: collector homepage, shared directory, comic scanner, collections, profiles, marketplace and auctions, messaging, Comic Workshop, native mobile source, and platform service architecture.

Vercel serves the Next.js application at the **repository root**. Its original backend now uses AWS RDS PostgreSQL, secure account sessions and persistent photo storage. The replacement deployment sandboxes have been removed.

See [Deployment and verification](DEPLOYMENT.md) for setup, migration behavior and remaining provider requirements.

- `app/`, `lib/`, `components/`: actual application and its APIs.
- `db/`: native PostgreSQL schema, database pool and versioned migrations.
- `mobile/`: original React Native application source.
- `architecture/`: SafeTrade, wallet, comps, photo AI and cross-listing service blueprints.
- `public/`: original brand, covers, recognition index and mobile assets.

No database passwords, hosting tokens or provider secrets are included.
