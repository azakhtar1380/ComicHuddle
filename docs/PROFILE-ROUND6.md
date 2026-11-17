# Round 6: My Profile, comic shop, Worlds, verified people, trophies

Branch `launch-v2`. Six phases, one commit each. Migrations are additive (safe to re-run) and go to QA first.

## Migrations

| # | File | What it adds |
|---|------|--------------|
| 051 | `051_profile_extras.sql` | `profile_extras`: cover photo, tags, favorite character and comic, grail + reward, what the public link shows. |
| 052 | `052_collection_shop.sql` | `profile_extras.shop_window` (open / window / closed, default window), `collection_runs`, and `vault_copies` (when each copy was added or removed, its Directory issue and normalized cert). |
| 053 | `053_profile_worlds.sql` | `profile_extras.world`, `ink`, `frame`, `sfx`. |
| 054 | `054_person_verification.sql` | `person_verifications`: the verified check for individual collectors. |
| 055 | `055_trophies.sql` | `user_trophies`, `trophy_prefs`, `trophy_stats`, and `vault_wants` (wishlist history for Grail Hunter). |
| 056 | `056_origin_story_nudge.sql` | `profile_extras.origin_nudged_at`, `origin_snoozed_at`. |

## Settings (Vercel environment variables)

| Setting | Value / note |
|---|---|
| `FOUNDING_HUDDLER_UNTIL` | **new**, not set. ISO date (e.g. `2027-03-01T00:00:00Z`). Accounts created before it earn Founding Huddler. Unset = nobody earns it. Never earnable after the date. |

No other new settings. The daily trophy sweep runs inside the existing daily `/api/cron/enrichment` job (no new cron).

## Phase 1: My Profile and the shareable link
- Profile page (`components/profile/profile-page.tsx`): top bar, cover photo (upload via `/api/profile-cover`, same limits and rules as profile pictures), 124px photo with a thin yellow ring, Mr. Huddles cutout (`public/mascot/huddles-cutout.webp`, made by `scripts/make-huddles-cutout.mjs`), Share and Theme buttons, Founder badge for the founder only, name card, origin story box, stats, tabs, favorites, favorite character and comic, WANTED grail poster, Now reading, trophy case preview, latest review, link bar.
- Clean link `/@handle` (`proxy.ts` + `app/profile/[handle]`); hidden, moderated or unknown profiles get a real 404 and no meta. `/?collector=handle` redirects. Open Graph/Twitter image at `/api/og/profile?handle=`.
- Share screen: Slab / Trading card, QR code ("Scan at the con"), copy link, Instagram, Facebook, Messages, Save card, More (each falls back to copying the link), chat preview, public-link switches (collection value is always private).
- Guests can now read visible profiles (`/api/social?kind=profile`).

## Phase 2: My Collection as your comic shop
- Shop front (`components/collection/shop-front.tsx`): awning, sign, Stock comics (Scan / From Directory / Import list), search, section chips, New arrivals, glass case, trade bin, runs wall, back-issue bins, the register (value hidden until tapped; only existing Directory estimates), shop window. Every section opens the existing list views.
- Runs (`lib/collection-runs.ts`, `/api/collection-runs`): owned and missing always computed from the vault; "Add missing to wishlist".
- Public Collection tab (`/api/collection-shop?handle=`) follows the shop window. Never value, price, notes, certs or the member's photos.
- Vault cap stays 1,000 (see the open question below).

## Phase 3: Worlds
- `lib/profile-worlds.ts` is the one definition for the profile, Theme screen, share cards and OG image. Ten worlds (all free), five inks, four frames (the starburst only when picked), six sound effects.

## Phase 4: Verified people and businesses
- Collectors ask from the Account panel ("Get verified") → pending → we contact them → an admin turns the check on in /admin (Verified collectors). Logged in the verification events and admin audit log; the collector is notified.
- `components/verified-badge.tsx` takes `kind="person" | "business"`; same blue; accessible name and label "Verified collector" / "Verified business"; businesses also get the blue "Shop" tag.
- **Not built: the $10 fee.** There is no existing verification payment in the code, and new charges need the owner's OK (see open questions).

## Phase 5: Trophies
- Definitions and fair-play rules: `lib/trophy-defs.ts`. Counting and awards: `lib/trophies.ts` (`computeTrophyProgress`, `awardTrophies`, idempotent).
- Checked after vault saves, profile saves, photo and cover uploads, reviews, cover approvals and verification decisions, plus a daily sweep for every member (order trophies count only after the review window, so the sweep is what awards them, and it catches revocations).
- Notifications: kind `achievement`, trophy icon and yellow highlight, filter chips (All · Trophies · Orders · Offers · Community), "Almost there" with a progress bar, switches on /trophies (Unlocks on, Almost there on, Weekly recap off; the weekly recap email itself is not sent yet).
- Unlock screen once per unseen unlock; percentage shown only with 50+ collectors (computed daily).
- Admin can revoke or restore a tier in /admin (Trophies), logged in the audit log.
- **Push notifications:** the app has no push yet, so unlocks are in-app only.

## Phase 6: Origin story nudge
- One `system` notification for members whose Origin Story isn't earned, linking to `/origin-story` (the "ORIGIN STORY #1" card). "Remind me after my next haul" snoozes until they next add comics.

## Tests
- Logic: `checks/profile-page.test.ts`, `collection-shop.test.ts`, `profile-worlds.test.ts`, `verified-badge.test.ts`, `trophies.test.ts`, `origin-story.test.ts`.
- Browser: `e2e/6-profile.spec.ts` … `e2e/11-origin.spec.ts`.
