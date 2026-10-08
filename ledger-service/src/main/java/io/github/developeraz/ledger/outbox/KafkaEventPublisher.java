package io.github.developeraz.ledger.outbox;

import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

import org.apache.kafka.clients.producer.ProducerRecord;
import org.springframework.kafka.core.KafkaTemplate;

/**
 * Keys records by aggregate id so every event for one transfer lands on the same
 * partition and consumers see them in order.
 */
public class KafkaEventPublisher implements EventPublisher {

    private final KafkaTemplate<String, String> kafka;
    private final String topic;

    public KafkaEventPublisher(KafkaTemplate<String, String> kafka,
                               String topic) {
        this.kafka = kafka;
        this.topic = topic;
    }

    @Override
    public void publish(OutboxEvent event) throws Exception {
        ProducerRecord<String, String> record =
                new ProducerRecord<>(topic, event.aggregateId().toString(), event.payload());
        record.headers().add("event-id", event.eventId().toString().getBytes(StandardCharsets.UTF_8));
        record.headers().add("event-type", event.eventType().getBytes(StandardCharsets.UTF_8));
        kafka.send(record).get(10, TimeUnit.SECONDS);
    }
}
