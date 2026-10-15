# Coordinated collector upgrade — 15 October 2026

This is an additive continuation of the current ComicHuddle app. No branch reset, imported GCD mutation, catalog reimport, payment-mode promotion, or new paid infrastructure is part of this release. The current repository and Vercel project remain the source of truth. The Upcoming page stays removed; existing release ingestion remains intact.

## Listing builder and persistence

`app/listing-builder.tsx` replaces the old marketplace editor. One live directory dropdown opens immediately. Explicit year qualifiers after an issue number or in parentheses and mixed publisher/title words are supported by native retrieval; numeric titles such as 2000 AD remain titles. Selected native/retained IDs become a removable list; one physical copy infers a single listing, multiple copies infer a collection. Repeated physical copies use stable IDs and quantity, with a separate row for a different condition or serial. Existing owned copies are reused when selected and when quantity grows, preserving their physical IDs and private acquisition values. Reserved and separately certified copies are excluded from automatic quantity pooling. Photos of actual copies, ownership/USA attestations, existing inventory reservations, and seller authorization still apply. Auctions remain the existing **nonbinding preview**; this release does not promote them into paid live auctions.

The three steps are Comics, Price & delivery, Photos & publish. A draft is private to the authenticated account, written through bounded requests and revision compare-and-swap. A browser recovery copy is timestamped. Concurrent-tab conflicts retain choices and refuse silent overwrites. Stable copy IDs survive retries. A successful publish clears only the acknowledged draft revision after in-flight saving settles. AI, cover resolution and the social refresh do not gate saving or publication.

A listing records declared condition separately from asking price and private purchase cost. Publishing retains this condition on the physical vault copy. Editing legacy ownership details clears an old structured valuation condition rather than continuing to price a changed copy.

## Shared, automatic estimated FMV

Every integrated surface uses **Estimated FMV (AI-Powered)**: directory, homepage/search, picker, issue detail, marketplace card/detail, seller preview, collection and grail/profile cards, and scanner confirmation. Numeric estimates are ranges, never silently substituted for asking price or current bid. A card can expose `awaiting_details`, `queued`, `generating`, `available`, `refreshing`, `insufficient_evidence`, or `service_failure` without an indefinite spinner. Missing evidence is **Not enough pricing evidence yet**.

The target includes exact canonical issue, year/variant/language, declared raw/CGC grade, label, printing, signature and restoration information. No physical copy inherits a reference grade. Directory discovery uses an explicitly labeled Raw Very Fine reference; the detail controls can select other reference grades. Certification serials and seller asks are not monetary anchors.

The same target/snapshot is reused across users and seller/buyer surfaces. The server uses integer cents and quantities; unpriced components are excluded with explicit coverage counts. A total is the sum of individual estimates, not a guaranteed bundle realization. Composition versions are derived from physical IDs, directory identity and condition, independent of ask.

**The intended market is the broader external comics market.** `lib/external-valuation-evidence.ts` is an adapter for an actually authorized original transaction feed. `scripts/import-reviewed-valuation-evidence.ts` admits reviewed original sale observations or reviewed pricing benchmarks. Neither retrieves model-memory prices nor scrapes eBay. There is no currently configured external feed, and this release does not claim current external research was performed for any book.

Eligible sales require exact edition/condition match, known USD item-only amount, original source URL/transaction identity, reviewed economic independence, and valid retention/display/AI/valuation permission. Asking prices, active bids, unsold/cancelled/refunded outcomes, unknown accepted-offer amounts, subsidized/discounted observations and multi-book inferred allocations are rejected. Shipping/tax/premiums are separate. IDs dedupe by original-source origin and original transaction ID, not the syndicating feed. Feed implementers must preserve original IDs/entity keys across syndication.

The evidence range requires at least five recent observations, three independent entities, no entity above 40% (including after filtering), at least one observation within 30 days, and a 90-day maximum sale window. A robust log-MAD filter applies when at least nine observations exist. Observed quartiles weight recency with a 30-day half-life and confirmed-paid reliability over published auction results. No automatic preference is given to ComicHuddle. A reviewed benchmark is labeled **Baseline estimate · Limited evidence**, not a sale. Benchmarks expire from the evidence window after 30 days. Current platform orders are sandbox-only and do not qualify as sale evidence.

Only after evidence qualifies does OpenAI select relevant supplied IDs and explain limitations. Unknown IDs or unsupported numerical prose fail validation. Range arithmetic remains deterministic. A provider failure withholds a numeric AI result; it never invents a fallback price. Each snapshot retains evidence references, original source links, evidence dates, model, methodology, assumptions and expiry. Provider permission expiry/revocation suppresses reads immediately. The original source grants govern downstream retention; the adapter conservatively expires observations at most 30 days or earlier permission expiry.

### Automatic generation, freshness and budget

