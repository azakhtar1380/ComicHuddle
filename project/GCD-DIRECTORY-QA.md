# Compact Directory and GCD — independent QA

**13 October 2026: frozen automated candidate PASS.** The final aggregate exits **0** with **792 named Node groups** and **16 Python tests**. Separate native evidence records **22 handler groups**, **7 modeled geometry cases**, strict TypeScript and unsigned web/iOS/Android exports. The 197 recorded web/reference source and configuration hashes match after the final run.

This report supersedes the earlier scan candidate for the current revision. The [749-group scan evidence](SCAN-ARCHITECTURE-QA.md) remains a historical record. The application still uses D1/R2; PostgreSQL remains a separately runnable reference implementation.

## Executed command and counts

From `/workspace/sites/panelry`:

```sh
PGLITE_MODULE=/workspace/scratch/comichuddle-pg-qa/node_modules/@electric-sql/pglite/dist/index.js node checks/run-readiness.mjs > project/evidence/gcd-directory-readiness.log 2>&1
```

The [complete log](evidence/gcd-directory-readiness.log) is **98,694 bytes**, SHA-256 `0cfd572e5d4da1106f8cf090ab5d056b8d6ad89d4d86598ef1e0584c64755b66`. The [machine verification record](evidence/gcd-directory-verification.json) contains all named suite totals, test reports, Node version, base commit and tested source hashes. A [separate source snapshot](evidence/gcd-source-freeze.json) records the frozen working tree; the lead records the release commit/build/deployment separately.

| Executed category | Passed | Failed |
|---|---:|---:|
| Web API/domain/client named groups | 719 | 0 |
| Architecture TypeScript unit cases | 13 | 0 |
| Actual PostgreSQL WASM engine/role/rollback smoke | 3 | 0 |
| Actual PostgreSQL schema/domain integration | 30 | 0 |
| Actual PostgreSQL restricted-role/reference HTTP/ownership adapter integration | 27 | 0 |
| **Named Node total** | **792** | **0** |
| Existing Metron Python operator runner | 9 | 0 |
| New GCD Python operator runner | 7 | 0 |
| **Python total** | **16** | **0** |
| Native controlled handler/API-state groups, separate owner log | 22 | 0 |
| Native source-derived viewport/cover geometry cases | 7 | 0 |

Network/privacy/dialog/query-budget checks, TypeScript and cover-index regeneration also pass. Supporting checks are not added again to the named-group count. Each named case is counted once; a case may contain several assertions. Provider HTTP responses and authenticated identities in automated suites are controlled fixtures.

## Compact cards and exact details

The new [compact component/lifecycle suite](../checks/shared-directory-compact.mjs) passes **10/10**. Actual parent/local React component code shows only cover or neutral placeholder, series/issue, publisher and More info in both grid and list. Each whole-card control forwards the selected full issue record without collection, wants, price, source or purchase actions. Checks cover failed/replaced images, escaped text, exact GCD numeric identity, immediate abort/debounce invalidation, reversed responses, publisher/series/page requests, malformed/wrong-page errors, retry, partial coverage and unmount. Image bounds and keyboard-focus styles are source contracts; no browser layout result is inferred.

The new [Hub details suite](../checks/hub-detail-lifecycle.mjs) passes **6/6**. Actual Hub controls, current selector, detail JSX, parser and product-card callbacks fetch the exact selected GCD ID with same-origin/no-store options. Validated bibliography and structured story credits/synopses/notes are retained. Original cover price is explicitly labeled publisher price, not FMV; both guide modes remain Coming soon. Wrong IDs, missing/malformed bibliography and HTTP failures retain the selected issue and an actual Retry control. Reversed completions, close/navigation and stale failures cannot replace a newer selection or reopen closed details.

The preserved [architecture product-card/buyer-badge suite](../checks/directory-product-card.mjs) passes **15/15**. The [actual route/SQLite sketch suite](../checks/sketch-launch.mjs) passes **49/49**, including compact click → actual Hub selector/JSX → actual card form → conditional vault route → SQLite → owned/private/public responses. Raw/slab metadata, integer-cent cost, exact Buy identity, one-copy retry and changed-payload rejection remain covered. Existing owner-edit/privacy/trade/scanner journeys remain. Actual dialog keyboard handlers defer Escape/Tab/ShiftTab to an open native collection form and resume outer Escape handling after closure; physical focus behavior is unverified.

## GCD database, importer and regressions

