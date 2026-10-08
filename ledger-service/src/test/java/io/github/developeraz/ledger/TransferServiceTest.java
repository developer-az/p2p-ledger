package io.github.developeraz.ledger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadLocalRandom;

import io.github.developeraz.ledger.account.Account;
import io.github.developeraz.ledger.account.AccountRepository;
import io.github.developeraz.ledger.account.AccountService;
import io.github.developeraz.ledger.outbox.OutboxRelay;
import io.github.developeraz.ledger.outbox.OutboxRepository;
import io.github.developeraz.ledger.transfer.IdempotencyConflictException;
import io.github.developeraz.ledger.transfer.Transfer;
import io.github.developeraz.ledger.transfer.TransferService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;

/** Fraud limits are relaxed here so these tests exercise money movement and concurrency only. */
@SpringBootTest(properties = {
        "ledger.fraud.velocity-max-transfers=1000000",
        "ledger.fraud.daily-outflow-limit-minor=1000000000000",
        "ledger.fraud.new-account-max-transfer-minor=1000000000",
        "ledger.outbox.poll-interval-ms=3600000"
})
@Import(TestcontainersConfiguration.class)
class TransferServiceTest {

    @Autowired TransferService transfers;
    @Autowired AccountService accountService;
    @Autowired AccountRepository accounts;
    @Autowired OutboxRepository outbox;
    @Autowired OutboxRelay relay;
    @Autowired JdbcClient jdbc;
    @Autowired TransactionTemplate tx;

    @Test
    void transferMovesMoneyWithBalancedEntries() {
        Account alice = funded("alice", 10_000);
        Account bob = funded("bob", 0);

        TransferService.Result result = transfers.transfer(key(), alice.id(), bob.id(), 2_500, "USD", "dinner");

        assertThat(result.transfer().status()).isEqualTo(Transfer.Status.COMPLETED);
        assertThat(balance(alice)).isEqualTo(7_500);
        assertThat(balance(bob)).isEqualTo(2_500);
        assertThat(accounts.sumEntries(alice.id())).isEqualTo(7_500);
        assertThat(accounts.sumEntries(bob.id())).isEqualTo(2_500);
    }

    @Test
    void replayingAKeyReturnsTheStoredTransferAndMovesMoneyOnce() {
        Account alice = funded("alice", 10_000);
        Account bob = funded("bob", 0);
        String key = key();

        TransferService.Result first = transfers.transfer(key, alice.id(), bob.id(), 1_000, "USD", null);
        TransferService.Result second = transfers.transfer(key, alice.id(), bob.id(), 1_000, "USD", null);

        assertThat(first.replayed()).isFalse();
        assertThat(second.replayed()).isTrue();
        assertThat(second.transfer().id()).isEqualTo(first.transfer().id());
        assertThat(balance(bob)).isEqualTo(1_000);
    }

    @Test
    void reusingAKeyWithADifferentBodyIsRejected() {
        Account alice = funded("alice", 10_000);
        Account bob = funded("bob", 0);
        String key = key();
        transfers.transfer(key, alice.id(), bob.id(), 1_000, "USD", null);

        assertThatThrownBy(() -> transfers.transfer(key, alice.id(), bob.id(), 9_999, "USD", null))
                .isInstanceOf(IdempotencyConflictException.class);
        assertThat(balance(bob)).isEqualTo(1_000);
    }

    @Test
    void insufficientFundsIsStoredAsRejectedWithoutEntries() {
        Account alice = funded("alice", 500);
        Account bob = funded("bob", 0);

        Transfer t = transfers.transfer(key(), alice.id(), bob.id(), 501, "USD", null).transfer();

        assertThat(t.status()).isEqualTo(Transfer.Status.REJECTED);
        assertThat(t.rejectionReason()).isEqualTo("INSUFFICIENT_FUNDS");
        assertThat(balance(alice)).isEqualTo(500);
        assertThat(jdbc.sql("select count(*) from ledger_entries where transfer_id = :id")
                .param("id", t.id()).query(Integer.class).single()).isZero();
    }

