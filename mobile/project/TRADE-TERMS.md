# Private trade terms

The seller can now explicitly accept or decline a saved proposal; its proposer can cancel while pending. Acceptance records agreement to the saved copy lists only. It never records a completed/protected trade, charges money, transfers ownership, reserves inventory or verifies delivery. No fee is taken.

## Durable record and states

Migration `0011_trade_terms.sql` adds one trade_proposals table and four indexes through five complete physical schema-only statements. Drizzle separators appear between statements; there is no trailing empty step. Prior applied migrations remain unchanged.

Each row binds the request UUID, private conversation, listing, buyer/seller profile IDs, normalized original request, immutable buyer/seller copy snapshots, target listing snapshot and timestamps. Pending is version 0. One authorized accepted/declined/cancelled decision advances the version exactly once and records its time/actor. Terminal decisions cannot be overwritten. Listing withdrawal/moderation cancels pending proposals. UUID retries use the durable proposal, so deleting its chat message cannot cause it to be reposted.

## API

GET /api/social?kind=trade_terms&thread=<id> returns proposals, hasMore and nextCursor. Only that conversation's participants can read it; no owner/operator read bypass is added. Up to ten records appear per page, newest first. The optional cursor is the last proposal ID from that same private conversation.

Each proposal includes id/threadId/listingId/listingTitle, participant display names/handles, offeredItems/requestedItems, status/version/role, timestamps, canAccept/canDecline/canCancel, unavailableReason and explicit agreementOnly:true/completed:false/protected:false. Private costs, authentication user IDs, original request/note internals and photo IDs are excluded. No new media ACL grant exists.

POST action trade_terms_decision accepts proposalId, decision accept|decline|cancel and expectedVersion. Acceptance also requires agreementOnlyConsent:true. Only the seller can accept/decline; only the original proposer can cancel pending terms. The response includes saved, proposalId, threadId, status and a plain boundary statement. A wrong role returns 403, an absent/foreign proposal 404, invalid input/acceptance consent 400, and stale/terminal/unavailable terms 409. Ordinary Origin, authentication, rate and current-consent checks apply. Safe refusals remain available if blocked, restricted or rules changed; accepting does not.

The existing trade_offer creates both the durable pending row and ordinary private message in one guarded atomic batch. Its request UUID cannot be reused for a different exact selection/note. Concurrent retries produce one row and one message.

## Acceptance and privacy

Acceptance checks current eligible profiles/rules, both block directions, the active exact fixed-price listing, both current owned-copy lists, removed/changed copies and offered copies reserved in another listing/order. Private purchase-cost changes are excluded from the terms. A current pre-read plus version/data/metadata guards rejects concurrent changes inside the committing D1 batch. Full immutable proposal fields remain bound during the update.

Acceptance creates no exclusive inventory hold. Further physical handoff/payment/protection needs a separate verified execution system; those capabilities are not connected here.

Participant account export includes only that participant's saved terms with safe copy metadata. Account deletion removes associated proposal rows/snapshots atomically with the existing conversation/profile cleanup. These are not paid orders or legal-custody records, so they do not add a financial-history deletion block. Existing commerce history and care-custody rules stay intact.

## Client and verification

The dedicated app/trade-terms.tsx component accepts threadId, act and notify. It shows genuine saved states, reviewable copy lists, a seller acceptance checkbox/Accept terms/Decline and proposer Cancel controls. It refreshes server state after decisions, polls only while the page is visible, checks current thread/request/mount state and aborts stale reads. The bounded scroll region preserves room for chat. Root mounts it above the conversation messages.

The focused checks/trade-terms.mjs suite passes 12 named actual-route groups: migration shape, participant privacy, safe snapshots, role/consent/version decisions, concurrent acceptance/cancellation, cost-only vs identity/grade edits, reservations, withdrawal, block/restriction/rules changes, late commit changes, durable retries after message removal, export and deletion. Checks/marketplace-pickup-trade.mjs retains 11 passing groups; migration 10's test now targets index 10 and matches the actual final-line separator convention. Maximum prepared binding count remains 66, below D1's 100 limit. TypeScript and scoped whitespace checks pass. Independent QA reports 41 passing sketch/API/client groups, including consent payload and stale/unmounted completion handling.

These are isolated fixtures and client checks. No real customer agreement, money movement, delivery proof or hosted OAuth session was created or verified by these tests. Root owns the final aggregate runner, schema inspection and publication.
