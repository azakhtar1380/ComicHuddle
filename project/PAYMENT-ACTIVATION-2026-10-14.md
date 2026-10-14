# ComicHuddle payment activation

The deployed UI uses Stripe-hosted Checkout for card entry and eligible device wallets, including Apple Pay. No card number or CVC is accepted by ComicHuddle's own endpoints. The current implementation is **test-mode only**; a live Stripe key is intentionally rejected.

## Current verified state

- AWS RDS, collector accounts, collection saves, listing creation, sold status and private wallet queries work.
- Vercel has the RDS environment settings. It has no configured Stripe credentials.
- `/api/commerce?kind=setup` reports `checkoutEnabled: false`.
- Checkout stays readable, lets a buyer retry the availability check or contact the seller, and cannot create a false paid order.
- Accepted trade terms offer a full-price purchase alternative. They do not implement cash-plus-comic trade settlement or verify two-sided shipping.
- Wallet proceeds and refund activity require confirmed provider receipts. Manual sold reports do not mint funds.

## Connect a real test processor

The operator must create/connect the business Stripe platform account and enable the Connect seller onboarding product. Add these values securely in the Vercel project's production environment, because this public preview runs from that environment:

| Variable | Value |
|---|---|
| `COMMERCE_PUBLIC_ORIGIN` | `https://comichuddle-abdul-aziz-akhtars-projects.vercel.app` |
| `COMMERCE_STRIPE_TEST_SECRET_KEY` | The platform's Stripe **test** secret; store as a Vercel Secret |
| `COMMERCE_STRIPE_TEST_WEBHOOK_SECRET` | The signing secret for this deployment's test webhook; store as a Vercel Secret |
| `COMMERCE_SANDBOX_ENABLED` | `true` |
| `COMMERCE_SANDBOX_REVIEWED` | `true` after reviewing the test configuration and integration |

Configure the Stripe test event destination to `https://comichuddle-abdul-aziz-akhtars-projects.vercel.app/api/commerce/webhook`. The adapter requests API version `2026-09-30.endive`; use a compatible event version. The app authenticates raw event bytes before using a receipt. Rebuild after changing Vercel environment values. Do not put secrets into the repository, screenshots or chat.

Use **Orders → Set up sandbox seller payments** for a separate QA seller. Complete Stripe's US test onboarding before checking out as a QA buyer. Complete one single-book order and one collection order with Stripe's documented test payment methods. Verify webhook confirmation, retry idempotency, private delivery details, tracking submission and eligible refunds. Then inspect the separate Test balances view of the wallet. A browser redirect is not proof of payment.

## Live checkout remains a separate launch requirement

A working test processor does not activate live marketplace payments. Carrier-confirmed delivery, inspection/review holds, payout reconciliation, tax configuration and a reviewed production payment adapter are still required. Automatic payouts and spendable wallet balances are not currently enabled. Do not describe this preview as live escrow or guaranteed buyer protection.

## Data requirements

The directory has 6,826 records and 2,094 cover references; that is not 2,094 working images. Six local vintage reference covers are verified to load. External GCD artwork requests were blocked by their host, and the app does not bypass that protection. Working modern cover coverage needs an authorized, accessible artwork source.

The current valuation endpoint has zero quotes. Raw/CGC selectors now query the stored, licensed grade/printing-specific values and expire stale quotes. Connect a permitted valuation feed or use the existing owner import in Data Studio. Missing values stay unavailable; no synthetic price is displayed as current FMV.

Official processor references:
- https://docs.stripe.com/payments/checkout/payment-methods
- https://docs.stripe.com/apple-pay
- https://docs.stripe.com/connect/separate-charges-and-transfers
- https://docs.stripe.com/testing

## Embedded payments and closed-loop rewards update

Set `COMMERCE_STRIPE_TEST_PUBLISHABLE_KEY` with the test publishable key to activate the embedded Payment Element alongside the existing test secret, signed webhook secret, reviewed/enabled flags, and public origin. The browser receives only the publishable key and its own order-bound session client secret. Register the actual HTTPS domain in Stripe for wallet payment methods. Apple Pay / Google Pay availability is device and Stripe-account dependent.

`payment_intent.succeeded` and Checkout completion re-retrieve the exact saved session, intent and captured charge before updating an order. The same transaction reconciles on-site reward points and credit reservations. Refund confirmation restores applied credit and reverses earned points. 100 points convert to $1 non-cashable credit; points accrue at one per whole dollar of net item price, excluding shipping/tax. Sandbox balances cannot cross into live balances.

Seller proceeds remain separate. An order paid partly with promotional credit cannot release a seller transfer until the platform-funded credit subsidy is reconciled. This preview still blocks all seller releases without trusted delivery integration. Shipping-only test checkout requires at least $0.50 of processor payment; cashless credit-only orders and workshop payment checkout are not enabled. Existing auction bids remain nonbinding previews and do not create Stripe orders.
