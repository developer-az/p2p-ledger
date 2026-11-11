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
  imagery, no illustration behind content. The only painted background in the
  product is the single fixed wash layer described under Glass.
- **One accent.** Indigo (`--accent`) marks the primary action and the current
  selection. It does not tint headings, icons or decoration.
- **Colour for state only.** Green, red and amber mean positive, negative and
  warning, never emphasis or branding.
- **Motion under 150ms for state changes.** `--dur` is 120ms, applied to
  hover, focus, pressed and disclosure. The landing page owns the one long
  motion in the product: the guilloché dial and the section reveals, both
  specified under Motion and both static under `prefers-reduced-motion`.
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
| `--cat-dining` … `--cat-other` | see `tokens.css` | see `tokens.css` | Spend categories, charts and dots only; each category owns one name |
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
| `--t-xl` | 28px | Large sans text; page titles sit at 32px display |
| `--t-2xl` | 40px | Headline figures (This month, landing statement) |

Fonts are self-hosted: Instrument Serif (display), IBM Plex Sans (text) and IBM
Plex Mono (mono), as woff2 latin subsets in `assistant/public/fonts`, declared
with `@font-face` in `styles/fonts.css` and preloaded from `index.html`. Nothing
is fetched from a font CDN at build or run time. Each webfont has a
metric-matched fallback face over local Georgia (serif) and Arial (sans), so a
swap does not move a line.

| Token | Face | Weights | Use |
|-------|------|---------|-----|
| `--font-display` | Instrument Serif | 400, 400 italic | Landing H1, landing section numerals `01`–`05`, landing figure-strip numbers, page titles (`.v-title`), headline Overview / This month figures |
| `--font` | IBM Plex Sans | 400, 500, 600 | Body, labels, buttons, everything else |
| `--mono` | IBM Plex Mono | 400, 500 | Code, keycaps, aligned figures |

Weights in use are 400, 500 and 600.

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
| Route cross-fade | 160ms |
| Section reveal | 400ms, `translateY(12px)` to 0 |
| Figure ticker | 600ms, easeOutCubic |
| Dial rosette | one turn / 120s, linear |
| Dial track swing | ±30° across the hero |

Transitions apply to hover, focus, pressed and open/closed states.

- Only `transform`, `opacity` and `filter` are animated. Nothing animates
  layout: collapsing the sidebar swaps the grid column and width at once and
  only fades and slides the labels.
- Interface feedback stays under 300ms. The landing set piece is the one long
  motion: the dial's rosette turns once every two minutes and its minute track
  counter-rotates at most ±30° as the hero crosses the viewport. The rosette
  pauses off screen, and the single passive, rAF-throttled scroll listener that
  writes `--dial-turn` on the dial element exists only while the dial is on
  screen. Nothing is written to `<html>` or `<body>` during scroll.
- Route changes inside the app shell cross-fade through the native View
  Transitions API, feature-detected in `router.ts`; the 160ms fade lives in
  `styles/shell.css`.
- Scroll reveals use one IntersectionObserver that sets `data-in` on each
  landing section once, with the fade in CSS. Sections are only hidden once
  `<html>` carries `js-reveal`, which the observer setup adds, so the page is
  readable without JavaScript.
- The figure strip counts up once on entry, writes `textContent` directly (no
  re-render per frame) and ends on the server-rendered string, so the final
  value is exact.
- `prefers-reduced-motion: reduce` removes the rosette rotation, the track
  rotation and its listener, the reveals, the route cross-fade and the ticker:
  the page is the static layout.

## Glass

One material, on static surfaces only: smoked watch crystal. It reads as a
pane over the page, not as a coloured pane of its own — neutral fill, neutral
border, one diagonal highlight, a soft drop. Never neon, never rainbow.

It has two forms. **Panel glass** (`.glass`) is the neutral pane: the shell,
panels, dialogs, the tour rail, the sign-in aside, the landing figures.
**Tinted glass** is the same pane carrying one colour token, and it is what
the app's coloured controls are made of: buttons, chips, state pills, tags,
badges, segmented thumbs, the active sidebar item, keycaps and the toast. The
colour is the only difference; the edge, the sheen, the frost and the drop are
the same.

