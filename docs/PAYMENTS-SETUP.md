# ComicHuddle payments setup (Stripe)

This guide is for the owner. It takes you from "payments not set up" to a working
**test** checkout, then to **live** payments. Do every step in Stripe **test mode**
first. Stripe test and live mode have separate keys, webhooks and Connect settings.

> Never paste keys into chat, email, source code or screenshots. They go only into
> Vercel environment variables.

## What the app does (so the Stripe choices make sense)

- Buyers pay ComicHuddle (the platform) through **Stripe Checkout**. This uses
  separate charges and transfers: money lands in ComicHuddle's Stripe balance first.
- Sellers onboard through Stripe-hosted **Connect onboarding**. New sellers are
  **Accounts v2** accounts with the **recipient** configuration (they receive transfers
  and do not take payments themselves) and the **Express dashboard**. ComicHuddle pays
  the Stripe fees and is responsible for losses (refunds and chargebacks).
  - Stripe no longer lets new Connect platforms create accounts with `POST /v1/accounts`.
  - Sellers who were connected before this change keep their existing (v1) account and
    still work.
- Sales tax is $0. ComicHuddle pays Stripe's processing fees and funds any store
  credit a buyer applies.

## How money moves (your marketplace fee)

ComicHuddle earns a **marketplace fee on every sale**:

- **Default: 8% of the item price.** Shipping and tax are never charged the fee.
- **Minimum $0.50** per sale, and there is an optional maximum. The fee is never more
  than the item price.
- **Buyers never see the fee.** They pay the listed price plus shipping (plus the
  SafePurchase fee, if they chose it).
- **Sellers see the fee.** "Sale price / ComicHuddle fee / You earn" is shown before
  publishing a listing and on every sale.

Example, a $100 comic with free shipping:

