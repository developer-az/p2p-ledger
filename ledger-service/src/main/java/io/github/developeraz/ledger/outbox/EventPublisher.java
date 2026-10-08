package io.github.developeraz.ledger.outbox;

/**
 * Sends one event to the broker and returns only once the broker has acknowledged it.
 * Delivery is at-least-once: consumers should de-duplicate on {@link OutboxEvent#eventId()}.
 */
public interface EventPublisher {

    void publish(OutboxEvent event) throws Exception;
}
