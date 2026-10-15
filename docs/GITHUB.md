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
| `ASSISTANT_URL` | **Variable** | Vercel (or other) deployment of `assistant/`. Keep-warm pings `/api/health`. |
| `GEMINI_API_KEY` | **Secret** | Enables real-model evals in assistant CI on `main`. |

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
| `assistant-ci.yml` | `assistant/` | Typecheck, unit tests, Vite build, optional Gemini evals |
| `keep-warm.yml` | Cron every 10 min | `GET {LEDGER_URL}/actuator/health`, optional assistant health |

## Forks

Forks without secrets skip Render deploy and evals by design. Keep-warm still needs `LEDGER_URL` if you want cron pings for **your** deployment.
