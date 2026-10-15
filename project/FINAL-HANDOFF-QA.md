> Historical QA record, 13 October. For the current Vercel/RDS app, actual sandbox receipts and incomplete release gates, use [Launch stabilization — 15 October](LAUNCH-STABILIZATION-20261015.md). These earlier test totals do not certify the current deployed system.

# Mobile directory, bulk importer and source handoff — independent QA

**13 October 2026: frozen automated candidate PASS, exit 0.** The final aggregate passes **820 named Node groups** and **28 Python tests**. This preserves the previous 792/16 baseline and adds 7 mobile two-column groups, 5 independent containment groups, 16 bulk integration groups and 12 Python SQLite archive tests. All **239** recorded source/configuration/export hashes match after the run.

The [complete raw log](evidence/final-handoff-readiness.log), [machine verification](evidence/final-handoff-verification.json) and [tested source snapshot](evidence/final-handoff-source-freeze.json) record the command, source hashes, counts and boundaries. Build/private deployment and genuine hosted data readbacks are separate lead-owned release evidence. The earlier [GCD QA report](GCD-DIRECTORY-QA.md) remains a dated baseline, not this revision's verdict.

## Executed checks

```sh
PGLITE_MODULE=/workspace/scratch/comichuddle-pg-qa/node_modules/@electric-sql/pglite/dist/index.js node checks/run-readiness.mjs > project/evidence/final-handoff-readiness.log 2>&1
```

| Executed category | Passed | Failed |
|---|---:|---:|
| Web API/domain/client named groups | 747 | 0 |
| Architecture TypeScript unit cases | 13 | 0 |
| Actual PostgreSQL WASM engine/roles/rollback smoke | 3 | 0 |
| Actual PostgreSQL schema/domain integration | 30 | 0 |
| Actual PostgreSQL restricted-role/reference HTTP/collection adapter integration | 27 | 0 |
| **Named Node total** | **820** | **0** |
| Existing Metron Python runner | 9 | 0 |
| GCD Python runner | 7 | 0 |
| SQLite archive adapter Python tests | 12 | 0 |
| **Python total** | **28** | **0** |

Strict TypeScript, whitespace validation, browser-spec syntax, privacy/query-budget/dialog/network supporting scripts and six-reference cover-index verification also pass. Supporting scripts are excluded from the named-group count. The raw log's 818 `PASS:` lines include seven Python runner lines and four supporting-script lines; the separately reported 13 Node unit cases produce the stated 820 named Node total. A named group may contain several assertions.

## Screenshot regression: bounded mobile layout and compact cards

The [mobile two-column suite](../checks/mobile-two-column.mjs) passes **7/7**. Actual parent/local card callbacks and the source CSS cascade retain two compact portrait cards at 320, 360, 390, 430 and 760 pixels for both Grid and an existing desktop List selection. Above 760 pixels, desktop List remains horizontal. Whole-card More info forwards the exact issue identity. The cover frame is 3:4 with a 210×280 maximum, and the image/neutral placeholder remains contained; title and issue text wrap.

The independent [root containment suite](../checks/directory-containment.mjs) passes **5/5**. It follows the actual JSX ancestry and CSS in two stylesheet orders with very long unbroken series, issue and publisher strings. It verifies:

- No breadcrumb navigation before or after selecting a publisher.
- The publisher/series tree contributes no mobile layout at 320, 375, 390, 430, 700 and 760 pixels.
- Root/grid descendants, filter labels/native selects and search flex children can shrink within bounded widths. Select and search text are 16px. There is no root horizontal overflow mask used to conceal the defect.
- Desktop publisher text wraps in contained tracks, and its actual click callback retains the complete publisher identity.
- Both mobile Grid and desktop List state use two `minmax(0,1fr)` tracks, with full publisher identity and portrait compact controls.

The preserved compact lifecycle suite passes **10/10** and exact-detail lifecycle suite **6/6**. Cards contain only cover or a neutral missing-cover icon, title/issue, publisher and More info. Clicked details retain the full metadata/actions, exact central directory ID, retry behavior and stale-response protection. No unrelated cover is substituted for a comic without licensed artwork.

