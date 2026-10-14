# ComicHuddle data-access decision

Reviewed 9 October 2026 against recovered source `b2c5a0d9eb77cbdfe700a4ce0f0d6df6836388bf` and current official provider pages. Operator: Malik LLC, Minnesota, USA-only launch; authorized public support: maliktecks@gmail.com. This review changes only this decision document. No provider was contacted, account purchased, private endpoint examined or data copied into the app.

## Decision

**Do not treat a Key Collector subscription as ComicHuddle's data license.** A negotiated written agreement may make a partnership possible, but no public commercial feed/documentation or applicable permission was confirmed. Its documented consumer product does not establish complete-issue coverage or a numeric-grade Raw/CGC feed. Ask about a commercial relationship; do not scrape its website/mobile traffic or promise its data before agreement. [1, 2]

Continue the comic chooser using the project's attributed starter records and authorized images while procurement proceeds. Keep bibliography, editorial key information, cover rights and valuation as separate licensed capabilities. Use stable edition identifiers and provider-neutral adapters so one provider's gaps or contract changes do not force accounts, collections or listings to be rebuilt.

## What the official sources actually establish

| Provider | Verified fact | What remains unconfirmed |
|---|---|---|
| Key Collector | Its FAQ says the database selectively includes significant issues/variants and is not every comic. Its guide is an acquisition tool based on ungraded sales, with LOW/MID/HIGH condition ranges. Terms require prior written permission for reuse in another database, redistribution or scraping; artwork can have third-party rights. [1, 2] | Whether it will offer Malik LLC a commercial API/export/partnership; exact catalog size/coverage; extra numeric Raw/CGC products; modern-cover sublicensing; supported territories/devices; quotas, refresh, fee and term. |
| GoCollect | The Enterprise tier explicitly advertises customized API access and custom pricing. Its pricing FAQ describes professionally graded collectible FMV. Consumer terms require written consent for commercial exploitation. [3, 4] | Which raw conditions, CGC labels, variants/printings and unpriced records are included in the proposed feed; exact API schema/refresh; outbound public and paid web/native rights; image licenses and quote. |
| CovrPrice | Its own FAQ describes raw and slabbed sales/value information. Official CLZ documentation confirms an existing integration partnership. Its public display can fall back to a most-common condition when the selected condition has no data. [6, 7] | A ComicHuddle-specific API/license offer, price and export/display permissions; exact-grade/label coverage and fallback flags; cover rights. CLZ's consumer add-on is not our redistribution agreement. |

**Important API distinction:** GoCollect's public Data Sharing page describes uploading/contributing seller sales through CSV/API. That is not evidence that the same API grants an outbound valuation feed. The verified outbound commercial inquiry route is Enterprise on its Pricing page. [3, 5]

No commercial quote, authorization, service credential, complete catalog license or modern-cover license has been obtained. Consumer subscription prices are not used as platform-license estimates. Failure to find public API documentation does not prove that a provider has no private API or partnership program.

## Raw versus CGC: preserve the meaning

Key Collector's FAQ describes averaging up to ten secondary-market ungraded transactions within a month, then reducing the amount about 10–15% into acquisition ranges. LOW/MID/HIGH are explicitly not numeric grades. Present any future licensed version as its own acquisition guidance; do not convert HIGH into Raw 9.8 or CGC 9.8, or relabel it an exact-grade FMV. [2]

For ComicHuddle's requested FMV, the record needs an exact edition/variant/printing, raw condition or certified grading company/grade, label class, currency, source, valuation timestamp, methodology and licensed display rights. Raw condition is a seller/collector assessment unless an actual independent assessment is documented. A CGC grade refers to the certified copy, not an inferred grade for an ungraded book.

CovrPrice's FAQ explicitly treats raw grades from seller listings as subjective. Its condition fallback must remain labeled as a fallback; it cannot be passed into the app as an exact matching estimate. The CLZ documentation also identifies missing-sale and edition-linking gaps and limitations for trade paperbacks and signed-comic values. Require an updated sample for these categories before promising them. [6, 7]

The existing `lib/market-data.ts` importer accepts numeric grades, Raw/CGC mode, specified label classes, first/later printing, a range, sale count/window, source and timestamp. It does not represent Key Collector condition buckets. Do not invent grades, sale counts, ranges or timestamps to satisfy that schema. A licensed source with different fields needs a reviewed adapter/schema change that preserves its actual semantics.

The current 30-day freshness rule is an application choice, not evidence that every vendor updates daily. Contracted frequency, liquidity and provider "as of" timestamps must determine honest current/stale labels. An individual dated sale remains a sale fact, not an FMV estimate.

## Reviewable procurement request

