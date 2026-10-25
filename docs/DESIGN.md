# Settle consumer UI — design contract

This document anchors visual work to **product truth** (`docs/PRODUCT.md`). Do not replace the whole look via random metaphor rolls or a thin CSS overlay on an unrelated system.

## What Settle is (preserve in every visual pass)

- **Job:** Calm money snapshot, two-tap spend logging, weekly pace, patterns from **your** logs — no bank feed.
- **Tone:** Calm, legible, habit-forming — streak, weekly ring, small milestones. Not a slot machine; not a café loyalty gimmick unless the team explicitly chooses that in PRODUCT + this file.
- **Modes (Impeccable):** Welcome = **Persuade** (imagery, story, demo CTA). Signed-in shell = **Operate** (scanability, familiar patterns, one next action).

## Incumbent visual world (main / shipped)

- **Palette:** High-contrast monochrome house identity in `assistant/src/web/app/app.css` — porcelain/obsidian, chrome accent, editorial serif + grotesque sans (`Instrument Sans` / `Instrument Serif`), hairline rules.
- **Hero:** Dark `hero-card` with net position, **weekly progress ring** (not punch holes), optional grid/sheen.
- **Imagery:** Bundled photos under `assistant/public/media/` via `MediaPhoto` + `visual-assets.ts` — feature cards, welcome scene, demo step photos. Always use fallback on 404.
- **Charts:** Distinct per-category hues (`categories.ts`, Okabe–Ito style) for donuts/bars; do not collapse to one stock color unless DESIGN.md says so.
- **Motion:** Preloader, stagger on Today, stamp/confetti only where already defined — respect `prefers-reduced-motion`.

## What went wrong (punch-card branch)

1. **Unattended concept roll** (Impeccable surface brief) picked “café loyalty punch card” without replacing `app.css`.
2. **`punch-card.css`** re-tokenized a few variables and added punch components while **~1,200 lines of monochrome rules** stayed — cobalt topbar on cream/chrome components, missing styles for new class names, photos removed.
3. **frontend-design** skill encourages “pick an extreme aesthetic”; without PRODUCT/DESIGN pinning, that reads as **template shopping**, not Settle.

## Rules for the next redesign

1. **Redesign replaces, not layers.** If direction changes, rewrite tokens and components in `app.css` (or a single new theme file that **replaces** the old token block), update every surface, restore or replace imagery deliberately.
2. **Pin direction here and in PRODUCT.md** before large UI commits; no unattended metaphor rolls.
3. **Operate surfaces** keep weekly ring, feed columns, sheet flows; **Persuade surfaces** keep photo + phone preview pattern unless copy changes.
4. Verify at desktop + mobile in the running app before PR.
