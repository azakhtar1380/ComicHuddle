# ComicHuddle launch stabilization — 15 October 2026

**Public preview:** https://comichuddle-abdul-aziz-akhtars-projects.vercel.app/

**Release decision:** the browsing, account, listing and private-inquiry preview is deployed. **Paid marketplace transactions and paid Workshop services are not ready.** New checkout is explicitly paused; existing order support, webhook processing and refund/reconciliation routes remain available. This report does not certify a public commercial launch or full mobile-device coverage.

This is the current handoff. It supersedes the earlier coordinated FMV/AI/Pulse scope and the 13 October D1/R2 hosting descriptions. Those documents remain historical records. No production catalog, user, collection, listing, order or financial history was deleted or reset.

## 1. Deployed system, not a reference package

| Item | Verified result |
|---|---|
| Repository / branch | `https://github.com/azakhtar1380/ComicHuddle`, `main` |
| Deployed application revision | `be64c68` — bounded real identifier bootstrap and distinct unavailable-cover states |
| Current production deployment | `dpl_2QJP6NNWRwBbaTVBXQZnj55X2UYv`, READY |
| Immutable deployment | `https://comichuddle-dooino2e7-abdul-aziz-akhtars-projects.vercel.app` |
| Actual frontend/backend | Next.js 16.4 / React 19, repository-root `app/`, Vercel Node functions, `pg` / Drizzle |
| Actual database | Existing AWS RDS PostgreSQL; native metadata in `gcd`, application/auth/accounting/media state in `ch_web` |
| Public catalog readback | **2,620,274 indexed issues**, including **2,620,231 GCD records**; paginated actual RDS reads |
| Seller photo storage | `ch_web.photo_bytes`, metadata in `ch_web.media`, authenticated `/api/media`; not R2/S3 |
| Directory artwork | Six reviewed existing local reference assets on Vercel; optional S3/CloudFront modern-cover cache is not configured |
| Payments | Existing Stripe TEST integration; live payments, payouts and carrier integration disabled |
| Hosting workflow | Scoped Vercel CLI deployment of this repository root. Project Git link is currently null; a Git push alone does not deploy |

The production build applied/verified additive migration `023_launch_stabilization.sql` under the existing advisory lock/checksum ledger. It adds identifier/checkpoint and media-rendition tables and disables pending valuation/Pulse jobs. Native GCD tables and historical monetary records are retained. Legacy bulk migration/seeding is disabled for these builds.

The stable production host remains the existing Better Auth/checkout origin. The short Vercel alias redirects to that origin to avoid inconsistent cookies and CSRF/return URLs. Secrets remain in scoped hosting configuration, never this repository.

## 2. Implemented launch scope

- Removed public FMV badges, estimates, totals, controls, charts and valuation calls from directory/search/home/listing/builder/collection/profile/grail/scanner surfaces. Actual asking prices, acquisition costs and transaction amounts remain distinct.
- Removed Market Pulse and the three homepage feed pills. Deferred endpoints return HTTP 410; producers/consumers admit only cover work. The FMV cron is removed. Completed historical valuation/Pulse jobs and their records remain; diagnostics found 59 completed valuation and three completed Pulse jobs, with no pending pricing work.
- Homepage now has **A Glimpse of the Directory**, the requested copy, a real full-directory link and six real records. Lower-home Upcoming and `/upcoming` use the shared shell; FMV is labeled **Fair Market Value & Price Insights — Coming Soon**. Community and GrailMatch remain the approved roadmap items.
- Unified the Wallet/SafePurchase headers, navigation, typography and footer with the main app. Upcoming is discoverable through More and the existing footer/menu, without a second mobile dock.
- Kept one unified listing picker: search, explicitly select, add another. Stable physical-copy IDs, distinct conditions/certifications, quantities, private revisioned drafts, photo ordering and server validation remain independent of AI/FMV.
- Added owner-authorized **Edit listing · unpublish first** for eligible active unsold fixed-price listings. Withdrawal and exact-copy private draft creation are atomic; competing orders, auction/history constraints and stale draft versions are rejected. Republish creates the next listing; purchased snapshots are not edited.
- Hardened actual seller-photo decoding, persistence and thumbnails; reference art cannot satisfy an actual-item photo requirement. A representative lot photo and additional photos are supported.
- Wallet distinguishes pending/released proceeds from noncash reward credit. Fetch failure shows unavailable rather than a fabricated $0 balance. No unsupported cashable rewards, top-ups or person-to-person money transfers were added.
- Workshop supports genuine specialist profiles, service descriptions, city/ZIP discovery and private inquiry/quote workflows. Calls to action say **Request a Quote**. Workshop platform payments remain disconnected; no fake studios, reviews or paid service confirmations were added.

