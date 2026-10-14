# ComicHuddle app launch kit

This is the complete Expo / React Native prototype for iPhone, Android and web, updated on 13 October 2026 with two compact portrait cards per mobile row, the central Scan action and the reviewed PostgreSQL architecture. It shares the ComicHuddle visual identity and public starter bibliography. It is not an App Store or Play Store release. Continue from project/CLAUDE-HANDOFF.md; the website is supplied in its separate ComicHuddle-Web-Source.zip.

Live private website: https://comichuddle.aztooeasy.chatgpt.site

Mobile prototype preview: https://comichuddle.aztooeasy.chatgpt.site/app-preview/index.html

Owner revenue calculator: https://comichuddle.aztooeasy.chatgpt.site/?section=Launch

## What works

- Six destinations around a raised circular Scan button: Home, Directory, Marketplace, My Profile, Comic Workshop and Upcoming. Searchable 43-issue directory snapshot, publisher filters and sourced comic detail sheets.
- FMV, Community and GrailMatch are only Coming soon cards in Upcoming. Earlier links resolve to Upcoming.
- The uploaded ComicHuddle superhero logo, original collector artwork and six credited vintage cover images are preserved.
- My Profile has its own page, with handoffs to the owner's website showcase and collection. Marketplace, messages and pressing studios also use real browser handoffs.
- Home and the center of the bottom dock open automatic live recognition on the private website. Recognition currently covers six authorized vintage cover references and requires explicit directory confirmation. An unmatched cover is labeled unrecognized, not falsely reported as absent from the catalog. A passive Scan deep link does not request camera permission until Start camera is tapped.

Native account features use browser handoffs. This prototype does not authenticate a native user or contain a private service-access token. It does not collect payments, queue offline edits, show invented current FMV or claim a comprehensive catalog.

## Run locally

Install a current Node version supported by Expo SDK 57, then:

```sh
npm ci
npm start
```

Use a development build or an Expo Go release compatible with SDK 57. Do not assume every installed Expo Go version supports this SDK. `npm run ios` and `npm run android` start the development tooling; a compatible simulator/emulator or device is required. Native iOS development requires macOS and Xcode. Android development requires the Android SDK.

```sh
npm run web
npx tsc --noEmit
node checks/image-layout.mjs
node checks/native-journeys.mjs
npx expo export --platform all --output-dir dist
```

`experiments.baseUrl` is `/app-preview` for hosting the web export under the main website. Change or remove it when deploying the web preview at another path. Native bundles are unaffected.

## Signing and release

`eas.json` includes preview and production build profiles. `com.comichuddle.preview` is a provisional bundle/package ID; choose identifiers belonging to your business before creating store records. No Expo project ID, Apple team, Google service account or signing credentials have been invented.

With your own Expo and developer accounts:

```sh
npx eas-cli login
npx eas-cli build:configure
npx eas-cli build --platform android --profile preview
npx eas-cli build --platform ios --profile preview
```

An iOS internal preview needs eligible device registration or a suitable simulator build. Follow Expo's current instructions for your distribution method. Production submission requires a signed build, store records, review assets, privacy disclosures and approved billing. Creating bundles is not the same as signing an installable app.

## Shared production backend

Keep one backend for web, iOS and Android. Preserve existing collector IDs when adding supported consumer authentication; do not overwrite the website's ChatGPT authentication with a guessed OAuth flow. Add native access only through supported, user-specific sessions and a reviewed ownership migration.

Existing routes include `/api/catalog`, `/api/values`, `/api/vault`, `/api/social`, `/api/pressing` and `/api/media`. The current host is private and account routes require the website's supported identity. This prototype uses an attributed snapshot, not native authenticated calls to those routes.

Keep provider API keys on the server. Ingest licensed metadata into an indexed database with stable issue/edition identifiers, publisher/series crosswalks and separate grades, labels, printings, currencies, timestamps and rights expiry. The current starter uses retained numeric IDs; map them before a large catalog migration so collections and wants remain attached to the correct books. Implement search pagination rather than bundling the entire commercial catalog into the app. Refresh licensed data according to the signed contract and label missing or stale estimates.

## Data and images

`data/catalog.json` records individual bibliography sources, metadata attribution, licenses, cover credits and dated price sources. Historical sales are not current FMV. Modern covers are absent pending authorization. Vintage source pages identify US public-domain status; that is not worldwide clearance. See `CREDITS.md` and `LICENSING-INQUIRY.txt` before any public commercial release.

The site's `scripts/export-app-data.mjs` exports public starter data only. Updating licensed server data does not update this snapshot automatically; a production app should request entitled records from the backend.

## Validation performed

