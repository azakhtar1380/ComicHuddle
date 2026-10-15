# ComicHuddle coordinated upgrade verification — 15 October 2026

Public preview: https://comichuddle-abdul-aziz-akhtars-projects.vercel.app/

## Continuation: draft recovery and account verification

The continuation found and corrected a browser-recovery defect: an older server draft previously replaced a different browser draft. The listing builder now preserves the current selection, displays a comparison/recovery control, and only replaces a differing version after the collector chooses. Initial connection failures and concurrent-tab 409 conflicts can reconnect without a reload or automatic overwrite loop. An identical manual save does not generate another revision. Invalid/oversized draft request bodies preserve their 400/413 status rather than being reported as a database outage.

Five controlled-hook builder scenarios passed, including the original selection/publication checks and three new recovery cases: differing browser/server versions with stable physical-copy IDs; an initial connection failure followed by reconnection; and a concurrent-tab conflict followed by loading the latest server version. These use actual component callbacks with isolated network/storage, not a signed-in browser.

The existing isolated PostgreSQL/authentication check was extended and passed account creation, cookie verification, wrong-password rejection, successful password login, untrusted-origin rejection, logout/session invalidation and spoofed-identity rejection. Its migration check reported no pending authentication columns/tables. The isolated adapter emits an int8 introspection warning for Better Auth's rate-limit timestamp; this does not indicate a failed migration. No test accounts, listings, sales or prices were inserted into the live database. TypeScript passed.

Fresh production checks on 15 October 2026 reconfirmed healthy RDS/catalog responses and 2,620,274 indexed issues. Provider prerequisites below remain unchanged: Gateway has no credits, no external comps feed is configured, and approved cover source/storage access is absent. The existing Vercel connector lacks this team scope; the already-authorized CLI credential successfully read the exact same project/team instead. No provider access, secrets, publication settings, database schema or paid plan was changed by these fixes.

Deployment details for this continuation are recorded below after release verification.

Runtime commit: `03595e8` (followed by documentation-only verification reporting).

Final Vercel deployment: `dpl_6g5vCKSN73hojyJUTT6TvvuVyjDN` — READY, production, no deployment protection.

Immutable deployment: https://comichuddle-dn0j08wbt-abdul-aziz-akhtars-projects.vercel.app

## Executed verification

- 16 coordinated enrichment/database checks passed, using the actual services and an isolated PGlite PostgreSQL instance. Coverage includes exact valuation targets, integer-cent quantities and partial totals, original-evidence independence/recency, missing evidence without model calls, one durable target/job for duplicate visible requests, shared seller/buyer snapshots, current source access/retention/display checks, worker leases/crash recovery/Retry-After, correct cover identity/renditions/CDN hits, denied-source circuits, takedown suppression, private draft revisions, actual native directory retrieval, test-order exclusion, and owned-copy reuse.
- The 12 existing native-directory/wallet/marketplace/grail regression checks passed. These include verified-payment reward idempotency, credit conversion/reservation/refund isolation, single/bundle inventory reservation, incomplete native records, source rights and private profile data.
- Two controlled-hook scenarios ran the actual ListingBuilder JSX/callbacks: the single search dropdown, selection/removal, duplicate handling, quantity, stable autosave; then multi-copy publication and draft cleanup while valuation requests fail. Quantity growth reuses two existing physical IDs and preserves the two private acquisition values. The fixture compares values across its VM boundary; it does not emulate HTML validation, a signed-in browser or a payment provider.
- Local TypeScript and production compilation passed. Vercel production compilation, TypeScript and static generation passed during deployment. Migration 022 executed against the configured RDS instance and verified its critical new tables; subsequent releases verified the same checksum. No imported GCD table was altered, emptied, re-seeded or broadly reindexed.

Commands:

```
node --import tsx --test checks/coordinated-upgrade.test.ts checks/native-rewards-fmv.test.ts
node --import tsx checks/listing-builder-ui.mjs
npm run typecheck
npm run build
```

## Public HTTPS and browser observations

