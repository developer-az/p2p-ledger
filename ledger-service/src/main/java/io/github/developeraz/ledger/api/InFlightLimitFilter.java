package io.github.developeraz.ledger.api;

import java.io.IOException;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Load shedding. Virtual threads remove the thread-pool cap, so without a limit a burst parks
 * thousands of requests on the heap waiting for a database connection; under load testing this
 * ran the JVM out of memory. Requests beyond the cap wait briefly for a slot, then get a fast
 * 503 with Retry-After, which keeps latency and memory flat for the requests that are admitted.
 */
@Component
public class InFlightLimitFilter extends OncePerRequestFilter {

    private final Semaphore slots;
    private final long queueWaitMs;
    private final Counter shed;

    public InFlightLimitFilter(@Value("${ledger.http.max-in-flight:64}") int maxInFlight,
                               @Value("${ledger.http.queue-wait-ms:200}") long queueWaitMs,
                               MeterRegistry meters) {
        this.slots = new Semaphore(maxInFlight);
        this.queueWaitMs = queueWaitMs;
        this.shed = meters.counter("ledger.http.shed");
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/v1/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        boolean acquired;
        try {
            acquired = slots.tryAcquire(queueWaitMs, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            acquired = false;
        }
        if (!acquired) {
            shed.increment();
            response.setStatus(HttpStatus.SERVICE_UNAVAILABLE.value());
            response.setHeader(HttpHeaders.RETRY_AFTER, "1");
            response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
            response.getWriter().write("{\"status\":503,\"title\":\"Service Unavailable\",\"detail\":\"Server busy, retry shortly\"}");
            return;
        }
        try {
            chain.doFilter(request, response);
        } finally {
            slots.release();
        }
    }
}
