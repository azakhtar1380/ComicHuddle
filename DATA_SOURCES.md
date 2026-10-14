# ComicHuddle data and brand provenance

The directory currently has 43 selected original issues and 30 documented individual sale results. It is not an exhaustive catalog or a live valuation feed. IDs 0–34 retain their previous meaning, preserving saved collections and want lists.

Bibliographic sources appear on issue details. Selected GCD metadata adaptations in `lib/catalog-additions.ts` carry record-level attribution and CC BY-SA 4.0 links; cover artwork is excluded. The six vintage images retain their source credits and US public-domain status notes. No new publisher cover permissions have been obtained.

CGC-reported sale results in `lib/reported-sales.ts` retain grades, known label types, dates and source URLs. The July 2026 Heritage report provides an auction window, not individual lot dates; that range is shown and its buyer’s premium is identified. Unspecified labels stay unspecified. These results are not FMV or average prices.

Data Studio accepts owner-only, same-origin imports of licensed USD estimates. Inputs require an active redistribution permission declaration, a private contract reference, public source attribution, valid grades, ranges and timestamps. They are not legally verified by the platform. Current FMV excludes estimates older than 30 days. Expired display permission excludes a dataset’s rows from the public API. No synthetic prices are seeded into production.

GoCollect’s commercial Enterprise/API offering: https://gocollect.com/pricing/
GCD metadata downloads and license information: https://www.comics.org/download/
Library of Congress GCD dataset record: https://www.loc.gov/item/2018487926/

ComicHuddle is a provisional brand. `comichuddle.com`, `comicmantle.com` and `comicstride.com` returned HTTP 404 in Verisign’s authoritative .com RDAP checks on 2026-10-08. Domain registration, registrar confirmation and professional trademark clearance have not been performed. The rounded ch letter mark is original vector lettering and does not use publisher logos or characters.

Verification: TypeScript and the real-route SQLite/D1/R2 smoke checks cover accounts, privacy, groups, reciprocal trades, messaging, listings, care jobs, moderation, licensed imports and stale/expired data. A browser visual check was unavailable in this managed environment; the SVG wordmark was rendered and inspected separately.

## Mobile and commercial launch

ComicHuddle adds a home-screen-installable responsive web experience and an Expo/React Native iOS, Android and web prototype. The prototype includes the same 43 starter issues and 30 dated sale facts; account actions open the private website. It contains no private service token or authenticated account snapshot. The service worker caches only a generic offline screen and brand icon, never account, message, listing or price responses.

The owner-only Launch Studio models proposed free/Plus/Seller Pro/Studio Pro offers and a 7% completed-sale fee. Its figures are hypothetical; checkout and paid plans remain unconnected. The $250–500/month data budget is a quote target, not confirmed commercial pricing. A provider agreement must explicitly authorize web/native redistribution and any image display.

The mobile design revision replaces the old monogram and the app UI, without adding catalog records or altering any prices. Six primary mobile tabs are Home, Directory, FMV, Marketplace, GrailMatch and Comic Workshop; Community and Collectors open from the account drawer. Native swipe previews are explicitly session-local.

Mobile theme revision (8 October 2026): original vector halftone/action-ray panels, warm paper and ink borders; context-bounded native cover frames and mobile app image caps. Full covers use contain sizing. Catalog, sale facts, image attribution and rights labels are unchanged.