Relevant implementation: `app/hub.tsx`, `app/listing-builder.tsx`, shared header/footer/cover components, `lib/listing-edit.ts`, `lib/media-image.ts`, `lib/seller-photos.ts`, `lib/comic-identifiers.ts`, `lib/catalog-identifiers.ts`, `lib/commerce.ts`, and the existing Workshop services. Some earlier architecture/mobile packages remain reference or prototype material; this release deploys the web app, not a signed native app.

## 3. Cover failure diagnosis and measured results

### Root cause

The **production `gcd.gcd_cover` table is absent**. `information_schema` and the bounded production migration diagnostic confirmed no columns/table to join. The native issue/series directory still works through its preserved left joins. The public API reports **2,094 retained legacy cover references**, but a reference is neither a ready image object nor permission to display/cache artwork.

For modern catalog art, the deployed GCD credentials, reviewed source permission grant, approved S3 bucket/CloudFront configuration and scoped storage credentials are missing. **`ch_web.cover_cache` contains zero rows/ready modern assets.** There is therefore no modern CDN object for the browser to render. Expanding the Next image allowlist cannot create the missing association, fetch permission or object. No CORS, Next optimizer or hotlink failure was established as the cause of the sampled missing art.

This release does not guess `/covers/...` paths, equate issue IDs with cover IDs, borrow a parent/other edition's image, bypass denied access or claim bibliographic licensing covers copyrighted artwork. No fresh GCD cover fetch was attempted without the required access; modern examples are **unavailable for display**, not declared confirmed missing scans.

### Representative issue/edition trace

Native IDs are the existing application namespace `4,000,000,000 + GCD issue ID`. Retained starter IDs are separate and preserved.

| Real application ID | Exact issue | Before / failed stage | Verified result after changes |
|---:|---|---|---|
| 4000001400 | Planet Comics #12, 1941, Fiction House | Existing reviewed local art was not mapped to the native identity | `/covers/planet-12.jpg`, HTTP 200, JPEG bytes decoded, 975×1338; browser rendered in hero/card |
| 4000002506 | Planet Comics #21, 1942 | Same identity-to-asset gap | Local exact-edition JPEG, HTTP 200, 800×1105; API/byte test |
| 4000003244 | Planet Comics #27, 1943 | Same gap | Local JPEG, HTTP 200, 831×1172; browser rendered in hero/card |
| 4000005068 | Planet Comics #42, 1946 | Same gap | Local JPEG, HTTP 200, 450×676; API/byte test |
| 4000006567 | Planet Comics #53, 1948 | Same gap | Local JPEG, HTTP 200, 975×1498; API/byte test |
| 4000006841 | Planet Comics #55, 1948 | Same gap | Local JPEG, HTTP 200, 975×1464; browser rendered in hero/card |
| 0 / 11 | Amazing Spider-Man #300 / Amazing Fantasy #15 | No eligible display URL/ready cache object; cover source access/storage unavailable | Catalog remains visible; honest titled fallback, no substituted art |
| 1 / 2 | Batman #423 / Invincible #1 | Same modern-art gap, different publishers | Same honest fallback; no fabricated source claim |
| 4000076314 / 4000870705 | Secret Wars #1, 1984, Direct / Newsstand | Separate real variants, neither has eligible art | Both retained as distinct candidates; Newsstand selected in browser and opens the exact record; placeholder is not image success |
| 4001525206 / 4001595636 | Superman vs. Muhammad Ali Facsimile / Broons facsimile | No eligible art for these edition records | Metadata remains available; no original-edition cover borrowing |

All six local assets are existing reviewed US-public-domain reference images with source attribution. They are **six unique artworks**, even though also available for retained starter identities. The API sample validated actual bytes with Sharp, not just HTTP 200/content headers. The browser directly confirmed three unique artworks; it did not individually inspect all six.

### Separate measurements — not a global image-success percentage

