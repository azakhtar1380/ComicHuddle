# ComicHuddle readiness QA

Audit date: October 9, 2026 UTC / October 8, 2026 in Minnesota. Starting source commit: `9b89c0733bca1ba21a31e203ba778028dfecca6b`. Independent QA completed against the corrected working source; the project lead owns final build, private deployment and artifact publication.

## Release assessment

The existing application supports a private collector prototype. It is not yet a complete public commerce product or a signed native store release. QA is hardening the current implementation and making release blockers explicit; a successful automated check does not prove that all real device, payment, legal, or operational requirements are satisfied.

All tests in this pass use local source, isolated in-memory SQLite, simulated object storage, controlled response ordering, or build tooling. No real customer account, hosted listing, care request, payment, or private hosted record was changed by QA.

## Findings reproduced and addressed

| Finding | Baseline reproduction | Remediation / verification |
|---|---|---|
| Collector removal could be undone by editing the removed profile | Owner hides the profile; the same user saves `visible: true`; profile becomes discoverable again | Persistent moderation holds and owner-only restoration. Delete/recreate bypass is also covered. |
| Moderated pressing studio could republish | Owner hides the provider; the provider updates its registration with `visible: true` | Provider hold, owner restoration and account hold persistence regressions pass. |
| Reports accepted nonexistent or inaccessible content | A user submits any target ID, including a private message from a conversation they do not belong to | Reports must refer to content the reporter can see. Dedicated identities avoid obscuring visibility tests with reporting quotas. |
| Blocked collectors could still retrieve publicly shared photo URLs | Upload a listing photo, block its owner, then request the same media ID | Block-aware public access and `private, no-store`; private care participants retain record access. |
| Collection schema accepted duplicate/empty book IDs and dangling trade IDs | Valid-looking vault POST contains invalid identifiers; API returns 200 | Stronger schema refinements; negative fixtures expect 400. |
| Simultaneous collection saves could overwrite each other | Multiple tabs save full collection snapshots | ETag/If-Match and conditional database writes. Concurrent requests sharing one version must produce one 200 and one 409, with the winning content preserved. |
| Withdrawn listing still had pending offers that could be accepted | Buyer offers; seller withdraws; seller accepts the old offer | Withdrawal closes pending offers and response/insert writes validate the active listing. |
| Primitive JSON payloads caused internal errors | `null` request body produces 500 | Bounded JSON-object parsing returns a controlled 400. |
| Mutation budgets could be bypassed by concurrent requests | Count-then-insert limits have no atomic guard | Persisted atomic minute/day/action counters. A 15-request concurrent post fixture permits ten writes and returns five 429 responses with retry information. |
| Old private chat/group responses could overwrite a new selection | Fetch A starts; collector selects B; fetch B completes; fetch A completes last | Request generation and current selection guards. Actual loader functions are extracted from source and run with deliberately reversed response order. |
| Message draft moved to a different recipient | Start composing to collector A, then select collector B | Conversation effect clears the old draft. |
| Native icon-only hero action lacked a screen reader name | Source inspection of the Home hero Pressable | Accessible label and scrollable account sheet added by the project lead; device screen reader confirmation remains pending. |

The initial backend negative suite contained 18 test groups: seven passed and eleven failed. The initial ten client response-order tests all failed against the starting commit's actual functions, then all passed after remediation. The expanded client suite now has 26 passing groups, including profile selection/cancellation and conditional collection save behavior. These are test groups, not a claim of eleven independent security incidents or ten unrelated UI bugs.

## Automated evidence

