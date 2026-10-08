package io.github.developeraz.ledger.fraud;

import java.time.Duration;
import java.util.Optional;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;

/** The rule set. Cheap in-memory rules run before the ones that query the database. */
@Configuration
public class FraudRules {

    @Bean
    @Order(1)
    FraudRule maxSingleTransfer(FraudProperties props) {
        return ctx -> ctx.amountMinor() > props.maxSingleTransferMinor()
                ? Optional.of("AMOUNT_OVER_SINGLE_LIMIT")
                : Optional.empty();
    }

    @Bean
    @Order(2)
    FraudRule newAccountLargeTransfer(FraudProperties props) {
        return ctx -> {
            Duration age = Duration.between(ctx.source().createdAt(), ctx.now());
            return age.compareTo(props.newAccountAge()) < 0 && ctx.amountMinor() > props.newAccountMaxTransferMinor()
                    ? Optional.of("NEW_ACCOUNT_LARGE_TRANSFER")
                    : Optional.empty();
        };
    }

    @Bean
    @Order(3)
    FraudRule velocity(FraudProperties props, FraudStatsRepository stats) {
        return ctx -> {
            int recent = stats.countTransfersSince(ctx.source().id(), ctx.now().minus(props.velocityWindow()));
            return recent >= props.velocityMaxTransfers() ? Optional.of("VELOCITY_LIMIT") : Optional.empty();
        };
    }

    @Bean
    @Order(4)
    FraudRule dailyOutflow(FraudProperties props, FraudStatsRepository stats) {
        return ctx -> {
            long sent = stats.completedOutflowSince(ctx.source().id(), ctx.now().minus(Duration.ofHours(24)));
            return sent + ctx.amountMinor() > props.dailyOutflowLimitMinor()
                    ? Optional.of("DAILY_OUTFLOW_LIMIT")
                    : Optional.empty();
        };
    }
}
