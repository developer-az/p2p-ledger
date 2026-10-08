package io.github.developeraz.ledger.transfer;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonIgnore;

public record Transfer(
        UUID id,
        @JsonIgnore String idempotencyKey,
        @JsonIgnore String requestHash,
        Kind kind,
        UUID sourceAccountId,
        UUID destinationAccountId,
        long amountMinor,
        String currency,
        String memo,
        Status status,
        String rejectionReason,
        Instant createdAt) {

    public enum Kind { TRANSFER, DEPOSIT }

    public enum Status { COMPLETED, REJECTED }
}
