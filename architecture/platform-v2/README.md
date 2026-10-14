# ComicHuddle platform package

Start with [BLUEPRINT.md](BLUEPRINT.md). It maps all seven modules to executable files, explains the current hosted D1 backend vs the new PostgreSQL package, and lists provider contracts and public-release gates.

- `sql/`: complete additive PostgreSQL DDL and security grants.
- `src/`: driver-neutral TypeScript services, real provider HTTP clients, durable worker and explicit restricted/licensed integration ports.
- `ui/`: React/Tailwind homepage, directory card, wallet, collection modal and CGC links.
- `config.example.ts`: disabled live defaults.
- `tests/`: service/DDL, UI and retained-app regression evidence and runnable checks.

The redesigned homepage is connected to the existing catalog in `app/collector-home.tsx`; the new PostgreSQL services require a reviewed backend cutover and external account setup. Do not enable escrow/wallet, current FMV or authenticity claims solely because these files compile.

No catalog refresh schedule was re-enabled. The private Site audience is preserved.
