package io.github.developeraz.ledger;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import io.github.developeraz.ledger.account.Account;
import io.github.developeraz.ledger.account.AccountService;
import io.github.developeraz.ledger.outbox.OutboxRelay;
import io.github.developeraz.ledger.transfer.TransferService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.Message;
import software.amazon.awssdk.services.sqs.model.MessageSystemAttributeName;
import software.amazon.awssdk.services.sqs.model.QueueAttributeName;

/** Publishes through the real SQS client against ElasticMQ, an SQS-compatible broker. */
@SpringBootTest(properties = {"ledger.events.sink=sqs", "ledger.outbox.poll-interval-ms=3600000"})
@Import(TestcontainersConfiguration.class)
@Testcontainers
class SqsEventPublisherTest {

    @Container
    static final GenericContainer<?> ELASTICMQ =
            new GenericContainer<>("softwaremill/elasticmq-native:1.6.14").withExposedPorts(9324);

    static String queueUrl;

    @DynamicPropertySource
    static void sqsProperties(DynamicPropertyRegistry registry) {
        System.setProperty("aws.accessKeyId", "test");
        System.setProperty("aws.secretAccessKey", "test");
        queueUrl = client().createQueue(b -> b.queueName("ledger-events.fifo")
                .attributes(Map.of(QueueAttributeName.FIFO_QUEUE, "true"))).queueUrl();
        registry.add("ledger.events.sqs.queue-url", () -> queueUrl);
        registry.add("ledger.events.sqs.endpoint", SqsEventPublisherTest::endpoint);
    }

    @Autowired TransferService transfers;
    @Autowired AccountService accounts;
    @Autowired OutboxRelay relay;

    @Test
    void relaysEventsToFifoQueueGroupedByTransfer() {
        Account alice = accounts.open("alice", "USD");
        transfers.deposit(UUID.randomUUID().toString(), alice.id(), 5_000, null);

        relay.relay();

        List<Message> messages = client().receiveMessage(b -> b.queueUrl(queueUrl)
                .maxNumberOfMessages(10)
                .messageAttributeNames("All")
                .messageSystemAttributeNames(MessageSystemAttributeName.ALL)).messages();
        assertThat(messages).hasSize(1);
        Message message = messages.getFirst();
        assertThat(message.messageAttributes().get("event-type").stringValue()).isEqualTo("DepositCompleted");
        assertThat(message.attributes().get(MessageSystemAttributeName.MESSAGE_GROUP_ID))
                .isEqualTo(transfers.forAccount(alice.id(), 1).getFirst().id().toString());
        assertThat(message.body()).contains("\"amountMinor\": 5000");
    }

    private static String endpoint() {
        return "http://" + ELASTICMQ.getHost() + ":" + ELASTICMQ.getMappedPort(9324);
    }

    private static SqsClient client() {
        return SqsClient.builder()
                .endpointOverride(URI.create(endpoint()))
                .region(Region.US_EAST_1)
                .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create("test", "test")))
                .httpClient(UrlConnectionHttpClient.create())
                .build();
    }
}
