# Scanner and cover images: owner setup

This guide covers what the owner must do so that barcode scanning finds most modern comics and catalog cards show cover images. Every feature below is **off by default**. Without these steps the app behaves as before: it uses the local barcode index and shows the honest placeholder for covers.

## 1. Apply the database migration

`db/postgres-migrations/025_metron_identifiers_covers.sql` is additive only. It adds:

- `ch_web.metron_identifier_lookups`, a per-barcode cache of positive and negative results.
- `ch_web.provider_request_windows`, the shared Metron per-minute and per-day request budget.
- A **disabled** `METRON` row in `ch_web.source_permissions`. Every flag on that row is false and it grants nothing. It exists only so Metron cover rows satisfy the existing foreign key.

It is applied **automatically** on the next production build by `scripts/migrate-additive.ts`, which runs whenever `MIGRATE_ENRICHMENT_ON_BUILD=true` (already set in production). The runner applies 024+ once, records a checksum and refuses to re-apply a changed file. **Do not** use `npm run db:migrate` or `MIGRATE_ON_BUILD=true` on the existing production database; those run the initial seed pipeline (see DEPLOYMENT.md). If the migration is missing, the new code paths fail closed: the Metron fallback returns "unavailable" and no covers are shown.

## 2. Get a Metron account and API token

1. Create an account at https://metron.cloud.
2. Open your profile, choose **API Tokens**, then **Generate Token**. The token is shown only once.
3. Store it as a server-only secret: `METRON_API_TOKEN=<token>`. Never use a `NEXT_PUBLIC_` variable for it. The app sends it as `Authorization: Bearer <token>`.

Standard limits are 20 requests per minute and 5,000 per day. Donors through Open Collective get up to 25,000 per day. The app enforces its own lower budget:

| Variable | Default | Maximum |
|---|---|---|
| `METRON_MINUTE_BUDGET` | 15 | 20 |
| `METRON_DAILY_BUDGET` | 2000 | 25000 |

The budget is shared by the barcode fallback and cover lookups. It leaves headroom for the existing nightly Metron catalog sync, which uses the same token.

The app honours `Retry-After` and the `X-RateLimit-*` headers. A 429 response, an exhausted limit, or a rejected token pauses all Metron calls (the provider key `metron-api` in `ch_web.enrichment_provider_limits`).

## 3. Email Metron about commercial server use (required before enabling)

Metron's guidance (https://metron-project.github.io/blog/commercial-api-use):

- Commercial use is allowed under CC BY-SA 4.0.
- Apps that serve many people should **not** ship one built-in account shared by all users.
- Covers are **not** licensed by Metron.

ComicHuddle's barcode fallback and cover resolver are server-side features that use one business token. Email **bpepple@metron.cloud** before setting the flags below. Describe the usage: a marketplace, server-side lookups, per-barcode caching, the request budget above, and attribution in the footer. Ask whether this is acceptable or whether they would prefer a sponsorship. Keep the reply as your evidence reference.

## 4. Enable the barcode fallback

```
METRON_API_TOKEN=<token>
METRON_UPC_ENABLED=true
```

Lookup order for a scanned barcode:

1. The local identifier index with the exact supplement.
2. The local index for records stored without a supplement.
3. Metron with `?upc=<base+supplement>`.
4. Metron with `?upc_starts_with=<base>`.

Metron's `gcd_id` is mapped to the catalog ID `4000000000 + gcd_id`. Matches are written back to `ch_web.directory_identifiers` with source `METRON`, and every result, including "not found", is cached per barcode. A repeat scan therefore never calls Metron again before the cache expires: 30 days for hits, 7 days for misses. If Metron knows a barcode that is not in the ComicHuddle catalog, the scanner shows it as a "Found on Metron" card and pre-fills the catalog search.

## 5. Make sure the identifier index finishes building

The local index is filled by `/api/cron/enrichment`, which runs daily at 05:05 UTC (see `vercel.json`). It needs `CRON_SECRET` set in Vercel. Check that it is running:

```sql
SELECT scanned_count,matched_issue_count,identifier_count,completed_at,updated_at
FROM ch_web.directory_identifier_sync WHERE id='native-gcd';
```

`updated_at` should advance every day, and `completed_at` should become non-null once the index is complete. The batch now skips GCD rows that have no barcode or ISBN, so progress is much faster than before. To catch up manually:

```
curl -H "Authorization: Bearer $CRON_SECRET" https://<site>/api/cron/enrichment
```

## 5a. How a photo is identified (upload or "Use this frame")

Each step is shown to the user as it runs:

1. **Barcode on the device.** The photo is read at full resolution. The whole image is tried first, then the corners and edges where comic barcodes sit, each sharpened. The 5-digit add-on is read too.
2. **Barcode on the server.** If the device found nothing, `POST /api/recognition/decode` runs a stronger pass: EXIF rotation, normalising, several sizes, and tiles. It is free (CPU only), is not throttled per user, and the photo is never stored.
3. **Barcode lookup.** The local index is searched, then Metron (if enabled). If a barcode is read but not found, the user sees "Read barcode … — not in our catalog yet".
4. **AI cover identification (optional, free tier only; see 5b).** The model reads title, issue, publisher and year. The catalog is then searched and the ranked editions are shown for the user to confirm. Nothing is ever added automatically.
5. **Free on-device cover text (OCR).** This runs whenever AI is off, out of free quota or unsure. Tesseract reads the masthead, the top-corner issue box and the whole cover. Title, issue number, publisher and year are extracted and fuzzy-matched against the catalog. The status reads "Matching by cover text…" and never shows a limit or error message.
6. **Manual search** is always available.

