# ComicHuddle payment audit

Audit date: 2026-10-09. Scope: current source and actual API handlers executed with synthetic identities, isolated SQLite and an in-memory R2 bucket. No hosted records, processor accounts, cards or bank accounts were used.

**The legacy purchase endpoint remains disconnected. Separate sandbox-only order APIs, processor, ledger and protection-policy code now exist; this audit's 27-group suite verifies that unconfigured sandbox requests and legacy purchase attempts stop without creating a payment or order. No genuine processor transaction was executed. This is not an end-to-end payment-processing certification or live-money approval.**

## Current implementation

| Capability | Actual behavior |
| --- | --- |
| Fixed single comic and collection listings | Owned-copy snapshots, prices and shipping in cents, photos and inventory reservations exist. |
| Purchase screen | Shows a subtotal before tax and checks checkout availability. It has no card-entry form. |
| Purchase API | `POST /api/social`, `action: 'buy'`, uses the listing ID. Eligible fixed listings return `503`, `code: 'payment_setup_required'`, with an explicit no-payment/no-order message. |
| Buyer and seller eligibility | Identity, same-origin, profile, buyer restriction and current consent gates apply. The corrected boundary also denies missing, hidden, moderated, restricted or deleting sellers, and blocks in either direction. |
| Offers | Acceptance records a negotiation. It does not charge, mark the listing sold or create an order. |
| Timed auctions | Private, nonbinding proposals and bid history. The deadline and owner cancellation do not charge a leader or issue a refund. |
| Comic Workshop | Requests, monetary quotes and accepted custody agreements exist. Quote approval does not process payment. |
| New sandbox processor adapter | `lib/stripe-sandbox.ts` implements server-side test-only Checkout Sessions, bound processor retrieval, connected-seller onboarding, refunds and separate transfers. Configuration/owner-review gates and live-key rejection apply. No real provider result is established by the 27 legacy-boundary checks. |
| New commerce ledger | Schema migration0007 adds sandbox-only orders, seller bindings, durable events and money-operation requests with uniqueness/version constraints. These tables are present and empty in this suite's isolated database. This audit does not assert hosted migration status. |
| Selected sandbox funds flow | Separate charges and transfers: the platform-side charge is separate from a later seller transfer. Seller release and bank-payout HTTP operations remain disabled. The sandbox uses zero platform fees and tax; live commission, tax, reserves and recovery policies need approval. |
| Shipping and refund policy | `lib/commerce-policy.ts` provides versioned pure state/eligibility decisions, proposed48-hour tracking/72-hour carrier/48-hour delivery-review rules, and refund/transfer exclusivity. It supplies no actual carrier verification or background scheduling. |
| Webhook and reconciliation boundary | `/api/commerce/webhook` authenticates bounded raw bytes, then retrieves the exact session, intent and charge. Order changes, durable event receipts and refund bookkeeping use guarded atomic batches. The owner reconciliation action reuses a stored refund request instead of replacing its key. Its separate simulated coverage belongs in the commerce API QA report. |
| Production finance | No live charges, bank payouts, real carrier proof, insured protection or processor/business approval is established by this audit. Post-transfer recovery, tax and dispute operations require explicit implementation and operational review. |

Evidence: `app/api/social/route.ts`, `app/api/pressing/route.ts`, `app/api/commerce/route.ts`, `app/api/commerce/webhook/route.ts`, `app/marketplace.tsx`, `lib/community.ts`, `db/schema.ts`, `drizzle/0007_commerce_sandbox.sql`, `lib/stripe-sandbox.ts`, `lib/commerce.ts` and `lib/commerce-policy.ts`. The legacy social overview's `checkoutEnabled` remains false. Client-supplied amounts, paid flags, destination accounts and redirect URLs are unused by the disabled legacy purchase handler; this says nothing about separately tested commerce checkout pricing. The previous audit's absence-of-ledger assertion was replaced after the new sandbox implementation was introduced.

## Executed checks

Run from the repository root:

```sh
node --experimental-vm-modules checks/payment-boundary.mjs
```

Result: **27 groups passed, 0 failed. Outbound processor attempts: 0. Real processor transactions executed: 0.**

The suite executes the real social, vault, media and pressing handlers through Drizzle against isolated SQLite. Fixtures create collector profiles, uploaded photos, owned comics and listings through those handlers. It checks single comics, whole collections and legacy listings; identity/origin/consent restrictions; both block directions and seller eligibility; self-purchase, withdrawn/missing listings and malformed input; forged price/currency/paid/redirect claims; unknown legacy payment actions; sequential and concurrent retries; throttling and recovery; accepted offers; active, ended and cancelled auctions; and presser quote acceptance. It also executes the real sandbox adapter's unconfigured Checkout Session and webhook guards and requires all four commerce tables to remain empty.

Every disabled/rejected checkout compares all business-table rows and stored photo hashes before and after. Expected persistent `write_limits` security counters are excluded and checked separately. The positive care journey intentionally changes only its care job and event records. Ephemeral operation guards must be empty after every group. The suite rejects any attempted outbound fetch and confirms that no exercised record acquires a paid, captured, settled or refunded status.

