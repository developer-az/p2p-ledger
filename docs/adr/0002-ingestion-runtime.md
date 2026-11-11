# 0002 — Ingestion runtime is a Python worker

## Status

Accepted, 2026-11-11 (PLAN.md Decisions, item 1).

## Context

M3 needs a runtime that parses Bank of America credit-card PDFs, OFX/QFX and CSV,
validates rows, de-duplicates them and posts to the ledger. That logic already exists in
SubscriptionRadar: `scripts/convert_bofa_pdf.py`, which keeps a section-total check and
refuses partial output, plus the queries that define the expected results (72 outflows,
5 streams, $65.96 monthly). The other runtimes are TypeScript and Java; the worker also
needs retries, a DLQ and a replay command outside request/response.

## Decision

The ingestion worker is Python, shipped as a container image. It reuses
`convert_bofa_pdf.py` and its section-total check instead of reimplementing the PDF
heuristics, and keeps every importer a pure function `file → rows + checks`. It writes
neither Postgres nor ledger tables: it validates against `schemas/transaction.v1.json`
and posts through the ledger API with `import-<fileHash>-<row>`.

Trade-offs against a Node/TypeScript worker:

| Concern | Python worker | Node worker |
|---|---|---|
| PDF parsing | Reuses working code and fixtures | New PDF dependency under the DEPENDENCY GATE |
| Repository cost | Third runtime: toolchain, lockfile, CI job | One language, shared validators |
| Type safety | JSON Schema at the boundary | Shared TS types end to end |
| Hosting | Container on Lambda, no request cap | Vercel functions, or a container |
| Data-role value | pandas and DuckDB in the parsing image | Fewer equivalents |

Practice mode does not run Python. The BFF runs its own importer behind the same
interface, and both are tested against the same golden fixtures, so divergence fails a
fixture instead of drifting.

## Consequences

- One more toolchain to pin, audit and scan in CI (M2.9, M8.3).
- The data contract is a JSON Schema, not a shared type. Validation on both sides is the
  contract; generated types are optional.
- Worker deployment is independent of the BFF, so a slow parse cannot exhaust Vercel's
  request budget, and retries plus the DLQ live in SQS (ADR 0003).
- If the heuristics are ever ported, the fixtures and their expected counts are the test.
