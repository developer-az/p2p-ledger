package io.github.developeraz.ledger.chain;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import io.github.developeraz.ledger.transfer.Transfer;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class ChainReceiptRepository {
    private final JdbcClient jdbc;
    private final ChainProperties config;
    private final Clock clock;

    public ChainReceiptRepository(JdbcClient jdbc, ChainProperties config, Clock clock) {
        this.jdbc = jdbc; this.config = config; this.clock = clock; config.validate();
    }

    /** Called in the money transaction. Disabled means no gas obligations are queued. */
    public void enqueue(Transfer transfer) {
        if (!config.enabled() || transfer.status() != Transfer.Status.COMPLETED || transfer.kind() != Transfer.Kind.TRANSFER) return;
        String preimage = Commitment.preimage(transfer);
        jdbc.sql("""
                insert into chain_receipts(transfer_id,transfer_key,commitment,preimage,chain_id,contract_address,
                    created_at,updated_at,next_attempt_at)
                values(:id,:key,:commitment,:preimage,:chain,:contract,:at,:at,:at)
                on conflict(transfer_id) do nothing
                """).param("id", transfer.id()).param("key", Commitment.key(config.namespace(), transfer.id()))
                .param("commitment", "0x" + Commitment.sha256(preimage)).param("preimage", preimage)
                .param("chain", config.chainId()).param("contract", config.contractAddress().toLowerCase())
                .param("at", Timestamp.from(clock.instant())).update();
    }
    public Optional<ChainReceipt> find(UUID id) {
        return jdbc.sql("select * from chain_receipts where transfer_id=:id").param("id", id).query(ChainReceiptRepository::map).optional();
    }
    public boolean lockRelayer() {
        // A transaction-scoped lock serializes all senders in this database (including multiple JVM replicas).
        return jdbc.sql("select pg_try_advisory_xact_lock(748392105)").query(Boolean.class).single();
    }
    public Optional<ChainReceipt> claim() {
        return jdbc.sql("""
                select * from chain_receipts where status in ('PENDING','SUBMITTED') and next_attempt_at<=:now
                order by next_attempt_at,transfer_id limit 1 for update skip locked
                """).param("now", Timestamp.from(clock.instant())).query(ChainReceiptRepository::map).optional();
    }
    public void update(UUID id, String status, String hash, Long block, int attempts, String error, Instant next) {
        jdbc.sql("""
                update chain_receipts set status=:status,transaction_hash=:hash,block_number=:block,attempts=:attempts,
                    submitted_at=coalesce(submitted_at,case when :status='SUBMITTED' then cast(:now as timestamptz) end),
                    last_error=:error,updated_at=:now,next_attempt_at=:next where transfer_id=:id
                """).param("id", id).param("status", status).param("hash", hash).param("block", block)
                .param("attempts", attempts).param("error", error).param("now", Timestamp.from(clock.instant()))
                .param("next", Timestamp.from(next)).update();
    }
    public long pendingCount() {
        return jdbc.sql("select count(*) from chain_receipts where status in ('PENDING','SUBMITTED')").query(Long.class).single();
    }
    public long failedCount() {
        return jdbc.sql("select count(*) from chain_receipts where status='FAILED'").query(Long.class).single();
    }
    private static ChainReceipt map(ResultSet r, int n) throws SQLException {
        return new ChainReceipt(r.getObject("transfer_id", UUID.class), r.getString("transfer_key"), r.getString("commitment"),
                r.getString("preimage"), r.getLong("chain_id"), r.getString("contract_address"), r.getString("status"),
                r.getString("transaction_hash"), r.getObject("block_number", Long.class), r.getInt("attempts"), r.getString("last_error"),
                r.getTimestamp("submitted_at") == null ? null : r.getTimestamp("submitted_at").toInstant(),
                r.getTimestamp("created_at").toInstant(), r.getTimestamp("updated_at").toInstant(), r.getTimestamp("next_attempt_at").toInstant());
    }
}
