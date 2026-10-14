# From private preview to a commercial comic platform

## Catalog and paid data

Key Collector describes a curated catalog of significant issues and selected variants, rather than every comic. To build a broader directory, combine an authorized bibliography, original editorial notes and a commercial valuation feed. Never describe coverage as literally every comic without measuring editions, territories and gaps.

Grand Comics Database publishes metadata under CC BY-SA 4.0. Its available dataset can form a bibliography if its terms, attribution and share-alike obligations are followed. Cover artwork has separate rights. Verify the chosen download and terms, and design the database/search import before ingesting a full dataset. Do not copy Key Collector's proprietary descriptions or price database.

For values, ask CovrPrice about a commercial partnership: its official CLZ partner documentation shows both raw and slabbed valuation use. Compare GoCollect Enterprise's customized API. No commercial quote was received, and a personal subscription is not a substitute. The $250–500/month figure is the founder's requested quote target.

Use LICENSING-INQUIRY.txt to request a documented sample and agreement. After signing: store credentials in server secrets, map exact editions and labels, import a licensed sample, compare it with provider examples, enforce freshness/expiry and only then enable a recurring server feed. Do not invent API endpoints from marketing pages. If images are excluded, negotiate cover display rights separately or retain metadata cards and authorized user photographs.

Official sources:
https://www.keycollectorcomics.com/frequently-asked-questions/
https://www.keycollectorcomics.com/terms
https://gocollect.com/pricing/
https://club.clz.com/t/faq-about-getting-values-from-covrprice/10422
https://www.comics.org/download/
https://www.loc.gov/item/2018487926/

## Web and apps

Delivered: responsive desktop/mobile website; home-screen installation support; public-data native prototype; shared styling and attributed records; owner revenue planning and valuation imports.

Remaining: production user login supported across web/native; stable catalog migration; contracted feed and covers; real marketplace checkout/payouts; production orders/refunds/disputes; notifications; native authenticated account screens; signed builds and store review. Test user identity and per-account record ownership on actual devices before broadening access.

Apple's developer program lists USD $99 per membership year; Google Play lists USD $25 one-time registration. Those are developer-account fees, not the total app development or operating cost. Identity verification and store release requirements also apply. Build hosting, payment services and digital-subscription store fees are separate.

## Brand and operations

ComicHuddle and the original CH monogram replace ComicStrata. The .com registry check on 8 October 2026 returned no registration for comichuddle.com. That is preliminary availability evidence; no domain was purchased and no trademark clearance was completed. Check the relevant countries, trademarks, app stores and common-law use before committing to public branding.

The founder supplied Malik LLC, Minnesota/USA, maliktecks@gmail.com and a USA-only launch scope. Those details now appear in the preview; verify company/brand operating status and support staffing before wider use. The operator's jurisdiction and offered sales destinations determine legal and tax obligations. Have the actual operator/jurisdiction reflected in terms, privacy disclosures, seller agreement, pressing-provider agreement, copyright notice process, refunds and dispute procedures. A preview disclaimer is not legal clearance. Get a lawyer to review the intended business and contracts; no website can guarantee immunity from claims.

A book seller's resale rights, data-display rights and character-merchandise rights are separate. Identify publishers and CGC accurately without implying endorsement. Do not manufacture or sell unauthorized character merchandise. A provider's pressing/cleaning, liability and insured-shipping terms should be explicit; grading submission eligibility must be verified, and a higher grade cannot be promised.

Start with the existing private audience. Publishing this update does not authorize public access, paid accounts, domain purchases or provider commitments.

## Reviewable next step

Send the completed licensing inquiry yourself or explicitly authorize a particular recipient and message. Obtain the provider's written quote, sample, rights grant and contract; review them before paying. Then integrate that provider against its actual API documentation. The website already has owner-only import functionality for a licensed sample, but a comprehensive commercial catalog requires the database/mapping work described above.

## Project delivery and release gate

See `project/TEAM.md`, `project/BACKLOG.md` and `project/RELEASE-READINESS.md` for assigned AI roles, completed automated acceptance checks and remaining release conditions. Engineering fixes are ready for the existing private audience. Before a public starter beta, verify the supplied operator/contact and brand operating requirements, publish applicable reviewed policies, configure/rehearse support, moderation and recovery, and verify critical journeys on real browsers/devices. Licensed data and real commerce can be integrated after their own contracts/accounts are ready. Native stores additionally need supported authenticated sessions, signing and resolution of the remaining toolchain advisories.

## Singles, whole collections and auctions

The updated website supports one comic or a frozen selected/whole collection, with current licensed FMV coverage on every product card. Full totals require all copies to be covered; unknown copies remain unknown. The collection is sold as one lot. Native prototype cards and sell actions use the same web account flows.

Persisted auction previews have server cutoffs, increments, private receipts, explicit nonbinding consent and retract/cancel controls. They create no order or payment. Determine applicable auction operating requirements and finalize binding terms before activating actual public auctions; an LLC document alone is not auction eligibility evidence. Complete fixed-price payments/orders, refunds/disputes and tax setup first. See project/BUSINESS-COMMERCE.md for the official-source assessment and project/QA-COMMERCE.md for verification.

## Current payment/data preparation

Use the existing custom marketplace backend for conditional seller transfers and private records. Squarespace may be a separate merchant/marketing site. The new web database and sandbox adapter do not substitute for an actual Stripe Connect business sandbox, protected credentials, reviewed reachable webhook ingress, genuine provider tests, carrier/scheduler, reserves/taxes and final policies. Keep live checkout and binding auctions disabled until their gates pass. Follow project/STRIPE-SANDBOX-SETUP.md and project/PAYMENTS-REFUNDS-RELEASE.md.

Request written Key Collector catalog/key/cover rights and a sample/quote through support@keycollectorcomics.com. No consumer subscription or eBay developer key clears commercial redistribution or derived FMV. Use ordinary GoCollect guide links for CGC initially and permission-cleared records for research FMV.

## Current Community / Metron scope — 9 October 2026

The six phone tabs are Home, Directory, Marketplace, Community, Upcoming and Comic Workshop. My Profile is the account action and desktop profile menu. FMV/GrailMatch are deferred coming-soon products, not active guides or swipe demos. Community’s feed, discovery, own groups, create-group and four post kinds hand off to real website actions; previews are clearly labeled.

Metron is the chosen next metadata source. The website implements per-user, transient-token lookup with attribution and CC BY-SA4.0 provenance, excluding covers, cover prices and FMV. No authenticated live lookup has been verified. To populate one shared directory, use the inquiry in project/METRON-DIRECTORY-DECISION.md to confirm authorized bulk delivery or central-service access. The data license itself does not require every directory reader to register with Metron; the default multi-user API service does require each user’s own token. Comic Vine’s public API is noncommercial. Follow project/METRON-SETUP.md for the individual connection.

Project/COMMUNITY-RELEASE.md and COMMUNITY-QA.md contain current acceptance evidence. Earlier FMV/navigation reports retain historical decisions rather than describe the present menu. Production browser/device, data, commerce and store gates remain open.
