# Settle design system v2

Anchored to [PRODUCT.md](./PRODUCT.md). Tokens live in
`assistant/src/web/app/styles/tokens.css`. Colours come from there and nowhere
else; screens read tokens, never hex values.

## Principles

- **Calm and dense.** A ledger is a working surface: more rows, fewer cards,
  less ornament. Whitespace groups related data instead of padding out a page.
- **Keyboard first.** Every action has a key path and a visible focus state.
  Nothing depends on a pointer hover to be discoverable.
- **Data over decoration.** Numbers, dates and labels carry the screen. No hero
  imagery, no gradients, no illustration behind content.
- **One accent.** Indigo (`--accent`) marks the primary action and the current
  selection. It does not tint headings, icons or decoration.
- **Colour for state only.** Green, red and amber mean positive, negative and
  warning, never emphasis or branding.
- **Motion under 150ms, state changes only.** `--dur` is 120ms, applied to
  hover, focus, pressed and disclosure. Nothing animates on load or scrolls by
  itself.
- **No mascot, streaks, confetti or celebratory copy.** A transaction is
  recorded; that is the whole reward.

## Tokens

### Colour

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `--bg` | `#fafaf9` | `#0f1012` | Page ground |
| `--surface` | `#ffffff` | `#16171a` | Cards, panels, inputs |
| `--surface-2` | `#f4f4f2` | `#1c1d21` | Nested panels, table headers, hover rows |
| `--surface-3` | `#ebebe8` | `#24262b` | Pressed rows, inert blocks |
| `--line` | `#e6e6e2` | `#2a2c31` | Hairline borders, row dividers |
| `--line-strong` | `#d4d4cf` | `#3a3d44` | Input borders, emphasis rules |
| `--ink` | `#17181a` | `#ececea` | Primary text |
| `--ink-2` | `#2c2e33` | `#d4d4d1` | Secondary text, dense table values |
| `--muted` | `#5f636b` | `#a0a3aa` | Labels, metadata, helper text |
| `--faint` | `#6b6f77` | `#8f939b` | Placeholders, disabled text |
| `--accent` | `#2d4fc4` | `#8aa2ff` | Primary button fill, selection, active nav |
| `--accent-hover` | `#2442a8` | `#a3b6ff` | Accent hover state |
| `--accent-ink` | `#ffffff` | `#0f1012` | Text on accent fills |
| `--accent-soft` | `#eef1fb` | `#1d2440` | Selection background, accent chips |
| `--pos` | `#1a7f4b` | `#4cc38a` | Money in, settled state |
| `--pos-soft` | `#e7f4ec` | `#13261c` | Positive chip background |
| `--neg` | `#c8372d` | `#ff7a70` | Money out, errors, destructive actions |
| `--neg-soft` | `#fbecea` | `#2c1715` | Negative chip background, error banner |
| `--warn` | `#a15c07` | `#f0b84a` | Needs attention, stale data |
| `--warn-soft` | `#fbf1e0` | `#2a2110` | Warning banner background |
| `--shadow` | `0 1px 2px rgb(0 0 0 / 4%), 0 1px 1px rgb(0 0 0 / 3%)` | `0 0 0 1px var(--line)` | Resting elevation |
| `--shadow-lg` | `0 12px 32px -12px rgb(0 0 0 / 18%), 0 2px 6px rgb(0 0 0 / 6%)` | `0 16px 40px -16px rgb(0 0 0 / 70%), 0 0 0 1px var(--line)` | Menus, dialogs, popovers |

Dark theme resolves from the same token names: `prefers-color-scheme: dark`
(unless `[data-theme="light"]` is set) and an explicit `[data-theme="dark"]`.

### Spacing

A 4px grid. There are no intermediate values.

| `--s1` | `--s2` | `--s3` | `--s4` | `--s5` | `--s6` | `--s8` | `--s10` | `--s12` | `--s16` |
|---|---|---|---|---|---|---|---|---|---|
| 4px | 8px | 12px | 16px | 20px | 24px | 32px | 40px | 48px | 64px |

### Radii

| Token | Value | Use |
|-------|-------|-----|
| `--r1` | 4px | Chips, badges, small inputs |
| `--r2` | 6px | Buttons, inputs, menu items |
| `--r3` | 8px | Cards, panels, dialogs |

### Type scale

| Token | Value | Use |
|-------|-------|-----|
| `--t-xs` | 12px | All-caps labels, table captions, chips |
| `--t-sm` | 13px | Secondary text, table cells |
| `--t-base` | 14px | Body and UI default |
| `--t-md` | 16px | Lead sentences, input values |
| `--t-lg` | 20px | Section headings |
| `--t-xl` | 28px | Page titles |
| `--t-2xl` | 40px | Landing statement only |

Fonts: `--font` is Inter; `--mono` is the system monospace stack. Weights in use
are 400, 500 and 600.

### Density

| Token | Comfortable | Compact |
|-------|-------------|---------|
| `--row-h` | 40px | 32px |
| `--pad` | 16px | 12px |

