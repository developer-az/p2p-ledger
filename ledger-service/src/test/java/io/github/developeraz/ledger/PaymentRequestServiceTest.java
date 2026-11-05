package io.github.developeraz.ledger;

import static org.assertj.core.api.Assertions.*;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import io.github.developeraz.ledger.account.Account;
import io.github.developeraz.ledger.account.AccountService;
import io.github.developeraz.ledger.requests.PaymentRequest;
import io.github.developeraz.ledger.requests.PaymentRequestService;
import io.github.developeraz.ledger.transfer.Transfer;
import io.github.developeraz.ledger.transfer.TransferService;
import io.github.developeraz.ledger.transfer.IdempotencyConflictException;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest(properties = {"ledger.outbox.poll-interval-ms=3600000", "ledger.chain.poll-interval-ms=3600000"})
@Import(TestcontainersConfiguration.class)
class PaymentRequestServiceTest {
    @Autowired PaymentRequestService requests;
    @Autowired AccountService accounts;
    @Autowired TransferService transfers;
    @Autowired JdbcClient jdbc;

    private Account account() { return accounts.open("request-test-" + UUID.randomUUID(), "USD"); }
    private PaymentRequest request(Account requester, Account payer, long amount) {
        return requests.split(new PaymentRequestService.Split(requester.id(),
                List.of(new PaymentRequestService.Payer(payer.id(), amount)), "Shared groceries"), UUID.randomUUID().toString()).getFirst();
    }

    @Test void splitReplayIsAtomicAndRejectsChangedBodies() {
        Account a = account(), b = account(), c = account();
        String key = UUID.randomUUID().toString();
        var split = new PaymentRequestService.Split(a.id(), List.of(
                new PaymentRequestService.Payer(b.id(), 1001), new PaymentRequestService.Payer(c.id(), 1000)), "Dinner");
        var first = requests.split(split, key);
        assertThat(requests.split(split, key)).isEqualTo(first);
        assertThat(requests.list(a.id(), 200)).hasSize(2);
        assertThatThrownBy(() -> requests.split(new PaymentRequestService.Split(a.id(), split.payers(), "Changed"), key))
                .isInstanceOf(IdempotencyConflictException.class);
        assertThat(requests.list(a.id(), 200)).hasSize(2);
    }

    @Test void invalidLastPayerLeavesNoPartialSplit() {
        Account a = account(), b = account();
        assertThatThrownBy(() -> requests.split(new PaymentRequestService.Split(a.id(), List.of(
                new PaymentRequestService.Payer(b.id(), 500), new PaymentRequestService.Payer(UUID.randomUUID(), 500)), null), "invalid"))
                .hasMessageContaining("Payer not found");
        assertThat(requests.list(a.id(), 200)).isEmpty();
    }

    @Test void paymentAndRetriesWriteExactlyOneBalancedTransfer() {
        Account requester = account(), payer = account();
        transfers.deposit(UUID.randomUUID().toString(), payer.id(), 10000, null);
        PaymentRequest r = request(requester, payer, 1250);
        var first = requests.pay(r.id(), payer.id(), "click-1");
        assertThat(first.request().status()).isEqualTo("PAID");
        assertThat(requests.pay(r.id(), payer.id(), "click-1").transfer().id()).isEqualTo(first.transfer().id());
        assertThat(requests.pay(r.id(), payer.id(), "other-tab").transfer().id()).isEqualTo(first.transfer().id());
        assertThat(accounts.get(payer.id()).balanceMinor()).isEqualTo(8750);
        assertThat(accounts.get(requester.id()).balanceMinor()).isEqualTo(1250);
        assertThat(accounts.statement(requester.id(), null, 50)).hasSize(1);
    }

