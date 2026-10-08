package io.github.developeraz.ledger;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
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
class ApiTest {

    @Autowired MockMvc mvc;

    @Test
    void endToEndTransferWithIdempotentReplay() throws Exception {
        String suffix = UUID.randomUUID().toString();
        String alice = openAccount("alice");
        String bob = openAccount("bob-" + suffix);

        mvc.perform(post("/v1/accounts/{id}/deposits", alice)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"amountMinor\": 50000}"))
                .andExpect(status().isCreated());

        String body = """
                {"sourceAccountId": "%s", "destinationAccountId": "%s", "amountMinor": 1250,
                 "currency": "USD", "memo": "pizza"}""".formatted(alice, bob);
        String key = UUID.randomUUID().toString();

        mvc.perform(post("/v1/transfers").header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("COMPLETED"))
                .andExpect(jsonPath("$.idempotencyKey").doesNotExist());

        mvc.perform(post("/v1/transfers").header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(header().string("Idempotent-Replayed", "true"));

        mvc.perform(get("/v1/accounts").param("ownerId", "bob-" + suffix))
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].id").value(bob));
        mvc.perform(get("/v1/accounts/{id}", bob))
                .andExpect(jsonPath("$.balanceMinor").value(1250));
        mvc.perform(get("/v1/accounts/{id}/entries", alice))
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].amountMinor").value(-1250));
    }

    @Test
    void rejectsBadRequests() throws Exception {
        String alice = openAccount("alice");
        String body = """
                {"sourceAccountId": "%s", "destinationAccountId": "%s", "amountMinor": 100, "currency": "USD"}"""
                .formatted(alice, UUID.randomUUID());

        mvc.perform(post("/v1/transfers").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/v1/transfers").header("Idempotency-Key", "k-" + UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isNotFound());
        mvc.perform(post("/v1/accounts").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"ownerId\": \"x\", \"currency\": \"EUR\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/v1/accounts/{id}/deposits", alice)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"amountMinor\": -5}"))
                .andExpect(status().isBadRequest());
    }

    private String openAccount(String owner) throws Exception {
        String response = mvc.perform(post("/v1/accounts").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"ownerId\": \"%s\", \"currency\": \"USD\"}".formatted(owner)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(response, "$.id");
    }
}
