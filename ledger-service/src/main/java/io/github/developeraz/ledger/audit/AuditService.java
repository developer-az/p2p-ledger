package io.github.developeraz.ledger.audit;

import java.time.Clock;

import org.springframework.stereotype.Service;

@Service
public class AuditService {

    private final AuditRepository repository;
    private final Clock clock;

    public AuditService(AuditRepository repository, Clock clock) {
        this.repository = repository;
        this.clock = clock;
    }

    public AuditView integrity() {
        long entriesSum = repository.entriesSumMinor();
        long unbalanced = repository.unbalancedTransfers();
        long drifted = repository.accountsDrifted();
        var outboxRow = repository.outboxStats();
        Long p95 = repository.outboxP95DeliveryMs().orElse(null);
        boolean balanced = entriesSum == 0 && unbalanced == 0 && drifted == 0;
        return new AuditView(
                clock.instant(),
                repository.entryCount(),
                entriesSum,
                repository.transferCount(),
                unbalanced,
                repository.rejectedWithEntries(),
                repository.userAccountCount(),
                drifted,
                new AuditView.OutboxStats(outboxRow.total(), outboxRow.pending(), outboxRow.oldestPendingAt(), p95),
                balanced);
    }
}
