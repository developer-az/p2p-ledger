# p2p-ledger

A peer-to-peer payments system in two parts:

| Part | Stack | Status |
|---|---|---|
| **ledger-service** | Java 21, Spring Boot 4, PostgreSQL, Kafka, Docker | Core done (this README) |
| **assistant** | React + TypeScript, Node/TypeScript, LLM tool calling | Planned |

The ledger is the source of truth for money. The assistant will be a client that answers questions about it ("why was this transfer declined?") by calling the ledger's API as LLM tools.

## Architecture

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

## Design decisions and trade-offs

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

**Plain SQL (`JdbcClient`) over JPA.** The interesting behavior here is the SQL (locking order, `ON CONFLICT`, `SKIP LOCKED`, `RETURNING`). Writing it directly keeps it visible and reviewable.

## API

All write endpoints require an `Idempotency-Key` header. New requests return `201`; replays return `200` with `Idempotent-Replayed: true`. A processed-but-declined transfer is still `201`, with `"status": "REJECTED"` and a `rejectionReason`. Errors are RFC 9457 problem details.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/accounts` | Open an account `{ownerId, currency}` |
| `GET` | `/v1/accounts/{id}` | Account with balance |
| `GET` | `/v1/accounts/{id}/entries?before=&limit=` | Ledger statement, newest first |
| `POST` | `/v1/accounts/{id}/deposits` | Fund an account from the external funding account `{amountMinor, memo}` |
| `POST` | `/v1/transfers` | Send money `{sourceAccountId, destinationAccountId, amountMinor, currency, memo}` |
| `GET` | `/v1/transfers/{id}` | One transfer |
| `GET` | `/v1/transfers?accountId=&limit=` | Transfers touching an account |
| `GET` | `/actuator/health`, `/actuator/prometheus` | Health and metrics |

```bash
curl -s localhost:8080/v1/accounts -H 'Content-Type: application/json' \
  -d '{"ownerId":"alice","currency":"USD"}'

curl -s localhost:8080/v1/transfers -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 3f1c…' \
  -d '{"sourceAccountId":"…","destinationAccountId":"…","amountMinor":2500,"currency":"USD","memo":"rent"}'
```

## Running it

```bash
docker compose up --build          # Postgres + Kafka + ledger on :8080, events go to Kafka

# watch the event stream
docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 --topic ledger.events --from-beginning --property print.headers=true
```

Without Kafka, events go to the log (`EVENTS_SINK=log`, the default).

## Tests

```bash
cd ledger-service && ./mvnw verify   # needs Docker; Testcontainers starts a real Postgres
```

Highlights:
- **Concurrency:** 16 threads × 40 random transfers around a ring of accounts. Asserts that total money is conserved, that no balance goes negative, and that every cached balance equals the sum of its entries.
- **Duplicate requests:** 12 threads send the same idempotency key at once, and exactly one transfer is created.
- **Database invariants:** an unbalanced entry and an `UPDATE` on the ledger are both rejected by Postgres.
- **Fraud rules:** every rule is tested at its boundary with a controllable clock.

## Roadmap

- [x] Ledger core: double-entry schema, idempotent transfers, fraud rules, outbox to Kafka, CI
- [ ] Deploy on free tiers (container host + managed Postgres, SQS as the free event sink), k6 load-test numbers here
- [ ] TypeScript assistant with LLM tool calling over this API, plus evals
- [ ] Architecture diagram and demo
