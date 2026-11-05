# Ledger receipts on an EVM chain

`src/LedgerAttestation.sol` is a non-upgradeable attestation registry. A completed Java transfer can produce an immutable, salted SHA-256 commitment on chain. The contract holds no funds and does not settle ETH, USDC or bank money. It proves that an authorized operator recorded a commitment; it cannot prove that the operator's accounts are truthful. PostgreSQL remains authoritative for balances.

## Build and test

Requires Node 24, Java 21 and Docker for the integration test.

```sh
cd contracts
npm ci --ignore-scripts
npm run build
npm test
npm audit
cd ../ledger-service
./mvnw verify
cd ../contracts
npm run test:integration
```

Tests cover authorization, immutable commitments, replay, pause, role revocation, invalid construction, refused native-currency transfers and delayed admin succession. The integration test deploys to an isolated Hardhat chain, starts disposable PostgreSQL and the real Java jar, pays a request, verifies the receipt, restarts Java, and retries without paying or anchoring twice. Local accounts are test fixtures, never production wallets.

Solidity 0.8.38, optimizer 200 runs, Shanghai target and dependencies are pinned. `npm run build` writes ABI, bytecode, compiler settings and Java selector metadata under `artifacts/`. Hardhat runs the local EVM; the pinned local `solc` compiles without downloading another compiler. Transitive `tmp` and `zod` overrides select patched versions; keep them until upstream updates.

## Roles and deployment

- `DEFAULT_ADMIN_ROLE`: use a multisig. OpenZeppelin enforces a delayed, two-step admin transfer. The admin manages roles and can unpause.
- `RELAYER_ROLE`: a dedicated gas-funded signer, allowed to anchor.
- `PAUSER_ROLE`: an incident responder able to stop writes. Reads remain available.

An identical retry succeeds without rewriting storage or emitting another event. A changed commitment for an existing key reverts. The registry makes no external calls and has no payable entry points. The pause also stops replays.

For local use, run `npm run dev:chain`. Supply the variables in `.env.example` through your shell or a locally ignored environment file. The scripts do not load `.env` implicitly. Set the deployer, admin, relayer and pauser addresses, chain ID, signer RPC and admin delay, then run `npm run deploy`.

For a public network, use an authenticated HTTPS signing gateway supporting `eth_sendTransaction`. It owns nonce assignment and signing; Java never reads a private key. Ordinary read-only RPC providers cannot fill this role. Restrict the gateway to the configured chain, contract, relayer, anchor selector and zero-value transactions. Keep the relayer exclusive to this application. HTTP is accepted only on loopback for local development.

The deploy script checks the chain ID, requires an initial admin delay of at least one day outside chain 31337, and writes a deployment manifest exclusively under `deployments/`. Preserve the manifest, use separate deployer and relayer authority, and verify source/constructor parameters on the selected explorer. This session has submitted no public-chain transactions.

## Java configuration

Set the same random, 32+ character `LEDGER_API_KEY` on Java and the assistant server. The BFF sends `X-Ledger-Key`; never use a `VITE_` prefix. With a key configured, all Java routes except `/actuator/health` require it, including metrics. New workflows refuse to operate without a key. Keep Java internal; the BFF authenticates sessions and authorizes wallet actors.

| Variable | Meaning |
|---|---|
| `CHAIN_ENABLED=true` | Queue newly completed user-to-user transfers |
| `CHAIN_ID` | Expected positive chain ID |
| `CHAIN_NAMESPACE` | Unique stable ledger-deployment name; do not reuse across independent databases |
| `CHAIN_RPC_URL` | HTTPS RPC with historical calls, logs and finalized-state support |
| `CHAIN_SIGNER_RPC_URL` | Authenticated HTTPS signing gateway |
| `CHAIN_CONTRACT_ADDRESS` | Address from the trusted deployment manifest |
| `CHAIN_RUNTIME_SHA256` | SHA-256 of deployed runtime bytecode, from that manifest |
| `CHAIN_RELAYER_ADDRESS` | Address granted the contract's relayer role |
| `CHAIN_FINALITY_TAG` | `finalized`, required outside chain 31337 |
| `CHAIN_MAX_GAS_PRICE_WEI` | Gas-price cap; default 50 gwei |
| `CHAIN_MAX_GAS` | Gas cap per anchor; default 150,000 |
| `CHAIN_MAX_ATTEMPTS` | Consecutive errors before operator recovery; default 12 |
| `CHAIN_POLL_INTERVAL_MS` | One job per interval; default 10 seconds |

