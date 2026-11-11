/**
 * Minimal WebAuthn verification built on node:crypto.
 *
 * Scope on purpose:
 * - attestation format `none` only (no attestation trust chain to validate);
 * - ES256 (COSE alg -7, P-256) and RS256 (COSE alg -257);
 * - a small CBOR decoder that covers authenticator data and COSE keys.
 *
 * It also keeps the base64url, clientDataJSON, rpIdHash, flags and signature
 * counter checks in one place so the HTTP routes stay ordinary request code.
 */
import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
  type KeyObject,
} from 'node:crypto';

export type CborValue =
  | number
  | bigint
  | string
  | boolean
  | null
  | Uint8Array
  | CborValue[]
  | Map<CborValue, CborValue>
  | { [key: string]: CborValue };

/** A WebAuthn check failed; the code is safe to return to the browser. */
export class WebAuthnError extends Error {
  constructor(readonly code: string, readonly status = 400) {
    super(code);
    this.name = 'WebAuthnError';
  }
}

function fail(code: string, status = 400): never {
  throw new WebAuthnError(code, status);
}

/* -------------------------------------------------------------------------
 * CBOR
 * ---------------------------------------------------------------------- */

class CborReader {
  offset: number;

  constructor(private readonly bytes: Uint8Array, offset = 0) {
    this.offset = offset;
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  readByte(): number {
    if (this.offset >= this.bytes.length) fail('invalid_cbor');
    const value = this.bytes[this.offset]!;
    this.offset += 1;
    return value;
  }

  readBytes(length: number): Uint8Array {
    if (length < 0 || this.offset + length > this.bytes.length) fail('invalid_cbor');
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  readUint(additional: number): number | bigint {
    if (additional < 24) return additional;
    if (additional === 24) return this.readByte();
    if (additional === 25) return (this.readByte() * 0x100) + this.readByte();
    if (additional === 26) {
      let value = 0;
      for (let index = 0; index < 4; index += 1) value = (value * 0x100) + this.readByte();
      return value;
    }
    if (additional === 27) {
      let value = 0n;
      for (let index = 0; index < 8; index += 1) value = (value << 8n) | BigInt(this.readByte());
      return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
    }
    fail('invalid_cbor');
  }

  readLength(additional: number): number {
    const value = this.readUint(additional);
    if (typeof value === 'bigint' || value > Number.MAX_SAFE_INTEGER) fail('invalid_cbor');
    return value;
  }

  readFloat(width: 2 | 4 | 8): number {
    const bytes = this.readBytes(width);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (width === 2) return halfToNumber(view.getUint16(0));
    if (width === 4) return view.getFloat32(0);
    return view.getFloat64(0);
  }
}

function halfToNumber(bits: number): number {
  const sign = (bits & 0x8000) === 0 ? 1 : -1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 31) return fraction === 0 ? sign * Infinity : Number.NaN;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

function readCborItem(reader: CborReader): CborValue {
  const initial = reader.readByte();
  const major = initial >> 5;
  const additional = initial & 0x1f;

  if (major === 0) return reader.readUint(additional);
  if (major === 1) {
    const value = reader.readUint(additional);
    return typeof value === 'bigint' ? -1n - value : -1 - value;
  }
  if (major === 2) return reader.readBytes(reader.readLength(additional));
  if (major === 3) return Buffer.from(reader.readBytes(reader.readLength(additional))).toString('utf8');
  if (major === 4) {
    const length = reader.readLength(additional);
    const items: CborValue[] = [];
    for (let index = 0; index < length; index += 1) items.push(readCborItem(reader));
    return items;
  }
  if (major === 5) {
    const length = reader.readLength(additional);
    const entries: [CborValue, CborValue][] = [];
    let stringKeys = true;
    for (let index = 0; index < length; index += 1) {
      const key = readCborItem(reader);
      const value = readCborItem(reader);
      if (typeof key !== 'string') stringKeys = false;
      entries.push([key, value]);
    }
    if (stringKeys) {
      const object: { [key: string]: CborValue } = {};
      for (const [key, value] of entries) object[key as string] = value;
      return object;
    }
    return new Map(entries);
  }
  if (major === 6) {
    // Tag: read and discard it, then return the tagged value.
    reader.readUint(additional);
    return readCborItem(reader);
  }
  if (major === 7) {
    if (additional === 20) return false;
    if (additional === 21) return true;
    if (additional === 22 || additional === 23) return null;
    if (additional === 24) return reader.readByte();
    if (additional === 25) return reader.readFloat(2);
    if (additional === 26) return reader.readFloat(4);
    if (additional === 27) return reader.readFloat(8);
  }
  return fail('invalid_cbor');
}

/** Decodes exactly one CBOR item and rejects trailing bytes. */
export function decodeCbor(input: Uint8Array | ArrayBuffer): CborValue {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const { value, offset } = decodeCborAt(bytes);
  if (offset !== bytes.length) fail('invalid_cbor');
  return value;
}

/** Decodes one CBOR item at an offset; used for COSE keys inside auth data. */
export function decodeCborAt(input: Uint8Array | ArrayBuffer, offset = 0): { value: CborValue; offset: number } {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const reader = new CborReader(bytes, offset);
  const value = readCborItem(reader);
  return { value, offset: reader.offset };
}

function isRecord(value: CborValue | undefined): value is { [key: string]: CborValue } {
  return typeof value === 'object' && value !== null
    && !(value instanceof Map) && !(value instanceof Uint8Array) && !Array.isArray(value);
}

function mapValue(map: CborValue | undefined, key: CborValue): CborValue | undefined {
  if (map instanceof Map) return map.get(key);
  if (isRecord(map)) return map[String(key)];
  return undefined;
}

function requireBytes(value: CborValue | undefined): Uint8Array {
  if (!(value instanceof Uint8Array)) fail('invalid_credential');
  return value;
}

function requireNumber(value: CborValue | undefined): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) fail('invalid_credential');
  return value;
}

