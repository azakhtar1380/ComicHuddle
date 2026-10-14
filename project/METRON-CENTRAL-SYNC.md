# ComicHuddle central catalog

The Directory and add/edit-comic picker read ComicHuddle's D1 database. Visitors
never call Metron and do not supply provider tokens. The operator's integration
uses the Metron REST API directly from the existing TypeScript Worker. Mokkari
is a valid Python client, but a second Python-to-Metron ingestion engine is not
needed: the included Python runner drives the same server checkpoint pipeline.

## Operator setup

1. Create the business account at https://metron.cloud/ and generate a revocable
   API token in its account settings. Do not paste it into chat or source files.
2. Add `METRON_API_TOKEN` as a **secret** in this Site's runtime settings.
   Set the nonsecret `METRON_SYNC_ENABLED` to `true`. Deploy the saved version
   to apply the environment revision.
3. Open owner-only Data Studio and choose the first import scope. Empty scope
   means all issues. Publisher/date scopes constrain both initial and nightly
   coverage; a fixed weekly date window never expands itself to future weeks.
   Start with a publisher if preferred, then use Continue/Resume. A paused or
   active checkpoint must finish before replacing the scope. Imported records
   from previous scopes are retained.
4. Confirm coverage, source attribution and the last completed pass in Directory.
   A configured token is not proof that an authenticated request has succeeded.

Do not describe one account as an approved arrangement for every multiuser app.
Metron distinguishes a business's own inventory/store from applications that
serve many users. Describe ComicHuddle's centrally indexed marketplace, social
and mobile use to Metron (`bpepple@metron.cloud`) and confirm the suitable account
arrangement before commercial ingestion. A donation raises the matched account's
quota; it is not an application, image or pricing license.

## Stored data

Migration 9 adds publishers, series, issues, creators and issue-creator roles with
provider IDs, plus sync state and scan manifests. Existing43 starter public IDs
are unchanged. Imported public IDs are `1,000,000,000 + Metron ID`; owned physical
copies keep the separate `externalCatalog` provenance, never a fabricated starter
valuation identity. Raw provider JSON is private; public DTOs contain selected
bibliographic fields, source URLs, license and change attribution.

The explicit `seed_starter` action copies the 43 existing bibliography records
without fetching a provider. It is idempotent and separate from schema migration.
It does not imply that 43 Metron records were imported.

## Import behavior

- Metron list pages identify work; full details normalize creator/publisher/series
  relations and searchable text. Writes and each checkpoint commit atomically.
- A persisted lease prevents competing runners. Each HTTP step makes at most 4
  external requests and processes at most 8 records. Server budgets conservatively
  cap burst requests at 20/minute and default daily requests at 5,000, honor returned
  quota/reset headers and `Retry-After`, and persist counters across restarts.
  Higher daily limits are used only when advertised by the provider.
- Stable provider IDs make repeated writes idempotent. A detail older than its
  queued list timestamp cannot advance the checkpoint. A failed write leaves the
  exact record pending; invalid responses pause without leaking token/body data.
- Growing source totals do not restart a long backfill at its early pages. Two
  scans compare unique manifests and each pass's final reported source count before advancing
  the watermark. Mutable offset pages are not a snapshot: overlapping 7-day
  incremental scans, weekly full scans and 7-day detail refresh reduce misses.
  This is best-effort reconciliation, not a zero-miss guarantee. Metron has no
  deletion feed; missing records never cause destructive catalog deletion.
- A manual owner pause is respected by nightly jobs. Manual Resume restarts its
  retained cursor. A changed source pauses for reconciliation; the runner retries
  on a later run instead of treating incomplete work as complete.

## Nightly runner and private hosting

`scripts/metron_catalog_sync.py` is a ready-to-run Python 3.10+ orchestrator using
only the standard library. Supply the private Sites service credential through
the scheduler's secret environment as `COMICHUDDLE_SERVICE_TOKEN`. This is a
**Site** credential, not the Metron token. Never store it in a cron line, URL,
Git file or logs. The Metron token stays in Site runtime secrets.

```
python scripts/metron_catalog_sync.py --mode nightly --max-seconds 1800
python scripts/metron_catalog_sync.py --mode status
```

A first run can optionally pass `--publisher Marvel`; once a scope has
been checkpointed, configure the next scope in Data Studio. With no scope given,
the initial scope is the entire provider catalog and backfill takes many runs.
The runner exits cleanly when operator configuration is missing or daily quota
would outlast the run; it prints only allowlisted status fields.

The cloud schedule uses Sites service access. Before every run it must retrieve
the Site, confirm it is still owner-private, and obtain fresh service access.
It must not publish, change sharing, upload code or modify operator secrets.
Only explicitly configured runtimes allow the originless service endpoint;
signed-in nonowners and browser Origin requests cannot use that path. **Disable
`METRON_PRIVATE_SERVICE_ENABLED` and replace this private-only service mechanism
with separately authenticated service authorization before public sharing.**
`METRON_NIGHTLY_SCHEDULE_ENABLED` reports whether a linked schedule has actually
been saved; it does not mean any provider import has completed.

## Rights, artwork and FMV

Metron bibliographic adaptations retain CC BY-SA 4.0 attribution, source/license
links and change notices. The license applies to the adapted public data, not the
entire application or private collector information. Metron does not license cover
artwork. This importer does not fetch, mirror, hotlink or expose Metron cover image
URLs. Store approved retailer/publisher art under separately recorded rights before
adding artwork caching. Existing starter images retain their prior specific credits.

Metron `price` is printed cover price, not a sold result or FMV. It is not mapped
to marketplace valuation. FMV and GrailMatch remain in Upcoming as requested.
Comic Vine is not an ingestion source for the commercial product.

## Primary references

- https://metron-project.github.io/blog/commercial-api-use
- https://metron-project.github.io/blog/token-authentication
- https://github.com/Metron-Project/metron/blob/master/api/README.md
- https://github.com/Metron-Project/metron/blob/master/comicsdb/filters/issue.py
- https://github.com/Metron-Project/metron/blob/master/comicsdb/models/issue.py
- https://mokkari.readthedocs.io/en/stable/mokkari/mokkari/

## Verification scope

Run `node checks/run-readiness.mjs`, including the isolated SQLite/synthetic Metron
integration suite. Tests make no genuine provider requests, payments, emails or
shipping events. The production build and hosted database seed/readback are separate
checks. Provider acceptance, complete catalog backfill, native mobile/device behavior,
live payments and public-launch clearance require their respective real integrations.
