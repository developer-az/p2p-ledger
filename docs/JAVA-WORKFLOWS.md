# Java product workflows

Java owns accounts, double-entry transfers, fraud policy, payment requests, split validation, spending persistence, CSV import, and chain-receipt delivery. TypeScript owns the browser, session authorization, presentation/insight projections, the read-only LLM integration, and isolated practice fixtures. The change replaces the TypeScript PostgreSQL payment-request and expense stores; it does not pad Java with duplicate implementations.

## Daily use

- **Settle Up:** request money or split a bill across up to eight people. The whole split validates and commits together. Retrying its idempotency key returns the original requests, while a changed body returns 422.
- **Pay:** the payer's action locks the request. Transfer, status update, decline-attempt result, double-entry legs and outbox commit in one transaction. Retried successful payments return the same transfer. A declined attempt stays declined when replayed; a new action after funding gets a new key.
- **Cancel, decline, or record external settlement:** authorized actors transition the same locked request. A cash/Zelle/other external receipt never causes a second in-app payment. Recording an outside rail is a user's statement that money arrived, not a connection to that payment provider.
- **Log spending:** live records persist through Java and Flyway, remain isolated by account, and never change ledger balances. Statement imports and manual records feed the existing Activity/Patterns projections. Practice records remain in memory.
- **Import expenses:** Wallet has a file picker, template and result counts. Java accepts up to 1 MB / 2,000 rows and rejects the entire file on a bad row. Amounts are exact decimal expenses, converted to integer cents; zero, negative amounts and fractional cents are refused. Deposits/income are outside this expense-only format.
- **Verify a payment:** Activity's proof panel can fetch/download a chain receipt when the integration is enabled. Chain failures do not reverse a completed ledger transfer.

## CSV format

Required headers are `date,amount`. Optional headers are `category,note,transactionId`. Unknown/duplicate headers and inconsistent column counts are errors. UTF-8 BOM and RFC 4180 quoting are supported.

```csv
date,amount,category,note,transactionId
2026-01-01,12.50,groceries,"Bread, milk",BANK-EXPENSE-1
2026-01-02,2.50,dining,Coffee,BANK-EXPENSE-2
```

Dates use `YYYY-MM-DD`. The browser supplies its IANA time zone and Java resolves local midnight with the correct daylight-saving offset. API clients may send `timeZone` alongside `csv`; omitted zones default to UTC. Amounts use a dot and at most two decimal places. Missing category defaults to `other`; supported categories are dining, groceries, transport, entertainment, housing, shopping, health, and other. Notes allow 140 characters.

Use stable bank transaction identifiers for overlapping statements. Without `transactionId`, deduplication uses the exact file content and row number; formatting changes or overlapping exports are separate imports. Identical purchases with distinct transaction IDs are retained. Reusing a transaction ID with changed expense data rejects the file. Removing an imported expense permits importing it again.

The existing Activity/Patterns projections read a bounded recent-log history (currently 500 records). Import stores every accepted row, but older rows beyond that presentation window are not all included in those projections. Full-history analytics and bank-specific CSV mapping remain separate work; use the template to normalize a bank export.

## Internal HTTP API

Send `X-Ledger-Key: YOUR_KEY` to Java. The BFF must authorize the user account before making these service calls; an account ID in a request body is not authentication. New routes return 503 if the service key is unconfigured and 401 for missing/wrong credentials. With a key configured, every Java endpoint except `/actuator/health` requires it.

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/requests` | Atomic split `{requesterAccountId,payers:[{accountId,amountMinor}],memo}`; requires `Idempotency-Key` |
| GET | `/v1/requests?accountId=&limit=` | Incoming and outgoing request records |
| GET | `/v1/requests/{id}` | One request |
| POST | `/v1/requests/{id}/pay` | `{accountId}`; requires `Idempotency-Key`; returns request and transfer |
| POST | `/v1/requests/{id}/decline` | Payer action `{accountId}` |
| POST | `/v1/requests/{id}/cancel` | Requester action `{accountId}` |
| POST | `/v1/requests/{id}/settle` | Requester action `{accountId,settledVia}` |
| POST | `/v1/accounts/{id}/spends` | Validated manual expense; requires `Idempotency-Key` |
| GET | `/v1/accounts/{id}/spends?since=&limit=` | Expenses, newest first, limit 1–500 |
| DELETE | `/v1/accounts/{id}/spends/{spendId}` | Remove an account's expense |
| POST | `/v1/accounts/{id}/spends/import` | `{csv}`; all-or-nothing expense import |
| GET | `/v1/transfers/{id}/receipt` | Queued/submitted/finalized/failed chain proof |

Existing BFF request and spending routes keep their response shapes. CSV import is `POST /api/accounts/{id}/spends/import`. Chain proof is `GET /api/transfers/{id}/receipt?accountId=YOUR_ACCOUNT_UUID` and is limited to a transfer participant with wallet access. Live errors are returned, never acknowledged as in-memory writes.

## Rollout and data migration

1. Back up PostgreSQL. Stop old BFF request/spending writers while migrating; their previous settlement consisted of separate commits.
2. Confirm where the old BFF stored `payment_requests` and `spend_logs`. If it used the ledger's database, V3/V5 reuse those tables. If it used another database, migrate those rows into the ledger database first, preserving account IDs. In-memory data cannot be recovered after process loss.
3. Deploy Java and run Flyway V3–V5. V3 reconciles pending legacy requests with already-completed transfers whose old `request-UUID-attempt` key and parties/amount match, preventing a post-migration duplicate payment. Investigate any historical cancelled/externally-paid request that already has a ledger transfer; this upgrade cannot undo previous accounting errors.
4. Configure the same fresh `LEDGER_API_KEY` on Java and the BFF. Keep Java internal. Update operational clients and metrics collectors to send the credential. Health checks remain public.
5. Deploy the matching BFF, then resume traffic. Live splits, payments, logs and CSV imports must reach Java; a missing key or old Java image is an error rather than a memory fallback.
6. Configure the chain separately using [the contract runbook](../contracts/README.md). It is disabled by default and applies only to new completed user-to-user transfers.

Persistent sign-in and personal-finance snapshots still require the assistant's existing database configuration. Moving request and spending storage does not make in-memory identity persistent. No bank feed or real-money funding integration was added.

## Verification

`ledger-service/mvnw verify` runs real PostgreSQL tests for split atomicity, retries, declined attempts, parallel pay/cancel, duplicate clicks, CSV rollback/deduplication/account isolation, plus bounded relay failure tests. `contracts/npm test` runs EVM behavior checks; `npm run test:integration` starts the actual jar with PostgreSQL and Hardhat and tests persistence across restart. Assistant tests check live delegation and wallet authorization. The contract package's CI includes the integrated chain path.
