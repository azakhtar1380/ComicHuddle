# Cleanup round 8 (Nov 2026)

Smooth scrolling, custom comics, optional SafePurchase, a notifications dropdown that hangs from the bell, a new listing page, on-page payments, Google/Apple sign-in, and auctions that can't be ended once live.

## Database (additive, QA first; never production without a separate go-ahead)
- `059_seller_strikes.sql`: one row per order where a seller missed the shipping deadline on a won auction.
- `060_payment_handoffs.sql`: "Pay on your phone" one-time codes (hash only) and the buyer's private saved shipping address.

## Settings (names only; values go in Vercel)
| Name | Default | What it does |
|---|---|---|
| `SAFEPURCHASE_THRESHOLD_CENTS` | `100000` | SafePurchase is offered when the item price (not shipping) is at least this. |
| `SAFEPURCHASE_FEE_CENTS` | `2500` | The check fee the buyer pays on top. |
| `SAFEPURCHASE_INBOUND_SHIPPING_FALLBACK_CENTS` | `1500` | Used, and labelled "estimated", when no EasyPost rate from the seller to the inspection address is available. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | none | Turn on "Continue with Google". |
| `APPLE_CLIENT_ID` (Services ID), `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (.p8 contents; `\n` escapes OK) | none | Turn on "Continue with Apple". Optional `APPLE_APP_BUNDLE_IDENTIFIER` for a future native app. |

## Redirect URLs and domains to register
- **Google Cloud console → OAuth client (Web):**
  - Authorized JavaScript origins: `https://<domain>`.
  - Authorized redirect URIs: `https://<domain>/api/auth/callback/google`.
  - Add one of each per domain: the production domain, `test.comichuddle.com`, and the QA alias `comichuddle-launch-qa-abdul-aziz-akhtars-projects.vercel.app`.
  - For local work also add `http://localhost:3000/api/auth/callback/google`.
- **Apple Developer → Identifiers → Services ID (Sign in with Apple):**
  - Domains: the same hosts, without `https://`.
  - Return URLs: `https://<domain>/api/auth/callback/apple`.
  - Apple doesn't accept `localhost`, so test Apple sign-in on QA.
  - Create a Sign in with Apple key (.p8); its Key ID and your Team ID go in the env vars above.
- **Stripe → Settings → Payment method domains:**
  - Register every domain that shows the payment form, in test mode and again in live mode.
  - Test mode already has QA, `test.comichuddle.com` and the main Vercel domain (Admin → "Apple Pay & Google Pay domains" shows the live status).

## What changed, per section
1. **Custom comics:** "Can't find the comic? Add your own" in the listing builder.
   - Title is 3–120 characters, description up to 1,000.
   - Stored on the listing only (`source:'custom'`), never in the Directory, catalog or a collection.
   - Shown with the listing photos, a placeholder cover and a "Not in Directory" tag.
   - Goes through the same banned-word checks. Admins see a "Listings with custom comics" table.
2. **SafePurchase:**
   - Optional, and offered only at $1,000+ for shipped orders. The buyer chooses Standard (the default) or SafePurchase on the listing and in the cart.
   - The extra is the EasyPost rate from the seller's ZIP to the inspection address (or the fallback, marked estimated) plus the $25 check fee. It appears as its own line and goes to ComicHuddle; the seller's payout is unchanged.
   - The seller is paid once the comic is checked and shipped to the buyer (no wait after delivery). A failed check uses the existing refund flow, which includes the extra.
   - Problems after delivery use the normal 30-day claim. Once the seller has been paid, an approved claim is refunded by ComicHuddle from its Stripe balance: Admin → order → "Refund buyer from ComicHuddle" (full by default, or a smaller amount), or the usual "approve refund" on that order. No transfer reversal; the seller keeps the payout. One per order; Stripe’s webhooks for it don’t put the order on hold; it counts as a cost in Owner revenue (`safePurchaseRefundsCents`).
3. **Notifications:** the dropdown hangs from the bell on every screen size.
   - Its pointer sits under the bell, and the panel stays at least 12px from the screen edges, `min(520px,75vh)` tall.
   - It opens with a 160ms fade plus a 6px slide (fade only with reduced motion).
4. **Listing page:**
   - 4:5 swipeable gallery with dots, a count, and fullscreen pinch-zoom. With no photos, it shows the first comic's cover with a "Stock image" tag.
   - "Comics in this listing (n)" uses each comic's own cover, and tapping one opens the issue (a custom comic opens a sheet). Then the description, shipping, and the seller card.
   - Collection cards show "{n} comics".
   - **Covers bug:** old caption CSS (`.comic-photo>span`, `.comic-photo.small>span`, `.mp-item-art .comic-photo>span`) also matched the span that wraps a resolved cover, which hid or mispositioned it. The rules are now scoped to `:not(.resolved-cover)`. Separately, catalog art stays off by policy (`CATALOG_ART_COVERS`), so comics without an approved member cover still show a placeholder. `e2e/19-listing-page.spec.ts` fails on 404s or empty images.
5. **On-page payments:**
   - Apple Pay and Google Pay buttons (Express Checkout) above a card-only form, with no redirects (`redirect:'if_required'`).
   - Google Pay is hidden on iPhone/iPad. Apple Pay is set to `always`, which Stripe documents for Chrome, Edge and Firefox on desktop.
   - Link, PayPal and pay-later are off. PayPal, Amazon Pay, Klarna, Affirm, Afterpay, Cash App and bank debit are excluded on the session. Stripe won't exclude Link there, so both elements hide it.
   - Cards use the order's shipping address as the billing address.
   - Checkout prefills the buyer's private saved address, with "Save this address for next time".
   - Desktop: **Pay on your phone** shows a one-time QR code that lasts 10 minutes and works only for the same signed-in buyer and the same unpaid order. The desktop page updates when payment lands.
   - Holds, webhooks, orders, fees and payouts are unchanged.
6. **Google and Apple sign-in:**
   - Accounts link by verified email, and Apple relay emails are accepted. New accounts still go through profile setup.
   - The buttons follow each brand's guidelines and sit above "or use email".
7. **Auctions:**
   - Once live, the seller can only add photos or a dated note; there's no take-down.
   - Any bid at or above the start price wins (no hidden reserve).
   - An auction that ends unsold can be relisted or changed to Buy Now.
   - A missed shipping deadline cancels and refunds as before and records a seller strike that admins can see.
   - Admin removal is audited and bidders are notified.

## Not done / limits
- Wallets don't collect or change the address inside the Apple Pay / Google Pay sheet, and there's no recalculation on `shippingaddresschange`. Shipping and tax are set when the order is created from the confirmed address, and fulfilment relies on that address. Changing it in the sheet would need the order re-priced first.
- Apple Pay in Chrome, Edge and Firefox works only where Stripe supports it (desktop, plus Chrome on iOS 16+). Elsewhere the button doesn't show. Check on real devices.
- SafePurchase post-delivery refunds don't ask the buyer to return the comic. If you want returns first, that's a follow-up.
