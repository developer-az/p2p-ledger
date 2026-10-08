package io.github.developeraz.ledger.transfer;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class TransferRepository {

    private static final String COLUMNS = """
            id, idempotency_key, request_hash, kind, source_account_id, destination_account_id,
            amount_minor, currency, memo, status, rejection_reason, created_at""";

    private final JdbcClient jdbc;

    public TransferRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Inserts unless the idempotency key already exists. If another transaction inserted the
     * same key but has not committed, Postgres blocks here until it does, then reports the
     * conflict, so concurrent duplicates resolve to exactly one winner.
     *
     * @return true if this call inserted the row
     */
    public boolean insertIfAbsent(Transfer t) {
        int rows = jdbc.sql("""
                insert into transfers (id, idempotency_key, request_hash, kind, source_account_id,
                    destination_account_id, amount_minor, currency, memo, status, rejection_reason, created_at)
                values (:id, :key, :hash, :kind, :source, :destination, :amount, :currency, :memo, :status,
                    :reason, :createdAt)
                on conflict (idempotency_key) do nothing
                """)
                .param("id", t.id())
                .param("key", t.idempotencyKey())
                .param("hash", t.requestHash())
                .param("kind", t.kind().name())
                .param("source", t.sourceAccountId())
                .param("destination", t.destinationAccountId())
                .param("amount", t.amountMinor())
                .param("currency", t.currency())
                .param("memo", t.memo())
                .param("status", t.status().name())
                .param("reason", t.rejectionReason())
                .param("createdAt", Timestamp.from(t.createdAt()))
                .update();
        return rows == 1;
    }

    public Optional<Transfer> findByIdempotencyKey(String key) {
        return jdbc.sql("select " + COLUMNS + " from transfers where idempotency_key = :key")
                .param("key", key)
                .query(TransferRepository::map)
                .optional();
    }

    public Optional<Transfer> findById(UUID id) {
        return jdbc.sql("select " + COLUMNS + " from transfers where id = :id")
                .param("id", id)
                .query(TransferRepository::map)
                .optional();
    }

    /** Transfers where the account is either side, newest first (UUIDv7 ids sort by time). */
    public List<Transfer> findByAccount(UUID accountId, int limit) {
        return jdbc.sql("""
                select %s from transfers where source_account_id = :id
                union all
                select %s from transfers where destination_account_id = :id
                order by id desc
                limit :limit
                """.formatted(COLUMNS, COLUMNS))
                .param("id", accountId)
                .param("limit", limit)
                .query(TransferRepository::map)
                .list();
    }

    private static Transfer map(ResultSet rs, int rowNum) throws SQLException {
        return new Transfer(
                rs.getObject("id", UUID.class),
                rs.getString("idempotency_key"),
                rs.getString("request_hash"),
                Transfer.Kind.valueOf(rs.getString("kind")),
                rs.getObject("source_account_id", UUID.class),
                rs.getObject("destination_account_id", UUID.class),
                rs.getLong("amount_minor"),
                rs.getString("currency"),
                rs.getString("memo"),
                Transfer.Status.valueOf(rs.getString("status")),
                rs.getString("rejection_reason"),
                rs.getTimestamp("created_at").toInstant());
    }
}
