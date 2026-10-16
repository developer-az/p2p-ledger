# GitHub integration

This repo is designed to run as **your** stack: Java ledger (source of truth) + TypeScript assistant (UI + `/api` BFF). GitHub Actions builds, deploys, and keeps production awake.

## Required configuration

| Name | Type | Purpose |
|------|------|---------|
| `LEDGER_URL` | **Variable** | Public URL of the Render ledger, e.g. `https://p2p-ledger.onrender.com` (no trailing slash). Used by **keep-warm** and Vercel. Not a secret. |
| `RENDER_DEPLOY_HOOK_URL` | **Secret** | Render deploy hook from the dashboard. CI calls it after pushing the native image to GHCR. |

## Recommended

| Name | Type | Purpose |
|------|------|---------|
| `ASSISTANT_URL` | **Variable** | Vercel (or other) deployment of `assistant/`. Keep-warm pings `/api/health`; **assistant CI** runs `npm run smoke:api` when this is set. |
| `GEMINI_API_KEY` | **Secret** | Vercel chat + optional **assistant eval (Gemini)** workflow (manual only; not run on every push). |
| `LLM_MODEL` | **Variable** (Vercel) | Optional; default in code is **`gemini-2.0-flash-lite`** (lighter free-tier usage than `flash-latest`). |
| `OPENROUTER_API_KEY` | **Secret** (Vercel) | Optional backup when Gemini returns 429 (auto-failover if both keys set). |

**Quota note:** `assistant-ci.yml` does **not** call Gemini. Daily limits are usually Vercel traffic or manually running **assistant eval (Gemini)** — keep eval manual and use `gemini-2.0-flash-lite` or OpenRouter.

**F3 integrity:** After merging `ledger-service` changes to `main`, `ledger-ci` rebuilds the native image and hits **Render** — then `GET /v1/ledger/integrity` works for the assistant F3 panel.

### Set `LEDGER_URL`

1. Open the repo on GitHub → **Settings** → **Secrets and variables** → **Actions**.
2. **Variables** → **New repository variable**
3. Name: `LEDGER_URL`, Value: your Render service URL (no trailing slash).

If keep-warm was **skipped** before, it was because this variable was empty. The workflow now **fails with a clear error** until `LEDGER_URL` is set.

### Test keep-warm manually

**Actions** → **keep-warm** → **Run workflow**. Optionally pass override URLs.

## Workflows

| Workflow | Triggers | What it does |
|----------|----------|----------------|
| `ledger-ci.yml` | `ledger-service/`, `infra/` | Tests, Terraform validate, native build, GHCR push, Render deploy |
| `assistant-ci.yml` | `assistant/` | Typecheck, unit tests, Vite build |
| `assistant-eval.yml` | Manual | Real-model evals when Gemini quota allows (workflow_dispatch) |
| `keep-warm.yml` | Cron every 10 min | `GET {LEDGER_URL}/actuator/health`, optional assistant health |

## Forks

Forks without secrets skip Render deploy by design. Keep-warm still needs `LEDGER_URL` if you want cron pings for **your** deployment.

### Run Gemini evals (free tier)

Push/PR **assistant CI** does not call Gemini (daily quota is too small to burn on every commit). When quota has reset:

1. **Actions** → **assistant eval (Gemini)** → **Run workflow**
2. Leave `case_ids` empty for the default 4-case smoke, or run all 8 locally: `cd assistant && TRIALS=1 npm run eval`