    @Test void aDeclineIsReplayedUntilAFreshAttemptAfterFunding() {
        Account requester = account(), payer = account();
        PaymentRequest r = request(requester, payer, 1250);
        var declined = requests.pay(r.id(), payer.id(), "unfunded-click");
        assertThat(declined.transfer().status()).isEqualTo(Transfer.Status.REJECTED);
        assertThat(declined.request().declinedAttempts()).isEqualTo(1);
        transfers.deposit(UUID.randomUUID().toString(), payer.id(), 5000, null);
        assertThat(requests.pay(r.id(), payer.id(), "unfunded-click").transfer().id()).isEqualTo(declined.transfer().id());
        assertThat(requests.get(r.id()).declinedAttempts()).isEqualTo(1);
        assertThat(requests.pay(r.id(), payer.id(), "funded-click").request().status()).isEqualTo("PAID");
        assertThat(accounts.get(payer.id()).balanceMinor()).isEqualTo(3750);
    }

    @Test void externalSettlementCannotThenChargeThePayer() {
        Account requester = account(), payer = account();
        transfers.deposit(UUID.randomUUID().toString(), payer.id(), 5000, null);
        PaymentRequest r = request(requester, payer, 1250);
        assertThat(requests.resolve(r.id(), requester.id(), "settle", "cash").settledVia()).isEqualTo("cash");
        assertThat(requests.resolve(r.id(), requester.id(), "settle", "cash").status()).isEqualTo("PAID");
        assertThatThrownBy(() -> requests.pay(r.id(), payer.id(), "late-pay")).isInstanceOf(ResponseStatusException.class);
        assertThat(accounts.get(payer.id()).balanceMinor()).isEqualTo(5000);
        assertThat(accounts.get(requester.id()).balanceMinor()).isZero();
    }

    @Test void wrongActorCannotPayCancelDeclineOrSettle() {
        Account a = account(), b = account(), outsider = account();
        PaymentRequest r = request(a, b, 50);
        assertThatThrownBy(() -> requests.pay(r.id(), outsider.id(), "bad")).isInstanceOf(ResponseStatusException.class);
        for (String action : List.of("cancel", "decline", "settle"))
            assertThatThrownBy(() -> requests.resolve(r.id(), outsider.id(), action, "cash")).isInstanceOf(ResponseStatusException.class);
        assertThat(requests.get(r.id()).status()).isEqualTo("PENDING");
    }

    @Test void racingPayAndCancelHaveOneWinnerAndConsistentBalances() throws Exception {
        Account a = account(), b = account();
        transfers.deposit(UUID.randomUUID().toString(), b.id(), 5000, null);
        PaymentRequest r = request(a, b, 1250);
        CountDownLatch start = new CountDownLatch(1);
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            Callable<Boolean> pay = () -> { start.await(); try { requests.pay(r.id(), b.id(), "race"); return true; }
                catch (ResponseStatusException e) { return false; } };
            Callable<Boolean> cancel = () -> { start.await(); try { requests.resolve(r.id(), a.id(), "cancel", null); return true; }
                catch (ResponseStatusException e) { return false; } };
            var p = pool.submit(pay); var c = pool.submit(cancel); start.countDown();
            assertThat(List.of(p.get(), c.get())).containsExactlyInAnyOrder(true, false);
        }
        PaymentRequest result = requests.get(r.id());
        boolean paid = result.status().equals("PAID");
        assertThat(accounts.get(a.id()).balanceMinor()).isEqualTo(paid ? 1250 : 0);
        assertThat(accounts.get(b.id()).balanceMinor()).isEqualTo(paid ? 3750 : 5000);
        assertThat(result.transferId() != null).isEqualTo(paid);
    }

    @Test void duplicateConcurrentClicksShareTheAttemptResult() throws Exception {
        Account a = account(), b = account();
        transfers.deposit(UUID.randomUUID().toString(), b.id(), 5000, null);
        PaymentRequest r = request(a, b, 1250);
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            var results = pool.invokeAll(java.util.stream.IntStream.range(0, 8)
                    .mapToObj(i -> (Callable<UUID>) () -> requests.pay(r.id(), b.id(), "same-click").transfer().id()).toList());
            var ids = new java.util.HashSet<UUID>();
            for (var result : results) ids.add(result.get());
            assertThat(ids).hasSize(1);
        }
        assertThat(accounts.get(a.id()).balanceMinor()).isEqualTo(1250);
        assertThat(jdbc.sql("select count(*) from payment_request_attempts where request_id=:id").param("id", r.id()).query(Integer.class).single()).isEqualTo(1);
    }
}