- `/health` returned 200 with AWS RDS PostgreSQL status.
- `/api/catalog?limit=12&offset=0` returned 200, 12 records and **2,620,274 indexed issues**, including **2,620,231 GCD issues**, with pagination continuing. These are the live directory API's reported snapshot counts, not a claim of complete global catalog coverage or of 2.62 million available images/prices.
- Automatic estimated-FMV badges appeared on homepage/feed/Pulse and directory/search cards without clicking Generate, opening details or signing in. Ineligible/unpriced books displayed **Not enough pricing evidence yet**, with no zero/fabricated range. Repeated identical requests returned the same persisted snapshot ID and target key.
- Native search `Secret Wars #1` returned the actual 1984 Marvel Super-Heroes Secret Wars record. After fixing the observed year/publisher parsing problem, `Marvel Secret Wars #1 (1984)` returned four actual 1984 edition records: IDs 4000076314, 4000870705, 4001041247 and 4002690497. The AI retrieval path queries these real directory records rather than a tiny mock array.
- Market Pulse returned real seven-day boundaries, America/Chicago timezone, six catalog spotlight entries and no qualifying live sales or fabricated growth. The current platform orders are sandbox-only, so an empty live-sales ranking is expected. AI explanation remained unavailable while recorded metadata stayed visible.
- Browser upload of the existing approved Planet Comics #12 reference produced **Likely match: Planet Comics #12 (1941)**, displayed its real catalog metadata and automatic unavailable valuation state. This verified the existing fingerprint fallback, **not** a successful OpenAI scan of a modern book. No paid AI generation was run to manufacture a positive result.
- The cloud browser has no physical camera device; the camera path reported Requested device not found. A real-device camera/lighting/glare test was not performed.
- At the checked desktop viewport, Home/Directory had no document-level horizontal overflow or broken loaded image elements. Available public-domain art loaded; unresolved modern cover areas rendered the styled title/issue fallback. This is not a complete device/browser accessibility certification.
- Private draft and owner diagnostics endpoints rejected unauthenticated reads with 401 and 403 respectively. The current browser was unsigned; authenticated marketplace cards, seller saves and live checkout were not exercised in that browser. Their changed persistence/arithmetic/ownership logic was checked in the isolated tests above.

Evidence:

- `evidence/comichuddle-market-pulse-1792053203558.jpg`
- `evidence/comichuddle-scanner-match-1792053511613.jpg`

These screenshots show the deployed coordinated UI before the final narrow search/permission/owned-quantity corrections; the same components and public feature states remain in the final release.

## Honest provider state and activation prerequisites

1. The fresh public AI availability response reported **AI Gateway has no available credits**, using the existing `openai/gpt-4.1-mini` connection. No credits were purchased, billing plan changed, or replacement credential installed. OpenAI observation/retrieval and approved-reference comparison are wired, but a successful live model response remains unverified until credits/access exist.
2. No external pricing transaction/benchmark feed is configured. The permissioned feed adapter and reviewed-original-evidence intake exist; there is no claim that current eBay, dealer or auction evidence was fetched. Search engines/model memory are not substituted for actual completed sales. No eBay access restriction was bypassed.
3. Existing S3/CloudFront cover resources, service access and reviewed source caching/display/AI permissions are not configured. Native cover resolution therefore returned DISABLED and a retro placeholder. Metadata/retained URL references alone cannot produce approved cached cover bytes. This is a configuration/rights prerequisite, not a claimed CORS fix or proof that an upstream scan does not exist.
4. Vercel rejected an hourly cron on the current Hobby plan. Recovery runs daily at 05:05 UTC; visible cards accelerate durable jobs on demand. Existing release jobs remain. No paid infrastructure or plan upgrade was made.

Until these prerequisites are met and the positive provider paths are tested, this release should be treated as an interactive preview with honest unavailable states, not a declaration that every price, cover, AI match or real-money financial flow is production-certified.

Implementation, exact environment requirements, source-intake contracts, freshness/budget policies and rollback: `COORDINATED-COLLECTOR-UPGRADE-2026-10-15.md`.
