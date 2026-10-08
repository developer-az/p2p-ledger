package io.github.developeraz.ledger.account;

import java.time.Instant;
import java.util.UUID;

public record Account(UUID id, String ownerId, String currency, AccountType type, long balanceMinor,
                      Instant createdAt) {

    public enum AccountType { USER, SYSTEM }
}
