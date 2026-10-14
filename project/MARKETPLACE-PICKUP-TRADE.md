# Marketplace pickup and private trade proposals

This revision preserves real owned-copy listings, collection manifests, fixed asking prices and nonbinding auction history. It removes fictional design listings and displays Raw/CGC fair market values as Coming soon. Asking prices and preview bids remain seller/member proposals, not market valuations.

## Listing delivery and identity

Migration `0010_listing_pickup.sql` adds three listing columns through three complete physical schema-only statements, separated by the existing inline Drizzle breakpoint marker, with no trailing empty separator. Migration 0009 belongs to the shared catalog; prior migrations are unchanged by this work.

| Field | Contract |
| --- | --- |
| fulfillment | shipping, pickup or both; default shipping |
| pickupCity | Trimmed city name up to 80 characters; empty for shipping; no digits or street-address characters |
| pickupState | One of the 50 US postal state codes or DC; empty for shipping |
| shipping | Zero for pickup-only; existing domestic shipping amount for shipping/both |

Pickup and both require a city/state. Listing DTOs expose only these deliberately public location fields; they do not copy the seller's profile location or a private shipping/home address. Seller cards show display name/handle, actual account creation month where available, and No completed-sale reviews yet. No transaction-rating score or verified seller claim is invented.

Owned imported comics retain their validated externalCatalog provider ID, exact source URL and CC BY-SA 4.0 metadata provenance in listing snapshots. Single-copy issueId uses the central Metron directory ID. The pure listingDirectoryId helper in lib/shared-catalog.ts maps explicit provider or starter IDs without importing server code. Directory filters use that identity and linked starter metadata; an unrelated manual entry sharing a title does not become the same edition. Publishing an external link requires a known current indexed record with matching title/issue and provider ID; an atomic guard rejects a catalog change during publication. Unknown or mismatched legacy external links remain readable privately but must be corrected or unlinked before public listing. Private purchase costs stay outside snapshots.

## Shared Add Comic flow

Marketplace accepts optional onAddComic:()=>void and addComicOpen:boolean. It closes the editor and retains controlled draft fields, photos, selected copies and conditions before launching the existing directory/manual Add Comic form. It resumes only after that modal has opened and closed with a new owned copy present. Cancellation leaves a Resume my listing control. Account identity changes clear the draft. Hub must close the marketplace-origin Add Comic flow without reopening the collection drawer; a failed optimistic vault save must not close the shared modal as a successful save.

## Private trade conversation

POST /api/social action trade_offer accepts a listingId, one to ten unique owned bookIds, a note up to 300 characters and a UUID requestId. It returns saved, proposalId, threadId, duplicate and a plain explanation. Only an active fixed-price listing belonging to another available collector can receive it. Both profiles must be visible, accept messages and remain eligible; current buyer consent, bilateral blocks, deletion/restriction state, current vault revision and reserved offered copies are checked inside the atomic committing batch.

The batch creates or reuses the existing participant-only conversation, saves durable pending terms and inserts one message keyed by requestId. Selected titles/issues/conditions are included; private costs and unselected books are excluded. Concurrent/repeated identical intents cannot add another proposal or message. Changed or foreign reuse of the UUID fails. A failed message write rolls back the new proposal and conversation too.

The seller can explicitly accept or decline through the private TradeTerms card; the proposer can cancel pending terms. Accepted terms record agreement only. They create no completed trade, protection, inventory ownership change, reservation, charge or paid order. Counteroffers remain ordinary correspondence. Participant export includes saved terms; account deletion removes them. See [TRADE-TERMS.md](TRADE-TERMS.md) for the decision API, race guards and privacy contract.

## Purchase boundaries

Pickup-only opens Messages for arranging a public handoff. Both permits the existing shipped checkout summary or a pickup inquiry. The payment adapter separately rejects pickup/unknown modes before processor or order creation, including retries and atomic reservation races; both checkouts use the existing validated shipping-address route. There is no fake pickup delivery proof or payout path. Live payments remain disabled without reviewed provider configuration. Auctions remain explicitly nonbinding previews.

Marketplace filters apply to the current bounded listing feed. This revision does not claim complete global inventory, real seller reviews or a live FMV guide.

## Verification

The focused checks/marketplace-pickup-trade.mjs suite passed 11 named groups against actual social/media/vault routes, Drizzle and isolated D1-style SQLite/R2 fixtures, plus the actual client filter and rendered FMV component. It covers migration format/defaults, address rejection, public metadata privacy, exact imported edition provenance, Coming soon valuation display, participant-only correspondence, duplicate/foreign intents, reserved/unowned books, current permissions at commit and rollback. Its maximum prepared-statement binding count was 66, below D1's 100 limit.

Existing marketplace route tests passed 49/49, and readiness negatives passed 34/34. The final scoped trade-terms suite passed 12/12 and independent sketch/API/client QA passed 41/41. Whole-project TypeScript and scoped git diff --check passed after integration. The final aggregate remains a release-runner responsibility. These checks do not establish rendered hosted OAuth/browser interaction, physical device behavior, real provider transactions or verified pickup/trade execution. The owner-controlled source publication and independent release runner remain root responsibilities.
