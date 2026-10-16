package io.github.developeraz.ledger;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = "ledger.outbox.poll-interval-ms=3600000")
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class AuditTest {

    @Autowired MockMvc mvc;

    @Test
    void trailShowsBothLegsAndTheEvent() throws Exception {
        String alice = openAccount("alice");
        String bob = openAccount("bob");
        deposit(alice, 50_000);
        String key = "trail-" + UUID.randomUUID();
        String id = transfer(alice, bob, 1_250, key);

        mvc.perform(get("/v1/transfers/{id}/trail", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.idempotencyKey").value(key))
                .andExpect(jsonPath("$.transfer.status").value("COMPLETED"))
                .andExpect(jsonPath("$.entries.length()").value(2))
                .andExpect(jsonPath("$.entries[0].amountMinor").value(-1250))
                .andExpect(jsonPath("$.entries[1].amountMinor").value(1250))
                .andExpect(jsonPath("$.events[0].eventType").value("TransferCompleted"));
    }

    @Test
    void declinedTransferHasNoEntries() throws Exception {
        String alice = openAccount("alice");
        String bob = openAccount("bob");
        deposit(alice, 500_000);
        String id = transfer(alice, bob, 200_000, "big-" + UUID.randomUUID());

        mvc.perform(get("/v1/transfers/{id}/trail", id))
                .andExpect(jsonPath("$.transfer.rejectionReason").value("NEW_ACCOUNT_LARGE_TRANSFER"))
                .andExpect(jsonPath("$.entries.length()").value(0))
                .andExpect(jsonPath("$.events[0].eventType").value("TransferRejected"));
        mvc.perform(post("/v1/ledger/tamper-checks").param("transferId", id))
                .andExpect(status().isNotFound());
    }

    @Test
    void booksReconcileAndTheDatabaseRefusesTampering() throws Exception {
        String alice = openAccount("alice");
        String bob = openAccount("bob");
        deposit(alice, 50_000);
        String id = transfer(alice, bob, 700, "tamper-" + UUID.randomUUID());

        mvc.perform(post("/v1/ledger/tamper-checks").param("transferId", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.transferId").value(id))
                .andExpect(jsonPath("$.attempts.length()").value(4))
                .andExpect(jsonPath("$.attempts[?(@.refused == false)]").isEmpty())
                .andExpect(jsonPath("$.attempts[0].databaseSaid").value("ledger_entries is append-only"))
                .andExpect(jsonPath("$.attempts[1].databaseSaid").value("ledger_entries is append-only"))
                .andExpect(jsonPath("$.attempts[2].databaseSaid")
                        .value("ledger entries for transfer " + id + " do not sum to zero"))
                .andExpect(jsonPath("$.attempts[3].databaseSaid")
                        .value(org.hamcrest.Matchers.containsString("user_balance_non_negative")));

        mvc.perform(get("/v1/accounts/{id}", bob)).andExpect(jsonPath("$.balanceMinor").value(700));
        mvc.perform(get("/v1/ledger/integrity"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.balanced").value(true))
                .andExpect(jsonPath("$.entriesSumMinor").value(0))
                .andExpect(jsonPath("$.unbalancedTransfers").value(0))
                .andExpect(jsonPath("$.accountsDrifted").value(0))
                .andExpect(jsonPath("$.rejectedWithEntries").value(0));
    }

    private String openAccount(String owner) throws Exception {
        String response = mvc.perform(post("/v1/accounts").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"ownerId\": \"%s-%s\", \"currency\": \"USD\"}".formatted(owner, UUID.randomUUID())))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(response, "$.id");
    }

    private void deposit(String account, long amountMinor) throws Exception {
        mvc.perform(post("/v1/accounts/{id}/deposits", account)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"amountMinor\": %d}".formatted(amountMinor)))
                .andExpect(status().isCreated());
    }

    private String transfer(String from, String to, long amountMinor, String key) throws Exception {
        String response = mvc.perform(post("/v1/transfers").header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"sourceAccountId": "%s", "destinationAccountId": "%s", "amountMinor": %d,
                                 "currency": "USD"}""".formatted(from, to, amountMinor)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(response, "$.id");
    }
}
