# Testing ComicHuddle

There are two layers. Run both before anything goes live.

| Command | What it checks | Time |
|---|---|---|
| `npm run test:unit` | Server logic: payments, orders, payouts, drafts, cart, emails (about 250 tests) | ~10 min |
| `npm run test:e2e` | A real browser clicks through the site as a **guest**, a **buyer**, a **seller** and an **admin**, at **desktop** and **phone** size, and compares screenshots | ~20 min |
| `npm run test:all` | Type check, then both of the above | ~30 min |

## How the browser tests work

- `scripts/e2e-server.mjs` starts the whole site on port 3100 with a **throwaway in-memory database** (sample catalog and every US ZIP).
  It never touches the QA or production database, Stripe, EasyPost, Metron or AWS, and emails are kept in memory instead of being sent.
- `e2e/global-setup.ts` creates the test accounts on that database every run:
  - buyer (`e2e-buyer@comichuddle.test`)
  - seller (`e2e-seller@comichuddle.test`)
  - admin (`e2e-admin@comichuddle.test`)

  Their passwords come from a random secret kept in `e2e/.auth/` (git-ignored) and are never printed. None of them is a real person's login.
- Every test also fails on any JavaScript error, console error or server error on the page, not only on missing text.

## Journeys covered

1. **Guest** (`e2e/1-guest.spec.ts`)
   - home, directory search, characters, about and contact
   - marketplace browsing
   - sign-in prompts, private and admin pages closed
   - sign-up form checks, joining for real
   - 404 page, phone bottom bar
2. **Seller** (`e2e/2-seller.spec.ts`)
   - empty Sell form
   - ZIP lookup and wrong-ZIP message inside the form
   - Save draft and close, Your drafts (continue, delete)
   - publishing with a photo, and the photo on the marketplace card
3. **Buyer** (`e2e/3-buyer.spec.ts`)
   - guest cart with sign-in only at checkout (returns to the cart)
   - Buy now returns to the same listing
   - Messages for guests, browser Back button
   - Peek inside on the home page, Hulk #181 key fact
   - trading an owned comic for a listing (opens Messages with the terms)
   - making an offer, with the result shown inside the listing window
   - signed-in cart; Orders, Wallet and Messages open; admin pages closed to buyers
4. **Admin** (`e2e/4-admin.spec.ts`): admin sections, cover review, email previews, audit log.
5. **Screenshots** (`e2e/5-visual.spec.ts`): home, marketplace, about, contact, sign-in, cart, directory, wallet, sell form.
6. **Profile** (`e2e/6-profile.spec.ts`): `/@handle` and its link-preview meta, hidden profiles 404, photo upload with Mr. Huddles at the photo’s bottom-right, both share cards and all five share buttons (or their copy-link fallback), scroll rows without a visible scroll bar.
7. **Collection tab** (`e2e/7-collection.spec.ts`): old Collection links redirect to My Profile → Collection, Add comics adds several in one save, and visitors see Everyone / Keys only / Only me (never the value).
8. *(Worlds were removed in the cleanup round; `e2e/8-worlds.spec.ts` is gone.)*
9. **Verified** (`e2e/9-verified.spec.ts`): a collector goes from pending to verified after admin approval.
10. **Trophies** (`e2e/10-trophies.spec.ts`): an unlock creates a notification and shows the unlock screen once; the trophy case page.
11. **Origin story** (`e2e/11-origin.spec.ts`): the one-time nudge and the setup page.
12. **Directory picks** (`e2e/12-directory-picks.spec.ts`): the owner picks the six, favorite character, favorite comic and WANTED grail from the Directory; saved without a reload; visitors see them.
13. **Profile header** (`e2e/13-profile-header.spec.ts`): nothing overlaps or clips at 360/390/430 and desktop, the four tabs fit without scrolling, Edit profile / Message on the right, Get verified for the owner only.
14. **Notifications** (`e2e/14-notifications.spec.ts`): bottom sheet under 640px and dropdown inside the window on desktop, chips scroll inside, Escape returns focus to the bell.
15. **Account panel** (`e2e/15-account-panel.spec.ts`): Get verified row first under You with a status pill, My profile opens My Profile, transform-only drawer, no sideways jump, Escape returns focus.
16. **Names** (`e2e/16-names.spec.ts`): 2 name and 2 handle changes, staff words blocked, old handle held and redirected, the form shows changes left.
17. **Founder** (`e2e/17-founder.spec.ts`): the founder email shows the Founder badge only, and the email never reaches the browser.
18. **Scrolling** (`e2e/18-scroll.spec.ts`): after opening and closing the share window, a picker sheet, notifications and the account panel, the page still scrolls; Home, Directory and Marketplace scroll to the bottom.
19. **Listing page** (`e2e/19-listing-page.spec.ts`): card images load (no 404s or empty images), the gallery is 4:5, each comic uses its own cover (never the listing photo), comics come before the seller card, and tapping a comic opens the issue.
20. **Custom comic** (`e2e/20-custom-comic.spec.ts`): a seller adds a comic that isn't in the Directory; it shows a "Not in Directory" tag and never lands in the Directory or their collection.
21. **Auction rules** (`e2e/21-auction-rules.spec.ts`): a live auction can't be taken down or relisted; notes and photos only; an admin can remove it; members can't.

The "Trophy unlocked!" screen appears on the next page load after a test account earns a trophy; `e2e/fixtures.ts` closes it automatically except in the trophies test.

## When a test fails

- `npx playwright show-report e2e-report` opens a report with the screenshot, the steps and a trace of what the browser did.
- **A screenshot test failed after an intended design change:** run `npm run test:e2e:approve-screenshots`, look at the new images in `e2e/__screenshots__`, and commit them.

## Rule for every bug fix

Add a test that would have caught it, in `checks/` (logic) or `e2e/` (anything you can see or click), so it can't come back.
