package io.github.developeraz.ledger.chain;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import io.github.developeraz.ledger.transfer.Transfer;

/** Versioned and salted: public commitments cannot be dictionary-guessed from an amount or memo. */
public final class Commitment {
    private static final SecureRandom RANDOM = new SecureRandom();
    private Commitment() { }
    public static String sha256(String value) { return sha256(value.getBytes(StandardCharsets.UTF_8)); }
    public static String sha256(byte[] value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value)); }
        catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    public static String key(String namespace, java.util.UUID id) {
        return "0x" + sha256("p2p-ledger/key/v1\n" + namespace + "\n" + id);
    }
    public static String preimage(Transfer t) {
        byte[] salt = new byte[32]; RANDOM.nextBytes(salt);
        return String.join("\n", "p2p-ledger/receipt/v1", t.id().toString(), t.kind().name(),
                t.sourceAccountId().toString(), t.destinationAccountId().toString(), Long.toString(t.amountMinor()),
                t.currency(), t.memo() == null ? "null" : "base64:" + Base64.getEncoder().encodeToString(t.memo().getBytes(StandardCharsets.UTF_8)),
                t.createdAt().toString(), HexFormat.of().formatHex(salt));
    }
}
