package io.github.developeraz.ledger.fraud;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * Aggregates the rules need. Both queries are served by the (source_account_id, created_at)
 * index, and they run while the source account row is locked, so concurrent transfers
 * from one account see each other's effects and cannot jointly slip past a limit.
 */
@Repository
public class FraudStatsRepository {

    private final JdbcClient jdbc;

    public FraudStatsRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public int countTransfersSince(UUID sourceAccountId, Instant since) {
        return jdbc.sql("""
                select count(*) from transfers
                where source_account_id = :id and kind = 'TRANSFER' and created_at >= :since
                """)
                .param("id", sourceAccountId)
                .param("since", Timestamp.from(since))
                .query(Integer.class)
                .single();
    }

    public long completedOutflowSince(UUID sourceAccountId, Instant since) {
        return jdbc.sql("""
                select coalesce(sum(amount_minor), 0) from transfers
                where source_account_id = :id and kind = 'TRANSFER' and status = 'COMPLETED'
                  and created_at >= :since
                """)
                .param("id", sourceAccountId)
                .param("since", Timestamp.from(since))
                .query(Long.class)
                .single();
    }
}
