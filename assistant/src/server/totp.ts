/**
 * TOTP MFA primitives (RFC 4226 / RFC 6238), built on node:crypto only.
 *
 * No new dependency: HOTP/TOTP, base32, recovery-code hashing and secret
 * encryption all live here so the auth routes and both auth stores share one
 * implementation.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scrypt as scryptCb,
  scryptSync,
  timingSafeEqual,
  randomInt,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

export type TotpAlgorithm = 'sha1' | 'sha256' | 'sha512';

export interface TotpOptions {
  digits?: number;
  algo?: TotpAlgorithm;
  /** Step length in seconds. */
  period?: number;
}

export interface VerifyTotpOptions extends TotpOptions {
  /** Accepted steps either side of the current one. Defaults to 1 (±30 s). */
  window?: number;
  /** A step that already produced a session must not verify again. */
  lastUsedStep?: number | null;
}

export interface VerifyTotpResult {
  ok: boolean;
  /** The counter that matched, when `ok` is true. */
  step?: number;
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DEFAULT_PERIOD_SEC = 30;
const DEFAULT_DIGITS = 6;

/** RFC 4648 base32 without padding, uppercase. */
export function base32Encode(bytes: Buffer): string {
  let value = 0;
  let bits = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Case-insensitive base32 decoder that ignores spaces and padding. */
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  const out: number[] = [];
  let value = 0;
  let bits = 0;
  for (const char of clean) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  return Buffer.from(out);
}

/** RFC 4226 HOTP. `counter` is the moving factor, not a timestamp. */
export function hotp(secret: Buffer, counter: number, digits = DEFAULT_DIGITS,
  algo: TotpAlgorithm = 'sha1'): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac(algo, secret).update(message).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary = ((mac[offset]! & 0x7f) << 24)
    | (mac[offset + 1]! << 16)
    | (mac[offset + 2]! << 8)
    | mac[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** RFC 6238 TOTP at a millisecond timestamp. */
export function totp(secret: Buffer, atMs: number, opts: TotpOptions = {}): string {
  const periodMs = (opts.period ?? DEFAULT_PERIOD_SEC) * 1000;
  return hotp(secret, Math.floor(atMs / periodMs), opts.digits ?? DEFAULT_DIGITS, opts.algo ?? 'sha1');
}

/**
 * Verifies a code at `atMs`, accepting one step either side by default.
 * A step at or below `lastUsedStep` is rejected, so a code cannot be replayed
 * within (or across) its 30 second window.
 */
export function verifyTotp(secret: Buffer, code: string, atMs: number,
  opts: VerifyTotpOptions = {}): VerifyTotpResult {
  const digits = opts.digits ?? DEFAULT_DIGITS;
  const periodMs = (opts.period ?? DEFAULT_PERIOD_SEC) * 1000;
  const current = Math.floor(atMs / periodMs);
  const window = Math.max(0, Math.trunc(opts.window ?? 1));
  const candidate = String(code ?? '').trim();
  if (!new RegExp(`^\\d{${digits}}$`).test(candidate)) return { ok: false };
  const expected = Buffer.from(candidate);
  for (let step = Math.max(0, current - window); step <= current + window; step++) {
    if (opts.lastUsedStep != null && step <= opts.lastUsedStep) continue;
    const actual = Buffer.from(hotp(secret, step, digits, opts.algo));
    if (actual.length === expected.length && timingSafeEqual(actual, expected)) {
      return { ok: true, step };
    }
  }
  return { ok: false };
}

const RECOVERY_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const RECOVERY_GROUPS = 2;
const RECOVERY_GROUP_LEN = 4;

/** Ten unique xxxx-xxxx codes by default. */
export function generateRecoveryCodes(count = 10): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    const raw = Array.from({ length: RECOVERY_GROUPS * RECOVERY_GROUP_LEN }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join('');
    codes.add(`${raw.slice(0, RECOVERY_GROUP_LEN)}-${raw.slice(RECOVERY_GROUP_LEN)}`);
  }
  return [...codes];
}

function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Salted scrypt hash; case and dashes do not matter to verification. */
export async function hashRecoveryCode(code: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = (await scrypt(normalizeRecoveryCode(code), salt, 32)) as Buffer;
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyRecoveryCode(code: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  if (expected.length === 0) return false;
  const actual = (await scrypt(normalizeRecoveryCode(code), Buffer.from(saltB64, 'base64'), expected.length)) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const CIPHER_VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** AES-256-GCM blob: v1.<iv>.<tag>.<ciphertext>, base64url segments. */
export function encryptSecret(secret: Buffer, key: Buffer): string {
  if (key.length !== 32) throw new Error('MFA encryption key must be 32 bytes');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  return [
    CIPHER_VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptSecret(blob: string, key: Buffer): Buffer {
  if (key.length !== 32) throw new Error('MFA encryption key must be 32 bytes');
  const [version, ivB64, tagB64, dataB64] = blob.split('.');
  if (version !== CIPHER_VERSION || !ivB64 || !tagB64 || dataB64 === undefined) {
    throw new Error('MFA secret is malformed');
  }
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error('MFA secret is malformed');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]);
}

/** Development-only fallback key. Production requires MFA_ENCRYPTION_KEY. */
export function devMfaKey(): Buffer {
  return scryptSync('settle-dev-mfa-key', 'settle-dev-mfa-salt', 32);
}

/** Authenticator provisioning URI. */
export function otpauthUri(secret: Buffer, account: string, issuer = 'Settle'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: 'SHA1',
    digits: String(DEFAULT_DIGITS),
    period: String(DEFAULT_PERIOD_SEC),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
