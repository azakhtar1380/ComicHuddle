# ComicHuddle Stripe sandbox setup

Prepared 2026-10-09 for Malik LLC, Minnesota, USA-only launch. Public support: maliktecks@gmail.com.

## What is implemented

`lib/stripe-sandbox.ts` is a server-only Stripe REST adapter using Web APIs available in Cloudflare Workers. It has no Stripe SDK dependency and no live-money mode. It creates hosted card Checkout Sessions, US Express connected-account onboarding links, original-payment full/partial refunds and separate seller transfers. It retrieves and validates the saved session, intent, charge, account and refund. It authenticates unmodified webhook bytes using HMAC SHA-256 with a maximum 300-second timestamp window.

Checkout charges the platform without a destination transfer or application fee. Seller money can move only through a separate, server-authorized transfer. Account creation requests manual bank-payout scheduling, and this adapter exposes no bank-payout operation. Stripe transfers and bank payouts are different operations. This is not an escrow service.

The surrounding commerce routes, immutable order snapshots, operation reservations, event deduplication and policy decisions are a separate layer. Carrier delivery verification and a durable deadline scheduler must be connected before claiming automatic shipping refunds or delivery-triggered seller release. A seller-entered tracking number, browser return page or unsigned client event cannot prove shipment, payment, delivery or refund completion.

## Current status

The actual runtime has a canonical public-origin setting and `COMMERCE_SANDBOX_ENABLED=false`. No Stripe test API key or webhook signing secret is configured. **No genuine Stripe sandbox card charge, refund, connected-account verification, transfer or bank payout has been executed.** The private preview remains unable to accept payments.

`node checks/stripe-sandbox.mjs` passed **53 named groups, 0 failed**, with the actual adapter, synthetic HTTP responses and actual WebCrypto signatures. The targeted strict TypeScript check passed. These checks establish local request/binding/signature/error behavior; they are not evidence of processor connectivity, genuine sandbox transactions or live operational readiness.

## Owner setup

1. Open the business's Stripe account and start Connect platform onboarding for Malik LLC. Use Stripe's protected dashboard for business, representative, banking and identity information. Do not put credentials or identity documents in a source file or chat.
2. Create a separate Stripe Sandbox with Connect enabled. Keep all testing in that environment; this adapter rejects `sk_live_` and `rk_live_` keys even when its flags are enabled. Stripe's sandbox behavior does not prove that live connected accounts have completed every required capability or verification.
3. Configure the variables below through the site's protected runtime secret/configuration interface. Do not write a `.env` file into the project or embed secrets in the web/native client.
4. Provide a publicly reachable HTTPS webhook endpoint at `/api/commerce/webhook` whose path bypasses visitor sign-in but requires Stripe signature verification. The current owner-private preview protection may block provider callbacks before they reach the application. Resolve that hosting boundary in a sandbox deployment; never place the preview bypass credential in the callback URL or make private user data public merely to receive webhooks.
5. Register a **snapshot** webhook destination using API version **2026-09-30.endive**, matching this adapter. Include only the event types actually handled by the commerce endpoint, such as Checkout completion/expiry, payment failure, refund updates and disputes. Configure connected-account events separately when the endpoint handles seller-account updates. Copy the endpoint's signing secret into protected runtime configuration.
6. The integrator must review authorization, origin/amount binding, database reservations, event deduplication, pending-operation reconciliation, shipping evidence and tax handling. Then enable the review and sandbox flags in the sandbox environment to run genuine acceptance tests. A `true` review flag permits sandbox testing; it does not certify that those tests have passed. Keep live checkout disabled and record actual Stripe IDs/results separately.

| Runtime setting | Purpose | Initial value or rule |
| --- | --- | --- |
| `COMMERCE_PUBLIC_ORIGIN` | Canonical server-controlled site origin | `https://comichuddle.aztooeasy.chatgpt.site`; HTTPS origin only, without path/query/credentials |
| `COMMERCE_SANDBOX_ENABLED` | Owner control for outbound sandbox API calls | `false` until the sandbox environment is intentionally enabled |
| `COMMERCE_SANDBOX_REVIEWED` | Integration review gate | `false` until the integrator completes the code/configuration review |
| `COMMERCE_STRIPE_TEST_SECRET_KEY` | Stripe Sandbox secret API key | Protected secret beginning `sk_test_`; no live/restricted/publishable key |
| `COMMERCE_STRIPE_TEST_WEBHOOK_SECRET` | Signing secret for this exact test endpoint | Protected secret beginning `whsec_`; CLI and registered-endpoint secrets are distinct |

`sandboxConfiguration` and its alias `sandboxSetup` return only `{enabled, ready, checkoutEnabled, reason, apiVersion}`. They never return credentials. `ready` and `checkoutEnabled` remain false unless every required setting is valid. Webhook signature authentication may run before the integration review, but it cannot itself authorize a money operation or mark a payment paid.

## Genuine sandbox acceptance tests to complete

Use official Stripe test payment methods. Never enter real card data or reuse live API credentials.