TypeScript checking; image bounds checks across seven phone, tablet and landscape sizes; actual native TSX handler checks with isolated native surfaces; Expo web, iOS and Android bundle exports. The native checks do not verify browser authentication, persisted group data, payment outcomes, native device behavior or visual rendering. No native device, simulator, browser visual QA or signed distribution build was available in this environment. Website journeys are covered by the separate web project checks.

Official implementation references:

- https://docs.expo.dev/versions/latest/
- https://docs.expo.dev/deploy/build-project/
- https://docs.expo.dev/more/expo-cli/
- https://developer.apple.com/programs/enroll/
- https://support.google.com/googleplay/android-developer/answer/6112435?hl=en

See `BUSINESS-MODEL.md` for proposed pricing and `LAUNCH-PLAN.md` for the remaining commercial release work.

## Mobile design revision — 9 October 2026

The app uses warm comic-book paper, red and golden-yellow accents, halftone action rays, bold panel headings, ink borders and offset shadows. Covers use contain sizing with bounded grid, hero and detail frames. This historical revision made Community a primary tab; the 13 October revision below replaces it with My Profile and preserves the uploaded logo. There is no upper mobile page menu. The website's desktop navigation is managed separately.

No active swipe preview or pricing guide remains in this revision. Account features open the website. Exact issue links retain the catalog ID when opening a directory record or marketplace filter.

## Project readiness revision - 8-9 October 2026

The business analyst, developer and independent QA agents completed the engineering review. `project/` contains the team charter, delivery backlog, release verdict, operations proposal and the three role reports. The website remains owner-private.

Run `npm run test:readiness` for native cover-layout, handler and TypeScript checks. Account sheets scroll on short screens; essential icon controls have larger touch areas and notices clear automatically. Real browser/device and VoiceOver/TalkBack journeys remain unverified. No swipe animation remains after the Upcoming revision below.

Compatible dependency updates removed the vulnerable xcode UUID dependency. The native dependency audit still has 15 high graph entries representing two unique unresolved upstream build-tool advisories, in braces and node-forge. Fixed versions were not available from the configured registry during the assessment; native store release remains blocked on their resolution and the other gates in `project/BACKLOG.md`. Do not interpret a successful bundle export as security clearance or a signed store build.

The associated web project passed 34 backend negative groups, 26 actual-client response-order groups, broad functional/privacy checks and TypeScript. Its production dependency audit has zero findings. Full live Raw/CGC FMV, a comprehensive licensed catalog, real checkout/payouts, native user sessions and store distribution remain separate integration work.

## Marketplace expansion — 9 October 2026

The operator is Malik LLC, Minnesota/USA, with public support at maliktecks@gmail.com and a USA-only launch scope. Sell a comic, Sell a collection and Start an auction open the corresponding real website flow. The native revision below removes illustrative listing/FMV cards and retains actual account handoffs plus issue discovery.

The website supports up to 1,000-copy collection lots, frozen included-copy manifests, one active reservation per physical copy, owned photos and fixed-price offers/messages. Product cards separate asking/current bid from exact current licensed FMV, covered subtotals and unavailable values. Auction previews persist server-controlled proposals, private bid receipts, idempotent retries, cutoffs and retractions, with an owner support/cancellation screen. They remain nonbinding; payments and binding auction operation are not connected or cleared.

See project/MARKETPLACE-RELEASE.md, project/BUSINESS-COMMERCE.md, project/QA-COMMERCE.md and project/verification.json for the newer implementation, legal/operating gates and final automated counts. The accompanying publication record identifies the exact updated private website version. Previous role reports and the separate hardening PDF retain their original assessment scope. Native account access remains a browser handoff, with unsigned exports and real-device/store-release work pending.


## Catalog selection and deeper journey audit — 9 October 2026

The website collection add/edit forms now search the server directory and show exact issue/year/edition details plus authorized cover thumbnails. Explicit manual entries remain available without inferred FMV. The current directory is still the 43-issue starter; modern covers, a comprehensive catalog and live values are not licensed yet. `project/DATA-ACCESS-DECISION.md` records the commercial data options and the Key Collector permission requirement.

Native “Register my pressing studio” opens the website with a durable provider registration intent. The website preserves that role and the current section across its supported sign-in return. This is a browser handoff, not native authentication. Expo web, iOS and Android exports and the native seven-viewport/TypeScript runner passed after this change.

`project/E2E-AUDIT.md` records complete isolated account, provider care, collection/listing, auction and messaging journeys, verified defects and regression evidence. Actual OAuth/browser/device journeys and paid purchases remain unverified or unconnected; no public launch or perfection is claimed. `project/PUBLICATION-RECORD.json` identifies the resulting private deployment.

## Payment, refunds and original FMV preparation — 9 October 2026