| Measurement | Observed |
|---|---|
| Native GCD cover association table | Absent; global association count cannot be established from that table |
| Retained legacy cover-reference counter | 2,094, not 2,094 ready images |
| Reviewed local artwork | Six unique assets, six successful HTTP/byte decodes |
| Modern catalog cache rows / ready objects | 0 / 0 |
| Initial exact-ID API sample | Six art URLs out of 14 records; eight unavailable; not a whole-catalog rate |
| Homepage preview | Three real covers plus three clearly labeled fallbacks, across four publishers |
| Fresh upstream source retrieval / confirmed missing scans | Not measured: source access disabled; no unsupported absence claim |
| New blocked-source / transient-failure rate | Not measured: no permissioned upstream attempt in this run |
| Production seller media diagnostic | Two metadata rows, two original byte objects, zero missing bytes |
| Production active listing-photo diagnostic | One active listing, zero missing stored-photo references; this is not an authenticated buyer gallery test |

### Seller images fixed independently

JPEG/PNG/WebP uploads are fully decoded, bounded to 16 megapixels, orientation-corrected and stripped of metadata. Actual images smaller than 120 pixels or corrupt/HTML content are rejected. A bounded original and 480×640 thumbnail are persisted with hash/dimensions. Publishing checks owner-authorized stored bytes, not a metadata-only URL. Private unattached photos are not exposed to unrelated users. The shared listing gallery uses actual-copy photos; reference art does not silently replace a failed seller image.

In isolated QA, real image bytes were uploaded, original/thumbnail WebP delivery was decoded and photo persistence/owner privacy was checked. The production count inspection did not fetch private owners' photo bytes into this report.

### Modern-cover setup and reproducible recovery

1. The operator obtains applicable GCD issue-API access and artwork access/cache/display permission, or supplies a separately reviewed publisher/contributor source. The GCD GitHub API wiki documents responses; it is not an artwork grant. Metadata CC attribution remains separate.
2. Review a permission record using `scripts/review-enrichment-source.ts`: exact provider/hosts, evidence reference, attribution, expiry and explicit access/cache/display flags. Keep AI/valuation permissions false for this launch. Do not insert an assumed grant merely to turn on the worker.
3. Configure server-only `GCD_USERNAME` / `GCD_PASSWORD` where required. Obtain the actual cover association companion metadata or use the documented exact-issue API **supplied** `cover` URL. An empty `cover: ''` is absence only when actually returned by the upstream API.
4. Use approved existing S3/CloudFront infrastructure: `COVER_STORAGE_BUCKET`, `COVER_CDN_BASE_URL`, `COVER_CLOUDFRONT_DISTRIBUTION_ID`, scoped AWS credentials/workload role, `AWS_REGION`, `COVER_STORAGE_REVIEWED=true`. Review `infrastructure/cover-cache-policy.example.json`; do not make a bucket public-write or broaden RDS access.
5. Set `ENRICHMENT_COVERS_ENABLED=true` only after that review. Test one exact native edition, first cold then ready-cache, before increasing scope. The existing durable queue resolves exact source metadata, validates bytes, writes 240/480/960px versioned WebP objects, then publishes ready cache state. Cards receive ready URLs through the shared resolver without blocking browsing.
6. Confirm the same edition in a browser, metadata/attribution, thumbnail/full cover, cached repeat view, source denial/Retry-After, missing scan and recovery. Real S3 write/CDN/upstream failure recovery remains unverified until those resources are configured; local controlled adapters do not establish it.

The resolver enforces exact HTTPS hosts, public pinned addresses at every redirect, credential stripping across hosts, byte/time/redirect bounds, image validation, negative-cache expiry and leases. Access denial is not absence; it trips a provider circuit rather than repeated hammering. Rights revocation suppresses reads and queues object purge/invalidation. Such purge still needs configured storage and operational follow-up.

## 4. Practical non-AI scanner

The scanner now uses camera/upload, native barcode decoding where available, a ZXing worker fallback, on-device OCR and fast actual-directory search. It has no paid inference requirement, model authenticity check or valuation request. The retained visual pHash reference index has **six** covers, not millions.

