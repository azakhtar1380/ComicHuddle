# ComicHuddle header and selection release

Production preview: https://comichuddle-abdul-aziz-akhtars-projects.vercel.app/

Runtime commit: `44479acd5f8a833944204b5b57c7bb6940fad1ca`

Vercel deployment: `dpl_uC4747bGbgQoh3MNonqsu5aT2cYc` (READY, production)

Immutable deployment: https://comichuddle-ow7459bxz-abdul-aziz-akhtars-projects.vercel.app

## Changes

- Home, Wallet and SafePurchase share `app/site-header.tsx` and menu typography.
- Removed the Upcoming page component, homepage block, navigation and footer entry. Legacy roadmap section links resolve to Home. Release ingestion jobs and catalog metadata remain intact.
- Expanded the homepage Comic Workshop spotlight with pressing, dry cleaning and pre-grading guidance, specialist search and studio registration actions.
- Grails use one directory search dropdown and a removable selected list, supporting one to six favorites. Directory favorites do not create privately owned books.
- Collection entry supports one or multiple comics, a visible selection list, removal and a single batch save with stable copy IDs.
- Listings use one owned-copy dropdown and the same selected-list pattern, with single/multiple modes and a whole-collection shortcut. Adding new directory comics can append several copies to the listing selection.
- Profile/listing acknowledgements no longer wait for the entire social network to refresh. Requests have bounded waits, visible errors and retained choices on unconfirmed saves.
- Exact native catalog identity lookups replace broad directory-view joins in the affected vault and listing validation paths. Ownership, canonical identity, inventory reservations and duplicate protection remain enforced.
- Sign-in links go directly to `/sign-in`, with prefetched account links and server-selected registration mode. Anonymous requests avoid loading the authentication module until a session cookie exists.
- Auth artwork download reduced from 3,335,568 to 318,898 bytes; shared logo from 531,393 to 58,257 bytes. No password or session protections were reduced.

## Verification

- Local TypeScript check and production build passed.
- Vercel production compilation, TypeScript and static page generation passed.
- Three focused persistence checks passed: exact native GCD single listing; multi-comic listing with inventory reservation and duplicate protection; directory grails preserving selection order and private ownership data.
- Public browser verification confirmed the same six menu labels and computed typography on Home, Wallet and SafePurchase: DM Sans, 12px, weight 600 at the checked desktop viewport.
- The checked pages had no document-level horizontal overflow. The compact shared logo loaded correctly.
- Home contains no Upcoming links or headings; the expanded specialist section is present.
- Direct Sign in and Join free links rendered their expected account mode, and the in-page Log In/Sign Up toggle worked. Both optimized auth images loaded.
- Authenticated browser saves and a full transaction suite were not rerun. The focused persistence checks exercise the changed data logic in an isolated database, not the user's live account.

No schema migration, catalog sync, environment-secret update, payment transaction or paid AI call was needed for this release. The existing AWS RDS connection and application records were preserved.

Visual evidence: `evidence/comichuddle-shared-wallet-header-1792047716041.jpg`
