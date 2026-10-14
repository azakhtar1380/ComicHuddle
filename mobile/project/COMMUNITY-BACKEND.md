# Community backend revision

The Community hub uses real stored groups, membership, posts, replies and hearts. The four existing starter groups remain empty unless real authenticated members contribute. There are no seeded conversations, fabricated members, popularity scores or implied sales.

## Data and compatibility

Migration 8, `0008_community_hub.sql`, contains ten complete physical schema-only statements, each with the existing inline Drizzle statement-breakpoint marker. It adds optional post titles, one attached photo and discussion/question/showcase/find kinds, plus reply and reaction tables. Legacy posts acquire the discussion default without a data rewrite. The primary key `(post_id, profile_id)` enforces one heart per collector per post. Previous migrations 0–7 are unchanged. Existing general/showcase/trading channel IDs, legacy chronological posts reads and all commerce, auction, pressing and ChatGPT identity flows are preserved.

`lib/community.ts` exports CommunityGroup, CommunityPost, CommunityReply, CommunityData and CommunityThread for the web and native clients.

## Reading the hub

`GET /api/social?kind=community&view=feed|group|discover` accepts `group`, `channel`, `sort=recent|active`, a literal text search `q` up to 80 characters and a scoped opaque `cursor`.

- Feed reads the joined groups together. Group view reads one joined group. Each post page is at most 20 records, using timestamp/ID keyset pagination; equal timestamps cannot create duplicate or missing rows in a stable dataset.
- Discover searches public group metadata and returns at most 30 groups per page. It does not disclose post bodies, attachment IDs or replies. Anonymous/no-profile callers can discover group metadata; their personal feed is empty with an appropriate sign-in/profile flag.
- A nonmember can see group metadata and the invitation to join. The response contains no private post body. Direct thread reads by a nonmember return not found.
- Recent sorting uses post creation time. Active sorting uses the newest eligible visible-to-viewer reply or original post time. Group lastActiveAt uses the same genuine reply/post evidence. Search treats percent/underscore as literal text and parameterizes every user value.
- Counts use actual persisted eligible actors. Two-way blocked, moderated, deleting and account-restricted people are excluded. There is no guessed engagement or cross-user collection-cost data.
- Hidden-showcase collectors can participate inside joined groups. The visible flag controls public showcase discovery; it does not remove their existing private group membership. Their group members see their display name, handle and contributions.

`GET /api/social?kind=post&post=<id>` returns one member-only CommunityPost and up to 30 replies, oldest first, with a scoped cursor for further replies. Counts, author summaries and deletion controls follow the same membership/block/moderation rules.

All responses remain private/no-store. No user email, authentication token, private vault price or address enters a Community DTO. Feed/discovery reads remain bounded and avoid per-card database queries.

## Writing and moderating

All mutations retain the existing authenticated ChatGPT account, exact Origin check, streamed byte limit, persistent rate budget and current rules consent. Each community write checks current profile, membership, group availability, blocks and parent existence inside an atomic D1 batch using the existing operation_guard CHECK. There is no transaction-callback assumption.

| Action | Fields and result |
|---|---|
| post | Existing groupId/channel/body; optional kind, title up to 120 characters and one owned photoId. Returns saved and postId. |
| post_reply | postId and body up to 1,500 characters. Returns saved and replyId. |
| post_react | postId and explicit like boolean. Idempotent desired state; duplicate true commands commit one heart. |
| delete_post | Author or group owner can remove a post and all descendant replies, reactions and reports atomically. |
| delete_post_reply | Reply author or group owner can remove a reply and its reports. |
| join / create_group | Existing contracts; membership/group creation now use current eligibility guards and atomic group+owner-membership creation. |
| report | Adds post_reply to the existing supported targets. Current membership and content group/block/author rules are checked; existing reporting safety exceptions are preserved. |
| review_report | Existing operator action can inspect/remove a reported reply or whole conversation, cleaning descendants. |

Group owners must retain their membership. The five-owned-group limit is checked in the committing batch, preventing concurrent creates from bypassing it.

## Photos and account data

Posting a photo requires a UUID owned by the post author's uploaded-media account, both before and inside the committing batch. The existing `/api/media?id=...` route grants a community attachment only to a current eligible member of its group, respecting two-way blocks, author restrictions and group-owner moderation. A hidden showcase attachment remains private. Leaving a group or deleting its source post revokes the member grant immediately. An asset owner retains access to their own uploaded photo; separate legitimate listing/showcase/paid-order/custody grants remain intact.

Account export adds only the caller's authored postReplies and postReactions. It does not export another member's replies merely because the caller authored the parent post. Existing owned posts retain their title/kind/photo IDs. Account deletion removes the caller's replies and reactions and all other members' descendants of the caller's deleted posts, without deleting unrelated conversations. Dependency cleanup uses in-transaction subqueries, so raced replies cannot survive as orphans.

Community text and photos are member-authored content. This revision does not import or automatically publish Metron, Key Collector, GoCollect or eBay metadata into posts; any deliberate user-authored book discussion is handled as their contribution. The separate licensed-directory attribution/data workflows remain the responsibility of their own provider integration.

## Verification

`node --experimental-vm-modules checks/community-api.mjs` passed 31 named groups. The suite executes real social/media route code and Drizzle queries against isolated D1-style atomic SQLite/R2 fixtures. It checks joined multi-group feeds, hidden-profile participation, nonmember privacy, channel/literal search, cursor boundaries, active reply clocks, real counters, repeated/concurrent hearts, blocks/restrictions, owned photos, current rules and Origin checks, membership/parent/profile/photo races, owner moderation, export privacy, deletion cleanup, transaction rollback and dense query/100-bind budgets. The final measured dense joined feed used six queries, discovery used five queries, and the maximum prepared-statement bind count across the suite was 24.

The existing negative route suite passed 34/34 after the change. Project TypeScript also passed after the web client's in-progress types were aligned. Independent QA also passed the focused suite 31/31; the full release runner follows the client source freeze. These are isolated actual-handler tests, not rendered browser, hosted OAuth or physical-device testing. No production group, post, reaction, message, charge or user record was created by QA.
