# Product direction — habits + ledger-first P2P

## What we are building

A **spending-habits** product on top of the existing ledger stack:

| Layer | Role |
|--------|------|
| **User logs (`spend_logs`)** | What the user chooses to track — no bank link, no automatic feed |
| **ledger-service** | Exact money: P2P transfers, deposits, fraud, double-entry |
| **assistant `/api` + terminal** | BFF, habits UI in WATCH, CMD `log 15 groceries`, read-only LLM tools |

Habit totals never mix with ledger transfers in one number — the copilot uses **`summarize_spending`** for logs and **`summarize_activity` / `peer_ledger`** for settle-ups.

## Architecture (production path)

| Layer | Responsibility |
|--------|----------------|
| **ledger-service** | System of record: accounts, transfers, deposits, **ledger_entries**, fraud rules, idempotency, outbox |
| **assistant `/api`** | Public BFF + terminal UI; **spend_logs** table when `LEDGER_DATABASE_URL` / `DATABASE_URL` is set |
| **assistant UI** | Terminal: **HABITS** in WATCH, BLOTTER for ledger, AUDIT/MSG, CMD |

Practice mode mirrors ledger stories in-memory; **live mode** is PostgreSQL on Render. Habit logs persist in Postgres when the assistant has the same DB URL as the ledger (auto-migrated `spend_logs`).

**P2P vs blockchain:** Counterparty payments are P2P; custody is centralized in Java/Postgres. See **[P2P-SOLIDITY-AND-SCALE.md](P2P-SOLIDITY-AND-SCALE.md)**.

## Habits API (BFF)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/accounts?id=` | Account view includes `habits` (weekly story + 30d summary) |
| `GET` | `/api/accounts/:id/habits` | Habits only |
| `POST` | `/api/accounts/:id/spends` | Log spend `{ amountMinor, category, note? }` |

Categories: `dining`, `groceries`, `transport`, `entertainment`, `housing`, `shopping`, `health`, `other`.

SQL migration: [`assistant/sql/V1__spend_logs.sql`](../assistant/sql/V1__spend_logs.sql) (also applied automatically by the BFF when using Postgres).

## Visual intro (pre-sign-in)

- Scene-based walkthrough with suited 8-bit personas (Alex, Sam, Jordan) — **not** a WASD game.
- **Skip** or finish stores `p2p-ledger:story-complete` in `localStorage`; sign-in shows immediately on return.
- **Replay visual intro** on the sign-in screen clears that flag for one session.
- Story does **not** call the API; charts on **Overview** use real account + entries after sign-in.

## Live send (today)

1. **Seed live household** on sign-in → alex-/sam-/jordan-* wallets with history and peers.
2. **Create wallet** → deposit works; send needs a **live** recipient (history or **resolve owner id**).
3. **Practice [1][2][3]** → full P2P without Java.
4. **Log habits** → WATCH panel or `log 12 dining coffee`.

## Roadmap (showcase → production)

1. **Contacts / owner search** — prefix query on `owner_id` in Java (today: exact match).
2. **Transfer detail** — `GET /api/transfers/:id` in BFF + deep links from activity.
3. **Statement pagination** — `before` cursor on entries (API already supports it).
4. **Multi-currency** — funding accounts per currency in schema; UI currency picker.
5. **Auth + session-bound wallets** — OAuth; rate limits already per IP on writes.
6. **Observability** — surface actuator health/metrics in an ops pane; outbox lag.
7. **Habit spaces** — shared trips/roommates with optional ledger settle-up button.

Run **`npm run smoke:api -- https://your-app.vercel.app`** after every deploy.

## Gemini / Ask tab

- Set **`GEMINI_API_KEY`** on Vercel (and locally in `.env.local`) for full LLM answers.
- Bootstrap reports `chat.configured` — when false, Ask still works via **read-only tools** (habits + ledger).
- **OpenRouter** — `LLM_PROVIDER=openrouter` with `OPENROUTER_API_KEY` (see [DEVELOPMENT.md](DEVELOPMENT.md)); Anthropic via `LLM_PROVIDER=anthropic`.

## Why live “didn’t save”

| Symptom | Cause |
|---------|--------|
| Refresh loses wallet | Practice mode or ledger was **offline** when you clicked create — account lived only in that server instance. |
| Data gone after deploy | Practice is ephemeral; **live** wallets are UUIDs in PostgreSQL — use **saved wallets** or `?id=` in the URL. |
| Habit logs missing on Vercel | Set **`LEDGER_DATABASE_URL`** (or `DATABASE_URL`) on the assistant so `spend_logs` uses Postgres; otherwise logs are in-memory per instance. |
| Send failed | Live wallet paying a **practice** UUID (fixed) — use live seed or owner-id resolve. |
