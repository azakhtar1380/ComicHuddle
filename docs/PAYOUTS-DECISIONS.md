# Seller payouts: decisions for the owner (round 4, 2026-11-15)

Today: sellers connect a bank once from **Wallet → Bank payouts** ("Connect bank"), which opens Stripe's hosted
Connect onboarding (`seller_onboard` → `lib/stripe-connect-v2.ts`). ComicHuddle never sees or stores bank
numbers. Wallet shows **Pending** (paid, waiting on delivery, SafePurchase or the pickup code) and **Ready to pay
out** (review window over) from the seller's real orders. Everything below uses Stripe's defaults until you decide.

## How money moves (current code)
1. Buyer pays the platform (separate charges and transfers).
2. After delivery + the protection window, an admin/owner releases the order: a Stripe **transfer** of the
   seller's net to their connected account (`commerceOwnerRelease`). This is **off** until `COMMERCE_PAYOUTS_ENABLED=true`.
3. Stripe pays the connected account's balance out to the seller's bank on the account's **payout schedule**.

## Why "Pay out now" is disabled
- Seller accounts are Accounts v2 **recipient** accounts (Express dashboard, `stripe_transfers` capability). Bank
  payouts follow Stripe's automatic schedule. ComicHuddle has not set up platform-controlled (manual) payouts or
  Instant Payouts, and those were not verified in test mode, so the button stays disabled with a reason instead
  of pretending. Transfers themselves are also off (`COMMERCE_PAYOUTS_ENABLED`).
- To enable it later you'd need: manual payout schedule on connected accounts (or Instant Payouts eligibility,
  which needs a debit card / eligible bank and has a fee), an API route that creates a payout on the connected
  account, and tests against the Stripe sandbox.

## Decide
| Decision | Stripe default (current) | Options |
|---|---|---|
| Payout schedule | Stripe's automatic schedule for the account (typically daily rolling, a few business days after funds become available in the US) | daily / weekly / monthly / manual |
| When to transfer to the seller | Owner/admin release after delivery + 72 h (Standard) or 48 h (SafePurchase) | automatic release via a scheduled job once eligible |
| Minimum payout | none set by ComicHuddle | e.g. $10 minimum, hold below |
| Who pays Stripe payout fees | platform is fees collector (`fees_collector: application`) | pass to seller, or absorb |
| Instant payouts ("Pay out now") | not offered | offer with a fee (e.g. 1–1.5%), or not at all |
| Negative balances / losses after a refund | platform is losses collector (`losses_collector: application`) | reverse transfers (already implemented before refunds after release), recover from future payouts |
| Marketplace fee | `COMMERCE_PLATFORM_FEE_BPS` etc. (lib/commerce-fees.ts) | confirm the rate (see memory: "confirm fee rate") |

## Before switching payouts on
- Live Stripe keys + review (docs/PAYMENTS-SETUP.md), carrier tracking live (EasyPost), migrations applied.
- One real low-value order paid, delivered (carrier-confirmed), released, and seen arriving in a real bank account.
- Then set `COMMERCE_PAYOUTS_ENABLED=true`.