- Full UPC/EAN/ISBN input and readable supplements are retained; UPC-E handling preserves the original code while creating the lookup alias. Checksums reject malformed input.
- A bounded real RDS index bootstrap scanned **40,000 active records**, matched **618 issue records** and saved **624 identifiers**. Checkpoint: native issue **40387**; `completed_at = null`. This is partial coverage, not a claim that every comic has a barcode.
- Actual public lookup `1878574590` matched **Sin City [nn], 1992, Dark Horse**, application ID **4000000033**. The browser displayed that candidate for confirmation.
- Actual `978067172440551095` retained base ISBN `9780671724405` and supplement `51095`, matching **4000023194** through the live route.
- A generated test UPC image decoded in the real browser, including its full code; because it was not a catalog comic it correctly offered manual search rather than inventing a match. Independently generated UPC pixels at 0°/90° passed the ZXing fallback test.
- Manual **Secret Wars #1 (1984)** returned four real candidates. Selecting Newsstand opened **4000870705**, rather than automatically choosing Direct or guessing authenticity.
- Explicit confirmation is required. Sequential additions share the same selected-comic list; stable physical IDs protect existing selections. Manual typing cancels pending automatic scanning to prevent late OCR from replacing a user's query.
- Camera, worker, OCR and lookup operations have bounded timeouts and cancellation. Closing shuts down tracks/workers. Upload/manual recovery remains available when the camera fails. Scan photos remain local unless separately attached to a listing.

**Device boundary:** the cloud browser has no camera (`Requested device not found`). No physical iPhone/Safari or Android/Chrome camera test was performed; no native iOS/Android binary was shipped. HEIC/device-specific format behavior and wallet hardware eligibility remain real-device acceptance work. Do not claim universal decode or edition/authenticity accuracy.

## 5. Actual Stripe configuration, payment and refund proof

The existing US platform account is `acct_1UQaREDtWxXM4ywk`. Its actual provider response reports `charges_enabled=false`, `payouts_enabled=false`, `details_submitted=false` and no active capabilities. The configured key is TEST mode. Existing unbound test connected accounts were not reused or marked as verified.

Creating a dedicated, correctly bound test seller recipient returned **`more_permissions_required`** from Stripe. The required Connect account creation/onboarding permission is missing from the available key/account context. No local `ready=true` flag, arbitrary destination or synthetic seller identity was used to bypass this gate.

The production TEST webhook is enabled at the canonical `/api/commerce/webhook`; the separate QA environment has its own test webhook. Test-domain Apple Pay and Google Pay records are active. Google Pay was switched on in the existing **TEST** payment-method configuration; no live configuration was promoted. The public setup endpoint now confirms `newCheckoutEnabled=false`, `livePaymentsEnabled=false`, `payoutsEnabled=false`, `carrierConnected=false`.

### Payment-method matrix

| Method | Provider TEST configuration | Display observed | Real sandbox completion | Physical device | Live-ready / full app order |
|---|---|---|---|---|---|
| Credit/debit card | Available/on; secure Stripe collection | Real hosted Stripe UI | Decline, 3-D Secure success, $15 test charge, $5 + $10 provider refunds | Not performed | **No**; full ComicHuddle order flow blocked by seller onboarding |
| Apple Pay | Available/on; TEST domain active | Button rendered in cloud hosted Checkout | **Not performed** | iPhone/Safari outstanding | **No** |
| Google Pay | Available/on; TEST domain active | Not displayed in this cloud Chrome session | **Not performed** | Eligible Android/Chrome outstanding | **No** |

This matrix does not claim a wallet button appears in the paused app checkout or that a rendered button is a completed wallet payment. Card fallback is provided by the real Stripe UI when the checkout integration is eligible. No raw card data enters the ComicHuddle database.

### Real provider-only sandbox transaction

The explicit test item was **“ComicHuddle QA provider-only TEST · no physical sale”**, USD $15.00. It was deliberately not represented as a ComicHuddle purchase, paid seller order or actual comic sale.

- Official Stripe decline test card: expected decline displayed.
- Official 3-D Secure test card: actual challenge completed, Checkout `complete`, payment `paid`, `livemode=false`.
- PaymentIntent **`pi_3UQrW4DtWxXM4ywk0VJB6V0T`**; charge **`ch_3UQrW4DtWxXM4ywk0JdOY8YH`**; amount received 1,500 cents.
- Partial provider refund **`re_3UQrW4DtWxXM4ywk087tVHRV`**, 500 cents, `succeeded`; repeated idempotency key returned the same refund.
- Remaining provider refund **`re_3UQrW4DtWxXM4ywk0tP5HtX6`**, 1,000 cents, `succeeded`; replay also deduplicated.
- Provider charge confirmed fully refunded, 1,500 cents. QA wallet/order history stayed unchanged because this payment was not bound to an app order.

