package io.github.developeraz.ledger.fraud;

import java.util.List;
import java.util.Optional;

import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;

/** Runs rules in order and stops at the first one that blocks the transfer. */
@Component
public class FraudEngine {

    private final List<FraudRule> rules;
    private final MeterRegistry meters;

    public FraudEngine(List<FraudRule> rules, MeterRegistry meters) {
        this.rules = rules;
        this.meters = meters;
    }

    public Optional<String> check(TransferContext context) {
        for (FraudRule rule : rules) {
            Optional<String> reason = rule.evaluate(context);
            if (reason.isPresent()) {
                meters.counter("ledger.fraud.blocked", "reason", reason.get()).increment();
                return reason;
            }
        }
        return Optional.empty();
    }
}
