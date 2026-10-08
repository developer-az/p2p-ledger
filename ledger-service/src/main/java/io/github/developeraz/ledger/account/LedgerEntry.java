package io.github.developeraz.ledger.account;

import java.time.Instant;
import java.util.UUID;

/** One leg of a transfer. Negative amounts debit the account, positive amounts credit it. */
public record LedgerEntry(long id, UUID transferId, UUID accountId, long amountMinor, long balanceAfterMinor,
                          Instant createdAt) {
}
