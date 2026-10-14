# ComicHuddle marketplace release — 9 October 2026

This expansion adds single-comic listings, whole-collection or selected collection lots, product-card valuation coverage and persisted nonbinding auction previews. The website remains owner-private. The existing comic theme, letter mark and six mobile bottom tabs are preserved; all sale formats live within Marketplace.

## Founder-supplied operating details

- Operator: **Malik LLC**, Minnesota, United States.
- Public support, privacy and content contact: **maliktecks@gmail.com**.
- First launch scope: **United States only**, adults 18+ and domestic listings/shipping.

The contact appears in the web rules, footer and marketplace, and in the native prototype. No residential address or unrelated filing email is published. These details are supplied by the founder; company status, brand filings, mailbox staffing, tax registration and auction eligibility were not independently verified. USA eligibility is self-declared in profile/listing consent; payment onboarding and shipping-country enforcement must precede real commerce.

## Seller and buyer experience

From Marketplace, choose Sell a comic, Sell a collection or Start an auction. Select one owned copy, the entire existing collection, or a smaller lot. Collection listings support up to the vault's 1,000-copy limit with paginated selection and condition editing. Add genuine owned photos, disclose defects/restoration and choose fixed price or auction independently of whether the inventory is one comic or a collection.

Publishing freezes a safe included-copy manifest. Buyers can inspect every included copy with paginated contents, grade/label/printing information and matching value sources. Later edits to the seller's private vault do not change the published lot or break its authorized item-photo access. Private acquisition costs and license references are excluded. A physical copy cannot be reserved by overlapping active singles, lots or auctions; conflicting publication is rejected atomically.

Every product card separates asking/opening/current bid from current FMV. A full total requires a current authorized match for every physical copy. Partial coverage shows **Priced FMV subtotal**, the priced-copy count and **full total unknown**. No coverage shows **Unavailable**, never a fabricated zero or estimated total. Historical sales, private purchase costs and adjacent grades/labels do not fill gaps. Current value refresh failure clears cached per-copy estimates and masks the aggregate while unavailable.

Fixed-price buyers can message the seller and offer for the complete listing. The purchase summary exposes that checkout is disconnected; the server cannot create a paid order. Readonly design examples have fictional asking prices, explicit example labels, unavailable FMV and disabled purchase/bid actions. They are not real inventory or live sales.

## Auction preview behavior

Auctions use persisted USD integer cents, a server-controlled end time and disclosed minimum increments. A bid requires an actual nonbinding-consent checkbox. The server rejects self bids, blocked/hidden/restricted participation, insufficient bids, fractional cents and late submissions. Bid request IDs make retries idempotent; competing bids use an atomic ledger/version check rather than trusting the countdown.

The bidder's own private receipt supports retraction before cutoff. Retraction never silently promotes a prior proposal. Sellers can withdraw before accepted bid history; after any accepted proposal they must contact support for owner cancellation. The owner support screen is Account > Settings > Auction previews. It can look up an exact older/hidden listing ID or show the latest 100 records, then cancel with confirmation, release reservations and annul active proposals while keeping audit history.

Expiry ends the nonbinding preview without charging, shipping or creating an order. Ended inventory is released lazily when its seller publishes a replacement. A seller with accepted preview history requires owner cancellation before account deletion. Bidders must retract still-open proposals; closed/cancelled history is anonymized on bidder deletion, with private identity and request receipts removed. Both publication and deletion recheck critical state transactionally so a concurrent change cannot silently drop inventory or a newly accepted proposal.

## Verification and publication

`checks/marketplace-smoke.mjs` executes actual route code against isolated SQLite/D1-style and R2 fixtures, plus actual client valuation/countdown helpers. It covers 1,000-copy payloads, exact and partial licensed fixtures, expiry, ownership/photo privacy, duplicate inventory, simultaneous proposals, idempotency, cutoffs, retraction, cancellation, own-only exports, account deletion and owner support permissions. QA-COMMERCE.md contains the final group count and independent findings.

The preexisting 34 backend negative and 26 client response-order groups pass, as do broad network, private-cache and dialog checks. Dense prepared-query counts are social 23/40, Workshop 20/40 and private care detail 6/10. Web and native TypeScript pass. The native prototype passes seven viewport image-bound checks, and its Expo web/iOS/Android exports succeed. Its Marketplace cards have bounded covers and explicit example states; real account/listing/bidding actions hand off to the website.

Source publication performs a production web build before committing/pushing and packaging. The updated launch kit records the exact published commit and deployment result. The repaired, unapplied migration 0006_marketplace_preview.sql adds listing snapshots/reservations, bid/retraction history and a named CHECK guard table through 24 schema-only statements; it contains no triggers or data backfills. Validation, each coupled write and guard cleanup share an atomic D1 batch. Local fixtures apply the migration by breakpoints, physical lines and plain semicolons; prior applied migrations0–5 are unchanged. Legacy conversion is separate: bounded seller-owned initialization plus atomic protection against uninitialized overlapping copies. Hosted identity, customer journeys, load/recovery and real browser/device checks remain open; the final publication record documents migration deployment verification separately.

## Remaining commercial gates

1. **Payments and seller operations:** supported onboarding, server-authoritative orders, payment/webhook reconciliation, refunds/disputes/payouts, country/address enforcement and tax/accounting setup.
2. **Binding auctions:** determine the applicable operating/licensing arrangements and reviewed terms for the actual platform and offered destinations. Preview bids create no purchase commitment. See the official-source analysis in BUSINESS-COMMERCE.md.
3. **Complete current FMV and covers:** signed commercial web/native redistribution and image rights, authorized provider samples, exact-edition mapping and contractual refresh. Test fixture valuations are not deployed as real provider data.
4. **Wider audience:** final applicable policies/retention, brand operating requirements, verified support/moderation ownership, hosted recovery/incident rehearsal and actual browser/device testing.
5. **Native stores:** production native accounts, signed operator-owned builds, hardware/review checks and the previously identified unresolved braces/node-forge build-tool advisories.

No provider message, filing, purchase or public-access change was performed. A successful build or automated suite is not legal clearance, complete security certification, proof of production capacity or a guarantee of profit.