| Scenario | Required evidence |
| --- | --- |
| Successful single-comic and collection purchase | One Stripe test Session/PaymentIntent/charge; exact stored USD total; one owned order; no premature seller transfer |
| Declined payment and authentication challenge | Correct retry/authentication outcome; no false paid order or released inventory |
| Abandoned/expired Checkout | No fulfillment; reserved inventory is reconciled safely with the recorded Session expiry |
| Repeated clicks, network timeout and request retry | Same persisted operation key and immutable parameters; no second order/charge |
| Signed completion with incorrect order/amount/intent | Rejected or quarantined; no fulfillment or duplicate event application |
| Duplicate, delayed and out-of-order webhooks | Durable event-ID deduplication; current provider state re-retrieved; no state regression |
| Full refund and partial refund adapter call | Original payment refunded once; pending/failed states remain unconfirmed; exact refund object reconciled |
| Tracking/shipping deadline | Trusted validation and scheduled evaluation; full refund is issued only once and becomes complete only after verified processor confirmation |
| Buyer issue, return or chargeback | Release freezes immediately; separate dispute resolution; no automatic refund/transfer collision |
| Genuine trusted delivery and review window | Locked parcel identity and carrier proof; release only after policy conditions; exact connected seller transfer |
| Seller onboarding/capability failure | Incomplete seller cannot receive money; only the stored profile/user account may be bound |
| Seller bank payout | Separate payout implementation and dashboard verification required; this adapter has none |

Run the complete repository readiness suite after genuine configuration/integration work, then complete rendered-browser, hosted sign-in, mobile-device and payment-provider acceptance tests. Preserve exact test evidence; passing a synthetic adapter suite cannot substitute for these boundaries.

## Integration contract

`stripeSandbox(env, {fetch?, now?, timeoutMs?, origin?})` supports dependency injection for isolated checks. An injected origin must come from trusted server configuration, never a request `Host` or `Origin` header.

- `createCheckout(input, idempotencyKey)` takes one already-owned seller order: `orderId`, positive integer `amountCents`, title and same-origin success/cancel URLs. Optional `itemAmountCents`, `shippingCents` and `taxCents` must sum exactly to the total; they are frozen server prices, not buyer input. The adapter does not determine tax obligations or calculate tax. Each nonzero component is displayed as a Checkout line item. The route locks the buyer-confirmed US shipping address before Checkout; Stripe collects billing information without introducing a second fulfillment address. There are no optional shopper-selected amounts, currency overrides or automatic transfers.
- `retrieveCheckout(sessionId, {orderId, amountCents, paymentIntentId?}, {requirePaid?})` defaults to requiring `complete` and `paid`. `requirePaid:false` supports safe unpaid-session reconciliation; it cannot be treated as payment confirmation.
- `retrievePaymentIntent(intentId, binding, {requireSucceeded?})` defaults to requiring successful collection of the exact total and a charge ID. It rejects automatic destination transfers. `retrieveCharge` additionally proves that charge belongs to the saved intent and was fully captured.
- `createRefund({paymentIntentId, orderId, orderAmountCents, remainingAmountCents, amountCents}, key)` verifies the intent and charge, rejects an open or unknown current charge dispute even if its webhook is delayed, enforces both the local remaining amount and Stripe's refunded amount, then submits the exact refund to the original payment. Persist a refund reservation first. Returned pending/failed/requires-action states are not a completed refund. `retrieveRefund(refundId, {orderId, paymentIntentId, amountCents}, {requireSucceeded?})` reconciles the exact request.
- `createTransfer({orderId, orderAmountCents, amountCents, destination, sourceTransaction, paymentIntentId}, key)` re-verifies the bound paid charge and seller capability, blocks any charge refund/dispute, and creates a separate transfer. The caller calculates the seller amount after platform fees and makes the shipping/review policy decision. A post-transfer refund needs recovery/reversal handling outside this adapter.
- `createSellerAccount({profileId,userId,email}, key)` uses US controller-based Express onboarding with `profile_id`/`user_id` metadata. `retrieveAccount(accountId, binding?)` can re-validate ownership. `createAccountLink(accountId, {refreshUrl,returnUrl}, key?)` returns only an unexpired `https://connect.stripe.com` URL. A fresh link request uses a fresh random key; monetary retries retain their recorded key.
- `verifyStripeWebhook(rawBody, signature, env, {now?,toleranceSeconds?})` verifies original bytes before JSON parsing, accepts rotating `v1` signatures, rejects live events and bounds payload/header sizes. It returns an authenticated event. The database must deduplicate its event ID, authorize its order binding and retrieve current processor facts before fulfillment.

Canonical payment metadata is `order_id`. A matching `orderId` is emitted for compatibility, and a conflicting value is rejected. Provider errors do not expose upstream response bodies, keys, customer messages or payment-intent client secrets. Timeouts/network failures are explicitly uncertain: preserve the pending operation and reconcile with the same idempotency key, rather than creating a new key. Stripe can prune idempotency keys after at least 24 hours, so the durable operation ledger must prevent old operation replay even after that provider window.

## Official references checked 2026-10-09

- [Stripe Connect testing and Sandboxes](https://docs.stripe.com/connect/testing)
- [Current API version and explicit version headers](https://docs.stripe.com/api/versioning)
- [Create hosted Checkout Session](https://docs.stripe.com/api/checkout/sessions/create)
- [PaymentIntent fields and captured amounts](https://docs.stripe.com/api/payment_intents/object)
- [Charge fields and refund/dispute status](https://docs.stripe.com/api/charges/object)
- [Original-payment full/partial refunds](https://docs.stripe.com/api/refunds/create)
- [Separate seller transfers and source transactions](https://docs.stripe.com/api/transfers/create)
- [US controller-based connected accounts](https://docs.stripe.com/api/accounts/create)
- [Single-use Connect onboarding links](https://docs.stripe.com/api/account_links/create)
- [Unmodified webhook bytes, signature checks and delivery retries](https://docs.stripe.com/webhooks)
- [Idempotency and provider key retention](https://docs.stripe.com/api/idempotent_requests)
- [Manual bank payouts, applicable timing and no escrow service](https://docs.stripe.com/connect/manual-payouts)
