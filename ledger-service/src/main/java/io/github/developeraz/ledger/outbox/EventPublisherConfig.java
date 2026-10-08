package io.github.developeraz.ledger.outbox;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.core.KafkaTemplate;

/**
 * Picks the event sink at runtime. This is deliberately a switch rather than
 * {@code @ConditionalOnProperty}: in a GraalVM native image, conditions are evaluated once at
 * build time, so a conditional bean would freeze the sink into the binary.
 */
@Configuration(proxyBeanMethods = false)
public class EventPublisherConfig {

    @Bean
    EventPublisher eventPublisher(@Value("${ledger.events.sink:log}") String sink,
                                  @Value("${ledger.events.kafka-topic:ledger.events}") String kafkaTopic,
                                  @Value("${ledger.events.sqs.queue-url:}") String sqsQueueUrl,
                                  @Value("${ledger.events.sqs.region:us-east-1}") String sqsRegion,
                                  @Value("${ledger.events.sqs.endpoint:}") String sqsEndpoint,
                                  ObjectProvider<KafkaTemplate<String, String>> kafka) {
        return switch (sink) {
            case "log" -> new LoggingEventPublisher();
            case "kafka" -> new KafkaEventPublisher(kafka.getObject(), kafkaTopic);
            case "sqs" -> new SqsEventPublisher(sqsQueueUrl, sqsRegion, sqsEndpoint);
            default -> throw new IllegalArgumentException("Unknown ledger.events.sink: " + sink);
        };
    }
}
