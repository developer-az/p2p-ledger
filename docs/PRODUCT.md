# Product — Settle

**Settle is open-source transaction intelligence you run yourself.** It runs the back
office that banks, card issuers and expense tools already run — ingest messy
statements, reconcile them, resolve merchants, classify, detect recurring charges and
anomalies, forecast cash — for one household, on the owner's own keys, posting every
transaction into a double-entry ledger that is the system of record.

The point is not a prettier dashboard over an API. It is a data platform problem
(messy inputs, idempotent pipelines, lineage, data quality) and a risk problem
(reason codes, forecast bands), on data that is personal financial records, so
encryption, tenancy isolation, audit and deletion are part of the product rather
than a later hardening pass.

Anchor documents: [PLAN.md](../PLAN.md) for milestones, [ARCHITECTURE.md](ARCHITECTURE.md)
for the ledger, [SECURITY.md](SECURITY.md) and [THREAT-MODEL.md](THREAT-MODEL.md) for
controls, [DESIGN.md](DESIGN.md) for the interface, [adr/](adr/) for the decisions.

## Personas

### The owner (operator)

One person who deploys Settle and puts their real statements into it.

- Import a bank export without cleaning it up first, and know that a row was posted
  once and only once.
- Trust the numbers: a ledger that balances, statements that reconcile, no silent
  drops.
- Find recurring charges before they renew, and see cash risk to the next payday.
- Keep the records on keys they control, and delete them for good when they choose.

### The invited household member

A partner or family member given access to the same household, not to an API.

- Sign in and see the shared accounts without handing over a bank password.
- Record and read transactions in plain language, on a phone.
- Fix a merchant or category once and have the correction apply to later imports.
- Understand a charge without asking the owner what it was.

Invite codes and shared-household membership are not built yet; today a second
person signs up for a separate account. Membership is planned with session work
(M2) and enrichment (M4).

### The recruiter evaluating the demo

Someone reading the repository and clicking the demo to judge the engineering.

- See the whole system in one pass: pipeline stages, ledger invariants, security
  model, and which parts are real today.
- Open the sample household from the landing page with no account and no card.
- Check the claims against the code, the tests and the plan, and find measured
  numbers rather than adjectives.

## Surfaces

| Surface | Route | What it is |
|---|---|---|
| Landing | `/` | Five numbered sections: statement, pipeline diagram, sample-household figures, security model, self-host. Every pipeline stage is tagged `Live`, `Partial · M#` or `Planned · M#`. |
| Sign-in | `/signin`, `/signup` | Email and password, Google when enabled, password reset, `?authError` handling. The aside lists only true data-handling lines plus the planned ones, tagged. |
| App shell | `/app/<section>` | Sidebar (Workspace, Money, Data, Settings), breadcrumbs, `⌘K` palette, `?` shortcut sheet, density and theme preferences. Every section is a URL. |
| Overview | `/app/overview` | Balance snapshot, this month against the previous 30 days, top categories, recent transactions, one add-sheet. |
| Transactions | `/app/transactions` | Dense list with date, merchant, category, amount, and filters. |
| Insights | `/app/insights` | Charts computed from the account's own history: category mix, weekday rhythm, month projection. |
| Ask | `/app/ask` | Read-only questions answered from the ledger and logs, with a deterministic answer when the model is unavailable or over budget. |
| Settings | `/app/settings/<tab>` | Profile, Security, Data & privacy, Integrations, Categories & rules, Appearance, Balances & budget. Unbuilt rows carry their milestone tag. |
| Engine console | `/ops` | Not a consumer surface: ledger explorer, integrity and tamper checks, idempotency replay, race tests. Kept because the ledger work is the product. |

Planned sections (`Imports`, `Subscriptions`, `Forecast`, `Alerts`, `Rules`,
`Reports`) are routed and rendered by one shared empty state that names the
milestone: `Planned · M3`, `M4`, `M5`, `M6`.

## What works today

- Email and password accounts, salted scrypt hashes, an httpOnly session cookie,
  Google sign-in when configured.
- Double-entry ledger in Java with an append-only entry table, a zero-sum
  constraint, idempotency keys, fraud rules and an outbox. The tests assert that a
  balance equals the sum of its entries under concurrent load.
- Spend and income logging, weekly pace, patterns from logs, CSV spend import for
  a connected account, statement download.
- Practice mode: the sample household, in memory, no Java service required.
- Security headers (HSTS, CSP, `frame-ancestors 'none'`), per-IP rate limits on
  writes and LLM routes with a shared store, daily LLM budget and answer cache.
- The staged cold-start loader, which reports which step is waiting on the free
  tier.

## What is planned, by milestone

| Label used in the app | What it covers |
|---|---|
| `Planned · M2` | Two-factor sign-in, active sessions, audit log, profile edit, export all, delete account, retention settings. |
| `Planned · M3` | Statement import (PDF/OFX/CSV with mapping), S3 → SQS → worker pipeline, dedupe, reconciliation, import progress, bank statement import, BYO API keys, bank connector. |
| `Planned · M4` | Merchant resolution with confidence scores, category rules previewed before apply, server-side logos. |
| `Planned · M5` | Subscriptions: cadence, next charge, price history, annual cost. |
| `Planned · M6` | Forecast with P10–P90 band, anomaly alerts with reason codes, reports. |
| `Planned · M8` | One-command self-host with your own keys, Terraform, SLOs, restore drill. |

"Partial" tags mean part of the stage is real: `Partial · M3` is the CSV log import
that exists today, `Partial · M5` is the pattern detection that exists without
subscription streams.

## Non-goals

- Moving real money. The ledger moves simulated balances; no rail, no custody.
- Investment advice, portfolio tracking, or a trading bot.
- Public, open registration. Anyone who finds the deployment can create an account
  today; invite-only access is planned with the session work (M2).
- Storing full card or account numbers. Last four digits at most.
- Client-side end-to-end encryption of live data, because dedupe, subscriptions and
  forecasts must run on the server (see [ADR 0004](adr/0004-encryption-model.md)).

## Data-handling stance

Settle holds personal financial records, and the product is written on that basis.

- **Collected:** email, password hash, display name, the spend and income rows a
  person logs or imports by CSV today, and statement rows once import ships (M3):
  descriptors, amounts, dates, the user's own categories and notes.
- **Never collected:** bank passwords, full card numbers, bank logins. The app asks
  for a statement export, not a credential.
- **Encryption in transit:** TLS with HSTS on every surface.
- **Encryption at rest:** provider-managed today; application-level envelope
  encryption with per-user keys, and crypto-shredding on delete, planned for M3
  when the first sensitive imports exist ([ADR 0004](adr/0004-encryption-model.md)).
- **Tenancy:** one account per user; Postgres row-level security is planned for M2.
- **Third parties:** the LLM provider receives a cleaned merchant name and an
  amount bucket, never raw descriptors or account data (M4). Merchant logos are
  fetched server-side and cached same-origin, so the browser never tells a third
  party which merchant it is looking at (M4). The subprocessor list ships with the
  privacy page in M2.
- **User rights:** statement download works today; full JSON and CSV export,
  account deletion with step-up, retention settings and the 7-day grace period are
  planned for M2, with crypto-shred following the envelope-encryption work.
- **Claims:** everything the interface says about a control is either true in the
  running build or tagged with the milestone that ships it. No planned control is
  described as live.
