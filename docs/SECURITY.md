# Security model

This project is a **demo / portfolio ledger**, not a regulated bank. Understand what is protected and what is not before exposing a public deployment.

## What stays secret

| Asset | Where it lives | Never commit |
|--------|----------------|--------------|
| `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` | Vercel env, local `.env.local` | Yes — `.gitignore` blocks `.env*` (except `.env.example`) |
| `RENDER_DEPLOY_HOOK_URL` | GitHub Actions secret | Yes |
| `DATABASE_PASSWORD`, AWS keys | Render / Terraform / Supabase | Yes |
| DB credentials in `docker-compose.yml` | Local dev only (`ledger` / `ledger`) | OK in repo for compose; do not reuse in production |

LLM keys are only read on the **server** (`assistant` API routes). The browser never receives them.

## Demo API trust model

- **No end-user login.** “Sign in” in the UI means picking or creating an account id. Anyone who knows a UUID can call `/api/transfers` for that wallet on a public deployment.
- **Ledger-service** on Render is similarly open unless you add network rules or auth in front of it.
- **Mitigations in this repo:** Zod validation, idempotency keys, Java-side fraud limits, read-only LLM tools, per-IP rate limits on chat, demo seed, and money writes (`POST /api/accounts`, deposits, transfers).
- **Production hardening** (out of scope for the free demo): OAuth, session-bound account ids, WAF, private ledger network, mTLS between assistant and ledger.

## GitHub Actions

- Use **Variables** for public URLs (`LEDGER_URL`, `ASSISTANT_URL`).
- Use **Secrets** for deploy hooks and API keys only.
- Forks without secrets skip deploy and evals; keep-warm fails until you set `LEDGER_URL` (intentional).

## Reporting

For this personal/demo repo, open a GitHub issue on the repository if you find a vulnerability in the published deployment.
