# ComicHuddle payment, refund and data release — 9 October 2026

This is an engineering preparation release for Malik LLC, Minnesota, with public support at maliktecks@gmail.com and USA-only checkout. It preserves the existing owner-private audience. The current verification record and PAYMENT-QA.md contain the final automated results. This release does not authorize taking real payments or claim public-production readiness.

## What changed

- Added an account drawer **Orders & refunds** tab, private comic/shipping records, buyer refund-review requests, seller tracking submissions and exact-order operator support lookup. The native app opens this account area through its existing browser handoff.
- Added sandbox-only Checkout, connected seller onboarding, raw signed webhook verification, original-payment refunds and an operator reconciliation flow. Only server-owned listing prices, shipping, seller identity and frozen US delivery details enter a payment request.
- Added migration 7 with durable sandbox order, payment-event, seller-binding and money-operation tables. Existing identity, collections, messages, groups, Workshop, listings, auction proposals and valuation records retain their existing schema. No test customers or synthetic sales are inserted into the deployed database by the local fixture suite.
- Reserved physical copies cannot be sold twice. Moderation removes discovery without deleting financial reservations. Paid participants retain private photo evidence after a listing is sold, hidden or blocked. An account with order history cannot erase its financial/custody records through self-service deletion; support must apply a reviewed retention/deletion procedure.
- Changed CGC price-guide navigation to an ordinary external GoCollect link on web and native. No GoCollect prices, licensed feed, affiliation or publisher cover permissions are implied.
- Implemented an original, rights-gated research FMV model and documented commercial data inquiries. It has no connected production sale feed and does not fabricate current estimates.

## Recommended buyer protection

The proposed standard policy starts with a completed, confirmed order, including the delivery information collected before payment. Require a tracking submission within 48 hours, trusted physical carrier acceptance within 72 hours, then trusted delivery and a 48-hour buyer review before permitting a seller transfer. A label alone is not proof of shipment. A late webhook must not restart a known payment clock.

Missed shipment deadlines make an order eligible for a full refund after current payment/shipping checks. A buyer's missing, damaged or materially different comic claim freezes seller release. High-value, uncertain-custody and disputed orders need extra review. The delivery review window does not extinguish later applicable refund or card-dispute rights.

Use Stripe Connect separate charges and transfers rather than sending buyer funds immediately to the seller. Stripe does not provide escrow. Moving money from the platform to a connected seller and paying that seller's bank are separate steps. Refunds after a seller transfer require explicit recovery/reversal and reconciliation; the platform needs reserves and a chargeback policy.

**Current limits:** seller-entered tracking is unverified. There is no trusted carrier connector, automatic delivery/release endpoint, scheduled deadline job, bank-payout operation, production tax calculation or live-money mode. The owner can evaluate a bounded set of orders manually. A supplied but unverified tracking number goes to review rather than being falsely treated as proof that nothing shipped. These controls cannot be advertised as an active automatic two-day money-back guarantee yet.

## Processor setup the founder must complete

1. Open Stripe Connect under the business and create its own separate sandbox. Enter banking, identity and business details in Stripe's protected interface.
2. Establish supported reachable HTTPS ingress for `/api/commerce/webhook`. The owner-private preview's hosting protection may reject provider callbacks before application signature verification. Keep private account pages protected; never put preview bypass credentials in a webhook URL.
3. Configure the test secret and webhook signing secret in protected runtime settings. The current deployment has a canonical public origin and an explicit disabled sandbox flag; it has no processor secrets. Do not paste credentials into chat or the codebase.
4. Complete the integration review, then enable only sandbox testing. Exercise genuine successful, declined, challenged, interrupted and competing purchases, event delivery/replay, seller onboarding, refunds and eventual carrier-conditioned transfers. Keep the resulting provider evidence separate from simulated test evidence.
5. Before any live launch, connect carrier verification and scheduled checks; finalize taxes, platform fees, refunds/returns, shipping/signature requirements, reserve funding, seller agreements, support ownership and applicable marketplace/auction obligations. Obtain payment-provider and legal review of the actual funds flow.

See STRIPE-SANDBOX-SETUP.md for exact configuration and the acceptance checklist, COMMERCE-BACKEND.md for route/ledger contracts, and BUYER-PROTECTION-AND-PLATFORM.md for operating recommendations and official references.

## Squarespace

Squarespace's documented Commerce APIs manage a merchant store. Our recommendation is to retain this custom marketplace backend for independent seller verification, private order records, auctions and conditional seller transfers. Squarespace can be a separate marketing or business-owned merchandise site. This is a platform suitability assessment, not a claim that no custom extension could ever be built on Squarespace.

## Key Collector, eBay and our own FMV

Key Collector's consumer subscription is not a license to copy its database into ComicHuddle. Request written commercial rights, a quote and a sample feed. Its published support address is support@keycollectorcomics.com; ask to be routed to commercial licensing. Specify free and paid web/PWA/iOS/Android display, issue/variant metadata, key notes, update frequency, price data, bulk/API delivery, caching and attribution. Request explicit derivative-valuation permission and separately establish cover-image rights. No licensing offer or provider agreement has been confirmed; no inquiry was sent on the founder's behalf.

eBay's Marketplace Insights sold-data API is currently restricted and closed to new users. Its API agreement also restricts competitive/pricing uses and requires express written consent for pricing tools built from Restricted API data. A developer key, active asking-price search or access to seller research does not establish permission for a public off-eBay price guide. Negotiate the permitted feed/use before importing data. The ready-to-send inquiries and official sources are in PAYMENTS-AND-DATA-NEXT-STEPS.md.

The original research model groups exact issue, edition, variant, printing, Raw/CGC grade and label. It uses only authorized, verified, settled single-comic sale prices, without shipping/tax; deduplicates economic transactions and excludes unknown accepted offers, cancellations/refunds, lots and asks. Its default is a weighted median over 90 days, with a 30-day recency half-life. Publication requires at least five qualifying sales, three independent sellers, a sale within 30 days and limits on seller concentration; otherwise it returns no estimate. The observed price range and evidence counts are not a calibrated confidence interval. This is a prototype awaiting a lawful feed and backtesting, not Key Collector's proprietary method. See INDEPENDENT-FMV-METHOD.md.

## Evidence boundaries

The automated route tests execute the actual TypeScript handlers and Drizzle queries against isolated SQLite/D1-style atomic batches, fixture account identities and temporary object storage. Payment integration tests use fake Stripe HTTP responses and real WebCrypto signatures. Client checks execute actual extracted functions. None establishes a genuine processor transaction, hosted OAuth session, rendered-browser journey, hardware interaction or production load capacity.

Native TypeScript and seven-viewport image-bound calculations passed, and refreshed Expo web/iOS/Android exports were generated. They are unsigned bundles and the native account features remain browser handoffs. Browser/device acceptance, native signing/store accounts and the retained native-toolchain advisory gates remain open. This engineering release must not be described as perfect, scam-proof, insured or legally guaranteed.
