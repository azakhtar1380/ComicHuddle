# ComicHuddle independent valuation method

Checked: 2026-10-09. Prototype method version: `comichuddle-research-1`, matching `FMV_MODEL_VERSION` in `lib/fmv-model.ts`.

This is an original research prototype for estimating the typical recent **item-only sale price** of an exactly identified comic. It does not supply live prices, license an external database, certify a comic's condition, or establish a statistically calibrated appraisal. The module fetches no data and is not connected to the public price guide. Its gates are prerequisites for a future production estimator; public enablement additionally needs the validation and operational work below. An issue with insufficient evidence must remain unpriced.

## Current access and permission findings

| Source | Verified position | Consequence for ComicHuddle |
| --- | --- | --- |
| eBay Marketplace Insights | eBay's current marketplace-support documentation says it is restricted and closed to new users. The overview redirects to private documentation sign-in. [1, 2] | A new developer account or ordinary API key does not unlock a completed-sales feed. Do not promise an immediately available integration. |
| eBay Product Research, formerly Terapeak | Official help describes three years of sales, actual accepted Best Offer prices, and shipping metrics. Ordinary completed-listing search covers the recent 90 days. [3] | A seller may use the research UI within its terms; that access is not a public redistribution or automated collection license. A crossed-out asking price is not proof of the accepted transaction amount. |
| Automated eBay collection | The User Agreement requires prior express permission for scraping and other automated gathering. [4] | Do not scrape public sold pages or the signed-in research UI, employ proxy scraping services, or use browser automation as an alternative feed. |
| Commercial derivative eBay pricing | API terms §8.5.3 require express written consent for Restricted API data in pricing tools and grant eBay broad rights in approved enhanced tools/outputs. §§8.1.4 and 9 add derivation, competitive-use and commercialization limits. [5] | Obtain an agreement covering this particular estimator, competing marketplace, collection, storage, derivation and public display. A key, affiliate enrollment, or seller consent alone does not establish those rights. |
| Key Collector | Its FAQ describes raw acquisition guidance: average up to ten ungraded transactions within one month, then reduce roughly 10–15%; LOW/MID/HIGH are not professional numeric grades. Its current directory separately advertises subscriber Graded Pricing. [6, 7] | Do not treat raw buying guidance as CGC-grade FMV or claim Key Collector has no graded product. Our estimator applies no buying discount. |
| Key Collector content | Terms §§7.4–7.6 prohibit unauthorized copying, scraping, republishing and incorporating content into another database; artwork can also belong to publishers. [8] | Research its product concept, but do not import its records, values, annotations, images, logos, or proprietary feed. |

The official eBay deprecation table lists all Finding API methods as replaced in February 2025. Its replacement is not evidence of a new unrestricted completed-sales endpoint. [9] Provider approval cannot be inferred from documentation availability.

These are access and contract findings, not a guarantee that a future agreement will be approved or a legal opinion about every jurisdiction. No account sign-in, sales-page scraping, vendor contact, purchase, production feed, or redistribution was performed for this report.

## Lawful evidence paths

1. **First-party marketplace transactions:** once real checkout exists, use separately consented, anonymized completed orders with verified settlement, delivery and refund status. The preview's sample listings or simulated orders cannot count.
2. **Dealers' original transaction ledgers:** a written contributor agreement must authorize lawful collection, storage, valuation derivation and public aggregate display. Require original business records plus evidence of actual consideration; avoid copying a third party's database or app export. Data obtained through a restricted API retains its restrictions even if a dealer uploads it.
3. **Collector transaction attestations:** optional evidence from the person's own sale or purchase, with a source-rights review and private proof. An unsupported assertion stays unverified and outside the estimate. Redact buyer identities, addresses, payment details and irrelevant receipt content.
4. **Negotiated external feeds:** provider agreements must expressly cover commercial derivative valuations, public output, permitted combinations, retention/deletion, attribution, rate limits and marketplace use. Agreement terms may restrict what is displayed even when an estimate passes statistical rules. See [PAYMENTS-AND-DATA-NEXT-STEPS.md](PAYMENTS-AND-DATA-NEXT-STEPS.md).

GoCollect explicitly offers custom-priced Enterprise API access and integrations; this is a concrete procurement path, not a free/public license. [10] Its separate data-sharing API page concerns contributing sales records to GoCollect and requires approved access. It does not establish permission to extract and redistribute its FMV guide. [12]

Record a documented source grant, its scope, applicable record dates and revocation/expiry. The prototype requires all three flags: `permittedCollection`, `derivativeValuation`, and `publicDisplay`, plus an evidence reference and a grant active at the calculation time. A boolean records a reviewed grant; setting it does not create legal permission. The ingestion process must verify record-date and use scope before constructing records. Conflicting definitions of one grant ID fail closed. External API content, collector ledger evidence and ComicHuddle transactions must retain their original provenance.

