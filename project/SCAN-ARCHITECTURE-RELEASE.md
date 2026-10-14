# ComicHuddle Scan and architecture release — 13 October 2026

## Delivered candidate

- The mobile web dock and Expo prototype retain six destinations, with a raised circular Scan action between three destinations on either side. The supplied logo and comic theme are preserved.
- Explicit web Scan actions start permission-based rear-camera scanning automatically. Passive links require Start camera. Local frames and selected photos are compared with six actual authorized vintage references; no frames/photos are uploaded. Matches require an ambiguity margin and temporal consensus, are checked against the directory, and require explicit confirmation before saving.
- Unknown art, an unavailable recognition service/index, and a successful exact title/issue lookup with no catalog record use separate messages. An incomplete cover index cannot prove a comic is absent from the catalog.
- The reusable React/Tailwind directory card is connected to the current directory. It has distinct Raw/CGC 9.8 views, private one-copy ownership capture, idempotent save requests and an exact-issue Buy link highlighted by actual available listings. Current licensed FMV remains Coming soon; no value is fabricated. Structured-copy editing uses the same ownership validation.
- Public showcases and trade projections explicitly omit ownership cost, date, certification details and notes.

## Runnable companion architecture

`architecture/postgres/` contains a PostgreSQL 18 schema and role grants, physical-copy inventory and lot manifests, append-only evidence-aware valuations, a versioned TypeScript price/data analyzer, trusted pooled request sessions, bounded same-origin HTTP handlers, custom identity approval/merge transactions, ownership adapter and secure buyer badge. `project/PRODUCTION-ARCHITECTURE.md` explains deployment, auth, rights, migration, operations and launch gates.

Every proposed listing and line must reference the central directory. A rare custom submission receives a provisional central ID and pending review in one transaction; checkout and bids remain blocked until identity is verified. Administrative estimates are labeled separately and do not become sale-based FMV. Matching price cannot authenticate a seller or a comic.

## Deployment and limitations

This release preserves owner-private sharing, existing D1/R2 storage, deployed migration history, runtime secrets and catalog-import configuration. The PostgreSQL reference is not wired into production. No real payment, refund, transfer, Metron import, licensed value feed or signed mobile release was activated. The native prototype opens the web scanner; it has no independent native camera engine.

See `project/SCAN-ARCHITECTURE-QA.md` and its evidence files for exact automated results and unexecuted browser, device, real-identity, processor and separate-connection concurrency cases. Passing local integration tests and exports does not establish a complete public commercial launch. The launch kit publication record records the exact deployed candidate.
