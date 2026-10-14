# ComicHuddle: business model from the founder sketches

Decision date: 2026-10-13. Malik LLC, Minnesota; proposed USA-only launch. This review uses current primary provider sources. No vendor message, purchase, account creation, data retrieval or application change was made. Prices below distinguish verified supplier offers from business hypotheses; no profit or legal-clearance guarantee is implied.

## Short decision record

**Proposal:** build a collector's collection workspace that turns an identified comic into a purchase, collection-lot sale, negotiated trade or documented care request. The shared directory supplies identity; trusted counterparties and usable workflows supply the business advantage.

**Active:** Home, Directory, Marketplace, My Profile, Comic Workshop. **Upcoming:** FMV, Community, GrailMatch. Upcoming features must remain clearly labeled and must not be sold as available benefits.

**Data decision:** prioritize a properly obtained GCD catalog archive for a shared local index, with attribution and CC BY-SA compliance. Seek Ingram quotes for book/graphic-novel metadata and licensed images; seek GoCollect Enterprise and CovrPrice partnership proposals separately for valuation coverage. No single verified offer presently establishes full historic comic coverage, cover rights, raw/slab FMV and visual recognition together.

**Revenue decision:** retain the existing proposed **7% completed-item sale commission** for singles, lots and auction wins. Keep basic accounts, catalog search, collection and ordinary messaging free. Test paid operational tools after sellers and Workshop providers demonstrate repeat use. Existing sandbox orders use zero fees/tax; this document does not enable live charging.

## Product acceptance from the sketches

| Area | Acceptance and business purpose |
|---|---|
| Home | Clear routes into the five active areas, relevant real listings/providers and useful return visits. Avoid fictional activity or seller counts. |
| Directory | Publisher → series → edition breadcrumbs, autocomplete and bounded cover cards. Preserve publisher, series year/volume, issue number, printing, variant and language. “Add to collection” creates a member-owned copy; “Find copies” searches the exact canonical edition, with separately labeled broader results. |
| Marketplace | Single and collection lots, auctions, negotiated trade proposals and local pickup. Show seller identity/rating, exact included copies, condition and shipping/pickup terms. Manual catalog fallback must remain usable and show that identification is unverified. |
| My Profile | Collectors and Workshop providers both have collections. New profile setup requests public city/state for local discovery, with explicit guidance against street addresses. Give owners control over showcase items and collection visibility. Keep shipping addresses private. |
| Comic Workshop | Search provider name/city, inspect published services, contact/request a quote and compare city rankings. Use genuine member reviews, verified-job badges where evidence exists and meaningful sample counts. Paid plans cannot buy organic rating position. |

For listings and external research, exact edition identity matters more than a title-only match. A newsstand, facsimile, later printing or different-language comic must not inherit the original edition's availability or price. Local pickup needs its own receipt/confirmation and dispute workflow; it cannot rely on a carrier delivery event. Workshop pressing/cleaning/restoration disclosures and any grading-submission arrangement remain distinct from a guarantee of a higher grade.

## Commercial data options: facts and decisions

| Supplier | Verified offer/rules | Proposed use and remaining requirements |
|---|---|---|
| **Grand Comics Database** [1–3] | Official indexed pages state GCD metadata/schema/distribution are CC BY-SA 4.0, with cover rights reserved separately. Its current official repository describes authenticated downloaded catalog archives. The official API wiki documents an initial API, anonymous limits, authenticated access and evolving response fields. | Preferred shared metadata foundation through a legitimate catalog archive and tested importer. Retain source IDs, attribution, version and changes. Confirm current download conditions and permitted refresh method; review exclusions and the delivered license. No cover, FMV or complete-coverage promise follows. |
| **GoCollect Enterprise** [4] | Public Enterprise offer: customized API access, integrations, dedicated support and **custom pricing**. Pro is a consumer plan billed at $89/year, not a public redistribution contract. Photo search is currently described for CGC graded comics only. | Obtain a written web/PWA/iOS/Android public-display offer, authorized book-ID/URL mapping and grade/label/variant coverage sample. Ask explicitly about raw values, refresh, cache/export rights, images and any photo-search endpoint. Keep ordinary outbound research links while FMV is Upcoming. |
| **CovrPrice partnership** [5–6] | Official Partner Portal offers industry solutions for retailers/publishers. Its FAQ describes a CLZ integration, raw and slabbed sales data, missing sales and subjective seller-supplied raw condition. | Credible raw-plus-slab valuation candidate, not an assumed open commercial API. Request ComicHuddle-specific terms, quote and sample. Preserve missing-value/fallback flags and original grading-company/condition semantics. Consumer membership or a CLZ add-on does not authorize our redistribution. |
| **Ingram Data Services** [7] | Paid bibliographic/stock/image services via FTP or Web Service. FTP allows ingestion for internal/external display; Web Service caching requires licensing. Pricing varies by package/delivery. Published sales contact: **data.sales@ingramcontent.com**. | Concrete purchasable metadata/image route, particularly to evaluate for ISBN books and graphic novels. Require a comics coverage sample and rights for public marketplace/mobile display, thumbnails/cache/offline use and relevant publisher exclusions. Do not assume historic single-issue/UPC coverage or image-recognition rights. |

