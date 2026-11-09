# PLAN — profile chip contrast, demo Settle Up pay/decline, Settle Up redesign

## Context pack (all briefs and the review prompt draw from this)
- Repo: polyglot monorepo. Node app in `assistant/` (React 19 + Vite + Hono BFF, TypeScript strict, Vitest). Java ledger in `ledger-service/` (not touched here).
- Commands (run from `assistant/`): typecheck `npx tsc --noEmit`; targeted tests `npx vitest run test/<file>.test.ts`; full suite `npx vitest run` (once, at the end); build `npx vite build`; dev server `npx vite --port 5199`.
- Key files:
  - `src/web/app/ConsumerApp.tsx`: signed-in topbar with `.wallet-chip` profile button and `.menu` dropdown.
  - `src/web/app/app.css`: all app styles. Tokens on `.app`: `--ink`, `--muted`, `--faint`, `--line`, `--line-strong`, `--surface`, `--surface-2`, `--surface-3`, `--lime` (#c8f53b), `--display`, `--ease-out`; dark mode is a `@media (prefers-color-scheme: dark)` block that redefines the tokens.
  - `src/web/app/SettleUp.tsx`: `SettleUpSheet` (tabs "Ask & split" / "Settle · N"), `NeedsYouCard` (Today card), `useRequests`, `splitShares`, `railBadge`.
  - `src/web/api.ts`: `api.listRequests`, `api.payRequest(id, accountId)`, `api.declineRequest(id, accountId)`, record-rail call.
  - `src/server/app.ts`: `seedPracticeRequests()` (~line 638), `GET /requests`, `POST /requests/:id/pay` (~676), `/decline`, `findRequest`.
  - `src/server/payment-requests.ts`: `InMemoryPaymentRequestStore` (`create` uses `randomUUID()`).
  - `src/server/practice-ledger.ts`: `PRACTICE_ANTHONY`, `PRACTICE_SAM`, `PRACTICE_JORDAN` ids.
  - Tests: `test/payment-requests.test.ts`, `test/settle-up.test.ts`, `test/app.test.ts`.
- Conventions: plain active copy, no buzzwords; respect `prefers-reduced-motion`; visible `:focus-visible`; 44px tap targets on mobile; no new dependencies; do not commit.

## Root causes (verified)
1. Dark mode: `.wallet-chip` got a hardcoded `rgb(255 255 255 / 80%)` background while its text uses the dark-mode `--ink` (near white), so it reads white on light grey.
2. Demo Settle Up: practice requests are seeded into each serverless instance's memory with random UUIDs. On Vercel, the list and the pay/decline call land on different instances (production GET returned different ids on consecutive calls), so pay/decline gets "Request not found"; a later refresh can also show an already-paid request as open again.

## Steps
1. **Chip + menu contrast.** Token-based chip/menu colours that work in light and dark (and hover/open states). DONE WHEN: tsc passes; light + dark screenshots read clearly.
2. **Stateless demo requests.** Deterministic ids for the three seeded practice requests; pay/decline/record seed on demand before lookup; resolving an already-resolved practice request is idempotent; client keeps a per-session overlay of resolved practice request ids so a refresh from another instance cannot resurrect them. DONE WHEN: targeted tests (app, payment-requests, settle-up) + tsc pass, including a test that pays a practice request on a fresh app instance that never listed it.
3. **Settle Up redesign.** Visual balance summary, person-centric request cards, clearer primary actions with confirm + undo-free feedback, better Ask & split flow with live split preview; NeedsYouCard matches. DONE WHEN: tsc + settle-up tests pass; light/dark/mobile screenshots reviewed.
4. Full suite once, then one Codex review with the diff baked into the prompt → VERDICT: PASS.
