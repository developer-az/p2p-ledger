package io.github.developeraz.ledger.audit;

import java.sql.Timestamp;
import java.time.Clock;
import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;

import io.github.developeraz.ledger.account.LedgerEntry;
import io.github.developeraz.ledger.common.NotFoundException;
import io.github.developeraz.ledger.transfer.Transfer;
import io.github.developeraz.ledger.transfer.TransferRepository;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class AuditService {

    private final AuditRepository audit;
    private final TransferRepository transfers;
    private final JdbcClient jdbc;
    private final TransactionTemplate tx;
    private final Clock clock;

    public AuditService(AuditRepository audit, TransferRepository transfers, JdbcClient jdbc, TransactionTemplate tx,
                        Clock clock) {
        this.audit = audit;
        this.transfers = transfers;
        this.jdbc = jdbc;
        this.tx = tx;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public AuditView.Trail trail(UUID transferId) {
        Transfer t = transfers.findById(transferId)
                .orElseThrow(() -> new NotFoundException("Transfer not found: " + transferId));
        return new AuditView.Trail(t, t.idempotencyKey(), t.requestHash(), audit.entriesForTransfer(t.id()),
                audit.eventsFor(t.id()));
    }

    @Transactional(readOnly = true)
    public AuditView.Integrity integrity() {
        return audit.integrity(clock.instant());
    }

    /**
     * Tries the writes the schema is meant to make impossible, each in its own transaction that
     * is rolled back whatever happens. The point is to show the database refusing them, so a bug
     * in application code could not do them either.
     */
    public AuditView.TamperReport tamper(UUID transferId) {
        LedgerEntry leg = tx.execute(s -> audit.creditLeg(transferId))
                .orElseThrow(() -> new NotFoundException(transferId == null
                        ? "No posted entries yet"
                        : "Transfer has no posted entries (declined transfers move no money): " + transferId));
        List<AuditView.TamperAttempt> attempts = List.of(
                attempt("Change the amount on a posted entry",
                        "update ledger_entries set amount_minor = amount_minor + 100 where id = " + leg.id(),
                        db -> db.sql("update ledger_entries set amount_minor = amount_minor + 100 where id = :id")
                                .param("id", leg.id()).update()),
                attempt("Delete a posted entry",
                        "delete from ledger_entries where id = " + leg.id(),
                        db -> db.sql("delete from ledger_entries where id = :id").param("id", leg.id()).update()),
                attempt("Post one side of a payment without the other",
                        "insert into ledger_entries (transfer_id, account_id, amount_minor, ...) values ('"
                                + leg.transferId() + "', ..., 100, ...)",
                        db -> {
                            db.sql("""
                                    insert into ledger_entries (transfer_id, account_id, amount_minor,
                                        balance_after_minor, created_at)
                                    values (:transferId, :accountId, 100, :balance, :at)
                                    """)
                                    .param("transferId", leg.transferId())
                                    .param("accountId", leg.accountId())
                                    .param("balance", leg.balanceAfterMinor() + 100)
                                    .param("at", Timestamp.from(clock.instant()))
                                    .update();
                            // The balance check is deferred to commit; run it now so the refusal is visible.
                            db.sql("set constraints ledger_entries_balanced immediate").update();
                        }),
                attempt("Overdraw a customer account",
                        "update accounts set balance_minor = -1 where id = '" + leg.accountId() + "'",
                        db -> db.sql("update accounts set balance_minor = -1 where id = :id and type = 'USER'")
                                .param("id", leg.accountId()).update()));
        return new AuditView.TamperReport(leg.transferId(), leg.accountId(), attempts);
    }

    private AuditView.TamperAttempt attempt(String label, String sql, Consumer<JdbcClient> write) {
        try {
            tx.executeWithoutResult(status -> {
                status.setRollbackOnly();
                write.accept(jdbc);
            });
            return new AuditView.TamperAttempt(label, sql, false, "Accepted, then rolled back by this check.");
        } catch (DataAccessException e) {
            return new AuditView.TamperAttempt(label, sql, true, postgresMessage(e));
        }
    }

    static String postgresMessage(DataAccessException e) {
        String message = String.valueOf(e.getMostSpecificCause().getMessage());
        String first = message.lines().findFirst().orElse(message).trim();
        return first.startsWith("ERROR: ") ? first.substring("ERROR: ".length()) : first;
    }
}