The GCD production site returned 403 during this review, so its download was not accessed and no bypass was attempted. The API/archive facts above come from its official public repository and wiki; license/cover statements are from indexed official GCD pages. Do not repeat the outdated claim that GCD has no API. Anonymous API availability is documented, not successfully tested here, and the wiki warns it may change. A bulk archive is a better proposed dependency for the shared directory than routing every viewer's search to a fragile external API.

Supplier procurement should separate **catalog metadata, cover images, editorial key notes, sales/FMVs and recognition**. Ask for an authorized sample spanning ordinary issues, older keys, modern variants, reprints and missing records before selecting a contract. Record edition IDs, currency, timestamp, sample count, grading company/label, nulls and fallback semantics. Request US scope plus web/native distribution, display to free/paid members, refresh/deletion rules, quotas, term, minimum charges and support. Quotes remain unknown; consumer prices cannot serve as license-cost assumptions.

Publicly adapted CC metadata must preserve its license rights and attribution; do not put a blanket proprietary restriction over it. Keep separately licensed/provider data and private member records identifiable, and check compatibility before combining protected datasets. A catalog license or physical-comic purchase does not itself grant cover reproduction, training or searchable-image-index rights.

## Cover and AI scanning sequence

**First release proposal:** manual selection plus barcode/text assistance. Google ML Kit documents on-device barcode scanning and text recognition on Android/iOS [8–9]. Its terms say image/text inputs and outputs remain on device, while updates and performance/use metrics can contact Google and require disclosures [10]. This is a viable native component, not proof that scanning works in the current web/native builds.

Treat scan output as candidates. Ask the user to confirm edition, variant and condition; ambiguous UPC prefixes, missing supplements, foil glare, slabs and similar reprint art need fallback. A photo cannot establish a professional CGC grade, restoration status, authenticity or FMV. Suggested acceptance: measured correct candidate recall on an owner-supplied test set, no automatic wrong-edition saves, private photos, deletion controls and manual entry always available.

**Later proposal:** cover-image similarity against a reference corpus whose agreement explicitly allows image storage, transformations, derived hashes/embeddings and recognition use. Ask separately about model training; display rights alone are not evidence of training permission. License a documented recognition service if available rather than assuming a consumer photo-search feature can be embedded. No recognition provider quote or such rights were verified in this review.

## GoCollect outbound links: verified contract

The official search help describes a search bar, collectible-market selection and choosing an item result [11]. No stable documented outbound title/issue query-parameter contract was verified. Store verified external URLs per canonical edition; never construct a slug from its name.

| Observed issue/edition | Official URL verified 2026-10-13 |
|---|---|
| Amazing Spider-Man #300, original base entry | https://gocollect.com/comic/amazing-spider-man-300 |
| Amazing Spider-Man #300, newsstand entry | https://gocollect.com/comic/amazing-spider-man-300-newsstand-edition |
| Amazing Spider-Man #300, Mexican edition | https://gocollect.com/comic/amazing-spider-man-300-2 |
| Uncanny X-Men #266 | https://gocollect.com/comic/uncanny-x-men-266 |
| Marvel Super-Heroes Secret Wars #8 | https://gocollect.com/comic/marvel-super-heroes-secret-wars-8 |
| Incredible Hulk #181, original base entry | https://gocollect.com/comic/incredible-hulk-181 |
| Action Comics #1, original 1938 entry | https://gocollect.com/comic/action-comics-1-1 |

These observed mappings [12–18] are evidence for those entries, not a complete crosswalk or evidence of available CGC copies. Ambiguous edition details still require confirmation on GoCollect. Recommended label: **“Research on GoCollect”** or **“CGC guide on GoCollect”**. For an unmapped comic, open https://gocollect.com/comics with copyable title + issue + series year + variant, and say “Search this title and confirm the edition on GoCollect.” Do not represent that fallback as a prefilled exact search. A contracted Enterprise book-ID crosswalk is the scalable route to verified links. Ordinary links produce no assumed affiliate revenue.

