# Cleanup round (after phone testing)

One commit per section. User data is never deleted: removed features leave their database columns and tables in place, unused.

## 1. One collection
The My Collection page is gone. The profile's Collection tab is the only collection; old `?section=Collection` links redirect to `/?section=My%20Profile&ptab=collection` (For trade keeps its chip).

## 2. Overview picks from the Directory
The owner picks the six favorites, favorite character, favorite comic and the WANTED grail (60-character reward) from per-section Edit buttons or "Pick from the Directory". Sheets save at once (`/api/profile-extras`) and update the page without a reload. The Edit profile form keeps only tags.

## 3. No themes
Theme screen, worlds, inks, frames and the POW sticker are removed. `profile_extras.world/ink/frame/sfx` (migration 053) stay, unused. Origin Story is now photo, cover, favorite character, favorite comic and grail.

## 4. Profile header
Cover 170px with Change cover at top-right; Share · photo (camera, Mr. Huddles) · Edit profile/Message; Founder or Admin badge; "Get verified ($10)" or the pending pill for the owner; four equal tabs that fit at 360px.

## 5. Share card
One card (see `docs/PROFILE-ROUND6.md`), PNG drawn on a canvas only when needed; OG image in the same look, landscape.

## 6. Share window speed
- The window's code is its own chunk (`components/profile/profile-share-loader.tsx`), warmed when the profile page is idle and on hover/touch/focus of Share; once loaded it renders in the same frame as the tap.
- The preview is plain HTML with the already-cached photo and cover; no data URLs, no SVG strings.
- The PNG is built only for Instagram, Save card or More (spinner on the button), from the 320×320 avatar and a 1080-wide cover (`/api/profile-cover?id=…&w=1080`), decoded off the main thread with `createImageBitmap`, drawn after a frame, and cached per card for the session.
- The QR code is made once per link, just after the window paints. Dialog focus moves just after the first paint (it used to force a full-page layout before anything showed: ~60ms of the open task).
- The wallet, payouts and trophy panels no longer re-render when a window opens.
- Public-link switches update at once and save in the background (rolled back on error).
- `/mascot/*` and `/brand/*` are served with `Cache-Control: public, max-age=31536000, immutable`; the mascot and logo are preloaded at low priority.

Measured with `e2e`-style timing on the local dev server, CPU slowed 4× to stand in for a mid-range phone, real-size photo and cover, 5 runs each (median):

| | Before | After | Target |
|---|---|---|---|
| Tap → share window painted with the card | 167 ms | 109 ms | ≤150 ms |
| Tap → dialog visible | (same as above) | ~80 ms | |
| Longest main-thread task while opening | 141–190 ms | 76–90 ms | ≤50 ms |
| Tap Save card → PNG downloaded | 549 ms | 553 ms | ≤1.5 s |

The remaining open task is mostly React's development-mode work (`jsxDEV`, prop validation) that a production build doesn't run; a production build couldn't be measured locally because the in-memory test database is disabled in production mode. Re-measure on the QA deployment with the browser performance panel.

## 7. Notifications panel
Under 640px the bell always opens the bottom sheet (full width, max 85vh, grab handle, Notifications, Mark all read, close; body scroll locked). On desktop the dropdown is anchored under the bell with `position:fixed`, kept 12px inside the window, above the header. Filter chips scroll sideways inside the panel (shared hidden-scroll-bar row). Titles wrap, bodies clamp to 2 lines, time on its own line; the unread dot and trophy icon share one 28px slot. Escape, outside tap and the close button close it and focus returns to the bell. Test: `e2e/14-notifications.spec.ts`.

