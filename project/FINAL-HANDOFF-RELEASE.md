> Historical release record. Current deployment/runtime, source state, image diagnosis and payment readiness are in [Launch stabilization — 15 October 2026](LAUNCH-STABILIZATION-20261015.md). The D1/R2 description below is not the current deployed Vercel/RDS backend.

# Mobile directory and source handoff — 13 October 2026

The reported phone screenshot showed the header and intro at normal logical width while the publisher strip, filters and cards extended sideways. The publisher strip's nowrap content and its intrinsic grid track could expand the page; iOS then fit that overflow into the screen. The revised directory contains its grid children, inputs/selects and text. Mobile has two vertical cards per row with bounded portrait artwork and wrapping titles/issue numbers. Saved desktop List choices render the same mobile gallery. The publisher/series strip is removed on mobile and breadcrumbs are removed everywhere; search and Publisher filters remain. Desktop retains a contained publisher/series sidebar.

The complete website and mobile sources are supplied as separate ZIPs, with package files, lockfiles, assets, migrations, tests and continuation notes. Website storage is D1/R2; native device account/camera features remain website handoffs. Both archives exclude credentials and private customer data.

GCD's GitHub repository was examined through untruncated master/beta trees and its official README. It contains code, reference fixtures and development data machinery, not the full production comic catalog. The authenticated download route remains the required source for a whole baseline. Current stored metadata is exported separately with an actual count/date.

A one-time bulk path validates a supplied SQLite archive into core bibliographic JSONL, converts it into sorted checked CSV with a manifest, and uploads bounded idempotent batches. It preserves existing starter/Metron/user/listing identities and equal or newer GCD metadata, sharing the GCD lease without advancing weekly checkpoints or consuming supplier quota. Complete-export verification means the supplied rows and checksum reconciled, never that every GCD field or comic is present. Modern linked fields not reconstructed by the SQLite adapter are reported. No full licensed snapshot has been supplied or imported.

Current QA and deployment/readback records give concrete counts and limits. Browser/device/camera/OAuth and genuine processor acceptance remain unverified.
