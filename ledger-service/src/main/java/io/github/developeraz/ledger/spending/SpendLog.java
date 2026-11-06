package io.github.developeraz.ledger.spending;

import java.time.Instant;
import java.util.UUID;

public record SpendLog(UUID id, UUID accountId, long amountMinor, String currency, String category, String note,
                       Instant occurredAt, String source, Instant createdAt) { }
