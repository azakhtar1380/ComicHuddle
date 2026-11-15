# Market data setup (Sales & Value)

`GET /api/issues/{id}/insights[?grade=9.8]` (engine: `lib/issue-insights.ts`, math in
`lib/issue-insights-core.ts`) builds the issue page's **Sales & Value** tab and **Market Snapshot**
tile. All of it is deterministic local logic: no AI/model calls, no scraping. When there are no
price observations it returns `status: "unavailable"` and the UI shows "Sales data not available".

## Sources and what unlocks them

| Source | Kind | Status without setup |
|---|---|---|
| CGC-reported sales (`lib/reported-sales.ts`) | dated individual sales | live (curated key issues) |
| ComicHuddle completed sales, listings, auctions, want lists, collections | sales / asks / bids / demand | live (fills as the marketplace is used) |
| Licensed FMV (`gcd.fmv_records`, `gcd.fmv_history`, `ch_web.market_values`) | FMV + trend history | empty until a licensed feed or licensed import runs |
| Verified sold comps (`gcd.sales_comps`) | confirmed sales | empty until a licensed feed or licensed import runs |
| eBay Browse API | **asking prices only** (active listings) | skipped until keys are set |

Missing sources show up in the response's `missingSources` with a short setup hint.

## eBay asking prices (official Browse API)

1. Create a production keyset at developer.ebay.com (you need an eBay developer account).
2. Set these server environment variables (for example in Vercel project settings; never commit them):
   - `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` (required)
   - `EBAY_COMICS_CATEGORY_ID` (optional, default `259104` "Comics & Graphic Novels")
   - `EBAY_MARKETPLACE_ID` (optional, default `EBAY_US`), `EBAY_ENV=sandbox` (optional, for testing)
   - `EBAY_CACHE_TTL_HOURS` (optional, default 12, minimum 6)
3. Redeploy. The engine gets an OAuth client-credentials token (scope `https://api.ebay.com/oauth/api_scope`),
   searches `"<series> #<number> <year>"` for fixed-price USD listings, drops obvious mismatches
   (reprints, facsimiles, lots, unrequested variants, other issue numbers or years, non-CGC graders), caches
   results in memory, and uses a 2.5 s timeout. Results are labelled "eBay asking prices"; they never
   set a value and are never shown as sales. eBay sold-listing pages are not scraped (eBay ToS).

## Licensed completed-sales feed (real values and trends)

Values with `high`/`medium` confidence need confirmed recent sales. Connect a feed you hold
redistribution rights for (see `lib/weekly-fmv.ts`):

- `FMV_WEEKLY_SYNC_ENABLED=true`
- `FMV_LICENSED_FEED_URL` (https), `FMV_LICENSED_FEED_TOKEN`, `FMV_LICENSED_FEED_HOSTS` (allowed hostnames)

`syncWeeklyFmv` imports comps into `gcd.sales_comps` and writes rolling medians to `gcd.fmv_records`
(history goes to `gcd.fmv_history` automatically). Note: `/api/cron/fmv` is currently retired (returns
410), so nothing calls `syncWeeklyFmv` yet. It has to be re-enabled (or run from a script) once a feed
contract exists. GoCollect, CovrPrice, Heritage and
similar sites are not scraped; use them only through a signed data license.

## How values are computed (short)

- Each observation is normalized to source, kind (sale / fmv / ask / bid), USD amount, date, exact
  CGC grade, label and mode (Raw/CGC).
- Source weights: licensed FMV and licensed sales 1.0 › ComicHuddle verified sales 0.85 › CGC-reported
  0.7 › seller-reported sales 0.35. Asks/bids are never part of a value.
- Per exact grade bucket: log-MAD outlier trimming (≥4 sales), 90-day half-life time decay, weighted
  median and quartile range. Headline = requested grade, else the most-traded standard-label grade.
- A requested CGC grade with no data of its own can get a derived value from ≥2 sales of the same
  issue at grades within 1.5 points (fitted log-linear grade curve), labelled "Derived from N sales at
  other grades", confidence `low`.
- Confidence: `high` = ≥5 confirmed sales in 180 days from ≥3 independent sellers/venues; `medium` =
  ≥2 in 180 days, ≥3 in 12 months, or a fresh licensed FMV; otherwise `low`.
- Trend: same-grade recent vs prior window medians (90, then 180, then 365 days; ≥2 points each).
