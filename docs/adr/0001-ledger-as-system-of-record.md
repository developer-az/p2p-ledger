# 0001 — The ledger is the system of record for imported transactions

## Status

Accepted, 2026-11-11. Replaces the habit-store-first data model.

## Context

Settle grew as a spend logger: `spend_logs` and `money_profiles` hold what a person
typed, while the Java ledger holds transfers, deposits and payment requests. Statement
import (M3) breaks that split: once a bank export is parsed, the transaction is money
that moved, not a note. The habit store would then hold two balances, two de-duplication
rules and two answers to "what did I spend in March". Reports, net worth, forecasting and
anomaly detection all want one posting history with lineage back to the statement row.

## Decision

The ledger in `ledger-service` is the system of record for every imported transaction,
mapped onto a chart of accounts:

- Each bank account is an **asset** account; its ledger balance is the money held.
- Each credit card is a **liability** account; money owed sits on the negative side.
- Each category is an **expense** or **income** account, not a free-text tag.
- Every imported row posts **one balanced entry pair** through the existing API: a card
  purchase debits `expense:groceries` and credits `liability:card-1234`; a paycheck
  debits `asset:checking` and credits `income:salary`.

Amounts are integer minor units, never floats. Each posting carries the idempotency key
`import-<fileHash>-<row>`, so a retried import posts once. Rows are de-duplicated before
posting, so overlapping statements do not double count. The worker (ADR 0002) calls the
ledger API and never writes tables directly.

## Consequences

- Net worth is `sum(assets) − sum(liabilities)` and spend by category is a query over
  entries; reports need no parallel aggregation.
- Every posting is balanced by construction. A parse that cannot name a counter-account
  fails the row instead of writing half an entry.
- Imported rows are covered by the same invariants: zero-sum constraint, append-only
  entries, idempotency keys, fraud rules, outbox.
- A category becomes a chart-of-accounts row, so adding one is a seeded migration.
- The habit store stays the pre-import surface for typed logs. It is not a second source
  of truth for imported money, and M3 can replay existing logs as imports without a
  ledger schema change.
