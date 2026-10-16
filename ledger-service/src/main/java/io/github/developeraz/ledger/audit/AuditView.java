package io.github.developeraz.ledger.audit;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import io.github.developeraz.ledger.account.LedgerEntry;
import io.github.developeraz.ledger.transfer.Transfer;

/** Read models for operators: what happened to one payment, and whether the books still add up. */
public final class AuditView {

    private AuditView() {
    }

    /**
     * Everything the database holds about one request. The idempotency key and request hash are
     * what a client replays with; a declined transfer has no entries because it moved no money.
     */
    public record Trail(Transfer transfer, String idempotencyKey, String requestHash, List<LedgerEntry> entries,
                        List<Event> events) {
    }

    public record Event(UUID eventId, String eventType, Instant createdAt, Instant publishedAt) {
    }

    public record Outbox(long total, long pending, Instant oldestPendingAt, Double p95DeliveryMs) {
    }

    public record Integrity(Instant checkedAt, long entryCount, long entriesSumMinor, long transferCount,
                            long unbalancedTransfers, long rejectedWithEntries, long accountCount,
                            long accountsDrifted, Outbox outbox, boolean balanced) {
    }

    /** One forbidden write, attempted in a transaction that is always rolled back. */
    public record TamperAttempt(String attempt, String sql, boolean refused, String databaseSaid) {
    }

    public record TamperReport(UUID transferId, UUID accountId, List<TamperAttempt> attempts) {
    }
}
