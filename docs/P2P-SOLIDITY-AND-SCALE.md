# P2P truth, Solidity, and how much money the stack can hold

This document answers three questions for **p2p-ledger**:

1. Is this repo “really” peer-to-peer?
2. Can you use **Java** for a **Solidity** smart contract, or plug in **Ethereum** logic?
3. Why do people build **ledgers** at all, and what scale / funds does **this** stack imply?

## What “P2P” means here vs on-chain

| Meaning | This repo | Typical Ethereum dApp |
|--------|-----------|------------------------|
| **Who holds balances** | PostgreSQL behind `ledger-service` (custodial system of record) | Smart contract state + user wallets |
| **Who can move money** | Anyone with API access + valid account ids; fraud rules in Java | Anyone with gas + correct calldata; rules in Solidity |
| **Trust model** | You trust the operator + DB integrity (double-entry, append-only entries) | You trust contract code + chain consensus |
| **Peer** | **Counterparties** (Alex pays Sam) via transfers between accounts | **Counterparties** settle on-chain or via L2 |

The product is **P2P in the payments sense**: person A sends value to person B without a separate “merchant acquirer” in the middle. It is **not** P2P in the **blockchain** sense (no global replicated state, no wallet signatures on every transfer).

That split is normal in production: most “P2P” apps (Venmo-style) still run a **central ledger** for speed, compliance, and recoverability. Chain settlement is optional glue, not a replacement for accounting.

## Can you write Solidity in Java?

**No.** Solidity compiles to **EVM bytecode** and runs on Ethereum (or an EVM L2). Java in `ledger-service` runs on the JVM and talks to **PostgreSQL**.

You *can* integrate Ethereum **alongside** Java:

```
User / terminal UI
       │
       ▼
assistant (BFF) ──HTTP──▶ ledger-service ──▶ PostgreSQL  ← system of record (USD minor units)
       │                         │
       │                         └── outbox_events ──▶ Kafka/SQS
       │                                      │
       └── (optional) wallet connect          ▼
              │                         bridge worker
              ▼                              │
         Ethereum RPC                   Solidity contract
         (deposit / withdraw /            (escrow, receipt NFT,
          proof of settlement)            multisig release, etc.)
```

**Practical patterns:**

| Goal | Where it lives | Notes |
|------|----------------|-------|
| Balances, fraud, idempotency, statements | **Keep in Java** | Already implemented; see [ARCHITECTURE.md](ARCHITECTURE.md) |
| “Proof” or settlement on a public chain | **Solidity + relayer** | Consume `ledger.events` / outbox; **never** let a tx succeed in DB without matching policy |
| User pays in ETH/USDC | **Wallet + contract** | Credit Java account only after **confirmed** on-chain event (finality, reorgs, KYC) |
| Full non-custodial P2P | **Mostly off Java** | Java becomes indexer or disappears; different product |

**Do not** duplicate money state in both Postgres and a contract without a strict **single-writer** rule. Either the ledger rows are authoritative and chain is a receipt, or the contract is authoritative and Postgres is a cache — mixing both as “sources of truth” causes double-spend class bugs.

### Minimal Solidity role (if you add it later)

A small contract can still make sense **without** replacing the ledger:

- **Escrow strip**: lock USDC until both parties ack (or timeout refund).
- **Attestation**: emit an event `TransferCommitted(ledgerTransferId, hash)` after outbox publishes — cheap audit anchor.
- **Cap table / “stick”**: represent a **claim** on a pool (see below) as ERC-20/1155 **only** if legal and ops model allow it.

Tooling would be a separate package (e.g. Foundry/Hardhat), CI job, and env for RPC + deploy keys — not inside `mvnw`.

## Why people use ledgers (and why this repo models that)

Ledgers exist because **value must be conserved, ordered, and explainable**:

1. **Double-entry** — every movement has matching debit/credit; the database enforces sum-to-zero per transfer.
2. **Ordering under concurrency** — row locks + idempotency so retries and parallel clients do not invent money.
3. **Policy** — velocity, daily outflow, new-account limits ([ARCHITECTURE.md](ARCHITECTURE.md) fraud table).
4. **Audit** — append-only `ledger_entries`, transfer history, integrity endpoint, terminal blotter.
5. **Integration** — outbox events for downstream systems (analytics, notifications, **optional** chain bridge).

Users do not “use a ledger” for fun; they use it so **nobody’s balance is wrong** when networks fail, users double-tap Pay, or two phones send at once.

## How much money can really be “in the stack”?

Interpret “in the stack” as **total value the system is designed to hold and move safely**.

### Economic conservation (demo / test)

In load tests, **total money across all accounts sums to zero** (internal transfers) plus whatever was **deposited** from the external funding account. The k6 suite asserts no negative user balances after stress runs ([ARCHITECTURE.md](ARCHITECTURE.md) performance section).

### Policy caps (default fraud config)

These are **per-account behavior limits**, not a global vault size:

| Rule | Default |
|------|---------|
| Single transfer max | $10,000 |
| New account (&lt; 24h) max send | $1,000 |
| Velocity | 5 transfers / 60s |
| Daily outflow | $25,000 / 24h |

Raising limits is config (`ledger.fraud` / env); the **architecture** scales to more throughput (native ~500–800 req/s on 1 CPU in tests), not unlimited uncapped retail volume without ops and compliance.

### Production reality for **this** deployment

| Factor | Implication |
|--------|-------------|
| **Portfolio / demo** | Not a licensed money transmitter; do not place real customer funds without legal + security review ([SECURITY.md](SECURITY.md)). |
| **Custodial Postgres** | “Funds in the stack” = sum of `accounts.balance_minor` + operational risk of the DB and operator. |
| **Ethereum layer** | “Funds in the stack” = contract TVL + wallet balances; gas, oracle, and bridge risk are additive. |
| **A “stick” (pool / note)** | If you mean a **tranche** or **escrow pool**: size is whatever you **deposit** into the funding account or contract; the ledger tracks allocation, not magic leverage. |

**Rule of thumb:** treat the Java ledger as capable of **technical** correctness for many millions of minor units **if** Postgres, backups, and fraud limits are sized for your use case. Treat **this repo’s live deploy** as **demonstration capacity**, not an insured bank balance.

## Recommendation for this codebase

| If your goal is… | Do this |
|------------------|---------|
| Best P2P **product** on current stack | Ship contacts search, auth-bound wallets, keep Java as SoR (roadmap in [PRODUCT.md](PRODUCT.md)). |
| **Credible** decentralization | Add `contracts/` + bridge consumer from outbox; use chain for escrow/attestation, not duplicate balances. |
| Replace Java with Solidity entirely | New product direction; you lose idempotent JDBC fraud/locking patterns unless you rebuild them on-chain (expensive, public). |

**Solidity in Java:** use Java to **orchestrate** and **account**; use Solidity to **settle or attest** where trust-minimization is worth gas and complexity.

## Related docs

- [ARCHITECTURE.md](ARCHITECTURE.md) — transfers, outbox, fraud, load tests  
- [PRODUCT.md](PRODUCT.md) — live vs practice, terminal, roadmap  
- [API.md](API.md) — BFF and ledger HTTP surface  