The native account drawer opens Orders & refund requests on the private website. The revision below removes the external CGC guide buttons along with the active pricing UI; no guide prices or publisher image rights are imported. Web/iOS/Android exports remain unsigned. There is no independent native sign-in or native payment session.

The associated web backend now has test-only Checkout, connected seller onboarding, signed payment-event reconciliation, original-payment refunds and durable order/event/seller/money-operation tables. The runtime sandbox remains disabled with no Stripe test secrets. No genuine processor payment, refund, transfer or bank payout was executed. Carrier delivery verification, scheduled deadline checks, production tax/fees, reserves and live seller payment remain integration work.

The proposed policy requires tracking48h, carrier acceptance72h, and verified delivery plus48h buyer review before seller release; reported issues freeze release and later applicable claim/card rights remain. This is not an active guarantee or escrow. See project/PAYMENTS-REFUNDS-RELEASE.md, project/STRIPE-SANDBOX-SETUP.md and project/PAYMENT-QA.md for current implementation, exact founder steps and final test scope. The final project/verification.json supersedes the earlier counts.

An independent rights-gated research FMV model uses verified settled exact-comic sales with a recency-weighted median and minimum independent evidence; no lawful feed or backtesting has yet established live estimates. Key Collector requires a negotiated written commercial license; eBay sold data/pricing uses also need approved access and permission. Prepared licensing inquiries and official sources are in project/PAYMENTS-AND-DATA-NEXT-STEPS.md.

## Community and Upcoming revision — 9 October 2026

The current six bottom destinations are Home, Directory, Marketplace, Community, Upcoming and Comic Workshop. The header keeps the original ComicHuddle icon and one account drawer. My Profile opens `/?view=app&section=My%20Profile`, allowing the website to open the current user's showcase or required free-account setup. There is no duplicate upper page menu.

Community now has comic-panel group discovery, joined-group feed access, Show & tell, Ask the hive, Help me find it and Talk comics composer intents, an editorial discussion prompt, Create a group and My groups. The native app does not fetch or invent posts, membership totals or user activity. Each actionable item opens the real website with these supported parameters:

| Action | Website query in addition to `view=app&section=Community` |
| --- | --- |
| Discover groups | `communityView=discover` |
| Featured group | `communityView=discover&group=key-hunters`, `run-completers`, `indie-alley` or `twin-cities` |
| Joined-group feed | `communityView=feed` |
| My groups | `communityView=groups` |
| Create a group | `communityView=groups&communityAction=create` |
| New post | `communityView=groups&communityAction=compose&postKind=discussion`, `question`, `showcase` or `find` |

The website enforces account, consent, membership and group-ownership permissions and preserves the intent across supported sign-in. This native prototype has no independent authenticated session, local persisted group state or offline editing queue. The handoff checks verify URLs and handlers, not browser sign-in or backend persistence.

FMV and GrailMatch are unavailable cards in Upcoming with the exact labels “FMV coming soon” and “GrailMatch coming soon”. Historical pricing rows, the CGC external-guide CTAs, local swipe choices and active matching links are removed from the native app. No availability date or current price is invented. The current licensed snapshot and cover attribution remain intact.

`npm run test:readiness` passed: strict TypeScript; proportional cover bounds at 320×568, 375×667, 390×844, 430×932, 768×1024, 1024×768 and 844×390; and 13 actual native TSX handler groups with isolated surfaces. Checks include exact six-tab navigation, My Profile, Community intents, provider registration, issue identity, search punctuation, safe query encoding and minimum dock/control touch dimensions. These are automated source/handler checks, not a rendered screenshot, hardware or browser E2E assessment.

The final `npx expo export --platform all --output-dir dist` completed successfully for this revision. The hosted web entry is `dist/index.html`; its bundle is `dist/_expo/static/js/web/index-0ce4616e19f512dd7cb72e3a78781b3c.js`. Unsigned Hermes bundles are `dist/_expo/static/js/ios/index-33469627f5181bc9acb2ba3ca67107a5.hbc` and `dist/_expo/static/js/android/index-b1734f07d9847ca979b8c24b46cc8581.hbc`, with assets and `dist/metadata.json`. No signed app, store submission, ZIP or publication was created by this native task. Real device/browser behavior, native authenticated sessions and unresolved upstream build-tool advisories remain release limitations.


## Founder-sketch revision — 13 October 2026

Home, Directory, Marketplace, My Profile, Comic Workshop and Upcoming are the six destinations. FMV, Community and GrailMatch are Coming soon. Community deep links redirect to Upcoming, and delayed startup links cannot override a tab the owner already selected. The superhero logo remains the supplied image.

