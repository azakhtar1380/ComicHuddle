# ComicHuddle journey audit — 9 October 2026

The audited source was restored at `b2c5a0d9eb77cbdfe700a4ce0f0d6df6836388bf` (private deploy14), followed by the catalog-picker and verified defect fixes in this working change. This audit traces actual screen entry points, request payloads, TypeScript routes and saved records. It does **not** certify hosted browser E2E or a public commercial launch.

## Execution scope and limits

The route checks run the actual API modules and Drizzle queries against isolated SQLite with a D1-style atomic-batch adapter and an in-memory R2 adapter. Trusted identity is supplied by a fixture at the authentication boundary. Concurrent requests and explicitly timed competing writes exercise guards, response ordering and rollback. Injected storage failures exercise failure handling; they do not establish a measured production outage rate or hosted load capacity.

Client checks execute actual component functions and form handlers extracted from the source, plus the actual catalog-search session. Form handlers use controlled event/FormData adapters and call the real collection API. They cover payload construction, selection semantics and completion/error behavior, rather than rendered controls or HTML validation. Client loader tests use deferred fetch promises, including a transport that resolves after abort.

Managed Linux has no supported browser-control skill in this session; the hosted URL is unavailable to the cloud-browser surface. No local preview server, browser installation or improvised browser control was used. Thus rendered browser navigation, screenshots, touch targets, real OAuth cookies, real cross-account sessions, browser downloads, screen-reader speech and physical-device input remain unverified. No real people were messaged, no production profiles were created and no financial transaction was attempted.

## Explicit journey matrix

“Automated” below means the isolated route/client evidence just described. The browser/device column is a required follow-up, not an implied pass.

