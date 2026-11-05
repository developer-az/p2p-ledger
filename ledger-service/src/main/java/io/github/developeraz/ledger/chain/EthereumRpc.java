package io.github.developeraz.ledger.chain;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.math.BigInteger;
import java.util.List;
import java.util.Map;
import java.util.HexFormat;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Bounded JSON-RPC transport. Signing stays in a dedicated, authenticated signer gateway. */
@Component
public class EthereumRpc {
    // Generated from the compiled ABI; cross-checked by the Solidity tests.
    public static final String ANCHOR_SELECTOR = "0xa21f3c6a";
    public static final String RECEIPTS_SELECTOR = "0xef6cf04d";
    public static final String ANCHORED_TOPIC = "0x03e56f204fcaabef74fd2cf9ab79bcf937dec6eefc9320826f5e7ffc0ddfcfc4";
    private final HttpClient http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(3)).build();
    private final AtomicLong ids = new AtomicLong();
    private final JsonMapper json;
    private final ChainProperties config;

    public EthereumRpc(JsonMapper json, ChainProperties config) { this.json = json; this.config = config; }

    public JsonNode call(String method, Object... params) { return request(config.rpcUrl(), method, params); }
    public JsonNode sign(String method, Object... params) { return request(config.signerRpcUrl(), method, params); }

    private JsonNode request(String url, String method, Object[] params) {
        long id = ids.incrementAndGet();
        try {
            String body = json.writeValueAsString(Map.of("jsonrpc", "2.0", "id", id, "method", method, "params", List.of(params)));
            var req = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(8))
                    .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(body)).build();
            var pending = http.sendAsync(req, info -> new BoundedBody());
            try {
                var response = pending.get(10, java.util.concurrent.TimeUnit.SECONDS);
                if (response.statusCode() != 200) throw new IllegalStateException("RPC HTTP failure: " + method + " (" + response.statusCode() + ")");
                JsonNode result = json.readTree(response.body());
                if (result.path("id").asLong(-1) != id || result.has("error") || !result.has("result"))
                    throw new IllegalStateException("RPC " + method + " rejected");
                return result.get("result");
            } catch (java.util.concurrent.TimeoutException | java.util.concurrent.ExecutionException e) {
                pending.cancel(true);
                throw new IllegalStateException("RPC timeout or transport failure");
            } catch (InterruptedException e) {
                pending.cancel(true); throw e;
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt(); throw new IllegalStateException("RPC interrupted");
        }
    }

    private static final class BoundedBody implements HttpResponse.BodySubscriber<byte[]> {
        private final HttpResponse.BodySubscriber<byte[]> delegate = HttpResponse.BodySubscribers.ofByteArray();
        private java.util.concurrent.Flow.Subscription subscription;
        private long bytes;
        private boolean rejected;
        public java.util.concurrent.CompletionStage<byte[]> getBody() { return delegate.getBody(); }
        public void onSubscribe(java.util.concurrent.Flow.Subscription subscription) {
            this.subscription=subscription; delegate.onSubscribe(subscription);
        }
        public void onNext(List<java.nio.ByteBuffer> buffers) {
            if (rejected) return;
            for (var buffer: buffers) bytes += buffer.remaining();
            if (bytes > 262144) {
                rejected=true; subscription.cancel(); delegate.onError(new java.io.IOException("RPC response too large"));
            } else delegate.onNext(buffers);
        }
        public void onError(Throwable error) { if (!rejected) delegate.onError(error); }
        public void onComplete() { if (!rejected) delegate.onComplete(); }
    }

    public void verifyTarget() {
        if (quantity(call("eth_chainId").asText()).longValueExact() != config.chainId()
                || quantity(sign("eth_chainId").asText()).longValueExact() != config.chainId())
            throw new IllegalStateException("Wrong chain ID");
        String code = call("eth_getCode", config.contractAddress(), "latest").asText();
        if (!config.runtimeSha256().equalsIgnoreCase("0x" + Commitment.sha256(HexFormat.of().parseHex(code.substring(2)))))
            throw new IllegalStateException("Contract runtime fingerprint mismatch");
    }

    public record OnChain(String commitment, long block) {
        public boolean exists() { return !commitment.equals("0x" + "0".repeat(64)); }
    }
    public OnChain receipt(String key, String tag) {
        String data = call("eth_call", Map.of("to", config.contractAddress(), "data", RECEIPTS_SELECTOR + key.substring(2)), tag).asText();
        // The finalized block may predate this deployment for the first few minutes.
        if (data.equals("0x") && tag.equals("finalized")) return new OnChain("0x" + "0".repeat(64), 0);
        if (!data.matches("0x[0-9a-fA-F]{128}")) throw new IllegalStateException("Invalid receipt ABI response");
        return new OnChain(data.substring(0, 66).toLowerCase(), new BigInteger(data.substring(66), 16).longValueExact());
    }

    public String submit(ChainReceipt job) {
        BigInteger price = quantity(call("eth_gasPrice").asText());
        if (price.signum() <= 0 || price.compareTo(BigInteger.valueOf(config.maxGasPriceWei())) > 0)
            throw new IllegalStateException("Gas price exceeds policy");
        var txn = new java.util.LinkedHashMap<String, String>();
        txn.put("from", config.relayerAddress()); txn.put("to", config.contractAddress()); txn.put("value", "0x0");
        txn.put("data", ANCHOR_SELECTOR + job.transferKey().substring(2) + job.commitment().substring(2));
        txn.put("gasPrice", hex(price));
        BigInteger gas = quantity(call("eth_estimateGas", txn).asText()).multiply(BigInteger.valueOf(120)).divide(BigInteger.valueOf(100));
        if (gas.signum() <= 0 || gas.compareTo(BigInteger.valueOf(config.maxGas())) > 0)
            throw new IllegalStateException("Gas estimate exceeds policy");
        txn.put("gas", hex(gas));
        String hash = sign("eth_sendTransaction", txn).asText();
        if (!hash.matches("0x[0-9a-fA-F]{64}")) throw new IllegalStateException("Invalid transaction hash");
        return hash;
    }
    public static BigInteger quantity(String hex) {
        if (!hex.matches("0x[0-9a-fA-F]+")) throw new IllegalStateException("Invalid RPC quantity");
        return new BigInteger(hex.substring(2), 16);
    }
    public static String hex(BigInteger value) { return "0x" + value.toString(16); }
}
