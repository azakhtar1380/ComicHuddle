# ComicHuddle launch runbook

This is the one page to follow to take the current code live. Detailed guides:

- Payments: [PAYMENTS-SETUP.md](PAYMENTS-SETUP.md)
- Scanner and cover images: [SCANNER-AND-COVERS-SETUP.md](SCANNER-AND-COVERS-SETUP.md)
- Hosting and database safety rules: [../DEPLOYMENT.md](../DEPLOYMENT.md)

## What changed in this release

| Area | Change |
|---|---|
| Brand and theme | New storefront look (`app/theme-pro.css`): sticky header with catalog search, Scan button, category nav, trust bar, comic-style hero, product grid, pro footer, 5-tab mobile bar. Fixed mobile horizontal overflow. |
| Covers | Comic-style placeholder art for books without a licensed cover; optional Metron cover source (`COVER_DIRECT_DISPLAY=metron`). |
| Scanner | Barcode-first live scanning (350 ms loop on a barcode strip), persistent decoder, add-on (5-digit) handling, Metron UPC fallback with caching, clear "Found → Confirm" flow. |
| Payments | Test/live switch (`COMMERCE_STRIPE_MODE`), dispute/refund/async-failure/expiry webhook fixes, `account.updated`, 1-hour checkout expiry that relists instead of withdrawing. |
| Database | New additive migrations 024+ applied automatically on build by `scripts/migrate-additive.ts`. |
| Accounts | Sign-up, login, logout, profile creation verified on desktop and mobile; new sign-out page; "Forgot password" now routes to support. |
| Local development | `CH_LOCAL_DB=pglite` runs the whole site on an in-memory database with a sample catalog. It never touches RDS. |

## Owner checklist (in order)

1. **Get the code onto GitHub.** Install Git for Windows, then from the project folder:
   `git add -A`, `git commit -m "Launch release"`, `git push origin main`.
2. **Deploy to Vercel.** The project currently deploys with the Vercel CLI (no Git link).
   Either run `npx vercel --prod` after `npx vercel login`, or in the Vercel dashboard,
   go to Project → Settings → Git, connect `azakhtar1380/ComicHuddle`, and deploy `main` (recommended: every push then deploys).
   Keep `MIGRATE_ON_BUILD=false` and `MIGRATE_ENRICHMENT_ON_BUILD=true`.
3. **Confirm the build log** shows `Applied additive migration 024_…` and `025_…` (or "checksum verified" on later builds).
4. **Stripe, test mode first:** follow PAYMENTS-SETUP.md sections 1–8. Run one full test order (pay → ship → deliver → refund).
5. **Metron:** create an account and token, email Metron about commercial server use, then set `METRON_API_TOKEN` and `METRON_UPC_ENABLED=true`.
6. **Cover images:** decide between Option A (direct Metron display) and Option B (your own S3/CloudFront). See SCANNER-AND-COVERS-SETUP.md section 6.
7. **Email provider** (needed for password reset and order emails): add a transactional email service (e.g. Resend or Postmark) and wire Better Auth's `sendResetPassword`. Until then, "Forgot password" goes to support.
8. **Legal pages:** have Terms of Service, Privacy Policy and the marketplace seller agreement reviewed by a lawyer before taking real money.
9. **Go live with payments:** PAYMENTS-SETUP.md section 9, then set `COMMERCE_NEW_CHECKOUT_PAUSED=false`.
10. **Phone test:** scan a real barcode on an iPhone (Safari) and an Android phone (Chrome), and buy one item with Apple Pay / Google Pay in test mode.

## Run the site locally

```
npm ci --include=dev --ignore-scripts
node node_modules/esbuild/install.js
npm run dev
```

`.env.local` must contain `CH_LOCAL_DB=pglite`, a 32+ character `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL=http://localhost:3000`.
The local database is rebuilt on every server start.
