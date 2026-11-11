package io.github.developeraz.ledger.spending;

import java.io.StringReader;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.apache.commons.csv.CSVFormat;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import io.github.developeraz.ledger.account.Account;
import io.github.developeraz.ledger.account.AccountRepository;
import io.github.developeraz.ledger.chain.Commitment;
import io.github.developeraz.ledger.common.BadRequestException;
import io.github.developeraz.ledger.common.NotFoundException;
import io.github.developeraz.ledger.common.UuidV7;
import io.github.developeraz.ledger.transfer.IdempotencyConflictException;
import tools.jackson.databind.json.JsonMapper;

@Service
public class SpendingService {
    public static final Set<String> CATEGORIES = Set.of("dining","groceries","transport","entertainment","housing","shopping","health","other");
    private final JdbcClient jdbc;
    private final AccountRepository accounts;
    private final Clock clock;
    private final JsonMapper json;
    public SpendingService(JdbcClient jdbc, AccountRepository accounts, Clock clock, JsonMapper json) {
        this.jdbc=jdbc; this.accounts=accounts; this.clock=clock; this.json=json;
    }
    public record Input(long amountMinor, String category, String note, Instant occurredAt, String source, String currency) { }
    public record ImportResult(int imported, int duplicates, int rows) { }

    @Transactional
    public SpendLog record(UUID accountId, Input input, String key) {
        Account account = lock(accountId);
        validate(account, input);
        String hash = Commitment.sha256(json.writeValueAsString(input));
        var operation = jdbc.sql("select request_hash,spend_id from spend_log_operations where account_id=:id and idempotency_key=:key")
                .param("id", accountId).param("key", key)
                .query((r,n) -> new String[]{r.getString(1),r.getString(2)}).optional();
        if (operation.isPresent()) {
            if (!hash.equals(operation.get()[0])) throw new IdempotencyConflictException(key);
            return get(accountId, UUID.fromString(operation.get()[1]));
        }
        SpendLog entry = entry(account, input);
        insert(entry, null);
        jdbc.sql("insert into spend_log_operations values(:id,:key,:hash,:spend)")
                .param("id", accountId).param("key", key).param("hash", hash).param("spend", entry.id()).update();
        return get(accountId, entry.id());
    }

    @Transactional(readOnly=true)
    public List<SpendLog> list(UUID account, Instant since, int limit) {
        return list(account, since, null, null, limit);
    }

    /** Newest first; before + beforeId is a keyset cursor (the last row of the previous page). */
    @Transactional(readOnly=true)
    public List<SpendLog> list(UUID account, Instant since, Instant before, UUID beforeId, int limit) {
        boolean paged = before != null && beforeId != null;
        return jdbc.sql("""
                select * from spend_logs where account_id=:account and occurred_at>=:since
                """ + (paged ? " and (occurred_at, id) < (:before, :beforeId)" : "") + """
                 order by occurred_at desc,id desc limit :limit
                """).param("account", account).param("since", Timestamp.from(since == null ? Instant.EPOCH : since))
                .param("before", Timestamp.from(paged ? before : Instant.EPOCH)).param("beforeId", paged ? beforeId : new UUID(0, 0))
                .param("limit", limit).query(SpendingService::map).list();
    }

    @Transactional
    public boolean remove(UUID account, UUID id) {
        // Serialize with record/import so removal cannot race an idempotent create.
        lock(account);
        return jdbc.sql("delete from spend_logs where account_id=:account and id=:id")
                .param("account", account).param("id", id).update() == 1;
    }

    /** Strict, atomic import. Explicit transaction IDs deduplicate overlapping files; otherwise exact-file replay only. */
    @Transactional
    public ImportResult importCsv(UUID accountId, String content) {
        return importCsv(accountId,content,"UTC");
    }

