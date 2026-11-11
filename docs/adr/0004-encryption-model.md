# 0004 — Encryption model: envelope encryption, not obfuscation

## Status

Accepted, 2026-11-11. Folds in PLAN 2.5b; implementation ships with M3 (2.5).

## Context

The question that keeps arriving is whether "advanced encryption" should mean
obfuscating the JavaScript bundle or shipping a compiled binary. Both are theatre: any
code sent to a browser can be read, and readable client code is how the app gets
audited. The real question is where keys live and who can use them. The data also gets
more sensitive in M3: raw bank descriptors, account last-4 digits and uploaded statement
files, rather than simulated balances and typed logs.

## Decision

1. **In transit.** TLS 1.2+ with HSTS (`max-age=63072000; includeSubDomains`) on every
   surface. Live today; database certificate verification is the separate fix in 2.3b.
2. **At rest, provider-managed.** Postgres and S3 encryption from the provider: no work
   from us, and no protection against a stolen dump on its own.
3. **At rest, application-level.** Sensitive columns (raw descriptors, notes, account
   last4, uploaded files) are encrypted with AES-256-GCM through `node:crypto` under a
   **per-user data key**, wrapped by a **KEK** in AWS KMS (ADR 0003), so the database
   never holds an unwrapped key. Development and practice mode use a local, file-backed
   KEK that is never committed. Blind indexes (HMAC-SHA256 over the normalized value)
   let de-duplication and merchant matching compare ciphertext without decrypting it.
   KEK rotation re-wraps data keys under a new version without re-encrypting rows.
4. **On delete.** Crypto-shredding: deleting an account destroys its wrapped data key.
   Ciphertext in live tables and backups stays, but nothing can decrypt it.

Rejected: client-side end-to-end encryption of live data. The server must de-duplicate,
resolve merchants, detect recurring charges and forecast cash, so it must read the data.
Encrypted export (passphrase → scrypt → AES-GCM) is an optional extra, not a substitute.

## Consequences

- Encryption, key custody and deletion become one mechanism, and deletion survives
  backups, because the key is the thing that is destroyed.
- About $1/month for the KMS key, approved with M3 (ADR 0003), plus a call per unwrap;
  data keys are cached per instance, so the count stays low.
- Encrypted columns cannot be searched or sorted. A queryable value lives in a blind
  index or stays plaintext by decision, recorded per column in THREAT-MODEL.md.
- A lost KEK means unrecoverable data. That is the point, and why rotation is tested
  before the feature is called done. Obfuscation and compilation are out of scope.
