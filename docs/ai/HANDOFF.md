# Engineering Handoff (latest)

## Session: Stussy punch-card — finish the redesign (branch `cursor/stussy-punch-card-1265`)
- **Verdict on PR #15:** The punch-card metaphor was right; the cobalt / Bricolage override erased THE AURA (Stussy) house identity and left the redesign half-done.
- **Direction:** Keep porcelain / obsidian / chrome / gothic marque. Punch holes are the recurring habit mark on that system — not a café-blue rebrand.
- **Done:** Restored Instrument Sans/Serif + DM Mono + UnifrakturMaguntia; gothic `S` marque on brand, hero, preloader, welcome; float dock (no topbar tabs); obsidian hero with grid + marque watermark + `PunchRow`; single-hue ink `CategoryBars`; `punch-card.css` no longer rewrites tokens; welcome stage uses the product card as the visual; favicon is Aura + punches.
- **Verify:** `cd assistant && npm test && npm run build` (172 tests, clean build).

## Session: punch-card consumer redesign (PR branch `redesign/punch-card`)
- **Concept:** Café loyalty punch card — cobalt card stock (`#1f3fd1`), Bricolage Grotesque, week as `PunchRow`, single-hue `CategoryBars`, stamp animation on fresh logs, chad confetti.
- **Removed:** Stock photo marketing (`public/media/*`), Lottie, `MediaPhoto` / `visual-assets`.
- **Added:** `punch-card.css` (tokens + punch/streak/cat-bar/topbar), `CategoryBars.tsx`, `PunchRow` in `ui.tsx`.
- **Build:** `npm test` (172) + `npm run build` OK after category tile fix (no per-category color).
- **Superseded by:** Stussy punch-card finish above — cobalt token override and empty brand mark were the incomplete parts.

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
