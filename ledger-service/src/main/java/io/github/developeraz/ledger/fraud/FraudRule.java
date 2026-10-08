package io.github.developeraz.ledger.fraud;

import java.util.Optional;

/** A single fraud heuristic. Returns a machine-readable reason code when the transfer should be blocked. */
public interface FraudRule {

    Optional<String> evaluate(TransferContext context);
}
