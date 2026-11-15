# Comic detail data accuracy audit (2026-11-15, detail helper)

Scope: everything the comic detail card (`app/issue-showcase.tsx`) shows, and where each value comes from.
Method: code trace of every read path, plus analysis of the real Metron crawl cache
(`.metron-cache/characters/*.ndjson`: 1,346 character issue lists, 1,343 character details, 548 issue details)
and the GCD seed (`db/gcd-overview-seed.jsonl`). **No SQL was run**: the QA database credentials live in the
owner's scratchpad env file, and reading it was refused by the permission system, so counts below come from
the cache, not from `ch_web.*` tables.

## How the detail data is populated

| Field | Source / path | Notes |
|---|---|---|
| Title, issue #, publisher, year | Native GCD rows: view `gcd.comichuddle_native_directory` (migration 020): `gcd_series.name`, `gcd_issue.number`, `gcd_publisher.name`, year from `key_date`. Curated ids 0–42: hand-entered `lib/catalog.ts` + `lib/catalog-additions.ts`. | Mapping is correct. Missing series/publisher become "Series metadata pending · GCD n" / "Publisher not recorded" placeholders. |
| Release dates, cover price, pages, ISBN, barcode | `bibliography` block of the same view (`on_sale_date`, `publication_date`, `key_date`, `price`…) | Only present for native GCD rows; curated entries have no bibliography. |
| Edition / variant | `gcd_issue.variant_name`, `variant_of_id` (→ `bibliography.variantOf`); else placeholder "Edition record · printing must be confirmed" / "Original issue · printing to be confirmed" | See finding 3. |
| Writer / artist / cover artist | Metron issue credits (`ch_web.metron_issue_details`, via `/api/issues/{id}/profile`); GCD story credits only when `bibliography.stories` was imported; curated hand entries | See finding 4. |
| Characters | Metron issue characters + `ch_web.character_issues` (Metron appearances linked to catalog issues) + Wikidata-only facts | Portraits are Metron images copied to our CDN (`metron-characters/<id>/portrait.webp`). |
| First appearances / key issue | `ch_web.character_first_appearances` (source `metron` or `wikidata`, with `match_method`) | See finding 1 (major). |
| Description | Metron issue `desc`; previously also GCD `notes` and curated `note` | See finding 2. |
| Market | `/api/issues/{id}/insights` (`lib/issue-insights.ts`): CGC-reported sales (curated ids), licensed FMV/comps (rights-gated), ComicHuddle sales/listings/auctions/demand, eBay Browse asks | Values are computed from recorded observations only; nothing is synthesized. |
| Catalog issue ↔ Metron issue | `resolveProfileIssue` (lib/characters.ts): curated id → `CURATED_GCD_IDS`; else `catalog_issues.metron_id`; else `metron_cover_index` (exact first) or `character_metron_issues` (name + year + number, unique only; ambiguous claims dropped) | See finding 6. |

## Findings

1. **Wrong first appearances / key-issue claims (fixed).** `character_first_appearances` rows with
   `match_method='metron_issue_list'` are not a stated first appearance: they are simply the earliest issue Metron has
   indexed for that character. In the cache, 1,149 of 1,346 character facts (85%) are of this kind; only 150 are
   confirmed by the character's Metron description naming the issue (`metron_desc_confirmed`). Where the description
   does name an issue, the list-based guess disagrees often — e.g. Dick Grayson (list: Batman #1, real: Detective
   Comics #38), Lex Luthor (Superman #4 vs Action Comics #23), Darkseid (Jimmy Olsen #134 vs Forever People #1),
   Loki, Barbara Gordon, Swamp Thing, John Constantine. Those conflicts were already suppressed, but every
   unconfirmed `metron_issue_list` fact was shown as "First appearance" and turned the issue into a "Key Issue".
   The character page / search / browse also *preferred* the Metron guess over a Wikidata statement
   (`ORDER BY (source='metron') DESC`).
   **Fix (`lib/characters.ts`):** a first appearance is shown only when a source states it — Wikidata P4584
   "first appearance" or a Metron description confirming the exact issue (`VERIFIED_FIRST_APPEARANCE`). Applied to
   the issue profile (key issue + debut badges), character search, browse and character page; confirmed Metron
   facts are preferred, then Wikidata. Unconfirmed facts remain in the database untouched (the characters still
   list the issue as an appearance). `checks/characters.test.ts` updated accordingly.
2. **Unverified editorial claims shown as fact (fixed in the card).** Curated entries carry hand-written `kind`
   ("Key issue", "First appearance") and notes ("The debut issue for Deadpool", "An early Wolverine appearance") with
   no source, and native GCD rows put GCD *indexer notes* (e.g. "Cover Number with Period") into `note`, which the
   card displayed as the issue description. The card no longer shows `kind` tags; it shows a curated note only when
   it makes no key/first-appearance claim (labelled "Catalog entry · not source-checked"), and never shows GCD indexer
   notes as a description. Description priority: Metron description → GCD story synopsis → safe curated note.
3. **Edition shown as "Original issue" without evidence (fixed).** The card printed "Original issue" for any variant
   name that didn't match a keyword regex — including real GCD variant records (`variant_of_id` set, e.g. a
   "Todd McFarlane Cover" variant). Now: GCD variants show "Variant edition: <name>" with a link to the main GCD
   issue; real edition names are shown as recorded; placeholder text is hidden.
