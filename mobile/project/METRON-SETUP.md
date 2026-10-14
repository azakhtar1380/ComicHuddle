# ComicHuddle’s Metron connection

Reviewed October 9, 2026. This is a metadata lookup integration, not an FMV feed or a modern-cover license. The starter directory remains usable without a connection.

## Connect your own account

1. Visit [Metron](https://metron.cloud/) and create or sign in to your own account.
2. In your profile, open **API Tokens** and generate a token labeled ComicHuddle. Copy it when generated; Metron shows it once.
3. Sign in to ComicHuddle and create your collector profile. Accept the current community rules.
4. Open Directory’s **Metron connection**, paste the token into the password field and confirm it belongs to your account. Paste only the token, without `Bearer`.
5. Search a series title, optionally followed by `#number`, such as `Amazing Spider-Man #300`. Series words are case insensitive; the issue-number filter is exact. This connection does not search creators or characters.
6. Open one issue’s details to see returned publisher/creator metadata and its source link. **Add a personal copy** preserves the exact issue number and explicit Metron source/license. Its condition is unrecorded, personal estimate is $0 and local `catalogId` is omitted; no FMV match is inferred.

Every app user needs their own Metron account/token. No business token is embedded or shared between users. Disconnect, sign-out or leaving the directory clears the token from this view. ComicHuddle does not persist it in browser storage, database records, exports or application logs. Revoke it in Metron to stop its use by any integration; local disconnect does not revoke a provider token. Do not paste tokens into project/chat messages.

## Data and attribution

Metron’s October 4 commercial-use guidance permits commercial metadata use under **CC BY-SA 4.0**, requiring attribution and ShareAlike for distributed adaptations. Source/license credits appear in the connection and are retained with selected external entries. Field formatting is disclosed. Those terms apply to Metron-derived metadata, not ComicHuddle’s code or original user records.

Metron explicitly excludes comic artwork from this license. The adapter omits image URLs, cover hashes, synopsis HTML, cover prices and valuations. Cover price must never become FMV. Comprehensive coverage and exact variant identification still depend on provider data and an independently reviewed identity mapping.

## Technical contract

- Same-origin, signed-in `POST /api/metron`; current collector rules, moderation/restriction and deletion gates precede provider access.
- Token comes from that request only. Upstream calls use `Authorization: Bearer` and fixed `https://metron.cloud/api/issue/` list/detail endpoints. Cookies, redirects, arbitrary endpoints and background retries are excluded.
- One provider read per explicit search, page or detail action. Metron’s documented standard budget is 20/minute and 5,000/day per account. The app’s persistent budget is 8/minute and the shared 1,200/day account budget. Returned numeric rate headers and bounded `Retry-After` inform the view’s pause.
- Input body 8 KiB; query 160 characters; token 20–256 safe Bearer characters; upstream response 512 KiB; 100 rows/page; 10-second timeout. Pagination must retain the original query on the same API origin/path, with only `series_name`, `number` and bounded `page` parameters.
- No cross-user cache or Metron-side writes. Displayed results remain only in the current view. External IDs are separate from starter IDs.

## Validation and remaining live check

`node --experimental-vm-modules checks/metron-directory.mjs` passed **46 named groups**, exercising the actual route, Drizzle/isolated SQLite, real token/controller code and synthetic schema-compatible fixtures. Cases include caller authorization, origin/body/rate bounds, token secrecy, fixed-origin pagination, provider errors/timeouts, data sanitization, source-preserving personal entries and disconnect/signout/unmount/replacement races. Actual React server-rendered markup also verifies that credential fields are absent for guests and source/license credits are present; this is not a browser test. Authentication is mocked at the trusted identity boundary, not exercised through live ChatGPT sign-in.

No Metron token or account was available. The public lookup tool could read the official blog and GitHub API README; `/api/schema/` and an unauthenticated issue lookup were inaccessible to that tool. No provider HTTP status or successful authenticated lookup was observed. Fixture passes do not establish live provider access, real database coverage, browser/device behavior or commercial launch clearance. The UI says **Not connected / Token in this view** until a successful request actually returns metadata.

## Primary references

- [Commercial use, attribution, accounts and image exclusions — October 4, 2026](https://metron-project.github.io/blog/commercial-api-use)
- [Token authentication — July 26, 2026](https://metron-project.github.io/blog/token-authentication)
- [Current API README on the repository’s master branch](https://github.com/Metron-Project/metron/blob/master/api/README.md)
- [API request and rate-limit practices](https://metron-project.github.io/blog/api-best-practices)
- [CC BY-SA 4.0 license](https://creativecommons.org/licenses/by-sa/4.0/)

The token blog’s `main`-branch README link returned 404; the repository’s actual branch is `master`. The older April best-practices page still describes Basic Auth; the later July token documentation governs this new Bearer integration.
