# Proposed comic purchase protection policy

Draft version: `2026-10-09-protection-draft-1`. Prepared 2026-10-09.

This document describes the implemented **pure server policy kernel** in `lib/commerce-policy.ts`. It makes eligibility decisions and records proposed state transitions. It does not create a processor account, charge a card, refund money, transfer funds, verify a parcel or schedule a background job. Separate sandbox/API/database work must supply those capabilities and independently verify its results.

The intended recipient of a successful sale release is the **seller**. A refund goes back to the buyer through the payment processor. A Stripe transfer moves platform funds into a connected seller's Stripe balance; its later bank payout depends on processor availability and payout configuration.

## Draft deadlines

All clocks start from a trusted, confirmed `paidAt`, not order creation, a browser success page or the buyer's claim of payment. Deadline equality is late.

| Stage | Required evidence | Policy decision |
| --- | --- | --- |
| Payment | Verified exact order, buyer, seller, amount, currency and payment intent | Bind payment once; enter `awaiting_shipment`. |
| Before paidAt +48 hours | Valid tracking verified for this owned order, with trusted submission and validation times | Continue awaiting physical handoff. A typed number or created label alone does not qualify. |
| At paidAt +48 hours without valid tracking | Server deadline evaluation | Full refund becomes eligible. This is not yet a completed refund. |
| Before paidAt +72 hours | Verified physical carrier acceptance scan matching the locked carrier/tracking identity | Enter `in_transit`. |
| At paidAt +72 hours without acceptance | Server deadline evaluation | Full refund becomes eligible. |
| Confirmed delivery | Verified delivery for the same shipment after handoff | Enter `delivered_review`; start the buyer review window. |
| Delivery +48 hours for standard orders | No unresolved buyer issue, dispute or manual hold; configured seller account and original charge | Seller transfer becomes eligible. A separate authorized money-operation request is still necessary. |

The 72-hour carrier deadline and post-delivery review window are proposed protections in addition to the requested two-day tracking rule. They require clear disclosure and an operator-approved launch policy. They are not asserted as a universal legal requirement.

Missed deadlines remain recorded. Late tracking, handoff or delivery cannot turn a refund path into a seller release. Late-arriving evidence also fails closed if a deadline has already been evaluated without its proof; an operator may need to investigate provider delays rather than silently rescue the sale.

An owned buyer issue or return request immediately freezes eligibility. It does not automatically approve a refund: an authorized operator may resolve the issue for release or full refund. An open or lost processor dispute independently blocks automatic money operations. Buyer-issue resolution cannot clear a bank dispute.

## High-value orders and signatures

The kernel has no invented dollar threshold. An order marked high-value requires an explicit configured policy, required signature evidence and a review window longer than 48 hours. Until those choices are present, it enters manual review. Supported configured review windows are 48–336 hours; the test example uses 96 hours for a high-value order, and is an example rather than an approved business rule. Standard signature-required orders also remain held until signature evidence is verified.

## Financial state and reconciliation

`refund_eligible` permits one exact full-amount refund reservation; `refund_pending` remains pending until a matching verified processor confirmation creates `refunded`. `release_eligible` permits one exact seller-amount/destination reservation; `transfer_pending` becomes `transferred` only on matching verified confirmation. Partial refunds, transfer reversals and bank payout status are outside this kernel.

Once a financial operation is reserved, a different refund or transfer request is rejected. The same operation key is retryable without creating a second reservation. Terminal states retain their processor object IDs and cannot open a competing money operation. Unknown or conflicting processor evidence requires reconciliation. A buyer issue during an already in-flight transfer remains recorded; the kernel prevents a competing automatic refund, but cannot undo an external request that has already started. Post-transfer complaints require a separate recovery/reversal workflow.

## Trusted integration boundary

The adapter must verify signatures, retrieve processor facts where necessary, authorize actors and map evidence to an owned order before constructing an event. `verified: true` is an internal adapter assertion, not an authentication mechanism and never a field accepted from public JSON. Carrier evidence must match the order's locked shipment; courier events never create a refund or transfer by themselves.

Persist the immutable buyer/seller/currency/amount policy snapshot, JSON state and its version. Commit decisions with an atomic compare-and-swap before calling a processor. Store durable provider receipts, payload identity and operation idempotency keys outside the kernel. Its recent 64 receipt fingerprints only handle immediate retries and cannot replace that ledger. On a timeout, preserve the pending operation and reconcile/retry the same processor key; do not infer success, free its lock or create a second key.

The caller must run deadline evaluation through a bounded scheduler or sweep. No such scheduler is supplied by this pure module. An unconfigured carrier adapter must leave release disabled; a seller checkbox, tracking label or owner-entered delivery claim cannot substitute for trusted evidence.

## Payment-provider and business responsibilities

Separate charges and transfers decouple the customer charge from later seller transfers. Source-charge linkage and available balances affect transfer execution. A charge refund does not automatically reverse a previous seller transfer, so the platform needs its own recovery/reconciliation handling. [Stripe separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers?integration=mobile&platform=android).

Merchant-of-record responsibility depends on charge configuration. For indirect charges without `on_behalf_of`, the platform is the merchant of record; customer-facing payment pages, receipts and terms must identify the responsible entity. Fees, refunds, disputes, negative balances and taxes require an actual operating model and processor approval. [Stripe merchant of record](https://docs.stripe.com/connect/merchant-of-record), [Marketplace separate charges and transfers](https://docs.stripe.com/connect/marketplace/tasks/accept-payment/separate-charges-and-transfers).

Stripe states that it does not provide escrow services or support escrow accounts. Manual payouts can control timing within applicable country limits; they do not establish legal escrow. This draft must not be marketed as escrow, insurance, guaranteed delivery, guaranteed grade improvement or protection from every loss. [Stripe manual payouts](https://docs.stripe.com/connect/manual-payouts).

## Verification

`node checks/commerce-policy.mjs`: **36 groups passed, 0 failed**. Web TypeScript check also passed. The deterministic checks cover exact deadline boundaries, label-only shipping, late and wrong-shipment evidence, signature/high-value holds, issues/disputes, out-of-order events, operation retries, refund/delivery races, inconsistent states and the external CAS requirement. No processor transactions, carrier requests or hosted records were used by this suite.