4. **Credits (fixed / labelled).** Role matching missed "Illustrator" (e.g. Dave Gibbons on Watchmen #1) and
   counted cover-only credits as interior art. Metron lists every cover artist of an issue *including variant
   covers* (X-Men: Red #1 has 10 "Cover" credits), so a "Cover by" line could name a variant artist as the cover
   artist; three or more cover credits are now labelled "All covers, including variants". GCD story credits
   (script/pencils, with "(signed)/(sourced)" annotations stripped) are used when Metron has none, then the curated
   entry (labelled as such). Spot-check of curated credits against Metron (ASM #300–302, UXM #265–267, Batman #423,
   Hulk #181, Batman Adventures #12, Wolverine #1, X-Men #1 1991, Watchmen #1): consistent; UXM #267 lists only
   Whilce Portacio although Metron also credits Jim Lee — Metron credits win on the card.
5. **GCD first-appearance notes were unused (added).** GCD indexers mark debuts in story character lists
   ("Rhino [Aleksei Sytsevich] (antagonist) (first appearance)", "The Joker (villain) (introduction)",
   "Mary Jane Watson (First full appearance)"). When the GCD story record is loaded, these are shown under Collector
   information labelled "GCD", with the exact qualifier (full / cameo). Cover-sequence characters are ignored.
6. **Catalog ↔ Metron issue links (checked, risk remains).** Exact links (catalog `metron_id`, cover-index exact
   lookups) are preferred; name links require series name + start year + number and are dropped when two Metron
   issues claim one catalog issue. `sameIssueRef` (description confirmation) uses substring series matching
   without a year; in the cache all 24 non-identical confirmations were genuine ("Secret Wars" ↔ "Marvel
   Super-Heroes Secret Wars", "Adventure into Fear" ↔ "Fear"), but a same-number different-volume match is possible.
   Not changed (import code is not in this helper's files).
7. **Curated id mapping (checked).** `CURATED_GCD_IDS` previously mapped both X-Men #1 (1991, id 20) and X-Men #1
   (1963, id 33) to GCD 17896 (scratchpad history); the current file maps id 20 to 2516357. Not re-verified against
   the database (no SQL access).
8. **Characters fallback (fixed).** Curated character lists included non-characters ("Science-fiction anthology" for
   Planet Comics) and were shown like real data. Order is now: Metron/Wikidata profile (linked, portraits) → GCD story
   character list (labelled GCD, not linked) → curated list (labelled "Catalog entry") → "Not listed".
9. **Market data (checked).** `issue-insights` only uses recorded observations; asks alone never produce a value;
   CGC-reported sales attach only to curated ids that map to the same book. The card now hides empty market tiles
   ("0 live auctions", "— want it"), labels the computed typical value as an *Estimate* with its basis, and labels
   want-list/collection counts as ComicHuddle community data. The duplicate "Original cover price" tile was removed
   (it is in Comic information, from GCD). Remaining risk: eBay asking prices are matched by title text
   (`lib/ebay-browse.ts`, not this helper's file); listings without a year in the title can belong to another volume.
10. **Release dates.** The card used only the year. It now shows the GCD on-sale date and cover (publication) date
    when recorded, else the catalog year; `key_date` "YYYY-MM-00" is rendered as month + year, never as a day.

## External links on the detail card

Exactly one of each, both verified 2026-11-15:
- **View values on GoCollect** → `https://gocollect.com/search?q=<series> <number>` (GoCollect search results; the
  exact issue is listed first, variants follow). The old per-issue slug map (5 issues) and the generic
  "Open GoCollect comic guide" fallback are gone from the card.
- **Submit to CGC** → `https://www.cgccomics.com/submit/how-to-submit/` (CGC's official "How to Submit" page, which
  links to sign-up, tiers & fees and the submission form).

Removed: the "Explore GoCollect independently" link in `app/issue-values.tsx` (component is unused). Still in
`app/hub.tsx` (not this helper's file): the `details` blob passed to the card contains "Research this issue on
GoCollect / Open GoCollect comic guide", "CGC certificate lookup" and eBay/bibliographic links. The card no longer
renders that prop, so these are not shown; the owner should delete it (see the report).
`app/cgc-guide.tsx` still links to the GoCollect guide but is not rendered anywhere.

## What remains

- Run against the QA DB (read-only) to size finding 1 in `ch_web.character_first_appearances`
  (`SELECT source,match_method,suppressed,count(*) … GROUP BY 1,2,3`) and to re-check `CURATED_GCD_IDS`.
- Consider teaching the importer to store `metron_issue_list` facts as "earliest indexed" instead of a first
  appearance (lib/characters-import.ts), and to require a year in `sameIssueRef`.
- Native GCD rows have no story records (`stories` comes only from `catalog_issues.data`), so GCD credits and GCD
  first-appearance notes appear only for imported issues; joining `gcd_story` in the view would extend them.
- Community-contributed metadata: only community covers exist today (shown in the cover note by `hub.tsx`); there is
  no community-edited field to label yet.
