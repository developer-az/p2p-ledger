package io.github.developeraz.ledger.account;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class AccountRepository {

    private static final String COLUMNS = "id, owner_id, currency, type, balance_minor, created_at";

    private final JdbcClient jdbc;

    public AccountRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public void insert(Account account) {
        jdbc.sql("""
                insert into accounts (id, owner_id, currency, type, balance_minor, created_at)
                values (:id, :ownerId, :currency, :type, :balance, :createdAt)
                """)
                .param("id", account.id())
                .param("ownerId", account.ownerId())
                .param("currency", account.currency())
                .param("type", account.type().name())
                .param("balance", account.balanceMinor())
                .param("createdAt", Timestamp.from(account.createdAt()))
                .update();
    }

    public Optional<Account> findById(UUID id) {
        return jdbc.sql("select " + COLUMNS + " from accounts where id = :id")
                .param("id", id)
                .query(AccountRepository::mapAccount)
                .optional();
    }

    public Optional<Account> findFundingAccount(String currency) {
        return jdbc.sql("select " + COLUMNS + " from accounts where type = 'SYSTEM' and currency = :currency")
                .param("currency", currency)
                .query(AccountRepository::mapAccount)
                .optional();
    }

    /**
     * Row-locks the given accounts. Locks are always taken in primary-key order, so two
     * transfers touching the same pair of accounts in opposite directions cannot deadlock.
     */
    public List<Account> lockForUpdate(Collection<UUID> ids) {
        return jdbc.sql("select " + COLUMNS + " from accounts where id in (:ids) order by id for update")
                .param("ids", ids)
                .query(AccountRepository::mapAccount)
                .list();
    }

    /** Applies a signed delta and returns the new balance. Caller must hold the row lock. */
    public long applyDelta(UUID id, long deltaMinor) {
        return jdbc.sql("update accounts set balance_minor = balance_minor + :delta where id = :id returning balance_minor")
                .param("delta", deltaMinor)
                .param("id", id)
                .query(Long.class)
                .single();
    }

    public void insertEntry(UUID transferId, UUID accountId, long amountMinor, long balanceAfterMinor, Instant at) {
        jdbc.sql("""
                insert into ledger_entries (transfer_id, account_id, amount_minor, balance_after_minor, created_at)
                values (:transferId, :accountId, :amount, :balanceAfter, :createdAt)
                """)
                .param("transferId", transferId)
                .param("accountId", accountId)
                .param("amount", amountMinor)
                .param("balanceAfter", balanceAfterMinor)
                .param("createdAt", Timestamp.from(at))
                .update();
    }

    /** Keyset-paginated statement, newest first. */
    public List<LedgerEntry> findEntries(UUID accountId, Long beforeId, int limit) {
        return jdbc.sql("""
                select id, transfer_id, account_id, amount_minor, balance_after_minor, created_at
                from ledger_entries
                where account_id = :accountId and (cast(:beforeId as bigint) is null or id < :beforeId)
                order by id desc
                limit :limit
                """)
                .param("accountId", accountId)
                .param("beforeId", beforeId)
                .param("limit", limit)
                .query((rs, n) -> new LedgerEntry(
                        rs.getLong("id"),
                        rs.getObject("transfer_id", UUID.class),
                        rs.getObject("account_id", UUID.class),
                        rs.getLong("amount_minor"),
                        rs.getLong("balance_after_minor"),
                        rs.getTimestamp("created_at").toInstant()))
                .list();
    }

    /** Sum of an account's ledger entries; must always equal its cached balance. */
    public long sumEntries(UUID accountId) {
        return jdbc.sql("select coalesce(sum(amount_minor), 0) from ledger_entries where account_id = :id")
                .param("id", accountId)
                .query(Long.class)
                .single();
    }

    private static Account mapAccount(ResultSet rs, int rowNum) throws SQLException {
        return new Account(
                rs.getObject("id", UUID.class),
                rs.getString("owner_id"),
                rs.getString("currency"),
                Account.AccountType.valueOf(rs.getString("type")),
                rs.getLong("balance_minor"),
                rs.getTimestamp("created_at").toInstant());
    }
}
