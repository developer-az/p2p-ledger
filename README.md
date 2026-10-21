# p2p-ledger

**Production-style peer-to-peer payments ledger with an LLM support layer** — double-entry money movement in Java, a TypeScript terminal and BFF, and deterministic evals over real account data.

<p align="center">
  <a href="https://p2p-ledger-pi.vercel.app"><strong>Live demo</strong></a>
  ·
  <a href="docs/API.md">API</a>
  ·
  <a href="docs/ARCHITECTURE.md">Architecture</a>
  ·
  <a href="docs/BRIEFING.md">Ops briefing</a>
</p>

<p align="center">
  <a href="https://github.com/developer-az/p2p-ledger/actions/workflows/ledger-ci.yml"><img src="https://github.com/developer-az/p2p-ledger/actions/workflows/ledger-ci.yml/badge.svg" alt="ledger CI"></a>
  <a href="https://github.com/developer-az/p2p-ledger/actions/workflows/assistant-ci.yml"><img src="https://github.com/developer-az/p2p-ledger/actions/workflows/assistant-ci.yml/badge.svg" alt="assistant CI"></a>
</p>

<p align="center">
  <img src="docs/images/settle-home.png" alt="Settle guided demo: progress card, net position, weekly pace, and patterns peek" width="640">
  <img src="docs/images/settle-habits-phone.png" alt="Settle on a phone: a weekly pace and spending patterns" width="220">
</p>
<p align="center"><sub><strong>Settle</strong>, the app on top of the ledger: a calm money snapshot, two-tap spend logging, weekly pace, and patterns from your own history. Demo only, no real money. The original terminal lives at <code>/ops</code>.</sub></p>

---

## Overview

| | |
|---|---|
| **Problem** | P2P money needs one source of truth: correct balances under concurrency, safe retries, auditable history, explainable declines. |
| **Approach** | `ledger-service` (Spring Boot + PostgreSQL) is the system of record. `assistant` is the product: a consumer **Settle** app with a money snapshot (cash, cards, weekly pace), **two-tap spend logging**, **Patterns** over the user's own history, **simulated bank corridors**, and read-only **LLM tools**. P2P endpoints remain in the API and `/ops`, but the consumer app is focused on spending habits. |
| **Scope** | End-to-end portfolio system: Docker, native-image CI, Render + Vercel deploy path, k6 load tests, integration tests. Not a licensed bank — [SECURITY.md](docs/SECURITY.md). |

## Live surfaces

