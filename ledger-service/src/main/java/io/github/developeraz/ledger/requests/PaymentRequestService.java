package io.github.developeraz.ledger.requests;

import java.time.Clock;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import io.github.developeraz.ledger.account.Account;
import io.github.developeraz.ledger.account.AccountRepository;
import io.github.developeraz.ledger.common.BadRequestException;
import io.github.developeraz.ledger.common.NotFoundException;
import io.github.developeraz.ledger.common.UuidV7;
import io.github.developeraz.ledger.transfer.Transfer;
import io.github.developeraz.ledger.transfer.TransferService;
import io.github.developeraz.ledger.transfer.IdempotencyConflictException;
import io.github.developeraz.ledger.chain.Commitment;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;

@Service
public class PaymentRequestService {
    private static final Set<String> RAILS = Set.of("zelle", "cashapp", "venmo", "cash", "crypto", "other");
    private final PaymentRequestRepository requests;
    private final AccountRepository accounts;
    private final TransferService transfers;
    private final JsonMapper json;
    private final Clock clock;

    public PaymentRequestService(PaymentRequestRepository requests, AccountRepository accounts,
                                 TransferService transfers, JsonMapper json, Clock clock) {
        this.requests = requests; this.accounts = accounts; this.transfers = transfers; this.json = json; this.clock = clock;
    }

    public record Payer(UUID accountId, long amountMinor) { }
    public record Split(UUID requesterAccountId, List<Payer> payers, String memo) { }
    public record Payment(PaymentRequest request, Transfer transfer) { }

    /** Validates the whole split before inserting anything; the account lock serializes batch-key replays. */
    @Transactional
    public List<PaymentRequest> split(Split input, String key) {
        Account requester = accounts.lockForUpdate(List.of(input.requesterAccountId())).stream().findFirst()
                .orElseThrow(() -> new NotFoundException("Requester not found"));
        String hash = Commitment.sha256(json.writeValueAsString(input));
        var batch = requests.batch(requester.id(), key);
        if (batch.isPresent()) {
            if (!hash.equals(batch.get().hash())) throw new IdempotencyConflictException(key);
            return batch.get().ids().stream().map(this::get).toList();
        }
        if (requester.type() != Account.AccountType.USER || input.payers().isEmpty() || input.payers().size() > 8)
            throw new BadRequestException("A split needs a user requester and one to eight payers");
        Set<UUID> seen = new HashSet<>();
        for (Payer p : input.payers()) {
            if (p.amountMinor() <= 0 || p.amountMinor() > 9_007_199_254_740_991L || p.accountId().equals(requester.id()) || !seen.add(p.accountId()))
                throw new BadRequestException("Payers must be distinct users with positive safe-integer amounts");
            Account payer = accounts.findById(p.accountId()).orElseThrow(() -> new NotFoundException("Payer not found"));
            if (payer.type() != Account.AccountType.USER || !payer.currency().equals(requester.currency()))
                throw new BadRequestException("Payers must have the requester's currency");
        }
        List<PaymentRequest> created = new ArrayList<>();
        for (Payer p : input.payers()) {
            var r = new PaymentRequest(UuidV7.generate(clock), requester.id(), p.accountId(), p.amountMinor(),
                    requester.currency(), input.memo(), "PENDING", null, null, 0, clock.instant(), null);
            requests.insert(r); created.add(require(r.id(), false));
        }
        requests.saveBatch(requester.id(), key, hash, created.stream().map(PaymentRequest::id).toList());
        return created;
    }

    @Transactional(readOnly = true)
    public PaymentRequest get(UUID id) { return require(id, false); }

    @Transactional(readOnly = true)
    public List<PaymentRequest> list(UUID account, int limit) { return requests.list(account, limit); }

    /** Request status, ledger legs, attempt result and outbox commit in the same DB transaction. */
    @Transactional
    public Payment pay(UUID id, UUID actor, String key) {
        PaymentRequest r = require(id, true);
        actor(r.payerAccountId(), actor);
        var attempt = requests.attempt(id, key);
        if (attempt.isPresent()) return new Payment(r, transfers.get(attempt.get()));
        if (r.status().equals("PAID") && r.transferId() != null) return new Payment(r, transfers.get(r.transferId()));
        pending(r);
        Transfer t = transfers.transfer("request-" + id + "-" + Commitment.sha256(key), r.payerAccountId(),
                r.requesterAccountId(), r.amountMinor(), r.currency(), r.memo() == null ? "Payment request" : r.memo()).transfer();
        requests.recordAttempt(id, key, t.id());
        if (t.status() == Transfer.Status.COMPLETED) requests.resolve(id, "PAID", t.id(), null, clock.instant());
        else requests.declined(id);
        return new Payment(require(id, false), t);
    }

    @Transactional
    public PaymentRequest resolve(UUID id, UUID actor, String action, String rail) {
        PaymentRequest r = require(id, true);
        actor(action.equals("decline") ? r.payerAccountId() : r.requesterAccountId(), actor);
        String status = switch (action) {
            case "decline" -> "DECLINED";
            case "cancel" -> "CANCELLED";
            case "settle" -> "PAID";
            default -> throw new BadRequestException("Unknown action");
        };
        if (!action.equals("settle") && rail != null) throw new BadRequestException("Only an external settlement can specify a rail");
        if (action.equals("settle") && !RAILS.contains(rail == null ? "" : rail)) throw new BadRequestException("Invalid rail");
        // Repeating the same resolution is safe; a contradictory terminal action is refused.
        if (r.status().equals(status) && r.transferId() == null && java.util.Objects.equals(r.settledVia(), rail)) return r;
        pending(r);
        requests.resolve(id, status, null, rail, clock.instant());
        return require(id, false);
    }

    private PaymentRequest require(UUID id, boolean lock) {
        return requests.find(id, lock).orElseThrow(() -> new NotFoundException("Request not found"));
    }
    private static void actor(UUID expected, UUID actual) {
        if (!expected.equals(actual)) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Actor cannot perform this action");
    }
    private static void pending(PaymentRequest r) {
        if (!r.status().equals("PENDING")) throw new ResponseStatusException(HttpStatus.CONFLICT, "Request already " + r.status());
    }
}