### Tokens (`styles/tokens.css`, light and both dark blocks)

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `--glass-bg` | `color-mix(in srgb, var(--surface) 48%, transparent)` | `... 42% ...` | Panel fill over the page |
| `--glass-bg-dense` | `... 88% ...` | `... 78% ...` | The same fill for panels that sit on a dialog scrim |
| `--glass-border` | `color-mix(in srgb, var(--ink) 12%, transparent)` | `color-mix(in srgb, #fff 12%, transparent)` | Hairline edge |
| `--glass-blur` / `--glass-saturate` | `18px` / `160%` | same | Frost |
| `--glass-filter` | `blur(var(--glass-blur)) saturate(var(--glass-saturate))` | same | The one place the filter is spelled out |
| `--glass-edge` | `inset 0 1px 0` white 55% | white 14% | The cut top bevel |
| `--glass-inner` | `inset 0 0 0 1px` white 30% | white 7% | Thin inner border |
| `--glass-sheen` | `linear-gradient(135deg, white 26%, transparent 42%, transparent 68%, white 9%)` | white 12% and 5% | Panel highlight |
| `--glass-sheen-tint` | white 22% / 8% | white 6% / 3% | The same highlight for a tinted control |
| `--glass-sheen-fill` | white 8% / 3% | white 6% / 3% | The thinner highlight under a near-opaque accent fill |
| `--glass-shadow` | `--glass-edge`, `--glass-inner`, `0 10px 28px -12px` ink 20% | same shape, black 55% | Edge light and drop |
| `--glass-shadow-hover` | brighter bevel, `0 12px 30px -12px` ink 24% | white 22%, black 62% | A control lifting under the pointer |
| `--glass-under` | `transparent` | `transparent` | What a tinted fill mixes with; the fallback makes it `--surface` |
| `--tint-neutral` | `8%` | `8%` | Smoke: badges, keycaps, chips, planned tags, ghost buttons |
| `--tint-state` | `16%` | `14%` | A state colour at rest: pills, active items, segmented thumbs |
| `--tint-accent` | `92%` | `92%` | A primary fill, opaque enough for `--accent-ink` |
| `--wash-gold` / `--wash-accent` / `--wash-neutral` | `--brand-gold` 24%, `--accent` 16%, `--ink` 5% | gold 24%, accent 16%, `--surface-3` 55% | The three washes under the glass |
| `--pos-ink` / `--neg-ink` / `--warn-ink` | the state colour mixed toward `--ink` (70/74/78%) | the state colour itself | State text on a pale state tint |

`--glass-bg-dense` covers the one place where the same fill would fail: a
dialog panel frosts its own scrim (ink at 30% for the palette, 40% for a
sheet), so the under-glass is much darker than the page and the fill goes up to
88% (light) and 78% (dark) to hold 12px `--muted` and `--faint` text at 4.5:1.

`.glass` in `styles/base.css` is the material: `background: var(--glass-bg)`,
`backdrop-filter: var(--glass-filter)` (with the `-webkit-` form), `1px solid
var(--glass-border)`, `box-shadow: var(--glass-shadow)`, and the sheen as an
`::after` overlay at `border-radius: inherit` with `pointer-events: none`. The
sheen paints above the fill and below the content (`isolation: isolate` on the
panel, `z-index: -1` on the overlay), so it never lightens a label and the
token contrast holds.

### Tinted glass

`.glass-tint` is the material with a colour in it. The element names the colour
and how much of the fill it takes; everything else is shared:

```css
background-color: color-mix(
  in srgb,
  var(--tint, var(--ink)) var(--tint-strength, var(--tint-neutral)),
  var(--glass-under)
);
background-image: var(--tint-sheen, var(--glass-sheen-tint));
border: 1px solid color-mix(in srgb, var(--tint, var(--ink)) 30%, var(--glass-border));
box-shadow: var(--glass-shadow);
backdrop-filter: var(--glass-filter);
```

