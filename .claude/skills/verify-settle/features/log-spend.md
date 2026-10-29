# Log a spend

The user logs an amount and a category in a bottom sheet titled "What did you buy?". The entry appears at the top of Today's Recent list and Activity, an Undo toast shows, and the spend is stored on the account's habits.

## Sub-features

- `log-spend-quick` logs from the Today `Log spend` quick action.
- `log-spend-fab` logs from the floating `Log what you spent` button.
- `log-spend-again` re-logs a recent spend from the "Again?" chips.
- `log-spend-undo` undoes the last log from the toast.

## How to get to it (user POV)

- Today → Quick actions → `Log spend`.
- Floating action button `Log what you spent` (any tab).
- Weekly ring button `Log a spend` on the Today card.
- Demo guide card `Log a spend` button (demo only).

## Driving it with playwright-cli

Preconditions:

- Inside the demo as Anthony (run [demo.md](./demo.md) `demo-start` first).

- **Open sheet.** `$V pw click "getByRole('button', { name: 'Log spend', exact: true })"`. A `dialog` with heading `What did you buy?` appears; the submit button reads `Log it` and is disabled.
- **Amount.** `$V pw fill "getByRole('dialog').getByRole('textbox', { name: 'Amount' })" "7.25"`. The submit button relabels to `Log $7.25` and enables.
- **Category.** `$V pw click "getByRole('group', { name: 'What was it?' }).getByRole('button', { name: 'Transport' })"`. That button gets `[pressed]`.
- **Note.** `$V pw fill "getByRole('dialog').getByRole('textbox', { name: 'Note (optional)' })" "verify-bus"`.
- **Before proof.** `$V pw snapshot --filename=log-spend-quick-before.yml`.
- **Submit.** `$V pw click 'getByRole("dialog").getByRole("button", { name: /^Log \$\d/ })'`. The dialog closes, a `status` with an `Undo` button appears, and Recent gets `button "verify-bus Logged by you · Transport · <time> −$7.25"`.
- **Side effect.** `curl -s http://127.0.0.1:5199/api/accounts/01111111-1111-7111-8111-111111111101/habits > "$($V evidence)/log-spend-quick-api.json"`; `recentSpends[0]` is `{"amount":"$7.25","category":"transport","note":"verify-bus",...}`.
- **Proof.** `$V pw snapshot --filename=log-spend-quick-after.yml`, `$V pw screenshot --filename=log-spend-quick.png`.

## Gotchas

- The submit button's name changes from `Log it` to `Log $<amount>`. Clicking `Log it` after filling fails silently (`### Error`, exit 0).
- In double quotes bash turns `$7.25` into `.25`. Single-quote that locator.
- An unscoped `getByRole('button', { name: 'Transport' })` can miss the category grid; the sheet keeps its default `Dining` and the log is stored as dining. Scope to the `What was it?` group and check `[pressed]`.
- `Log spend` without `exact: true` also matches `Log a spend` buttons.
- Times render in the browser's timezone; `occurredAt` in `/api` is UTC.