Existing eligible snapshots travel in catalog card data. Visible cards mount the shared client batcher (30 targets/request), then automatically queue missing/expired server targets. RDS unique job keys and leased claims suppress duplicate model work. Initial background acceleration uses Next `after`; the persisted job and daily recovery cron provide recovery. Cards poll queued work automatically, initially every five seconds then every 30 seconds, bounded to ten minutes. Subsequent freshness expiry retriggers reads; no Generate/Research action is required. Client inactive caches are bounded. Listing composition recalculation is debounced and clears a changed total before replacing it.

Available estimates expire after one day, with a one-hour explicitly refreshing grace period. Insufficient evidence caches for six hours; service failure for 15 minutes. Snapshot eligibility always rechecks permission. The default distributed AI reservation cap is 100 cents/day, bounded to at most 10,000 cents by configuration. Valuation/Pulse reserve two cents and scanner calls three cents. These are application reservation ceilings, **not an invoice or guarantee of vendor charges**. No million-record paid backfill is scheduled. Only visible/actively used targets enqueue. Failed/rate-limited jobs use bounded retries and dead letters.

To connect external evidence, use secure Vercel environment settings for `COMICHUDDLE_EXTERNAL_COMPS_URL`, `COMICHUDDLE_EXTERNAL_COMPS_PROVIDER`, `COMICHUDDLE_EXTERNAL_COMPS_TOKEN`. Review access/retention/AI/display permissions for the feed **and original-source hosts** before enabling a `source_permissions` record. A token alone is not a rights grant. The JSON contract is the strict schema in `lib/external-valuation-evidence.ts`; the feed must echo the server target key. Sources actually used appear on snapshots. No claim is made to check the whole internet.

Operator commands, with DB credentials injected securely into the process environment:

```
npx tsx scripts/review-enrichment-source.ts /secure/reviewed-permission.json
npx tsx scripts/import-reviewed-valuation-evidence.ts /secure/reviewed-original-observations.json
```

No sample monetary observations or permission grants are seeded in production.

## Cover resolution, caching, rights and takedown

The public read path uses local approved reference art, actual seller photos, or a current reviewed S3/CloudFront cache row. Historical GCD URL references do not imply permission to cache or hotlink copyrighted art. The source resolver uses the exact issue API and supplied cover identity; no guessed cover-ID arithmetic, parent-variant borrowing, search-engine scraping, referrer spoofing or denial bypass exists. Explicit absence is `NOT_FOUND`; denied/HTML/challenge/quota/unknown-schema responses remain distinct failures.

The worker is disabled until `ENRICHMENT_COVERS_ENABLED=true`, a current reviewed GCD source record, approved hosts, and reviewed storage exist. Required existing infrastructure settings: `COVER_STORAGE_BUCKET`, HTTPS `COVER_CDN_BASE_URL`, `COVER_CLOUDFRONT_DISTRIBUTION_ID`, AWS service credentials or workload role, `AWS_REGION`, and `COVER_STORAGE_REVIEWED=true`. Nothing was provisioned or billed by this release. GCD authentication, if required, remains server-only `GCD_USERNAME`/`GCD_PASSWORD`.

`infrastructure/cover-cache-policy.example.json` scopes worker writes/deletes to a cover prefix and invalidation to one distribution. Replace identifiers with existing reviewed resources; do not apply blindly. Use a private bucket with CloudFront origin access, TLS-only access, versioning/lifecycle appropriate to licensed retention, GET/HEAD viewer methods, and a custom response policy allowing only the app origin where cross-origin canvas access is explicitly needed. Do not grant public writes or broaden the RDS firewall.

SSRF controls validate exact HTTPS hosts, disallow credentials/ports/IP URL literals, resolve and pin public IPs at every redirect, strip credentials on host changes, and limit redirects/time/bytes. Decode limits reject SVG/HTML, animation and oversized images. Renditions are aspect-preserving 240/480/960px WebP, never upscaled, keyed by issue/source-cover/content hash. All objects upload before `CACHED` is committed. One cover is processed per issue job to bound runtime; variants have their own exact issue IDs. A conservative 30-second GCD job spacing is a **project testing policy**, not a quoted upstream quota.

Cache metadata includes source identity, permission reference/expiry, sizes/hash, dates, sanitized error/status/retry and CDN keys. Jobs use SKIP LOCKED claims, leases, crash recovery and bounded retry with Retry-After. Expired negative states can recheck. Browser load failures show the retro title/issue/year/publisher fallback immediately and report only an issue ID; the worker probes its own stored CDN key before evicting a healthy object. Source access denials trip a circuit and require operator review rather than repeated hammering.

Owner Data diagnostics report actual cache states, queue health, daily hits/state counts, valuation coverage, model usage/reservations and scanner outcomes. `POST /api/enrichment` with owner authentication can revoke a provider: application reads suppress art immediately; durable purge removes S3 objects and requests CloudFront invalidation. Expired/revoked pricing sources are likewise hidden. Cached copies already downloaded by someone cannot be recalled. Purge needs storage access to finish; inspect queue errors rather than claiming deletion completed.

## Scanner

