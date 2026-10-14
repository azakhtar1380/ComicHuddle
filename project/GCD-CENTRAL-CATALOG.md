# GCD central catalog operator contract

The Site imports GCD bibliographic metadata into its own D1 directory. Visitors search saved records through `/api/catalog`; neither a page load, a card click nor a vault save calls GCD. The importer uses anonymous JSON access, with an operator checkpoint and a shared request budget. Existing Metron IDs, records, settings, credentials and jobs retain their own provider identity and checkpoint.

## Observed upstream access and limits

The genuine probes in `project/evidence/GCD-PUBLIC-PROBE-2026-10-13.json`, `GCD-WEEKLY-PROBE-2026-10-13.json` and `GCD-SERIES-PROBE-2026-10-13.json` recorded anonymous HTTP 200 responses. The latest series probe reported 233,585 series, 50 results on page 1. The week 42/2026 probe reported 162 on-sale issue summaries. These are upstream observations, not imported counts or a promise of complete coverage.

The official [API wiki](https://github.com/GrandComicsDatabase/gcd-django/wiki/API) describes a changing API. The current primary [settings.py](https://github.com/GrandComicsDatabase/gcd-django/blob/master/settings.py) declares anonymous 30/hour, account 2000/day and pagination 50. Site-specific settings can override these defaults. The importer reserves at most 26 attempts per rolling hour, including failed requests, and honors the provider's actual `Retry-After` value. It sends `Accept: application/json` on canonical URLs, without `format=json`, supplier credentials or automatic redirects.

The primary [serializers.py](https://github.com/GrandComicsDatabase/gcd-django/blob/master/apps/api/serializers.py) and [views.py](https://github.com/GrandComicsDatabase/gcd-django/blob/master/apps/api/views.py) agree with the probes:

| Operation | API path | Import behavior |
| --- | --- | --- |
| Recent releases | `/api/issue/on_sale_weekly/<ISO-year>/week/<week>/` | Page contains summaries; queue exact issue and series IDs. |
| Exact issue | `/api/issue/<id>/` | Validate queued IDs, sanitize bounded issue/story text, then save. |
| Historical traversal | `/api/series/` | Page contains full series metadata and active issue URLs; save series manifests and walk each exact issue ID. |
| Series fallback | `/api/series/<id>/` | Used only if a future series list supplies summaries instead of active issue URLs. |

Current-week records have priority, followed by the previous ISO week. A sweep starts once per UTC day after its predecessor completes. Completed records are fetched once per sweep; overlap between the two weeks reuses that sweep's validated detail. For the 162-record observed current week, detail fetches alone require more than one anonymous hourly window. An hourly continuation job is necessary for a daily outcome; one short nightly invocation cannot truthfully promise that all recent details are fresh.

No modified-since feed is implemented by these API routes. A recent-release sweep refreshes its two observed weeks, including stories and bibliographic corrections. It does not refresh the entire historical archive. Delays, records without on-sale dates, unavailable issues, and changing pagination remain visible in operator status. Daily completion means the unique queued records covered the provider's observed weekly counts; it does not certify GCD's completeness, a seller's copy or grading.

## Stable identity and stored data

| Record | Directory ID | Provider identity |
| --- | --- | --- |
| Existing starter | Existing ID 0–42 | Existing local source |
| Metron | `1_000_000_000 + metronId` | `Metron`, exact Metron source URL |
| GCD | `4_000_000_000 + gcdId` | `GCD`, exact `https://www.comics.org/issue/<id>/` source URL |

Provider IDs are positive integers up to 2,147,483,647. These namespaces do not overlap. `sharedProviderIdentity`, `issueIdentity` and `listingDirectoryId` supply the shared contract. Vault, standalone listings, mixed lots, auctions and trade inputs keep the provider plus exact ID. Canonical lookup and SQL write guards compare the central directory ID and both provider columns; identical numeric Metron and GCD IDs cannot substitute for one another.

`drizzle/0012_gcd_central_catalog.sql` adds nullable unique `catalog_issues.gcd_id`, `catalog_gcd_series` and `catalog_gcd_seen`. It adds indexes without deleting or rewriting existing catalogs. `catalog_sync.id='gcd'` holds a versioned checkpoint separate from `id='metron'`.

Starting a GCD daily sweep or initial backfill idempotently inserts the 43 starter rows using their original IDs and conflict-safe writes. Existing starter metadata and timestamps are preserved. This prevents the first saved GCD issue from replacing the empty-table fallback and hiding the starter directory. It does not initialize a Metron checkpoint or call its importer.

Issue records retain bounded sanitized title/number, series identity, edition/variant references, publication/key/on-sale dates, original cover price, page count, ISBN, barcode, recorded indicia publisher, brand, rating, frequency/printer, keywords, editorial credits, notes and up to 100 story records with credits, characters and synopsis. A key date such as `1999-00-00` retains its unknown components. Missing publisher or date remains unrecorded. Character text does not become a debut assertion. The original price has the explicit tag `ORIGINAL_COVER_PRICE`; it never becomes an FMV quote or marketplace valuation.

The series cache retains country/language, years, provider publisher ID, color/dimensions/paper/binding/format/notes and bounded issue descriptors. The active-issue manifest is exact, with a 100,000-ID series bound. Descriptor counts and shortening are recorded. The provider is a live editable dataset, so a completed pass only describes its observed traversal.

Artwork URLs and binary covers are excluded. Text is normalized and shortened with attribution; unknown fields are excluded until reviewed. Detail responses expose the bibliography only for exact `/api/catalog?id=<directoryId>` requests. Search, browse and batched IDs return compact summaries. Client validation preserves the detail fields and their explicit original-price tag.

Metadata includes the GCD issue source, GCD attribution and [CC BY-SA 4.0 license](https://creativecommons.org/licenses/by-sa/4.0/). The official [download template](https://github.com/GrandComicsDatabase/gcd-django/blob/master/apps/stats/templates/stats/download.html) documents attribution/link requirements and the license upgrade. Display credits and license links alongside the adapted data; do not assume this licenses covers or commercial valuation feeds.

## Private operator API and continuation

`GET /api/gcd-sync` returns counts, receipts, remaining throttle wait, pause state and separate daily/backfill progress. It requires the signed-in Site owner. `POST` requires a same-origin owner browser JSON request with at most 2000 actual body bytes and exactly one action field:

| Action | Effect |
| --- | --- |
| `daily_step` | Start or continue the two-week recent sweep, at most 3 supplier calls and 8 processed issues. |
| `backfill_step` | Continue historical traversal only after today's recent sweep finishes; otherwise return a deferred status without calling GCD. |
| `pause` | Preserve cursors and stop supplier work. |
| `resume` | Clear the owner pause without resetting progress or rate counters. |

Every step also caps internal progression at 16 iterations, so empty series cannot create unbounded SQL work. A 120-second lease serializes this Site's GCD workers. Each D1 batch validates the current lease, writes metadata and advances the cursor atomically. Storage failures retain the queued identity. Another lease cannot be released by the interrupted worker. A pagination/count mismatch resets only the affected weekly manifest or historical pass for reconciliation, retaining saved records. A provider 404 retains any prior issue metadata and increments `unavailable`; it does not fabricate a replacement or delete users' directory links.

An originless private-Site service request may use the existing read-only `METRON_PRIVATE_SERVICE_ENABLED='true'` gate plus `X-ComicHuddle-Catalog-Run: owner-private-service`. This branch depends on Sites' private ingress verifying `OAI-Sites-Authorization` before application dispatch. It is not a public bearer-token implementation in this route. Keep the Site private; before a public deployment disable that shared gate or replace it with reviewed scoped job authentication. No Metron credential is read or transmitted by the GCD job.

`scripts/gcd_catalog_sync.py` calls only this Site endpoint. It accepts a private Site credential in `COMICHUDDLE_SERVICE_TOKEN`, never prints it, refuses redirects or alternate origins and emits allowlisted status. Run hourly with `--mode daily`; `--mode backfill` first completes the recent sweep and then uses the remaining shared budget for history. Default runtime 45 seconds and 12 steps stop at a durable checkpoint; long provider waits leave work for the next job. Status mode has no supplier requests. The runner respects owner pause and does not automatically resume it.

```sh
python scripts/gcd_catalog_sync.py --mode daily --max-seconds 45
python scripts/gcd_catalog_sync.py --mode backfill --max-seconds 45
python scripts/gcd_catalog_sync.py --mode status
```

The schedule must be installed and exercised by the operator; these source files alone do not establish a hosted schedule. Public `/api/catalog` reports actual `gcdIssueCount` and `lastGcdSyncedAt`. The latter is the most recent stored-record receipt, not proof that all imported records share that freshness. Operator `daily.lastCompletedAt`, `pending`, `checked`, `unavailable` and backfill counts give the concrete scope. `historicalCoverageComplete` remains false even after an observed series pass.

## Whole-database access handoff

Anonymous API traversal is not a practical full-database bulk import. The supported bulk route is [GCD downloads](https://www.comics.org/download/). Anonymous access was refused; the primary [download view](https://github.com/GrandComicsDatabase/gcd-django/blob/master/apps/stats/views.py) is login-protected and offers SQLite/MySQL archives after the licensed form. Obtain the archive through a permitted GCD account, retain its date/hash/license receipt and use that supported snapshot as the full baseline. Do not scrape HTML or route around account requirements.

A bulk adapter must inspect the actual archive schema, preserve exact issue/series/provider IDs and variants, reuse the bounded bibliographic normalizer and GCD directory namespace, stage counts/manifests, verify row coverage, then batch into central storage. It must exclude artwork and prices as valuations, preserve user/marketplace links and prior records, and report rejected rows explicitly. A full snapshot also needs a storage/capacity plan and an approved historical refresh policy; D1 capacity is not claimed to fit the complete archive here. There is no fabricated full-database payload, credential or completed import in this source.

## Verification

`node --experimental-vm-modules checks/gcd-sync.mjs` executes the real additive migrations, SQLite, Drizzle importer and HTTP handlers against synthetic upstream/time fixtures. Its 23 cases include preserving all 43 starter entries, provider isolation, bibliographic detail/summary contracts, two-week pagination, daily priority, summary-series fallback, throttles/Retry-After, actual byte bounds, identity drift, pause/resume, atomic rollback, lease theft and count reconciliation. Maximum observed bind count is 80, below D1's 100 limit.

`python checks/gcd-runner.py` verifies 7 synthetic service-runner cases: exact private endpoint/auth headers, bounded JSON, pause, quotas, daily priority, run bounds and safe errors. Genuine live access is separately documented in the probe files, and actual hosted import/schedule evidence must be recorded after deployment. Existing Metron regression and the repository TypeScript build are separate required checks.