| Journey | Actual entry and sequence | Automated evidence / required result | Hosted browser or device follow-up |
| --- | --- | --- | --- |
| Visitor → collector account | Join free or a gated action → Continue with ChatGPT → free collector form → showcase | Anonymous mutation rejection; profile-required saves; explicit current rules; unique handle; owned featured copies; private consent in own export | Real sign-in/out, return location, edge identity, owner-only audience and independent users |
| Collector → presser account | Workshop Register as a presser / account drawer → collector role choice → studio form | Same collector identity can own one studio; discovery and messages required; edit preserves studio ID | Preserve provider intent across authentication reload and native browser handoff |
| Directory selection → owned comic | Account drawer → Add comic → directory search → choose exact issue → save | Actual search session consumes real catalog route; exact canonical series/issue; copy ID, grade, private estimate and photo retained; conditional save/version | Search typing, focus, keyboard selection, retry UI and iPhone/Android keyboard |
| Unlisted comic → owned record | Add comic → Unlisted comic → personal title/edition → save | Actual form creates unlinked record; no guessed catalog ID or FMV; distinct physical copies; no-selection form refuses save | Manual fields, validation messages and screen-reader labels |
| Edit owned comic | Collection → Edit condition & edition → exact selection or Unlisted comic | Actual handler preserves copy/photo; canonical re-link; explicit unlink; listed-copy edit blocked; stale save leaves completion pending | Verify all copies in a collection listing are protected by the rendered edit entry |
| Photos and showcase | Add own photo → choose featured grails → another member views showcase | Photo ownership; bounds/metadata controls; public DTO excludes cost and consent; blocks remove public media; private cache no-store | Camera formats, orientation, interrupted uploads and image rendering |
| Presser studio → directory | Register studio → services/prices/intake/portfolio/terms → submit → owned desk and listing | Scope, turnaround, HTTPS URLs, CGC support consistency, owned photos; paused/hidden studio management; no private intake address in public DTO | Full rendered form, portfolio layout and discoverability across real users |
| Request assessment/pressing | Provider card → Request quote → own books (up to20), declared values, service/intake and scope consent | Reject foreign/duplicate/missing books, unoffered service/intake and incompatible CGC request; safe snapshots omit private cost | Real multi-user request, notifications and shipment-risk comprehension |
| Quote → acceptance | Provider desk → itemized quote → collector review/acceptance | Revision conflict; concurrent revision/acceptance; frozen terms; private intake stays locked before acceptance, including full-account export | Display latest terms/fees, consent controls, direct provider payment arrangements |
| Mail-in custody → receipt | Approved → collector shipped → provider intake → care → return shipment → collector receipt | Role-specific stages, required tracking, exact timeline, private participants/photos, no provider-completed receipt | Actual insured shipping and courier tracking; neither is connected |
| Local drop-off → pickup | Approved local job → provider received → care or explained unsuitable return → collector received | No incoming shipment stage; return shipping charge zero; provider cannot confirm collector receipt | Location/pickup arrangement, soft keyboard and return instructions |
| CGC preparation / dealer submission | Service choice → quote → verified-by-collector dealer authorization → submission stage | Preparation-only cannot submit; current declared dealer mode, CGC consent and nonempty reference required | Independently verify eligibility; actual submission, CGC status and fees are not integrated |
| Decline / cancel / unsuitable care | Before custody: decline/cancel; after intake: explained return → receipt | Existing broad route suite covers permitted roles, forbidden stages and explained skip; active accepted jobs block deletion | Cancellation communication, refunds and liability need operational policy |
| Provider reviews / leaderboard | Provider detail or completed job → review → edit/delete/report | Own-service review denied; one review per account; updated score; completed-request badge only after receipt; minimum3 reviews for rank; owner moderation | Verified experience/incentive handling and staffed review disputes |
| Provider restriction during custody | Report → owner hold → provider hidden → return already accepted books | New studio publication blocked; private custody/photo continuity; return and receipt still possible; deletion after completion | Actual staff escalation and customer-property handling |
| Sell one comic | Marketplace → Sell a comic → owned copy/photo/condition → fixed listing | Snapshot, ownership, exact condition/FMV, inventory lock, wrong/empty/foreign input rejection | Rendered editor, phone photos and real seller identity/onboarding |
| Sell collection or bundle | Sell collection → all copies or subset → per-copy conditions → manifest → publish | Up to1000 safe snapshots, quantity totals, paginated UI source, overlap rejection, concurrent all-or-nothing reservation and rollback | Select/review all pages on actual phones; hosted body/query/latency limits |
| Fixed-price buyer interest | Listing → offer → seller response → private message | Actual offer/message journey; sole seller response under race; withdrawal closes pending offers; interest leaves listing active | Real two-user interaction, inbox refresh and support procedure |
| Fixed-price purchase | Listing → review → sandbox checkout → Orders | Legacy buy remains503; new sandbox-only routes create immutable reservations and reconcile signed provider proof in isolated fake-processor tests; real deployed checkout stays disabled | Genuine Stripe account/card/refund tests, reachable webhook ingress, carrier/scheduler, taxes and live seller payments remain unverified |
| FMV coverage on cards | Linked copy + exact Raw/CGC grade/label/printing → licensed estimate | Complete totals only if every copy covered; clearly partial subtotal; unknown never zero; exact quantity; stale/future/expired rights excluded; license reference private | Reconcile a real licensed feed/vendor contract; starter fixtures are not commercial values |
| Start auction preview | Sell a comic/collection → auction duration/increment → publish | Server cutoff; private nonbinding proposals; own/low/late/blocked/restricted bid rejection; fixed offer/buy cannot act on auction | Multi-device timing, displayed countdown and production identity |
| Bid and retry | Buyer consent → integer-cent bid/request UUID → leading/outbid view | Atomic winner; one receipt for concurrent retries; altered reused request ID conflict; no foreign bidder/request tokens | Network interruption and real account visibility at hosted edge |
| Retract auction proposal | Own live proposal → retract consent → refreshed preview | Own latest unretracted only; before cutoff; leader removal resets to opening, never promotes a past bidder; outbid retraction preserves leader | Rendered receipt/confirmation and minimum-bid recalculation |
| Auction expiry / cancellation | Server deadline; or owner support exact ID → cancel | Late bids/retractions fail; no paid order; lazy lock release for relisting; owner-only recent/exact hidden lookup; cancellation retains safe audit history | Staffed cancellation/appeal workflow; hosted clock and edge behavior |
| Community / trade discovery | Join/create group → post; owned trade pile+wants → reciprocal swipes | Joined-member privacy; author/group-owner removal; blocks/reports; current owned reciprocal pair and mutual-only private thread | Real membership, keyboard/touch swipe and moderation response |
| Messages / profile choices | Member → private thread/profile → switch peers quickly | Participant-only messages; blocked new sends; actual client ignores stale results/errors and clears previous-peer draft | Real session switching, polling, notifications and phone gestures |
| Export records | Account Settings export / private job export | Own collection/consent/messages/offers/bids/reservations; participated care only; pre-acceptance address masking; private data excluded from marketplace DTO | Browser download, portable JSON inspection and retention/support policy |
| Delete account / moderation | Typed DELETE → active-care and auction history checks → removal; owner restores permitted holds | No accepted custody loss during acceptance/delete race; accepted-bid seller guard; live bidder retraction; anonymous retained bid history; durable restrictions | Backup/log retention, recovery, staffed appeals and jurisdiction-specific operating policy |
| Native app → web account flow | Native account/marketplace/workshop action → `Linking.openURL` | Source trace shows browser handoff, not independent native authentication or persisted native commerce | Signed builds, real iOS/Android login return, native session/backend and App Store review |

## Defects reproduced during this audit

Baseline failures are kept separate from the eventual patched verification.

