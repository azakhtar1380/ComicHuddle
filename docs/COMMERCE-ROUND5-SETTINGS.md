# Commerce round 5: settings, migrations and test changes

Branch `launch-v2`. Everything below is applied to the **QA preview and QA database only**. Stripe is in **test mode**.

## Migrations (additive; applied to QA, not production)

Production needs all of these at launch, together with the earlier 030, 032 and 033–042.

| # | File | What it adds |
|---|------|--------------|
| 043 | `043_pending_listings.sql` | Trigger: a paid listing stays **Pending** until its order is delivered or picked up, then becomes **Sold**. A refunded order hands the listing back to the seller. |
| 044 | `044_calculated_shipping.sql` | `listings.shipping_calculated` (live carrier rates). |
| 045 | `045_listing_package.sql` | Optional package `weight_oz`, `length_in`, `width_in`, `height_in`. |
| 046 | `046_seller_payouts.sql` | `seller_payouts`: bank payouts and `payout.*` events. |
| 047 | `047_support_payments.sql` | `support_payments`: Support ComicHuddle payments. |

## Settings (Vercel environment variables)

| Setting | Where | Value / note |
|---|---|---|
| `EASYPOST_API_KEY` | preview ✓ / production ✗ | Preview uses a **test** key, so rates are realistic and labels are free test labels. Production needs the **live** key, and you pay for live labels. |
| `CRON_SECRET` | preview ✓ / production ? | Protects `/api/cron/commerce`. Vercel runs scheduled jobs on **production deployments only**. |
| `COMMERCE_LISTING_REQUIRES_PAYOUTS` | **new**, not set | Set to `true` to block publishing until the seller's Stripe payouts are verified. Turn it on once sellers can finish onboarding. |
| `COMMERCE_PAYOUTS_ENABLED` | not set (off) | When `true`, the daily job releases transfers after the review window and makes the manual payouts for new sellers. |
| `COMICHUDDLE_ADMIN_EMAILS` | preview ✓ | Your account. Production needs it too. |
| `METRON_COVER_CDN_BASE` | preview, **remove it** | Leftover from the paused cover import, so the enrichment job stops trying. Claude's attempt to remove it was blocked by a permission prompt. Run `vercel env rm METRON_COVER_CDN_BASE preview`. |

**Stripe dashboard (test mode).**
- Add `payout.paid`, `payout.failed`, `payout.canceled` and `payout.updated` to the **Connect** webhook endpoint. They come from sellers' connected accounts.
- `checkout.session.completed`, `checkout.session.expired` and `charge.refunded` must stay on the platform endpoint. Support payments use them.
- Claude didn't change any Stripe settings.

**Vercel plan.** Hobby only allows **daily** scheduled jobs, so `/api/cron/commerce` runs once a day at 06:15 UTC. Pro would allow hourly runs.

## Product rules now in code

**Pending and Sold**
- Shipping orders show Pending after payment and become Sold on carrier delivery.
- Pickup orders show Pending and become Sold when the PIN is entered.
- A refund before delivery hands the listing back to the seller to relist.

**Pickup PIN**
- 6 digits plus a QR code, shown only to the buyer and stored as a hash.
- 5 wrong tries per order.
- Unused after 7 days: full refund, and the listing goes back to the seller.
- The buyer's "I picked it up" button stays as a backup.
- SafePurchase handoffs use an admin-entered PIN.

**Mark as Sold** is for outside (cash) sales on pickup and "Both" listings only. It's refused on shipping-only listings and on any listing with an open order, in the API too.

**Release timing**
- Shipped orders: 3 days after verified delivery. SafePurchase keeps its own 48-hour window, because the comic was already inspected.
- PIN pickups: right away.
- Buyer's backup pickup button: 24 hours.

**Seller tiers**
- New sellers: manual bank payout 7 days after delivery or pickup.
- Five or more completed, problem-free orders: daily automatic payouts.
- Any dispute or claim drops a seller back to new. The tier is shown in Orders and Wallet.

**Failed payouts**
- `payout.failed` notifies the seller once.
- The problem shows in Orders and Wallet until a later payout succeeds.

**Refund after the seller was paid**
- The transfer is reversed first.
- If Stripe refuses the reversal, the order is held for manual review and nothing is refunded.

**Shipping**
- Sellers choose calculated or free shipping. Calculated means live USPS, UPS or FedEx rates; the server quotes again at checkout and freezes the rate into the order.
- In-app EasyPost labels: the cost comes out of the seller's payout, and tracking is added automatically.

**Order progress bar**
- Shipped: Paid → Label created → Shipped → Out for delivery → Delivered. Pickup: Paid → Ready for pickup → Picked up.
- Tracking only moves forward.
- Shows the scan history and the estimated delivery date.
- Problems are amber (delay or failed attempt) or red (returned to sender or lost).
- A PIN expiry warning appears when 24 hours or less remain.

**Auctions and offers**
- A bid in the last 2 minutes extends the end by 2 minutes.
- Offers are saved as EXPIRED after 48 hours, and so are accepted offers left unpaid.

**Support ComicHuddle**
- One-time payment of $5, $10, $25, or a custom $1–$500.
- Goes to the platform account: not Connect, no seller, no fee split.
- Confirmed only by the signed webhook. Never wallet balance, points or credit.
- Owner view on `/admin`; receipts in Orders.

## Not built yet (needs your decision)

**Saved card before bidding, and charging the winner automatically.** This needs:
- a saved shipping address as well as a card, because a shipped auction can't be charged without knowing where it ships;
- a second way to create paid orders, alongside Checkout.

Proposed plan:
1. A "Save card and address" step using Stripe Checkout in setup mode, plus our own address form.
2. When an auction closes, create the order with the winner's saved address and an off-session PaymentIntent.
3. If that fails or needs authentication, notify the winner and fall back to the existing 48-hour payment window.

Until then, winners pay within 48 hours, as today.

## Payment test sheet: rows that changed

| Area | Old expectation | New expectation |
|---|---|---|
| Pickup checkout | Funds released 72h after PIN | Released **right after** the PIN; buyer backup button → 24h |
| Pickup listing after payment | Sold | **Pending**, then Sold after the PIN |
| Shipping listing after payment | Sold | **Pending**, then Sold on carrier delivery |
| Shipped order release | Delivery + 48h | Delivery + **72h** (SafePurchase still 48h) |
| Mark as Sold on a shipping-only listing | Allowed | **Refused** (409) |
| Mark as Sold on a listing with a paid order | Allowed through the platform option | **Refused**; finish through the order (PIN or delivery) |
| Seller shipping price | Seller typed an amount | Seller picks **Calculated** or **Free**; buyer picks a carrier rate at checkout |
| Seller label | Seller entered tracking by hand | Can **buy a label in the order**; cost deducted from earnings |
| Late tracking webhook | Could overwrite status | **Never moves backward** |
| Offers | Shown as expired | Also **saved** as EXPIRED by the daily job |
| Auction last-minute bid | Fixed end | **+2 minutes** |
| Support ComicHuddle | n/a | New rows: $1 minimum and $500 maximum refused outside that range, Stripe test checkout, paid only after the webhook, receipt in Orders, owner view |
| Payout failed | n/a | Seller notified once; alert in Orders and Wallet |
| Refund after transfer, reversal refused | n/a | Order held for manual review; **no refund** issued |
