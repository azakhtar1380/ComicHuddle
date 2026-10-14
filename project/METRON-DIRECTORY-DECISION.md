# Metron and Comic Vine: directory decision

> Current product correction: customer-supplied tokens have been removed from Directory. ComicHuddle is pursuing one operator-managed catalog. The previous personal connector below is historical engineering work; no full provider catalog is connected. See SHARED-DIRECTORY-CORRECTION.md.

Reviewed 2026-10-09. Operator: Malik LLC, Minnesota, USA; proposed launch USA only. Operator details are owner-supplied, not registry verification. This is a source and implementation decision, not legal clearance. No provider was contacted, account created, token obtained, data downloaded, or fee paid during this review.

## Decision

Pursue Metron for the comic metadata layer. Resolve the **delivery and account arrangement** for ComicHuddle's shared public directory before connecting a central production sync. Keep cover rights, key-issue editorial content, and current Raw/CGC valuation as separate workstreams. Exclude Comic Vine production API imports unless its operator grants a separate commercial agreement.

Distinguish metadata reuse rights from API account access. A lawfully delivered CC-licensed dataset can support public search [L1]; the data license does not inherently require each reader to register with Metron. The provider's account policy below governs its API service. A server proxy does not resolve that access question.

## Verified provider rules

| Source | Verified fact | ComicHuddle consequence |
|---|---|---|
| Metron commercial guidance [M1] | Commercial metadata use is allowed under CC BY-SA 4.0. Multi-user apps need each user's own account/token; one business account is described for its own stock/store. | Confirm shared-directory access. Treat the own-stock example as distinct from our marketplace catalog. |
| Metron cover statement [M1] | Covers are excluded. Metron's fair-use rationale does not automatically extend to another app. | Use approved assets or placeholders; an image URL is not permission. |
| Comic Vine API [C1] | Public API terms permit noncommercial use, prohibit redistribution, and restrict competing editable structured resources. The page invites prototype partnership discussions. | A free introductory tier of a commercial business does not establish permission. A partnership invitation is not a commercial grant. |
| Metron repository [M5] | Website source code is GPL-3.0. | Source-code licensing is separate from metadata and cover rights. Cloning the code does not deliver the production catalog. |

No explicit public bulk catalog download or published shared-platform API exception was verified in the official commercial guidance, API README, project documentation, or export-related searches. This is an unresolved availability question, not proof that none can be arranged. The repository's database migration/backup recipes [M6] describe an operator moving its own server data; they are not an offered public dataset.

metron.cloud returned an anti-bot access-denied page. This review stopped at that boundary and used public provider documentation and repository sources.

## Viable integration choices

| Choice | Readiness and next action |
|---|---|
| Provider-supplied metadata snapshot plus updates | Preferred for anonymous shared search. Ask whether Metron offers a catalog-only export with stable IDs, versions and deletion/merge changes. Preserve attribution and license on the public metadata layer. No delivery has been confirmed. |
| Agreed central API service | Ask whether Malik LLC may run a single catalog sync that serves all ComicHuddle visitors, and under what quotas, caching and support terms. Record the answer before enabling that access model. An increased quota alone does not answer the account question. |
| Individual Metron connector | Fits the published multi-user account model. Each consenting collector supplies their own revocable token; requests and caches remain tied to that user. Do not silently pool those credentials or their API access into a global sync. Confirm any intended shared-cache reuse separately. |
| Existing starter directory | Continue truthful coverage labels while obtaining a viable feed. Never call it the full Metron catalog or imply live provider integration before a successful authorized import. |

The CC legal code [L1] permits sharing/adaptation within the licensor's rights, requires attribution and compatible ShareAlike for public adaptations, prohibits downstream restrictions on licensed rights, and addresses substantial database reuse. Other rights and warranties are not supplied. Proposed implementation: identify the CC metadata layer separately from private collections, messages, payments and other licensed data. Review compatibility before combining protected datasets; physical separation alone does not settle adaptation questions.

Do not put a blanket proprietary/no-redistribution claim over the CC metadata layer. Credit the source and license on directory screens and exports, identify ComicHuddle's normalization changes, and avoid implying Metron endorsement. Proprietary app logic does not become GPL merely because it calls an API; copying provider code or SDKs requires reviewing their actual licenses.

## Data and adapter contract

The current official API README [M2] documents issue/series identities, dates, creator credits, variant/reprint relations, UPCs and external identifiers. Its `price` is **cover price**, `average_rating` is a community star rating, and neither is FMV or a CGC grade. The documented interface does not establish a licensed feed of Key Collector editorial notes or current graded sales values. Crosswalk IDs do not license another database's content.

Recommended importer fields:

