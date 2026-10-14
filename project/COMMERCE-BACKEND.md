# ComicHuddle sandbox commerce foundation

This release adds actual server routes, durable order reservations and a test-only Stripe REST/signature adapter. No Stripe account, test secret or webhook secret has been connected. Runtime checkout is disabled. Synthetic transport tests prove local code behavior; they are not genuine Stripe sandbox transactions, bank payouts, a courier integration or public launch approval.

The operator remains Malik LLC, Minnesota, USA; support is maliktecks@gmail.com. Checkout accepts the 50 US states and DC. This draft does not claim escrow, government deposit insurance, guaranteed grading results or protection from every scam.

## Exact runtime gates

All processor calls and webhook domain writes require `COMMERCE_SANDBOX_ENABLED=true`, `COMMERCE_SANDBOX_REVIEWED=true`, a valid `COMMERCE_STRIPE_TEST_SECRET_KEY` beginning `sk_test_`, a valid test `COMMERCE_STRIPE_TEST_WEBHOOK_SECRET` beginning `whsec_`, and a canonical HTTPS `COMMERCE_PUBLIC_ORIGIN`. Live keys and live-mode objects/events are rejected. Configuration GET returns only readiness booleans and a safe reason enum. Credentials never enter a database row, response, browser bundle, stored provider payload or ZIP.

An owner-private deployment normally prevents an ordinary Stripe server callback from reaching `/api/commerce/webhook`. A supported public webhook ingress, or a separate secure backend, must be established before enabling real test checkout. Never place a preview bypass credential in a webhook URL.

## Money and customer protection

1. A fixed-price single comic or collection is read from the server. The server freezes item price, shipping, copy identities, condition/photo evidence and the buyer-confirmed US address. The browser cannot supply a paid flag, payment amount, seller account or destination. Tax and platform fees are explicitly zero only for sandbox testing; this is not production tax or commission handling.
2. An atomic D1 batch checks both current eligible profiles, consent, restrictions, two-way blocks, seller vault ownership/revision, listing status, copy reservations and seller-owned photos. It creates one durable order and reserves the listing. Open-order uniqueness prevents concurrent buyers from creating independent payable orders for the same listing.
3. Stripe checkout uses one persisted order-specific idempotency key. A network timeout preserves the local reservation. A retry uses the same snapshot and key. Unknown processor object creation stops after 23 hours, ahead of Stripe's documented minimum 24-hour key retention, and requires manual reconciliation. A known provider object may be retrieved without creating a replacement.
4. A redirect never marks an order paid. Only an authenticated raw-body webhook followed by server retrieval of the exact session, intent and charge can bind a sandbox payment. The amount, USD currency, metadata, session, intent, charge and separate-charge flow must match the immutable order. A unique durable event receipt with a SHA-256 payload fingerprint and order-version CAS is written in the same batch as paid state and listing changes.
5. If eligibility changes after a checkout URL was issued, genuinely received, matched funds are still recorded. The order enters a support hold. Hiding a seller or listing is not evidence that no charge happened.
6. Seller-entered tracking is immediately visible to the buyer but is labeled unverified. It does not establish carrier acceptance, delivery or payout eligibility. With no carrier adapter installed, a supplied number enters manual verification, and sweeps do not assume a missing scan during an outage means nothing shipped.
7. No tracking submission after 48 hours from the authenticated successful completion event can become refund-eligible. Completion time must be valid integer provider seconds within the immutable order creation time and the server clock. Delayed webhook delivery does not restart or extend shipping deadlines, and later payment receipts cannot reset `paidAt`. Unknown completion timing retains exact received-funds proof under a processor timing hold, hides unverified deadlines and prevents automatic financial action. A trusted carrier implementation is still needed for the 72-hour acceptance rule, exceptions, delivery, signatures, loss claims and the delivery review window. A periodic scheduler is not installed; the owner sweep is manual and bounded to 25 orders per request.
8. A buyer refund request freezes seller release. Support can approve an appropriate full refund. Current charge disputes/unknown funds state block new refund POSTs. Carrier or checkout-eligibility holds can be cleared only for an approved buyer refund; processor uncertainty cannot be erased by approving an issue.
9. Refund money operations are reserved durably before the processor call. The order CAS and ledger guard prevent a competing refund/transfer reservation. The ledger amount, request, kind and immutable order must match the exact full refund before contacting the processor and again in the final atomic guard. The exact original financial request is retried; pending, failed and unknown responses remain unresolved until verified. An owner-only reconcile action reads the persisted request key and retrieves the existing refund, so reloading the UI does not require inventing a new UUID or operation.
10. Refund confirmation is a guarded batch tying the order, exact refund ledger and durable receipt. Inventory is released automatically only when there is neither confirmed carrier acceptance nor an unverified seller tracking submission. Shipped or uncertain-custody refunds require manual return handling before relisting.

