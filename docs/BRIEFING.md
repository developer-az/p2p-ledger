# p2p-ledger — ops briefing

Short reference for troubleshooting the live app and what to do after merges.

## Stack

| Piece | Where | Code |
|-------|--------|------|
| Terminal UI + `/api` | Vercel | `assistant/` |
| Ledger (money truth) | Render (`LEDGER_URL`) | `ledger-service/` |
| Database | PostgreSQL | Render / optional Supabase for audit fallback |
| Chat | Gemini and/or OpenRouter (Vercel env) | `assistant/src/server/providers/` |

Live demo: [p2p-ledger-pi.vercel.app](https://p2p-ledger-pi.vercel.app)

## Quick troubleshoot

1. **Offline / no live wallets** — Check Vercel `LEDGER_URL` and `GET {LEDGER_URL}/actuator/health`.
2. **AUDIT PENDING** — Deploy ledger with `GET /v1/ledger/integrity`, or set `LEDGER_DATABASE_URL` on Vercel.
3. **Chat errors** — `OPENROUTER_MODEL` must be a current slug ([openrouter.ai/models](https://openrouter.ai/models)); default in code: `google/gemini-2.5-flash-lite`. Trim whitespace on `LLM_PROVIDER`.
4. **UI feels broken** — CMD bar and WATCH bank dock should stay visible; each column scrolls on its own.

```bash
cd assistant && npm test && npm run smoke:api -- https://p2p-ledger-pi.vercel.app
```

## After a PR merges to `main`

Vercel redeploys the assistant; **Render only redeploys when ledger CI runs** (`ledger-service/` or `infra/` changes). Merged ≠ live until you smoke-test: F2 ONBOARD → bank dock → chat → F3 audit → blotter.

Recent merges: [#2](https://github.com/developer-az/p2p-ledger/pull/2) (terminal / guided UX), [#4](https://github.com/developer-az/p2p-ledger/pull/4) (OpenRouter + terminal polish).

## What’s next

See [PRODUCT.md](PRODUCT.md): peer/owner search, transfer deep links, statement pagination, auth-bound wallets, ops metrics.

More detail: [DEVELOPMENT.md](DEVELOPMENT.md), [GITHUB.md](GITHUB.md).
