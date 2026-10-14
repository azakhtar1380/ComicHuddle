# Community, navigation and directory QA

The frozen revision passed `node checks/run-readiness.mjs` with exit code **0** on October 9, 2026: **496 named isolated groups passed; 0 failed**. The retained 388 groups remain in the runner; this revision adds 108 groups. Broad network, PWA privacy, dialog-focus and strict web TypeScript checks also passed. `git diff --check` passed.

This is source, actual-handler and client integration evidence. It is not a live browser, OAuth, hardware or financial transaction result. No production accounts or messages were changed by QA.

## Reproducible evidence

Run from the website repository:

```sh
node checks/run-readiness.mjs
```

The complete output is retained in [COMMUNITY-READINESS-2026-10-09.txt](evidence/COMMUNITY-READINESS-2026-10-09.txt). The runner stopped on nonzero outcomes; every named suite's completed summary was checked, rather than inferring completion from partial PASS lines.

| Suite | Named groups passed |
| --- | ---: |
| Readiness negative routes | 34 |
| Community actual routes | 31 |
| Metron proxy, metadata and memory-controller integration | 46 |
| External-catalog vault actual routes | 3 |
| Marketplace actual routes | 49 |
| Disabled purchase boundary | 27 |
| FMV research prototype, synthetic samples | 43 |
| Pure commerce policy | 36 |
| Stripe sandbox adapter, synthetic HTTP/signatures | 53 |
| Commerce actual routes, fake Stripe transport | 49 |
| Legacy migration/inventory delta | 6 |
| Prior client response-order regressions | 26 |
| Collector/workshop route journeys | 35 |
| Prior journey client regressions | 30 |
| Navigation and new Community client integration | 28 |
| **Total** | **496** |

The existing journey-client fixture now imports the actual section-navigation module required by the revised account-intent helper. Its 30 behavioral assertions were preserved.

## New journeys exercised

| Journey | Verified behavior and negative cases |
| --- | --- |
| Navigation and My Profile | Seven web destinations and six unique mobile destinations; archived FMV/GrailMatch calls and deep links resolve to Upcoming; My Profile/Comic Workshop aliases work; member owner-only links fail closed while owner support links remain usable. Opening My Profile on the same internal tab cancels a pending peer lookup; explicit peer links still resolve. Account return paths preserve role and app context locally. |
| Groups and feed | Real profile creation, join/leave, discovery, multi-group feed, channels, literal search and active/recent sorting. Private bodies, replies and attachments are denied to nonmembers; both block directions, moderation and account restrictions suppress relevant content. Hidden showcases can participate within joined groups. Keyset pagination has bounded pages and no equal-timestamp duplicates. |
| Posts, photos, replies and hearts | Actual post/photo ownership checks; one exact-intent heart per member under concurrent duplicate commands. Commit-boundary membership, block, deleted-parent/profile and attachment races roll back safely. Group owners and authors can remove permitted content; operator reports remove descendants. Exports include the caller's replies/reactions. Account deletion removes other members' descendants of deleted own posts while preserving unrelated posts. Injected cleanup failure rolls back the transaction. |
| Community client lifecycle | Actual loaders and form callbacks execute with per-render closures and controlled delayed responses. Older responses/errors cannot replace newer selections; private feed/thread content is masked after identity or membership changes; unmount/dismissal cancels late work. Cursor append deduplicates IDs. Native create/compose intents survive initial identity loading. Group creation survives the legitimate autojoin refresh but ignores a different account, view or dismissed dialog. |
| Metron and personal copies | Actual protected route uses synthetic provider responses; caller tokens remain ephemeral and isolated, with disconnect/signout/unmount/replacement races covered. Fixed-host pagination, bounded requests/responses, current-rule gates and per-user limits are checked. Metadata DTOs omit artwork, synopses and prices. Actual vault POST/GET and account export preserve the external ID/source/license, copy identity, condition, private cost and owned photo. Invalid source URLs, IDs, provider/license and secret fields fail without replacing the stored collection. Simultaneous starter and external identities are rejected; manual copies stay compatible. |

The new Community client's effect ordering, stale mutation refreshes, private-thread session guards, creator autojoin completion and search limit were corrected before the final run. The My Profile intent and profile-keyed Metron view were verified. No unresolved failure remained in the exercised isolated scope.

Migration 8 was checked as ten complete schema-only physical statements against existing pre-8 rows. A formatting-only follow-up aligned its inline Drizzle markers with migrations6/7; the independent Community suite then passed31/31 again, including ten installed-Drizzle split statements. That follow-up is appended to the evidence and is not added to the496 total. Applied migrations 0–7 were not rewritten. New Community fixtures recorded **6 feed queries, 5 discovery queries and at most 24 bound parameters** against the hosted cap of 100. Retained dense budgets were social 23/40 queries, workshop 20/40 and care-job detail 6/10.

## Native result

The independent native command `node checks/run-readiness.mjs`, run from `ComicHuddle-App`, exited **0**: **13 actual TSX handler groups**, seven phone/tablet/landscape cover bounds and strict TypeScript passed. One six-tab dock, exact My Profile handoff, Community group/composer intents and bounded proportional artwork were checked. Upcoming had both coming-soon labels with no active FMV/GrailMatch controls. The native developer also completed unsigned web/iOS/Android exports. These checks do not establish real-device rendering, native authentication, store acceptance or persisted native journeys.

## Release limits

- No supported browser/controller capability was available for hosted browser E2E. Real ChatGPT OAuth, keyboard/screen-reader behavior, browser layout and physical iOS/Android operation remain unverified.
- Metron tests used synthetic responses and a caller-supplied token fixture. **No genuine Metron account lookup was executed**; account access and upstream completeness are not confirmed. The curated starter index remains available; this is not a complete comic/variant catalog or a licensed modern cover feed.
- The public FMV and GrailMatch guides are unavailable under Upcoming. Older backend contracts remain regression-tested; those tests do not make them active user features. Unknown marketplace FMV stays unknown, and the independent estimator remains uncalibrated research with synthetic inputs.
- Payment coverage retains fake-provider route tests and synthetic adapter/signature tests. **Genuine Stripe charges, refunds, transfers and payouts executed: 0.** Live financial readiness, carrier verification and public commercial policies remain separate gates.
- Dependency audit numbers in prior project reports are retained assessment evidence; no new dependency audit was run for this revision. Legal/data/image/brand clearance and hosted deployment verification are outside this isolated QA result.
