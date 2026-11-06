package io.github.developeraz.ledger.chain;

import java.net.URI;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("ledger.chain")
public record ChainProperties(boolean enabled, long chainId, String namespace, String rpcUrl, String signerRpcUrl,
                              String contractAddress, String runtimeSha256, String relayerAddress,
                              String finalityTag, long maxGasPriceWei, long maxGas, int maxAttempts) {
    public void validate() {
        if (!enabled) return;
        if (chainId <= 0 || namespace == null || !namespace.matches("[a-zA-Z0-9._-]{1,64}")) invalid();
        if (contractAddress == null || !contractAddress.matches("0x[0-9a-fA-F]{40}") || contractAddress.matches("0x0{40}")) invalid();
        if (relayerAddress == null || !relayerAddress.matches("0x[0-9a-fA-F]{40}") || relayerAddress.matches("0x0{40}")) invalid();
        if (runtimeSha256 == null || !runtimeSha256.matches("0x[0-9a-fA-F]{64}")) invalid();
        if (maxGas <= 0 || maxGas > 1_000_000 || maxGasPriceWei <= 0 || maxAttempts < 1 || maxAttempts > 100) invalid();
        if (!"finalized".equals(finalityTag) && !(chainId == 31337 && "latest".equals(finalityTag))) invalid();
        validateUrl(rpcUrl); validateUrl(signerRpcUrl);
    }
    private static void validateUrl(String url) {
        if (url == null) { invalid(); return; }
        URI uri = URI.create(url);
        if (uri.getUserInfo() != null || uri.getHost() == null) invalid();
        if (!"https".equals(uri.getScheme()) && !("http".equals(uri.getScheme()) &&
                ("localhost".equals(uri.getHost()) || "127.0.0.1".equals(uri.getHost())))) invalid();
    }
    private static void invalid() { throw new IllegalArgumentException("Invalid chain configuration; see contracts/README.md"); }
}
