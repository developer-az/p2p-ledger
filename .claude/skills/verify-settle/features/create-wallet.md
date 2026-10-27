# Create an account

A person signs up with name, email, and password. The wallet gets a $500 opening deposit plus one inbound corridor, starts with no spend logs, and opens the setup sheet. Sign-out returns to Welcome. Signing in with the same email returns the same wallet while that server process is still up.

## Sub-features

- `account-leave` signs out and returns to Welcome.
- `account-create` registers and funds a wallet.
- `account-return` signs in again and lands on the same greeting.

## How to get to it (user POV)

- Wallet tab → `Sign out`, or the top-bar account menu → `Sign out` (`Exit sample` inside the sample household).
- Welcome → `Create account` → Name, Email, Password → `Create account`.
- Sample guide → `Create an account`.

## Driving it with playwright-cli

Preconditions:

- Inside the sample household is fine. Practice mode: the account lives in server memory only.

- **Leave.** `$V pw click "getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Wallet' })"`, then `$V pw click "getByRole('button', { name: 'Exit sample' })"`. Welcome renders with heading `Start clean. Keep it yours.` once Create account is selected. No confirm dialog.
- **Create.** `$V pw click "getByRole('tab', { name: 'Create account' })"`, then fill Name `Verifya`, Email `verifya@example.com`, Password `correct-horse`, then `$V pw click "getByRole('button', { name: 'Create account' }).last()"`. Today shows heading `Hi, Verifya.` and the setup sheet `Set your starting point`.
- **Side effect.** `$V pw --raw localstorage-get settle:session` gives the new account id and `"email":"verifya@example.com"`; `curl -s http://127.0.0.1:5199/api/accounts/<id>` shows `"deposited":"$500.00"` and a received corridor (assert deposit exactly and received > 0). `GET /api/auth/session` with the browser cookie returns the same account.
- **Proof.** `$V pw snapshot --filename=wallet-create-after.yml`, `$V pw screenshot --filename=wallet-create.png`, the `/api` JSON saved to evidence.

## Gotchas

- The owner id gets a random suffix (`verifya-edeb`); the greeting uses the name they typed.
- The setup sheet auto-opens once per wallet (`settle:setup-seen:<id>`); close it with `Close` before driving Today.
- There are two controls named `Create account` (nav and submit). Use `.last()` for the form submit, or the tab plus the submit button inside the form.
- Restarting the server drops practice accounts. The cookie and localStorage still exist, but the wallet will not load.
