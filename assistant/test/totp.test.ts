/**
 * Acceptance tests for step 2.2 — TOTP MFA primitives (RFC 4226 / RFC 6238).
 *
 * These encode the target behaviour of `src/server/totp.ts` and are expected to
 * fail until that module exists (vitest: missing module).
 *
 * No new dependency: everything here is node:crypto backed.
 */
import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  hotp,
  otpauthUri,
  totp,
  verifyRecoveryCode,
  verifyTotp,
} from '../src/server/totp.js';

const STEP_MS = 30_000;

/** RFC 4226 / RFC 6238 seed: ASCII "1234567890" repeated to the key length. */
function seed(bytes: number): Buffer {
  return Buffer.from('1234567890'.repeat(Math.ceil(bytes / 10)).slice(0, bytes), 'ascii');
}

/** Changes one character in the middle of a blob, whatever its encoding/prefix is. */
function flipMiddle(blob: string): string {
  const index = Math.floor(blob.length / 2);
  const replacement = blob[index] === 'A' ? 'B' : 'A';
  return blob.slice(0, index) + replacement + blob.slice(index + 1);
}

/** A 6-digit code that is guaranteed not to be `valid`. */
function wrongCode(valid: string): string {
  return valid === '000000' ? '111111' : '000000';
}

describe('HOTP (RFC 4226)', () => {
  it('matches Appendix D vectors for counters 0-9', () => {
    const secret = seed(20);
    const expected = [
      '755224', '287082', '359152', '969429', '338314',
      '254676', '287922', '162583', '399871', '520489',
    ];
    expected.forEach((code, counter) => {
      expect(hotp(secret, counter), `HOTP counter ${counter}`).toBe(code);
    });
  });

  it('defaults to 6 digits and SHA1', () => {
    expect(hotp(seed(20), 0)).toBe('755224');
    expect(hotp(seed(20), 1, 6, 'sha1')).toBe('287082');
  });
});

describe('TOTP (RFC 6238)', () => {
  const vectors: Array<{ time: number; sha1: string; sha256: string; sha512: string }> = [
    { time: 59, sha1: '94287082', sha256: '46119246', sha512: '90693936' },
    { time: 1111111109, sha1: '07081804', sha256: '68084774', sha512: '25091201' },
    { time: 1111111111, sha1: '14050471', sha256: '67062674', sha512: '99943326' },
    { time: 1234567890, sha1: '89005924', sha256: '91819424', sha512: '93441116' },
    { time: 2000000000, sha1: '69279037', sha256: '90698825', sha512: '38618901' },
    { time: 20000000000, sha1: '65353130', sha256: '77737706', sha512: '47863826' },
  ];

  it('matches Appendix B vectors for SHA1, SHA256 and SHA512 with 8 digits', () => {
    for (const vector of vectors) {
      const at = vector.time * 1000;
      expect(totp(seed(20), at, { digits: 8, algo: 'sha1' }), `sha1 @ ${vector.time}`)
        .toBe(vector.sha1);
      expect(totp(seed(32), at, { digits: 8, algo: 'sha256' }), `sha256 @ ${vector.time}`)
        .toBe(vector.sha256);
      expect(totp(seed(64), at, { digits: 8, algo: 'sha512' }), `sha512 @ ${vector.time}`)
        .toBe(vector.sha512);
    }
  });

  it('defaults to 6 digits and a 30 second step', () => {
    // Same counter as the RFC vector at t=59 (step 1), truncated to 6 digits.
    expect(totp(seed(20), 59_000)).toBe('287082');
    expect(totp(seed(20), 59_000)).toBe(hotp(seed(20), 1));
    // The step boundary sits at multiples of 30 s: 89.999 s is still step 2.
    expect(totp(seed(20), 89_999)).toBe(hotp(seed(20), 2));
    expect(totp(seed(20), 90_000)).toBe(hotp(seed(20), 3));
  });
});

describe('verifyTotp', () => {
  const secret = seed(20);
  const at = 1_234_567_890_000; // a whole number of 30 s steps
  const currentStep = Math.floor(at / STEP_MS);

  it('accepts the current step and reports it', () => {
    const result = verifyTotp(secret, totp(secret, at), at);
    expect(result.ok).toBe(true);
    expect(result.step).toBe(currentStep);
  });

  it('accepts one step either side of the clock (skew) and rejects two', () => {
    const previous = totp(secret, at - STEP_MS);
    const next = totp(secret, at + STEP_MS);
    const twoBack = totp(secret, at - 2 * STEP_MS);
    const twoAhead = totp(secret, at + 2 * STEP_MS);

    expect(verifyTotp(secret, previous, at).ok, 'step-1 must be accepted').toBe(true);
    expect(verifyTotp(secret, next, at).ok, 'step+1 must be accepted').toBe(true);
    expect(verifyTotp(secret, twoBack, at).ok, 'step-2 must be rejected').toBe(false);
    expect(verifyTotp(secret, twoAhead, at).ok, 'step+2 must be rejected').toBe(false);

    // window: 0 disables skew entirely.
    expect(verifyTotp(secret, previous, at, { window: 0 }).ok).toBe(false);
    expect(verifyTotp(secret, totp(secret, at), at, { window: 0 }).ok).toBe(true);
  });

  it('rejects a wrong code and a code from another secret', () => {
    const valid = totp(secret, at);
    expect(verifyTotp(secret, wrongCode(valid), at).ok).toBe(false);
    expect(verifyTotp(secret, totp(seed(32), at), at).ok).toBe(false);
    expect(verifyTotp(secret, 'not-a-code', at).ok).toBe(false);
  });

  it('rejects a replayed step (step <= lastUsedStep)', () => {
    const code = totp(secret, at);
    const first = verifyTotp(secret, code, at);
    expect(first.ok).toBe(true);
    expect(first.step).toBe(currentStep);

    expect(verifyTotp(secret, code, at, { lastUsedStep: currentStep }).ok,
      'the same step must not verify twice').toBe(false);
    expect(verifyTotp(secret, totp(secret, at - STEP_MS), at, { lastUsedStep: currentStep }).ok,
      'an older step must not verify once a newer one is used').toBe(false);
    expect(verifyTotp(secret, totp(secret, at + STEP_MS), at, { lastUsedStep: currentStep }).ok,
      'the next step must still verify').toBe(true);
  });
});

