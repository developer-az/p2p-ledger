# Product direction — Settle (consumer app) on a ledger-first core

**Settle** is the user-facing app (`/`): a calm money snapshot, two-tap spend logging, patterns from your own history, send, split, request, and a receipt for every payment. The original terminal is the engineering console at `/ops`.

## The Settle experience (current)

| Surface | Job | Rules |
|---------|-----|-------|
| **Today** | Net position (cash − cards), what is left of the weekly pace, requests that need an answer, recent activity | One glance; one next action |
| **Activity** | Unified timeline of ledger payments, logged spends and logged income | Day totals; receipt on every ledger row; undo on a logged spend |
| **Patterns** | Eight-week heatmap, 30-day categories, weekday rhythm, month projection, card-payoff planner, milestones | Only from what the person logged; never mixed with ledger totals |
| **Ask** | Read-only questions about the wallet and habits | No money movement; tools scoped to one wallet |
| **Wallet** | Edit cash/cards/weekly pace, Settle wallet actions, friends, requests, statement, trust lab | The ledger wallet and the personal snapshot stay separate |

**Onboarding** asks three numbers once — cash, card balance, a weekly pace — in a 30-second sheet. It is editable, skippable, and never a bank login. **Logging** is amount + category with recent-repeat chips and an undo toast. A daily streak, weekly ring, and small milestones give the habit a game-like rhythm without turning money into a slot machine.

## Guided demo vs. personal wallet

| | Guided demo | Personal wallet |
|---|---|---|
| Entry | **Start the guided demo** | **Create my wallet** |
| Data | Seeded household + personal history for Alex, Sam, Jordan | New ledger account, no spend logs, no demo household |
| First money | Existing demo balances/transfers | **$500 simulated deposit + one inbound corridor** so send/split/request work immediately |
| Guidance | Five-step card: baseline → log → split → pay → receipt; **Demo** pill reopens it | Normal first-run setup; cash prefilled from the funded Settle wallet |
| Isolation | `spend_logs`, `money_profiles`, requests and progress keyed by demo account ids | Keyed by the new account id; demo data never enters it |
| Persistence | Practice: memory; live: Postgres | Live: Postgres; practice: memory until restart |

The demo is deliberately instructive: it has a believable history, a real declined payment, open requests, and a progress card that points at the feature each step proves. The personal wallet is deliberately clean: funded, with a first peer, but no demo story.

What actually runs, with no pretence:

- Payments, deposits, declines and balances are real double-entry ledger operations (Postgres, append-only, idempotent).
- A payment request is a row in `payment_requests`. Paying it is one ledger transfer with key `request-<id>-<declinedAttempts>`, so a double click moves money once and a retry after a decline uses a fresh key.
- Splitting a bill creates one request per friend; shares always sum to the total.
- Demo only: no authentication (a wallet id acts as the key), no real money, hosted event sink is `log`.

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
| `GET` | `/api/accounts?id=` | Account view includes `habits`, `patterns`, `finance` and `moneyProfile` |
| `GET` | `/api/accounts/:id/habits` | Habits only |
| `POST` | `/api/accounts/:id/spends` | Log spend `{ amountMinor, category, note? }` |
| `DELETE` | `/api/accounts/:id/spends/:spendId` | Undo a manual spend log |
| `PATCH` | `/api/accounts/:id/finance` | Cash, card balance, weekly pace, or whether new logs reduce cash |
| `POST` | `/api/accounts/:id/incomes` | Log income `{ amountMinor, source, note? }` |

`patterns` is derived server-side from the person's own logs: 56 daily buckets, 30-day vs previous-30-day categories, weekday averages, current/longest streak, calendar-week pace, month projection and biggest day. The client never has to reconstruct the story from a paginated feed.

Categories: `dining`, `groceries`, `transport`, `entertainment`, `housing`, `shopping`, `health`, `other`.

SQL migration: [`assistant/sql/V1__spend_logs.sql`](../assistant/sql/V1__spend_logs.sql) (also applied automatically by the BFF when using Postgres).

## Welcome (pre-sign-in)

- A single editorial hero with a live product mock, a **Try the demo** action and a **See how it works** anchor.
- No story gate, no WASD, no extra clicks. Saved wallets on this device appear as **Welcome back**.
- The mock is illustrative only; real numbers come from the account view after sign-in.

## Live send (today)

1. **Seed live household** on sign-in → alex-/sam-/jordan-* wallets with history, personal demo logs and peers.
2. **Create wallet** → opens a fresh ledger account, funds a **$500 welcome deposit + inbound corridor**, pre-fills the cash step, and keeps demo data out.
3. **Practice mode** → full P2P without Java; created wallets live in memory until restart.
4. **Log habits** → the two-tap sheet on Today, or `log 12 dining coffee` in the ops console.

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
