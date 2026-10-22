# Engineering Handoff (latest)

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
