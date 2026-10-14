# Compact directory and GCD connection — 13 October 2026

## Interface

Directory grid/list cards contain only a bounded authorized cover (or neutral missing-cover icon), issue name/number, publisher and More info. Clicking opens details, credits, edition data, source links, Raw/CGC guide context, wants, collection ownership and the exact-issue marketplace action. Metadata is not duplicated in the cards.

The existing central Scan and six destinations remain. The native prototype provides simple cards and account handoffs; the hosted native web preview reads the central catalog when running at the authorized Site origin. Its device builds have no independently authenticated catalog/account session.

## GCD data and coverage

The linked GitHub wiki documents GCD's actual comics.org API; it is not a downloadable full catalog. Direct anonymous API requests were verified. On 13 October 2026 the series endpoint reported 233,584 series in the first probe and 233,585 in a later probe. That is the provider's series count, not this site's imported issue count. GCD's production source configures anonymous requests at 30/hour; the app uses a smaller persistent budget and honors Retry-After.

GCD metadata is stored in ComicHuddle's central D1 directory and read locally by visitors. IDs occupy a distinct range above existing starter and Metron IDs. Personal collection, marketplace and exact Buy references preserve provider identity. Hourly continuation completes a bounded current/previous-week daily new-release sweep within the source budget; a resumable historical checkpoint and older-record revalidation are separate. Weekly refresh cannot detect every historical edit in GCD.

Full historical coverage requires GCD's supported bulk download/access arrangement. The anonymous API rate does not support a quick full catalog import; no complete coverage is claimed. The actual imported count, timestamp and checkpoint must be read back after a run. The operator's paused Metron task/configuration is retained.

GCD metadata adaptations retain attribution and CC BY-SA 4.0. Artwork is excluded from that metadata license; no GCD cover images or market values are imported. Original publisher cover price is labeled as bibliographic information, never FMV. Rich bibliography appears only in the opened issue view. Current FMV, Community and GrailMatch remain Coming soon.

## Source handoff and verification

The launch kit includes Expo source/unsigned exports and the exact pushed website source in ComicHuddle-Web-Source.zip, plus the PostgreSQL blueprint and tests. It contains no runtime secrets, credentials or private user database export. Actual GCD probe/import evidence and current-release QA accompany it. Previous scan/architecture results are dated separately. Browser/device, real OAuth, payment processor outcomes and separate-server concurrency remain unverified.

Primary sources: https://github.com/GrandComicsDatabase/gcd-django/wiki/API ; https://raw.githubusercontent.com/GrandComicsDatabase/gcd-django/master/settings.py ; https://www.comics.org/download/ ; https://creativecommons.org/licenses/by-sa/4.0/ .
