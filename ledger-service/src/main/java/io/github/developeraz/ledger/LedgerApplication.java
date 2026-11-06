package io.github.developeraz.ledger;

import java.time.Clock;
import io.github.developeraz.ledger.spending.SpendingService;
import io.github.developeraz.ledger.requests.PaymentRequestService;
import org.springframework.aot.hint.annotation.RegisterReflectionForBinding;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.context.annotation.Bean;
import org.springframework.scheduling.annotation.EnableScheduling;

@RegisterReflectionForBinding({SpendingService.Input.class, PaymentRequestService.Split.class, PaymentRequestService.Payer.class})
@SpringBootApplication
@ConfigurationPropertiesScan
@EnableScheduling
public class LedgerApplication {

    public static void main(String[] args) {
        SpringApplication.run(LedgerApplication.class, args);
    }

    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }

    /** Chain RPC latency must not prevent the broker outbox from draining. */
    @Bean
    org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler taskScheduler() {
        var scheduler = new org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler();
        scheduler.setPoolSize(2);
        scheduler.setThreadNamePrefix("ledger-relay-");
        return scheduler;
    }
}