/* -------------------------------------------------------------------------
 * Base64url and browser objects
 * ---------------------------------------------------------------------- */

const BASE64URL = /^[A-Za-z0-9_-]*$/;

export function base64UrlToBytes(value: unknown): Buffer {
  if (typeof value !== 'string' || !BASE64URL.test(value)) fail('invalid_credential');
  return Buffer.from(value, 'base64url');
}

export function bytesToBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('invalid_credential');
  return value as Record<string, unknown>;
}

interface ParsedCredential {
  id: string;
  idBytes: Buffer;
  response: Record<string, unknown>;
}

function parseCredential(value: unknown): ParsedCredential {
  const credential = objectValue(value);
  if (credential.type != null && credential.type !== 'public-key') fail('invalid_credential');
  const response = objectValue(credential.response);
  const raw = credential.rawId ?? credential.id;
  const idBytes = base64UrlToBytes(raw);
  if (idBytes.length === 0) fail('invalid_credential');
  const id = bytesToBase64Url(idBytes);
  if (credential.id != null && base64UrlToBytes(credential.id).toString('base64url') !== id) {
    fail('invalid_credential');
  }
  return { id, idBytes, response };
}

interface ParsedClientData {
  type: string;
  challenge: string;
  origin: string;
  bytes: Buffer;
}

function parseClientData(raw: unknown): ParsedClientData {
  const bytes = base64UrlToBytes(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('invalid_client_data');
  }
  const data = objectValue(parsed);
  if (typeof data.type !== 'string' || typeof data.challenge !== 'string'
    || typeof data.origin !== 'string') {
    fail('invalid_client_data');
  }
  return { type: data.type, challenge: data.challenge, origin: data.origin, bytes };
}

/** Reads the challenge from clientDataJSON before the full signature check. */
export function readClientDataChallenge(value: unknown,
  expectedType: 'webauthn.create' | 'webauthn.get'): string {
  const credential = parseCredential(value);
  const client = parseClientData(credential.response.clientDataJSON);
  if (client.type !== expectedType) fail('invalid_client_data');
  return client.challenge;
}

/** Credential id as base64url, before looking up the stored key. */
export function readCredentialId(value: unknown): string {
  return parseCredential(value).id;
}

