package io.github.developeraz.ledger;

import static org.assertj.core.api.Assertions.*;
import java.time.Instant;
import java.util.UUID;
import io.github.developeraz.ledger.account.AccountService;
import io.github.developeraz.ledger.spending.SpendingService;
import io.github.developeraz.ledger.common.BadRequestException;
import io.github.developeraz.ledger.transfer.IdempotencyConflictException;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

@SpringBootTest(properties={"ledger.outbox.poll-interval-ms=3600000", "ledger.chain.poll-interval-ms=3600000"})
@Import(TestcontainersConfiguration.class)
class SpendingServiceTest {
    @Autowired SpendingService spending;
    @Autowired AccountService accounts;
    private UUID account() { return accounts.open("spending-" + UUID.randomUUID(), "USD").id(); }

    @Test void provisioningReplayCreatesExactlyOneAccountAndRejectsConflicts() {
        UUID id = UUID.randomUUID();
        String owner = "signup-" + id;
        var first = accounts.provision(id, owner, "USD");
        assertThat(accounts.provision(id, owner, "USD")).isEqualTo(first);
        assertThat(accounts.byOwner(owner)).hasSize(1);
        assertThatThrownBy(() -> accounts.provision(id, "another-owner", "USD")).isInstanceOf(BadRequestException.class);
        assertThat(accounts.get(id)).isEqualTo(first);
    }

    @Test void recordsIdempotentlyAndDoesNotChangeLedgerMoney() {
        UUID account=account();
        var input=new SpendingService.Input(1250,"groceries","Weekly shop",null,null,"USD");
        var first=spending.record(account,input,"expense-1");
        assertThat(spending.record(account,input,"expense-1")).isEqualTo(first);
        assertThat(spending.list(account,null,100)).hasSize(1);
        assertThat(accounts.get(account).balanceMinor()).isZero();
        assertThatThrownBy(() -> spending.record(account,new SpendingService.Input(1300,"groceries","Weekly shop",null,null,"USD"),"expense-1"))
                .isInstanceOf(IdempotencyConflictException.class);
    }
    @Test void csvHandlesQuotesExactDecimalsAndDuplicateFileReplays() {
        UUID account=account();
        String csv="date,amount,category,note\r\n2026-01-01,12.50,groceries,\"Bread, milk\"\r\n2026-01-02,0.01,other,\"A \"\"quoted\"\" note\"\r\n";
        assertThat(spending.importCsv(account,csv)).isEqualTo(new SpendingService.ImportResult(2,0,2));
        assertThat(spending.importCsv(account,csv)).isEqualTo(new SpendingService.ImportResult(0,2,2));
        assertThat(spending.list(account,null,100)).extracting(e -> e.amountMinor()).containsExactly(1L,1250L);
        assertThat(accounts.get(account).balanceMinor()).isZero();
    }
    @Test void overlappingFilesUseExternalIdsAndRejectConflictingIds() {
        UUID account=account();
        String header="date,amount,transactionId\n";
        spending.importCsv(account,header+"2026-01-01,12.50,BANK-1\n");
        assertThat(spending.importCsv(account,header+"2026-01-01,12.50,BANK-1\n2026-01-02,2.00,BANK-2\n").imported()).isEqualTo(1);
        assertThatThrownBy(() -> spending.importCsv(account,header+"2026-01-01,13.00,BANK-1\n")).isInstanceOf(BadRequestException.class);
        assertThat(spending.list(account,null,100)).hasSize(2);
    }
    @Test void aBadFinalRowRollsBackEveryEarlierRow() {
        UUID account=account();
        for(String bad: new String[]{"bad-date,12.50", "2026-01-02,12.501", "2026-01-02,-12.50", "2026-01-02,0", "2026-01-02,NaN"}) {
            assertThatThrownBy(() -> spending.importCsv(account,"date,amount\n2026-01-01,1.00\n"+bad+"\n")).isInstanceOf(BadRequestException.class);
            assertThat(spending.list(account,null,100)).isEmpty();
        }
    }
    @Test void accountIsolationIncludesImportsAndDeletion() {
        UUID a=account(), b=account();
        String csv="date,amount,transactionId\n2026-01-01,1.00,BANK-1\n";
        spending.importCsv(a,csv); spending.importCsv(b,csv);
        var first=spending.list(a,null,100).getFirst();
        assertThat(spending.remove(b,first.id())).isFalse();
        assertThat(spending.remove(a,first.id())).isTrue();
        assertThat(spending.list(a,null,100)).isEmpty();
        assertThat(spending.list(b,null,100)).hasSize(1);
    }
    @Test void identicalPurchasesWithDifferentTransactionIdsAreBothRetained() {
        UUID account=account();
        String csv="date,amount,transactionId\n2026-01-01,2.50,COFFEE-1\n2026-01-01,2.50,COFFEE-2\n";
        assertThat(spending.importCsv(account,csv).imported()).isEqualTo(2);
    }
    @Test void dateOnlyImportsUseTheUserZoneAndItsDaylightSavingRules() {
        UUID account=account();
        spending.importCsv(account,"date,amount\n2026-01-01,1.00\n2026-07-01,2.00\n","America/New_York");
        assertThat(spending.list(account,null,100)).extracting(e->e.occurredAt()).containsExactly(
                Instant.parse("2026-07-01T04:00:00Z"),Instant.parse("2026-01-01T05:00:00Z"));
        assertThatThrownBy(()->spending.importCsv(account,"date,amount\n2026-01-01,1.00\n","Invalid/Zone"))
                .isInstanceOf(BadRequestException.class);
    }
    @Test void categoryDateCurrencyAndSourceAreValidatedInsideTheService() {
        UUID account=account();
        for(var input : new SpendingService.Input[]{
                new SpendingService.Input(1,"invalid",null,null,null,"USD"),
                new SpendingService.Input(1,"other",null,Instant.parse("2200-01-01T00:00:00Z"),null,"USD"),
                new SpendingService.Input(1,"other",null,null,null,"EUR"),
                new SpendingService.Input(1,"other",null,null,"bank-verified","USD")})
            assertThatThrownBy(() -> spending.record(account,input,UUID.randomUUID().toString())).isInstanceOf(BadRequestException.class);
    }
}