| Defect | Reproduction and observed baseline | Impact / regression coverage |
| --- | --- | --- |
| Unaccepted care address in export | Create job → quote without acceptance → collector `GET /api/social?kind=export`: intake address/notes were present although normal job read masked them | Address privacy; real route quote→export assertion |
| Care state and receipt not atomic | Inject failure at the `care_events` insertion after request/quote/approve/stage: error response but orphan job or changed state remained | Custody evidence and retry correctness; four actual storage-boundary rollback groups |
| Accepted custody deleted by race | Provider deletion read a quoted job; actual collector acceptance ran before deletion batch; both returned200 and accepted job disappeared | Customer property/contact continuity; actual approval route injected at deletion transaction boundary |
| Newly arrived dependent records survived deletion | A request and message arrived after the provider's preliminary deletion reads; deletion removed their job/thread but left a timeline event and message behind | Private-record cleanup; real request/message routes injected before the deletion batch, followed by zero dependent-record assertions |
| Workshop stale selections/refresh | Actual provider/job loaders or refresh received responses in reverse order; older data and errors replaced newer selections/success | Wrong record display/obsolete errors; six actual client-function ordering groups |

The patched regressions verify shared pre-acceptance address masking, atomic care state/timeline writes, accepted-job deletion guards for both participants, current set-based dependent cleanup, and client request/session guards. Failed request storage also leaves no newly created private thread. Successful and failed guarded operations leave no transient guard rows. These fixes reuse the applied schema; migrations 0–6 were not changed.

The team also corrected the social overview refresh ordering and preserved presser registration intent across the sign-in return path. Actual client functions verify latest response/error handling, sign-out/unmount behavior and delayed mutation suppression; actual account-intent helpers and Hub effects verify the role/section return and one-time studio resume. Real OAuth and native browser return remain unverified.

Catalog save consistency and explicit entry selection were strengthened in this change. Inconsistent legacy directory links remain readable but cannot supply new sale/trade identity or FMV. Three renamed personal-record fixtures now remove their catalog links instead of requesting inconsistent linked titles; their immutable-listing, inventory and stale-revision assertions remain intact. Those fixture adjustments are distinct from product defects.

## Reproducible verification

Run from the website repository:

```sh
node --experimental-vm-modules checks/journey-integration.mjs
node checks/journey-client.mjs
node checks/run-readiness.mjs
git diff --check
```

The final frozen `node checks/run-readiness.mjs` run exited 0 on 9 October 2026. All 180 named groups passed, plus the broad network smoke, private-cache/offline, dialog-focus, prepared-query-budget and web TypeScript checks. `git diff --check` passed. Production build and hosting deployment are recorded separately at publication.

| Named regression suite | Final passing groups |
| --- | ---: |
| Existing backend negatives | 34/34 |
| Marketplace routes/helpers | 49/49 |
| Legacy compatibility | 6/6 |
| Existing client response ordering | 26/26 |
| New actual-route/form journeys | 35/35 |
| New actual client/session/intent checks | 30/30 |
| **Total named groups** | **180/180** |

Dense prepared-query counts remain social 23/40, Workshop 20/40 and job detail 6/10. The native runner passed seven viewport image calculations and TypeScript; Expo web, iOS and Android exports passed after the provider-registration handoff change. Those exports are unsigned and no hardware or installed-app test was performed.

The final runner's earlier attempts stopped on old fixtures that renamed linked copies while retaining their directory IDs. Those edits now deliberately unlink the personal record, preserving the original frozen-listing/inventory/retry assertions. The correct server rejection of inconsistent IDs is separately covered. These were fixture compatibility corrections, not newly discovered application defects.

Dependency-audit figures in the earlier release reports are retained prior-assessment evidence; no new dependency audit was run for this code change. Before fixes, the first route journey run passed 19/25 groups and failed 6 across the three backend defects above. The initial Workshop-only client run failed all 6 response-order groups; the added picker session checks passed 7/7. Later form integrations passed while the same six backend failures remained. These runs were diagnostic, not a release pass.

The prior 115 named baseline groups and broad smoke/privacy/focus/query-budget checks passed again after the fixes. Build success is recorded separately from test success. Comprehensive licensed catalog/modern cover rights, live FMV access, connected payments, public audience, real multi-user browser sessions and native device/store acceptance remain separate launch requirements.

## Payment, refund and FMV preparation — 9 October 2026

This later increment is described in PAYMENTS-REFUNDS-RELEASE.md, COMMERCE-BACKEND.md and PAYMENT-QA.md. It adds sandbox order/event/seller/money-operation storage, buyer refund requests, unverified tracking, owner reconciliation, ordinary GoCollect guide links and an independent rights-gated FMV prototype. The final verification.json supersedes the earlier180-group count. All processor HTTP responses in automated integration tests are simulated; genuine processor transaction count is zero. Native account orders remain a browser handoff.