**No real money, live charge, live refund, seller transfer or bank payout was executed.** These provider tests prove real secure card collection, decline/authentication and test refunds. They do **not** prove application order association, webhook-to-ledger credit, seller release, transfer reversal, or partial-refund UI support. The app refund path remains its existing full-refund model; the provider-only partial refund is not an app feature claim.

## 6. Marketplace, wallet, Workshop and security checks

An isolated database, **`comichuddle_launch_qa_20261015`**, was created on the existing RDS instance; no new paid database instance or hosting plan was created. Clearly labeled QA accounts/data are separate from production. The QA deployment is the earlier `11be6f7` application level; final public scanner/copy/status changes were checked separately on production. Do not assume every final source change ran through every QA test.

The actual HTTP/API-to-RDS evidence contains **13 passed checks**:

1. Seller, buyer and unrelated-user real authentication/profile persistence (three checks).
2. Simultaneous listing publication for the same physical copy: **200 / 409**, exactly one reservation.
3. Atomic edit-to-draft with exact-copy preservation and withdrawal from buyer view.
4. Stale draft update rejected without overwriting.
5. Real wallet read and rejection of unearned reward-credit conversion.
6. Actual city/ZIP autocomplete.
7. Checksum-validated barcode lookup and invalid-input rejection; positive live production lookup was verified later after identifier bootstrap.
8. Buyer/seller conversation and unrelated-user write isolation.
9. Specialist registration retaining the collector profile.
10. Specialist public projection excluding the private intake address.
11. Quote request/provider response and nonparticipant private-job rejection.

The numbering groups related checks; the JSON file contains the exact 13 independent entries. Additional actual QA uploads verified seller originals/thumbnails, private-photo isolation, distinct physical-copy conditions and multi-comic publication. Those earlier checks are described separately rather than added to the JSON count.

Focused controlled checks also passed:

| Suite | Result | What the result means |
|---|---:|---|
| `checks/launch-stabilization.test.ts` | 6/6 | Checksum/supplement/UPC-E, decoded generated barcode pixels, invalid image rejection, exact cover mappings, retired workloads |
| PostgreSQL migration + native rewards suites | 19/19 | Actual local PostgreSQL/PGlite queries, ownership, credit/rollback/history invariants |
| Marketplace business + GCD snapshot/cover suites | 19/19 | Local DB inventory/sold/edit rules, snapshot mappings, rights and cron contracts |
| Listing-builder UI harness | 5/5 | Actual component callbacks with controlled network/storage: picker, copies, drafts, recoverable failures |
| Commerce UI recovery harness | 10/10 | Bounded checkout/retry/duplicate action and wallet/Workshop failure states |
| Workshop discovery harness | 12/12 | Discovery/card/service/callback/privacy behavior with controlled data |
| Stripe sandbox adapter harness | 55 groups passed | Provider-adapter and signature/idempotency/error contracts with controlled responses |
| Commerce policy harness | 36 groups passed | Accounting/hold/refund/release policy cases with controlled evidence |
| TypeScript, whitespace, Vercel build | Passed | Build/type validity; not payment or device certification |

Do not combine named groups, assertions and real transactions into one exaggerated end-to-end total. Controlled webhook/signature/out-of-order cases do not substitute for a real signed provider event completing an application order.

### Verification still outstanding

- Fully signed-in **browser** account/profile/listing/checkout sequence. Real API authentication was tested, but browser credentials/cookies were not injected to manufacture a signed-in UI proof. First authentication + profile API observation took roughly 5–8 seconds cold and 0.4–0.5 seconds warm, not zero-latency or isolated auth-service timings.
- Two buyers racing to **pay** for the last copy, abandoned/expired Checkout recovery and late payment after inventory expiry against actual Stripe and RDS. Concurrent publication reservations passed; that is not the same money test.
- Full real application buyer payment → correctly bound order → signed webhook → pending seller ledger → verified shipment/delivery → release → refund/dispute/reversal and payout failure/retry.
- Actual Apple Pay/Google Pay transactions and physical camera/browser acceptance.
- Real upstream cover cold/cache/failure/recovery and S3/CloudFront write/read/purge after provider resources are connected.
- Workshop quote acceptance/cancellation/status history in an authenticated browser and separate paid Workshop transaction flow. Current inquiry/request/provider response/private history API works; no payment was accepted.
- Genuine paid auctions: current auctions remain **nonbinding previews**, not verified timed paid auctions.
- Backup restore drill, separately verified incident delivery/on-call acknowledgement, email recovery/deliverability and representative load/device accessibility acceptance. This release supplies the rollback/runbook, not a claim that those operational exercises occurred.

