package io.github.developeraz.ledger.outbox;

import java.util.ArrayList;
import java.util.List;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Polls the outbox and forwards events to the broker. Rows are marked published only after
 * the broker acknowledges them; a crash between the two causes a redelivery, never a loss.
 */
@Component
public class OutboxRelay {

    private static final Logger log = LoggerFactory.getLogger(OutboxRelay.class);
    private static final int BATCH_SIZE = 100;

    private final OutboxRepository outbox;
    private final EventPublisher publisher;
    private final TransactionTemplate tx;

    public OutboxRelay(OutboxRepository outbox, EventPublisher publisher, TransactionTemplate tx,
                       MeterRegistry meters) {
        this.outbox = outbox;
        this.publisher = publisher;
        this.tx = tx;
        Gauge.builder("ledger.outbox.backlog", outbox, OutboxRepository::countUnpublished).register(meters);
    }

    @Scheduled(fixedDelayString = "${ledger.outbox.poll-interval-ms:500}")
    public void relay() {
        int published;
        do {
            published = relayBatch();
        } while (published == BATCH_SIZE);
    }

    /** @return number of events published in this batch */
    public int relayBatch() {
        Integer count = tx.execute(status -> {
            List<OutboxEvent> batch = outbox.claimBatch(BATCH_SIZE);
            List<Long> done = new ArrayList<>(batch.size());
            for (OutboxEvent event : batch) {
                try {
                    publisher.publish(event);
                    done.add(event.id());
                } catch (Exception e) {
                    // Stop here to preserve ordering; the rest are retried on the next poll.
                    log.warn("Failed to publish outbox event {}: {}", event.eventId(), e.toString());
                    break;
                }
            }
            if (!done.isEmpty()) {
                outbox.markPublished(done);
            }
            return done.size();
        });
        return count == null ? 0 : count;
    }
}