/* -------------------------------------------------------------------------
 * Authenticator data and COSE keys
 * ---------------------------------------------------------------------- */

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

interface ParsedAuthenticatorData {
  rpIdHash: Buffer;
  flags: number;
  signCount: number;
  userPresent: boolean;
  userVerified: boolean;
  credentialId: string | null;
  credentialIdBytes: Buffer | null;
  coseKey: CborValue | null;
}

function parseAuthenticatorData(bytes: Uint8Array, rpId: string): ParsedAuthenticatorData {
  if (bytes.length < 37) fail('invalid_authenticator_data');
  const rpIdHash = Buffer.from(bytes.subarray(0, 32));
  const flags = bytes[32]!;
  const signCount = Buffer.from(bytes.subarray(33, 37)).readUInt32BE(0);
  const expected = createHash('sha256').update(rpId).digest();
  if (rpIdHash.length !== expected.length || !timingSafeEqual(rpIdHash, expected)) {
    fail('invalid_rp_id');
  }
  const userPresent = (flags & FLAG_UP) !== 0;
  if (!userPresent) fail('user_not_present');

  let credentialId: string | null = null;
  let credentialIdBytes: Buffer | null = null;
  let coseKey: CborValue | null = null;
  if ((flags & FLAG_AT) !== 0) {
    if (bytes.length < 37 + 16 + 2 + 1) fail('invalid_authenticator_data');
    let offset = 37 + 16;
    const idLength = Buffer.from(bytes.subarray(offset, offset + 2)).readUInt16BE(0);
    offset += 2;
    if (idLength === 0 || offset + idLength > bytes.length) fail('invalid_authenticator_data');
    credentialIdBytes = Buffer.from(bytes.subarray(offset, offset + idLength));
    credentialId = bytesToBase64Url(credentialIdBytes);
    const decoded = decodeCborAt(bytes, offset + idLength);
    coseKey = decoded.value;
  }

  return {
    rpIdHash,
    flags,
    signCount,
    userPresent,
    userVerified: (flags & FLAG_UV) !== 0,
    credentialId,
    credentialIdBytes,
    coseKey,
  };
}

function coseToJwk(cose: CborValue): { jwk: Record<string, string>; alg: number } {
  const kty = requireNumber(mapValue(cose, 1));
  const alg = requireNumber(mapValue(cose, 3));
  if (alg === -7) {
    if (kty !== 2 || requireNumber(mapValue(cose, -1)) !== 1) fail('unsupported_algorithm');
    const x = requireBytes(mapValue(cose, -2));
    const y = requireBytes(mapValue(cose, -3));
    return {
      alg,
      jwk: {
        kty: 'EC',
        crv: 'P-256',
        x: bytesToBase64Url(x),
        y: bytesToBase64Url(y),
      },
    };
  }
  if (alg === -257) {
    if (kty !== 3) fail('unsupported_algorithm');
    const n = requireBytes(mapValue(cose, -1));
    const e = requireBytes(mapValue(cose, -2));
    return {
      alg,
      jwk: {
        kty: 'RSA',
        n: bytesToBase64Url(n),
        e: bytesToBase64Url(e),
      },
    };
  }
  return fail('unsupported_algorithm');
}

function publicKeyFromJwk(jwk: Record<string, string>): KeyObject {
  try {
    return createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' });
  } catch {
    return fail('invalid_credential');
  }
}

function credentialsMatch(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function transportsFrom(response: Record<string, unknown>): string[] {
  if (!Array.isArray(response.transports)) return [];
  return response.transports
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, 32))
    .filter(Boolean)
    .slice(0, 8);
}

/* -------------------------------------------------------------------------
 * Public verification API
 * ---------------------------------------------------------------------- */

export interface VerifiedRegistration {
  credentialId: string;
  publicKeyJwk: Record<string, string>;
  alg: number;
  signCount: number;
  transports: string[];
  userVerified: boolean;
}

export interface RegistrationCheckOptions {
  expectedChallenge: string;
  expectedOrigin: string;
  rpId: string;
}

