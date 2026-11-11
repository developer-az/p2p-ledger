# 0005 — Remove consumer P2P and play money from the UI

## Status

Accepted, 2026-11-11.

## Context

PLAN.md rescopes Settle into self-hosted transaction intelligence for one household.
Asking friends for money, splitting a bill, paying a request and a simulated "Add
money" deposit belong to a different product. Each of those screens implies that the
app moves real money, and moving real money is a non-goal.

The old consumer surface carried that implication in its wording and its flows: a
Settle Up sheet with request cards and split rails, a deposit sheet that posted play
money into the demo ledger, and balance summaries built on both.

## Decision

Remove request, split and pay from the consumer UI, along with recording payments
made on an external rail and the simulated deposit.

Keep the server routes, the double-entry ledger and the P2P transfer endpoint. The
`/ops` engine console and the API call them directly, and the server tests cover
them. Keep transfer history rows in the activity feed as ledger history, because
those rows are real postings.

## Consequences

- The consumer surface is smaller: one spend sheet, one income path, statements and
  the patterns that read them.
- The guided demo no longer shows P2P or a deposit, so the demo describes what the
  product is for.
- Payment-request routes and their tests stay in the repository as engine features
  rather than product features.
- The PLAN.md DO-NOT-FLAG item about paying without a confirm step no longer applies
  to the consumer UI, because no consumer screen pays.
