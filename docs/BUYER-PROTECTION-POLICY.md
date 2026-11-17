# ComicHuddle Buyer & Seller Protection Policy (product spec)

Status: product spec for engineering. Customer-facing wording must be reviewed by a lawyer before live payments.
Modeled on eBay Money Back Guarantee + Authenticity Guarantee, adapted for comics. **SafePurchase** keeps the 6-step flow, 48-hour tracking deadline and 48-hour buyer review window already published on `/safepurchase`.

All amounts are configurable server-side; defaults are shown.

## 1. Two tiers

| Tier | Applies to | What the buyer gets |
|---|---|---|
| **Standard Protection** | Every order paid through ComicHuddle checkout (shipped or local pickup) | Money back if the item doesn't arrive or isn't as described |
| **SafePurchase** (flagship, the name already used on /safepurchase) | **Automatic** for any single comic **or** collection/bundle whose item total is **≥ $500** (`SAFEPURCHASE_THRESHOLD_CENTS=50000`); below the threshold the seller or buyer can opt in (the existing seller opt-in stays) | Independent inspection before the book reaches the buyer, insured signature delivery, longer payment hold |

Cash, off-platform payments and trades are **not** protected. The UI must say so wherever those are arranged.

## 2. Standard Protection rules

1. **Seller ships within 3 business days** with tracking (`COMMERCE_HANDLING_DAYS=3`). No tracking after the deadline → buyer may cancel for a full refund.
2. **Funds are held** until the carrier reports *Delivered*, plus a **72-hour protection window** (`COMMERCE_RELEASE_HOLD_HOURS=72`) with no open issue.
3. **Local pickup:** buyer pays online and gets a 6-digit pickup code. The order completes when the buyer taps "I picked it up" or the seller enters the code. The 72-hour window then applies.
4. **Claims:** the buyer may open "Not received" or "Not as described" within **30 days** of delivery (or the estimated delivery date). Opening a claim freezes release.
5. **Seller response:** 3 business days to resolve (refund, replacement or return). Unresolved → buyer may escalate; ComicHuddle support decides within 48 hours.
6. **Not as described** (wrong issue/variant/printing, undisclosed restoration or pressing, grade materially worse than listed, counterfeit): full refund including original shipping; the buyer returns the item with a prepaid label at the seller's cost. The refund is issued when return tracking shows *Delivered* to the seller.
7. **Buyer remorse** returns are at the seller's discretion (listing states "No returns" or "30-day returns").
8. **SafePurchase after the seller is paid:** a claim within the same 30 days is reviewed by ComicHuddle. If approved, ComicHuddle refunds the buyer from its own balance (full, or a smaller amount support sets). The seller keeps their payout and no transfer is reversed. One ComicHuddle refund per order.
9. A card chargeback opened while a claim is in progress is handled by ComicHuddle; a buyer may not receive both a claim refund and a chargeback refund.

## 3. SafePurchase (flagship) rules

Triggered automatically at checkout when item total ≥ threshold. The listing page and checkout show a **SafePurchase badge** and explain the steps before payment.

1. **Payment held** for the whole flow; nothing is released to the seller until step 6.
2. **Seller ships to the ComicHuddle Inspection Center** (address configured by the operator, `SAFEPURCHASE_INSPECTION_ADDRESS`), insured for the full sale value, and **records tracking within 48 hours** (matches the existing SafePurchase page). A missed deadline lets the buyer cancel for a full refund.
3. **Inspection within 2 business days of arrival:**
   - Correct title, issue, variant, printing and year
   - Condition consistent with the listed grade (raw: within one half-grade step; slabbed: certificate number verified against the grader's database and slab checked for tampering)
   - Check for undisclosed restoration, trimming, pressing (where the listing said "unpressed"), missing pages or coupons
   - Every book in a collection checked against the listing manifest
4. **Pass:** the Inspection Center ships to the buyer, **insured, signature required**, in protective packaging. **Fail:** the item goes back to the seller and the buyer is **refunded in full automatically**. A partial collection failure gives the buyer a choice: accept the rest with a pro-rated refund, or a full refund.
5. **Delivery to the buyer** is confirmed by the carrier with a signature. The buyer then has a **48-hour review window** (existing SafePurchase rule) to report damage, a wrong item or a material mismatch through Orders, with photos.
6. **Release:** verified delivery + the **48-hour review window** (`SAFEPURCHASE_RELEASE_HOLD_HOURS=48`; the book was already independently inspected) with no open dispute. An open dispute freezes release.
7. **Fee:** inspection fee shown before payment (`SAFEPURCHASE_FEE_CENTS`, default $0 until the operator sets pricing).
8. **Local pickup over the threshold:** allowed only as a hand-off **at the Inspection Center**, or if the buyer explicitly waives SafePurchase on a confirmation screen. A waived order falls back to Standard Protection with pickup-code confirmation.
9. **If the Inspection Center is not configured** (`SAFEPURCHASE_ENABLED` is not true), orders over the threshold still check out with Standard Protection, **plus** insured signature-required shipping and the 72-hour Standard hold. The listing shows "SafePurchase inspection coming soon" and never claims inspection happened.

## 4. Seller protections

- Claims against delivered, tracked orders need evidence (photos) for "not as described".
- "Not received" claims are denied when the carrier shows *Delivered* with signature (SafePurchase) or delivered to the verified address (Standard).
- Returns must arrive in the same condition; the seller may report a switched or damaged return within 3 days of receiving it.
- Abuse (repeat claims, return fraud) → account restriction.

## 5. Money states (what the seller sees)

`Awaiting payment → Paid (held) → Shipped → [SafePurchase: At inspection → Passed] → Delivered → Protection window until <date> → Funds available → Paid out`

Payouts stay disabled until Stripe Connect and carrier tracking are live; the seller still sees the projected "Funds available on <date>".

## 6. Engineering requirements

- Threshold and fees live in server config; checkout snapshots the tier onto the order (later config changes never alter existing orders).
- Every state change goes through `lib/commerce-policy.ts` as a trusted event with an actor (carrier, buyer, seller, inspector, support) and is idempotent.
- Inspector actions (receive, pass, fail with reasons and photos) are owner/operator-only.
- The order progress tracker shows the SafePurchase inspection steps.
- Customer copy never states protection that isn't active for that order.