These checks model CSS cascade/box constraints and execute real component callbacks. They do **not** render browser font/native-select intrinsic sizing, reproduce the supplied screenshot in a browser, or establish a physical iPhone visual result. Thirteen [prepared external Playwright cases](../architecture/e2e/README.md) are syntax checked and unexecuted; three specifically stress long publisher/title/issue fixtures at 320/375/390 pixels and measure actual root/search/filter/card rectangles.

## One-time GCD bulk path and ongoing API preservation

The [bulk integration suite](../checks/gcd-bulk.mjs) passes **16/16** against the actual route, Drizzle statements, additive migrations and isolated SQLite/D1 adapter. It checks owner/private-service/Origin gates, strict fields and actual byte caps, source provenance, exact metadata readback, ascending unique IDs, bounded batches, checksum completion, cancellation, equal/newer snapshot retention, lease theft, atomic rollback and receipt replay. Maximum observed binds per bulk statement: **33**.

An independent complete local journey creates a tiny synthetic supplier-schema SQLite archive, invokes the **real read-only Python CLI**, converts its JSONL into sorted checked CSV/manifest, invokes the **real bulk route uploader**, and reads the resulting stored catalog through the **actual overview, search and exact-ID API**. It reconciles two active identities, a variant's canonical parent, publisher, original price label and story credits. Deleted issues/stories, private fields, artwork and FMV never enter the transport. The archive bytes/hash remain unchanged. The adapter's field limitations remain explicit.

The response-loss case commits the first eight rows and then loses that batch's response. A second real uploader invocation reads its saved run cursor, skips those committed rows, writes the remaining two once and verifies completion. A separate conflicting-provider case rejects a GCD directory row marked with another provider, preserving every stored byte and leaving receipts/cursor unchanged. Late receipt failure rolls the entire catalog batch back before exact retry succeeds.

Bulk ingestion preserves the GCD weekly/historical state, counters, retry timestamp and owner pause; it preserves Metron state/secrets. The existing GCD API suite still passes **23/23**, including quota waits, current/previous-week priority, reconciliation, bounded continuation and starter preservation. No supplier request is made by the offline/bulk test journey.

`COMPLETED` means the supplied normalized export's declared count/checksum reconciled. It is **not** a claim that the full GCD archive or all bibliographic fields are present. No full authorized archive was available to these tests. The SQLite adapter reconstructs bounded core bibliography/legacy text and reports unmapped modern linked fields. Full-catalog ingestion still requires the real authorized archive, schema/capacity review and actual readback reconciliation.

## Native artifacts and acceptance boundaries

The [separate native owner evidence](evidence/two-column-native-readiness.json) records **23 handler/API-state groups**, **7 cover/dock geometry cases**, **5 mobile card width cases**, strict TypeScript and successful unsigned web/iOS/Android exports. These counts are separate from the 820/28 aggregate. [Independent artifact reconciliation](evidence/final-native-artifact-verification.json) verifies **31 export hashes** and **all 11 hosted app-preview files**, whose tree is byte-identical to the current Expo web export.

The hosted mobile preview queries the central saved catalog and exact-ID details. iOS/Android retain the labeled 43-record snapshot and website handoffs; native authenticated persistence/camera-frame recognition is not established. The web scanner has six authorized local cover references. Neutral cover placeholders are intentional where artwork rights are unavailable.

Automated suites execute **0 genuine supplier calls** and **0 genuine processor transactions**. Actual source probes and deployed importer readbacks belong to separate release evidence. Physical browser/device/simulator, hardware camera, real OAuth, signed native builds and processor acceptance are **unexecuted**. PostgreSQL 18.6/PGlite 0.5.9 provides one actual WASM backend; the two prepared separate-server concurrency cases remain unexecuted. Production storage remains D1/R2 and the PostgreSQL schema is a runnable reference. Passing these local checks does not certify complete catalog coverage or a public commercial launch.
