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
| **GEMINI_API_KEY** | AUDIT/MSG chat with tool-calling ([Google AI Studio](https://aistudio.google.com/apikey)) |
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
| `GEMINI_API_KEY` | For LLM chat | Without it, chat uses read-only tool fallback |
| `LLM_PROVIDER` | No | `gemini` (default) or `anthropic` |
| `LLM_MODEL` | No | Override default model id |

Vercel production also needs `LEDGER_URL` pointing at your Render ledger URL.

## Run modes

### 1. Assistant only (practice ledger in memory)

No Docker. Good for UI and unit tests; **no** PostgreSQL persistence.

```bash
cd assistant
npm install
npm run dev          # http://localhost:5173 — Vite proxies /api to embedded server
```

### 2. Full stack (recommended for P2P + bank corridors)

PostgreSQL + Java ledger + terminal UI:

```bash
cd assistant
npm install
npm run dev:stack    # docker compose up + Vite
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

1. **F2 ONBOARD** — seeds Alex/Sam/Jordan on live Postgres (`POST /api/demo`).
2. **Open wallet** — `open <handle>` or create handle; triggers **simulated bank welcome** (`POST /api/bank/welcome`: $500 deposit + inbound corridor peer).
3. **ACH IN / ACH OUT** or CMD `bank in` / `bank out` — each call spins up a **new** corridor counterparty (`payroll-*`, `vendor-*`, …), funds if needed, posts a real transfer, then they appear in **PEERS** (dormant history).
4. **F3** integrity — honest banner if company-wide audit API is not deployed.
5. **F4** race — parallel idempotency demo.
6. **AUDIT / MSG** — Gemini tools over your signed-in account (peers, balances, peer ledger).

## Tests & quality

```bash
# Assistant (68 tests, no API key)
cd assistant && npm test && npm run build

# Ledger (needs Docker for integration tests)
cd ledger-service && ./mvnw verify
```

Smoke the BFF against a running ledger:

```bash
cd assistant && npm run smoke:api
```

Eval suite (optional, uses Gemini quota):

```bash
cd assistant && npm run eval
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