The audit found that direct purchase requests previously omitted seller visibility/restriction/block checks. Root corrected the handler during this pass; regression cases now require the generic `404` rejection for those sellers. No checkout was enabled.

These are isolated handler tests. They do not cover hosted identity login, browser/card UI, a processor sandbox, real declines or authentication challenges, production webhook delivery, real bank settlement, or tax/legal approval. A passing disabled-boundary test must not be advertised as a successful payment transaction.

## Separate sandbox integration verification

The completed source review and independent targeted runs establish the following separate scopes. They do not change the legacy endpoint's disabled behavior or the 27-group suite's empty-ledger assertions.

| Suite | Result | Evidence boundary |
| --- | --- | --- |
| `checks/payment-boundary.mjs` | 27 passed, 0 failed | Real legacy handlers, isolated database/storage, no outbound processor attempts. |
| `checks/commerce-api.mjs` | 49 named groups passed, 0 failed | Real new commerce handlers and atomic ledger batches, fake Stripe HTTP and real test signatures. |
| `checks/stripe-sandbox.mjs` | 53 named groups passed, 0 failed | Synthetic provider responses, timeout/error cases, raw-byte signature verification. |
| `checks/commerce-policy.mjs` | 36 groups passed, 0 failed | Deterministic pure eligibility/state transitions; no HTTP or funds movement. |

**Genuine processor transactions: 0.** The final whole-project verification belongs in PAYMENT-QA.md and the release record; these targeted results do not establish rendered browser/device acceptance or hosted processor delivery.

The review found and verified fixes for unsafe retries after the processor idempotency window, seller eligibility changes during checkout retries, overwritten financial holds, stale refund-provider binding, inconsistent full-refund ledger amounts and payment clocks restarted by delayed delivery. It also verified that genuinely received signed payment proof survives moderation, that paid participants retain private photo evidence, and that financial or uncertain-custody reservations cannot be erased to relist a comic. Receipt-write failures roll back database changes; a subsequent attempt reconciles the original persisted operation. Unknown funds state, disputes and unverified carrier evidence still require review rather than authorizing seller release.

## Requirements for genuine sandbox transactions

The following separates external prerequisites and integration validation from prepared code. The new adapter, ledger and policy are not evidence that these steps have passed:

1. Provision an authorized, isolated Stripe platform sandbox and connected-seller test fixtures in that environment. Stripe recommends general sandboxes for new integrations, with development and CI separated. Sandbox payments do not reach card networks; a sandbox success cannot establish live capability approval. [Sandboxes](https://docs.stripe.com/sandboxes), [Connect testing](https://docs.stripe.com/connect/testing).
2. Configure sandbox API credentials and a separate endpoint signing secret through hosting secrets. Backend secrets must stay out of browser code, source control and chat. Use suitable least-privilege restricted credentials where supported. [API keys](https://docs.stripe.com/keys).
3. Review the selected separate-charges-and-transfers model with the business and processor. The sandbox charges the platform and keeps later seller transfers separate; it does not automatically send buyer funds to a seller. Platform responsibility, fees, reserves, refunds, disputes and post-transfer recovery must be explicit before live approval. Refunding a charge does not automatically reverse a seller transfer. [Separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers?integration=mobile&platform=android), [Merchant of record](https://docs.stripe.com/connect/merchant-of-record).
4. Exercise the prepared order APIs against the actual sandbox: server-authoritative prices, shipping/tax treatment, eligibility, atomic inventory claims, durable order/session mappings and expired/failed-session handling. Client price overrides and redirects must never authorize fulfillment. The application stops unknown object-creation POST retries after 23 hours; a known provider ID is retrieved instead. Stripe can prune idempotency keys after at least 24 hours, so indefinitely reusing an unknown key is not proof against a new operation. [Idempotent requests](https://docs.stripe.com/api/idempotent_requests).
5. Establish reachable HTTPS webhook ingress and validate actual provider delivery. Owner-private hosting may block Stripe before the application's raw-body signature handler runs. Keep private user/order pages protected without putting preview bypass credentials in a callback URL. Deduplicate receipts and handle repeated, retried and out-of-order events. Fulfill only after checking processor payment status, once per session despite concurrent calls; validate any future delayed payment methods separately. [Webhooks](https://docs.stripe.com/webhooks), [Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted).
6. Validate refund/transfer transitions and implement the remaining fee, dispute, reversal and payout reconciliation workflow. Then execute actual sandbox scenarios for success, decline, authentication challenge, cancellation/expiry, repeated clicks, concurrent buyers, invalid/duplicate/delayed/out-of-order webhooks, refunds/transfer reversals and payout failure. Record processor test object IDs alongside the app's resulting amounts and state. Stripe provides test cards and payout simulations; simulated payouts are not processed by a bank. [Payment testing](https://docs.stripe.com/testing), [Connect testing](https://docs.stripe.com/connect/testing).

Live readiness additionally needs actual processor/business approval, seller onboarding and the applicable auction, tax, fulfillment and consumer terms work. This audit does not establish those approvals. The separate integration remains sandbox-only; legacy checkout stays disconnected and auctions stay explicitly nonbinding until their respective gates are cleared.