The [GCD central catalog suite](../checks/gcd-sync.mjs) passes **23/23** against actual route/helper code and isolated SQLite/D1 adapters. It covers additive migration and legacy identity preservation, owner/private-service gates, Origin/MIME/body caps, bounded metadata/streams, exact provider URLs/pagination, resumable current/previous-week sweeps, next-day refresh, pause/resume, persistent 26/hour budget, Retry-After, access refusal, atomic batch failure and stolen leases. Historical series/issue manifests, detail fallback for summary series, empty-series work limits, unavailable issues, count reconciliation and recent-release priority remain separate from Metron state. Maximum D1 binds are **80**. The Python runner's **7** cases cover bounded orchestration and safe retry/reconciliation with controlled HTTP.

Independent integration caught and verified repairs for two production-path defects:

- Metron-only listing logic could accept a GCD record against the same raw Metron ID, produce the wrong listing anchor and drop GCD identity from public DTOs. Tests now prove identical labels/raw IDs stay separate, GCD listing works without a Metron counterpart, exact Buy filters keep GCD identity, unrelated Metron changes do not block it, and a selected GCD change before the SQL batch yields 409 with listing/inventory/financial state rolled back. [The original failing log](evidence/compact-gcd-defect-sketch.log) is retained.
- A first stored GCD row could hide the 43 fallback starter records. Guarded idempotent starter inserts repair that transition. The independent actual importer → SQL → catalog API → compact callback case proves 43 starter plus one GCD row, retained searches and exact IDs 0/24/42, and unchanged preexisting owned links/vault data.

Legacy Metron **37/37** checks remain. Four old client fixtures were narrowly adapted to exclude a new JSX rendering function from pure-helper extraction; cancellation/filter/error/reset assertions remain. Public source links are tested through actual canonical normalization, SQL and catalog API instead of the retired Directory URL helper. JavaScript/data/foreign upstream references cannot become public provider links.

The pre-starter-patch aggregate also passed, but is [retained only as an intermediate run](evidence/gcd-directory-before-starter-preservation.log). Its count/source snapshot is not the final verdict.

## Actual public access and coverage

Automated suites make **0 genuine provider calls** and **0 genuine payment executions**. Separate lead-owned records contain **four documented genuine HTTP 200 public GCD API responses**:

| Evidence | Observed result |
|---|---|
| [Issue and series probes](evidence/GCD-PUBLIC-PROBE-2026-10-13.json), 20:58 UTC | Issue 256114, Batman: Dark Victory (1999 series) #12; series endpoint count 233,584 |
| [Weekly probe](evidence/GCD-WEEKLY-PROBE-2026-10-13.json), 21:14 UTC | 2026 week 42 count 162, first page 50 summaries and a next page; publisher/stories require exact issue detail |
| [Series probe](evidence/GCD-SERIES-PROBE-2026-10-13.json), 21:17 UTC | Provider series count 233,585, first page 50 series records with active issue identities |

These are observed provider counts, not ComicHuddle imported-issue counts. The changing series count also illustrates why a fixed full-archive snapshot is not inferred. Current/previous-week refresh does not make the full historical archive current. The Directory reports partial coverage and labels the maximum successful stored-record timestamp as **Latest GCD record update**, distinct from completed sweep time.

Actual deployed import counts, hourly continuation/daily completion, Site ingress authentication, build and publication outcomes must be read from the launch kit's publication record. Local owner/private-service fixtures do not establish production authentication or scheduled execution. See the [operator contract](GCD-CENTRAL-CATALOG.md) and [release description](GCD-DIRECTORY-RELEASE.md).

## Native artifacts and remaining acceptance

The [native owner record](evidence/gcd-native-readiness.json) includes the actual executed commands and raw logs. [Independent artifact reconciliation](evidence/gcd-native-artifact-verification.json) verifies **14 source/config hashes**, **3 raw-log hashes**, **31 export-file hashes**, the copied Site preview bundle and **7** copied/referenced web assets. Web JavaScript and HTML are byte-identical across the two native export trees; their metadata manifests intentionally describe different platform sets.

The same-origin web preview uses central catalog query/publisher/paging and exact-ID details. iOS/Android retain the labeled 43-record snapshot plus full-directory website handoff. Exports are unsigned; the native app has no independent authenticated catalog/account/commerce persistence or native camera-frame matching. The web scanner still has six authorized local cover references.

[Five prepared Playwright acceptance cases](../architecture/e2e/README.md) include compact click → exact details/actions and the opt-in test-account ownership save; they are syntax checked and **unrun** here. Physical browser/device/simulator rendering, camera behavior, real OAuth and processor outcomes remain unverified. Actual PostgreSQL tests use PostgreSQL 18.6/PGlite 0.5.9 with one WASM backend; the two prepared separate-server race cases remain unrun. Passing these tests does not establish a production PostgreSQL cutover, complete historical GCD coverage or a public commercial launch.
