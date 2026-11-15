# ComicHuddle redesign brief (owner, 2026-11-15)

Goal: professional, easy, consistent on every page, **keeping the theme**: cream paper, ink black, comic red and yellow,
bold condensed headlines (Barlow Condensed), DM Sans text, hard offset shadows, halftone dots. Polish, don't replace.

## Ground rules
- Tokens (now set in `app/design-system.css`, loaded last): `--paper #f5f1e7`, `--cream #f9f6ef`, `--ink #20201f`,
  `--red #c83e30`, `--yellow #efd369`, `--blue #345a6a`, `--muted`, `--line`. No new palette or font.
- **No fake content.** No invented listings, reviews, studios, stats, prices or testimonials. Real data or a friendly empty state.
- **Don't break working features.** Collections, directory, listings, messages, workshop requests, wallet, auth keep working.
  Change layout and wording, not business rules.
- Accessibility: real buttons/links, labels on inputs, visible focus, 4.5:1 contrast, keyboard + phone.
- The **Characters page** (`app/characters/…`) is the quality bar. Don't redesign it.
- Removed from the user-facing site: Upcoming / Coming soon, FMV promo, GrailMatch, **Community** (keep `community-hub.tsx`,
  its API routes and tables in the repo, unused; delete no data).

## SafePurchase
Show it as a real feature **only when live**. It is behind the existing switch `SAFEPURCHASE_ENABLED` (+ an inspection address),
exposed server-side by `protectionConfig()` in `lib/commerce-protection.ts` and client-side as
`protection.safePurchaseEnabled` from the payment-configuration API. It is currently **off** on the preview (Stripe test mode,
no inspection service). When on: badge "SafePurchase", option "Add SafePurchase", 3 steps "1. You buy → 2. We check the book →
3. It ships to you", "You have 48 hours after delivery to report a problem." When off: one short honest line, no "coming soon".

## Shared pieces (already built; use them, don't make one-offs)
- `components/page-header.tsx` → `<PageHeader eyebrow title accent lede actions pose caption line/>`
  (eyebrow, BIG HEADLINE, red second line, one plain sentence, buttons, Huddles panel on the right).
- `components/huddles-guide.tsx` → `<HuddlesGuide pose caption line size="xl|lg|md|sm"/>` and `<HuddlesArt pose size/>`.
- `components/states.tsx` → `<EmptyState title message action secondary/>`, `<LoadingState message/>`,
  `<ErrorState message action/>`, `<HowItWorks title>…</HowItWorks>` (collapsible long explanations).
- CSS classes in `app/design-system.css`: `ds-btn ds-btn-primary` (red, one per view), `ds-btn ds-btn-secondary` (ink outline),
  `ds-btn-dark`, `ds-btn-yellow`, `ds-btn-sm`, `ds-link` (underlined text link), `ds-card` (+ `featured`/`interactive`),
  `ds-grid ds-grid-2|3|4`, `ds-section`, `ds-section-head`, `ds-eyebrow`, `ds-field` (label above field, `small` helper below),
  `ds-input`, `ds-error`, `ds-steps` (numbered steps; `li.current`/`li.done`), `ds-wrap`.
  Legacy `.button`, `.button.red`, `.button.outline`, `.button.dark` are already restyled to match.

## Type and spacing
- Body 15–16px, secondary 14px, labels/eyebrows 12px uppercase letter-spaced. **Nothing under 12px.**
- Headlines (Barlow Condensed): page title 48–64px desktop / 36–40px mobile; section 32–36px; card title 22–24px.
- 8px scale (8, 16, 24, 32, 48, 64). Sections 64px vertical desktop, 40px mobile.
- Buttons 44–48px tall, radius 2px, hover = 1px lift + offset shadow.
- Cards: cream, 1px line border, 2px ink border + 4px offset shadow on hover/featured, 24px padding.
- Forms: label above, 14px helper below, red errors with an icon, one column on mobile, long forms in numbered steps.
- Mobile: single column, no sideways scrolling, images never wider than the screen, sticky search on Directory/Marketplace,
  filters in a bottom sheet, primary action pinned to the bottom of long forms. Test 360/390/430px.

