package io.github.developeraz.ledger.chain;

import java.time.Instant;
import java.util.UUID;

public record ChainReceipt(UUID transferId, String transferKey, String commitment, String preimage,
                           long chainId, String contractAddress, String status, String transactionHash,
                           Long blockNumber, int attempts, String lastError, Instant submittedAt, Instant createdAt,
                           Instant updatedAt, Instant nextAttemptAt) {
}
