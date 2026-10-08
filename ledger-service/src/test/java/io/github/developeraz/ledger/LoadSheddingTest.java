package io.github.developeraz.ledger;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;

/** With zero slots every API request is shed; health checks are never limited. */
@SpringBootTest(properties = {"ledger.http.max-in-flight=0", "ledger.http.queue-wait-ms=1",
        "ledger.outbox.poll-interval-ms=3600000"})
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class LoadSheddingTest {

    @Autowired MockMvc mvc;

    @Test
    void shedsApiRequestsWhenSaturated() throws Exception {
        mvc.perform(get("/v1/accounts/{id}", UUID.randomUUID()))
                .andExpect(status().isServiceUnavailable())
                .andExpect(header().string("Retry-After", "1"));
        mvc.perform(get("/actuator/health")).andExpect(status().isOk());
    }
}
