# Central shared-catalog QA

Date: 2026-10-10. Independent QA for the centralized Metron import and shared Directory. The focused suite passes; no genuine Metron account, provider request, hosted identity or complete catalog import is verified here.

## Executed evidence

| Command | Result | Scope |
| --- | --- | --- |
| `node --experimental-vm-modules checks/metron-sync.mjs` | Exit 0; 37 passed, 0 failed | 29 actual-handler/database or migration groups and 8 actual extracted client-callback groups |
| `node --experimental-vm-modules checks/journey-integration.mjs` | Exit 0; 35 passed, 0 failed | Existing collector, collection, care and fixed-sale route journeys |
| `node checks/journey-client.mjs` | Exit 0; 30 passed, 0 failed | Existing picker, account handoff, care and collector-network response races |
| `node checks/navigation-community.mjs` | Exit 0; 28 passed, 0 failed | Existing navigation, own-profile, Community and isolated legacy Metron-controller regressions |
| `git diff --check` | Exit 0 | Whitespace check |

These are 130 named focused/regression groups, not 130 browser journeys. The complete project readiness runner is a separate parent-run check. Existing journey fixtures were updated only to supply the real `issueIdentity` helper and the new navigation refs; their named counts and assertions were preserved.

The central suite executes the actual TypeScript modules, Drizzle queries and transactions against isolated SQLite with foreign keys enabled. Provider HTTP, trusted visitor identity, bucket objects and time are synthetic. All named groups must finish; failures produce a nonzero exit. No production profiles, messages, provider account or financial transactions are created.

## Verified behavior

- Starter seeding is idempotent. The 43 credited starter records remain searchable without an account or provider request.
- New imports use stable `1,000,000,000 + Metron ID` directory identities, normalized publishers/series/creator-role relations and exact source/license provenance. Public imported DTOs exclude source artwork, raw source payloads and FMV. Source payloads remain separate from public metadata.
- Search, filters, ordering, exact lookup, bounded multi-ID lookup and pagination read stored records. Valid offsets 100,001 and 2,147,483,647 beyond the matching count return an empty page without an offset row query or provider request; 2,147,483,648 is rejected. Imported physical copies save canonical series/issue identity with external provenance, private estimates and vault versioning. Imported wants must reference actual stored rows; phantom wants and conflicting identity combinations leave the vault unchanged.
- Each sync step is capped at four synthetic external requests and eight processed records. Valid later pages are stored when the source count grows; each pass reconciles unique IDs against its final reported total. A growing first pass can complete after a stable second manifest. Contradictory final coverage, truncated/repeated pages and differing two-pass ID sets never advance the watermark, while valid records remain stored. Stale detail metadata retains its pending checkpoint.
- Local request budgets, 429 retry delays, rejected credentials, unsafe pagination/redirects, malformed or oversized responses and vanished records fail without leaking the fixture token or advancing invalid work.
- Failed atomic record writes roll back normalized relations and retain the pending record. Concurrent steps respect the persisted lease; a displaced worker cannot write through or release a newer lease. Transient operation guards remain empty after success and rollback.
- Owner-only status/actions, same-origin writes, strict request bodies and explicit private-service flags are exercised. A browser Origin or a signed-in nonowner cannot select the service path. Deliberate owner pause blocks nightly work until manual resumption; overlap and weekly full-refresh selection preserve the saved scope. Scheduler status follows the runtime flag.
- Actual Directory read effects suppress obsolete success/error/finally callbacks after input, filter, reset or unmount changes. The owner panel performs only a status read on mount, blocks duplicate writes, supersedes obsolete reads and recovers a failed step through a status GET without retrying the POST. Scope submission excludes blanks and credentials.

Measured maximum prepared-statement parameter count: **30**, below the hosted D1 cap of 100. Final focused rerun after large-offset and growing-source reconciliation changes passed **37/37** and prepared **3,187** statements across its independent fixtures. These are fixture measurements, not production load or latency benchmarks.

Migration 0009 contains **13 complete physical statements: seven tables and six indexes**. Both individual physical-line execution and installed Drizzle breakpoint parsing pass, with no empty trailing migration statement. This does not substitute for a hosted migration run.

## Findings resolved during review

The initial suite reproduced two runtime defects: a contradictory source count could certify an incomplete scan, and an older detail modification could consume a newer queued list entry. Root fixed count/cardinality reconciliation and stale-detail validation; both regressions pass. Follow-up architecture review identified that restarting immediately on any later count change could repeatedly prevent traversal of a catalog growing during a long backfill. Reconciliation now waits until pass end against the latest total; the new growth regression passes and the contradictory final-count fixture verifies that later valid records are retained without advancing the watermark. Two-pass checks provide observed coverage, not a point-in-time source snapshot. An invalid step previously risked changing idle/complete lifecycle state; its preservation regression passes. A trailing migration breakpoint created an empty installed migration statement; the corrected shape passes. Intermediate client-fixture adjustments followed stricter DTO validation and the new failed-write status recovery; they were not reported as product defects.

No remaining reproducible failure was found in the covered focused scope.

## Boundaries

**Genuine Metron requests: 0.** Business-owned provider access, provider-specific production rate behavior, account policy/commercial clearance, real provider coverage and actual nested-source payload compatibility remain unverified. No cover-image or price-feed permission is established by these tests.

The route fixture replaces trusted authentication. It tests the application's private-service conditions, not the outer owner-private Sites dispatch or its authorization credential. Public-audience changes require the hosting/service-access review documented by the implementation.

No supported browser controller was used. These tests do not verify DOM interaction, visual layout, hosted OAuth, mobile devices, native signup or genuine payments. Scheduling status is tested as configuration and pure route behavior; this report does not assert that a nightly job is installed or running. Hosted deployment/readback and the complete regression runner are recorded separately by the parent release work.
