# API layers (this project)

You own **two** HTTP surfaces. They are not third-party SaaS — they live in this repository and deploy from your GitHub Actions pipelines.

## 1. `ledger-service` (Java) — system of record

Base URL: `LEDGER_URL` (local default `http://localhost:8080`).

| Method | Path | Role |
|--------|------|------|
| POST | `/v1/accounts` | Open account |
| GET | `/v1/accounts?ownerId=` | List by owner |
| GET | `/v1/accounts/{id}` | Balance + metadata |
| GET | `/v1/accounts/{id}/entries` | Statement |
| POST | `/v1/accounts/{id}/deposits` | Fund account |
| POST | `/v1/transfers` | P2P transfer (requires `Idempotency-Key`) |
| GET | `/v1/transfers/{id}` | Transfer detail |
| GET | `/v1/transfers?accountId=` | History |
| GET | `/actuator/health` | Health (used by keep-warm) |

Money is **integer cents** (`amountMinor`). Idempotency and fraud rules are enforced in Postgres.

Implementation: `ledger-service/src/main/java/...`

## 2. `assistant` (Hono) — app API + LLM tools

Base URL: same origin as the Vite UI in dev (`/api/*` via Vite plugin), or Vercel serverless in production.

This is the **integration API** for the React client: P2P actions, account views, and support chat without exposing LLM keys in the browser.

| Method | Path | Role |
|--------|------|------|
| GET | `/api/health` | Assistant up |
| GET | `/api/bootstrap` | Live ledger reachable + practice fixture metadata |
| GET | `/api/accounts?id=` | Account view (balance, 30d cashflow, activity) |
| GET | `/api/accounts?owner=` | Resolve accounts by handle |
| POST | `/api/accounts` | Create wallet |
| GET | `/api/peers?accountId=` | Payees for send UI |
| POST | `/api/accounts/{id}/deposits` | Deposit |
| POST | `/api/transfers` | Send money (proxies to ledger; practice in-memory when offline) |
| POST | `/api/demo` | Seed live demo world (needs Docker ledger) |
| GET | `/api/peers?accountId=` | Counterparties from transfer history |
| GET | `/api/peer-ledger?accountId=&peerAccountId=` | Bilateral activity with one peer |
| GET | `/api/integrity` | Balance audit snapshot (live or honest partial) |
| GET | `/api/bank/status` | Simulated ACH/corridor metadata |
| POST | `/api/bank/welcome` | Opening deposit + inbound corridor (`{ accountId }`) |
| POST | `/api/bank/inbound` | New inbound peer pays user (`{ accountId }`) |
| POST | `/api/bank/outbound` | User pays new vendor peer (`{ accountId }`) |
| POST | `/api/chat` | LLM support (tools bound to `accountId`) |

Implementation:

- Routes: `assistant/src/server/app.ts`
- Ledger client: `assistant/src/server/ledger.ts`
- Practice / composite ledger: `assistant/src/server/practice-ledger.ts`
- Simulated bank corridors: `assistant/src/server/bank-sim.ts`
- Tool schemas + account math: `assistant/src/server/tools.ts`
- Vercel entry: `assistant/api/index.ts` (one function; `vercel.json` rewrites `/api/*` → `/api/index`)

### Practice vs live

- **Practice** — in-process ledger in `PracticeLedger` (works with `npm run dev` only).
- **Live** — `CompositeLedger` forwards writes and reads to `ledger-service` when `LEDGER_URL` is healthy (`docker compose up` or Render).

## Extending

1. Add behavior in **ledger-service** if it changes money or invariants.
2. Expose it through **assistant** `/api` for the UI (and optionally a new LLM tool in `tools.ts`).
3. Add tests in `ledger-service` integration tests and `assistant/test/`.
4. Document new routes in this file.

OpenAPI for the assistant surface: `assistant/openapi.yaml`.

## Security

Public demo deployments have **no wallet login** — account UUIDs act like capability tokens. LLM keys and database passwords must not be committed; see [SECURITY.md](SECURITY.md).