## Exact comparable identity

Every record belongs to one canonical tuple:

`comicId + editionId + variantId + printingId + mode + gradingCompany + grade + label + attributesKey`

The canonical comic/edition identifiers must distinguish series volume, publisher, issue number, language, facsimile/reprint, print date, format and relevant direct/newsstand/price variants. Format distinguishes original single issue from trade paperback, omnibus and reproduction. The implemented modes are **Raw** (`gradingCompany: None`, `label: Raw`) and **CGC** with recognized label types. Other graders require a separately implemented future mode and never enter either pool. The accepted numeric grade key must match exactly. For Raw it records verified condition comparability, never a certified grade; LOW/MID/HIGH and unknown conditions are not converted into numeric grades.

Universal, Signature Series, Qualified, Restored and other label types remain separate. Signature identity/authentication, sketches, restoration extent, page quality, pedigree, completeness and exceptional provenance can materially affect comparability. The required canonical `attributesKey` must identify these traits for exact matching, including an explicit standard/no-premium tier. If intake cannot establish the attributes, exclude that record from v1 rather than pool it silently. An ambiguous title or unconfirmed variant cannot be resolved solely by keywords. Unknown or missing tuple fields fail validation.

Do not interpolate a missing 9.6 value from 9.8, apply a constant raw-to-slab multiplier, or silently substitute a different variant or label.

## Sale eligibility and amount basis

Only verified, settled, single-comic, arm's-length transactions denominated in USD enter v1. Require the actual accepted price and sale/settlement timestamps, exact identity, unique transaction ID, seller identity suitable for private deduplication, provenance and active grant. Intake must confirm `comparabilityVerified` and `sellerIndependenceVerified`; an arithmetic function cannot verify condition, authenticity or independence. A seller identity represents an independent economic entity, not merely a different username. Dates use strict ISO UTC and a trusted caller-supplied calculation clock. Reject future/impossible dates, settlement before sale, invalid/nonpositive amounts, fractions below a cent and unverified evidence.

Exclude active asking prices, unsold auctions, canceled orders, unpaid wins, refunds/chargebacks, trades or store credit, giveaways, bundles/lots, unknown accepted offers, related-party/self-dealing transactions and demo records. A sale badge or ended listing alone does not prove settlement. Deduplicate the same underlying transaction across submissions and sources. Conflicting economic records using one transaction ID are rejected together. A legitimately resold certified comic is a distinct transaction; tracking repeated physical copies remains an ingestion diagnostic beyond this pure estimator.

The primary amount is consideration for the comic **before tax and excluding separately identified shipping and buyer's premium**. Seller commissions and payment-processing deductions affect net proceeds, so never subtract them from the market observation. Store the components separately. If only an auction's premium-inclusive total is known, retain it as a reported historical result, not as an item-only v1 observation. Do not guess a premium or shipping split. Free shipping remains embedded in the price and must be disclosed in the observation's terms; comparisons should be checked for differing delivery costs during calibration. Foreign-currency conversion and premium-inclusive estimates require a separately versioned future method.

## Chosen v1 estimator

The companion implementation is `lib/fmv-model.ts`; tests use synthetic records, not a provider's copied transactions.

1. Apply the source-rights, exact-identity, verification, settlement and amount gates above. Keep observations with sale ages from 0 through 90 days at the specified UTC calculation time.
2. With at least nine eligible rows, compute the unweighted median of log prices and their median absolute deviation, MAD. Flag prices farther than `3 × 1.4826 × MAD` from that log median. With MAD at most `1e-12` or fewer than nine rows, flag none. The prototype omits flagged observations from its estimator but retains their identifiers and reasons for review; a statistical flag is not proof of fraud.
3. For each retained sale, use recency weight `w = 2^(-ageDays / 30)`. This gives a 30-day half-life and does not forecast a price increase.
4. Sort prices ascending. The weighted p-quantile is the first observed price whose cumulative weight reaches `p × totalWeight`; no interpolation between observations. Use p = 0.50 for the candidate median and p = 0.25 / 0.75 for the observed middle-price range.
5. Recheck all availability gates **after** outlier exclusion: at least five retained sales, at least three verified independent sellers, newest sale no older than 30 days, and no seller contributing more than 40% of aggregate recency weight. If any gate fails, return no point estimate or quartile range and explain the reason. Passing these arithmetic gates still produces a result explicitly marked `researchOnly: true` and `calibrated: false`.
6. Expose effective sample size `(sum w)^2 / sum(w^2)` as an evidence diagnostic. A stronger-support label additionally requires at least 15 retained sales, five sellers, newest sale within 14 days, effective sample size at least 10, observed IQR divided by median no greater than 0.5, and maximum seller weight no greater than 30%.

