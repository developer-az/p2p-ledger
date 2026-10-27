# Settle verification map

Maintained source for verifying user-facing behavior of the Settle app. Read this index, then use the matching feature file as the recipe.

## Baseline preconditions

- `verify.sh up` started a practice-mode instance at `http://127.0.0.1:5199` and `verify.sh doctor` exits 0.
- `V=.claude/skills/verify-settle/verify.sh` in the shell; browser opened with `$V pw open http://127.0.0.1:5199/`.
- Fresh browser session (no `settle:session` in localStorage) shows the Welcome page with `Create account` and `Preview a sample household`.
- Never drive an instance this run did not start (the user's 5173 server included).

## Driving conventions

- Role locators with accessible names, scoped to `dialog`, `group`, or `navigation "Main"` when a name repeats.
- Single-quote any locator containing `$`.
- Check `playwright-cli` output for `### Error`; exit code is 0 either way.
- Read stored state with `curl` against `/api`, never write it with `curl`.

## Proof and skip reporting

- Capture before/after ARIA snapshots, a screenshot, and the `/api` JSON showing the side effect, all in `$($V evidence)`.
- Record the feature ID and entry point with each artifact name (e.g. `log-spend-quick-after.yml`).
- Report an unreachable entry point with the command tried and the unmet precondition. Do not report it verified through a different entry point.

## Feature entry contract

Each file: H1 title, one paragraph, then exactly `Sub-features`, `How to get to it (user POV)`, `Driving it with playwright-cli` (starting with `Preconditions:`), `Gotchas`.

## Features

- [Guided demo](./demo.md): start the demo household from Welcome, demo guide card.
- [Log a spend](./log-spend.md): two-tap spend logging from Today, persisted to habits. **Proven end to end when this skill was created.**
- [Activity feed](./activity.md): unified feed with filters.
- [Ask](./ask.md): read-only Q&A over the wallet (fallback answers without an LLM key).
- [Create own wallet](./create-wallet.md): leave the demo, open a new wallet funded by the simulated bank.
