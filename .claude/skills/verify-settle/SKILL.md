---
name: verify-settle
description: Launch and drive the Settle consumer web app (assistant/, React + Vite with the Hono /api in-process) in an isolated practice-mode instance, exercise a feature through the real browser UI with playwright-cli, and capture proof. Use when you need to prove a UI or /api change works in the running app, not just in vitest.
---

# Verify Settle

Settle is the consumer app in `assistant/` (route `/`). The ops terminal at `/ops` and the Java `ledger-service/` are secondary surfaces not covered here. One Vite process serves both the UI and `/api` (`assistant/vite-plugin-api.ts`), so there is no separate backend to start.

The helper `.claude/skills/verify-settle/verify.sh` (bash; Git Bash on Windows) owns launch, doctor, driving, and cleanup. Run it from the repo root.

## Launch

```bash
.claude/skills/verify-settle/verify.sh up
```

- Starts Vite on `127.0.0.1:${VERIFY_PORT:-5199}` with `--strictPort`. Never 5173: that is the user's own `npm run dev`; leave it alone.
- Forces practice mode (`LEDGER_URL=http://127.0.0.1:9`, a dead port) so all data is in memory and resets on restart. Unsets `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY` so Ask answers come from the deterministic read-only fallback.
- Ready when it prints `ready: http://127.0.0.1:5199 ...`: both `/api/health` and `/` respond. First start takes ~25 s (Vite dep optimize). No migrations or seed step: the demo household is seeded in memory when the user clicks the demo button.
- Runs `npm install` in `assistant/` if `node_modules` is missing.
- Isolation: a second instance needs a different `VERIFY_PORT`. Each port gets its own playwright session (`verify-settle-<port>`) and in-memory data. The helper's state dir `.verify/run/` is shared, so drive only one instance per checkout at a time.

## Doctor

```bash
.claude/skills/verify-settle/verify.sh doctor
```

Read-only. Checks: our process is alive, the port is owned by our PID (not the user's server), `/api/health` is ok, `/api/bootstrap` reports `"live":false`, chat is unconfigured (warn otherwise), and prints the git revision and the evidence dir. Run it first, and again whenever anything looks off. Exit code 0 means drivable.

## Drive

`verify.sh pw <args>` is `playwright-cli -s=verify-settle-<port>` run from the evidence dir, so relative `--filename` paths land in evidence.

```bash
V=.claude/skills/verify-settle/verify.sh
$V pw open http://127.0.0.1:5199/
$V pw click "getByRole('button', { name: 'Preview a sample household' })"
$V pw --raw snapshot | grep 'heading "Hi, Anthony."'
$V pw click "getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Activity' })"
```

Conventions:
- Use role locators with accessible names (`getByRole(...)`), scoped to a container when the name repeats. Snapshot refs (`e123`) change on every render; don't reuse them across commands.
- Bottom tabs: `getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Today' | 'Activity' | 'Patterns' | 'Ask' | 'Wallet' })`. `Ask` alone is ambiguous (top bar + ask bar + dock).
- Bash expands `$` inside double quotes. Any locator with a dollar sign (e.g. `Log $7.25`) must be single-quoted: `'getByRole("button", { name: /^Log \$\d/ })'`.
- `playwright-cli` returns exit 0 even when a locator matches nothing; it prints `### Error`. Grep the output for `Error` instead of trusting the exit code.
- After a click that triggers a fetch, wait for the resulting text (`--raw snapshot | grep`), retrying a few times, rather than a fixed sleep.
- Server side effects are readable over plain HTTP: `curl -s http://127.0.0.1:5199/api/accounts/<id>` (balance, transfers) and `.../habits` (`recentSpends` with notes). The demo focus account is Anthony, `01111111-1111-7111-8111-111111111101`.
- Session state lives in browser `localStorage` (`settle:session`, `p2p-ledger:wallets`, `settle:demo-progress:<id>`). `$V pw --raw localstorage-list` shows it.

Feature recipes live in [features/README.md](features/README.md). Read the matching file before driving.

## Evidence

Everything goes to `.verify/evidence/<run-id>/` (gitignored; `verify.sh evidence` prints the path). Per proof capture:
- the action and the result: an ARIA snapshot before and after (`$V pw snapshot --filename=<feature>-before.yml`, `...-after.yml`) plus a screenshot (`$V pw screenshot --filename=<feature>.png`);
- the side effect from a second view: the `/api` JSON showing the stored row (`curl ... > "$($V evidence)/<feature>-api.json"`);
- `$V pw console error` output, which should be empty.

Proof standards: drive the real user path through the UI. Do not call `/api/demo/practice` or `/api/accounts/:id/spends` directly to create the state you then "verify"; curl is only for reading the result. A toast alone does not prove persistence: re-read through `/api` or another tab. Practice mode is the production code path minus Postgres (`CompositeLedger` falls back to `PracticeLedger`); anything that only exists with a live ledger (bank corridors, F3 audit against Postgres) is not proven by this skill. Say so instead of claiming it.

## Cleanup

```bash
.claude/skills/verify-settle/verify.sh down
```

Closes our playwright session and kills the PID tree we started (by PID, never by process name), then removes `.verify/run/`. Evidence in `.verify/evidence/<run-id>/` is kept. Run `down` after every failed attempt too. In-memory data dies with the process, so there is no fixture cleanup.
