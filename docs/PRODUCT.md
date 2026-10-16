# Product direction — ledger-first P2P

## Architecture (production path)

| Layer | Responsibility |
|--------|----------------|
| **ledger-service** | System of record: accounts, transfers, deposits, **ledger_entries**, fraud rules, idempotency, outbox |
| **assistant `/api`** | Public BFF + terminal UI; no shadow balances |
| **assistant UI** | **Guided intro** (pipeline diorama) + **operations dashboard**: reconciliation, payment trail, replay/retry-storm, tamper checks, analytics charts |

Practice mode mirrors stories in-memory; **live mode** is always PostgreSQL on Render.

## Unified experience (PR #1 + guided story)

- Pre-sign-in **guided intro** walks the ledger pipeline (idempotency → lock → fraud → double-entry → outbox). Skip stores `p2p-ledger:story-complete`.
- Signed-in **dashboard** proves P2P: each payment opens `GET /api/trail`, live **PipelineStage** animation, and Postgres-backed replay/tamper when `ledger.auditCapabilities` is true.
- Bootstrap exposes **auditCapabilities**; UI shows **Full live proof** vs **Partial** until Render deploys ledger-service audit endpoints from this branch.
- After merge: redeploy **ledger-service on Render**, confirm Vercel `LEDGER_URL`, run `npm run smoke:api -- <preview-url>`.

## Live send (today)

1. **Seed live household** on sign-in → alex-/sam-/jordan-* wallets with history and peers.
2. **Create wallet** → deposit works; send needs a **live** recipient (history or **resolve owner id**).
3. **Practice [1][2][3]** → full P2P without Java.

## Roadmap (showcase → production)

1. **Contacts / owner search** — prefix query on `owner_id` in Java (today: exact match).
2. **Transfer detail** — `GET /api/transfers/:id` in BFF + deep links from activity.
3. **Statement pagination** — `before` cursor on entries (API already supports it).
4. **Multi-currency** — funding accounts per currency in schema; UI currency picker.
5. **Auth + session-bound wallets** — OAuth; rate limits already per IP on writes.
6. **Observability** — surface actuator health/metrics in an ops pane; outbox lag.

Run **`npm run smoke:api -- https://your-app.vercel.app`** after every deploy.

## Gemini / Ask tab

- Set **`GEMINI_API_KEY`** on Vercel (and locally in `.env.local`) for full LLM answers.
- Bootstrap reports `chat.configured` — when false, Ask still works via **read-only ledger tools** (spending totals, declines, memos).
- OpenRouter is not integrated yet; Anthropic is available via `LLM_PROVIDER=anthropic`.

## Why live “didn’t save”

| Symptom | Cause |
|---------|--------|
| Refresh loses wallet | Practice mode or ledger was **offline** when you clicked create — account lived only in that server instance. |
| Data gone after deploy | Practice is ephemeral; **live** wallets are UUIDs in PostgreSQL — use **saved wallets** or `?id=` in the URL. |
| Send failed | Live wallet paying a **practice** UUID (fixed) — use live seed or owner-id resolve. |
