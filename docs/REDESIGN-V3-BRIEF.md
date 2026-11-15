# Platform redesign v3 (owner brief, 2026-11-15) — shared rules for helpers

Improve the existing ComicHuddle app in place. Do not rebuild. Keep the theme from
`docs/REDESIGN-BRIEF.md` and `docs/REDESIGN-POLISH-BRIEF.md`: cream paper, ink, comic red and yellow,
Barlow Condensed headlines, DM Sans text, the radius tokens (`--radius-pill/sm/md/lg/sheet`), type ≥ 12px,
and Huddles art from `components/huddles-guide.tsx`. Shared UI pieces are in `components/` (page-header,
states, huddles-guide, user-avatar) and `app/design-system.css`.

Direction: premium, modern, friendly, clean. Fewer borders, no cards inside cards, no oversized icons, no
unnecessary explanatory text, no big empty right-side areas. Use the real width deliberately.

## Hard rules
- Real data only. Never invent ratings, reviews, prices, turnaround times, credentials, values, first
  appearances, key-issue claims, characters or credits. When a field is missing, hide it or say "Not listed".
- Keep every working feature (auth, listings, checkout, auctions, collections, messaging, workshop).
  Server-side validation and permissions stay as they are or get stricter, never weaker.
- Edit only the files you own (below). If you need a change in someone else's file, say so in your final
  report with the exact change; do not make it.
- Never edit source with PowerShell `Get-Content/Set-Content` (it corrupts UTF-8). Use Edit/Write or node scripts.
- Do not run `npm run db:migrate`, do not set `MIGRATE_ON_BUILD`, do not touch production. If you truly need a
  column, write an additive migration file with your reserved number (below) using `ADD COLUMN IF NOT EXISTS` /
  `CREATE TABLE IF NOT EXISTS` in schema `ch_web`, and the code must still work when the column is missing
  (or tell the owner). The owner applies migrations to the QA database.
- Do not deploy, commit, push, or stop/restart background node processes (cover copy, visual index, character
  crawl/import are running and must keep running). Do not start a dev server on port 3000 if one is running;
  use 3001+ if you need one (`npx next dev --webpack -p 3001`).
- Never print secrets (env files, keys, tokens, DB passwords).
- No paid AI APIs, no scraping other sites.
- Avatars: use `components/user-avatar.tsx` (`<UserAvatar name src color size/>`). Profiles carry an optional
  `avatarUrl` (CollectorProfile.avatarUrl). The owner is adding uploads and the `/api/avatar` route.
- Messaging is one system (`lib/conversations.ts` + `app/network.tsx` inbox). Other areas open it, they never
  build their own chat. Opening a conversation from elsewhere: navigate to `/?section=Messages&to=<profileId>`
  with optional `&listing=<listingId>` or `&provider=<providerId>` context (the Messaging helper makes that work).
- Finish with: `npx tsc --noEmit -p .`, `npx eslint <your files>` (0 errors), and any `checks/*.test.ts` that
  touch your area (`node --import tsx --test checks/<file>`). Report what you changed, what you could not do, and
  anything that needs the owner.

## Ownership
| Area | Owner | Files | Migration no. |
|---|---|---|---|
| Header, More, account panel, profile pictures, sign-in/up, guest prompts, phone bar, hub wiring | owner | site-header.*, header-search.*, mobile-dock.*, components/account-menu.tsx, hub.tsx, sign-in/*, account-settings.tsx, account-pages.css, app/api/avatar, lib/avatar.ts, lib/community.ts, design-system.css, globals.css, components/user-avatar.tsx | 033 |
| Comic Workshop | workshop helper | pressing.tsx, pressing.css, lib/pressing.ts, lib/workshop-directory.ts, app/api/pressing/** (new files under app/workshop/** allowed) | 034 |
| Messaging | messaging helper | network.tsx, network.css, lib/conversations.ts, app/api/social/** (new components under components/messages/** allowed) | 035 |
| Comic detail + data accuracy + GoCollect/CGC links | detail helper | issue-showcase.tsx/.css, issue-values.tsx, lib/value-links.ts, lib/issue-insights*.ts, cgc-guide.tsx/.css, estimated-value.*, character-comics.tsx, lib/catalog*.ts (mapping fixes only), lib/characters.ts | — |
| Selling, listings, auctions, collection, listing→comic click | selling helper | listing-builder.*, marketplace.tsx, marketplace*.css, marketplace-checkout.tsx, commerce-desk.tsx, trade-terms.tsx, add-comic.*, my-collection.*, comic-picker.*, comic-multi-picker.*, lib/marketplace*.ts, lib/listing-*.ts, lib/auction-engine.ts, lib/collection-entry.ts, app/api/marketplace/**, app/api/listing-draft/** | 036 |
