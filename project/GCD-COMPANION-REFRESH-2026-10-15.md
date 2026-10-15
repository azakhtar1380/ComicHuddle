# ComicHuddle native companion refresh

Published October 14, 2026 in America/Chicago (October 15 UTC). Runtime source commit: `fb219d3`.

Public preview: https://comichuddle-abdul-aziz-akhtars-projects.vercel.app/

## Confirmed source state

All four operator-created indexes are valid: `gcd_story_issue_id_type_id_sequence_number_idx`, `gcd_issue_series_id_idx`, `gcd_series_name_idx`, and `gcd_series_publisher_id_idx`. No additional indexes were created in this run.

The native `gcd.gcd_series` table has **0 rows**. `gcd.gcd_publisher` has **17,725 rows**. **`gcd.gcd_cover` is absent**. The planner reports zero estimated story rows; that estimate is not an exact story count. An empty index does not supply missing source metadata.

The exact issue recount and directory coverage refresh exceeded their bounded maintenance timeouts. The app preserves the last verified count: **2,390,305**, observed **2026-10-15T00:06:09.943Z**. The newer physical issue estimate of 2,621,681 is an estimate and is not used as an exact catalog count. No new source dataset or artwork was imported.

## Changes

Native cover references now support the standard GCD cover-ID layout, using the issue's own cover ID and the official 400-pixel thumbnail path. Issue IDs are never guessed as image filenames, and variants do not borrow their base edition's artwork. Deleted, restricted and locally withdrawn references are excluded. Native restrictions override retained references.

The server detects a newly loaded `gcd_cover` table with a 60-second capability cache. Exact native lookups use raw `issue_id` to benefit from its index. Retained reference reads remain separate from the native union view. Cover lookup failures preserve the comic metadata and use placeholders. The native-image path cannot be verified against actual native cover rows until that source table exists.

The release also adds Vercel Fluid Compute pool cleanup with pinned `@vercel/functions` 3.10.1, shorter idle retention, connection keepalive and sanitized idle-connection error handling. TLS certificate and hostname verification remain enabled. After this release, the public directory recovered from connection timeouts. The cloud connectivity probe completed in 178 ms; its current-database activity sample had one active and 19 idle connections, with a server maximum of 79. This sample does not by itself establish the earlier timeout's cause.

## Validation and remaining input

Production compilation and public read checks completed. The browser displayed 12 cards with the saved full-catalog count. The offset-7,000 request returned two native records in 3.53 seconds. Exact route outcomes and the screenshot are stored in `project/evidence/NATIVE-COMPANION-REFRESH-2026-10-15.json`. Optional test suites and transactions were skipped. No complete end-to-end payment, scanner, native cover or full-dump reconciliation claim is made.

To complete the source import, supply the missing `gcd_series` data and authorized cover metadata (`gcd_cover`, or an exact issue-to-cover export) from the matching GCD snapshot. Story/creator enrichment also requires its source story records. Creating empty tables or more indexes will not provide those records. No complete source archive is present in this workspace.

Expected identity joins: `gcd_issue.series_id` to `gcd_series.id`; `gcd_series.publisher_id` to `gcd_publisher.id`; `gcd_cover.issue_id` to `gcd_issue.id`. Source cover IDs, deletion/restriction flags, attribution and image rights must be retained. Native covers should have an index beginning with `issue_id` before a large cover import is exposed to visitors. Artwork is not covered by the GCD bibliographic metadata license.