## 7. Schedules and workload control

Deployed `vercel.json` retains:

| Route | Schedule (UTC) | Scope |
|---|---|---|
| `/api/cron/new-releases` | Monday 09:00 | Existing bounded, permissioned weekly metadata sweep |
| `/api/cron/new-releases-resume` | Daily 10:00 | Existing checkpoint continuation |
| `/api/cron/enrichment` | Daily 05:05 | Derived identifier indexing plus **cover-only** queue drain |

FMV/Pulse cron work is absent. Deferred endpoints return 410 without invoking the model/provider. Identifier bootstrap actually ran in the production build; the saved incomplete index is not presented as complete. Weekly sync refreshes the native directory-count state after successful steps.

Unauthorized requests to the cron routes return 401. The attempted manual authenticated enrichment invocation also returned 401 with the service access obtainable in this session. **A successful scheduled invocation was not established.** The scheduler's actual runtime authorization/logs must be verified by the Vercel project operator; do not weaken the endpoint or rotate an unrelated secret to make an ad hoc call pass. Current GCD source configuration/owner pauses and checkpoints continue to apply. No paused Metron task or private Site sharing was changed.

## 8. Evidence and screenshots

Machine-readable evidence:

- [Public live diagnostics, actual issue/count/identifier readbacks](evidence/launch-public-diagnostics.json)
- [13 actual QA API/RDS checks](evidence/launch-live-api-tests.json)
- [Real Stripe TEST charge/refund receipts and explicit boundaries](evidence/launch-stripe-provider-test.json)
- Reproduce safe public checks: `node checks/live-public-launch.mjs` from an authorized network/runtime. It is read-only and needs no secret.
- `checks/live-launch-qa.mjs` requires the isolated QA origin/password through process memory; never point it at production or commit its credentials.

Screenshots captured from the real site/provider, not design mockups:

| View | Proof |
|---|---|
| Final homepage and common header | [Homepage](evidence/launch-home-final-20261015.jpg) |
| Upcoming, FMV deferred | [Upcoming](evidence/launch-upcoming-20261015.jpg) |
| Wallet information/shared theme | [Wallet](evidence/launch-wallet-20261015.jpg) |
| SafePurchase rules/shared theme | [SafePurchase](evidence/launch-safepurchase-20261015.jpg) |
| Marketplace, guest state/protection and location UI | [Marketplace](evidence/launch-marketplace-final-20261015.jpg) |
| Exact Secret Wars candidate confirmation | [Scanner](evidence/launch-scanner-20261015.jpg) |
| Actual Sin City ISBN match | [Barcode lookup](evidence/launch-barcode-20261015.jpg) |
| Workshop discovery/quote presentation | [Workshop](evidence/launch-workshop-20261015.jpg) |
| Actual provider-only 3-D Secure TEST challenge | [Stripe authentication](evidence/launch-stripe-3ds-20261015.jpg) |

The Marketplace screenshot is an anonymous discovery/account-gate view, not a signed-in seller builder or completed purchase. The checkout screenshot is the separately described provider-only test. No signed-in listing screenshot or device wallet-payment screenshot is claimed.

## 9. Remaining blockers and exact next actions

