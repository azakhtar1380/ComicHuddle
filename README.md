# ComicHuddle

Complete existing website, native mobile source, PostgreSQL architecture, and a dedicated Render interactive sandbox.

## Vercel deployment

The active deployment target is Vercel. Import this repository with Root Directory `deploy/vercel`. See [Vercel deployment guide](deploy/vercel/README.md). The Vercel package provides serverless APIs, production-only migration builds, verified AWS RDS TLS, and a protected weekly Cron endpoint.

## Alternate Render configuration

The root `render.yaml` selects `deploy/render/Dockerfile` with the `deploy/render` Docker context. The Node service verifies AWS RDS TLS, applies versioned migrations once on startup, and exposes `/health`. Set `DB_PASSWORD` and provider credentials only in Render environment settings. No secret value is stored in this repository.

See [Render sandbox guide](deploy/render/README.md) for configuration and test commands. The sandbox currently provides sample public-domain covers, illustrative valuations, simulated escrow/wallet flows, photo uploads, and actual token-free listing exports. Live payments, FMV, AI analysis and provider ingestion require their actual integrations. CSV/JSON exports do not imply publication to eBay.

## Source layout

- `app/`, `lib/`, `components/`: original Sites web application.
- `mobile/`: existing native mobile source.
- `architecture/platform-v2/`: complete SQL, TypeScript services and React components.
- `deploy/render/`: isolated PostgreSQL-backed Node sandbox and weekly release worker source.
- `README.site.md`: original website build instructions.

No existing catalog automation is re-enabled by this source import. The weekly Render worker is separately configured in the Blueprint and requires authorized provider and storage settings.
