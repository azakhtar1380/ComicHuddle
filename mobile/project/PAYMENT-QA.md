# Payment and sandbox integration QA

Audit date: 2026-10-09. Starting source: `312c1a1ebb8663d3c5daae4eabb7b78be7aa0012` (private version 15), plus this sandbox integration change.

## Current verdict

The final frozen runner passes **388 named groups with zero failures**, plus network, privacy, dialog-focus, dense-query and website TypeScript checks. A sandbox-only order ledger, Stripe test adapter and owner refund/reconciliation actions now exist. Real Stripe sandbox credentials/account, trusted carrier integration and seller transfers are not connected in this session. **Actual Stripe charges, refunds, transfers and payouts executed by this audit: 0.**

The actual-route suite invokes the application's TypeScript handlers and Drizzle queries against fresh isolated SQLite with an atomic D1-style batch adapter and an in-memory object bucket. Authenticated users are synthetic fixtures. Stripe HTTP responses are simulated locally; signed webhook bodies use actual HMAC verification. These are handler, storage and boundary integration tests, not hosted browser or processor E2E.

## Verification

| Suite | Named groups | Evidence type |
|---|---:|---|
| Existing readiness negatives | 34 | Actual isolated routes and negative cases |
| Marketplace previews | 49 | Actual isolated routes, inventory and concurrent proposals |
| Legacy marketplace | 6 | Legacy database fixtures and migration shape |
| Client race checks | 26 | Actual extracted client logic with controlled promises |
| Collector/workshop journeys | 35 | Actual isolated route journeys and storage faults |
| Journey client checks | 30 | Actual extracted client logic and account-intent helpers |
| Disabled legacy buy boundary | 27 | Actual isolated routes; no processor calls |
| Independent FMV prototype | 43 | Real pure model; synthetic permitted-sale fixtures |
| Buyer protection policy | 36 | Real pure policy; synthetic deadlines and financial receipts |
| Stripe sandbox adapter | 53 | Simulated provider HTTP plus real signature verification |
| Sandbox commerce API | 49 | Actual routes and persisted records; simulated provider responses |
| Verified total | 388 | Named groups, not browser/financial transactions |

Final command `node checks/run-readiness.mjs` exited 0 with all expected suite summaries present. Retained evidence: `project/evidence/PAYMENT-READINESS-2026-10-09.txt`. Social overview used 23/40 queries, workshop 20/40 and private job detail 6/10; the full 25-row legacy initializer used at most 32 bindings. `git diff --check` exited 0. The final runner also passes website TypeScript without incremental output. The genuine pre-6 migration fixture remains; current-route legacy cases now apply later schema migrations 7+ after the migration 6 assertions. This fixes an outdated test database, without changing production migrations or weakening overlap assertions. Dependency-audit figures in earlier release reports are retained evidence; this change does not rerun dependency audits. Native builds and seven viewport checks are root-reported evidence, not independent device or native payment testing.

Run from the website repository:

```sh
node checks/run-readiness.mjs
node --experimental-vm-modules checks/commerce-api.mjs
node checks/stripe-sandbox.mjs
git diff --check
```

## Boundaries exercised

- Missing, live or unreviewed configuration refuses checkout before business writes. Actions require fixture authentication, same origin, current rules, eligible collectors and strict request fields. Server price/shipping are authoritative; price, paid-status and redirect overrides are rejected.
- Single and collection purchases retain immutable copy/photo/address snapshots. Competing buyers, stale source ownership, withdrawal/moderation/deletion races and failed receipt storage are guarded in atomic batches. Transient operation guards are empty after success and rollback.
- A redirect never confirms payment; both new and retrieved checkout URLs require the exact Stripe HTTPS host with no credentials or port. Signed events are re-retrieved against the exact session, intent, charge, order, currency and amount. Durable body fingerprints reject changed event reuse; duplicate events remain safe. Unpaid expiration releases inventory, and stale paid claims cannot revive an expired checkout.
- Changed seller eligibility denies new checkout URLs while genuinely received payment can still bind to its existing immutable order under a review hold. Paid participant address/photo continuity survives public moderation and blocking; unrelated collectors and support views do not receive a private shipping address.
- Shipping deadlines use the authenticated completed-payment event time, not webhook arrival, and later receipts do not restart them. Missing, unknown or future completion time still binds re-retrieved paid facts under a processor hold, exposes payment confirmation without a false date/deadline, and blocks new refunds and automatic sweep actions.
- Buyer refund requests belong to the buyer and freeze release. Owner refunds reserve one financial ledger before contacting the adapter, reuse persisted processor keys, reconcile known refund IDs through GET and block replacement POSTs after the 23-hour safety window or under unresolved processor holds. Pending-result races and receipt faults cannot overwrite a different refund identity or create a second reserved operation.
- A clean unshipped full refund releases inventory. Entered but unverified tracking retains custody locks for support review. Any financial history prevents self-deletion, including a missing profile; complete finance export includes 106 fixture orders and every owned event while bounded overviews advertise truncation. Statements enforce the hosted 100-bind limit.
- Manually entered tracking does not establish carrier acceptance or delivery. Client paid/delivered/transfer claims are rejected. HTTP seller release remains503; the owner sweep is manual and explicitly reports that no scheduler/carrier connector is installed.

## Findings and resolution

The review found and tested corrections for disabled-buy visibility, paid photo continuity, complete finance export, checkout retry eligibility, moderation inventory/discovery preservation, unverified refund custody, disputed-charge checks, financial-result CAS, reconciliation hold approval and onboarding deletion/recreation. Completion-time deadlines, malformed smaller refund-ledger bookkeeping and a seller tracking submission replacing a processor hold were also corrected; all 49 commerce groups pass independently and in the full runner. Late ledger-amount changes are rechecked by the atomic confirmation guard, and a corrupt saved checkout is rejected before any retry provider operation. No unresolved application failure remains in this tested scope.

The independent FMV review also reproduced a sub-cent positive price becoming an available zero-dollar estimate. The model now rejects values below one cent; the 43 model groups pass independently. Its output remains `researchOnly: true` and `calibrated: false`, with no public importer/feed integration. The GoCollect controls are ordinary external guide links with explicit exact-issue/grade guidance; they do not import prices or supply marketplace/collection totals.

## Remaining release evidence

A supported hosted browser controller is unavailable in this session. Hosted OAuth, rendered checkout/navigation, real cross-account browser flows, physical iOS/Android behavior and native signup were not tested. The SQLite/D1 adapter and physical-line migration test do not prove remote D1 deployment or runtime concurrency.

A real Stripe test account must still exercise successful/declined/authentication-required cards, interrupted and repeated checkout, delivered signed webhooks, actual test refunds, connected seller verification, dispute/reconciliation and provider failures. Trusted carrier verification and a supported scheduled job are required before automated deadline enforcement and seller release can operate. Tax/fee behavior is deliberately zero in the sandbox snapshot; live tax, payout and banking readiness are unverified. No real user, production profile or financial record was mutated by this audit.
