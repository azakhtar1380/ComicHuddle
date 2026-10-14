# ComicHuddle project charter

Established 8-9 October 2026. Product owner: the founder. Project lead: Codex. The business analyst, developer and QA roles are AI agents collaborating in this project; this does not hire employees or establish unattended monitoring.

## Goal

Build a dependable collector business across desktop web, mobile web/PWA and iOS/Android: private collections, proud collector showcases, groups/channels and joined feeds, messages, comic listings, attributed directory metadata and Comic Workshop care requests. FMV and GrailMatch are deferred under Upcoming.

Preserve the approved ComicHuddle comic theme and supplied superhero logo. Mobile has exactly six primary tabs: Home, Directory, Marketplace, My Profile, Comic Workshop and Upcoming. FMV, Community and GrailMatch are Coming Soon. My Profile opens the current collector’s showcase from the account drawer; desktop also has My Profile in its menu. Full collection, messages and custody records must remain private to their authorized participants.

## Ownership

| Role | Owns | Evidence required |
| --- | --- | --- |
| Business analyst | Product requirements, user journeys, revenue assumptions, rights/vendor requirements, launch scope and prioritization | Written acceptance criteria; verified sources separated from proposals |
| Developer | Web/native implementation, migrations, account authorization, integrations, performance and release packaging | Reviewed code; reproducible checks; compatible build artifacts |
| QA | Independent positive/negative tests, defect reproduction, cross-account/privacy cases, device matrix and release verdict | Baseline failures, patched passes and explicit untested areas |
| Project lead | Scope, file ownership, integration, release coordination, persistent handoff | Unified backlog, release notes and exact published version |
| Founder | Legal operator/contact, budget, vendor contracts, payment/store accounts and operational staffing | Actual details and signed/verified accounts; no inferred approval to spend or send vendor messages |

## Delivery process

1. Analyst defines the problem, release scope and acceptance criteria.
2. QA reproduces material defects with isolated fixtures or device evidence.
3. Developer fixes the assigned area; project lead integrates frontend/native changes.
4. QA retests the actual implementation and protects the original failure with meaningful regressions.
5. Lead builds and publishes a verified candidate to its authorized audience. Broader release requires the relevant gates below.

Changes are done only when the relevant checks pass, private data boundaries hold, failure messages are accurate, and material verification limits are recorded. Passing an export/build is not evidence that a native app runs correctly on a phone or has passed a store review. Roles persist in this charter for future project work; agents do not keep working after a session ends unless explicitly scheduled.

## Release stages

| Stage | Scope | Gate |
| --- | --- | --- |
| Private engineering candidate | Existing starter directory, historical sales and account workflows | Code/regression checks, migrations, production web build and native exports |
| Invited collector pilot | Consenting adult testers; no connected checkout | Supported-device journeys, identified operator, applicable policies/contact, moderation and recovery operations |
| Free public beta | Clearly disclosed starter coverage; member-only social/account data | Pilot critical journeys pass; support and incident/retention processes operate |
| Paid marketplace | Real orders, seller onboarding, payments and payouts | Verified processor, inventory/payment state machine, refunds/disputes, tax/accounting and reconciliation |
| Full licensed values/catalog | Exact editions/variants and current licensed Raw/CGC estimates | Signed redistribution/image rights, authorized sample reconciliation, feed freshness/expiry and scalable search |
| Native store release | Signed iOS/Android app with production account experience | Compatible toolchain security resolution, native authentication, device QA, store ownership/disclosures and review |

Revenue targets and pricing remain hypotheses until observed transactions, costs and retention support them. No profit or complete legal protection is guaranteed.

The founder’s directory requirement is one operator-managed, preloaded catalog: collectors must never be required to supply third-party credentials. Full provider delivery/account access remains pending; the personal-token UI is removed.
