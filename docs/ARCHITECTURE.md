# Ledger architecture & engineering notes

Deep-dive for **ledger-service** — the Java system of record. The assistant client is documented in [API.md](API.md) and the root [README](../README.md).

## Data flow

```
client ──HTTP──▶ ledger-service ──JDBC──▶ PostgreSQL
                     │                     ├─ accounts         (cached balance, row-locked)
                     │                     ├─ transfers        (one row per request, unique idempotency key)
                     │                     ├─ ledger_entries   (append-only, double-entry)
                     │                     └─ outbox_events    (written in the same transaction)
                     │
                     └── OutboxRelay (polls, SKIP LOCKED) ──▶ Kafka topic `ledger.events`
```

A transfer is one database transaction that:

1. Returns the stored result if the `Idempotency-Key` was already used.
2. Locks both account rows with `SELECT … FOR UPDATE`, **always in primary-key order**.
3. Runs fraud rules and the balance check against that locked state.
4. Inserts the transfer, two ledger entries (−amount, +amount) and an outbox event, then updates both cached balances.

## Design decisions

**Double-entry with signed amounts.** Every transfer writes one debit (negative) and one credit (positive) entry. Postgres enforces the invariants itself rather than trusting application code:

- a deferred constraint trigger rejects any transaction whose entries for a transfer don't sum to zero;
- a trigger makes `ledger_entries` append-only (no `UPDATE`/`DELETE`);
- a `CHECK` keeps user balances non-negative.

**Cached balance next to the entries.** Reading a balance is O(1) from `accounts.balance_minor` instead of summing entries. The cost is a second write per leg, done under the same row lock so the two can't diverge; the tests assert `balance == sum(entries)` after concurrent load.

**Pessimistic locking over optimistic or `SERIALIZABLE`.** Transfers between the same accounts are inherently contended. Row locks make them queue instead of failing and retrying. Ordering the locks by id rules out deadlocks when A→B and B→A run at the same time. Throughput is bounded per account pair, not globally.

**Idempotency in the database, not a cache.** The idempotency key is a `UNIQUE` column on `transfers`, inserted with `ON CONFLICT DO NOTHING`. If two identical requests race, Postgres blocks the second until the first commits, then it returns the stored result. A reused key with a *different* body returns `422`. Declined transfers are stored too, so retrying a decline returns the same decline instead of re-evaluating it.

**Fraud rules run inside the lock.** Velocity and daily-limit rules count the source account's recent transfers while its row is locked, so concurrent requests can't jointly slip past a limit. Current rules (thresholds in `application.yml` under `ledger.fraud`):

| Reason code | Rule (defaults) |
|---|---|
| `AMOUNT_OVER_SINGLE_LIMIT` | single transfer > $10,000 |
| `NEW_ACCOUNT_LARGE_TRANSFER` | account < 24h old sending > $1,000 |
| `VELOCITY_LIMIT` | ≥ 5 transfers in 60s |
| `DAILY_OUTFLOW_LIMIT` | > $25,000 sent in 24h |

**Transactional outbox instead of publishing from the request.** Writing to Kafka inside the request would either lose events (if the DB commit fails after the send) or publish events for rolled-back transfers. The event row commits atomically with the money movement. A relay publishes it afterwards and marks it sent only after the broker acknowledges. Delivery is at-least-once, so each message carries an `event-id` header for consumers to de-duplicate on. Messages are keyed by transfer id for per-transfer ordering.

**Money as `bigint` minor units.** No floating point anywhere. Amounts are cents.

**UUIDv7 ids.** Time-ordered ids keep index inserts sequential and make `ORDER BY id` equal to time order, which the statement endpoints use for keyset pagination.

**Load shedding instead of unbounded queuing.** Virtual threads remove the thread-pool cap, so under a burst every request gets a thread and waits on the 10-connection DB pool. In the first load test this queued thousands of requests on the heap and **the JVM was OOM-killed at 500 req/s on a 512 MB container**. `InFlightLimitFilter` now caps concurrent API requests (default 64). Requests beyond the cap wait up to 200 ms for a slot, then get a fast `503` with `Retry-After`. Latency and memory stay flat for the requests that are admitted, and clients get a signal they can retry safely, because the request is idempotent.

