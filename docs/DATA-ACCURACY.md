# Key issues and first appearances: where the facts come from

There are 2+ million issues, so nobody can check every comic by hand. The site therefore only states a fact when a source we trust states it, and hand-checked facts always win.

## What the site shows, in order of trust

1. **Hand-checked by ComicHuddle.** These come from two lists:
   - `lib/first-appearance-reference.ts`: 82 famous characters (Wolverine → Incredible Hulk #181, Venom → Amazing Spider-Man #300, and so on).
   - `lib/catalog.ts`: the 43 curated key issues and their notes.

   A hand-checked fact replaces anything Metron or Wikidata says for that character, and conflicting entries are hidden, never deleted. It is re-applied after every character import.
2. **Metron's own character description names the issue** (`metron_desc_confirmed`).
3. **Wikidata's "first appearance" statement**, matched to the exact issue by GCD id, or by series, number and year.

## What the site never shows as a fact

- **Metron's "earliest issue we have indexed" for a character.** It's often wrong; Kang, for example, shows Fantastic Four #19 and Captain Marvel (Mar-Vell) shows Cracked #58.
- **Wikidata matches made by character name alone.**
- **Ties and conflicts** between sources.

## Audit, November 16, 2026 (QA data)

| | Before | After |
|---|---|---|
| Famous characters shown correctly | 50 of 82 | **82 of 82** |
| Shown wrong | 3 (Mysterio → ASM #2, Cable → X-Men #201, Luke Cage) | 0 |
| Not shown | 29 | 0 |

Other findings:
- Where Wikidata and a Metron description both name an issue (33 characters), they agree every time.
- About 200 characters existed twice: a Wikidata-only record next to the Metron one (for example "Mysterio" and "Mysterio (Beck)"). See below.

## Duplicate characters (merged November 16, 2026)

150 duplicate pairs were checked by hand and merged into one page each (`lib/character-merges.ts`; apply now with `scripts/apply-character-merges.ts`, and every character import re-applies it).
- The old page link opens the merged character, and nothing is deleted.
- When Wikidata's first appearance for the pair is right, it moves to the merged page (Kierrok now shows X-Men #96 instead of a 1986 reprint). When it is wrong or doubtful (Mysterio, Proteus, Baron Zemo and others marked `keepFact:false`), it is left behind.
- A merge is skipped automatically if either record has changed since it was checked.

Deliberately **not** merged, because a matching name isn't the same character:
- Alternate versions: the "Days of Future Past" X-Men (Storm, Colossus, Magneto, Kate Pryde…), and Limbo Storm and Nightcrawler.
- Legacy names: Robin.
- Wrong name matches: "Anthony Scarola" and Donald Trump, D&D gods and Narnia's Aslan.

The owner decided to leave the remaining uncertain look-alikes (Splinter, Tigress, Changeling/Morph, Strongman and similar) as separate pages. To merge one later, add its line to `lib/character-merges.ts`.

Hidden: Wikidata items that are not comic characters (the folklore Yeti), listed in `HIDDEN_CHARACTERS` in the same file. They are kept out of search and browsing, and their page shows "not found".

Run the audit again any time: `scripts/audit-first-appearances.ts`. To correct a famous character, add or fix their line in `lib/first-appearance-reference.ts`, then run `scripts/apply-first-appearance-reference.ts`. The next character import also applies it.
