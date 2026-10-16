# p2p-ledger

**A production-style peer-to-peer payments ledger with an LLM support layer** — double-entry money movement in Java, a TypeScript app API and UI, and deterministic evals over real account data.

<p align="center">
  <a href="https://p2p-ledger-pi.vercel.app"><strong>Live assistant</strong></a>
  ·
  <a href="docs/API.md">API reference</a>
  ·
  <a href="docs/ARCHITECTURE.md">Ledger deep-dive</a>
  ·
  <a href="docs/P2P-SOLIDITY-AND-SCALE.md">P2P &amp; on-chain</a>
</p>

<p align="center">
  <a href="https://github.com/developer-az/p2p-ledger/actions/workflows/ledger-ci.yml"><img src="https://github.com/developer-az/p2p-ledger/actions/workflows/ledger-ci.yml/badge.svg" alt="ledger CI"></a>
  <a href="https://github.com/developer-az/p2p-ledger/actions/workflows/assistant-ci.yml"><img src="https://github.com/developer-az/p2p-ledger/actions/workflows/assistant-ci.yml/badge.svg" alt="assistant CI"></a>
</p>

---

## Overview

**Problem.** Moving money between people needs a single source of truth: balances that stay correct under concurrency, safe retries, auditable history, and explainable declines — not ad hoc balances in an app server.

**Approach.** `ledger-service` implements that core as a Spring Boot service on PostgreSQL (idempotent transfers, row-level locking, fraud rules, transactional outbox). `assistant` is the product surface: a **terminal UI**, Hono `/api` BFF, **P2P peer lane**, **simulated bank corridors**, and read-only LLM tools bound to the signed-in wallet. Writes (send, deposit, bank flows) go through explicit HTTP routes that proxy the Java API.

**Scope.** This repo is an end-to-end system: Docker local stack, native-image CI, $0 deployment path (Render, Supabase, SQS via Terraform, Vercel for the UI), load tests, and property-style integration tests. It is a **demo / portfolio** deployment, not a regulated bank — see [docs/SECURITY.md](docs/SECURITY.md).

## Live demo

| Surface | URL |
|---|---|
| **Assistant (UI + `/api`)** | [p2p-ledger-pi.vercel.app](https://p2p-ledger-pi.vercel.app) |
| **Ledger API** | Your Render `LEDGER_URL` (set in Vercel env for live mode) |

Open the assistant → **F2 ONBOARD** seeds Alex / Sam / Jordan on PostgreSQL when `LEDGER_URL` is live, or use the in-memory practice ledger offline. Full setup: **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)**.

### Terminal UI (product surface)

The React app is a **Bloomberg-style ledger terminal**: ticker, **WATCH** (wallet + simulated bank), **BLOTTER**, **AUDIT/MSG** (Gemini tools), **CMD>** with **GO**, and **F1–F4** shortcuts.

```mermaid
flowchart TB
  subgraph watch["WATCH"]
    BAL[Balance · cashflow]
    BANK[SIM BANK · ACH IN / OUT]
    PEER[PEERS · pay shortcuts]
  end
  subgraph cmd["CMD"]
    PAY[pay sam 10 lunch]
    BIN[bank in · bank out]
    FN[F1 help · F2 onboard · F3 audit · F4 race]
  end
  watch --> PG[(PostgreSQL ledger)]
  cmd --> API["/api BFF"]
  API --> PG
```

### Simulated bank · corridor peers

There is no separate “bank database.” **`bank-sim`** models ACH-style traffic on the **same ledger**:

1. Each **inbound** or **outbound** flow **opens a new counterparty wallet** (`payroll-*`, `vendor-*`, `client-*`, …).
2. Inbound corridors **fund** that wallet, then **transfer** to you; outbound corridors **debit** you and credit the vendor wallet.
3. Counterparties **stay in PEERS** as dormant history (they “came,” settled, then go quiet — like real rails).
4. **New wallet** open runs **`POST /api/bank/welcome`**: $500 deposit plus one inbound corridor so balances are never empty.

```mermaid
sequenceDiagram
  participant U as Your wallet
  participant B as bank-sim
  participant P as payroll-abc123
  participant L as ledger-service
  U->>B: bank in (or welcome)
  B->>L: openAccount payroll-abc123
  B->>L: deposit → peer
  B->>L: transfer peer → U
  Note over P: Appears in PEERS until history ages out
```

### Figures & screenshots

| Asset | Description |
|-------|-------------|
| [docs/images/terminal-watch.png](docs/images/terminal-watch.png) | Terminal shell (offline / pre-sign-in) |
| [docs/images/terminal-blotter.png](docs/images/terminal-blotter.png) | *(optional)* BLOTTER after F2 ONBOARD |
| Legacy guided UI | [docs/images/assistant-signin.png](docs/images/assistant-signin.png) etc. — older screenshots |

<p align="center">
  <img src="docs/images/terminal-watch.png" alt="P2P ledger terminal" width="720">
</p>

See [docs/images/README.md](docs/images/README.md) for more capture steps after `npm run dev:stack`.

## System context