`[data-density="compact"]` on `<html>` switches the values. Tables and list rows
read `--row-h` and `--pad`, so they follow the preference without extra rules.

### Motion

| Token | Value |
|-------|-------|
| `--dur` | 120ms |
| `--ease` | `cubic-bezier(0.2, 0, 0, 1)` |

Transitions apply to hover, focus, pressed and open/closed states. Long
animations, parallax, auto-scrolling and celebratory effects are out.

## Typography

- Inter 400 for body, 500 for labels and emphasis, 600 for headings and buttons.
- Headings use tight tracking: page titles `-0.02em`, section headings
  `-0.01em`. No condensed or stretched cuts.
- Every amount uses `.num`, which sets `font-variant-numeric: tabular-nums`, so
  columns line up as values change.
- Small labels are uppercase, 12px, weight 500, `letter-spacing: 0.08em`, in
  `--muted`. They label a section or a column; they never carry a sentence.
- Sentence case everywhere else. No title case in body copy.

## Layout

- Everything sits on the 4px grid (`--s1` through `--s16`).
- **Landing page**: a 12-column grid, max width 1200px, 24px gutters. Under
  768px it becomes 4 columns with 16px gutters. Sections are separated by 1px
  `--line` rules, numbered `01`–`05`, each with a small all-caps label.
- **App shell**: a sidebar plus a top bar. The sidebar holds navigation groups,
  the account switcher and the theme control; the top bar holds breadcrumbs,
  search and the primary action. This shell ships in M7b. Until then the current
  consumer screens run on the v2 tokens through the alias layer.

## Components

- **Buttons.** Primary is an accent fill with `--accent-ink` text and 600 weight.
  Secondary is `--surface` with a 1px `--line-strong` border and `--ink` text.
  Ghost has no background or border, only muted text that turns `--ink` on
  hover. Height is 32px compact, 36px comfortable; radius `--r2`; one 120ms
  transition.
- **Inputs.** `--surface` background, 1px `--line-strong` border, radius `--r2`,
  `--t-base` text, placeholder in `--faint`. Focus adds a 2px accent ring. Error
  state uses `--neg` for the border and `--neg-soft` behind the message.
- **Cards.** `--surface` background, 1px `--line` border, radius `--r3`. Use
  `--shadow` only where a card must separate from a same-tone panel. No heavy
  drop shadows, no glass blur.
- **Tables and rows.** Row height `--row-h`, horizontal padding `--pad`,
  dividers in `--line`. Amounts right-aligned with `.num`. Header labels use the
  small all-caps style.
- **Chips.** Radius `--r1`, `--t-xs`, padding `4px 8px`. Neutral chips use
  `--surface-2` with `--muted` text. State chips use `--pos-soft`/`--pos`,
  `--neg-soft`/`--neg`, `--warn-soft`/`--warn`. Accent chips use
  `--accent-soft`/`--accent`.
- **Empty states.** One sentence in `--muted`, an optional outline button, and
  the `Planned · M#` label when the feature is not built. No illustration.
- **Planned labels.** `Planned · M#` in the small all-caps style, colour
  `--muted` or `--warn`. They sit next to any control that does not work yet.

## Copy rules

- Write plain statements in the active voice. "Spend logged · $4.50", not
  "Nice one!".
- Sentence case for headings, buttons and labels.
- State only what works today. Describe the pipeline, security model and
  features as they exist in the shipped code.
- Label anything unbuilt `Planned · M#`, with the milestone that ships it. Never
  describe a planned feature as available.
- Name amounts with their currency. Include the sign or the word in/out, not
  colour alone.

## Accessibility

- Body text meets AA contrast (4.5:1) in both themes; large text and UI borders
  reach at least 3:1. `--muted` and `--faint` are tested against `--bg` and
  `--surface`.
- `:focus-visible` draws a 2px accent ring with a 2px offset. Never remove it.
- Interactive targets are at least 44px on touch screens under 640px.
- `prefers-reduced-motion` removes non-essential transitions and animations.
- No horizontal scrolling at 360px. Tables collapse to stacked rows rather than
  overflow.
- State is never carried by colour alone: pair it with text or an icon.

## Brand mark

A static geometric "S": three horizontal ledger rules joined by short verticals,
with a short hook at each end so it does not read as a 5. Drawn in `currentColor`
(`BrandMark.tsx`, 24px viewBox, 3-unit stroke); the favicon is the same shape on an
ink square. It replaces the mascot everywhere.

## Legacy

Old token names (`--pen`, `--lime`, `--sky-top`, `--dusk`, `--radius`,
`--display`, …) still resolve through an alias block at the top of
`assistant/src/web/app/app.css`. The aliases point at v2 tokens, so current
screens pick up the neutral palette and Inter without being restyled. The alias
block and the POCKET CSS layer are removed in M7b as each screen moves onto v2
components, and hex values outside `tokens.css` go with them.