**Event sink chosen at runtime, not by `@ConditionalOnProperty`.** In a GraalVM native image, Spring evaluates bean conditions once at build time, and a conditional bean would freeze the sink into the binary. This was found in the native smoke test, where `EVENTS_SINK=sqs` was silently ignored. A plain factory `switch` keeps it configurable.

**Plain SQL (`JdbcClient`) over JPA.** The interesting behavior here is the SQL (locking order, `ON CONFLICT`, `SKIP LOCKED`, `RETURNING`). Writing it directly keeps it visible and reviewable.

## REST API

All write endpoints require an `Idempotency-Key` header. New requests return `201`; replays return `200` with `Idempotent-Replayed: true`. A processed-but-declined transfer is still `201`, with `"status": "REJECTED"` and a `rejectionReason`. Errors are RFC 9457 problem details.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/accounts` | Open an account `{ownerId, currency}` |
| `GET` | `/v1/accounts?ownerId=` | A user's accounts |
| `GET` | `/v1/accounts/{id}` | Account with balance |
| `GET` | `/v1/accounts/{id}/entries?before=&limit=` | Ledger statement, newest first |
| `POST` | `/v1/accounts/{id}/deposits` | Fund an account from the external funding account `{amountMinor, memo}` |
| `POST` | `/v1/transfers` | Send money `{sourceAccountId, destinationAccountId, amountMinor, currency, memo}` |
| `GET` | `/v1/transfers/{id}` | One transfer |
| `GET` | `/v1/transfers?accountId=&limit=` | Transfers touching an account |
| `GET` | `/actuator/health`, `/actuator/prometheus` | Health and metrics |

## Performance (k6)

Measured with [k6](../loadtest/transfers.js): open-model constant arrival rate, random transfers between 200 accounts, and 10% of requests replaying an earlier idempotency key. Each run lasts 30s after a warm-up (15s native, 60s JVM). The service ran in a Docker container limited to **1 CPU / 512 MB**, with Postgres 17 and k6 on the same 4-vCPU host. After every run, total money summed to exactly 0 and no user balance was negative.

| Build | Load | p50 | p95 | p99 | Errors | RSS |
|---|---|---|---|---|---|---|
| Native | 500 req/s | 4.5 ms | 9.8 ms | 30 ms | 0% | 54 MB |
| Native | 800 req/s | 6.3 ms | 50 ms | 109 ms | 0% | 80 MB |
| Native | 1000 req/s | 224 ms | 402 ms | 518 ms | 10.9% shed (503) | 181 MB |
| JVM (warmed) | 500 req/s | 3.4 ms | 15 ms | 61 ms | 0% | 303 MB |
| JVM (warmed) | 800 req/s | 4.4 ms | 48 ms | 124 ms | 0% | 394 MB |
| JVM (warmed) | 1000 req/s | 12 ms | 231 ms | 276 ms | 0.6% shed (503) | 505 MB |
| Native, **hot accounts** (10 accounts) | 500 req/s | 7.2 ms | 222 ms | 336 ms | 0% | 69 MB |
| Native, **0.1 CPU** (free-tier size) | 50 req/s | 4.7 ms | 58 ms | 79 ms | 0% | 129 MB |

| Startup on 0.1 CPU / 512 MB | Time to healthy | Idle memory |
|---|---|---|
| JVM (Temurin 21) | 144 s | 182 MB |
| GraalVM native | 3.6 s | 74 MB |

**Takeaways:** native image fits Render’s free tier (fast cold start, low RSS); warmed JVM wins at sustained 1000 req/s; hot-account contention dominates p99 before CPU; overload sheds with `503` instead of OOM.

Reproduce: relax fraud limits (`LEDGER_FRAUD_VELOCITY_MAX_TRANSFERS=1000000000`, etc.), then `k6 run -e BASE_URL=http://localhost:8080 -e RATE=500 loadtest/transfers.js`.

## Verification

```bash
cd ledger-service && ./mvnw verify   # Testcontainers Postgres
```

- **Concurrency:** ring of accounts; conserved money; `balance == sum(entries)`.
- **Idempotency:** parallel duplicate keys → one transfer.
- **DB invariants:** unbalanced entries and ledger `UPDATE` rejected.
- **Fraud:** boundary tests with controllable clock.
- **SQS:** ElasticMQ FIFO group ids.
- **Load shedding:** `503` + `Retry-After`; health never shed.
- **Native smoke:** [`scripts/smoke.sh`](../ledger-service/scripts/smoke.sh) on CI-built binary.