describe('base32 (RFC 4648, no padding)', () => {
  it('encodes and decodes the canonical RFC 4648 example', () => {
    expect(base32Encode(Buffer.from('Hello', 'ascii'))).toBe('JBSWY3DP');
    expect(base32Encode(Buffer.from('Hello', 'ascii'))).not.toContain('=');
    expect(base32Decode('JBSWY3DP').toString('ascii')).toBe('Hello');
  });

  it('round-trips arbitrary bytes', () => {
    const bytes = Buffer.from([0x00, 0x01, 0x7f, 0x80, 0xfe, 0xff, 0x42, 0x00, 0xab, 0xcd]);
    const encoded = base32Encode(bytes);
    expect(encoded).toMatch(/^[A-Z2-7]+$/);
    expect(base32Decode(encoded).equals(bytes)).toBe(true);
  });

  it('decodes case-insensitively and ignores spaces', () => {
    const expected = Buffer.from('Hello', 'ascii');
    expect(base32Decode('jbswy3dp').equals(expected)).toBe(true);
    expect(base32Decode('JBSW Y3DP').equals(expected)).toBe(true);
    expect(base32Decode(' jbsw y3dp ').equals(expected)).toBe(true);
  });

  it('round-trips a binary TOTP secret', () => {
    const secret = seed(20);
    expect(base32Decode(base32Encode(secret)).equals(secret)).toBe(true);
  });
});

describe('otpauthUri', () => {
  it('builds a labelled otpauth URI with the default issuer', () => {
    const secret = seed(20);
    const uri = otpauthUri(secret, 'sam@example.com');
    const url = new URL(uri);

    expect(url.protocol).toBe('otpauth:');
    expect(url.hostname).toBe('totp');
    expect(decodeURIComponent(url.pathname)).toBe('/Settle:sam@example.com');
    expect(url.searchParams.get('secret')).toBe(base32Encode(secret));
    expect(url.searchParams.get('issuer')).toBe('Settle');
    expect(url.searchParams.get('algorithm')).toBe('SHA1');
    expect(url.searchParams.get('digits')).toBe('6');
    expect(url.searchParams.get('period')).toBe('30');
  });

  it('URL-encodes a custom issuer and the account label', () => {
    const uri = otpauthUri(seed(20), 'sam+ledger@example.com', 'Settle Books');
    const url = new URL(uri);
    expect(url.searchParams.get('issuer')).toBe('Settle Books');
    expect(decodeURIComponent(url.pathname)).toBe('/Settle Books:sam+ledger@example.com');
  });
});

describe('recovery codes', () => {
  it('generates ten unique xxxx-xxxx codes', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}$/);
      expect(code).toBe(code.toLowerCase());
    }
    expect(generateRecoveryCodes(4)).toHaveLength(4);
  });

  it('hashes with a random salt and verifies, normalising case and dashes', async () => {
    const code = generateRecoveryCodes(1)[0]!;
    const hash = await hashRecoveryCode(code);

    expect(hash).not.toBe(code);
    expect(await verifyRecoveryCode(code, hash)).toBe(true);
    expect(await verifyRecoveryCode(code.toUpperCase(), hash),
      'verification must ignore case').toBe(true);
    expect(await verifyRecoveryCode(code.replace('-', ''), hash),
      'verification must ignore dashes').toBe(true);

    // Random salt: the same code hashes differently every time, both still verify.
    const again = await hashRecoveryCode(code);
    expect(again).not.toBe(hash);
    expect(await verifyRecoveryCode(code, again)).toBe(true);
  });

  it('returns false for a wrong code', async () => {
    const code = generateRecoveryCodes(1)[0]!;
    const other = generateRecoveryCodes(1)[0]!;
    const hash = await hashRecoveryCode(code);

    expect(await verifyRecoveryCode(other, hash)).toBe(false);
    expect(await verifyRecoveryCode(['wrong', 'code'].join('-'), hash)).toBe(false);
  });
});

describe('secret encryption (AES-256-GCM)', () => {
  const key = Buffer.alloc(32, 0x2a);
  const otherKey = Buffer.alloc(32, 0x2b);
  const secret = seed(20);

  it('round-trips a secret and uses a fresh IV per call', () => {
    const first = encryptSecret(secret, key);
    const second = encryptSecret(secret, key);

    expect(typeof first).toBe('string');
    expect(first).not.toBe(second);
    expect(first).not.toContain(secret.toString('ascii'));
    expect(decryptSecret(first, key).equals(secret)).toBe(true);
    expect(decryptSecret(second, key).equals(secret)).toBe(true);
  });

  it('throws on the wrong key', () => {
    const blob = encryptSecret(secret, key);
    expect(() => decryptSecret(blob, otherKey)).toThrow();
  });

  it('throws when the blob is tampered with', () => {
    const blob = encryptSecret(secret, key);
    expect(() => decryptSecret(flipMiddle(blob), key)).toThrow();
  });

  it('throws on a blob that is not ciphertext', () => {
    expect(() => decryptSecret(['not', 'a', 'blob'].join('-'), key)).toThrow();
  });
});
