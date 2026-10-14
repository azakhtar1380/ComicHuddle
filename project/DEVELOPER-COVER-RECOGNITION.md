# Automatic cover recognition implementation

Implemented 13 October 2026 for the existing ComicHuddle web scanner. The current capability recognizes a finite set of six existing reference covers. This is a genuine image-feature matcher running in the collector’s browser; it is not a purchased recognition service, a comprehensive comic identifier or a calibrated accuracy claim.

## Reference coverage and rights

| Stable directory ID | Cover | Year | Existing asset |
| --- | --- | --- | --- |
| 24 | Planet Comics #12 | 1941 | `/covers/planet-12.jpg` |
| 25 | Planet Comics #21 | 1942 | `/covers/planet-21.jpg` |
| 26 | Planet Comics #27 | 1943 | `/covers/planet-27.jpg` |
| 27 | Planet Comics #42 | 1946 | `/covers/planet-42.jpg` |
| 28 | Planet Comics #53 | 1948 | `/covers/planet-53.jpg` |
| 29 | Planet Comics #55 | 1948 | `/covers/planet-55.jpg` |

The declared references in `scripts/cover-recognition-references.json` retain each existing Wikimedia Commons source and existing U.S. public-domain/no-renewal label, with the current territorial-review caveat. This implementation does not acquire or independently certify image rights. No new modern comic art was downloaded or incorporated. Index entries also contain a SHA-256 digest of their source bytes.

`python scripts/build-cover-index.py` generates numerical descriptors in `public/recognition/cover-index.json`. `python scripts/build-cover-index.py --check` verifies that the generated index still matches its explicit source declarations and assets. Growing this set requires authorized assets, stable edition IDs, reviewed source/territory attribution, generation and independent recognition/corpus checks. A metadata import alone does not expand image recognition coverage.

## Matching and result contract

`lib/cover-recognition.ts` exports the pure feature, geometry, candidate and consensus functions together with index loading and directory-resolution adapters. An input frame is bounded to a 640-pixel longest side in `app/scan-comic.tsx`. Each candidate samples an 18-by-26 grid with nine bounded bilinear samples per cell, then describes spatial normalized luminance, chroma and edge differences. The reference generator uses the same sampling rule. Matching distance combines luminance correlation (60%), chroma distance (25%) and edge correlation (15%). Flat crops below 0.055 luminance contrast cannot qualify.

Camera matching samples the centered portrait guide, whose aspect ratio is 0.70, through the actual `object-fit: cover` geometry. Bounded scale/aspect/position variations accommodate small alignment differences. Uploaded images use the whole portrait image when its aspect allows, plus bounded centered portrait candidates. The matcher does not locate arbitrary rotated or off-center comics, rectify perspective, decode a slab certification or determine printing from an indistinguishable cover.

The current heuristic gates require feature distance at most 0.14 and a runner-up gap of at least 0.07. A value is a distance, not a probability. Live results additionally require three consecutive qualifying samples of the same reference, spaced at least 300 ms apart and spanning at least 700 ms. Unknown frames, a changed issue, a pause or a gap over 1800 ms reset consensus. The timer waits 450 ms after each completed sample; a single in-flight guard prevents loop overlap.

Before displaying an automatic result, the scanner requests `/api/catalog?id=<stable-id>` and parses the real directory response. It rejects a missing, malformed or mismatched ID/title/number/year/publisher. Confirm & add and View issue repeat this ID lookup before invoking the parent callback. A cover match suggests an issue identity; the collector still confirms edition/printing and enters the actual owned copy through the existing add workflow. Recognition never saves a collection entry or assigns a grade.

| State | Meaning |
| --- | --- |
| `matched` | An image match (or strict exact text identity) resolved to a validated directory record. |
| `unknown` | No confident identity, ambiguous matches, unreadable input, or unverified loose text/barcode hint. An unindexed cover may still exist in the directory. |
| `not_in_directory` | Only a strict parsed `Title #number (optional year)` received a successful complete empty exact-identity search response. The UI describes the search result and asks the collector to check the reading. Image mismatch alone never produces this state. |
| `index_unavailable` | The index, image-reading path or recognized directory reference could not be loaded/verified. A stale reference does not prove catalog absence. |
| `permission_denied` | The browser denied the explicitly requested camera permission. Photo and directory fallback remain available. |

Ready/starting/scanning/checking-directory states support progress. Manual directory search and optional browser barcode/text reading are secondary controls. A loose OCR string or barcode is a search hint, not an issue assignment. Strict text matches receive the same stable-ID verification as image matches.

## Lifecycle and privacy

Camera permission follows an explicit Scan opening action when the parent passes `startOnOpen: true`, or an explicit Start camera click. The optional prop defaults to false, so page loads and deep links remain idle. A guarded queued effect is canceled when discarded/unmounted, including React’s StrictMode effect cleanup. The request uses rear-facing preference and `audio: false`. The browser loads the small same-origin reference index and sends catalog IDs or text searches to its own directory. It does not upload the collector’s image or camera frames to the server or a recognition vendor.

Tab hiding clears timers, aborts pending requests, invalidates late callbacks, resets consensus and disables live video tracks. Returning re-enables an active stream and starts fresh consensus. Choosing a photo, changing manual selection, stopping/restarting the camera or unmounting stops all stream tracks and invalidates permission, decode, blob, detector and catalog callbacks. Blob preview URLs are revoked when replaced or unmounted. Late permission responses have their newly returned tracks stopped rather than reopening an obsolete camera.

## Verification and limits

TypeScript compilation and deterministic index regeneration pass. Independent `checks/scan-vision.mjs` executes the actual matcher against independently decoded reference JPEG pixels and controlled geometry/exposure/noise/ambiguity fixtures; all 15 groups passed during development. The image fixtures demonstrate correct identity for these six references and correct failure states for the tested negatives. They do not establish accuracy across unknown comics, physical covers, glare, sleeves, slanted shots or a representative camera corpus.

Independent component lifecycle checks execute the actual TSX with controlled React hooks, media/canvas adapters and delayed responses. The final QA report owns their verdict and counts. Browser UI, real camera hardware/permission behavior, physical-comic recognition, accessibility on devices and native camera parity have not been verified in this implementation pass. No preview server or browser was installed to work around the missing supported browser-control capability.
