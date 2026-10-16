package io.github.developeraz.ledger.audit;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class AuditRepository {

    private final JdbcClient jdbc;

    public AuditRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public long entryCount() {
        return jdbc.sql("select count(*) from ledger_entries").query(Long.class).single();
    }

    public long entriesSumMinor() {
        Long sum = jdbc.sql("select coalesce(sum(amount_minor), 0) from ledger_entries").query(Long.class).single();
        return sum == null ? 0L : sum;
    }

    public long transferCount() {
        return jdbc.sql("select count(*) from transfers").query(Long.class).single();
    }

    public long unbalancedTransfers() {
        return jdbc.sql("""
                select count(*) from (
                    select transfer_id from ledger_entries
                    group by transfer_id
                    having sum(amount_minor) <> 0
                ) u
                """).query(Long.class).single();
    }

    public long rejectedWithEntries() {
        return jdbc.sql("""
                select count(distinct t.id)
                from transfers t
                join ledger_entries e on e.transfer_id = t.id
                where t.status = 'REJECTED'
                """).query(Long.class).single();
    }

    public long userAccountCount() {
        return jdbc.sql("select count(*) from accounts where type = 'USER'").query(Long.class).single();
    }

    public long accountsDrifted() {
        return jdbc.sql("""
                select count(*) from (
                    select a.id
                    from accounts a
                    left join ledger_entries e on e.account_id = a.id
                    group by a.id, a.balance_minor
                    having a.balance_minor <> coalesce(sum(e.amount_minor), 0)
                ) drift
                """).query(Long.class).single();
    }

    public OutboxRow outboxStats() {
        return jdbc.sql("""
                select
                    count(*) as total,
                    count(*) filter (where published_at is null) as pending,
                    min(created_at) filter (where published_at is null) as oldest_pending
                from outbox_events
                """).query((rs, n) -> new OutboxRow(
                rs.getLong("total"),
                rs.getLong("pending"),
                optionalInstant(rs.getTimestamp("oldest_pending"))))
                .single();
    }

    public Optional<Long> outboxP95DeliveryMs() {
        return jdbc.sql("""
                select percentile_cont(0.95) within group (
                    order by extract(epoch from (published_at - created_at)) * 1000
                ) as p95_ms
                from outbox_events
                where published_at is not null
                """).query((rs, n) -> {
            double v = rs.getDouble("p95_ms");
            return rs.wasNull() ? null : (long) Math.round(v);
        }).optional();
    }

    private static Instant optionalInstant(Timestamp ts) {
        return ts == null ? null : ts.toInstant();
    }

    record OutboxRow(long total, long pending, Instant oldestPendingAt) {
    }
}