Use Key Collector's official **Contact Us** link in the FAQ footer to ask whether it licenses data to third-party platforms. The retrieved email links were masked and the footer link could not be resolved by the research tool; no recipient address is guessed. Use GoCollect's Enterprise/contact-sales form on its Pricing page. CovrPrice publishes a Contact Us page. None has been submitted. [1–3, 8]

Request a written proposal for Malik LLC's USA web, mobile web/PWA, iOS and Android platform, with free and future paid features:

1. **Rights:** metadata, original editorial/key notes, condition/grade values and cover art separately; display to non-subscribers/subscribers; attribution; permitted aggregation, alerts and collection exports; caching, native/offline use, resizing and geographic restrictions.
2. **Coverage sample:** common non-key issues, modern and vintage keys, newsstand/direct variants, later printings, CGC Universal and other label classes, raw grades/buckets, signed/restored/conserved copies and records with no recent sales. Include stable vendor IDs and exact edition crosswalks.
3. **Value semantics:** purchase/acquisition guidance versus FMV versus sale average; actual condition/grade and fallback indicator; buyer's premiums, currencies, outlier handling, sample size, sale window, value date and confidence. Do not promise every field until the provider confirms it exists.
4. **Image authority:** whether the vendor can sublicense each modern cover for our public/paid/native display, including its territories, transforms and retention. Possessing a URL or viewing an archived auction photo is not a rights grant.
5. **Operations and cost:** signed API documentation/sample payload, authentication, pagination, limits, bulk/delta delivery, permitted refresh, service support, commercial quote/minimum term and deletion/expiry behavior. Keep credentials server-side.

Recommended comparison: ask Key Collector about licensed key/editorial/acquisition data, GoCollect Enterprise about graded FMV and CovrPrice about numeric raw plus slabbed values. Choose a sole supplier only if its sample and agreement cover the requested capabilities; otherwise combine permitted capabilities. This is a procurement recommendation, not a claim that any provider will agree.

## Chooser and data acceptance criteria

The requested database chooser should return matching **issues/editions**, not merely a title string. Each result should include stable internal ID, series/issue/year/publisher, edition/variant, relevant details and an authorized bounded thumbnail. Search needs debounce, pagination, no-results/error states and keyboard/touch selection; account record links must retain their original issue IDs. Missing licensed images use metadata artwork or an explicit image-unavailable state.

Before importing a supplier sample, QA must demonstrate:

- Duplicate series names, issue numbers, printings and variants select the intended edition; legacy saved records still resolve.
- Current Raw values never appear as CGC values; labels and conditions are not silently substituted. Bucket guidance and generic/fallback estimates retain distinct labels.
- Empty, stale, expired-rights, unpriced and provider-error responses are handled without fictional numbers. Unknown values are not zero.
- Single listings, auctions and collection lots separate seller ask/current bid from valuation. Lots show the priced-copy subtotal and X/Y coverage, not an extrapolated total.
- Imported prices match the provider sample, attribution remains visible, private license references and service keys stay private, and expired permission removes display according to the contract.
- Catalog/valuation failures do not erase the collector's owned records or interrupt unrelated private messages/care evidence.

These are data acceptance requirements. This analyst review did not run collector/presser/auction/fixed-price browser or device E2E sessions; the independent QA/developer reports must state what they actually tested. Passing a chooser test cannot establish payment readiness, a complete catalog, permission to reuse provider data or public binding-auction clearance.

## Official source record

All retrieved on 9 October 2026; only provider-owned pages and official partner documentation support the facts above.

| Ref | Exact source | Use |
|---|---|---|
| 1 | https://www.keycollectorcomics.com/terms | §§7.2.3, 7.2.9, 7.4 and 7.6: database/content restrictions, written permission and separate image rights. |
| 2 | https://www.keycollectorcomics.com/frequently-asked-questions/ | Selective issue/variant coverage and ungraded acquisition-range methodology; footer contact route. |
| 3 | https://gocollect.com/pricing/ | Enterprise customized API/custom pricing, professionally graded guide description and sales inquiry. |
| 4 | https://gocollect.com/terms-of-service | Written commercial permission and access/copying restrictions. |
| 5 | https://gocollect.com/data-sharing | Inbound seller-sales contribution CSV/API, not an assumed outbound price license. |
| 6 | https://covrprice.com/faq/ | Raw/slabbed values, subjective raw grades and most-common-condition fallback. |
| 7 | https://club.clz.com/t/faq-about-getting-values-from-covrprice/10422 | Official partner integration, mapping/missing-value and category limitations. Its quoted subscription is for CLZ consumers, not a ComicHuddle commercial quote. |
| 8 | https://covrprice.com/contact-us/ | Official inquiry route. |

Unknown supplier terms must be resolved by a documented agreement and an authorized sample. Nothing in this decision authorizes scraping, provider outreach, spending or a public audience change.