| Step | Amount |
|---|---|
| Buyer is charged (on ComicHuddle's Stripe account) | $100.00 |
| Transferred to the seller's connected account | $92.00 |
| Stays with ComicHuddle (your fee) | $8.00 |
| Stripe processing fee, paid by ComicHuddle (about 2.9% + 30¢) | about −$3.20 |
| **Your net on this sale** | **about $4.80** |

How the app handles it:

- **The rate is locked in when an order is placed.** The fee rate, fee amount and
  seller's net are saved with the order. Changing the rate later never changes existing
  orders.
- **You keep the fee automatically.** Stripe charges the buyer the full amount, and the
  app transfers only the seller's net. No separate Stripe "application fee" object is
  involved.
- **Every fee is recorded in the app's ledger.**
  - `application_fee_recorded` is written when a payment is confirmed.
  - `application_fee_refunded` is written when a full refund is confirmed.
- **The SafePurchase fee (`SAFEPURCHASE_FEE_CENTS`)** is separate. It is also kept
  entirely by ComicHuddle.
- **Store credit or points** reduce what the buyer pays, but the seller still earns their
  full net; ComicHuddle covers the difference.
  - The transfer linked to the buyer's charge can never be more than that charge.
  - When credit makes the charge smaller than the seller's net, the rest is sent as a
    second "top-up" transfer from ComicHuddle's Stripe balance.
  - That top-up needs available (settled) funds in your Stripe balance.
- **Refunds:**
  - Before the seller is paid: the buyer gets the whole charge back. ComicHuddle earned
    no fee, and Stripe does not return its processing fee.
  - After the seller is paid (owner-approved only): the app first reverses the seller's
    transfers, then refunds the buyer in full. The fee is returned too.
  - Partial refunds: a shared helper (`proratedFeeRefundCents`) gives back a matching
    share of the fee. The app's partial-refund cases (SafePurchase "accept partial") are
    still settled by support.
- **Disputes and chargebacks:** ComicHuddle is the losses collector, so a lost dispute
  is debited from your Stripe balance, including Stripe's $15 dispute fee.
  - Recovering money from the seller is a manual support decision, for example a
    transfer reversal.
  - Disputed orders are held, and they cannot be released or reversed by the app.
- **Owner revenue summary:** in your owner Orders area, or `GET /api/commerce?kind=revenue`.
  - It shows paid orders, total sales, fees earned, SafePurchase fees, refunds, store
    credit you funded, estimated Stripe fees, and your net.
  - Stripe fees there are estimates. Exact fees are on each payment's balance
    transaction in the Stripe Dashboard.
- **Seller payouts (releases) stay off unless you set `COMMERCE_PAYOUTS_ENABLED=true`.**
  - Even then, only the owner can release, and only for orders whose
    delivery/pickup and review window are complete.
  - The release action is `owner_release`.

Fee settings (Vercel environment variables):

| Variable | Default | Meaning |
|---|---|---|
| `COMMERCE_PLATFORM_FEE_BPS` | `800` | Fee in basis points of the item price (800 = 8.00%). Allowed 0–3000. An invalid value stops new checkouts rather than guessing |
| `COMMERCE_PLATFORM_FEE_MIN_CENTS` | `50` | Minimum fee per sale when the rate is above 0 |
| `COMMERCE_PLATFORM_FEE_MAX_CENTS` | none | Optional cap per sale |
| `COMMERCE_PAYOUTS_ENABLED` | off | Set `true` only when you are ready to release seller payouts |

## 1. Activate the Stripe account

1. Sign in at dashboard.stripe.com with the platform account.
2. Click **Activate payments**, or go to **Settings → Business → Account details**.
   Fill in:
   - business type and legal name (Malik LLC)
   - EIN and address
   - the representative's details
   - website (the canonical origin)
   - product description: an online marketplace for collectible comics
   - statement descriptor and support email/phone
3. Add the payout bank account under **Settings → Business → Bank accounts and currencies**.
4. Wait until the account shows **Charges enabled** and **Payouts enabled**. This is
   required for live mode only; test mode works before activation.

## 2. Set up Connect (marketplace platform)

Do this in test mode first, then check it again in live mode.

1. Open **Connect** in the left navigation (or search "Connect") and click **Get started**.
2. When asked how you will use Connect, choose **Marketplace**: you collect payments
   from buyers and pay out to sellers.
3. Complete the **Platform profile** (Settings → Connect → Platform profile). Answer:
   - **Who onboards connected accounts / which dashboard:** Stripe-hosted onboarding
     with the **Express dashboard**.
   - **Who pays Stripe fees:** the platform (ComicHuddle).
   - **Who is liable for negative balances and losses:** the platform (ComicHuddle).
   - Seller location: United States. Business type: individuals and companies.
4. **Settings → Connect → Branding:** set the business name, icon and brand colour.
   Hosted onboarding links fail until branding is complete.
5. **Settings → Connect → Onboarding options:** leave Stripe-hosted onboarding on.
   Under capabilities, make sure **Transfers** can be requested.

**What the app creates for each seller (Accounts v2).** For reference; you do not need
to do anything here.

- Request: `POST /v2/core/accounts` (API version `2026-10-28.endive`) with:
  - `dashboard: express`
  - `identity.country: us`
  - `contact_email` (the seller's sign-in email)
  - `defaults.responsibilities.fees_collector = application`
  - `defaults.responsibilities.losses_collector = application`
  - `configuration.recipient.capabilities.stripe_balance.stripe_transfers.requested = true`
- Stripe adds the payouts capability automatically.
- **When a seller counts as ready:** the transfers capability
  (`configuration.recipient…stripe_transfers.status`) is `active`, the account is not
  closed, and no requirement is `currently_due` or `past_due`. The app re-checks this
  with Stripe at every checkout.
- **Onboarding link:** the app calls `POST /v2/core/account_links` (onboarding).
  - On a standard (non-Sandbox) test-mode platform, Stripe refuses v2 links for
    recipient accounts. The app then uses `POST /v1/account_links` with the same account
    ID, which Stripe supports.
  - In live mode, and in a Stripe **Sandbox**, the v2 link is used.

**If account creation fails,** the error code tells you what is missing:

- `connect_profile_not_submitted`: finish the Platform profile (step 3).
- `account_creation_liability_unacknowledged`: accept loss liability in the Platform
  profile.
- `account_creation_identity_verification_incomplete`: finish verifying your own
  business (section 1).
- `accounts_v2_access_blocked`: contact Stripe support to enable Accounts v2.
- A restricted key also needs **write** access to Accounts v2 and Account Links.

## 3. Payment methods and wallet domains

1. **Settings → Payments → Payment methods:** turn on **Cards**, **Apple Pay** and
   **Google Pay**. Link is optional.
   - The app does not fix a list of payment methods. Stripe shows whatever is enabled
     here and eligible for the buyer (in test mode currently cards, Link, Klarna,
     Affirm, Cash App Pay and Amazon Pay).
   - Delayed methods are handled: a failed delayed payment cancels the order and puts
     the listing back on sale.
   - Every method collects the billing address the session requires.
   - To narrow the list, turn methods off here. No code change is needed.
2. For launch, leave delayed bank methods (ACH and similar) **off**. The app handles
   them correctly: a failed delayed payment releases the listing. But the listing stays
   reserved for days while the payment settles.
3. **Settings → Payments → Payment method domains:** add the canonical domain
   (`comichuddle-abdul-aziz-akhtars-projects.vercel.app`, or your custom domain) in
   both test and live mode.

## 4. API keys

**Developers → API keys** (test mode):

- Copy the **Secret key** (`sk_test_…`) and the **Publishable key** (`pk_test_…`).
- Optional: a restricted key (`rk_test_…`) also works. Give it:
  - **write** access to Checkout Sessions, Refunds, Accounts (Connect) and Account Links
  - **read** access to PaymentIntents, Charges and Disputes

  If seller onboarding returns a permissions error, use the standard secret key
  instead.

## 5. Webhooks

Both endpoints use the same URL:

`https://comichuddle-abdul-aziz-akhtars-projects.vercel.app/api/commerce/webhook`

(If you change the domain, use `COMMERCE_PUBLIC_ORIGIN` + `/api/commerce/webhook`.)

**A. Platform events.** Go to **Developers → Webhooks → Add endpoint** and choose
events on **Your account**.

- **API version:** `2026-09-30.endive`. It must match the code.
- **Events:**
  - `checkout.session.completed`
  - `checkout.session.async_payment_succeeded`
  - `checkout.session.async_payment_failed`
  - `checkout.session.expired`
  - `payment_intent.succeeded`
  - `refund.created`
  - `refund.updated`
  - `refund.failed`
  - `charge.refunded`
  - `charge.dispute.created`
  - `charge.dispute.updated`
  - `charge.dispute.closed`
- Save, open the endpoint, click **Reveal signing secret** and copy it (`whsec_…`).
  This goes in `COMMERCE_STRIPE_TEST_WEBHOOK_SECRET`.

**B. Seller account events (recommended).** These keep each seller's "ready to sell"
status current when Stripe finishes verifying them. Without them, the status shown in
Orders only updates when the seller clicks onboarding again. Checkout always re-checks
with Stripe either way, so a seller who is not ready can never be paid.

- **For Accounts v2 sellers (all new sellers):** go to **Workbench → Webhooks → Create
  an event destination**.
  - Choose **Thin** events and the same URL as above.
  - Select these events:
    - `v2.core.account.updated`
    - `v2.core.account.closed`
    - `v2.core.account[configuration.recipient].capability_status_updated`
    - `v2.core.account[configuration.recipient].updated`
    - `v2.core.account[requirements].updated`
    - `v2.core.account[identity].updated`
  - Copy its signing secret into `COMMERCE_STRIPE_TEST_THIN_WEBHOOK_SECRET`
    (`COMMERCE_STRIPE_LIVE_THIN_WEBHOOK_SECRET` in live mode).
  - Thin events contain only the account ID. The app always fetches the account's
    current state from Stripe before updating anything.
- **For sellers connected before the v2 change:** add an endpoint for **Connected
  accounts** events with `account.updated`, and put its signing secret into
  `COMMERCE_STRIPE_TEST_CONNECT_WEBHOOK_SECRET`.

The endpoint returns 503 until the app is enabled. Stripe retries automatically.

## 6. Database migration 024 (required before live)

`db/postgres-migrations/024_commerce_live_mode.sql` allows live orders. It replaces
the old "sandbox only" check with `sandbox IN (0,1)`. It is applied automatically
on the next production build by `scripts/migrate-additive.ts` (runs whenever
`MIGRATE_ENRICHMENT_ON_BUILD=true`, which production already sets). The runner
records a checksum and applies each 024+ migration exactly once. Confirm the build
log shows `Applied additive migration 024_commerce_live_mode.sql.` before going live.

Test mode does not need it. Live checkout fails with a database constraint error
until it is applied.

## 7. Vercel environment variables

Go to **Vercel → Project → Settings → Environment Variables** and use the
**Production** scope. Redeploy after every change.

| Variable | Test value | Live value |
|---|---|---|
| `COMMERCE_SANDBOX_ENABLED` | `true` (master switch; legacy name) | `true` |
| `COMMERCE_SANDBOX_REVIEWED` | `true` (integration reviewed) | `true` |
| `COMMERCE_PUBLIC_ORIGIN` | `https://comichuddle-abdul-aziz-akhtars-projects.vercel.app`. HTTPS origin only: no path, no trailing text | same |
| `COMMERCE_STRIPE_MODE` | unset or `test` | `live` |
| `COMMERCE_STRIPE_TEST_SECRET_KEY` | `sk_test_…` / `rk_test_…` | (kept, unused) |
| `COMMERCE_STRIPE_TEST_PUBLISHABLE_KEY` | `pk_test_…` (enables the embedded form) | (kept, unused) |
| `COMMERCE_STRIPE_TEST_WEBHOOK_SECRET` | platform endpoint `whsec_…` | (kept, unused) |
| `COMMERCE_STRIPE_TEST_CONNECT_WEBHOOK_SECRET` | Connect endpoint `whsec_…` (optional, legacy v1 sellers) | — |
| `COMMERCE_STRIPE_TEST_THIN_WEBHOOK_SECRET` | v2 thin-event destination `whsec_…` (optional) | — |
| `COMMERCE_STRIPE_LIVE_THIN_WEBHOOK_SECRET` | — | live v2 thin-event destination `whsec_…` (optional) |
| `COMMERCE_STRIPE_LIVE_SECRET_KEY` | — | `sk_live_…` / `rk_live_…` |
| `COMMERCE_STRIPE_LIVE_PUBLISHABLE_KEY` | — | `pk_live_…` |
| `COMMERCE_STRIPE_LIVE_WEBHOOK_SECRET` | — | live platform endpoint `whsec_…` |
| `COMMERCE_STRIPE_LIVE_CONNECT_WEBHOOK_SECRET` | — | live Connect endpoint `whsec_…` (optional) |
| `COMMERCE_LIVE_REVIEWED` | — | `true`, only after section 9's checks pass |
| `COMMERCE_NEW_CHECKOUT_PAUSED` | `true` until testing, then `false` | `true` at cutover, then `false` |

Safety rules built into the code:

- A test deployment rejects live keys, and a live deployment rejects test keys.
- An unknown `COMMERCE_STRIPE_MODE` value disables payments.
- Live mode also needs `COMMERCE_LIVE_REVIEWED=true`.
- Webhook events from the other mode are rejected.
- Test orders (`sandbox=1`) and live orders (`sandbox=0`) are never acted on by the
  other mode.

Check the status at `https://<origin>/api/commerce?kind=setup`:

- `setup.reason` should be `sandbox_ready` (test) or `live_ready` (live), or
  `new_checkout_paused` while paused.
- `setup.checkoutEnabled` becomes `true` once unpaused.

## 8. Test-mode end-to-end run

1. Set the test variables, keep `COMMERCE_NEW_CHECKOUT_PAUSED=true`, redeploy, and
   check `?kind=setup`.
2. Set `COMMERCE_NEW_CHECKOUT_PAUSED=false`, redeploy.
3. **Seller:** sign in as a QA seller and start payment onboarding from Orders.
   Complete Stripe's test onboarding with Stripe's test values: test phone
   number/code, SSN `000-00-0000`, routing `110000000`, account `000123456789`.
4. **Buyer:** sign in as a different QA account and buy a fixed-price listing with
   card `4242 4242 4242 4242`, any future date and any CVC.
5. In **Developers → Webhooks → (endpoint) → Events**, every delivery should show
   **200**. The order should show as paid in Orders.
6. **Refund:** have the buyer request a refund, then approve it as the owner.
   - The order becomes **Refunded**.
   - `refund.*` and `charge.refunded` deliveries return 200.
   - The order is not flagged for manual review.
7. **Dispute:** buy with `4000 0000 0000 0259`, then in the Dashboard submit winning
   evidence. After `charge.dispute.closed` the order shows the dispute as won.
8. **Abandoned checkout:** start checkout and close the tab. About an hour later the
   session expires, the order shows expired and the listing is back on the
   marketplace.
9. Optional: run `node checks/stripe-sandbox.mjs` and
   `node --import tsx --test checks/commerce-webhook-flows.test.ts`. These use
   synthetic Stripe responses only.

## 9. Live cutover

1. In the Stripe Dashboard, switch to **live mode**. Repeat for live:
   - sections 2 (check the Connect branding), 3 (payment methods and domain) and 4
     (live keys)
   - section 5: two **new** live endpoints with the same URL and event lists. Live
     signing secrets are different.
2. Make sure migration 024 is applied (section 6).
3. In Vercel, set:
   - `COMMERCE_NEW_CHECKOUT_PAUSED=true`
   - `COMMERCE_STRIPE_MODE=live`
   - the `COMMERCE_STRIPE_LIVE_*` values
   - `COMMERCE_LIVE_REVIEWED=true`

   Redeploy. `?kind=setup` should show `mode: "live"` and
   `reason: "new_checkout_paused"`.
4. **Sellers must onboard again in live mode.** Test-mode Stripe accounts do not
   exist in live mode. The app unbinds the test account automatically the first time
   a seller onboards in live.
5. Set `COMMERCE_NEW_CHECKOUT_PAUSED=false` and redeploy. Do one real low-value
   purchase between two internal accounts using your own card. Confirm the webhook
   delivered 200 and the order is paid, then refund it from the owner flow.
6. Keep watching **Developers → Webhooks** for failed deliveries during the first days.

## 10. Pausing and rollback

- To stop new sales, set `COMMERCE_NEW_CHECKOUT_PAUSED=true` and redeploy.
  Webhooks, refunds and existing orders keep working.
- **Do not switch `COMMERCE_STRIPE_MODE` back to `test` while live orders are open.**
  Live webhooks would then be rejected (Stripe retries for about three days), and
  live refunds could not be processed. Pause checkout instead.

## Not yet covered by the app

- Paying sellers: transfers/release are disabled. Funds stay in the platform balance.
- Sales tax collection and a platform fee.
- Automatic cleanup when Stripe never created a Checkout Session for an order (rare
  network failure). Support must release that reservation.

## How money moves

All amounts and windows are server configuration and are **snapshotted onto each order at checkout** (`snapshot.protection`, `state.policy`); later config changes never alter existing orders. Seller payouts stay disabled (`payoutsEnabled=false`): the app computes and shows **"Funds available on <date>"** but never creates a transfer.

| Order | Payment held until | Release window | Notes |
|---|---|---|---|
| **Standard, shipped** | Carrier reports *Delivered* (EasyPost webhook) | `COMMERCE_RELEASE_HOLD_HOURS` (72h) | Seller adds tracking within `COMMERCE_HANDLING_DAYS` (3) business days, or the buyer can cancel for a full refund. Without `EASYPOST_API_KEY` tracking stays "awaiting carrier confirmation" and nothing releases. |
| **Standard, local pickup** | Buyer taps "I picked it up" **or** seller enters the buyer's 6-digit pickup code | 72h | No shipping charge or address. The code is derived from `COMMERCE_PICKUP_CODE_SECRET` (falls back to `BETTER_AUTH_SECRET`); only its SHA-256 hash is stored, comparison is constant-time, and wrong guesses are rate-limited per order. |
| **Over `SAFEPURCHASE_THRESHOLD_CENTS` ($500), inspection not configured** | Signed carrier delivery | 72h | Standard Protection plus insured, signature-required shipping. Customer copy says "SafePurchase inspection coming soon". |
| **SafePurchase** (automatic ≥ threshold when `SAFEPURCHASE_ENABLED=true` and `SAFEPURCHASE_INSPECTION_ADDRESS` is set; seller/buyer opt-in below it) | Seller → Inspection Center (tracking within 48h) → operator receive → pass → outbound insured, signature-required → signed delivery | `SAFEPURCHASE_RELEASE_HOLD_HOURS` (48h) | Fail = automatic full refund. Partial collection fail = buyer chooses pro-rated (support settles the partial amount) or full refund. Over-threshold pickup is an Inspection Center hand-off, or an explicit buyer waiver to Standard pickup. `SAFEPURCHASE_FEE_CENTS` (default 0) is shown before payment. |

- **Claims** (`COMMERCE_CLAIM_DAYS`, 30): "Not received" or "Not as described" (photos required) freeze release. "Not received" is denied after signed SafePurchase delivery or a confirmed pickup.
- **Auctions** are binding eBay-style proxy auctions (migration `026_binding_auctions.sql`): 1/3/5/7/10-day fixed end, optional hidden reserve, price-band increments, masked bid history, no retraction. When an auction ends (resolved lazily on read), the winner gets 48 hours to **Pay now** at the winning price through the same checkout and protection rules; after that the seller can mark it unpaid and relist.
- **Store credit** from Collector Reward Points reduces the item subtotal at checkout; a refund restores the credit and reverses that order's points.
- **Carrier webhook:** `POST /api/commerce/carrier-webhook`, verified with `EASYPOST_WEBHOOK_SECRET` (`X-Hmac-Signature: hmac-sha256-hex=…`). Trackers are created on tracking submission when `EASYPOST_API_KEY` is set.

### EasyPost carrier tracking

- **Keys.** `EASYPOST_API_KEY` is a TEST key (`EZTK…`) in development/QA and a PRODUCTION key (`EZAK…`) in production; both are in the EasyPost dashboard under *Account Settings → API Keys*. Test keys only accept EasyPost's test tracking codes (`EZ1000000001` pre-transit, `EZ2000000002` in transit, `EZ3000000003` out for delivery, `EZ4000000004` delivered, `EZ5000000005` return to sender, `EZ6000000006` failure, `EZ7000000007` unknown). Never log or commit either key.
- **Webhook (primary path).** In the EasyPost dashboard, *Webhooks → Add webhook* for each environment: URL `https://<your-domain>/api/commerce/carrier-webhook`, with a **webhook secret** you choose there. Put the same value in `EASYPOST_WEBHOOK_SECRET`. The route verifies `X-Hmac-Signature` (`hmac-sha256-hex=…`, HMAC-SHA256 of the raw body) and ignores anything unsigned. Use the test-mode webhook with the test key and the production webhook with the production key.
- **Polling backup.** Webhooks can't reach `localhost` and can be missed, so the server also reads each tracker from EasyPost's API (`GET /v2/trackers/{id}`): once right after tracking is added; when the buyer or seller opens Orders (at most once per order every 10 minutes, up to 5 orders per visit); and from the daily `/api/cron/enrichment` run (up to 25 shipments). Delivery is only ever taken from EasyPost's own response, never from anything the browser sends.
- **Statuses.** `pre_transit` Label created · `in_transit` In transit · `out_for_delivery` Out for delivery · `available_for_pickup` Ready for pickup at the carrier · `delivered` Delivered (starts the protection window) · `return_to_sender` / `failure` / `error` / `cancelled` → flagged for support, release frozen (`manual_review`) · anything else: Status unavailable. Order cards show the latest status, last scan location/date and estimated delivery.
- **Local check.** With paid test orders on the local server: `node checks/easypost-e2e-local.mjs <sellerEmail> <buyerEmail> <order1> <order2> <order3>` adds `EZ2000000002`, `EZ4000000004` and `EZ6000000006` and verifies each result.