Chain 31337 may use `CHAIN_FINALITY_TAG=latest` for local testing. This does not simulate economic finality. Disabled integration queues nothing; enabling it does not backfill history. Deposits, rejected transfers and recorded external settlements do not create receipts.

## Delivery and recovery

A completed transfer and its chain job commit together. The chain queue is independent of the Kafka/SQS/logging outbox. PostgreSQL advisory and row locks serialize relay replicas sharing the database. Java verifies both RPC chain IDs and runtime bytecode before sending. RPC requests have time and response-size bounds. Separate scheduler capacity prevents chain latency from stopping the broker outbox.

Gas price and estimate must satisfy policy. `SUBMITTED` is not `FINALIZED`: finality requires the expected commitment in finalized contract storage and its canonical anchor event. Storage/log lookup recovers an accepted send after a timeout or crash. Duplicate broadcasts cannot overwrite a receipt, though an ambiguous broadcast can spend gas twice. A known pending transaction is never blindly replaced.

Monitor `ledger.chain.pending`, `ledger.chain.failed`, `ledger.chain.errors`, `ledger.chain.submitted` and `ledger.chain.finalized` through authenticated Actuator/Prometheus access. Default capacity is six receipts per minute; size the interval and signer for your traffic and chain fees. Gas spending is opt-in and does not change whether the ledger payment succeeded.

Failed jobs retain their commitment, target and transaction hash. Investigate pause, revoked roles, signer balance/nonce, fee policy, RPC availability and runtime mismatch before recovery. A transaction stalled for 30 minutes stays associated with its hash. Resolve that nonce in the signer before requeueing; do not clear a hash just because one RPC timed out.

After fixing the cause, an operator may requeue one failed job transactionally:

```sql
update chain_receipts
set status = case when transaction_hash is null then 'PENDING' else 'SUBMITTED' end,
    attempts = 0, last_error = null, next_attempt_at = now(), updated_at = now()
where transfer_id = 'TRANSFER_UUID' and status = 'FAILED';
```

This preserves the commitment, salt, target and hash. Never rewrite a commitment to hide a conflict. Chain/address changes do not retarget old jobs; a registry change needs an explicit migration.

## Independent verification

In Activity, open a ledger payment's proof, check its chain receipt and download JSON. The preimage contains private financial data: share it only intentionally. Account IDs, amounts and notes are not published on chain; a random 32-byte salt prevents guessing them from public hashes. The transfer key is SHA-256 of `p2p-ledger/key/v1`, deployment namespace and transfer UUID, separated by newlines.

Set trusted `CHAIN_ID`, `CHAIN_NAMESPACE`, `CHAIN_CONTRACT_ADDRESS`, `CHAIN_RUNTIME_SHA256` and `CHAIN_RPC_URL`, then run:

```sh
npm run verify -- receipt.json
```

It checks the preimage, transfer key, deployment, finalized storage and transaction block. Use an independent execution RPC or your own node when verifying an operator's claim.

## Release boundary

Automated checks are not an independent security audit. Public deployment still requires review, a testnet soak with the actual signer/RPC, source verification, and pause/key-rotation drills with the chosen multisig. The app still simulates funding and has no bank connection or crypto custody. Token settlement or escrow would require a separate contract and accounting design.
