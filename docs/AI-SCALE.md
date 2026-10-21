# AI Layer: Cost, Overflow and Scale

How `/api/chat` decides what actually reaches Gemini (or any provider), and how
that holds up as the app grows.

## The call path

```
Browser → POST /api/chat
  0. Client debounce          260 ms + 600 ms once-guard  (app/debounce.ts, AskTab.tsx)
  1. IP rate limit            20 req/min, sliding window  (rate-limit.ts, app.ts)
  2. History trim             last 10 messages    (llm-guard.ts, trimHistory)
  3. LlmGuard
     ├─ answer cache          same question, <10 min → free
     ├─ in-flight coalescing  identical concurrent asks share one model call
     └─ daily budget          40/account/day, 300/day app-wide
  4. Provider chain           Gemini → OpenRouter  (providers/fallback-chain.ts)
  5. Deterministic fallback   ledger tools answer when the model can't
```

The overflow problem this solves: a double-clicked question, a refreshed page or a
"what's my balance?" asked three times used to each cost a full Gemini round-trip
(tool loop included — up to 6 model steps per question). Now the browser collapses
the burst before it sends, repeats are answered from memory, and identical
concurrent asks fuse into one call. When the daily budget is spent, answers come
from `fallback.ts` (ledger tools, no model) instead of burning quota into 429s.

Rate-limiting is deliberately layered, cheapest first:

| Layer | Scope | Protects against |
|---|---|---|
| `debounce` + `useOnceGuard` | per browser | duplicate requests ever being sent |
| `rateLimiter(20, 60s)` — sliding window | per IP | one noisy visitor; returns `Retry-After` |
| LlmGuard cache + coalescing | per instance | duplicate work that got through |
| LlmGuard daily budget | per account / app | quota burn across visitors |
| `GEMINI_MIN_INTERVAL_MS` | per provider | free-tier 5 req/min pacing |
| Fallback chain + ledger fallback | per request | any provider outage |

The IP limiter is a **sliding-window log**, not a fixed counter, so a burst either
side of a window boundary cannot double the allowance. It keeps at most `limit`
timestamps per key, so memory is bounded by traffic shape, not volume; idle keys are
evicted past `maxKeys` (20 000). A refused request returns `429` with `Retry-After`
in seconds — see `rate-limit.ts`.

Configuration: `LLM_DAILY_LIMIT` (default 300), `LLM_ACCOUNT_DAILY_LIMIT`
(default 40), `LLM_CACHE_TTL_MS` (default 600000) — see `llm-guard.ts`.

## Scaling notes

* **Single Node process (today):** the guard state lives in memory. Cache, budget
  counters and in-flight promises are all per-process, which is exactly right for
  the current Render/Vercel deployment shape.
* **Serverless / many warm instances:** each instance sheds its own repeats, which
  still cuts the worst traffic (double-submits land on the same warm lambda). For
  strict budgets, move the three maps behind the same interface to Redis or Upstash
  (keys are already namespaced: cache key `account|conversation-tail`, counters
  `app:YYYY-MM-DD` and `acct:id:YYYY-MM-DD`).
* **Token cost:** `trimHistory` caps the payload; tool outputs are structured and
  small; the system prompt is static per account. A question costs at most
  `MAX_STEPS` (6) model turns.
* **Model routing:** primary is Gemini flash-lite; on 429 the chain moves to
  OpenRouter (`OPENROUTER_FALLBACK_MODEL`). 429 fails fast on purpose — retrying
  into a quota wall wastes the quota that remains.
* **What never touches the model:** the deterministic `answerFromLedger` path
  (config errors, budget exhaustion, provider failures). It answers balance,
  activity, decline reasons and spend totals from the same read-only tools the
  model would have called.

## The wedge: rail-agnostic settlement

`payment_requests` is the product's middle layer between payment apps and
budgeting apps: request, split, and settle on **any** rail. `POST
/api/requests/:id/settle` records `settledVia` (zelle | cashapp | venmo | cash |
crypto | other) with no bank integration required. When a rail later offers real
APIs, the same endpoint swaps the note for a money movement — the workflow,
schema and UI stay put.
