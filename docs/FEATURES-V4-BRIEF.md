# Features round 4 (owner brief, 2026-11-15) — shared rules for helpers

Builds on `docs/REDESIGN-V3-BRIEF.md` (read its **Hard rules**; they all still apply: real data only, keep working
features, never weaken server checks, edit only your files, no PowerShell content edits, no `db:migrate`,
no deploy/commit/push, don't stop background node processes, no secrets printed, no paid AI). Keep the current theme,
header, layout and everything already built unless your task says otherwise.

The preview runs Stripe in **TEST mode**. Never call live Stripe. Never present SafePurchase, payouts or pickup-code
release as live unless the real pieces work end to end; gate them behind the existing flags and say what's missing.

## Shared foundations (owner-written, use them, don't fork them)
- `lib/admin.ts` — `isAdmin(user)`, `requireAdmin(user)`, `isFounder(user)`, `adminEmails()`, `adminLimit()`.
  Admins = signed-in accounts whose email is in env `COMICHUDDLE_ADMIN_EMAILS` (comma list, empty for now), capped by
  `COMICHUDDLE_ADMIN_LIMIT` (default 3). The site owner (`ownerAccountId`) is always admin and is the "Founder".
  `getChatGPTUser()` returns `{userId,email,...}`. **Every admin route/API action must call `requireAdmin` server-side.**
- `lib/notifications.ts` + migration 036 — `notify({userId,kind,title,body,href})` (never throws),
  `userIdForProfile(profileId)`, `listNotifications`, `markNotificationsRead`. Call `notify` for every event the
  owner asked to notify about. The offers helper builds the notifications API + bell UI.
- `components/user-avatar.tsx`, `components/account-prompt.tsx` (guest sign-in prompt; hub `gate(reason)`),
  `lib/avatar.ts`.
- Deep links: Messages `/?section=Messages&to=<profileId>[&listing=|&provider=]`, Marketplace
  `/?section=Marketplace&view=mine|sold|won`, Orders `/?section=Orders&role=buyer|seller`.

## Ownership (touch only your files; report exact changes needed elsewhere)
| Area | Owner | Files | Migration |
|---|---|---|---|
| Header, phone bar, account panel, More, hub wiring, sign-in, admin/founder identity in account-summary | owner | site-header.*, mobile-dock.*, components/account-panel.tsx, components/more-menu.tsx, hub.tsx, sign-in/*, app/api/account-summary, lib/admin.ts, lib/notifications.ts, design-system.css, globals.css | 036 |
| Product cards + detail card tabs + Wants removal from cards (#2, #3, #4) | cards helper | issue-showcase.*, shared-directory.*, collector-home.tsx/home.css (card parts only), app/characters/character-comics.tsx, marketplace.tsx + marketplace-redesign.css (cards and listing detail), components/cards/** | — |
| Cart (#5) | cart helper | app/cart/**, app/api/cart/**, lib/cart.ts, components/cart/** (incl. `AddToCartButton`, `CartButton` header/dock icon with count, `useCartCount`), checkout pieces it needs in lib/commerce*.ts **only via new exported functions appended at the end** | 038 |
| Offers & trades page, notifications API + bell, delivery info to seller, pickup code UI (#6, #10, #11) | offers helper | app/offers/**, app/api/offers/**, app/api/notifications/**, components/notifications/**, components/offers/**, commerce-desk.tsx, marketplace-order-progress.*, trade-terms.tsx, lib/offers.ts | 039 |
| SafePurchase focus, admin dashboard, audit log, admin badge, payouts/wallet (#7, #8, #9) | safepurchase helper | app/admin/**, app/api/admin/**, app/safepurchase/**, feature-info.*, collector-wallet.tsx, app/wallet/**, lib/commerce-protection.ts, lib/safepurchase*.ts, lib/admin-audit.ts, components/admin/**, lib/stripe-connect-v2.ts | 040 |
| Business profiles + verified tick (#12), My collection gaps (#13) | profiles helper | network.tsx/network.css (profile form + profile view only — messaging lives in components/messages, don't touch it), components/profile/**, components/verified-badge.tsx, app/verified/**, my-collection.*, add-comic.*, lib/business-profile.ts, app/api/business/** | 041 |

Files used by several areas (`lib/commerce.ts`, `app/api/commerce/route.ts`, `app/api/social/route.ts`,
`lib/marketplace.ts`, `lib/community.ts`): you may **append** new exported functions / new actions in clearly
marked blocks (`// --- <area> (round 4) ---`). Do not rewrite or reorder existing code in them; keep changes minimal.

## Owner decisions already made (defaults)
- Accepted offers and trades go to their own checkout, not the cart.
- Wants: remove from product cards and the detail card UI only; keep code and data; keep the Wants tab in My collection.
- SafePurchase receiving address: the existing `SAFEPURCHASE_INSPECTION_ADDRESS` setting; when empty show a clearly
  marked placeholder ("ComicHuddle receiving address — set by the owner"), never a fake address.
- Admin emails: empty until the owner provides them.
- Payout schedule, minimum and fees: Stripe's defaults until the owner decides.
- Pickup code: expires after 7 days; expired unused → buyer refunded; buyer can report a problem instead of sharing.
