package io.github.developeraz.ledger;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import io.github.developeraz.ledger.account.Account;
import io.github.developeraz.ledger.account.AccountService;
import io.github.developeraz.ledger.transfer.Transfer;
import io.github.developeraz.ledger.transfer.TransferService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;

/** Runs with the default fraud thresholds and a controllable clock. */
@SpringBootTest(properties = "ledger.outbox.poll-interval-ms=3600000")
@Import({TestcontainersConfiguration.class, FraudRulesTest.ClockConfig.class})
class FraudRulesTest {

    @TestConfiguration(proxyBeanMethods = false)
    static class ClockConfig {
        @Bean
        @Primary
        MutableClock testClock() {
            return new MutableClock(Instant.parse("2026-01-01T00:00:00Z"));
        }
    }

    @Autowired TransferService transfers;
    @Autowired AccountService accountService;
    @Autowired MutableClock clock;

    @Test
    void blocksTransfersOverTheSingleTransferLimit() {
        Account alice = funded("alice", 2_000_000);
        Account bob = funded("bob", 0);
        clock.advance(Duration.ofDays(2));

        assertThat(send(alice, bob, 1_000_001).rejectionReason()).isEqualTo("AMOUNT_OVER_SINGLE_LIMIT");
        assertThat(send(alice, bob, 1_000_000).status()).isEqualTo(Transfer.Status.COMPLETED);
    }

    @Test
    void limitsLargeTransfersFromNewAccounts() {
        Account alice = funded("alice", 500_000);
        Account bob = funded("bob", 0);

        assertThat(send(alice, bob, 150_000).rejectionReason()).isEqualTo("NEW_ACCOUNT_LARGE_TRANSFER");
        assertThat(send(alice, bob, 100_000).status()).isEqualTo(Transfer.Status.COMPLETED);

        clock.advance(Duration.ofHours(25));
        assertThat(send(alice, bob, 150_000).status()).isEqualTo(Transfer.Status.COMPLETED);
    }

    @Test
    void limitsTransferVelocity() {
        Account alice = funded("alice", 10_000);
        Account bob = funded("bob", 0);
        clock.advance(Duration.ofDays(2));

        for (int i = 0; i < 5; i++) {
            assertThat(send(alice, bob, 100).status()).isEqualTo(Transfer.Status.COMPLETED);
        }
        assertThat(send(alice, bob, 100).rejectionReason()).isEqualTo("VELOCITY_LIMIT");

        clock.advance(Duration.ofSeconds(61));
        assertThat(send(alice, bob, 100).status()).isEqualTo(Transfer.Status.COMPLETED);
    }

    @Test
    void limitsDailyOutflow() {
        Account alice = funded("alice", 5_000_000);
        Account bob = funded("bob", 0);
        clock.advance(Duration.ofDays(2));

        assertThat(send(alice, bob, 1_000_000).status()).isEqualTo(Transfer.Status.COMPLETED);
        assertThat(send(alice, bob, 1_000_000).status()).isEqualTo(Transfer.Status.COMPLETED);
        assertThat(send(alice, bob, 1_000_000).rejectionReason()).isEqualTo("DAILY_OUTFLOW_LIMIT");

        clock.advance(Duration.ofHours(24).plusSeconds(1));
        assertThat(send(alice, bob, 1_000_000).status()).isEqualTo(Transfer.Status.COMPLETED);
    }

    private Transfer send(Account from, Account to, long amountMinor) {
        return transfers.transfer(UUID.randomUUID().toString(), from.id(), to.id(), amountMinor, "USD", null)
                .transfer();
    }

    private Account funded(String owner, long amountMinor) {
        Account account = accountService.open(owner, "USD");
        if (amountMinor > 0) {
            transfers.deposit(UUID.randomUUID().toString(), account.id(), amountMinor, null);
        }
        return account;
    }
}