## Huddles poses (`pose` values) and where they go
home (Home hero, "ISSUE #1 · WELCOME" / "Every book has a story. Let's find yours!"), directory ("THE DIRECTORY" /
"Try a character, creator or issue #."), scanner ("THE SCANNER" / "Line up the barcode. Hold steady!"), add-comic
("YOUR LONGBOX" / "Every detail counts."), marketplace ("THE MARKETPLACE" / "One grail or the whole longbox."), empty
("MEANWHILE…" / "Every collection starts with one book."), sign-out ("TO BE CONTINUED…"), sign-in ("COME ON IN" /
"Join free. It takes a minute."), safepurchase ("SAFEPURCHASE" / "We check it before it ships."), wallet ("YOUR WALLET" /
"Every $1 = 1 point."), workshop ("THE WORKSHOP" / "Find a pro near you."), messages ("YOUR MESSAGES" / "Say hi to a
collector."), profile ("YOUR SHELF" / "Pick six favorites to show off."), trade ("TRADE TIME" / "Pick what you'll offer."),
auction ("GOING ONCE…" / "Place your bid."), grading ("GRADING 101" / "Check the corners first."), error ("KA-BLAM!" /
"Even heroes miss a panel."), loading ("ON THE WAY…"), listing ("SELL IT" / "Good photos sell comics."), notifications
(toasts). **Never** put Huddles over prices, grades or payment fields; during checkout only a small shield badge.

## Page table
| Page | File(s) | Make it simpler by… | Huddles |
|---|---|---|---|
| Directory | `app/shared-directory.tsx` | Big search first, filters in one row (a "Filters" button on mobile), clear result cards, "Add to my collection" on every result | directory |
| Scanner | `app/scan-comic.tsx` | Three big choices: Scan barcode / Snap cover / Upload photo; then "Is this your comic?" with Yes / Pick another | scanner |
| Add comic | `app/add-comic.tsx` | Steps: 1 Pick issue → 2 Condition & grade → 3 Optional private notes. Save always visible | add-comic, grading on the condition step |
| Marketplace | `app/marketplace.tsx` | Browse grid first; filters single/collection, price, local pickup, SafePurchase; one "Sell a comic" button | marketplace |
| Listing detail | `app/marketplace.tsx` | Photos, price, condition, seller, SafePurchase badge, one main button (Buy / Make offer / Bid) | — |
| Sell a comic | `app/listing-builder.tsx` | Steps: 1 Pick comics → 2 Photos → 3 Price & delivery → 4 Review. Progress bar at top | listing |
| Trade | `app/marketplace.tsx`, `app/trade-terms.tsx` | Two columns "You give" / "You get", then Send proposal | trade |
| Auction | `app/marketplace.tsx` | Current bid, time left, bid box, one button | auction |
| Orders / checkout | `app/marketplace-checkout.tsx`, `app/commerce-desk.tsx` | Clean receipt-style summary, clear totals, no mascot during payment | small safepurchase badge only |
| SafePurchase | `app/safepurchase/page.tsx`, `app/feature-info.tsx` | 3 steps, 48-hour window, FAQs in collapsible sections | safepurchase |
| Wallet | `app/wallet/page.tsx`, `app/collector-wallet.tsx` | Big balance cards (Points, Store credit, Sales proceeds), then history | wallet |
| Workshop | `app/pressing.tsx` | Search by city, studio cards (photo, services, rating, starting price), Request a quote. "List your studio" secondary | workshop |
| Profile / showcase | `app/network.tsx` (Collectors) | Header with name + six featured books, then trade pile and wants. "Edit showcase" button | profile |
| Messages | `app/network.tsx` (Messages) | Two-pane inbox (list + conversation); one pane on mobile | messages when empty |
| Sign in / join | `app/sign-in/page.tsx`, join dialog in `app/network.tsx` | Short form, one column, rules checkbox with link | sign-in |
| Sign out | `app/sign-out/page.tsx` | "See you next issue." + one button | sign-out |
| Grading guide | `app/cgc-guide.tsx` | — | grading |

## Voice
Friendly collector at a comic shop, not a lawyer. One idea per sentence, most under 15 words, paragraphs max 3 short
sentences. "You", "we", contractions. Cut jargon ("nonbinding preview records", "indexed identifiers", "owner stated",
"bibliography", "manifest", "absent", "establish", "qualify", "inventory"). Errors = what happened + what to do, under 12
words ("Couldn't load your wallet. Try again."). Keep required meaning (18+, US only, privacy, grading isn't guaranteed):
short line on the page, detail inside `<HowItWorks>` or the rules. Never remove a required checkbox; shorten its label and
link the rules (`/?section=Rules`). Status words must match reality: live payments are **off** on the preview (Stripe test
mode), so keep **one** short honest line where it matters, not many.

## Rewrites (before → after)
**Marketplace (`app/marketplace.tsx`)**
- "Free collector accounts. Sell one comic or a collection, message about a trade, or arrange pickup. Auctions are nonbinding previews; real payments are not enabled." → "Sell one comic or a whole collection, trade, or meet up locally."
- "A sale record closes inventory immediately. It does not confirm payment or add wallet funds." → "Marking it sold takes it off the market."
- "Accepting an offer does not take payment or create a completed sale." → "Accepting an offer doesn't charge anyone yet. You'll finish the sale next."
- "Prices are set by sellers. Shipping and any applicable tax are shown separately before payment. …" → "Sellers set the price. You'll see shipping and tax before you pay."
- "Request SafePurchase inspection" → "Add SafePurchase"
- "Retract my bid before this preview closes. If it is the current leader, …" → "You can take back your bid before the auction ends. If yours was the top bid, the price goes back to the starting bid."
- "Add your owned comics first so you can choose real copies for your proposal." → "Add comics to your collection first, then pick which ones to offer."
- "I own these copies and understand this starts a private negotiation. …" → "I own these comics and want to start a trade chat."
- "Confirm editions, grades and included copies with the seller. No seller rating or trade completion is implied. …" → "Check the edition, grade and what's included before you agree."
- "Join free to browse collector listings, save finds and contact sellers." → "Join free to browse, save finds and message sellers."
- Auction preview lines: bids are not binding on the preview → "Bids are previews. Nobody gets charged."

**Directory (`app/shared-directory.tsx`)**
- "Search series, issue numbers, characters, publishers and creators. One directory for every collector." → "Search by title, issue, character or creator."
- "Confirm edition and printing before collecting." → "Make sure the edition and printing match your copy."
- "No bibliography has been loaded yet. Catalog coverage will appear here after an owner import." → "The directory is still filling up. Check back soon."
- "Try another series, creator or filter. You can still enter an unindexed comic manually in My collection." → "No luck. Try another search, or add the comic by hand."
- "The directory returned an unreadable / incomplete response. Please retry." → "Couldn't load the directory. Try again."

**Scanner (`app/scan-comic.tsx`)**
- "Scan a printed barcode, capture a cover, or upload a photo. Confirm the exact issue before adding it. …" → "Scan the barcode, snap the cover or upload a photo. Or just search by title."
- "Confirm your printing and variant. Matching does not authenticate, grade or detect a counterfeit." → "Check the printing and variant match. A match doesn't grade the book."
- "A base barcode can match multiple editions. …" → "One barcode can match a few editions. Pick yours."
- "Scan photos stay on your device. Only barcode digits, search text and numerical cover fingerprints go to ComicHuddle. …" → "Your photo stays on your device. We only send what's needed to find a match."
- "No match in the indexed identifiers. This does not mean the comic is absent from the directory. …" → "No barcode match. Try searching the title and issue."
- "No catalog results for the text read from this photo. …" → "We couldn't find a match. Try searching by title."
- "The cover text was not clear enough. …" → "Too blurry to read. Try a straight photo with no glare."
- "Comparing cover features with the database…" → "Matching your cover…"
- "Camera access needs HTTPS. …" → "The camera needs the secure ComicHuddle link. Or upload a photo."

**Add comic (`app/add-comic.tsx`)**
- "Choose the exact issue, year and edition. Your purchase price stays private." → "Pick the exact issue. What you paid stays private."
- "Certification details are owner stated. Purchase details and notes stay private." → "Prices and notes are only visible to you."
- "The condition and purchase price above apply to each selected copy. …" → "This condition and price apply to every comic you picked. You can change each one later."
- "The linked source record is not in the shared directory yet. …" → "This issue isn't in the directory yet. You can still keep it."
- "Withdraw or cancel the active listing before changing this copy's recorded details." → "This comic is listed for sale. Take down the listing to edit it."
- "Choose at least one comic from the dropdown, or add an unlisted comic." → "Pick at least one comic, or add one by hand."
- "The save was not confirmed. …" → "We're not sure that saved. Your picks are still here. Try again."

**Workshop (`app/pressing.tsx`)**
- "Find local pressing, dry cleaning and pre-grading specialists. Compare their work, read collector reviews and book your care plan." → "Find pros near you who press, clean and prep comics for grading."
- "Three or more member reviews qualify a studio. Area rank follows average rating, …" → "Studios are ranked by member reviews. Nobody can pay to rank higher."
- "Receipt-confirmed reviews come from completed ComicHuddle care records; …" → "\"Confirmed\" means the collector got their comic back."
- "Independent specialists. … Pressing cannot guarantee a grade; …" → "Independent pros. You pay them directly. Pressing can't guarantee a grade."
- "Register as an independent comic pressing & cleaning specialist. …" → "Do you press or clean comics? List your studio."
- "Use City, two-letter state, for example Minneapolis, MN. …" → "City and state only, like Minneapolis, MN."
- "No portfolio pairs uploaded yet. …" → "No before-and-after photos yet. Ask for examples first."

**Profile, join, messages (`app/network.tsx`)**
- "Choose your handle. Feature six grails. Download a story card worthy of your shelf. …" → "Pick a name. Show off six favorite books. It's free."
- "Your full collection stays private. Choose the books you share …" → "Your collection is private. You choose what to show."
- "Create your free collector account to save comics, build a showcase, list single books or collections, …" → "Join free to save comics, sell, trade and chat with collectors."
- "Secure account sign-in. Passwords are stored as protected hashes, …" → "Your password is stored securely. Nobody can read it."
- "I am 18 or older, based in the United States, and agree to the current collector rules, …" → "I'm 18+, live in the US, and agree to the [collector rules]."
- "Private between participants · refreshes every 12 seconds · report content for review" → "Only you two can see this. Report anything that's not okay."
- "Collection statistics are self-reported. No value or authenticity claim." → "Stats come from what this collector entered."
- "Marketplace listings and Comic Workshop connect you with fellow collectors. Community is coming soon." → "Sell, trade and get your comics pressed, all with one account."

**Wallet and SafePurchase (`app/feature-info.tsx`)**
- "Eligible confirmed ComicHuddle purchases earn 1 Collector Reward Point per whole dollar …" → "Earn 1 point for every $1 you spend on comics. Shipping and tax don't count."
- "Redeem in blocks of 100 points. Each block creates $1 of Available Store Credit …" → "Every 100 points = $1 in store credit."
- "Credit is for ComicHuddle purchases and supported workshop bookings. It is not money …" → "Store credit works on ComicHuddle only. It can't be cashed out or transferred."
- "Choose how much credit to use before payment. …" → "Use your credit at checkout. It covers the comic, not shipping or tax."
- "A careful path for a valuable book." (keep headline) → subline "We check your comic before it ships to you."
- "The buyer has a 48-hour inspection window after verified delivery …" → "After delivery, you have 48 hours to report a problem. Take photos and keep the packaging."
- "The inspection checks the agreed issue, printing, certification and reported condition. …" → "We check it's the right book, in the condition described. It isn't official grading."
- "SafePurchase service terms must be accepted before sending a book. This preview has no connected inspection operator …" → remove; replace with the 3 steps.

**Install the app (`app/app-install.tsx`)**
- "Add the mobile website to your home screen. …" → "Put ComicHuddle on your home screen."
- iPhone: "In Safari, tap Share → Add to Home Screen." Android: "In Chrome, open the menu → Install app."
- Remove "The native prototype is separate from this installable web app. …".

Apply the same voice to every other user-facing string you touch.