| Severity / gate | Owner | Exact next action |
|---|---|---|
| **P0 — paid marketplace** | Business owner + Stripe account administrator | Complete business activation and supported marketplace/Connect setup; provide a server-side key/role with the necessary account creation/link permissions. Bind a properly onboarded TEST seller to the actual QA profile, then run the full actual buyer/order/webhook/ledger/refund/concurrency tests before enabling new checkout. Do not supply keys in chat/source |
| **P0 — release of seller money / SafePurchase** | Business operator + payments engineer | Agree the processor-supported funds flow, custody/inspection operator, fees, tax/support obligations and trusted carrier evidence. Verify delivery/dispute holds, refund responsibility and transfer reversal/payout failure. A typed tracking number or local sold flag must not release funds |
| **P1 — modern cover display** | Catalog/source-licensing operator + storage operator | Obtain exact source associations/API access and applicable artwork permission; configure reviewed existing S3/CloudFront resources and scoped credentials; validate one exact native variant through source → byte validation → object → CDN → browser before scaling |
| **P1 — device/authenticated browser acceptance** | Product owner / QA with test devices | Run signed-in single/bundle publish/edit/confirmation and physical iPhone/Safari + Android/Chrome upload/camera/candidate flow; run eligible Apple Pay/Google Pay TEST payments. Preserve unresolved items as failed/unperformed, not passed |
| **P1 — scheduled processing** | Vercel project operator | Inspect an actual scheduled request's authorization/runtime logs, verify the existing cron-secret scope without disclosing it, confirm checkpoints advance and Retry-After/owner pause work. Manual success is not established |
| **P1 — operational launch** | Named support/operations owner | Confirm support inbox delivery, refund/dispute response ownership, failed-payment/webhook/payout alert destination and acknowledgement, actual RDS backup availability/retention plus a separate restore drill. Configure approved transactional email for recovery/verification before relying on it |
| **P1 — paid Workshop** | Workshop business operator + payments engineer | Decide and verify the actual service order/payment/refund flow separately. Until then retain only genuine inquiry/quote behavior and do not accept service payment on-platform |

Support currently links to the operator-provided `maliktecks@gmail.com`, Malik LLC, Minnesota/US-only. Delivery, staffing and response-time commitments were not inferred from that link. No additional insurance, escrow, grading/authenticity or CGC affiliation guarantee was created.

## 10. Deployment and non-destructive rollback runbook

1. Work from the existing repository root on `main`; do not deploy `architecture/`, an old ZIP or another sandbox. Read this report before older reference handoffs.
2. Keep database/Stripe/auth tokens in scoped hosting secrets or injected process memory. Current production settings include `MIGRATE_ON_BUILD=false`, `MIGRATE_ENRICHMENT_ON_BUILD=true`, `COMMERCE_NEW_CHECKOUT_PAUSED=true`. Do not rerun the old catalog seed/index pipeline for a UI release.
3. Verify the existing project/team link locally. Use the established scoped Vercel CLI production deployment after focused type/build checks; no force-push, secret-bearing remote URL or unrelated account changes. The project is not currently Git-linked, so separately push source changes to `main` and verify actual deployed revision.
4. The startup/build checksums are authoritative. Never edit an already-applied migration; create the next additive migration. Keep `023`, media bytes/renditions, identifiers, drafts and financial histories during rollback.
5. If a release fails, **pause new checkout independently** and keep existing webhook/refund/reconciliation handling online. Preserve all customer obligations and order support. Disable optional cover jobs through their existing flags if necessary; do not disable shared financial infrastructure.
6. Current release is READY. A prior READY stabilized runtime is `dpl_DghYR3T1NjyLNkSkQiT4zHKDPM4f` (`4d3b7c0`). It lacks the final identifier bootstrap/state changes. Review compatibility before promotion; do not revert to the pre-stabilization FMV/Pulse runtime just because it builds. No runtime rollback was performed in this run.
7. Database restore is a separate, operator-controlled incident action: verify the actual RDS backup/PITR availability, restore to an isolated target, reconcile ledger/provider state and approve any cutover. Do not drop schemas or restore an old snapshot over active orders as a routine web rollback.
8. Post-deployment read `/health`, actual catalog/identifier routes, checkout setup and retired endpoints; inspect the canonical public UI. Preserve test/live boundaries. Never run destructive fixture setup against production. Existing private Site/Metron history stays untouched.

## Final release assessment

| Release category | Decision |
|---|---|
| Public browsing / accounts / listing preview | **Deployed and usable with documented limitations.** Actual RDS/API and public UI proof exists. Authenticated browser, hardware/device and operational acceptance remain outstanding; not an unconditional commercial-launch certification |
| Paid marketplace | **Not ready — paused.** Connect permissions/onboarding, platform activation and the actual complete order/refund/release lifecycle are unresolved |
| Paid Workshop | **Not ready.** Genuine inquiry/quote functionality is available; platform service payments are not connected |
| All-cover recognition / full catalog art | **Not available.** Metadata count is not image coverage; six reviewed artworks and a partial real identifier index are the verified extent |

The deployed preview is real. The remaining cover and money dependencies are explicitly exposed rather than replaced with fabricated art, balances, FMV, seller verification or successful transactions.
