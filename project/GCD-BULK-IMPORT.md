# GCD snapshot conversion and central import

This source package supports converting an authorized GCD snapshot into a reviewed CSV and uploading its bibliographic issue records into ComicHuddle's central directory. The GitHub repository contains application code, schema definitions and API documentation; it does not contain the complete production comic catalog. The official baseline must be obtained through [GCD's download page](https://www.comics.org/download/) using an authorized account. No complete production archive is included in this package, and no full-catalog import is claimed.

The CSV is a transport for the supported bibliographic projection, not every column or table in a GCD archive. The read-only SQLite adapter maps active issue identities, series, publisher names, issue types and legacy textual story credits. It reports unmapped tables and rejects an incompatible schema before producing output. Modern normalized credits require a reviewed schema-specific mapping; they are not inferred. Text lengths, record size and story counts use the same bounds as the API importer. Artwork and FMV are excluded; a recorded cover price is labeled `ORIGINAL_COVER_PRICE`.

## Local conversion

Keep the original archive, its actual GCD snapshot date, license receipt and SHA-256 hash. Extract the official SQLite file locally. The adapter requires ordinary supported tables and their required columns, rejects invalid record identities and opens the input read-only. The source hash reported by the adapter refers to the SQLite file; retain the outer archive hash separately if applicable.

```sh
python scripts/gcd_sqlite_to_jsonl.py \
  --input gcd.sqlite \
  --output gcd-issues.jsonl \
  --report gcd-schema-report.json \
  --snapshot-at 2026-10-13T00:00:00.000Z

node --experimental-vm-modules scripts/gcd_bulk_convert.mjs \
  --input gcd-issues.jsonl \
  --output gcd-issues.csv \
  --manifest gcd-issues.manifest.json \
  --snapshot-at 2026-10-13T00:00:00.000Z \
  --source-url https://www.comics.org/download/ \
  --source-sha256 ACTUAL_SQLITE_SHA256_FROM_THE_ADAPTER_REPORT \
  --license-acknowledged true
```

Replace the example timestamp with the actual archive date; conversion time must not be substituted. Use the real 64-character lowercase hash from the report. Omit `--limit` for the complete set of supported active issue identities. If `--limit` is used for inspection, the report identifies a partial export. These commands require Python and the website repository's Node dependencies; the Node entrypoints use TypeScript's compiler and Node's built-in SQLite support, with Node 22.13 or later.

The converter streams JSONL into a temporary local SQLite spool, rejects duplicate GCD IDs, sorts IDs ascending, and writes the CSV and manifest without overwriting existing files. It removes its own incomplete outputs after failure. Conversion performs no provider HTTP requests. The CSV columns are `gcd_id`, `series_id`, `title`, `issue_number`, `publication_date`, `original_price_kind`, `original_cover_price` and `api_json`. Spreadsheet-facing text is escaped against formula execution; the canonical `api_json` payload remains authoritative and excludes artwork and valuations.

The manifest contains the schema version, authorized source URL, source hash, exact CSV byte hash, normalized record-chain hash, source snapshot date, expected unique issue count and CC BY-SA acknowledgement. The uploader reads the entire CSV once to verify these counts and hashes before it requests a start. This verifies the supplied file, not its authenticity or independent completeness against GCD's production database. GCD attribution, source links, modification credit and license links remain attached to the stored metadata.

## Private upload

Deploy migration `0013_gcd_bulk_ingest.sql` before using the route. Keep the Site owner-private while its existing originless service gate is enabled. Obtain a fresh private Sites service credential through the supported Sites connection; do not put it in a script, command argument, shell history, source archive or report. The CLI reads an already-injected process environment variable `COMICHUDDLE_SERVICE_TOKEN` and never prints it. A trusted operator can instead import `createBulkClient` and `uploadGcdCsv` and pass the fresh credential directly in process memory, using a terminal with echo disabled when reading protected input. Do not send that credential to GCD.

```sh
node --experimental-vm-modules scripts/gcd_bulk_upload.mjs \
  --csv gcd-issues.csv \
  --manifest gcd-issues.manifest.json \
  --action upload \
  --max-batches 100

node --experimental-vm-modules scripts/gcd_bulk_upload.mjs \
  --csv gcd-issues.csv \
  --manifest gcd-issues.manifest.json \
  --action status
```

Re-run the exact CSV and manifest to resume. The default budget is 100 batches; each has 1–8 records. The uploader sends only to the exact ComicHuddle HTTPS origin, uses a 55-second request timeout, refuses redirects and bounds response bytes. Its returned summary includes accepted, written and retained-record counts, the next batch and stage. An interrupted response leaves server receipts resumable. A CLI failure prints a safe failure outcome and does not expose response bodies or credentials.

## HTTP contract

All responses are private and `no-store`. Signed-in owner reads are permitted; signed-in owner writes also require the exact same-origin `Origin` header. The existing originless private service branch requires `METRON_PRIVATE_SERVICE_ENABLED='true'` and `X-ComicHuddle-Catalog-Run: owner-private-service`, relying on Sites ingress to validate `OAI-Sites-Authorization: Bearer <fresh service credential>`. This route does not implement public job-token verification. Disable or replace that branch before changing the Site's sharing.

| Operation | Request | Effect |
| --- | --- | --- |
| Start | `POST /api/gcd-bulk`, `{ "action": "start", "manifest": { ... } }` | Derive `importId` from the canonical manifest SHA-256 and create an `OPEN` run; exact starts replay. |
| Batch | `POST /api/gcd-bulk`, `{ "action": "batch", "importId": "...", "batchIndex": 0, "records": [ ... ] }` | Accept 1–8 normalized records at the next ordered index; save an atomic receipt. |
| Status | `GET /api/gcd-bulk?importId=<manifest SHA-256>` | Return the run, declared count, accepted/written/retained counts and next batch. |
| Finish | `POST /api/gcd-bulk`, `{ "action": "finish", "importId": "..." }` | Verify accepted count and normalized record chain, then mark `COMPLETED`. |
| Cancel | `POST /api/gcd-bulk`, `{ "action": "cancel", "importId": "..." }` | Close the run as `CANCELLED`, retaining committed records and receipts. |

The route accepts JSON bodies up to 1,600,000 actual bytes, positive provider IDs up to the existing GCD namespace bound and manifests declaring 1–10,000,000 records. Extra transport fields are rejected. Each batch's provider IDs must be ascending and unique, following the prior committed ID. A replay with the same index and normalized content returns the original receipt; changed content returns HTTP 409. Completion verifies the normalized record chain on the server. The archive/CSV byte hashes are recorded as operator provenance, since the server receives normalized JSON batches rather than the original archive or CSV bytes.

## Retention, locking and truthful coverage

Bulk ingestion acquires the same 120-second GCD lease used by the API importer. It changes neither the weekly/backfill JSON checkpoint, request counters, retry checkpoint, owner pause nor Metron configuration. The shared lease prevents concurrent API and bulk writes. Guarded D1 batches commit issue writes, receipt and progress together; a failed receipt rolls back the whole batch. The bulk tables have foreign keys, primary keys and count constraints. Existing starter records are inserted only when absent, keeping their original IDs and metadata.

Every GCD issue uses `4_000_000_000 + gcd_id` as its central directory ID. User collections and marketplace links keep these IDs. A stored record with `fetchedAt >= manifest.snapshotAt` is retained completely, including equal timestamps. The receipt distinguishes `writtenRecords` from `retainedNewerRecords`; `acceptedRecords` counts verified transport records and does not mean the same number were replaced. The corresponding conditional UPSERT enforces this policy inside the transaction. Existing conflicting provider identities are rejected.

`COMPLETED` means the declared export's count and chain were received, not that GCD's entire catalog, all archive tables or every modern credit were imported. `historicalCoverageComplete` stays false. Full deployment still needs the actual authorized archive, reviewed schema report, a central-storage capacity check, accounting for excluded records/fields and production readback counts. No artwork license, market valuation feed, seller verification or payment protection follows from a bibliographic import.

Keep the existing hourly API continuation for current/previous-week releases after the baseline is loaded. It respects its own saved scope and anonymous quota; the bulk route consumes no supplier API quota. Review the complete archive's actual schema and license before changing the supported projection or claiming broader coverage.

## Focused validation

`node --experimental-vm-modules checks/gcd-bulk.mjs` executes the real route, Drizzle statements and additive migration against SQLite, with synthetic identities and source records. The initial 13 passing cases cover authorization, strict bytes/fields, exact detail readback, equal/newer retention, identity and sequence checks, checksum completion, receipt replay, cancellation, atomic rollback, shared-lease theft, offline CSV verification, resume and credential-safe HTTP bounds. Maximum observed SQL binds per statement: 33. These are local integration checks; genuine hosted evidence and broader QA are separate.
