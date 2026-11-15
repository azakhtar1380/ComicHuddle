# SafePurchase readiness (round 4, 2026-11-15)

**Status: not ready to announce.** SafePurchase stays behind `SAFEPURCHASE_ENABLED` (and needs
`SAFEPURCHASE_INSPECTION_ADDRESS`). Do not tell users it is live until every box in "Must work end to end" is
checked against real (live-mode) payments, a real receiving location, real carrier tracking and a real payout.

## What exists now (built and tested in test mode)

| Piece | Where | Verified how |
|---|---|---|
| Automatic SafePurchase at/above the threshold (`SAFEPURCHASE_THRESHOLD_CENTS`, default $500), opt-in below | `lib/commerce-protection.ts` `protectionPlan` | `checks/marketplace-protection.test.ts` (PGlite + synthetic Stripe) |
| Money held until delivery + 48 h review | `lib/commerce-policy.ts` | same test |
| Seller ships to ComicHuddle; address from `SAFEPURCHASE_INSPECTION_ADDRESS`, placeholder "ComicHuddle receiving address — set by the owner" when empty | `lib/safepurchase.ts`, `components/safepurchase-timeline.tsx` | `checks/safepurchase-timeline.test.ts` |
| Receive → check (pass / fail / partial) → ship to buyer / pickup hand-off | `commerceInspection` in `lib/commerce.ts`, admin UI `/admin/safepurchase` | marketplace-protection test (owner path) |
| Failed check → automatic full refund; return-to-seller tracking recorded | `commerceInspection` + admin `return_shipped` | marketplace-protection test (refund); return tracking is a note only |
| Same 7-step timeline for buyer, seller, admin; notes, tracking, photos; internal admin notes | `lib/safepurchase.ts`, `components/safepurchase-timeline.tsx`, migration 040 | unit test; UI not browser-tested |
| Each admin update notifies buyer and seller | `notifyParties` → `lib/notifications.ts` | not exercised end to end (needs migration 036 applied) |
| Admin-only dashboard, audit log of every admin action (including refused attempts) | `/admin`, `/admin/safepurchase`, `/admin/audit`, `app/api/admin/**`, `lib/admin-audit.ts` | type-checked, lint-clean; not browser-tested |
| SafePurchase badge (real setting: "SafePurchase" or "SafePurchase coming soon") | `components/safepurchase-badge.tsx` | not mounted yet (cards helper / owner) |

## Must work end to end before announcing (what's missing)

1. **Live payments.** Orders are test-only today: `commerce_orders` has a `commerce_sandbox_only` check
   (`sandbox = 1`) and Stripe runs with test keys. Live needs the `COMMERCE_STRIPE_LIVE_*` keys,
   `COMMERCE_LIVE_REVIEWED=true`, a schema change to allow `sandbox = 0`, and one real low-value purchase between
   two internal accounts (docs/PAYMENTS-SETUP.md §9).
2. **A real receiving location + people.** `SAFEPURCHASE_INSPECTION_ADDRESS` is empty, so SafePurchase is off and
   sellers would see the placeholder. Someone must be there to receive, check within 2 business days, repack,
   and ship insured with signature. Decide insurance coverage (who pays if a book is lost/damaged at ComicHuddle).
3. **Admins.** `COMICHUDDLE_ADMIN_EMAILS` is empty, so only the Founder can run the check. Add up to
   `COMICHUDDLE_ADMIN_LIMIT` (default 3) emails.
4. **Database migration 040** (`db/postgres-migrations/040_safepurchase_admin.sql`) is not applied. Until it is,
   admin actions are refused (they can't be logged) and notes/photos can't be saved. Migration 036
   (notifications) must also be applied or buyers/sellers won't be notified.
5. **Carrier tracking.** "Delivered" can only come from the carrier (EasyPost webhook), never by hand.
   Without `EASYPOST_API_KEY` and `EASYPOST_WEBHOOK_SECRET` (and the webhook registered at
   `/api/commerce/carrier-webhook`), shipped-to-buyer orders never reach Delivered, the 48-hour window never starts
   and the seller is never paid. SafePurchase also requires a **signed** delivery; confirm the carrier service and
   EasyPost report the signature.
6. **Outbound labels.** There is no label purchase. Admins type the tracking number of a label bought elsewhere.
   Insured, signature-required labels must be bought manually (or add EasyPost label purchase later).
7. **Seller payouts.** `COMMERCE_PAYOUTS_ENABLED` is off, so "Done" (seller paid) can't happen; the admin
   "Release payout" button is refused. See docs/PAYOUTS-DECISIONS.md.
8. **Partial-collection pro-rated refunds** are recorded but issued manually by support (existing behaviour:
   "partial_refund_settlement_required" hold).
9. **Return to seller** after a failed check: the return shipment is a logged note with tracking; there is no
   carrier-confirmed "returned" state and no prepaid return label flow.
10. **Customer copy review.** docs/BUYER-PROTECTION-POLICY.md says customer wording needs a lawyer before live
    payments. The /safepurchase page already says "isn't open for orders yet" while the flag is off.
11. **Inspection fee.** `SAFEPURCHASE_FEE_CENTS` is $0 until you set pricing.

## Flip-on checklist (in order)
1. Apply migrations 036 and 040 to QA, then production.
2. Set `COMICHUDDLE_ADMIN_EMAILS`.
3. Set `EASYPOST_API_KEY`, `EASYPOST_WEBHOOK_SECRET`, register the webhook; verify one real tracked, signed delivery.
4. Set `SAFEPURCHASE_INSPECTION_ADDRESS` (full mailing address, at least 10 characters), then `SAFEPURCHASE_ENABLED=true` on QA.
5. Run one full test-mode order through `/admin/safepurchase`: receive → check → ship → (carrier) delivered → 48 h → release.
6. Do the live-mode steps in docs/PAYMENTS-SETUP.md, then repeat step 5 with a real low-value order.
7. Only then mount the badge everywhere and announce.