| Command | Scope | Result |
|---|---|---|
| `node --experimental-vm-modules checks/network-smoke.mjs` | Real route code, migrations, identity/origin, owned collection/photos, group access, reciprocal trade matching, messaging, listing/offer flow, unavailable checkout, moderation, deletion, catalog identity, private care addresses/photos, care role transitions, quote revisions, CGC eligibility/authorization, reviews and licensed value import controls | Passed after remediation, including preservation of private care photos after a block and denial of blocked public listing photos. |
| `node --experimental-vm-modules checks/readiness-negative.mjs` | Negative authorization, malformed data, visibility, moderation persistence/restoration, collection conditional writes/concurrency, atomic abuse limits, consent receipts, account export, and offer lifecycle | 34 groups passed after remediation, including malformed/oversized image containers, JPEG metadata before/after scan data, PNG/WebP metadata and animation rejection, legacy collection versioning and concurrent offer decisions. |
| `node checks/readiness-client-race.mjs` | Actual client loader AST under delayed success/failure responses, peer/group selection change and effect cleanup | 26 groups passed on corrected source. The initial ten race groups failed against the starting commit; expanded tests also cover real client bootstrap/commit code and profile cancellation. |
| `node --experimental-vm-modules checks/readiness-query-budget.mjs` | Dense isolated fixtures: 202 profiles, 100 groups/listings/threads, 200 studios and 200 private care jobs; actual prepared-query counts and block/privacy assertions | Passed: social 22/40 queries; workshop 20/40; private job detail 6/10. |
| `node checks/app-privacy.mjs` | Service worker bypass for private APIs/auth, generic offline fallback, no private offline caching, manifest assets | Passed. |
| `node checks/dialog-focus.mjs` | Offscreen drawer focus, scroll containment, keyboard wrap, nested dialog lock and cleanup | Passed. This is simulated DOM verification. |
| `node checks/image-layout.mjs` in native project | Cover aspect ratio, card fit and size caps across seven phone/tablet/landscape viewport dimensions | Passed. This validates sizing calculations, not screenshot appearance. |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` in native project | Native TypeScript consistency | Passed after native changes and dependency installation. |
| Web TypeScript / production build / dependency audits | Build and package vulnerability checks | Project lead reports the corrected web production dependency audit has zero findings. Native audit was reduced from 22 to 15 high graph entries, representing two still-unpatched upstream build-toolchain advisories in braces and node-forge. Patched versions were not available from the configured registry during this pass. Build/export evidence is recorded by the project lead. Advisory graph entries can repeat a transitive issue across multiple paths. |

The VM module flag is required by the route harness and documented in the test file. Running the same script without the flag fails to construct Node VM modules; that is a test invocation issue, not an application failure.

The SQLite mock executes each database batch synchronously inside one transaction before returning its promise. This models the atomicity of D1 batches and avoids a false nested-transaction failure when testing concurrent API requests.

Image tests cover bounded container structure, dimensions and removal of common metadata. They do not fully decode image pixels, prove authenticity, detect every possible payload or certify that every future image format is safe.

## Coverage that still requires external verification

- Real browser and device interaction: iPhone Safari / installed PWA, Android Chrome, desktop Chrome/Edge/Safari, iPad, landscape orientation, keyboard display, safe areas, browser back navigation, font scaling, pinch zoom, drag gestures, slow/offline/reconnect behavior, file picker/photo upload and actual download/share flows.
- Accessibility: VoiceOver and TalkBack reading/focus, text contrast at real sizes, touch target sizing, screen reader behavior in native sheets and nested web dialogs, reduced motion, keyboard-only navigation, high contrast and large text. Source/VM checks are not a WCAG conformance audit.
- Hosted identity and infrastructure: trusted authenticated headers at the managed boundary, unauthenticated exposure after audience settings change, database migration on the hosted deployment, object-storage permissions, operational logs, error alerting, backups and restore drills. Local route isolation does not test the hosting authentication proxy.
- Commerce: no card checkout, seller onboarding, real payment authorization, tax, refund, payout, dispute, shipment or webhook flow is connected. Tests verify that the current API creates no paid order and returns an explicit unavailable response.
- Native releases: local Expo export is not an iOS/Android install, TestFlight/Play internal test, signed store build, store review, crash/performance test or native account implementation. Important account and workshop actions currently open the website.
- Data completeness: the starter catalog contains 43 issues, 30 attributable historical CGC sales and six credited vintage cover images. It is not a comprehensive directory, variant database, licensed modern cover library or live Raw/CGC FMV feed.
- Rights and operation: authorized commercial data/image agreements, named legal operator/contact, enforceable terms/privacy, provider verification, incident/moderation response and commerce protection require business/legal and operational work beyond automated QA.

## Scale and performance follow-up

Current directory routes cap discoverable collectors at 50, listings/groups/threads at 100 and pressing studios/jobs at 200, with no general pagination. The aggregate now batches related records in request-scoped maps; dense fixtures measured 22 social queries, 20 workshop queries and six private job-detail queries, with ownership and blocked content checks preserved. The native catalog renders its finite snapshot directly. A growing public marketplace still needs pagination/search architecture and an independently measured hosted concurrency/load test on representative data. A local query-count budget is not a latency or throughput benchmark. This pass does not claim production capacity, latency, availability, or resilience measurements.

## Release gate

Publish an audience-expanded preview only after final automated results are green and the preview limitations are visible. Treat paid marketplace launch, comprehensive licensed values, and native store distribution as separate release gates. Real-device/browser QA and operator/privacy/support readiness must be completed before claiming public production readiness.