```mermaid
flowchart LR
  subgraph client["Browser"]
    UI[React UI]
  end
  subgraph vercel["assistant · Vercel"]
    API[Hono /api]
    LLM[Gemini / Claude]
  end
  subgraph render["ledger-service · Render"]
    JVM[Native Spring Boot]
  end
  subgraph data["Data & events"]
    PG[(Supabase Postgres)]
    Q[[SQS FIFO / Kafka]]
  end
  UI --> API
  API --> JVM
  API --> LLM
  JVM --> PG
  JVM --> Q
```

| Component | Role | Stack |
|---|---|---|
| **ledger-service** | System of record — accounts, transfers, fraud, outbox | Java 21, Spring Boot 4, PostgreSQL, GraalVM native, Kafka / SQS |
| **assistant** | App API, UI, support chat | React, Vite, Hono, TypeScript, Vitest |
| **CI/CD** | Test, native image → GHCR, deploy hooks | GitHub Actions, Render, Vercel |

Transfer path (simplified): idempotency check → lock accounts in PK order → fraud + balance → double-entry rows + outbox in one transaction. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start

Prerequisites: **Node 22+**, **Docker Desktop** (live ledger), **Java 21** + Maven/`mvnw` (ledger tests). Details: **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)**.

**Ledger only (Docker)**

```bash
docker compose up --build    # Postgres, Kafka, ledger :8080
```

**Full stack (ledger + assistant image)**

```bash
docker compose up --build    # adds assistant :8787 when configured
```

**Assistant dev (practice ledger, no Docker)**

```bash
cd assistant && cp .env.example .env.local   # optional GEMINI_API_KEY for AUDIT/MSG chat
npm install && npm run dev                   # UI :5173, /api embedded
```

**Assistant + live ledger (recommended)**

```bash
cd assistant && npm run dev:stack            # Docker ledger + Vite terminal
```

**Tests**

```bash
cd ledger-service && ./mvnw verify           # integration + concurrency (Docker)
cd assistant && npm test && npm run build      # 68 unit tests, no API key
```

## Assistant layer

The browser talks only to **`/api/*`**. That layer:

- Routes **live** traffic to `ledger-service` when `LEDGER_URL` is healthy.
- Falls back to an in-memory **practice** network for offline demos.
- **`GET /api/peers`** and **`GET /api/peer-ledger`** — bilateral P2P history for the terminal PEERS panel.
- **`/api/bank/*`** — simulated ACH corridors (ephemeral counterparties on the real ledger).
- Exposes **chat** with tools scoped to the session account (no send-money tool; P2P uses `POST /api/transfers` or CMD `pay …`).

OpenAPI: [assistant/openapi.yaml](assistant/openapi.yaml) · Integration map: [docs/API.md](docs/API.md) · Dev setup: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

**Quality**

- **Unit tests** — terminal commands, bank-sim, peer ledger, tools, practice ledger, HTTP API (CI gate).
- **Evals** — 8 deterministic cases over a fixture ledger; run locally or via **Actions → assistant eval (Gemini)** when free-tier quota allows ([docs/GITHUB.md](docs/GITHUB.md)).

## Deployment ($0)

```
GitHub Actions → tests → native image → GHCR → Render deploy hook
Render (native) → Supabase Postgres
               → AWS SQS FIFO (Terraform in infra/aws)
Vercel (assistant/) → LEDGER_URL + GEMINI_API_KEY
```

| Piece | Choice |
|---|---|
| Compute | Render free web service (native image, 0.1 CPU) |
| Database | Supabase Postgres (session pooler) |
| Events | SQS FIFO (`infra/aws`) or Kafka locally |
| UI | Vercel (`assistant/`, `api/index.ts` + `/api/*` rewrite) |
| Keep-warm | `keep-warm.yml` → `LEDGER_URL` / optional `ASSISTANT_URL` |

Setup checklist: [docs/GITHUB.md](docs/GITHUB.md) · Security model: [docs/SECURITY.md](docs/SECURITY.md).

## Repository map

| Path | Contents |
|---|---|
| `ledger-service/` | Java ledger, migrations, native build |
| `assistant/` | UI, Hono API, evals, Vercel config |
| `infra/aws/` | SQS, IAM, budget alarm |
| `loadtest/` | k6 transfer workload |
| `docs/` | Architecture, API, **DEVELOPMENT.md**, GitHub setup, screenshots |

## Engineering notes

- **Performance:** Native image ~3.6s startup vs ~144s JVM on 0.1 CPU; k6 tables in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **AI-assisted development:** Implementation and benchmarks were built with AI coding tools under author review; load tests exposed JVM OOM under virtual-thread burst; native smoke caught frozen `@ConditionalOnProperty` for event sinks. Metrics in docs are reproduced from scripts in-repo.

## Roadmap

- [x] Ledger core, fraud, outbox, CI, native deploy pipeline
- [x] Assistant: P2P UI, BFF API, tool-calling chat, evals
- [x] Terminal UI, simulated bank corridors, peer lane, documentation
- [ ] Refresh `docs/images/terminal-*.png` on Vercel after deploy
- [ ] OAuth and session-bound wallets for a non-demo deployment
