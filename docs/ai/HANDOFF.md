# Engineering Handoff (latest)

## Session: "Pocket" redesign (Welcome hero, Settle card, Pip mascot, motion)
- **Why:** Owner feedback: the UI felt AI-made and mediocre. Brief asked for an expensive hero with Framer-style motion, Stussy/Perplexity energy for a younger technical audience, Apple Pay minimalism, Notion decluttering, and a lovable mascot (Meta Muse).
- **Tokens:** replaced the bullet-journal tokens in `app.css` (ink/paper/volt lime; Bricolage Grotesque + Geist + Geist Mono). Removed the stacked "THE AURA" override tail and dead rules (old hero, phone mock, play tiles, week card) using a brace-aware filter; one new "POCKET" layer at the bottom of `app.css`.
- **New:** `Pip.tsx` (mascot with moods derived from real numbers via `pipMood`), `motion-kit.tsx` (`TiltCard`, `CountUp`, `RevealWords`, `InView`). Added dependency `motion` (Framer Motion).
- **Welcome:** rewritten. Dark hero with its own nav, condensed headline, tilting Settle card, Pip, a lime tape marquee, a bento "how it works" made from UI fragments, a lime own-wallet block. Same demo/create logic.
- **Today:** Pip greeting with a mood line (tap Pip to log; Pip jumps after a log via `cheer={burst}`), the dark card hero (net, ring, week left, delta vs last week, habit dots), three quick actions, a Perplexity-style ask bar. Removed the duplicate week card, the purple ask card and the "Weekly goal" tile (the ring and "Set one" cover pace).
- **Removed:** stock photos (`public/media`), `MediaPhoto`, `visual-assets`, `LottieMark` and the unpkg dotLottie script (it was 403ing). Demo guide shows a big step number instead of a photo.
- **Verify:** `cd assistant && npm test && npm run build` (38 files / 172 tests pass). Checked desktop + 390px + dark mode with playwright-cli.
- **Open:** JS bundle grew by roughly the size of `motion` (index chunk ~279 kB, 87 kB gzip); `LazyMotion` could trim it. Inner tabs (Activity, Wallet, Ask) only got the token swap, not a layout pass.

---

## Session: Impeccable roll + bullet-journal full theme
- Ran `impeccable context` + `concept-seed --scope direction --mode operate` (seed `98d70fceba27c1ae`). Roll assigned transit pass; **pinned** bullet-journal (#1 grounded) per PRODUCT + owner — Operate-safe, keeps ring/photos/sheets.
- Replaced monochrome tokens end-to-end in `app.css` (paper dot grid, sage pen, Sora/Spectral). Signature: habit dots on Today hero + week card. `.impeccable/config.json` → `buildPath: code`. Surface brief v2 + `docs/DESIGN.md` updated.

## Session: revert half punch-card; restore Settle UI + DESIGN.md
- **User feedback:** Punch-card branch was unusable — old `app.css` + thin `punch-card.css` + removed photos = incoherent half redesign.
- **Root cause:** Unattended Impeccable concept roll (café punch card) + `frontend-design` “pick extreme” without `docs/DESIGN.md` pin; Operate UI swapped to `PunchRow` while Persuade imagery was deleted.
- **Fix:** Restored consumer app from `main` (MediaPhoto, visual-assets, media JPEGs, weekly ring Home, category colors, welcome phone preview). Added `docs/DESIGN.md` as the visual contract tied to `docs/PRODUCT.md`.
- **PR #15:** Branch `redesign/punch-card` should be updated with this revert or closed in favor of a future **full** redesign that replaces tokens end-to-end.

## Session: sheet backdrop dismiss vs text selection
- **Bug:** Setup weekly pace (and other `Sheet` modals) closed when triple-click / drag-select in inputs because the full `app-sheet-wrap` had `data-backdrop` and a naive dialog `onClick` treated release outside the panel as dismiss.
- **Fix:** `shouldDismissSheet()` in `sheet-dismiss.ts` — dismiss only when pointer down **and** up are outside `app-sheet-panel`; capture-phase `onPointerDownCapture` on `<dialog>`; removed wrap `data-backdrop`. Unit tests in `test/sheet-dismiss.test.ts`.
- **Audit:** All modals use shared `Sheet` (`SetupSheet`, `SimpleSheets`, `SettleUp`, `ActivitySheet`). Header menu uses `mousedown` + `contains(menuRef)` only (unchanged).

## Session: motion, preloader, playful copy
- Branded **AppPreloader** (~720ms) with S marque + ring; smooth scroll on `html`.
- Home **play tiles** (emoji + plain language), tappable week ring, staggered section entrance.
- Demo badge “Your quest”; log sheet title “What did you buy?”; FAB “I spent $”.
- `prefers-reduced-motion` disables decorative animation.

## Session: category colors, demo Patterns, spend→net, favicon

### Done
- **Category colors:** `categories.ts` uses distinct hex hues per spend category so Pattern peek donuts, Patterns legend, and Insights donut show multi-color segments.
- **Demo Patterns:** Removed dead `demo-smoke` CSS; Patterns demo bar is sticky with only “← Back to demo home” (no full-screen smoke).
- **Log spend lowers net:** Onboarding defaults `spendLogsAffectWallet: true`; step 3 copy clarifies weekly pace vs net formula; demo Alex seed sets `spendLogsAffectWallet: true`. Optimistic path in `ledger-mutations.ts` already respects `profile.spendLogsAffectWallet`.
- **Favicon:** Root cause was missing `public/` asset and no `<link rel="icon">` in `index.html`. Added `assistant/public/favicon.svg` and icon link; Vite serves it at `/favicon.svg` on dev (5173).

### Verify
`cd assistant && npm test && npm run build`

---

# Engineering Handoff: root `npm run dev` + UI/UX polish

## Root DX
- Added repo-root `package.json` with `dev` / `dev:stack` delegating to `assistant/` via `npm run … --prefix assistant` (no npm workspaces).
- Updated `AGENTS.md` with layout and dev commands.

## Prior UI/UX polish (summary)
- Hero contrast, Patterns peek, Demo guide, topbar, log spend sheet, `netMinor` from `projectedCash`, setup pace chips, `/ops` terminal refresh.
- Income/spend sheets use `ledger-store.run` via `ledger-mutations.ts`.