The existing on-device OCR and reference matcher remain available. With explicit image-processing consent and available credits, OpenAI reads observed title, number, publisher, date, price box/barcode/printing clues and photo quality. The server queries real indexed GCD directory records, then validates/ranks those candidates; model-invented directory IDs cannot be admitted. Alphanumeric issue numbers are retained. Ambiguous printings need confirmation or indicia, poor/multiple-book photos need a retake, and image mismatch never proves catalog absence.

When at least two appropriate cached references also have current **AI-processing** permission, a second bounded comparison may inspect those references. It is advisory and cannot turn ambiguous identical artwork into authenticated printing or counterfeit detection. Without permission, no reference art is sent. The response identifies metadata-only matching. No provider/token/OCR/cover shortage disables manual directory selection.

Uploads are bounded, normalized without EXIF, not retained by ComicHuddle or logged, and use `store:false`; provider policies still apply. Camera remains user initiated. Captured/uploaded images invoke the AI path only with consent; repeated live camera frames use the existing on-device path to avoid uncontrolled paid processing. The confirmed actual issue uses the same `addIssue` builder callback, permits multiple sequential scans and exposes its automatic estimate. Recognition is not grading, authenticity certification, signature verification or investment advice.

Current model: the existing `openai/gpt-4.1-mini` via Vercel AI Gateway; optional direct `OPENAI_API_KEY` uses its official model ID. Availability checks do not generate images or text. A daily per-client eight-scan allowance and shared reservations bound use. No credits were purchased or provider switched. Real-camera behavior and physical cover accuracy require a representative consented test corpus; passing metadata fixtures is not an accuracy percentage.

## Market Pulse

Black IBM Plex Mono digital typography, tabular numerals, neutral cream/black framing, descriptive normal text and mobile paging replace the static ticker. The bundled Google Fonts TTF retains its OFL license. No fabricated scrolling prices or investment-style neon charts.

Actual rolling seven-day boundaries, America/Chicago display timezone, methodology and updated time accompany Top Sold, Most Wanted, Gaining Attention, Notable Sales and clearly separated Collector Spotlight. Qualifying sales require live settlement/charge, delivery, passed review and confirmed transfer, no refund/dispute/self/owner trade. Manual sold flags, unpaid/nonbinding auctions and all current sandbox orders are excluded. Bundles count physical copies without invented unit-revenue allocation. Grail/attention counts use deduplicated eligible accounts and ignore owner/recent/moderated accounts. Growth uses comparable windows and sufficient counts; a zero denominator says New activity, not an invented percentage.

AI only explains supplied metric IDs; validation rejects unsupported numbers, movie/news/scarcity/investment causal claims. Provider failure leaves measured data visible. Current sales ranking can legitimately be empty. Discovery entries are actual catalog records labeled as spotlight, not top sales or FMV gainers. No external market-wide activity claim is made.

## Deployment, verification and rollback

Migration `022_coordinated_enrichment.sql` creates application-owned tables only. `MIGRATE_ENRICHMENT_ON_BUILD=true` runs `scripts/migrate-enrichment.ts` with the existing advisory lock and checksums. Deploy with legacy `MIGRATE_ON_BUILD=false` so this release never reruns the large catalog/index/seed pipeline. The migration is additive and safe for the previous runtime to ignore.

The daily protected `/api/cron/enrichment` drains at most 20 jobs/240 seconds. Existing weekly catalog jobs are retained. Vercel rejected an hourly schedule on the current Hobby plan, so recovery runs daily at 05:05 UTC; visible-card requests still accelerate jobs with Next `after`. No billing upgrade was made. A more frequent unattended drain needs a separately approved worker or plan. `CRON_SECRET` is the existing authenticated secret; never log it. Workers do not acquire new artwork or external price data until reviewed configuration exists.

Focused checks: `node --import tsx --test checks/coordinated-upgrade.test.ts checks/native-rewards-fmv.test.ts`; `node --import tsx checks/listing-builder-ui.mjs`; `npm run typecheck`; production build. The controlled-hook builder checks run actual component callbacks and JSX, with substituted network/storage; they are not a signed-in browser E2E assertion. Test-only pricing observations, source grants, object writes and owned listings are isolated in in-memory PostgreSQL; none are seeded into RDS. Live browser screenshots and deployment outcomes are recorded in the companion release evidence.

Rollback: promote the previous known-good Vercel deployment without deleting imported GCD or application tables. Disable enrichment cron/provider flags if needed. Keep the additive tables/drafts/observations for review; do not destructively roll back monetary histories. If replacing an already-applied migration, create a new numbered migration rather than changing its checksum.

## Explicit remaining provider prerequisites

- No external transaction/benchmark feed is currently configured. No retrieved sale-backed numeric estimate can honestly be claimed yet.
- AI Gateway previously reported no credits; recheck the public availability endpoint after deployment. Do not bypass billing restrictions.
- Approved S3/CloudFront cover storage and source caching/AI rights are not currently configured. Imported bibliographic records alone do not supply cover bytes or rights.
- Existing payment/auction release constraints are preserved. This upgrade is not a promotion to real-money escrow, paid auctions or a guaranteed public launch.