| Surface | URL / config |
|---------|----------------|
| **Assistant** (UI + `/api`) | [p2p-ledger-pi.vercel.app](https://p2p-ledger-pi.vercel.app) |
| **Ledger API** | Render service → Vercel `LEDGER_URL` |

**Try it:** open the demo → **Start the guided demo** (or **F2 ONBOARD** in `/ops`; live Postgres when `LEDGER_URL` is set), or resume a saved wallet. In **Settle**, set cash, cards and a weekly pace once, then log a spend in two taps. **Patterns** turns those logs into an eight-week heatmap, category shifts, a weekday rhythm and a card-payoff planner. The original terminal lives at `/ops`; command line: `pay sam 10 lunch`, `bank in`, **F3** company audit. Setup: [DEVELOPMENT.md](docs/DEVELOPMENT.md) · Troubleshooting: [BRIEFING.md](docs/BRIEFING.md).

## The Settle experience

| Surface | What it answers |
|---------|-----------------|
| **Today** | What is my net position, what is left this week, what needs an answer (Settle Up), and what needs a log? |
| **Activity** | Every payment, logged spend and income — grouped by day, with a receipt on each payment. |
| **Patterns** | Where the money went, how this month is trending, which weekday is expensive, and how fast a card can reach zero. |
| **Ask** | Read-only questions about your records; the assistant cannot move money. |
| **Wallet** | Edit the snapshot, review logging stats, fund the demo ledger, download a statement and open the trust lab. |
| **Settle Up** | The wedge: request money or split a bill, then settle in-app **or on any rail** (Zelle, Cash App, Venmo, cash, crypto) with the rail recorded on the receipt. |

The design rules: **three numbers to start** (cash, card balance, weekly pace), **two taps to log** (amount + category, with recent repeats and undo), and **no mixing** between user logs and ledger transfers. Habit totals never pretend to be a bank feed.

**The demo is a guided tour, not a sandbox.** It seeds a believable personal history and a five-step progress card: set the baseline, log a spend, log income, open Patterns, adjust the weekly pace. Each step points at a real feature and the state updates as you go. A **Demo** pill reopens the guide; **Start my own wallet** leaves the tour.

**Your wallet is isolated from the demo.** Creating a wallet opens a new ledger account, funds it with a **$500 simulated deposit plus one inbound corridor** so the ledger is never empty, pre-fills the cash step from that balance, and starts with no spend logs, no demo household, and no demo progress. In live mode the wallet persists in PostgreSQL; in practice mode it lives in memory.


## Terminal UI

Three panes plus a fixed **CMD** bar:

| Pane | Purpose |
|------|---------|
| **WATCH** | **HABITS** (weekly logged spend, quick LOG), wallet balance, peers, **bank dock** (ACH IN/OUT, +DEP, export) |
| **BLOTTER** | Transfers; click a row to expand/collapse ledger detail |
| **AUDIT / MSG** | Company-wide integrity (F3) and AI Q&A via CMD |

Shortcuts: **F1** help · **F2** onboard · **F3** audit · **F4** idempotency race.

```mermaid
flowchart LR
  UI[Terminal UI] --> API[Hono /api]
  API --> PG[(PostgreSQL)]
  API --> LLM[Gemini / OpenRouter]
  subgraph ledger["ledger-service"]
    PG
  end
```

### Simulated bank (same ledger)

`bank-sim` models ACH-style flows without a second database: each corridor **opens a counterparty wallet**, posts deposits/transfers, then leaves the peer in **PEERS** as history. New wallets get **`/api/bank/welcome`** ($500 + one inbound corridor).

## System context

```mermaid
flowchart LR
  subgraph client["Browser"]
    UI[React]
  end
  subgraph vercel["assistant · Vercel"]
    API[Hono /api]
    LLM[Gemini / OpenRouter]
  end
  subgraph render["ledger-service · Render"]
    JVM[Spring Boot native]
  end
  subgraph data["Data & events"]
    PG[(PostgreSQL)]
    Q[[SQS / Kafka]]
  end
  UI --> API
  API --> JVM
  API --> LLM
  JVM --> PG
  JVM --> Q
```

| Component | Role | Stack |
|-----------|------|--------|
| **ledger-service** | Accounts, transfers, fraud, outbox | Java 21, Spring Boot 4, GraalVM native |
| **assistant** | UI, BFF, chat tools | React, Vite, Hono, TypeScript |
| **CI/CD** | Test, image, deploy | GitHub Actions, Render, Vercel |

Transfer path: idempotency → row locks (PK order) → fraud + balance → double-entry + outbox in one transaction. [ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start

Prerequisites: **Node 22+**, **Docker** (live ledger), **Java 21** + `./mvnw` (ledger tests). [DEVELOPMENT.md](docs/DEVELOPMENT.md).

```bash
# Practice UI only (in-memory ledger)
cd assistant && cp .env.example .env.local && npm install && npm run dev

# Live ledger + terminal (recommended)
cd assistant && npm run dev:stack

# Tests
cd ledger-service && ./mvnw verify
cd assistant && npm test && npm run build
```

Smoke the deployed app: `cd assistant && npm run smoke:api -- https://p2p-ledger-pi.vercel.app`

## Assistant API

Browser → **`/api/*` only**. Live traffic uses `ledger-service` when healthy; otherwise **practice** mode. Notable routes: `/api/peers`, `/api/peer-ledger`, `/api/bank/*`, `/api/demo` (live seed), `/api/demo/practice` (guided practice seed), `/api/chat` (read-only tools). OpenAPI: [assistant/openapi.yaml](assistant/openapi.yaml).

**Quality:** 80+ Vitest tests in CI; optional Gemini evals via Actions ([GITHUB.md](docs/GITHUB.md)).

## Deployment

```
GitHub Actions → tests → native image → GHCR → Render
Vercel (assistant/) → LEDGER_URL, GEMINI_API_KEY / OPENROUTER_*
PostgreSQL (Supabase) · SQS FIFO optional (infra/aws)
```

Checklist: [GITHUB.md](docs/GITHUB.md).

## Repository map

| Path | Contents |
|------|----------|
| `ledger-service/` | Java ledger, migrations, native build |
| `assistant/` | Terminal UI, Hono API, evals |
| `infra/aws/` | SQS, IAM, budget alarm |
| `loadtest/` | k6 |
| `docs/` | Architecture, API, briefing, images |

## Roadmap

- [x] Ledger core, fraud, outbox, native CI/CD
- [x] Terminal UI, bank sim, peers, LLM tools, evals
- [x] Ops briefing and README figures
- [ ] Owner prefix search (Java)
- [ ] OAuth / session-bound wallets
- [ ] On-chain attestation bridge (optional) — [P2P-SOLIDITY-AND-SCALE.md](docs/P2P-SOLIDITY-AND-SCALE.md)

## Engineering notes

Native image ~3.6s cold start vs ~144s JVM on 0.1 CPU (see [ARCHITECTURE.md](docs/ARCHITECTURE.md)). Load tests drove in-flight limits and GraalVM-native event-sink wiring. Metrics are reproducible from scripts in-repo.
