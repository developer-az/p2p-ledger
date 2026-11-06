package io.github.developeraz.ledger;

import static org.assertj.core.api.Assertions.*;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import io.github.developeraz.ledger.account.AccountService;
import io.github.developeraz.ledger.chain.ChainReceiptRepository;
import io.github.developeraz.ledger.transfer.TransferService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

@SpringBootTest(properties={"ledger.outbox.poll-interval-ms=3600000", "ledger.chain.poll-interval-ms=3600000"})
@Import(TestcontainersConfiguration.class)
class ChainReceiptRepositoryTest {
    @Autowired ChainReceiptRepository receipts;
    @Autowired AccountService accounts;
    @Autowired TransferService transfers;
    @Autowired JdbcClient jdbc;
    private UUID queued() {
        var a=accounts.open("chain-repo-"+UUID.randomUUID(),"USD");
        var b=accounts.open("chain-repo-"+UUID.randomUUID(),"USD");
        transfers.deposit(UUID.randomUUID().toString(),a.id(),1000,null);
        var transfer=transfers.transfer(UUID.randomUUID().toString(),a.id(),b.id(),100,"USD",null).transfer();
        jdbc.sql("""
                insert into chain_receipts(transfer_id,transfer_key,commitment,preimage,chain_id,contract_address,created_at,updated_at,next_attempt_at)
                values(:id,:key,:commitment,'test',31337,:contract,:now,:now,:now)
                """).param("id",transfer.id()).param("key","0x"+io.github.developeraz.ledger.chain.Commitment.sha256(transfer.id().toString()))
                .param("commitment","0x"+"b".repeat(64)).param("contract","0x"+"1".repeat(40))
                .param("now",Timestamp.from(Instant.now())).update();
        return transfer.id();
    }
    @Test void statusUpdatesPersistAndKeepTheOriginalSubmissionTime() {
        UUID id=queued(); String hash="0x"+"c".repeat(64);
        receipts.update(id,"SUBMITTED",hash,null,0,null,Instant.now());
        var first=receipts.find(id).orElseThrow();
        assertThat(first.submittedAt()).isNotNull();
        assertThat(first.transactionHash()).isEqualTo(hash);
        receipts.update(id,"SUBMITTED",hash,42L,0,null,Instant.now().plusSeconds(10));
        assertThat(receipts.find(id).orElseThrow().submittedAt()).isEqualTo(first.submittedAt());
        receipts.update(id,"FINALIZED",hash,42L,0,null,Instant.now());
        assertThat(receipts.find(id).orElseThrow().status()).isEqualTo("FINALIZED");
    }
    @Test void failedUnsubmittedJobDoesNotAcquireASubmissionTime() {
        UUID id=queued();
        receipts.update(id,"FAILED",null,null,12,"RPC timeout or transport failure",Instant.now());
        var result=receipts.find(id).orElseThrow();
        assertThat(result.status()).isEqualTo("FAILED");
        assertThat(result.submittedAt()).isNull();
        assertThat(result.attempts()).isEqualTo(12);
    }
}