## 8. Account panel
- "Get verified" is a normal row, first under "You": BadgeCheck, label, and a pill on the right (Not verified / Pending / Verified; a fixed-size shimmer while the status loads). Not verified opens the verification sheet ($10 fee first); pending or verified opens /verified. Business accounts go to My Profile (business details).
- "Profile & showcase" is now "My profile" and opens My Profile (so does "View my profile").
- The drawer slides with transform only (220ms ease-out, `will-change: transform`), the backdrop fades; the full-screen blur is gone (it repainted every frame). Reduced motion: fade only. Scroll lock pads the page by the scroll bar's width, so nothing jumps sideways (shared in `lib/dialog-focus.ts`, so every dialog benefits).
- The drawer's open state moved out of the app shell into `lib/drawer-store.tsx`: opening it re-renders only the drawer and the two buttons that show its state, not the whole page.
- Focus is trapped, Escape and the backdrop close it, focus returns to the account button.

Measured like section 6 (dev server, CPU 4× slower, 5 opens, median):

| | Before | After | Target |
|---|---|---|---|
| Click → panel painted | 223 ms | 100 ms | |
| Longest main-thread task while opening | 193–259 ms | 86–88 ms (first open 130 ms) | ≤50 ms |
| Layout shift while opening | 0 | 0 | 0 |

Most of the remaining task is React development-mode work in the panel's first render; re-measure on the QA deployment. Test: `e2e/15-account-panel.spec.ts`.

## Owner mockups (profile header and slab)
- Profile header: dark striped band behind the photo row, name card, origin story and stats; red Share and yellow Edit profile buttons with labels; a Founder pill under the photo (founder only); Admin shown as a tag for other admins; four stat boxes with red numbers (Issues, Keys, Wishlist, Trades). "Now reading" is removed from profiles (the saved field stays, unused).
- Share card: the slab only (no Trading card): night background with soft rays, clear slab with a red offset shadow, label with 9.8 COLLECTOR, name (+ check), @handle · Since, stats line, Fave / Grail, WHITE PAGES · BAGGED & BOARDED; the member's cover in the window with a Founder! sticker for the founder; photo with a yellow ring and Mr. Huddles; comichuddle.com/@handle. Under it: Scan at the con (real QR), the link with Copy link, and Instagram, Facebook, Messages, Save card, More.

## 9. Founder badge, name and handle changes
**Founder.** The founder is the owner account id (`COMICHUDDLE_OWNER_USER_ID`) **or** the account whose email matches the new private setting `COMICHUDDLE_FOUNDER_EMAIL` (one email, case-insensitive) — `isFounder` in `lib/admin.ts`, `staffBadgeForUser` / `staffBadgesForProfiles` in `lib/admin-audit.ts`. The founder is always an admin and shows the Founder badge only (others show Admin). Only `founder:true` reaches the browser. Badges now also show on listing seller cards and message threads. Owner-only tools (SafePurchase sweeps, reports, restrictions) still check the owner account id only.

**Name and handle changes** (migration `058_profile_name_changes.sql`):
- Edit profile shows "2 changes left" / "1 change left" / "No changes left — contact support" under Display name and Handle; at 0 the field is read-only; saving a change asks first ("Change your handle to @new? You'll have 1 change left.").
- The server enforces it in the profile action (`app/api/social/route.ts`): 2 name and 2 handle changes per account; creating the profile doesn't count; admins and the founder are unlimited; unchanged values don't count. Staff words (admin, comichuddle, founder, support, staff, mod, official… including look-alikes like `adm1n`) and a starter list of offensive words are blocked (`lib/name-rules.ts`; there was no existing moderation word list, so this adds one to extend).
- Every change is logged in `ch_web.profile_name_history`. A given-up handle is held for 30 days, and `/@old` redirects (308) to `/@new` for 90 days (`/api/profile-status` → `proxy.ts`).
- Admin → Member names: look up @handle, reset change counts, or rename a handle. Both are written to the audit log and the member gets a notification.
- Listings, messages, reviews, the share card and OG read names from the profile at request time, so they show the current values. Notifications keep the text they were sent with.

Tests: `checks/founder-names.test.ts`, `e2e/16-names.spec.ts`, `e2e/17-founder.spec.ts` (the test server sets `COMICHUDDLE_FOUNDER_EMAIL` to the admin test account).