    @Transactional
    public ImportResult importCsv(UUID accountId, String content, String timeZone) {
        if (content == null || content.length() > 1_000_000 || content.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 1_000_000)
            throw new BadRequestException("CSV must be at most 1 MB");
        java.time.ZoneId zone;
        try { zone=java.time.ZoneId.of(timeZone == null ? "UTC" : timeZone); }
        catch (java.time.DateTimeException e) { throw new BadRequestException("Invalid import time zone"); }
        Account account = lock(accountId);
        String fileHash = Commitment.sha256(content);
        int rows=0, imported=0;
        try (var parser = CSVFormat.RFC4180.builder().setHeader().setSkipHeaderRecord(true)
                .setIgnoreEmptyLines(true).setAllowMissingColumnNames(false).setDuplicateHeaderMode(org.apache.commons.csv.DuplicateHeaderMode.DISALLOW)
                .get().parse(new StringReader(content.startsWith("\uFEFF") ? content.substring(1) : content))) {
            var headers = parser.getHeaderMap();
            if (!headers.containsKey("date") || !headers.containsKey("amount")) throw new BadRequestException("CSV needs date and amount headers");
            for (String header : headers.keySet())
                if (!Set.of("date","amount","category","note","transactionId").contains(header))
                    throw new BadRequestException("Unknown CSV header: " + header);
            for (var row : parser) {
                if (++rows > 2000) throw new BadRequestException("CSV may contain at most 2000 rows");
                if (!row.isConsistent()) throw new BadRequestException("CSV column count differs at row " + rows);
                String amount = row.get("amount").trim();
                if (!amount.matches("[0-9]{1,14}(\\.[0-9]{1,2})?")) throw new BadRequestException("Use positive decimal expenses with at most two decimals at row " + rows);
                long minor = new BigDecimal(amount).movePointRight(2).longValueExact();
                Instant date = LocalDate.parse(row.get("date").trim()).atStartOfDay(zone).toInstant();
                String category = headers.containsKey("category") && !row.get("category").isBlank() ? row.get("category").trim() : "other";
                String note = headers.containsKey("note") && !row.get("note").isBlank() ? row.get("note").trim() : null;
                Input input = new Input(minor, category, note, date, "import", account.currency());
                validate(account, input);
                String externalId = headers.containsKey("transactionId") ? row.get("transactionId").trim() : "";
                if (externalId.length() > 200) throw new BadRequestException("transactionId is too long at row " + rows);
                String importKey = Commitment.sha256(externalId.isEmpty() ? "file/" + fileHash + "/" + rows : "transaction/" + externalId);
                SpendLog entry = entry(account, input);
                int inserted = insert(entry, importKey);
                if (inserted == 0) {
                    SpendLog previous = jdbc.sql("select * from spend_logs where account_id=:id and import_key=:key")
                            .param("id", accountId).param("key", importKey).query(SpendingService::map).single();
                    if (previous.amountMinor() != minor || !previous.occurredAt().equals(date) || !previous.category().equals(category)
                            || !java.util.Objects.equals(previous.note(), note))
                        throw new BadRequestException("transactionId was reused with different data at row " + rows);
                }
                imported += inserted;
            }
        } catch (BadRequestException e) { throw e; }
        catch (java.time.DateTimeException | java.io.IOException | java.io.UncheckedIOException | IllegalArgumentException | ArithmeticException e) {
            throw new BadRequestException("Invalid CSV near row " + (rows+1) + "; use YYYY-MM-DD dates and decimal expense amounts");
        }
        if (rows == 0) throw new BadRequestException("CSV contains no expenses");
        return new ImportResult(imported, rows-imported, rows);
    }

    private Account lock(UUID id) {
        Account account = accounts.lockForUpdate(List.of(id)).stream().findFirst().orElseThrow(() -> new NotFoundException("Account not found"));
        if (account.type() != Account.AccountType.USER) throw new BadRequestException("Spending logs require a user account");
        return account;
    }
    private void validate(Account account, Input input) {
        if (input.amountMinor() <= 0 || input.amountMinor() > 9_007_199_254_740_991L) throw new BadRequestException("Invalid expense amount");
        if (!CATEGORIES.contains(input.category() == null ? "" : input.category())) throw new BadRequestException("Invalid category");
        if (input.note() != null && input.note().length() > 140) throw new BadRequestException("Note exceeds 140 characters");
        if (input.currency() != null && !account.currency().equals(input.currency())) throw new BadRequestException("Currency does not match account");
        if (input.source() != null && !Set.of("manual","cmd","import").contains(input.source())) throw new BadRequestException("Invalid expense source");
        if (input.occurredAt() != null && (input.occurredAt().isBefore(Instant.EPOCH) || input.occurredAt().isAfter(clock.instant().plusSeconds(86400))))
            throw new BadRequestException("Expense date is outside the supported range");
    }
    private SpendLog entry(Account account, Input input) {
        return new SpendLog(UuidV7.generate(clock), account.id(), input.amountMinor(), account.currency(), input.category(), input.note(),
                input.occurredAt() == null ? clock.instant() : input.occurredAt(), input.source() == null ? "manual" : input.source(), clock.instant());
    }
    private int insert(SpendLog e, String importKey) {
        return jdbc.sql("""
                insert into spend_logs(id,account_id,amount_minor,currency,category,note,occurred_at,source,created_at,import_key)
                values(:id,:account,:amount,:currency,:category,:note,:occurred,:source,:created,:importKey)
                on conflict(account_id,import_key) where import_key is not null do nothing
                """).param("id", e.id()).param("account", e.accountId()).param("amount", e.amountMinor()).param("currency", e.currency())
                .param("category", e.category()).param("note", e.note()).param("occurred", Timestamp.from(e.occurredAt()))
                .param("source", e.source()).param("created", Timestamp.from(e.createdAt())).param("importKey", importKey).update();
    }
    private SpendLog get(UUID account, UUID id) {
        return jdbc.sql("select * from spend_logs where account_id=:account and id=:id").param("account", account).param("id", id)
                .query(SpendingService::map).optional().orElseThrow(() -> new NotFoundException("This expense was removed; use a new idempotency key"));
    }
    private static SpendLog map(ResultSet r, int n) throws SQLException {
        return new SpendLog(r.getObject("id", UUID.class),r.getObject("account_id",UUID.class),r.getLong("amount_minor"),r.getString("currency"),
                r.getString("category"),r.getString("note"),r.getTimestamp("occurred_at").toInstant(),r.getString("source"),r.getTimestamp("created_at").toInstant());
    }
}