All cutoffs are **proposed, uncalibrated product rules**. The 40% concentration limit deliberately prevents a small number of sellers from controlling the estimate. Neither seller counts nor outlier removal guarantees independence or fraud prevention. The weighted 25th–75th observation range describes retained sales; it is not a confidence interval, prediction interval, or guaranteed selling-price range. Do not label stronger support as a percentage probability or accuracy claim.

The raw buying margin described by Key Collector is not part of this algorithm. This is an independently specified weighted-median observation model, not a reconstruction of Key Collector, GoCollect, CovrPrice or GPA's proprietary methodology.

## Freshness, history and collector-facing output

Display the exact identity/grade/label, USD price basis, calculation time, newest sale time, observation window, retained sample size, unique seller count, flagged count, effective sample size, support label and method version alongside an eligible estimate. Exclusion reasons and permission status should be inspectable without exposing private evidence or participant information.

Recompute daily and when settlement, refund, identity, evidence or grant status changes. A daily recomputation cannot make old transactions fresh. Suspend display immediately if a grant is revoked; age out stale evidence automatically. When a gate fails, show **Insufficient comparable sales**, **Sparse evidence**, **Seller concentration**, or **Awaiting permitted data** as appropriate, without a numeric FMV fallback.

Keep three different concepts visible:

| Display | Meaning |
| --- | --- |
| Independent recent sale estimate | Permission-cleared v1 estimate passing support gates, with current calculation and underlying-sale dates. |
| Reported historical sale | A dated, attributable transaction result with its actual grade, source and premium/shipping basis. It cannot fill a current FMV cell automatically. |
| External guide / CGC information | Separately attributed licensed guide value or certification/census information. A CGC grade, population count or news result is not an official CGC price forecast. |

If licensed later, GoCollect's own guide estimates remain branded external values rather than being renamed as ComicHuddle's model. GoCollect describes its guide as FMV for professionally graded collectibles. [10] Our historical CGC news records also retain their original fee basis; CGC's auction reports can include buyer premiums. [11]

Use **recent estimate**, not “live value,” unless an actual continuously maintained permitted feed and freshness service exist. Search coverage and pricing coverage must be separately reported; an extensive metadata directory does not imply extensive current valuations.

## Validation before production claims

Prototype checks establish deterministic calculations and guard behavior. They do not establish pricing accuracy. Before enabling public valuations, backtest prospectively using only observations available at each historical cutoff; separate later settled sales as the evaluation set. Measure median absolute/log errors and directional bias by age, price band, raw/slab, grade, publisher, label and sales frequency. Review coverage, high-volatility periods, multiple-source/seller dependence, free-shipping treatment, manipulation, outlier exclusions, refund lag and revoked-source removal. Publish limitations and choose revised thresholds before making confidence or accuracy claims. Retain versioned methodology and reproducible audit records.

## Primary sources checked on 2026-10-09

1. eBay Buy API Support by Marketplace, restriction note: https://developer.ebay.com/api-docs/buy/static/ref-marketplace-supported.html
2. eBay Marketplace Insights overview, redirects to private-doc sign-in: https://developer.ebay.com/api-docs/buy/marketplace-insights/overview.html
3. eBay Product Research help, access and completed-search comparison: https://www.ebay.com/help/selling/selling-tools/product-research?id=4853
4. eBay User Agreement, Using eBay: https://www.ebay.com/help/policies/member-behavior-policies/user-agreement?id=4259
5. eBay API License Agreement, §§8.1.4, 8.5.3, 9: https://developer.ebay.com/join/api-license-agreement
6. Key Collector FAQ, How Do You Determine Value?: https://www.keycollectorcomics.com/frequently-asked-questions/
7. Key Collector current series directory, subscriber graded-pricing notice: https://www.keycollectorcomics.com/series/
8. Key Collector Terms & Conditions, §§7.4–7.6: https://www.keycollectorcomics.com/terms
9. eBay API Deprecation Status, Finding API: https://developer.ebay.com/develop/get-started/api-deprecation-status
10. GoCollect Enterprise API offer and Pricing FAQ: https://gocollect.com/pricing
11. CGC, Action Comics #1 Heritage sale report, July 16, 2026: https://www.cgcgrading.com/news/articles/action-comics-heritage-million-6wvuW2iyGVLNsLh4NXmCZJ/
12. GoCollect inbound sales data sharing and access approval: https://gocollect.com/data-sharing