- Stable internal edition ID plus provider name, provider issue/series IDs, source URL, source modification time, retrieval/import time and dataset version.
- Series start year/volume, issue number as a string, printing, variant and language details, keeping unknown fields unknown. UPC-prefix matches must offer candidate selection; a 12-digit scan cannot establish a unique edition by assumption.
- Metadata license and attribution; separate image source, rights basis and allowed uses. Strip or quarantine unapproved image URLs instead of auto-rendering them.
- Keep `coverPrice` and currency separate from `rawFmv`, exact grading-company/grade/label values, sale samples and valuation timestamps. Missing market data remains unavailable.

Use revocable **Bearer tokens**, generated from the user's Metron profile API Tokens screen [M3]. Store credentials encrypted server-side, never in browser storage, source, logs or exports; use authenticated token-management actions and support disconnect/revocation. The documentation does not promise granular read-only token scopes, so implement a GET-only catalog client rather than claiming a scoped token.

Published ordinary limits are 20 requests/minute and 5,000/day [M1]. Supporter tiers can increase daily capacity, but actual headers govern and limits can change [M4]. Cache responsibly, honor `Retry-After`, pace queues per account, use conditional/incremental updates, and show a safe unavailable/stale state on failures. Do not rotate accounts to evade limits. Confirm refresh/deletion behavior for any agreed full import.

## Owner inquiry: ready to send, not sent

To: **bpepple@metron.cloud** — verified official contact [M1, M3].

Subject: ComicHuddle shared commercial directory — metadata delivery and account arrangement

Hello Brian,

Malik LLC is building ComicHuddle, a US comic collector platform with a shared searchable directory, private collections, community groups, a marketplace and a Comic Workshop service directory. We plan web/PWA access and later iOS/Android apps.

We can attribute Metron and release the public adapted Metron metadata layer under CC BY-SA 4.0, with cover rights handled separately.

Could you confirm a supported way to populate and refresh a directory that all visitors can search without needing their own Metron login? Specifically:

1. Is a catalog-only metadata snapshot/export with periodic deltas available, excluding covers, accounts and other private data? If so, what delivery, license notices, refresh schedule and contribution/support arrangements apply?
2. Alternatively, may Malik LLC use one central service account to sync that shared catalog, or does this use require individual accounts for every app user? Please clarify public search, persistent caching and any shared-cache reuse explicitly.
3. What attribution/change notices should we preserve, including upstream notices and source IDs? Are there known exclusions or third-party fields requiring different treatment?
4. Can we review a small authorized sample and current schema for variants, printings, UPCs and issue merges/deletions? How should we handle removed or corrected records and unknown edition details?
5. What account quotas, batching/conditional-update facilities, support expectations and sponsorship options fit this use? If a separate arrangement is needed, please provide its written terms and any quote.

We are not asking Metron to provide FMV or to grant publisher cover rights. We would like to implement a sustainable, compliant metadata integration. Thank you.

## Acceptance before a shared-directory launch

1. A lawfully delivered dataset or documented central API arrangement, with a retained source/license/access record. If using individual access instead, no platform token pooling.
2. Attribution and CC notices visible in web/mobile directory views and metadata exports; application terms respect the licensed metadata rights.
3. A counted, versioned catalog import with edition ambiguity preserved, deletion/merge handling and failed-sync recovery tested. Publish actual coverage; do not promise every comic.
4. Each displayed cover has an independent recorded basis. FMV coverage remains separately measured; cover prices and stars never populate valuation/grade fields.
5. Token isolation, revocation, redacted logs, rate-limit handling and cross-user cache boundaries pass QA. No commercial Comic Vine calls without a separate grant.

## Primary sources

All accessed 2026-10-09. Publication dates are provider dates; repository content can change.

- **M1:** [Metron: Using Metron in Commercial Software](https://metron-project.github.io/blog/commercial-api-use), published 2026-10-04.
- **M2:** [Metron official API README, current master branch](https://github.com/Metron-Project/metron/blob/master/api/README.md). The token post's `main`-branch link returned 404; this verified repository branch contains the current token documentation.
- **M3:** [Metron: Introducing Token-Based API Authentication](https://metron-project.github.io/blog/token-authentication), published 2026-07-26.
- **M4:** [Metron: Introducing Supporter Rate Limits](https://metron-project.github.io/blog/supporter-rate-limits), published 2026-07-16; includes 2026-10-01 update.
- **M5:** [Metron official code repository and license indicator](https://github.com/Metron-Project/metron).
- **M6:** [Metron operator deployment/backup instructions](https://github.com/Metron-Project/metron/blob/master/DEPLOYMENT.md).
- **C1:** [Comic Vine official API access and rules](https://comicvine.gamespot.com/api/).
- **L1:** [Creative Commons BY-SA 4.0 actual legal code](https://creativecommons.org/licenses/by-sa/4.0/legalcode.en), particularly sections 2–4.

Related project decisions: `DATA-ACCESS-DECISION.md`, `PAYMENTS-AND-DATA-NEXT-STEPS.md` and `INDEPENDENT-FMV-METHOD.md` cover paid editorial/valuation sourcing and independent FMV. This recommendation neither replaces those rights requirements nor authorizes provider outreach.
