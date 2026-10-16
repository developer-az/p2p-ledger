package io.github.developeraz.ledger.audit;

import java.time.Instant;

public record AuditView(
        Instant checkedAt,
        long entryCount,
        long entriesSumMinor,
        long transferCount,
        long unbalancedTransfers,
        long rejectedWithEntries,
        long accountCount,
        long accountsDrifted,
        OutboxStats outbox,
        boolean balanced) {

    public record OutboxStats(long total, long pending, Instant oldestPendingAt, Long p95DeliveryMs) {
    }
}
