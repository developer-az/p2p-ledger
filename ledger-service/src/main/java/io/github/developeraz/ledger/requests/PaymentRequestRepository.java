package io.github.developeraz.ledger.requests;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class PaymentRequestRepository {
    private final JdbcClient jdbc;

    public PaymentRequestRepository(JdbcClient jdbc) { this.jdbc = jdbc; }

    public Optional<PaymentRequest> find(UUID id, boolean lock) {
        return jdbc.sql("select * from payment_requests where id=:id" + (lock ? " for update" : ""))
                .param("id", id).query(PaymentRequestRepository::map).optional();
    }

    public List<PaymentRequest> list(UUID account, int limit) {
        return jdbc.sql("""
                select * from payment_requests where requester_account_id=:account or payer_account_id=:account
                order by created_at desc, id desc limit :limit
                """).param("account", account).param("limit", limit).query(PaymentRequestRepository::map).list();
    }

    public void insert(PaymentRequest r) {
        jdbc.sql("""
                insert into payment_requests(id,requester_account_id,payer_account_id,amount_minor,currency,memo,created_at)
                values(:id,:requester,:payer,:amount,:currency,:memo,:at)
                """).param("id", r.id()).param("requester", r.requesterAccountId()).param("payer", r.payerAccountId())
                .param("amount", r.amountMinor()).param("currency", r.currency()).param("memo", r.memo())
                .param("at", Timestamp.from(r.createdAt())).update();
    }

    public void resolve(UUID id, String status, UUID transfer, String rail, Instant now) {
        jdbc.sql("""
                update payment_requests set status=:status,transfer_id=:transfer,settled_via=:rail,resolved_at=:at
                where id=:id
                """).param("id", id).param("status", status).param("transfer", transfer).param("rail", rail)
                .param("at", Timestamp.from(now)).update();
    }

    public void declined(UUID id) {
        jdbc.sql("update payment_requests set declined_attempts=declined_attempts+1 where id=:id")
                .param("id", id).update();
    }

    public Optional<UUID> attempt(UUID id, String key) {
        return jdbc.sql("select transfer_id from payment_request_attempts where request_id=:id and idempotency_key=:key")
                .param("id", id).param("key", key).query(UUID.class).optional();
    }

    public void recordAttempt(UUID id, String key, UUID transfer) {
        jdbc.sql("insert into payment_request_attempts values(:id,:key,:transfer)")
                .param("id", id).param("key", key).param("transfer", transfer).update();
    }

    public record Batch(String hash, List<UUID> ids) { }

    public Optional<Batch> batch(UUID account, String key) {
        return jdbc.sql("select request_hash, request_ids from payment_request_batches where requester_account_id=:id and idempotency_key=:key")
                .param("id", account).param("key", key)
                .query((rs, n) -> new Batch(rs.getString(1), List.of((UUID[]) rs.getArray(2).getArray()))).optional();
    }

    public void saveBatch(UUID account, String key, String hash, List<UUID> ids) {
        jdbc.sql("""
                insert into payment_request_batches values(:id,:key,:hash,cast(:ids as uuid[]))
                """).param("id", account).param("key", key).param("hash", hash)
                .param("ids", "{" + String.join(",", ids.stream().map(UUID::toString).toList()) + "}").update();
    }

    private static PaymentRequest map(ResultSet rs, int n) throws SQLException {
        Timestamp resolved = rs.getTimestamp("resolved_at");
        return new PaymentRequest(rs.getObject("id", UUID.class), rs.getObject("requester_account_id", UUID.class),
                rs.getObject("payer_account_id", UUID.class), rs.getLong("amount_minor"), rs.getString("currency"),
                rs.getString("memo"), rs.getString("status"), rs.getObject("transfer_id", UUID.class),
                rs.getString("settled_via"), rs.getInt("declined_attempts"), rs.getTimestamp("created_at").toInstant(),
                resolved == null ? null : resolved.toInstant());
    }
}