The website now has publisher → series browsing, exact issue buying filters, collection/manual entry handoffs, pickup listing terms and city-aware Workshop discovery. Scan opens the website camera/photo workflow and requires explicit catalog confirmation; it does not claim comprehensive AI recognition. Native account and commerce actions still open the authenticated website.

Validation: 14 native handler groups, seven bounded-cover viewport cases, TypeScript and unsigned web/iOS/Android exports passed. Browser/device, signing, store review and actual processor outcomes remain unverified. See project/SKETCH-RELEASE.md, project/SKETCH-QA.md and project/SKETCH-BUSINESS-MODEL.md for current delivery scope, exact web evidence and vendor recommendations. Older dated revisions below or above are historical assessments.


## Central Scan and architecture revision — 13 October 2026

The bottom dock contains three destinations on each side of its raised Scan circle. This action opens the authenticated website camera workflow without replacing the currently selected tab. At a 320-pixel viewport, six destination touch areas are at least 44 pixels and Scan is 48 pixels; larger screens use a 56-pixel Scan target. Native camera integration remains a browser handoff.

The web scanner continuously compares local camera frames against six actual licensed/public-domain vintage references, with alignment sampling, an ambiguity margin and three-frame temporal agreement. Photos and video frames stay on device. The directory is validated before displaying an identity and again before confirmation. Camera tracks are stopped on replacement, hidden state, closing and unmount, including streams granted after cancellation. Unrecognized, recognition unavailable, and a genuinely missing exact title/issue search have different messages. Comprehensive modern cover recognition is not licensed or implemented.

The directory now has a React/Tailwind card with a Raw/CGC9.8 toggle, one-copy ownership form, exact-issue marketplace link and real available-listing count. Current FMV remains Coming soon. Purchase price, certification details, acquisition date and notes stay private. Retry IDs prevent duplicate saves and cannot acknowledge a different payload. Editing a structured copy updates the same metadata fields.

`project/PRODUCTION-ARCHITECTURE.md` and `architecture/postgres/` contain the executable PostgreSQL target, role grants, trusted-session/API reference, analyzer, custom review/merge workflows, collection adapter and buyer badge. The running website still uses D1/R2; no migration, credential change or live payment activation was performed. Custom editions have provisional central-directory IDs and cannot be purchased pending verification. Editorial estimates are kept separate from verified sale-based FMV.

Validation includes 16 actual native handler groups, seven image/dock viewport cases, strict TypeScript and successful unsigned web/iOS/Android exports. Exact web/SQL/vision results and remaining browser/device/provider gates are recorded in `project/SCAN-ARCHITECTURE-QA.md`. The bundle entry names are web `index-b83a9f46b5e236603bb1771449732597.js`, Android `index-d36eedfe7fa0560a69162523185aa784.hbc`, and iOS `index-8c4ad11b4b6ce125e115d0c7501afb48.hbc`. No native hardware, signed distribution, real OAuth account or genuine processor transaction was executed.


## Compact cards and connected GCD directory — 13 October 2026

Cards show only an authorized cover or neutral missing-cover icon, title/issue number, publisher and More info. The detail sheet contains edition information, sources, bibliography and stories/credits, original publisher cover price (not FMV) and account actions.

When the hosted web preview runs at the exact ComicHuddle Site origin, Directory reads /api/catalog with same-origin cookies and no service/provider token. It has actual server search, publisher filters, 12-row pagination, loading/error/retry and exact-ID detail requests. Actual imported/GCD counts come from the server. On iOS/Android and previews outside that origin, a labeled43-issue starter snapshot remains with Browse full directory on website; native account authentication is not connected.

The backend contains an owner-operated GCD central importer with quota/Retry-After checkpoints. An anonymous full historical catalog cannot be downloaded quickly; GCD's supported bulk archive requires an account. Weekly summaries require individual detailed calls and do not constitute a worldwide historical change feed. Covers and FMV are not imported from GCD. See project/GCD-CENTRAL-CATALOG.md and project/GCD-DIRECTORY-QA.md for the actual final execution and limits.

The current native revision passes 23 handler/API-state groups, 7 cover/dock geometry cases, 5 targeted two-column mobile cases and strict TypeScript. Web/iOS/Android exports are unsigned. Full evidence and source/export hashes are in project/evidence/TWO-COLUMN-NATIVE-READINESS-2026-10-13.json. These results supersede earlier native16/22 for the current source. Cards remain two per row at 320–760px, the gallery is capped at440px, and titles wrap. Physical-device/browser rendering remains unverified.

ComicHuddle-Web-Source.zip contains the full exact website Git source, including database migrations, backend, UI, public assets, checks and the PostgreSQL blueprint. Extract it separately from the Expo project and follow project/CLAUDE-HANDOFF.md. No runtime secrets or private customer database export is included.
