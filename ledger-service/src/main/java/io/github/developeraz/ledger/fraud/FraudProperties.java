package io.github.developeraz.ledger.fraud;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/** Thresholds for the rule-based fraud check. Amounts are in minor units (cents). */
@ConfigurationProperties("ledger.fraud")
public record FraudProperties(
        @DefaultValue("1000000") long maxSingleTransferMinor,
        @DefaultValue("5") int velocityMaxTransfers,
        @DefaultValue("60s") Duration velocityWindow,
        @DefaultValue("2500000") long dailyOutflowLimitMinor,
        @DefaultValue("24h") Duration newAccountAge,
        @DefaultValue("100000") long newAccountMaxTransferMinor) {
}
