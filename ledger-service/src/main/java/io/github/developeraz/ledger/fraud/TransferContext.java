package io.github.developeraz.ledger.fraud;

import java.time.Instant;

import io.github.developeraz.ledger.account.Account;

public record TransferContext(Account source, Account destination, long amountMinor, Instant now) {
}
