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

**F3 integrity:** Render must expose `GET /v1/ledger/integrity` (merge to `main` or push `feat/guided-visual-ledger` with `ledger-service` changes — CI deploys Render). **Or** set **`LEDGER_DATABASE_URL`** on Vercel to the ledger’s Postgres URL (session pooler); the assistant runs the same audit SQL when Java returns 404.

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

## Redacting AI commit trailers (Co-Authored-By / Claude-Session)

Some AI coding tools append **git commit trailers** such as `Co-Authored-By:` and `Claude-Session:` (a link to a Claude Code session). Those lines are stored in **git history forever** on GitHub until you rewrite history. They do not expose your full chat by default, but the session URL is still metadata you may not want public.

**In this repo (as of last scan):** five early commits on `main` contain the same `Claude-Session:` URL. No other branches add new ones unless your tool keeps appending them.

### Stop future commits

In **Claude Code** (or whichever tool added the trailers), turn off commit co-author / session attribution in that product’s settings or environment variables before your next `git commit`. Cursor commits from this assistant do not add those trailers unless your local hook or another tool does.

Optional: add a **commit-msg hook** that rejects lines starting with `Claude-Session:` or unwanted `Co-Authored-By:`.

### Remove from existing history (rewrite + force push)

This **changes every commit hash** after the edited commits. You must **force-push** all branches you care about (`main`, feature branches). Anyone with a clone must re-clone or reset. Open PRs may need to be recreated.

1. **Backup:** `git clone --mirror <repo-url> p2p-ledger-backup.git`
2. From a clean working tree on your machine:

```bash
cd p2p-ledger
git filter-branch -f --msg-filter "python scripts/strip-commit-trailers.py" -- --all
```

3. Verify:

```bash
git log --all --grep="Claude-Session" --oneline   # should print nothing
git log --all --grep="Co-Authored-By: Claude" --oneline
```

4. Push (requires permission on protected `main`):

```bash
git push --force-with-lease origin main
# repeat for other remote branches you use, e.g. feat/guided-visual-ledger
```

**Alternative (recommended for large repos):** install [git-filter-repo](https://github.com/newren/git-filter-repo) and run a `--commit-callback` that calls the same line-stripping logic as `scripts/strip-commit-trailers.py`.

**GitHub caveats:** Merged PR discussion may still quote old SHAs; forks taken before the rewrite keep old history; GitHub Support cannot “edit” commit messages in place—only a force-pushed rewrite removes them from the default branch history.

## Forks

Forks without secrets skip Render deploy by design. Keep-warm still needs `LEDGER_URL` if you want cron pings for **your** deployment.

### Run Gemini evals (free tier)

Push/PR **assistant CI** does not call Gemini (daily quota is too small to burn on every commit). When quota has reset:

1. **Actions** → **assistant eval (Gemini)** → **Run workflow**
2. Leave `case_ids` empty for the default 4-case smoke, or run all 8 locally: `cd assistant && TRIALS=1 npm run eval`