There is no connected HTTP delivery proof, seller transfer or bank-payout endpoint. `/api/commerce` rejects owner `release` with `503 carrier_setup_required`. Even an apparently eligible pure-policy state cannot bypass this infrastructure gate. Production carrier validation, return authorization/custody evidence, scheduled evaluation, genuine processor tests, marketplace taxes, seller payout policy, chargebacks/reserves and legal/payment-provider review remain launch requirements.

## API contracts

Every authenticated response uses `Cache-Control: private, no-store`. Existing ChatGPT account identity is retained. Browser writes require an exact same-origin Origin header, bounded JSON and persisted account/action write limits.

| Route or action | Behavior |
|---|---|
| `GET /api/commerce?kind=setup` | Safe public readiness, sandbox-only flag and absent carrier/payout flags; no identities or credentials. |
| `GET /api/commerce` | Most recent 100 buyer/seller-owned summaries and `hasMoreOrders`; foreign orders are excluded. |
| `GET /api/commerce?order=<id>` | Owned detail, or limited operator summary. Paid buyer/seller participants can see the frozen fulfillment address and photo/copy evidence. An operator who is not a participant receives no address. Events are bounded with `hasMoreEvents`. |
| `POST checkout` | Strict `listingId`, buyer UUID `requestId`, `sandboxAcknowledged:true` and a validated `shippingAddress`. Fixed-price orders only; auctions/offers remain nonbinding. Current seller eligibility is checked again on every payable checkout retry. |
| `POST seller_onboard` | `sandboxAcknowledged:true`; creates/retrieves only a server-bound US test seller account. Arbitrary external account IDs are never accepted. An onboarding return URL cannot verify the seller. |
| `POST submit_tracking` | Seller-owned paid order; supported carrier and bounded number; stores an unverified submission only. |
| `POST request_refund` | Buyer-owned paid order, UUID and reason up to 200 characters; records the issue and freezes release. Does not itself issue money. |
| `POST owner_refund` | Operator only, order ID and original UUID. Full refund needs policy eligibility or an approved buyer claim. |
| `POST owner_reconcile` | Operator only and order ID. Reads the existing ledger's key/provider ID server-side. It does not create a new reservation. |
| `POST owner_sweep` | Operator only and sandbox acknowledgment; evaluates shipping deadlines and reconciles existing refunds. Does not schedule future work. |
| `POST /api/commerce/webhook` | Raw bounded body, HMAC signature within 300 seconds, reviewed sandbox gates, live-mode rejection, exact provider-object retrieval and durable deduplication. No visitor identity required; no generic trusted-state JSON accepted. |

`commerceAccountData(db,userId)` supplies all owned order/event summaries to the existing account export with `complete:true`. It uses a server-scoped owned-order subquery, avoiding a per-order list of D1 bind parameters. It exports safe summaries rather than raw Stripe payloads, provider IDs or another party's address. The bounded screen overview does not pretend to be a complete account export.

## Release evidence

Strict project TypeScript was executed successfully after integration. Independent QA owns `checks/commerce-api.mjs`; the published release record will carry the final exact pass counts. Its fixtures execute the real routes and Drizzle/D1-style atomic batches with a fake Stripe transport and real WebCrypto signatures. Provider account creation, test-card charges, actual refunds and bank settlement remain unexecuted until real protected sandbox credentials and reachable webhook ingress exist.

Applied migrations 0–6 remain immutable. Migration 7 adds sandbox order, event, seller and money-request tables. The transient `operation_guard` CHECK enforces version/eligibility conditions inside a single atomic D1 batch and is cleaned up in that same batch. There are no transaction callback assumptions or automatic funding triggers.
