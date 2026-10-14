# AWS RDS catalog ingestion

The public Vercel application reads `ch_web.catalog_issues` in AWS RDS through
`db/postgres.ts`, `lib/catalog-store.ts` and `/api/catalog`. The catalog is not
a frontend JSON feed. The committed seed files are operator inputs that the
build importer copies to PostgreSQL; deleting or changing a frontend asset
does not change the stored directory.

## Current source scope

`db/gcd-overview-seed.jsonl` contains 993 genuine GCD base-issue records captured
on October 14, 2026 from the official series overview API. The manifest records
the exact response hashes, capture timestamps, scope and row counts:

| Series | Captured base issues | Provider base-issue count | Remaining page |
| --- | ---: | ---: | --- |
| The Amazing Spider-Man, 1963 | 443 | 443 | None for base issues |
| Batman, 1940 | 400 | 715 | 9 |
| Spawn, 1992 | 150 | 381 | 4 |

This is **not the complete GCD catalog**. GCD's overview endpoint excludes
variants and provides the longest comic story rather than every story and
full issue fields. Unknown information remains unrecorded. Existing complete
issue records are retained when their GCD IDs already exist. The earlier
approved seed contains 191 stored records, including 148 GCD issues. Its GCD
IDs do not overlap this new dataset. The projected combined count is 1,184;
cloud build logs and the live API must establish the actual database count.

Metron and Marvel credentials and the official complete GCD archive are not
configured or available. Open Library book/edition records are not substituted
for individual comic issues. No live FMV, artwork or proprietary Key Collector
data is included in this import.

## Execution and recovery

`003_catalog_ingestion.sql` creates durable run and batch receipts. The
production build executes the existing checksum-controlled migrations,
then `scripts/seed-real-data.ts` against AWS RDS with verified TLS. That script
preflights the complete JSONL file and manifest before writing any data. It
inserts up to 100 issues per transaction, stores each batch's hash and counts
atomically, and confirms every GCD namespace ID from PostgreSQL. Identical
deployments replay the saved receipts. An interruption resumes from the same
input; it does not delete user data, overwrite existing richer metadata or
restart the old private Site jobs.

After database initialization, a trusted operator can run:

```sh
npm run db:seed
npm run test:catalog-seed
```

Database settings must be supplied through server environment variables, never
committed to this repository. The build prints actual indexed/provider counts,
accepted/inserted/retained seed counts and a completion timestamp. It suppresses
driver errors containing SQL/input/connection details.

`scripts/fetch-gcd-overviews.py` is a manual capture tool. It reuses existing
response receipts, rejects redirects and pagination changes, and honors
provider HTTP failures and Retry-After by saving a checkpoint instead of
retrying aggressively. Its explicit request budget must account for other
requests in the same hour. No new background ingestion has been activated.

## Complete catalog baseline

Obtain the official GCD SQLite archive from
<https://www.comics.org/download/> with an authorized GCD account and the
appropriate intended-use declaration. Preserve its actual snapshot date,
archive checksum and license receipt. `project/GCD-BULK-IMPORT.md` describes
the existing read-only archive adapter and schema report. The new overview
seed loader intentionally rejects full-archive/complete-catalog claims: that
input requires a separately reviewed archive importer and field mapping.
Metron/Marvel integration needs the corresponding authorized operator access.

## Data attribution and license

Bibliographic data: **Grand Comics Database**, <https://www.comics.org/>.
Seed metadata, its selected/formatted bibliographic projection and manifest
are shared under **CC BY-SA 4.0**:
<https://creativecommons.org/licenses/by-sa/4.0/>. ComicHuddle selected fields,
shortened text, and excluded image URLs, artwork and valuations. Provider
identity/source/license links remain on each stored issue. This data license
does not change the application code's separate licensing or confer artwork
rights.