The default tint is `--ink` at `--tint-neutral`, so a neutral control only has
to join the selector list. A control with a colour sets `--tint` and
`--tint-strength` in its own sheet and lets the material paint the fill, the
edge and the sheen. The sheen is a `background-image` rather than a pseudo
element here: fill and highlight are one paint, and no extra layer sits over a
label.

The highlight is thinner on a control than on a panel (`--glass-sheen-tint`),
and thinner again on a near-opaque accent fill (`--glass-sheen-fill`, set as
`--tint-sheen` by the primary buttons). A panel's 26% (light) or 12% (dark)
sheen covers most of a 24px chip; white over a small fill is light the label
then has to fight, and in dark it is the only thing that would push a state
pill below 4.5:1. The panel tokens keep the full highlight; the controls keep
the cut edge.

`base.css` carries the selector list once for the controls that already own a
stable class, so no markup was added for the material:

| Control | `--tint` | `--tint-strength` | Label |
|---------|----------|-------------------|-------|
| `.btn`, `.v-btn`, `.lp-btn`, `.btn-quiet` | `--ink` | `--tint-neutral` | `--ink` |
| `.btn-primary`, `.v-btn-primary`, `.lp-btn-primary`, `.shell-new` | `--accent` | `--tint-accent` | `--accent-ink` |
| `.btn-danger` | `--neg` | `--tint-state` | `--neg-ink` |
| `.chip`, `.add-again-chip`, `.v-chip`, `.lp-tag` | `--ink` | `--tint-neutral` | `--ink-2` / `--muted` |
| `.pill-good` / `.pill-bad` / `.pill-warn` | `--pos` / `--neg` / `--warn` | `--tint-state` | `--pos-ink` / `--neg-ink` / `--warn-ink` |
| `.shell-item[aria-current="page"]`, `.set-tab[aria-current="page"]` | `--accent` | `--tint-state` | `--ink` |
| `.v-seg button[aria-pressed="true"]`, `.add-switch button[aria-checked="true"]` | `--accent` | `--tint-state` | `--ink` |
| `.palette-row[aria-selected="true"]` | `--accent` | `--tint-state` | `--ink` |
| `.shell-badge`, `.planned-tag`, `.planned`, `.lp-tag.is-planned` | `--ink` | `--tint-neutral` | `--muted` |
| `.shell-search kbd`, `.palette-panel kbd`, `.shortcut-panel kbd` | `--ink` | `--tint-neutral` | `--muted` / `--ink-2` |
| `.toast` | `--ink` | `88%` | `--bg` |

Hover raises the tint by 8 points and swaps to `--glass-shadow-hover`; press
lowers it by 6. The accent fill cannot be raised much (it starts at 92%), so a
primary button hovers on `--accent-hover` at 94% instead. The toast takes 88%
rather than 76% because the sheen lightens the top-left of its fill and the
label has to clear 4.5:1 there.

Contrast: the label keeps its readable token; only the fill moved. The state
tints are pale enough for `--ink`, so state pills use a darker state ink
(`--pos-ink` and friends) to hold 12px text at 4.5:1 on the pale fill, and the
accent fill runs at 92% with the thin sheen so `--accent-ink` is 4.9:1 (light)
and 7.3:1 (dark) at the brightest point. Measured at the brightest sheen, the
light theme gives 5.2:1 and up for the neutral controls (the muted keycap is
the floor) and 5.7-6.2:1 for the three pills; dark gives 5.2-6.8:1 with the
thinned sheen. Disabled controls stay
solid: no tint, no frost, no sheen, `--surface-3` and `--muted` as before. The
focus ring is untouched at `2px solid var(--accent)`.

The add sheet's Expense/Income switch used a thumb that slid on `transform`.
A moving backdrop cannot be frosted, so the thumb is out of the paint and the
checked button carries the tint instead — the same pattern as `.v-seg`.

### The backdrop