/** Checks a registration response with attestation format `none`. */
export function verifyRegistration(value: unknown, options: RegistrationCheckOptions): VerifiedRegistration {
  const credential = parseCredential(value);
  const client = parseClientData(credential.response.clientDataJSON);
  if (client.type !== 'webauthn.create') fail('invalid_client_data');
  if (client.challenge !== options.expectedChallenge) fail('challenge_mismatch');
  if (client.origin !== options.expectedOrigin) fail('invalid_origin');

  if (typeof credential.response.attestationObject !== 'string') fail('invalid_credential');
  let attestation: CborValue;
  try {
    attestation = decodeCbor(base64UrlToBytes(credential.response.attestationObject));
  } catch (error) {
    if (error instanceof WebAuthnError) throw error;
    fail('invalid_credential');
  }
  const fmt = mapValue(attestation, 'fmt');
  if (fmt !== 'none') fail('unsupported_attestation');
  const authDataBytes = mapValue(attestation, 'authData');
  if (!(authDataBytes instanceof Uint8Array)) fail('invalid_credential');

  const authData = parseAuthenticatorData(authDataBytes, options.rpId);
  if (!authData.credentialIdBytes || !authData.credentialId || !authData.coseKey) {
    fail('invalid_credential');
  }
  if (!credentialsMatch(authData.credentialIdBytes, credential.idBytes)) fail('invalid_credential');

  const { jwk, alg } = coseToJwk(authData.coseKey);
  // Building the key now rejects malformed coordinates before storing it.
  publicKeyFromJwk(jwk);

  return {
    credentialId: authData.credentialId,
    publicKeyJwk: jwk,
    alg,
    signCount: authData.signCount,
    transports: transportsFrom(credential.response),
    userVerified: authData.userVerified,
  };
}

export interface StoredPasskeyKey {
  id: string;
  publicKeyJwk: Record<string, string>;
  alg: number;
  signCount: number;
}

export interface AssertionCheckOptions {
  expectedChallenge: string;
  expectedOrigin: string;
  rpId: string;
  passkey: StoredPasskeyKey;
}

export interface VerifiedAssertion {
  credentialId: string;
  signCount: number;
  userVerified: boolean;
}

/** Verifies an assertion and enforces the non-zero sign-counter regression rule. */
export function verifyAssertion(value: unknown, options: AssertionCheckOptions): VerifiedAssertion {
  const credential = parseCredential(value);
  const client = parseClientData(credential.response.clientDataJSON);
  if (client.type !== 'webauthn.get') fail('invalid_client_data');
  if (client.challenge !== options.expectedChallenge) fail('challenge_mismatch');
  if (client.origin !== options.expectedOrigin) fail('invalid_origin');

  if (!credentialsMatch(credential.idBytes, base64UrlToBytes(options.passkey.id))) {
    fail('invalid_credential');
  }
  if (typeof credential.response.authenticatorData !== 'string'
    || typeof credential.response.signature !== 'string') {
    fail('invalid_credential');
  }
  const authDataBytes = base64UrlToBytes(credential.response.authenticatorData);
  const authData = parseAuthenticatorData(authDataBytes, options.rpId);

  const signed = Buffer.concat([
    Buffer.from(authDataBytes),
    createHash('sha256').update(client.bytes).digest(),
  ]);
  const signature = base64UrlToBytes(credential.response.signature);
  const key = publicKeyFromJwk(options.passkey.publicKeyJwk);
  let valid = false;
  try {
    valid = options.passkey.alg === -7
      ? verifySignature('sha256', signed, { key, dsaEncoding: 'der' }, signature)
      : verifySignature('sha256', signed, { key, padding: 1 }, signature);
  } catch {
    valid = false;
  }
  if (!valid) fail('invalid_signature');

  if ((options.passkey.signCount > 0 || authData.signCount > 0)
    && authData.signCount <= options.passkey.signCount) {
    fail('passkey_cloned');
  }

  return {
    credentialId: credential.id,
    signCount: authData.signCount,
    userVerified: authData.userVerified,
  };
}