    @Test
    void concurrentTransfersConserveMoneyAndNeverOverdraw() throws Exception {
        List<Account> ring = List.of(funded("a", 10_000), funded("b", 10_000), funded("c", 10_000),
                funded("d", 10_000));
        int threads = 16;
        int perThread = 40;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<?>> futures = new ArrayList<>();
        for (int i = 0; i < threads; i++) {
            futures.add(pool.submit(() -> {
                start.await();
                ThreadLocalRandom rnd = ThreadLocalRandom.current();
                for (int j = 0; j < perThread; j++) {
                    Account from = ring.get(rnd.nextInt(ring.size()));
                    Account to = ring.get(rnd.nextInt(ring.size()));
                    if (from.id().equals(to.id())) {
                        continue;
                    }
                    transfers.transfer(key(), from.id(), to.id(), rnd.nextLong(1, 4_000), "USD", null);
                }
                return null;
            }));
        }
        start.countDown();
        for (Future<?> f : futures) {
            f.get();
        }
        pool.shutdown();

        long total = 0;
        for (Account a : ring) {
            long balance = balance(a);
            assertThat(balance).isNotNegative();
            assertThat(accounts.sumEntries(a.id())).isEqualTo(balance);
            total += balance;
        }
        assertThat(total).isEqualTo(40_000);
    }

    @Test
    void concurrentDuplicatesOfOneRequestMoveMoneyOnce() throws Exception {
        Account alice = funded("alice", 10_000);
        Account bob = funded("bob", 0);
        String key = key();
        int threads = 12;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch start = new CountDownLatch(1);
        Set<UUID> ids = ConcurrentHashMap.newKeySet();
        List<Future<?>> futures = new ArrayList<>();
        for (int i = 0; i < threads; i++) {
            futures.add(pool.submit(() -> {
                start.await();
                ids.add(transfers.transfer(key, alice.id(), bob.id(), 700, "USD", null).transfer().id());
                return null;
            }));
        }
        start.countDown();
        for (Future<?> f : futures) {
            f.get();
        }
        pool.shutdown();

        assertThat(ids).hasSize(1);
        assertThat(balance(bob)).isEqualTo(700);
    }

    @Test
    void databaseRejectsUnbalancedOrModifiedEntries() {
        Account alice = funded("alice", 1_000);
        Transfer deposit = transfers.forAccount(alice.id(), 1).getFirst();

        assertThatThrownBy(() -> tx.executeWithoutResult(s -> jdbc.sql("""
                insert into ledger_entries (transfer_id, account_id, amount_minor, balance_after_minor, created_at)
                values (:t, :a, 1, 0, now())
                """).param("t", deposit.id()).param("a", alice.id()).update()))
                .rootCause().hasMessageContaining("do not sum to zero");

        assertThatThrownBy(() -> jdbc.sql("update ledger_entries set amount_minor = 1 where account_id = :a")
                .param("a", alice.id()).update())
                .rootCause().hasMessageContaining("append-only");
    }

    @Test
    void outboxRelayPublishesEveryEvent() {
        Account alice = funded("alice", 1_000);
        Account bob = funded("bob", 0);
        transfers.transfer(key(), alice.id(), bob.id(), 100, "USD", null);
        assertThat(outbox.countUnpublished()).isPositive();

        relay.relay();

        assertThat(outbox.countUnpublished()).isZero();
    }

    private Account funded(String owner, long amountMinor) {
        Account account = accountService.open(owner, "USD");
        if (amountMinor > 0) {
            transfers.deposit(key(), account.id(), amountMinor, "test funding");
        }
        return account;
    }

    private long balance(Account account) {
        return accountService.get(account.id()).balanceMinor();
    }

    private static String key() {
        return UUID.randomUUID().toString();
    }
}
