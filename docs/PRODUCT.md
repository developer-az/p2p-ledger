# Product direction — ledger-first P2P

## Architecture (production path)

| Layer | Responsibility |
|--------|----------------|
| **ledger-service** | System of record: accounts, transfers, deposits, **ledger_entries**, fraud rules, idempotency, outbox |
| **assistant `/api`** | Public BFF + terminal UI; no shadow balances |
| **assistant UI** | Operator terminal: overview, **ledger statement**, send, activity, ask |

Practice mode mirrors stories in-memory; **live mode** is always PostgreSQL on Render.

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
