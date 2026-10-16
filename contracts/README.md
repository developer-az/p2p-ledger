# On-chain layer (optional, not wired in CI yet)

This folder is reserved for **Ethereum / EVM** artifacts if you add a settlement or attestation layer. The **system of record** remains `ledger-service` (PostgreSQL) unless you deliberately flip that model — see [docs/P2P-SOLIDITY-AND-SCALE.md](../docs/P2P-SOLIDITY-AND-SCALE.md).

## Intended integration

1. `ledger-service` commits a transfer and an `outbox_events` row in one transaction.
2. A **bridge worker** (new service, not in this repo yet) reads Kafka/SQS or polls outbox.
3. The worker calls a contract (e.g. `commitTransfer(bytes32 ledgerTransferId, bytes32 payloadHash)`) or releases escrow when policy matches.
4. Deposits from chain → Java **only after** N confirmations, with a unique `Idempotency-Key` per chain tx.

## Tooling (when you implement)

- [Foundry](https://book.getfoundry.sh/) or Hardhat for compile/test.
- Separate secrets: deployer key, RPC URL, chain id — **never** in the assistant bundle.
- No private keys in Vercel for contract admin; use a signer in the bridge worker only.

## Example contract sketch (documentation only)

```solidity
// SPDX-License-Identifier: MIT
// Not compiled in this repo — illustration for attestation anchoring.
pragma solidity ^0.8.20;

contract LedgerAttestation {
    event TransferAnchored(bytes32 indexed ledgerTransferId, bytes32 payloadHash, address indexed relayer);

    function anchor(bytes32 ledgerTransferId, bytes32 payloadHash) external {
        emit TransferAnchored(ledgerTransferId, payloadHash, msg.sender);
    }
}
```

Add real access control (`onlyRelayer`), replay protection, and chain choice before any mainnet deploy.
