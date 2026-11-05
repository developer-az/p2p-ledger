# Settle

Settle is one product for recording personal spending, understanding a weekly plan, and tracking shared bills. `p2p-ledger` is the repository name. Java is the internal accounting service. `/ops` is the engineering console.

## Customer experience

- Today starts with category bubbles. Pick a category, choose a preset or exact amount, review, and save. Recording an expense does not send a payment. Recent repeats skip to review. Failed writes preserve their idempotency key; successful logs offer undo.
- Main navigation has Today, Activity, and Wallet. Patterns opens from Today; Ask opens from the header or Wallet.
- Activity is the shared timeline for expenses, income, and payment records. Source and status identify what each record means.
- Wallet holds cash, cards owed, pace, imports, and account controls. Simulated funding and the trust lab belong in the sample experience and engineering console.
- Setup is optional. People can log immediately and add their starting numbers later. Changing current cash starts a fresh snapshot calculation; spending history stays available.

## Money definitions

Personal net position is starting cash plus logged income, minus logged spending when enabled, minus cards owed. The calculation uses records since the current snapshot. Weekly pace measures recorded expenses; it is a plan, not a bank balance.

Double-entry payment balances are internal settlement accounting. Never add a personal cash estimate to simulated funding: that would create a fictitious total. Recording an expense does not debit the payment ledger. Paying a shared request uses Java's atomic request/transfer transaction and idempotency key.

Funding and internal payments currently remain simulated. Apple Pay, Venmo, and bank connectivity are not integrated payment rails. Recording an external settlement is a user assertion, not provider confirmation. Real payments require provider integration and reconciliation before launch as a payments service.

## Identity and backend contract

Production signup requires durable PostgreSQL identity storage and matching Java workflow capabilities. It cannot fall back to a practice account. Signup reserves identity/account UUIDs durably under a per-email database lock. Java account provisioning is idempotent at the reserved UUID. Interrupted registration resumes with the same credentials and IDs; identity activation follows successful provisioning.

Passwords use scrypt. Random session tokens are stored as hashes, with HttpOnly/SameSite cookies and Secure cookies in production. Cross-site writes are rejected and API responses are not cached. Account-specific credential attempt limits are shared through PostgreSQL. Reset token consumption, password replacement, and session revocation commit together.

`GET /api/ready` returns 200 only when identity storage is reachable and Java advertises workflow version 2. Java capabilities and provisioning require the server-only service key. Deploy compatible Java and migrations before the BFF. See [JAVA-WORKFLOWS.md](JAVA-WORKFLOWS.md).

## Release boundary

Local tests validate simulated workflows, not enterprise or regulated payments readiness. A real payments release additionally requires verified email ownership/identity, production provider configuration, delivery and recovery monitoring, secret rotation, backup restoration drills, ingress protection, reconciliation, and operational ownership. Do not advertise bank payments before those systems are integrated and verified.
