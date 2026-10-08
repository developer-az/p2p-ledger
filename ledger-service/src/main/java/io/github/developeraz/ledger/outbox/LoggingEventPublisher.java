package io.github.developeraz.ledger.outbox;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Default sink for local runs and tests: no broker required. */
public class LoggingEventPublisher implements EventPublisher {

    private static final Logger log = LoggerFactory.getLogger(LoggingEventPublisher.class);

    @Override
    public void publish(OutboxEvent event) {
        log.info("event {} {} {}", event.eventType(), event.eventId(), event.payload());
    }
}