iPhone HEIC photos open in Safari. If a browser cannot decode the photo, the scanner asks for a JPEG.

## 5b. Optional: Google Gemini free tier for cover identification

Off by default. To enable:

```
SCANNER_AI_PROVIDER=gemini
GEMINI_API_KEY=<key from Google AI Studio>     # server-only; never NEXT_PUBLIC_
# optional:
SCANNER_AI_MODEL=gemini-3.6-flash              # default
SCANNER_AI_DAILY_LIMIT=100                     # global cap per UTC day
SCANNER_AI_MINUTE_LIMIT=8                      # global cap per minute
```

**Zero cost.**

- Create the key in Google AI Studio (https://aistudio.google.com) in a Google Cloud project **without a billing account**. Google cannot charge a project that has no billing, even if limits or prices change. Do not attach billing to that project.
- Free-tier rate limits are applied per project. Google shows the current RPM and RPD for each model on the AI Studio rate-limit page; they are not listed as fixed numbers in the docs. Set `SCANNER_AI_DAILY_LIMIT` and `SCANNER_AI_MINUTE_LIMIT` to about 80% of what AI Studio shows for your project.
- Only these global caps exist. There is no per-user throttling.
- Any 429 / `RESOURCE_EXHAUSTED`, permission or billing error turns AI off until the next Pacific-time midnight, when Google resets daily quotas.
- Reaching the daily cap does the same.
- While AI is off, scans quietly use the free OCR path.
- Results are cached by the photo's SHA-256 in `ch_web.cover_vision_cache` (migration `026`). Only the JSON result is cached, never the photo.
- Photos are downscaled to at most 1024 px before sending.

**Privacy and terms.**

- On the free tier, Google may use submitted content to improve its products, and human reviewers may read it (Gemini API terms: https://ai.google.dev/gemini-api/terms).
- Users must be 18 or older.
- In the EEA, Switzerland and the UK, the terms allow serving users only with paid services. **Do not enable the free tier for users in those regions.**
- The scanner's privacy note tells users the photo may be sent to Google Gemini when this is enabled.

Request format used (docs: https://ai.google.dev/gemini-api/docs/generate-content/structured-output and https://ai.google.dev/gemini-api/docs/generate-content/image-understanding):

- `POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`
- Header: `x-goog-api-key`
- Image part: `inline_data {mime_type, data}`
- JSON output: `generationConfig.responseFormat.text {mimeType: "APPLICATION_JSON", schema}`, retried once with `responseMimeType` + `responseJsonSchema` if Google rejects the first form.

Newer AI Studio keys start with `AQ.`; they work with the `x-goog-api-key` header.

## 6. Cover images: an owner policy decision

Neither Metron nor GCD holds a licence for cover artwork. Publishers and creators own it. Showing covers commercially relies on your own legal judgement (for example US fair use for identification) or on publisher or distributor permission. Many publishers provide retailer art through Lunar, PRH or Universal. **Decide this before enabling either option below.**

### Option A: interim direct display (no S3)

```
METRON_API_TOKEN=<token>
COVER_DIRECT_DISPLAY=metron
```

How it works:

- When a card needs a cover, the server asks Metron for `?gcd_id=<id>`, using one request per issue and the shared budget.
- It stores Metron's own `https://static.metron.cloud/...` image URL in `ch_web.cover_cache` for 30 days. Misses are also cached for 30 days, and failures back off.
- The browser loads the image directly from Metron with `referrerPolicy="no-referrer"`. The caption reads "Cover © its publisher and creators · image via Metron (metron.cloud)".
- Covers fill gradually, about 15 per minute across the site. Each `/api/covers` request also runs up to 4 queued jobs, and the daily cron runs more.

Unsetting `COVER_DIRECT_DISPLAY` hides these images immediately; no purge is needed.

### Option B: cached copies on your own CDN (existing S3 path)

1. Configure `COVER_STORAGE_BUCKET`, `COVER_CDN_BASE_URL`, `COVER_CLOUDFRONT_DISTRIBUTION_ID`, AWS credentials, `COVER_STORAGE_REVIEWED=true` and `ENRICHMENT_COVERS_ENABLED=true`.
2. Record a reviewed grant with `scripts/review-enrichment-source.ts`. For Metron, use provider `METRON` with `approved_hosts` set to `["static.metron.cloud"]`, `access`, `cache` and `display` all true, and your evidence reference.
3. A reviewed `GCD` grant still takes precedence over `METRON` when both exist.
4. Jobs fetch the Metron image and write 240/480/960 px WebP renditions to S3 under `comic-covers/METRON/<gcdId>/...`.

Revoking either grant with `revokeCoverProvider` disables display and queues the purge.

## 7. Footer credit (CC BY-SA attribution)

Import `CATALOG_DATA_CREDIT` and `CATALOG_DATA_CREDIT_LINKS` from `lib/data-credits.ts` and render them in the site footer. CC BY-SA requires credit to GCD and Metron plus a link to the licence.

## 8. Verify on a real phone

The automated checks use a mocked camera and mocked Metron responses. After deploying, test on iPhone Safari and on Android Chrome:

1. Open Scan. The camera starts in **Barcode** mode with a red scan line.
2. Hold a modern comic's barcode and 5-digit add-on in the strip, about a hand-width away. Within about 1–2 s the phone vibrates (Android) and the screen shows "Found: …" or the editions that share the code.
3. **Whole cover** mode and **Use this frame** run the photo steps in 5a. **Upload Image** and manual search still work when the camera does not.
4. The camera needs HTTPS. Over a plain-HTTP LAN address such as `http://10.0.0.11:3000`, browsers block it; use **Upload Image** there, or an HTTPS tunnel or deployment.
