# Engineering Handoff: root `npm run dev` + UI/UX polish

## Root DX (latest)
- Added repo-root `package.json` with `dev` / `dev:stack` delegating to `assistant/` via `npm run … --prefix assistant` (no npm workspaces).
- Updated `AGENTS.md` with layout and dev commands.

---

# Engineering Handoff: UI/UX polish + hero income fix

## Overview
Addressed nine consumer-app UI/UX issues in `assistant/src/web/app` (THE AURA shell) plus a plain-terminal refresh for `/ops` (`TerminalApp` + `styles.css`). Net position on Today now follows `finance.projectedCash` so logged income updates the hero amount when a cash baseline exists.

Verified: `cd assistant && npm test && npm run build` — 37 files, 169 tests pass.

## Changes Completed

### 1. Hero card contrast (`app.css`)
- Gallery hero locked to obsidian (`#0c0c0b`) in all color schemes so `.hero-week` / `ProgressRing` on-dark text is never light-on-light.
- Explicit light text tokens for week title, mini stats, and chip copy.

### 2. Patterns peek hierarchy (`Home.tsx`, `app.css`)
- Live peek card uses category accent via `--peek-accent`, gradient fill, and pill legend chips.

### 3. Demo guide premium feel (`DemoGuide.tsx`, `app.css`)
- Metal rail, progress bar + step dots, typography/spacing/button treatment upgraded.

### 4. Topbar experience (`app.css`)
- Refined brand spacing, demo pill (ink + chrome halo), wallet chip depth, Ask control caps.

### 5. Log spend sheet (`app.css`)
- Framed amount hero, pressed quick-amount chips, dashed “Again?” block.

### 6. Hero amount / income bug (`money-plan.ts`, `money-plan.test.ts`)
- `netMinor` derives from `finance.projectedCash` (includes period income, optional spend subtraction) minus credit owed.

### 7. Demo Patterns navigation (`InsightsTab.tsx`, `ConsumerApp.tsx`)
- Sticky demo bar on Patterns; one-time smoke overlay with back-to-Today + show guide; sessionStorage dismiss.

### 8. Setup weekly pace chips (`SetupSheet.tsx`, `app.css`)
- Pace chips scale from cash balance (% of balance + suggestion); toggle renamed with contextual hint for projected cash.

### 9. Engineering console (`TerminalApp.tsx`, `styles.css`)
- Terminal-style top bar (green accent, lowercase labels), `← settle app` link to `/`.

## Notes / follow-ups
- Demo smoke uses `sessionStorage` key `settle:demo-patterns-smoke`; clear it in devtools to re-show the overlay.
- Income/spend sheets now call `ledger-store.run` via `ledger-mutations.ts` so hero, week ring, and patterns update before the refetch finishes.
