# ComicHuddle commerce expansion

Assessment: 9 October 2026. Source opening confirmed by project lead at `006799a0535228c14ef0c85c11fa72c5de407f5d`. This document owns business requirements and release gates; final implementation and test evidence belong to the developer and QA reports.

## Confirmed project decisions

The user identifies **Malik LLC** as the legal operator, **Minnesota, USA** as its location, **USA only** as the initial market, and **maliktecks@gmail.com** as the authorized public support address. Use those exact details in the product and policies. They supersede earlier reports' unknown operator/contact/territory fields. Entity registration, an assumed-name filing, tax registration, auction eligibility and insurance have not been independently verified; none was filed or purchased in this review.

The requested marketplace now covers single comics, selected lots or an entire collection, and auctions. Preserve the approved ComicHuddle identity and six mobile tabs. These formats belong within Marketplace rather than adding another mobile navigation layer.

## Practical product requirements

| Area | Acceptance requirement |
|---|---|
| Single comic | Select an owned copy, exact issue/edition, Raw or graded condition, label/printing where relevant, genuine photos, disclosed defects/restoration, asking price, shipping and seller terms. |
| Collection lot | Freeze the included owned-copy manifest when published. Show copy count, per-copy conditions, representative photos and itemized contents. "Entire collection" means the copies included at that time; later additions are not silently included. |
| Inventory | A copy cannot simultaneously belong to conflicting active single listings, lots or auctions. Withdrawal/expiry releases its reservation; completed sales remove availability. Editing or removing included copies must be handled deliberately and invalidate stale offers. |
| Product card | Separate asking price, opening/current bid and current licensed FMV. State sale format, lot count, valuation coverage and available source/date. A seller's price is not a platform valuation. |
| Auction | Disclose end time/timezone, increments, reserve treatment, withdrawal/retraction rules, shipping, fees and what completion means. Keep private preview bids explicitly nonbinding while real auction operations remain gated. |
| USA scope | Disclose USA-only availability. Before payments, enforce permitted seller/shipping countries server-side and decide which US states/territories are operationally supported. A country label does not establish tax or auction-law clearance. |

### Honest current FMV on cards

Only fresh authorized estimates for the **exact edition/printing, Raw or CGC mode, grade and label** may appear as current FMV. Do not substitute a historical sale, private purchase price, seller estimate, nearby grade or another label. Missing data must show "Current FMV unavailable"; stale data may be shown separately with its date and clear historical/stale label.

For lots, sum current estimates only for covered copies and label the result **"Priced subtotal — X of Y copies covered."** Exclude missing estimates without treating them as zero or extrapolating to the whole lot. Distinguish partially priced from fully priced lots. A fully covered sum is still an estimate of individual copies, not a guarantee of the lot's resale price. A quantity multiplier is permitted only when the manifest actually contains that many identical, equivalently graded copies.

The existing 43-record catalog and 30 historical sale facts support an honestly labeled starter experience. No new commercial data license has been obtained. The existing importer declares rights and excludes stale/expired display rights; that is useful plumbing, not proof that a provider granted a license. Current data must continue to update independently of asking prices; retain a dated snapshot for transaction evidence without labeling it forever current.

## Verified legal rules and their practical implications

The following are official statutory or agency sources accessed on 9 October 2026. Whether Malik LLC's particular operating model falls within an exception is a legal determination, not an assumption made by the software.

| Topic | Verified rule | Project implication |
|---|---|---|
| ComicHuddle assumed name | Minn. Stat. §§333.01–333.02 require an applicable assumed-name certificate before business is conducted under another name and publication in two successive qualified-newspaper issues. The Secretary of State gives the filing/publication procedure. [1–3] | Confirm whether ComicHuddle is already registered as Malik LLC's assumed name; retain filing/publication evidence before commercial operation. A DBA does not establish trademark clearance. |
| Minnesota auction operations | Chapter 330 provides natural-person county licensing, a bond, sale records, auction-ad identification and written owner agreements. §330.06 addresses unlicensed direct/indirect auction sales. §330.01 contains an exception for an owner auctioning property owned at least six months. [4] | The LLC name is not evidence of an auctioneer license. Obtain a documented determination for timed platform auctions, or an eligible licensed operator arrangement. Do not assume an internet exemption or that the owner's six-month exception covers third-party platform operations. |
| Auction sale mechanics | Minn. Stat. §336.2-328 makes each lot a separate sale; completion requires an announcement/customary completion; reserve is the default unless expressly without reserve. A bidder may retract before completion; retraction does not revive a previous bid. Undisclosed seller/agent bids give the buyer remedies. [5] | Support auditable retractions and one server-side completion event. Keep the initial format with reserve, prohibit seller/shill bids, and clearly describe any extension or cancellation policy. These implementation choices require reviewed binding terms before live auctions. |
| Marketplace sales tax | Minnesota Revenue defines a marketplace provider through third-party advertising plus direct/indirect payment processing. A provider maintaining a place of business in Minnesota must register and collect/remit state/local sales taxes, subject to applicable exceptions. [6] | Do not use out-of-state economic-nexus thresholds as a blanket exemption for this Minnesota operator. Determine destination-state obligations before enabling nationwide transactions. |
| Entire-collection tax | Minnesota Revenue's isolated/occasional-sales guidance excludes sales through a marketplace provider from that exemption and distinguishes personal sales, inventory and auction arrangements. [7] | Selling a collection once does not automatically make a marketplace transaction tax-free. Configure taxability with the accountant and actual payment model. |
| High-volume sellers | The FTC's INFORM guidance covers qualifying sellers of new/unused products, generally 200 transactions and $5,000 gross revenue in a continuous 12-month period within the previous 24 months, counting platform-processed transactions. Verification, updating, disclosures and reporting duties can apply. [8] | Monitor relevant seller thresholds and collect/verify/disclose required information through an approved workflow. Do not classify every comic or all merchandise as used to evade this assessment. |
| Shipment promises | The FTC's merchandise-order guide requires a reasonable basis for promised shipment time, or generally 30 days when no time is given; delays need the applicable notice/consent or refund process. [9] | Put realistic handling times on single and lot listings; track late fulfillment and support lawful cancellation/refunds. Auction completion does not prove dispatch or delivery. |

