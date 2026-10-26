# Create own wallet

A user leaves the demo and opens a personal wallet by first name. The wallet gets a $500 simulated deposit plus one inbound corridor, starts with no spend logs, and opens the setup sheet.

## Sub-features

- `wallet-leave` leaves the current wallet and returns to Welcome.
- `wallet-create` opens and funds a new wallet.
- `wallet-resume` reopens a saved wallet from Welcome's "back" list.

## How to get to it (user POV)

- Wallet tab → `Leave wallet`, or top-bar wallet chip menu → `Leave this wallet`.
- Welcome → `Start my own` link (scrolls to the form) → `First name` → `Create wallet`.
- Demo guide → `Start my own wallet`.

## Driving it with playwright-cli

Preconditions:

- Inside any wallet (demo is fine). Practice mode: the wallet lives in server memory only.

- **Leave.** `$V pw click "getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Wallet' })"`, then `$V pw click "getByRole('button', { name: 'Leave wallet' })"`. Welcome renders with heading `Start clean. Keep it yours.`. No confirm dialog.
- **Create.** `$V pw fill "getByRole('textbox', { name: 'First name' })" "Verifya"`, then `$V pw click "getByRole('button', { name: 'Create wallet' })"`. Today shows heading `Hi, Verifya.` and the setup sheet `Set your starting point`.
- **Side effect.** `$V pw --raw localstorage-get settle:session` gives the new account id; `curl -s http://127.0.0.1:5199/api/accounts/<id>` shows `"deposited":"$500.00"`, `"received":"$220.00"`, balance `$720.00` (the corridor amount is the seeded value seen on 2026-10-26; assert deposit exactly and received > 0).
- **Proof.** `$V pw snapshot --filename=wallet-create-after.yml`, `$V pw screenshot --filename=wallet-create.png`, the `/api` JSON saved to evidence.

## Gotchas

- The owner id gets a random suffix (`verifya-edeb`); match on the display name, not the owner id.
- The setup sheet auto-opens once per wallet (`settle:setup-seen:<id>`); close it with `Close` before driving Today.
- `Leave wallet` keeps the wallet in `p2p-ledger:wallets`, so Welcome then shows a resume list.
- Restarting the server drops practice wallets, but localStorage still lists them; resuming one then fails to load.
