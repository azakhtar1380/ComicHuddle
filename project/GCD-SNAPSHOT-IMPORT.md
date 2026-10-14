# GCD snapshot import and release updates

The complete GCD database archive has not been supplied. The repository is
application source, not the GCD database. Obtain the **SQLite download** from
[GCD downloads](https://www.comics.org/download/) using a permitted account,
accept its metadata terms, retain the actual archive timestamp, and extract
`current.zip`. The official download view is login-protected. Do not guess
private dump URLs or bypass authentication. MySQL `.sql` archives must first
be restored to an isolated MySQL staging database and converted; they must
never be executed as SQL against ComicHuddle's PostgreSQL database.

The new importer is an offline CLI, outside Vercel request/build timeouts:

```sh
node scripts/prepare-rds.mjs
npm run db:migrate
npm run db:import:gcd -- \
  --input /absolute/path/gcd.sqlite \
  --snapshot-at ACTUAL_GCD_ARCHIVE_ISO_TIMESTAMP \
  --workdir /absolute/path/import-receipts
```

Use the existing server-only AWS RDS environment settings with verified TLS.
No passwords are command-line arguments or repository files. Retain the
receipt directory to resume; a reused directory validates the original
archive checksum and date. Importing the same receipt twice is idempotent.

The SQLite adapter reads ordinary source tables in a read-only transaction,
normalizes issue IDs, series/publisher context, original cover price and
available story text, and hashes both input and output. Its limitations for
modern linked credits/characters/brands are explicit. It does not invent
missing metadata or FMV, include private tables, or change the input archive.
The PostgreSQL importer preflights **every** normalized record before writing,
then commits at most 500 records / 8 MB per transaction. Records, cover
references, checkpoint counts and batch hashes commit together. It enriches
index-only records while preserving richer existing API metadata and all
user/collection/listing IDs. Newer snapshots can update prior snapshot rows.

If the dump contains `gcd_cover`, the adapter maps the **actual scan ID** and
its `issue_id` using the published GCD Cover URL layout. It never uses an
issue ID as an image filename, borrows a base cover for a variant, imports
restricted/deleted scans or copies image binaries. Wraparound and upload/
modified metadata are retained. When `gcd_cover` is absent, that absence and
zero mapped references are reported; a metadata-only dump cannot create art.
Existing API-sourced cover overlays remain independent of the snapshot.

Thumbnails identify indexed editions and retain GCD/source credits directly
below the cover and in details. Artwork copyright remains with the respective
publisher/artist; GCD's CC BY-SA 4.0 metadata license does not license covers.
Fair use is fact-specific, not a commercial cover license. Obtain appropriate
permission/review before treating thumbnails as licensed high-resolution
assets, redistributing artwork, using it on merchandise or for model training.

The weekly Vercel job starts Monday at 09:00 UTC, observing current/previous
ISO release weeks. The daily 10:00 UTC continuation only resumes an active
weekly checkpoint; it starts no historical backfill or independent daily
refresh. Already-enriched stored issues are skipped, while new/index-only
issues receive exact API details and supplied cover URLs. Both routes require
`CRON_SECRET`, share the persistent GCD 26-request/hour budget and respect
Retry-After and owner pauses. They stop within 270 seconds and preserve any
unfinished work. `GCD_WEEKLY_SYNC_ENABLED=true` enables this newly authorized
scope; the stopped private Site/Metron jobs remain stopped.

No full GCD snapshot import or 50,000-record live count is claimed without the
real archive and its completed SQL receipts. API references do not prove that
every image host will return a renderable image in every browser.
