package io.github.developeraz.ledger;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import io.github.developeraz.ledger.account.Account;
import io.github.developeraz.ledger.account.AccountService;
import io.github.developeraz.ledger.outbox.OutboxRelay;
import io.github.developeraz.ledger.transfer.Transfer;
import io.github.developeraz.ledger.transfer.TransferService;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Import;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.kafka.KafkaContainer;

/** Publishes through the real Kafka producer against a single-node Kafka broker. */
@SpringBootTest(properties = {"ledger.events.sink=kafka", "ledger.outbox.poll-interval-ms=3600000"})
@Import(TestcontainersConfiguration.class)
@Testcontainers
class KafkaEventPublisherTest {

    @Container
    @ServiceConnection
    static final KafkaContainer KAFKA = new KafkaContainer("apache/kafka-native:3.8.0");

    @Autowired TransferService transfers;
    @Autowired AccountService accounts;
    @Autowired OutboxRelay relay;

    @Test
    void relaysEventsKeyedByTransferWithEventIdHeader() {
        Account alice = accounts.open("alice", "USD");
        Account bob = accounts.open("bob", "USD");
        transfers.deposit(UUID.randomUUID().toString(), alice.id(), 5_000, null);
        Transfer transfer = transfers.transfer(UUID.randomUUID().toString(), alice.id(), bob.id(), 1_200, "USD", "lunch")
                .transfer();

        relay.relay();

        List<ConsumerRecord<String, String>> records = readAll();
        ConsumerRecord<String, String> completed = records.stream()
                .filter(r -> r.key().equals(transfer.id().toString()))
                .findFirst()
                .orElseThrow();
        assertThat(header(completed, "event-type")).isEqualTo("TransferCompleted");
        assertThat(UUID.fromString(header(completed, "event-id"))).isNotNull();
        assertThat(completed.value()).contains("\"amountMinor\": 1200");
        // The deposit and the transfer each produce one event, keyed by their own transfer id.
        assertThat(records).extracting(ConsumerRecord::key).doesNotHaveDuplicates().hasSizeGreaterThanOrEqualTo(2);
    }

    private static List<ConsumerRecord<String, String>> readAll() {
        Map<String, Object> config = Map.of(
                ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, KAFKA.getBootstrapServers(),
                ConsumerConfig.GROUP_ID_CONFIG, "test-" + UUID.randomUUID(),
                ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");
        try (KafkaConsumer<String, String> consumer =
                     new KafkaConsumer<>(config, new StringDeserializer(), new StringDeserializer())) {
            consumer.subscribe(List.of("ledger.events"));
            List<ConsumerRecord<String, String>> records = new ArrayList<>();
            long deadline = System.nanoTime() + Duration.ofSeconds(20).toNanos();
            while (records.size() < 2 && System.nanoTime() < deadline) {
                consumer.poll(Duration.ofMillis(500)).forEach(records::add);
            }
            return records;
        }
    }

    private static String header(ConsumerRecord<String, String> record, String name) {
        return new String(record.headers().lastHeader(name).value(), StandardCharsets.UTF_8);
    }
}
