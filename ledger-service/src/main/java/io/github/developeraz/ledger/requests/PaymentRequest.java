package io.github.developeraz.ledger.requests;

import java.time.Instant;
import java.util.UUID;

public record PaymentRequest(UUID id, UUID requesterAccountId, UUID payerAccountId, long amountMinor,
                             String currency, String memo, String status, UUID transferId, String settledVia,
                             int declinedAttempts, Instant createdAt, Instant resolvedAt) {
}
