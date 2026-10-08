package io.github.developeraz.ledger.outbox;

import java.util.UUID;

public record OutboxEvent(long id, UUID eventId, UUID aggregateId, String eventType, String payload) {
}
