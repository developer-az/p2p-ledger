package io.github.developeraz.ledger.outbox;

import java.net.URI;
import java.util.Map;

import org.springframework.beans.factory.DisposableBean;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.SqsClientBuilder;
import software.amazon.awssdk.services.sqs.model.MessageAttributeValue;
import software.amazon.awssdk.services.sqs.model.SendMessageRequest;

/**
 * Publishes to an SQS FIFO queue. The message group is the transfer id, so events for one
 * transfer stay ordered, and the deduplication id is the event id, so SQS drops a relay
 * redelivery that arrives within its five-minute deduplication window.
 * Credentials come from the standard AWS provider chain (env vars, profile, or role).
 */
public class SqsEventPublisher implements EventPublisher, DisposableBean {

    private final SqsClient sqs;
    private final String queueUrl;

    public SqsEventPublisher(String queueUrl,
                             String region,
                             String endpoint) {
        SqsClientBuilder builder = SqsClient.builder()
                .region(Region.of(region))
                .httpClient(UrlConnectionHttpClient.create());
        if (!endpoint.isBlank()) {
            builder.endpointOverride(URI.create(endpoint));
        }
        this.sqs = builder.build();
        this.queueUrl = queueUrl;
    }

    @Override
    public void publish(OutboxEvent event) {
        sqs.sendMessage(SendMessageRequest.builder()
                .queueUrl(queueUrl)
                .messageBody(event.payload())
                .messageGroupId(event.aggregateId().toString())
                .messageDeduplicationId(event.eventId().toString())
                .messageAttributes(Map.of(
                        "event-type", MessageAttributeValue.builder()
                                .dataType("String").stringValue(event.eventType()).build(),
                        "event-id", MessageAttributeValue.builder()
                                .dataType("String").stringValue(event.eventId().toString()).build()))
                .build());
    }

    @Override
    public void destroy() {
        sqs.close();
    }
}
