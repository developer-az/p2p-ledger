# Development setup

Everything you need to run, test, and ship **p2p-ledger** locally or against the hosted stack.

## Prerequisites

| Tool | Version | Used for |
|------|---------|----------|
| **Node.js** | **22+** (`assistant/package.json` `engines`) | Assistant UI, Hono BFF, Vitest |
| **npm** | 10+ (ships with Node) | `assistant` install, scripts |
| **Docker Desktop** | Current | `docker compose` — Postgres, Kafka, `ledger-service`, optional assistant image |
| **Java** | **21** | `ledger-service` (Spring Boot 4) |
| **Maven** | 3.9+ or `./mvnw` in `ledger-service/` | Ledger unit + integration tests |
| **Git** | Any recent | Clone, CI parity |

Optional:

| Tool | Purpose |
|------|---------|
| **GEMINI_API_KEY** | Primary chat ([Google AI Studio](https://aistudio.google.com/apikey)); free tier hits **429 / daily quota** quickly |
| **OPENROUTER_API_KEY** | [OpenRouter](https://openrouter.ai/keys) — set **with** `GEMINI_API_KEY` for automatic failover on 429; or `LLM_PROVIDER=openrouter` alone |
| **OPENROUTER_MODEL** | Slug from [openrouter.ai/models](https://openrouter.ai/models) — default `google/gemini-2.5-flash-lite` (older `google/gemini-2.0-flash-001` is auto-mapped) |
| **ANTHROPIC_API_KEY** | Set `LLM_PROVIDER=anthropic` instead of Gemini |
| **gh** | PRs, Actions, deployment hooks ([docs/GITHUB.md](GITHUB.md)) |
| **Terraform** | AWS SQS FIFO in `infra/aws/` (production events) |
| **k6** | Load tests in `loadtest/` |

Windows notes:

- Run Docker Desktop before `docker compose` or `npm run dev:stack`.
- Use `ledger-service\mvnw.cmd` if Maven is not on `PATH`.
- Line endings: repo uses LF; Git `core.autocrlf` as you prefer.

## Repository layout (dev focus)

```
p2p-ledger/
├── ledger-service/     # Java API (port 8080)
├── assistant/          # React terminal + Hono /api (Vite 5173 in dev)
├── docker-compose.yml  # Postgres + Kafka + ledger (+ assistant :8787)
└── docs/               # Architecture, API, screenshots
```

## Environment variables

Copy `assistant/.env.example` → `assistant/.env.local`:

```bash
cd assistant
cp .env.example .env.local
```

| Variable | Required | Description |
|----------|----------|-------------|
| `LEDGER_URL` | For live mode | Default `http://localhost:8080` when using Docker |
| `GEMINI_API_KEY` | Primary LLM | Optional if `OPENROUTER_API_KEY` is set |
| `OPENROUTER_API_KEY` | Backup / alternate LLM | Auto-failover when Gemini returns 429 |
| `LLM_PROVIDER` | No | `gemini` (default) or `anthropic` |
| `LLM_MODEL` | No | Default **`gemini-2.0-flash-lite`** (higher free-tier headroom than `flash-latest`) |
| `RESEND_API_KEY` | For password-reset email | [Resend](https://resend.com) API key. Without it (or `MAIL_FROM`), development prints the reset link to the server log and production sends nothing. |
| `MAIL_FROM` | For password-reset email | Sender on a domain verified in Resend, e.g. `Settle <no-reply@anthony-zhou.com>` |
| `APP_URL` | Recommended in production | Public origin used in emailed links, e.g. `https://ledger.anthony-zhou.com`. Falls back to the request's origin. |

Vercel production also needs `LEDGER_URL` pointing at your Render ledger URL, and `RESEND_API_KEY`, `MAIL_FROM` and `APP_URL` for password-reset emails.

### Password reset

Sign in → **Forgot password?** asks for an email and always answers the same way, whether or not an account uses it (no account enumeration; the response also takes a fixed minimum time). A known email gets a link to `/reset-password#token=…`. The token is 32 random bytes, stored only as a SHA-256 hash in `app_password_resets`, expires after 30 minutes, works once, and asking again cancels the previous link. A successful reset signs out every other session. The token lives in the URL fragment, so it never reaches server logs or `Referer` headers.

### Security headers

`src/server/security-headers.ts` is the single source: a page CSP (own scripts only, Google Fonts, no framing), HSTS, `nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy` and COOP. The API adds them to every response, the Node server adds them to the static site, and `vercel.json` repeats them for Vercel (a test keeps it in sync). The Vite dev server does not send the CSP.

## Run modes

### 1. Assistant only (practice ledger in memory)

No Docker. Good for UI and unit tests; **no** PostgreSQL persistence.

```bash
cd assistant && npm install
npm run dev          # from repo root, or from assistant/ — http://localhost:5173
```

### 2. Full stack (recommended for P2P + bank corridors)

PostgreSQL + Java ledger + terminal UI:

```bash
cd assistant && npm install
npm run dev:stack    # from repo root, or from assistant/ — docker compose up + Vite
```

Wait until `ledger` logs show the app healthy, then open **http://localhost:5173**.

### 3. Ledger only

```bash
docker compose up --build    # :8080 ledger, Postgres, Kafka
```

### 4. Production-like assistant image

```bash
docker compose up --build    # includes assistant on :8787 when enabled in compose
```

## Terminal workflow (local)

1. **F2 ONBOARD** — seeds Anthony/Sam/Jordan on live Postgres (`POST /api/demo`).
2. **Open wallet** — `open <handle>` or create handle; triggers **simulated bank welcome** (`POST /api/bank/welcome`: $500 deposit + inbound corridor peer).
3. **ACH IN / ACH OUT** or CMD `bank in` / `bank out` — each call spins up a **new** corridor counterparty (`payroll-*`, `vendor-*`, …), funds if needed, posts a real transfer, then they appear in **PEERS** (dormant history).
4. **F3** integrity — calls `GET /v1/ledger/integrity` on `ledger-service` (merge to `main` + Render deploy if production still shows the old banner).
5. **F4** race — parallel idempotency demo.
6. **AUDIT / MSG** — Gemini tools over your signed-in account (peers, balances, peer ledger).

## Tests & quality

```bash
# Assistant (74 tests — **no live LLM**; vitest clears API keys in test/setup.ts)
cd assistant && npm test && npm run build

# Ledger (needs Docker for integration tests)
cd ledger-service && ./mvnw verify
```

Smoke the BFF against a running ledger:

```bash
cd assistant && npm run smoke:api
```

Eval suite (**opt-in only** — consumes real API quota; never run in CI on push):

```bash
cd assistant && ALLOW_LIVE_LLM_EVAL=1 npm run eval
```

## Capturing README screenshots

After `npm run dev:stack` with the Bloomberg terminal branch:

1. Sign in via **F2 ONBOARD** or open a new handle.
2. Capture **WATCH** (balance + SIM BANK), **BLOTTER**, **PEERS** panel, and **CMD** line.
3. Save as `docs/images/terminal-watch.png`, `terminal-blotter.png`, `terminal-peers.png`, `terminal-audit.png`.
4. Update image paths in root `README.md`.

Until those PNGs are checked in, the README uses **Mermaid figures** for the same flows.

## API references

- Assistant routes: [API.md](API.md), `assistant/openapi.yaml`
- Ledger HTTP: [ARCHITECTURE.md](ARCHITECTURE.md)
- Deploy: [GITHUB.md](GITHUB.md)
