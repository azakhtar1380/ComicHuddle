# Polish pass (owner, 2026-11-15) — shared rules for helpers

Builds on `docs/REDESIGN-BRIEF.md`. Keep the theme (cream paper, ink, comic red and yellow, Barlow Condensed headlines,
DM Sans text), no fake content, don't break working features, keep accessibility.

## Rounded corners everywhere — use only these tokens (defined in `app/globals.css`)
| Token | Value | Use for |
|---|---|---|
| `--radius-pill` | 999px | search bars, filter chips, tags/badges, toggles, segmented controls, small chip buttons |
| `--radius-sm` | 10px | inputs, selects, textareas, dropdown items, standard buttons, tooltips |
| `--radius-md` | 16px | cards, toasts, the Huddles' tip line (cover images inside cards ~12px) |
| `--radius-lg` | 24px | big panels, page-header blocks, dialogs, account panel, section bands |
| `--radius-sheet` | 28px 28px 0 0 | mobile bottom sheets |
A sweep already replaced every 0–6px radius with `--radius-sm`; when you touch a component, use the right token for it
(search → pill, filters → pill chips with a small ✕ when selected, cards → md, dialogs → lg). No square boxes.

## Huddles (components in `components/huddles-guide.tsx`)
- `<HuddlesGuide pose size line/>` — transparent cut-out on a soft halftone spotlight + ground shadow. **No boxes, no
  speech bubbles, no caption boxes, never any text on top of him.** `line` renders a tip line *under* him.
- `<HuddlesTip>One short sentence.</HuddlesTip>` — the "Huddles' tip" line (head icon → /about-huddles, yellow pill tag,
  sentence). Put it next to page text (under the one-line description, above the main button). One per page at most.
- `<HuddlesArt pose size/>` — just the image; decorative (alt="", aria-hidden) by default.
- `<HuddlesPeek edge="top"|"right"/>` — Huddles hiding behind a **big** card. Absolutely positioned: the card (or a
  wrapper) must be `position:relative` and must not clip it (no `overflow:hidden` on that element; if a dialog scrolls,
  put the peek on an inner wrapper with enough top padding/margin so he isn't cut off). `edge="top"` sits on the card's
  top border (≈84px tall desktop, 62px mobile, placed at right:18%); `edge="right"` sits on the right border. It slides
  in once (respects reduced motion), `pointer-events:none`, aria-hidden. Never over cover art, title, issue #, price,
  grade, facts or buttons. **Only on big single-comic detail views. Never on small grid/row cards, checkout, orders or admin.**
- New poses: `characters` (#25), `hero-vs-villain` (#26), `peek-top` (#27), `peek-side` (#28), `thank-you` (#29),
  `portrait` (#30), `origin` (#31), `oath` (#32), plus `community` (#6).

## "Peek inside →"
Every place a card opens its full view ("More info", "View details", "Details", "View", "Open"…): visible label becomes
**Peek inside →** (pill text button with a small arrow, or ink-underlined link if tight — same style everywhere:
class `peek-inside` defined in `app/design-system.css`). Accessible name stays descriptive:
`aria-label="Peek inside {title} #{issue}: see full details"`. Where the whole card is clickable, the label is just the
visible cue — keep ONE focusable target per card (don't add a second tab stop).

## Rules
- NEVER edit files with PowerShell Get-Content/Set-Content (corrupts UTF-8). Use Edit/Write.
- Only edit the files you're given. Don't commit, push, deploy or run `npm run build`; don't stop node processes
  (long-running data jobs). You may run `npx tsc --noEmit -p .` and `npx eslint <your files>`.
