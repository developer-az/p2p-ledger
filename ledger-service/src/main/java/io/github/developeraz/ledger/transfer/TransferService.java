package io.github.developeraz.ledger.transfer;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import io.github.developeraz.ledger.account.Account;
import io.github.developeraz.ledger.account.AccountRepository;
import io.github.developeraz.ledger.common.BadRequestException;
import io.github.developeraz.ledger.common.NotFoundException;
import io.github.developeraz.ledger.common.UuidV7;
import io.github.developeraz.ledger.fraud.FraudEngine;
import io.github.developeraz.ledger.fraud.TransferContext;
import io.github.developeraz.ledger.outbox.OutboxRepository;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Moves money. Each call runs in one database transaction that, in order:
 * <ol>
 *   <li>returns the stored result if the idempotency key was seen before,</li>
 *   <li>row-locks both accounts (in id order, so no deadlocks),</li>
 *   <li>runs fraud rules and the balance check against the locked state,</li>
 *   <li>records the transfer, its two ledger entries and an outbox event.</li>
 * </ol>
 * Declined transfers are stored too, so retrying a declined request returns the same decline.
 */
@Service
public class TransferService {

    public record Command(Transfer.Kind kind, UUID sourceAccountId, UUID destinationAccountId, long amountMinor,
                          String currency, String memo) {
    }

    public record Result(Transfer transfer, boolean replayed) {
    }

    private final TransferRepository transfers;
    private final AccountRepository accounts;
    private final OutboxRepository outbox;
    private final FraudEngine fraud;
    private final MeterRegistry meters;
    private final Clock clock;

    public TransferService(TransferRepository transfers, AccountRepository accounts, OutboxRepository outbox,
                           FraudEngine fraud, MeterRegistry meters, Clock clock) {
        this.transfers = transfers;
        this.accounts = accounts;
        this.outbox = outbox;
        this.fraud = fraud;
        this.meters = meters;
        this.clock = clock;
    }

    @Transactional
    public Result transfer(String idempotencyKey, UUID source, UUID destination, long amountMinor, String currency,
                           String memo) {
        return execute(idempotencyKey,
                new Command(Transfer.Kind.TRANSFER, source, destination, amountMinor, currency, memo));
    }

    /** Funds an account from the currency's external funding account (simulates a bank top-up). */
    @Transactional
    public Result deposit(String idempotencyKey, UUID accountId, long amountMinor, String memo) {
        Account account = accounts.findById(accountId)
                .orElseThrow(() -> new NotFoundException("Account not found: " + accountId));
        Account funding = accounts.findFundingAccount(account.currency())
                .orElseThrow(() -> new IllegalStateException("No funding account for " + account.currency()));
        return execute(idempotencyKey,
                new Command(Transfer.Kind.DEPOSIT, funding.id(), accountId, amountMinor, account.currency(), memo));
    }

    @Transactional(readOnly = true)
    public Transfer get(UUID id) {
        return transfers.findById(id).orElseThrow(() -> new NotFoundException("Transfer not found: " + id));
    }

    @Transactional(readOnly = true)
    public List<Transfer> forAccount(UUID accountId, int limit) {
        return transfers.findByAccount(accountId, limit);
    }

    private Result execute(String key, Command cmd) {
        String hash = hash(cmd);
        Optional<Transfer> existing = transfers.findByIdempotencyKey(key);
        if (existing.isPresent()) {
            return replay(key, hash, existing.get());
        }
        if (cmd.sourceAccountId().equals(cmd.destinationAccountId())) {
            throw new BadRequestException("Source and destination accounts must differ");
        }

        Map<UUID, Account> locked = accounts.lockForUpdate(List.of(cmd.sourceAccountId(), cmd.destinationAccountId()))
                .stream()
                .collect(Collectors.toMap(Account::id, Function.identity()));
        Account source = require(locked, cmd.sourceAccountId());
        Account destination = require(locked, cmd.destinationAccountId());
        validate(cmd, source, destination);

        Instant now = clock.instant();
        String rejection = decide(cmd, source, destination, now);
        Transfer transfer = new Transfer(UuidV7.generate(clock), key, hash, cmd.kind(), source.id(), destination.id(),
                cmd.amountMinor(), cmd.currency(), cmd.memo(),
                rejection == null ? Transfer.Status.COMPLETED : Transfer.Status.REJECTED, rejection, now);

        if (!transfers.insertIfAbsent(transfer)) {
            // A concurrent request with the same key committed first.
            return replay(key, hash, transfers.findByIdempotencyKey(key).orElseThrow());
        }

        if (transfer.status() == Transfer.Status.COMPLETED) {
            long sourceBalance = accounts.applyDelta(source.id(), -cmd.amountMinor());
            long destinationBalance = accounts.applyDelta(destination.id(), cmd.amountMinor());
            accounts.insertEntry(transfer.id(), source.id(), -cmd.amountMinor(), sourceBalance, now);
            accounts.insertEntry(transfer.id(), destination.id(), cmd.amountMinor(), destinationBalance, now);
        }

        outbox.append(eventType(transfer), transfer.id(), transfer);
        meters.counter("ledger.transfers", "kind", transfer.kind().name(), "status", transfer.status().name())
                .increment();
        return new Result(transfer, false);
    }

    private String decide(Command cmd, Account source, Account destination, Instant now) {
        if (cmd.kind() == Transfer.Kind.DEPOSIT) {
            return null;
        }
        Optional<String> fraudReason = fraud.check(new TransferContext(source, destination, cmd.amountMinor(), now));
        if (fraudReason.isPresent()) {
            return fraudReason.get();
        }
        return source.balanceMinor() < cmd.amountMinor() ? "INSUFFICIENT_FUNDS" : null;
    }

    private static void validate(Command cmd, Account source, Account destination) {
        if (!source.currency().equals(cmd.currency()) || !destination.currency().equals(cmd.currency())) {
            throw new BadRequestException("Currency " + cmd.currency() + " does not match both accounts");
        }
        if (cmd.kind() == Transfer.Kind.TRANSFER
                && (source.type() != Account.AccountType.USER || destination.type() != Account.AccountType.USER)) {
            throw new BadRequestException("Transfers are only allowed between user accounts");
        }
    }

    private static Account require(Map<UUID, Account> locked, UUID id) {
        Account account = locked.get(id);
        if (account == null) {
            throw new NotFoundException("Account not found: " + id);
        }
        return account;
    }

    private static Result replay(String key, String hash, Transfer existing) {
        if (!existing.requestHash().equals(hash)) {
            throw new IdempotencyConflictException(key);
        }
        return new Result(existing, true);
    }

    private static String eventType(Transfer t) {
        String prefix = t.kind() == Transfer.Kind.DEPOSIT ? "Deposit" : "Transfer";
        return prefix + (t.status() == Transfer.Status.COMPLETED ? "Completed" : "Rejected");
    }

    static String hash(Command cmd) {
        String canonical = String.join("|", cmd.kind().name(), cmd.sourceAccountId().toString(),
                cmd.destinationAccountId().toString(), Long.toString(cmd.amountMinor()), cmd.currency(),
                Objects.toString(cmd.memo(), ""));
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(canonical.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