Glass needs something to frost. `.app` carries one fixed, non-animated layer
(`::before`, `position: fixed`, `inset: 0`, `z-index: -1`, `pointer-events:
none`): three static washes on `--bg` — `--wash-gold` top-right,
`--wash-accent` bottom-left, and a soft `--wash-neutral` top-left that keeps the
centre from going flat. They are visible through the 48% (light) and 42% (dark)
panel fill but stay calm enough that body text never sits on them. Nothing
moves, nothing loops. `.lp` paints the same layer only when it is not already
inside `.app`, so the washes never stack. The shell's own `--bg` fill was
removed so the layer shows through.

### Where it goes

**Panel glass** (`class="glass"`, added where the surface is marked up, so the
material stays a decision per surface): the sidebar (`≥768px`), the sticky top
bar, `.card`, `.v-panel`, the `.v-fig` figure cells, `.ins-panel`, settings
panels, the command palette and shortcut sheet panels, dialog and sheet panels,
the tour rail, the sign-in aside, the landing figure cells and the pipeline
diagram.

**Tinted glass** (applied by selector, see the table above): every button, chip,
state pill, tag, badge, keycap, the segmented thumbs, the active sidebar item,
the active settings tab, the selected palette row and the toast.

It never goes on the dial, chart internals, inputs, list rows, the icon-only
chrome buttons (`.shell-icon-btn` — four of them in a row would fight the
primary action), category avatars (their solid fill is what carries the white
initial), or anything that moves or scrolls inside its own container. A surface
that is transformed is not glass: the mobile sidebar drawer is opaque
`--surface` while it slides, and takes the material at 768px where it sits
still. A tinted control inside a glass panel keeps the tint, edge and sheen but
drops the second blur (`.glass :is(...)`) — one frost per stack, so a chip on a
card costs nothing extra and a control in the top bar never re-blurs the bar's
own backdrop. `.trust-embedded .card` drops the blur and the sheen entirely.

An SVG shape cannot hold a backdrop filter, so the landing pipeline panel
frosts and its boxes take `--glass-bg` as a plain translucent fill on top.

### Fallbacks

- `@supports not (backdrop-filter: blur(1px))` (either prefix): the fill drops
to solid `--surface`, the sheen goes, and `--glass-under` becomes `--surface`
so every tinted fill turns into a solid tint on the surface.
- `prefers-reduced-transparency: reduce`: the same, plus `--glass-filter: none`
for the panels and the tinted controls.
- Text contrast does not change on glass: fill and border are mixed from
`--surface` and `--ink`, so the ratio between text and panel stays between the
`--surface` and `--bg` values already tested at 4.5:1. The one case that needed
more is a panel over a scrim, which takes `--glass-bg-dense`. A tinted fill does
change the surface under a label, so each tint ships its own readable label
token (`--accent-ink`, `--pos-ink`, `--neg-ink`, `--warn-ink`, `--muted`,
`--ink-2`). If a tinted element ever looks too pale behind its label, raise
`--tint-strength`; do not touch the text colour.

### Performance rule

Never put `backdrop-filter` on an element that animates, and never on `<html>`
or `<body>`. A blurred element is re-blurred whenever its backdrop paints, so
it stays on panels that do not move: no transition, no transform, no scroll
container of its own above it. That is why the tinted material carries no
`transition` and no `transform` on hover or press — the feedback is a colour
change and a brighter edge — and why the add sheet's sliding thumb was replaced
by a tinted button. The panels that fade in (palette, shortcut sheet) run their
fade on the dialog, which carries no filter. The route cross-fade snapshots the
painted page, so it does not cost a blur per frame.

## Typography

- **Display** (`--font-display`) is Instrument Serif 400 and only ever sets the
  landing H1 (`clamp(36px, 5vw, 56px)`, `letter-spacing: -0.01em`), the landing
  section numerals `01`–`05` and figure-strip numbers, page titles (`.v-title`,
  32px) and the headline Overview / This month figures. It never sets body copy,
  navigation, buttons or labels.
- **Text** (`--font`) is IBM Plex Sans: 400 body, 500 labels and emphasis, 600
  headings and buttons.