The Revisor currently displays the 2025 codification. Its Chapter 336 page lists 2026 amendments to §§336.7-209 and 336.9-317, not the cited auction section. Current pages for the cited Chapter 330/333 provisions were reviewed; this research does not replace counsel's application to the final operating model or a nationwide auction-law review.

## Auction implementation and QA priorities

These are project design recommendations, separate from the laws above:

1. Use server time and persisted USD integer cents. Reject owner/blocked/unauthorized bidders, insufficient increments, late bids, unavailable copies and duplicate requests. Client clocks and countdowns do not decide acceptance.
2. Keep listing/manifest/terms revisions and append-only bid/retraction history. Recompute eligibility consistently after retractions; do not automatically recreate a withdrawn earlier bid. Test concurrent bids, retraction versus closing, seller withdrawal and duplicated finalization.
3. Define a disclosed end policy: fixed close or a precisely stated extension. Do not change reserve, increments, fees, shipping or included copies after bids without an approved cancellation/relisting process.
4. Separate `ended`, `winner recorded`, `awaiting payment`, `paid`, `shipped`, `delivered`, `refunded` and `disputed`. Failed/unpaid winners need a reviewed timeout and relist policy; no automatic charge or second-chance contract is implied.
5. Gate **binding bidding**, **payment capture** and **payouts** independently. Private nonbinding bid previews can be tested without advertising live public auctions. Do not call a preview winner a paid buyer or claim escrow/guaranteed protection.

## Release and revenue gates

| Release | What this pass can establish | Remaining gate |
|---|---|---|
| Free starter web/PWA beta | Identified operator/contact/USA scope, policy drafts, owned listings/lots, honest valuation availability and private auction previews. | Final security/integrity tests, actual browser/device journeys, operating moderation/support, data recovery and the applicable assumed-name/operational review. Keep payments disabled. |
| Fixed-price single/lot commerce | Reviewable order and inventory design. | Verified processor account and seller onboarding, agreed merchant/fee responsibility, tested checkout/webhooks/refunds/payout reconciliation, tax setup, seller terms and support/dispute operations. |
| Binding public auctions | Tested private preview mechanics. | Auction-law/eligibility determination and required arrangements, reviewed auction contracts/disclosures, cleared seller/destination scope, real notification/finalization and full commerce gates. |
| Current licensed FMV product | Card matching and coverage logic. | Signed web/native redistribution and image rights, authorized samples and exact-edition mapping, contracted refresh and access controls. A paid feed is not required for the honest free starter beta. |
| Native store release | Exportable prototype and coordinated account handoffs. | Production native accounts, signed builds, device QA, reviewed billing/privacy/support/deletion and store review. |

Keep the proposed completed-sale commission as a **price hypothesis**, including for lots/auctions; no fee is active while checkout is unconnected. Start with one plainly disclosed seller commission instead of adding an untested buyer's premium. Calculate revenue on the actual completed item amount, then subtract processor/payout, refund/dispute and support costs. Seller proceeds, shipping and collected tax are not platform revenue. Auction functionality and high collection FMV do not guarantee demand or profit.

Next sequence: complete this engineering/QA pass; confirm the ComicHuddle assumed-name and auction operating route; run invited collector testing; obtain payment/tax setup and licensed data in parallel; then release controlled fixed-price commerce before expanding binding auctions. No public audience setting was changed, no contact was sent, and no filing/purchase was performed by this review.

## Official references

1. https://www.revisor.mn.gov/statutes/cite/333.01
2. https://www.revisor.mn.gov/statutes/cite/333.02
3. https://www.sos.mn.gov/business-liens/business-forms-fees/assumed-namedba/
4. https://www.revisor.mn.gov/statutes/cite/330/full
5. https://www.revisor.mn.gov/statutes/cite/336.2-328
6. https://www.revenue.state.mn.us/sales-tax-marketplace-providers
7. https://www.revenue.state.mn.us/sites/default/files/2023-07/fs132.pdf (agency guidance, revised July 2023)
8. https://www.ftc.gov/business-guidance/resources/INFORMAct
9. https://www.ftc.gov/business-guidance/resources/business-guide-ftcs-mail-internet-or-telephone-order-merchandise-rule

This report describes known requirements and unresolved determinations. It is not a legal-clearance certificate and does not guarantee immunity from claims.
