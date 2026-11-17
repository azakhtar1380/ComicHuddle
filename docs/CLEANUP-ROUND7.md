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
