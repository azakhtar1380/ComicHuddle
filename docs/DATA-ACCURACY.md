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
- About 200 characters exist twice: a Wikidata-only record next to the Metron one (for example "Mysterio" and "Mysterio (Beck)"). Merging them needs its own careful pass.

Run the audit again any time: `scripts/audit-first-appearances.ts`. To correct a famous character, add or fix their line in `lib/first-appearance-reference.ts`, then run `scripts/apply-first-appearance-reference.ts`. The next character import also applies it.