- **Mono** (`--mono`) is IBM Plex Mono 400/500, for code, keycaps and figures
  that must align character by character.
- Headings use tight tracking: display `-0.01em`, section headings `-0.01em`. No
  condensed or stretched cuts.
- Every amount uses `.num`, which sets `font-variant-numeric: tabular-nums`, so
  columns line up as values change. IBM Plex Sans has that feature; Instrument
  Serif ships proportional lining figures only, which is why display never sets
  a value that has to line up in a column.
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
  search and the primary action (`AppShell.tsx`, `styles/shell.css`). Under
  768px the sidebar becomes a drawer; at 768px and up it can collapse to a 56px
  icon rail with `[`. Every view is a URL under `/app/`. Keyboard: `⌘K`/Ctrl+K
  palette, `?` shortcut list, `N` new transaction, `G` then O/T/I/S/A to move.
  Sections that are not built yet render one shared `PlannedView`.

## Components

- **Buttons.** Primary is the accent at `--tint-accent` (92%) with
  `--accent-ink` text and 600 weight. Secondary is neutral tinted glass with a
  `color-mix` border; ghost is the same neutral tint (no separate transparent
  state — on glass the edge is what separates it). All three are the tinted
  glass material described under Glass: no transition, no transform; hover and
  press move the tint and the edge instead. Height is 32px compact, 36px
  comfortable; radius `--r2`. Disabled stays solid `--surface-3` with `--muted`.
- **Inputs.** `--surface` background, 1px `--line-strong` border, radius `--r2`,
  `--t-base` text, placeholder in `--faint`. Focus adds a 2px accent ring. Error
  state uses `--neg` for the border and `--neg-soft` behind the message.
- **Cards.** `--surface` background, 1px `--line` border, radius `--r3`. Use
  `--shadow` only where a card must separate from a same-tone panel. No heavy
  drop shadows. Cards that sit directly on the page take the glass material
  (see Glass) instead of a flat fill.
- **Tables and rows.** Row height `--row-h`, horizontal padding `--pad`,
  dividers in `--line`. Amounts right-aligned with `.num`. Header labels use the
  small all-caps style.
- **Chips.** Radius `--r1`, `--t-xs`, padding `4px 8px`. Neutral chips are
  neutral tinted glass with `--ink-2` text. State chips (`.pill-good`,
  `.pill-bad`, `.pill-warn`) take the state colour at `--tint-state` in the fill,
  keep a state-coloured border and use `--pos-ink`/`--neg-ink`/`--warn-ink` for
  the label. There is no longer a `--*-soft` flat fill behind a chip: the soft
  tints were the same idea in one flat colour.
- **Empty states.** One sentence in `--muted`, an optional outline button, and
  the `Planned · M#` label when the feature is not built. No illustration.
- **Planned labels.** `Planned · M#` in the small all-caps style, colour
  `--muted` on neutral tinted glass. They sit next to any control that does not
  work yet.

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

The emblem is an engine-turned (guilloché) watch dial: a bezel, a minute track
(60 ticks, every fifth longer) and a 30-circle rose-engine rosette around a
centre boss. `DIAL_SMALL` — 12 ticks, 12 heavier circles, a larger boss — is the
simplified cut for 24px and below. The geometry lives in `brand-dial.ts` (pure,
tested) and is rendered by `BrandMark.tsx`. It is drawn in `--brand-gold`
(`#a8874a` light, `#c8a96a` dark), the only gold in the product. The app icon is
the champagne dial on `#0f1012`.

## Stylesheets

All styles live in `assistant/src/web/app/styles/`: `tokens.css` (the only file
with colour literals), `base.css` (shared primitives), `components.css`
(sheets, toasts, loader, standalone pages), and one file per surface
(`shell`, `views`, `insights`, `ask`, `settings`, `palette`, `landing`,
`signin`, `footer`). The legacy `app.css` and its token aliases were removed in
M7b. Layout that depends on available width uses container queries on `.v-view`,
not viewport breakpoints, because the sidebar changes the content width.
