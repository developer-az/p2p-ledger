package io.github.developeraz.ledger.audit;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import io.github.developeraz.ledger.account.LedgerEntry;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class AuditRepository {

    private final JdbcClient jdbc;

    public AuditRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public List<LedgerEntry> entriesForTransfer(UUID transferId) {
        return jdbc.sql("""
                select id, transfer_id, account_id, amount_minor, balance_after_minor, created_at
                from ledger_entries where transfer_id = :id order by id
                """)
                .param("id", transferId)
                .query((rs, n) -> new LedgerEntry(
                        rs.getLong("id"),
                        rs.getObject("transfer_id", UUID.class),
                        rs.getObject("account_id", UUID.class),
                        rs.getLong("amount_minor"),
                        rs.getLong("balance_after_minor"),
                        rs.getTimestamp("created_at").toInstant()))
                .list();
    }

    public List<AuditView.Event> eventsFor(UUID aggregateId) {
        return jdbc.sql("""
                select event_id, event_type, created_at, published_at
                from outbox_events where aggregate_id = :id order by id
                """)
                .param("id", aggregateId)
                .query((rs, n) -> new AuditView.Event(
                        rs.getObject("event_id", UUID.class),
                        rs.getString("event_type"),
                        rs.getTimestamp("created_at").toInstant(),
                        instantOrNull(rs.getTimestamp("published_at"))))
                .list();
    }

    /**
     * Recomputes every invariant from the raw rows instead of trusting the cached balances.
     * Each query is a full scan, which is fine for a nightly job or a small ledger; a large one
     * would checkpoint and only verify entries written since the last clean run.
     */
    public AuditView.Integrity integrity(Instant now) {
        var entries = jdbc.sql("select count(*) as n, coalesce(sum(amount_minor), 0) as total from ledger_entries")
                .query((rs, n) -> new long[] {rs.getLong("n"), rs.getLong("total")})
                .single();
        long transfers = count("select count(*) from transfers");
        long unbalanced = count("""
                select count(*) from (
                    select transfer_id from ledger_entries group by transfer_id having sum(amount_minor) <> 0
                ) t""");
        long rejectedWithEntries = count("""
                select count(*) from transfers t
                where t.status = 'REJECTED' and exists (select 1 from ledger_entries e where e.transfer_id = t.id)""");
        long accounts = count("select count(*) from accounts");
        long drifted = count("""
                select count(*) from accounts a
                left join (select account_id, sum(amount_minor) as total from ledger_entries group by account_id) e
                    on e.account_id = a.id
                where a.balance_minor <> coalesce(e.total, 0)""");
        var outbox = jdbc.sql("""
                select count(*) as total,
                       count(*) filter (where published_at is null) as pending,
                       min(created_at) filter (where published_at is null) as oldest_pending,
                       percentile_cont(0.95) within group (
                           order by extract(epoch from (published_at - created_at)) * 1000
                       ) filter (where published_at is not null) as p95_ms
                from outbox_events
                """)
                .query((rs, n) -> new AuditView.Outbox(
                        rs.getLong("total"),
                        rs.getLong("pending"),
                        instantOrNull(rs.getTimestamp("oldest_pending")),
                        (Double) rs.getObject("p95_ms")))
                .single();
        return new AuditView.Integrity(now, entries[0], entries[1], transfers, unbalanced, rejectedWithEntries,
                accounts, drifted, outbox,
                entries[1] == 0 && unbalanced == 0 && rejectedWithEntries == 0 && drifted == 0);
    }

    /** A posted credit leg of the given transfer, or of the newest completed transfer when none is given. */
    public Optional<LedgerEntry> creditLeg(UUID transferId) {
        return jdbc.sql("""
                select id, transfer_id, account_id, amount_minor, balance_after_minor, created_at
                from ledger_entries
                where amount_minor > 0 and (cast(:id as uuid) is null or transfer_id = :id)
                order by id desc limit 1
                """)
                .param("id", transferId)
                .query((rs, n) -> new LedgerEntry(
                        rs.getLong("id"),
                        rs.getObject("transfer_id", UUID.class),
                        rs.getObject("account_id", UUID.class),
                        rs.getLong("amount_minor"),
                        rs.getLong("balance_after_minor"),
                        rs.getTimestamp("created_at").toInstant()))
                .optional();
    }

    private long count(String sql) {
        return jdbc.sql(sql).query(Long.class).single();
    }

    private static Instant instantOrNull(Timestamp ts) {
        return ts == null ? null : ts.toInstant();
    }
}