## Revenue hypotheses and unit economics

| Proposed revenue | Terms to test |
|---|---|
| Completed sales | **7% of item subtotal**, excluding shipping/tax; same policy for singles, collection lots and auction wins. No separate buyer premium or listing fee proposed. Define refunds and fee reversals before activation. |
| Negotiated trades | Basic proposals free. Apply the same fee only to a clearly disclosed cash sale component processed on-platform; do not levy 7% on an invented barter value. |
| Seller Pro | Existing **$29/month hypothesis** for useful bulk inventory, fulfillment and business reports; retain the sale commission unless a tested tier explicitly changes it. |
| Studio Pro | Existing **$19/month hypothesis** for Workshop intake/quote/status tools. Free discovery/reviews remain; organic rankings stay independent. |
| Collector Plus | Existing **$7.99/month hypothesis**, deferred until licensed data/premium tools actually exist. Upcoming FMV is not an active subscription benefit. |

Illustration, not forecast: seller fee 7%; $8 shipping per order; no tax for this calculation; platform bears processing. Stripe's retrieved US pricing states domestic-card processing at **2.9% + $0.30** [19]. Actual Connect, other methods and account terms require confirmation. Additional **assumptions** per order: $0.50 allocated Connect/payout cost, 1% of item value for refund/fraud losses, $0.75 variable support. These allowances are not a Stripe quote or an adequate-reserve guarantee.

| Item subtotal | 7% fee revenue | Card fee on item + $8 shipping | Other assumed variable costs | Contribution before acquisition/fixed costs |
|---:|---:|---:|---:|---:|
| $25 | $1.75 | $1.26 | $1.50 | **−$1.01** |
| $100 | $7.00 | $3.43 | $2.25 | **$1.32** |
| $500 | $35.00 | $15.03 | $6.25 | **$13.72** |

The $100 example yields $1.318 before rounding. With an illustrative $3,000/month fixed-cost budget, commission alone would need approximately **2,277 such orders/month**, about $227,700 item GMV, before customer-acquisition costs. The $3,000 budget is a scenario, not a data quote. Seller proceeds, shipping and taxes are not platform revenue; membership receipts also have processing, service costs and churn. Refunds can leave unrecovered processing and chargeback costs.

Proposed commercial focus: dependable sellers, collection lots and combined orders; low-value singles can consume their margin. Test seller/provider plans for time saved before charging. Start with ten sellers and five Workshop providers as recruitment targets, not claimed partnerships. Proposed pilot gates: positive measured contribution, at least 95% fulfillment within the disclosed promise, support responsiveness, repeat collection use and no unhandled dispute backlog. Use actual cohort results to revise assumptions and fund reserves; do not buy broad audience growth before repeat demand and positive contribution appear.

## Sources

Accessed 2026-10-13. Provider offers and documentation can change.

1. https://www.comics.org/ — indexed official metadata-license and reserved-cover-rights footer; direct fetch blocked.
2. https://github.com/GrandComicsDatabase/gcd-django — current official README, authenticated archive workflow; GPL refers to website code.
3. https://github.com/GrandComicsDatabase/gcd-django/wiki/API — initial API and access/schema caveats, edited 2026-03-25.
4. https://gocollect.com/pricing — Enterprise custom API; Pro consumer pricing; CGC-only photo-search scope.
5. https://covrprice.com/partner-portal/ — business partnership route; no form submitted or login used.
6. https://covrprice.com/faq/ — raw/slab data, subjective raw condition and CLZ partnership.
7. https://www.ingramcontent.com/retailers-page/data-services-faq — licensed caching, ingest/display, images, custom quote and verified contact.
8. https://developers.google.com/ml-kit/vision/barcode-scanning
9. https://developers.google.com/ml-kit/vision/text-recognition/v2
10. https://developers.google.com/ml-kit/terms — on-device inputs/outputs; metric/update disclosures.
11. https://gocollect.com/help-center/post/how-to-use-gocollect-step-by-step-guide — official search UI and item selection, not a documented URL-query contract.
12–18. Exact official comic pages in the outbound-link table above.
19. https://stripe.com/pricing — retrieved United States English page; separate Connect pricing applies. Connect page regional redirect did not establish a US payout quote, so the $0.50 allowance is explicitly assumed.

Related project documents: `BUSINESS-COMMERCE.md`, `BUYER-PROTECTION-AND-PLATFORM.md`, `DATA-ACCESS-DECISION.md`, `INDEPENDENT-FMV-METHOD.md` and `COMMERCE-BACKEND.md`. The founder sketches change product priority; the existing payment, auction, legal, security and licensed-data release gates still apply to actual paid operation.
