# Prepared browser acceptance suite

`scan-card.spec.mjs` was **not executed** in this workspace. It is a ready-to-run
Playwright spec for an approved external CI environment that already supplies
Playwright and its supported browser. Do not start a Site preview server or
install a browser to claim a result here.

Set `COMICHUDDLE_STAGING_URL` to the approved test deployment. Run from the
repository root in that external environment:

```sh
playwright test --config architecture/e2e/playwright.config.mjs --project=chromium
```

The write case requires `COMICHUDDLE_TEST_AUTH_STATE` pointing to a provisioned
test-account storage state and `COMICHUDDLE_TEST_CONFIRM_WRITES=true`. It writes
only in that explicitly selected staging account. The other cases exercise
mobile DOM navigation, compact Directory card → exact detail/actions,
controlled permission denial and actual browser JPEG decoding. Five additional
cases measure the actual two-column Grid/saved-List DOM at 320, 360, 390, 430 and
760 pixels, portrait cover bounds, wrapping and horizontal overflow. Three further
cases use long unbroken publisher/title/issue API fixtures at 320, 375 and 390 pixels
to measure root/select/search/card containment and absent mobile breadcrumbs/tree.
These controlled layout fixtures do not establish catalog coverage. All thirteen cases
remain unexecuted here. They do not establish physical camera accuracy, real OAuth or native
app operation. Physical iOS/Android, camera glare/rotation/reprints, accessible
modal focus and broader recognition coverage remain separate acceptance work.
