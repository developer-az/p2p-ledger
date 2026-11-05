package io.github.developeraz.ledger.chain;

import java.time.Clock;
import java.time.Duration;
import java.util.Map;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Gauge;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

@Component
public class ChainReceiptRelay {
    private final ChainReceiptRepository receipts;
    private final ChainProperties config;
    private final EthereumRpc rpc;
    private final TransactionTemplate tx;
    private final Clock clock;
    private final MeterRegistry meters;

    public ChainReceiptRelay(ChainReceiptRepository receipts, ChainProperties config, EthereumRpc rpc,
                             TransactionTemplate tx, Clock clock, MeterRegistry meters) {
        this.receipts = receipts; this.config = config; this.rpc = rpc; this.tx = tx; this.clock = clock; this.meters = meters;
        Gauge.builder("ledger.chain.pending", receipts, ChainReceiptRepository::pendingCount).register(meters);
        Gauge.builder("ledger.chain.failed", receipts, ChainReceiptRepository::failedCount).register(meters);
    }

    @Scheduled(fixedDelayString="${ledger.chain.poll-interval-ms:10000}")
    public void relay() {
        if (!config.enabled()) return;
        tx.executeWithoutResult(status -> {
            if (!receipts.lockRelayer()) return;
            receipts.claim().ifPresent(this::process);
        });
    }

    void process(ChainReceipt job) {
        try {
            if (job.chainId() != config.chainId() || !job.contractAddress().equalsIgnoreCase(config.contractAddress()))
                throw new IllegalStateException("Queued target differs from configured target");
            rpc.verifyTarget();
            var latest = rpc.receipt(job.transferKey(), "latest");
            if (latest.exists()) {
                checkCommitment(job, latest);
                var finalized = rpc.receipt(job.transferKey(), config.finalityTag());
                if (finalized.exists()) {
                    checkCommitment(job, finalized);
                    // Recover the canonical tx hash even after an ambiguous send timeout / process crash.
                    String block = EthereumRpc.hex(java.math.BigInteger.valueOf(finalized.block()));
                    var logs = rpc.call("eth_getLogs", Map.of("address", job.contractAddress(), "fromBlock", block,
                            "toBlock", block, "topics", java.util.List.of(EthereumRpc.ANCHORED_TOPIC, job.transferKey(), job.commitment())));
                    if (!logs.isArray() || logs.size() != 1 || logs.get(0).path("removed").asBoolean())
                        throw new IllegalStateException("Canonical anchor event missing or ambiguous");
                    String hash = logs.get(0).path("transactionHash").asText();
                    if (!hash.matches("0x[0-9a-fA-F]{64}")) throw new IllegalStateException("Invalid event transaction hash");
                    receipts.update(job.transferId(), "FINALIZED", hash, finalized.block(), job.attempts(), null, clock.instant());
                    meters.counter("ledger.chain.finalized").increment();
                } else {
                    receipts.update(job.transferId(), "SUBMITTED", job.transactionHash(), latest.block(), job.attempts(), null, clock.instant().plusSeconds(15));
                }
                return;
            }
            if (job.transactionHash() != null) {
                var receipt = rpc.call("eth_getTransactionReceipt", job.transactionHash());
                if (!receipt.isNull() && "0x0".equals(receipt.path("status").asText()))
                    throw new IllegalStateException("Anchor transaction reverted");
                // Never blindly replace a pending transaction; an operator must inspect the signer nonce.
                if (job.submittedAt() != null && Duration.between(job.submittedAt(), clock.instant()).toMinutes() >= 30)
                    throw new IllegalStateException("Transaction stalled; inspect signer before redrive");
                receipts.update(job.transferId(), "SUBMITTED", job.transactionHash(), null, job.attempts(), "Awaiting inclusion", clock.instant().plusSeconds(15));
                return;
            }
            String hash = rpc.submit(job);
            receipts.update(job.transferId(), "SUBMITTED", hash, null, job.attempts(), null, clock.instant().plusSeconds(10));
            meters.counter("ledger.chain.submitted").increment();
        } catch (Exception failure) {
            int attempts = job.attempts() + 1;
            String error = failure instanceof IllegalStateException ? failure.getMessage() : "Chain processing failed";
            if (error == null || error.length() > 200) error = "Chain processing failed";
            receipts.update(job.transferId(), attempts >= config.maxAttempts() ? "FAILED" : job.status(),
                    job.transactionHash(), job.blockNumber(), attempts, error,
                    clock.instant().plusSeconds(Math.min(3600, 5L << Math.min(attempts, 9))));
            meters.counter("ledger.chain.errors").increment();
        }
    }
    private static void checkCommitment(ChainReceipt job, EthereumRpc.OnChain receipt) {
        if (!job.commitment().equalsIgnoreCase(receipt.commitment())) throw new IllegalStateException("Conflicting on-chain commitment");
    }
}
