# Engineering Handoff: Production Revamp — Design, Settle Up Wedge, LLM Flood Guard

## Overview
Revamped the consumer app for production: quiet-luxury design system, a rail-agnostic
"Settle Up" wedge (request / split / settle on any rail), and an LLM guard that stops
repeats and budget overruns from flooding the Gemini API. Verified: 31 test files /
144 tests pass, `tsc --noEmit` clean, `vite build` clean, live smoke of the new
endpoint passed (settle → PAID + rail, double settle → 409, wrong actor → 403).

## Changes Completed

### 1. LLM flood guard (`assistant/src/server/llm-guard.ts`, wired into `app.ts /api/chat`)
- Answer cache: normalized question + conversation tail per account, 10 min TTL,
  400-entry eviction. Repeated questions cost zero model calls.
- In-flight coalescing: identical concurrent questions (double click, two tabs,
  StrictMode double effects) share one Gemini call.
- Daily budget: 40 calls/account/day and 300/day app-wide; over budget the
  deterministic `answerFromLedger` answers with `route: 'ledger-fallback'`.
- `trimHistory` caps the model payload at the newest 10 messages.
- Replies gain `cached?: true`; only cache misses are billed. Producer failures are
  not cached, so the next ask retries.
- Docs: `docs/AI-SCALE.md` (call path, layered throttles, scale-out plan via Redis/Upstash).

### 2. Settle Up wedge — rail-agnostic settlement
- **Server** (`payment-requests.ts`, `app.ts`): `settledVia` column
  (`zelle | cashapp | venmo | cash | crypto | other`) with idempotent migration
  (`alter table add column if not exists`), and `POST /api/requests/:id/settle` —
  the requester confirms outside payment; request closes `PAID` with the rail on the
  receipt and `transferId: null`. Requester-only (403), double-resolve safe (409).
- **Web** (`app/SettleUp.tsx`, `api.ts`): `SettleUpSheet` (Ask & split tab with peer
  picker and even-split preview; Settle tab with Pay-in-app / Decline and per-rail
  settlement chips), `NeedsYouCard` on Home (Pay / Decline inline, record-rail entry),
  quick action "Settle up" on the Home row. `splitShares` matches the server's
  `splitEvenly` (floor + leftover cents to first shares).

### 3. Design & UX revamp (`app.css`, `index.html`)
- New quiet-luxury token system: bone `#f4f1ea` / ink `#131211` / champagne
  `#d8b36a` (dark: `#0d0c0a` / `#f2ede3` / `#d2b074`), replacing the lime startup
  look; hairline rules, tighter radii (16/10), restrained shadows.
- Shell: monogram brand mark (hairline circle), letterspaced uppercase wordmark and
  nav tabs (underline active state), uppercase micro-caps footer with hairline rule,
  serif display headings (`h2` → Instrument Serif), DM Mono for request amounts.
- Money hero card retoned ink + champagne; quick-row auto-fits 5 tiles.
- `index.html`: title "Settle · the private money book", new description and theme
  colors matching the palette.

## Verification
- `npx vitest run`: 31 files, 144 tests (incl. new `test/llm-guard.test.ts`,
  `test/settle-up.test.ts`).
- `npm run build` (tsc + vite): clean; main app chunk 115 kB (31 kB gzip).
- Live smoke (`node --import tsx src/server/main.ts`, practice mode): demo seed,
  settle flow 200/409/403 as designed, `/api/chat` answers from ledger fallback with
  no LLM key — zero Gemini calls.

## Notes / next steps
- LlmGuard state is per-process; for strict budgets across instances, port the three
  maps to Redis/KV behind the same interface (keys already namespaced).
- A future Zelle/Cash App integration replaces `settledVia` recording with a real
  money movement at the same endpoint — no workflow change.
- Previous session context (perf work, PR #13) superseded by this revamp on main.