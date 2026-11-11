/**
 * Step 2.2b — passkeys (WebAuthn) with node:crypto only.
 *
 * These tests build real P-256 and RSA keys, authenticator data, a `none`
 * attestation object and browser-shaped clientDataJSON. Nothing here depends
 * on a package beyond the standard library and the app under test.
 */
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
  type KeyObject,
} from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { InMemoryAuthStore, SESSION_COOKIE } from '../src/server/auth.js';
import { LedgerError, type LedgerAuditor, type LedgerReader, type LedgerWriter } from '../src/server/ledger.js';
import { MemoryMailer } from '../src/server/mailer.js';
import { CompositeLedger, PracticeLedger } from '../src/server/practice-ledger.js';
import { InMemorySpendLogStore } from '../src/server/spend-log.js';
import { base32Decode, totp } from '../src/server/totp.js';
import { WebAuthnError, decodeCbor } from '../src/server/webauthn.js';

const RP_ID = 'settle.example';
const ORIGIN = 'https://settle.example';
const PASSWORD = ['passkey', 'flow', 'correct', 'horse'].join('-');
const MFA_KEY = Buffer.alloc(32, 0x2a);
const clockMs = Date.UTC(2026, 0, 5, 9, 0, 0);

let ipCounter = 10;
let emailCounter = 0;

/* -------------------------------------------------------------------------
 * Tiny CBOR encoder: enough for COSE keys, attestation objects and decoder
 * unit tests. String-keyed maps encode as normal maps; numeric keys stay
 * numeric, which is what COSE requires.
 * ---------------------------------------------------------------------- */

type CborInput =
  | number
  | bigint
  | string
  | boolean
  | null
  | Uint8Array
  | CborInput[]
  | Map<CborInput, CborInput>
  | { [key: string]: CborInput };

function head(major: number, length: number): Buffer {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length < 0x100) return Buffer.from([(major << 5) | 24, length]);
  if (length < 0x10000) {
    const out = Buffer.alloc(3);
    out[0] = (major << 5) | 25;
    out.writeUInt16BE(length, 1);
    return out;
  }
  if (length < 0x100000000) {
    const out = Buffer.alloc(5);
    out[0] = (major << 5) | 26;
    out.writeUInt32BE(length, 1);
    return out;
  }
  throw new Error('test encoder length too large');
}

function encodeCbor(value: CborInput): Buffer {
  if (value === null) return Buffer.from([0xf6]);
  if (typeof value === 'boolean') return Buffer.from([value ? 0xf5 : 0xf4]);
  if (typeof value === 'bigint') {
    return value >= 0n ? head(0, Number(value)) : head(1, Number(-1n - value));
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return value >= 0 ? head(0, value) : head(1, -1 - value);
    const out = Buffer.alloc(9);
    out[0] = 0xfb;
    out.writeDoubleBE(value, 1);
    return out;
  }
  if (typeof value === 'string') {
    const body = Buffer.from(value, 'utf8');
    return Buffer.concat([head(3, body.length), body]);
  }
  if (value instanceof Uint8Array) {
    return Buffer.concat([head(2, value.length), Buffer.from(value)]);
  }
  if (Array.isArray(value)) {
    return Buffer.concat([head(4, value.length), ...value.map(encodeCbor)]);
  }
  const entries: [CborInput, CborInput][] = value instanceof Map
    ? [...value.entries()]
    : Object.entries(value);
  return Buffer.concat([
    head(5, entries.length),
    ...entries.flatMap(([key, item]) => [encodeCbor(key), encodeCbor(item)]),
  ]);
}

/* -------------------------------------------------------------------------
 * WebAuthn fixtures
 * ---------------------------------------------------------------------- */

interface KeyMaterial {
  credentialId: Buffer;
  publicKey: KeyObject;
  privateKey: KeyObject;
  alg: -7 | -257;
  cose: Buffer;
}

function ecKey(): KeyMaterial {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }) as JsonWebKey;
  const cose = encodeCbor(new Map<CborInput, CborInput>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, Buffer.from(jwk.x ?? '', 'base64url')],
    [-3, Buffer.from(jwk.y ?? '', 'base64url')],
  ]));
  return { credentialId: randomBytes(16), publicKey, privateKey, alg: -7, cose };
}

function rsaKey(): KeyMaterial {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' }) as JsonWebKey;
  const cose = encodeCbor(new Map<CborInput, CborInput>([
    [1, 3],
    [3, -257],
    [-1, Buffer.from(jwk.n ?? '', 'base64url')],
    [-2, Buffer.from(jwk.e ?? '', 'base64url')],
  ]));
  return { credentialId: randomBytes(16), publicKey, privateKey, alg: -257, cose };
}

const b64 = (value: Uint8Array): string => Buffer.from(value).toString('base64url');
const sha256 = (value: string | Uint8Array): Buffer =>
  createHash('sha256').update(value).digest();

interface AuthDataOptions {
  rpId?: string;
  flags: number;
  signCount: number;
  credentialId?: Buffer;
  cose?: Buffer;
}

function authenticatorData(options: AuthDataOptions): Buffer {
  const count = Buffer.alloc(4);
  count.writeUInt32BE(options.signCount);
  const parts = [sha256(options.rpId ?? RP_ID), Buffer.from([options.flags]), count];
  if (options.credentialId && options.cose) {
    const length = Buffer.alloc(2);
    length.writeUInt16BE(options.credentialId.length);
    parts.push(Buffer.alloc(16), length, options.credentialId, options.cose);
  }
  return Buffer.concat(parts);
}

function clientData(type: 'webauthn.create' | 'webauthn.get', challenge: string,
  origin = ORIGIN): Buffer {
  return Buffer.from(JSON.stringify({
    type,
    challenge,
    origin,
    crossOrigin: false,
  }), 'utf8');
}

function attestationObject(authData: Buffer, fmt = 'none'): Buffer {
  return encodeCbor(new Map<CborInput, CborInput>([
    ['fmt', fmt],
    ['attStmt', new Map<CborInput, CborInput>()],
    ['authData', authData],
  ]));
}

interface RegistrationOptions {
  origin?: string;
  rpId?: string;
  fmt?: string;
  flags?: number;
  signCount?: number;
}

function registrationCredential(key: KeyMaterial, challenge: string,
  options: RegistrationOptions = {}) {
  const authData = authenticatorData({
    rpId: options.rpId ?? RP_ID,
    flags: options.flags ?? 0x45,
    signCount: options.signCount ?? 0,
    credentialId: key.credentialId,
    cose: key.cose,
  });
  const data = clientData('webauthn.create', challenge, options.origin ?? ORIGIN);
  return {
    id: b64(key.credentialId),
    rawId: b64(key.credentialId),
    type: 'public-key',
    response: {
      clientDataJSON: b64(data),
      attestationObject: b64(attestationObject(authData, options.fmt ?? 'none')),
      transports: ['internal'],
    },
    clientExtensionResults: {},
  };
}

interface AssertionOptions {
  origin?: string;
  rpId?: string;
  flags?: number;
  signCount: number;
  tampered?: boolean;
}

function assertionCredential(key: KeyMaterial, challenge: string,
  options: AssertionOptions) {
  const authData = authenticatorData({
    rpId: options.rpId ?? RP_ID,
    flags: options.flags ?? 0x05,
    signCount: options.signCount,
  });
  const data = clientData('webauthn.get', challenge, options.origin ?? ORIGIN);
  const signed = Buffer.concat([authData, sha256(data)]);
  const signature = key.alg === -7
    ? sign('sha256', signed, { key: key.privateKey, dsaEncoding: 'der' })
    : sign('sha256', signed, key.privateKey);
  if (options.tampered) signature[0] = (signature[0] ?? 0) ^ 0xff;
  return {
    id: b64(key.credentialId),
    rawId: b64(key.credentialId),
    type: 'public-key',
    response: {
      clientDataJSON: b64(data),
      authenticatorData: b64(authData),
      signature: b64(signature),
      userHandle: null,
    },
    clientExtensionResults: {},
  };
}

/* -------------------------------------------------------------------------
 * App harness
 * ---------------------------------------------------------------------- */

function makeApp(appUrl = ORIGIN) {
  const auth = new InMemoryAuthStore();
  const practice = new PracticeLedger();
  const reject = () => Promise.reject(new LedgerError(503, 'live ledger is down'));
  const live = new Proxy({}, { get: () => reject }) as LedgerReader & LedgerWriter & LedgerAuditor;
  const api = createApp({
    ledger: new CompositeLedger(live, practice, async () => false),
    practice,
    spendLogs: new InMemorySpendLogStore(),
    auth,
    mailer: new MemoryMailer(),
    appUrl,
    now: () => new Date(clockMs),
    mfaKey: MFA_KEY,
    breachedPassword: async () => false,
  });
  return { api, auth };
}

type Api = ReturnType<typeof makeApp>['api'];

function jsonHeaders(cookie?: string, extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-forwarded-for': `198.51.100.${10 + (ipCounter++ % 200)}`,
    ...extra,
  };
  if (cookie) headers.cookie = cookie;
  return headers;
}

function sessionPair(res: Response): string | null {
  const raw = res.headers.get('set-cookie') ?? '';
  const parts = raw.split(/,(?=\s*[A-Za-z0-9_-]+=)/).map((part) => part.trim());
  for (const part of parts) {
    const pair = part.split(';')[0] ?? '';
    if (pair.startsWith(SESSION_COOKIE + '=')) return pair;
  }
  return null;
}

function sessionCookie(res: Response): string {
  const pair = sessionPair(res);
  if (!pair) throw new Error(`missing session cookie: "${res.headers.get('set-cookie') ?? ''}"`);
  return pair;
}

async function post(api: Api, path: string, body: unknown, cookie?: string): Promise<Response> {
  return api.request(path, {
    method: 'POST',
    headers: jsonHeaders(cookie),
    body: JSON.stringify(body),
  });
}

async function signUp(api: Api): Promise<{ cookie: string; email: string }> {
  emailCounter += 1;
  const email = `passkey-${emailCounter}@example.com`;
  const res = await post(api, '/api/auth/register', {
    email,
    password: PASSWORD,
    displayName: 'Sam Lee',
  });
  expect(res.status).toBe(201);
  return { cookie: sessionCookie(res), email };
}

async function passwordLogin(api: Api, email: string): Promise<Response> {
  return post(api, '/api/auth/login', { email, password: PASSWORD });
}

async function stepUpWithPassword(api: Api, cookie: string): Promise<Response> {
  return post(api, '/api/auth/step-up', { password: PASSWORD }, cookie);
}

async function enableMfa(api: Api, cookie: string): Promise<{ cookie: string; secret: Buffer; recoveryCodes: string[] }> {
  const setup = await post(api, '/api/auth/mfa/setup', {}, cookie);
  expect(setup.status).toBe(200);
  const body = await setup.json() as { secret: string };
  const secret = base32Decode(body.secret);
  const enabled = await post(api, '/api/auth/mfa/enable', { code: totp(secret, clockMs) }, cookie);
  expect(enabled.status).toBe(200);
  const result = await enabled.json() as { recoveryCodes: string[] };
  expect(result.recoveryCodes.length).toBeGreaterThan(0);
  return { cookie: sessionPair(enabled) ?? cookie, secret, recoveryCodes: result.recoveryCodes };
}

async function registrationOptions(api: Api, cookie: string): Promise<{ challenge: string }> {
  const res = await post(api, '/api/auth/passkeys/register/options', {}, cookie);
  expect(res.status).toBe(200);
  return await res.json() as { challenge: string };
}

async function loginOptions(api: Api): Promise<{ challenge: string; allowCredentials: unknown[] }> {
  const res = await post(api, '/api/auth/passkeys/login/options', {});
  expect(res.status).toBe(200);
  return await res.json() as { challenge: string; allowCredentials: unknown[] };
}

async function stepUpOptions(api: Api, cookie: string): Promise<{ challenge: string }> {
  const res = await post(api, '/api/auth/step-up/passkey/options', {}, cookie);
  expect(res.status).toBe(200);
  return await res.json() as { challenge: string };
}

async function registerPasskey(api: Api, cookie: string, key: KeyMaterial,
  name = 'This device', options: RegistrationOptions = {}): Promise<Response> {
  const { challenge } = await registrationOptions(api, cookie);
  const credential = registrationCredential(key, challenge, options);
  return post(api, '/api/auth/passkeys/register', { credential, name }, cookie);
}

/* -------------------------------------------------------------------------
 * Unit tests: CBOR decoder
 * ---------------------------------------------------------------------- */

describe('CBOR decoder', () => {
  it('decodes nested maps, arrays, byte strings, text and integers', () => {
    const value = decodeCbor(encodeCbor(new Map<CborInput, CborInput>([
      ['name', 'Settle'],
      ['count', 42],
      ['negative', -7],
      ['bytes', Buffer.from([1, 2, 3])],
      ['list', [true, false, null, 'x']],
      ['nested', new Map<CborInput, CborInput>([['ok', true]])],
      [99, 'numeric key'],
    ])));

    expect(value).toBeInstanceOf(Map);
    const map = value as Map<CborInput, CborInput>;
    expect(map.get('name')).toBe('Settle');
    expect(map.get('count')).toBe(42);
    expect(map.get('negative')).toBe(-7);
    expect(Buffer.from(map.get('bytes') as Uint8Array)).toEqual(Buffer.from([1, 2, 3]));
    expect(map.get('list')).toEqual([true, false, null, 'x']);
    expect(map.get('nested')).toEqual({ ok: true });
  });

  it('keeps numeric COSE keys addressable and returns object maps for text keys', () => {
    const cose = decodeCbor(encodeCbor(new Map<CborInput, CborInput>([
      [1, 2], [3, -7], [-1, 1], [-2, Buffer.from([9, 9])],
    ]))) as Map<CborInput, CborInput>;
    expect(cose).toBeInstanceOf(Map);
    expect(cose.get(1)).toBe(2);
    expect(cose.get(3)).toBe(-7);
    expect(cose.get(-1)).toBe(1);

    const text = decodeCbor(encodeCbor({ fmt: 'none', ok: true }));
    expect(text).toEqual({ fmt: 'none', ok: true });
  });

  it('rejects truncated input instead of returning a partial value', () => {
    expect(() => decodeCbor(Buffer.from([0x82, 0x01]))).toThrow();
  });
});

/* -------------------------------------------------------------------------
 * Registration and assertion
 * ---------------------------------------------------------------------- */

describe('passkey registration', () => {
  it('registers an ES256 passkey after step-up and lists it', async () => {
    const { api } = makeApp();
    const { cookie } = await signUp(api);
    expect((await stepUpWithPassword(api, cookie)).status).toBe(200);

    const key = ecKey();
    const options = await registrationOptions(api, cookie);
    expect(typeof options.challenge).toBe('string');
    const res = await post(api, '/api/auth/passkeys/register', {
      credential: registrationCredential(key, options.challenge),
      name: 'Laptop',
    }, cookie);
    expect(res.status).toBe(200);

    const list = await api.request('/api/auth/passkeys', { headers: { cookie } });
    expect(list.status).toBe(200);
    const body = await list.json() as { passkeys: { id: string; name: string; lastUsedAt: string | null }[] };
    expect(body.passkeys).toHaveLength(1);
    expect(body.passkeys[0]?.id).toBe(b64(key.credentialId));
    expect(body.passkeys[0]?.name).toBe('Laptop');
    expect(body.passkeys[0]?.lastUsedAt).toBeNull();
  });

  it('rejects an attestation format other than none', async () => {
    const { api } = makeApp();
    const { cookie } = await signUp(api);
    expect((await stepUpWithPassword(api, cookie)).status).toBe(200);

    const key = ecKey();
    const res = await registerPasskey(api, cookie, key, 'Packed', { fmt: 'packed' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unsupported_attestation' });

    const list = await api.request('/api/auth/passkeys', { headers: { cookie } });
    expect((await list.json() as { passkeys: unknown[] }).passkeys).toHaveLength(0);
  });

  it('rejects a registration from the wrong origin', async () => {
    const { api } = makeApp();
    const { cookie } = await signUp(api);
    expect((await stepUpWithPassword(api, cookie)).status).toBe(200);

    const res = await registerPasskey(api, cookie, ecKey(), 'Wrong origin', {
      origin: 'https://evil.example',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_origin' });
  });

  it('rejects a registration whose rpIdHash is for another relying party', async () => {
    const { api } = makeApp();
    const { cookie } = await signUp(api);
    expect((await stepUpWithPassword(api, cookie)).status).toBe(200);

    const res = await registerPasskey(api, cookie, ecKey(), 'Wrong RP', {
      rpId: 'other.example',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_rp_id' });
  });
});

describe('passkey sign-in', () => {
  it('asserts with ES256 and issues a session', async () => {
    const { api } = makeApp();
    const { cookie, email } = await signUp(api);
    expect((await stepUpWithPassword(api, cookie)).status).toBe(200);
    const key = ecKey();
    expect((await registerPasskey(api, cookie, key)).status).toBe(200);
    expect((await post(api, '/api/auth/logout', {}, cookie)).status).toBe(200);

    const options = await loginOptions(api);
    expect(options.allowCredentials).toEqual([]);
    const expression = assertionCredential(key, options.challenge, { signCount: 1 });
    const res = await post(api, '/api/auth/passkeys/login', { credential: expression });
    expect(res.status).toBe(200);
    expect(sessionPair(res)).not.toBeNull();
    const body = await res.json() as { user: { email: string }; account: { id: string } };
    expect(body.user.email).toBe(email);
    expect(body.account.id).toBeTruthy();
  });

  it('asserts with RS256 and issues a session', async () => {
    const { api } = makeApp();
    const { cookie } = await signUp(api);
    expect((await stepUpWithPassword(api, cookie)).status).toBe(200);
    const key = rsaKey();
    expect((await registerPasskey(api, cookie, key, 'RSA key')).status).toBe(200);

    const options = await loginOptions(api);
    const expression = assertionCredential(key, options.challenge, { signCount: 1 });
    const res = await post(api, '/api/auth/passkeys/login', { credential: expression });
    expect(res.status).toBe(200);
    expect(sessionPair(res)).not.toBeNull();
  });

  it('rejects an assertion from the wrong origin', async () => {
    const { api } = makeApp();
    const { cookie } = await signUp(api);
    expect((await stepUpWithPassword(api, cookie)).status).toBe(200);
    const key = ecKey();
    expect((await registerPasskey(api, cookie, key)).status).toBe(200);

    const options = await loginOptions(api);
    const expression = assertionCredential(key, options.challenge, {
      signCount: 1,
      origin: 'https://evil.example',
    });
    const res = await post(api, '/api/auth/passkeys/login', { credential: expression });
    expect(res.status).toBe(400);
    expect(sessionPair(res)).toBeNull();
  });

  it('rejects an assertion whose rpIdHash is for another relying party', async () => {
    const { api } = makeApp();
    const { cookie } = await signUp(api);
    expect((await stepUpWithPassword(api, cookie)).status).toBe(200);
    const key = ecKey();
    expect((await registerPasskey(api, cookie, key)).status).toBe(200);

    const options = await loginOptions(api);
    const expression = assertionCredential(key, options.challenge, {
      signCount: 1,
      rpId: 'other.example',
    });
    const res = await post(api, '/api/auth/passkeys/login', { credential: expression });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_rp_id' });
  });

  it('rejects a replayed challenge', async () => {
    const { api } = makeApp();
    const { cookie } = await signUp(api);
    expect((await stepUpWithPassword(api, cookie)).status).toBe(200);
    const key = ecKey();
    expect((await registerPasskey(api, cookie, key)).status).toBe(200);

    const options = await loginOptions(api);
    const expression = assertionCredential(key, options.challenge, { signCount: 1 });
    expect((await post(api, '/api/auth/passkeys/login', { credential: expression })).status).toBe(200);
    const replay = await post(api, '/api/auth/passkeys/login', { credential: expression });
    expect(replay.status).toBe(400);
    expect(sessionPair(replay)).toBeNull();
  });

  it('rejects a reused lower signature counter as a cloned credential', async () => {
    const { api, auth } = makeApp();
    const { cookie, email } = await signUp(api);
    expect((await stepUpWithPassword(api, cookie)).status).toBe(200);
    const key = ecKey();
    expect((await registerPasskey(api, cookie, key, 'Counter key', { signCount: 10 })).status).toBe(200);

    const first = await loginOptions(api);
    const accepted = assertionCredential(key, first.challenge, { signCount: 11 });
    expect((await post(api, '/api/auth/passkeys/login', { credential: accepted })).status).toBe(200);

    const second = await loginOptions(api);
    const regression = assertionCredential(key, second.challenge, { signCount: 5 });
    const res = await post(api, '/api/auth/passkeys/login', { credential: regression });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'passkey_cloned' });

    const user = await auth.findByEmail(email);
    const events = await auth.listAudit(user?.id ?? '');
    expect(events.some((event) => event.type === 'passkey_login'
      && event.detail?.result === 'passkey_cloned')).toBe(true);
  });

  it('rejects a tampered signature', async () => {
    const { api } = makeApp();
    const { cookie } = await signUp(api);
    expect((await stepUpWithPassword(api, cookie)).status).toBe(200);
    const key = ecKey();
    expect((await registerPasskey(api, cookie, key)).status).toBe(200);

    const options = await loginOptions(api);
    const expression = assertionCredential(key, options.challenge, {
      signCount: 1,
      tampered: true,
    });
    const res = await post(api, '/api/auth/passkeys/login', { credential: expression });
    expect(res.status).toBe(400);
    expect(sessionPair(res)).toBeNull();
  });

  it('lets a UV passkey skip TOTP but asks a non-UV passkey for it', async () => {
    const { api } = makeApp();
    const { cookie: signedUp } = await signUp(api);
    const enabled = await enableMfa(api, signedUp);
    expect((await post(api, '/api/auth/step-up', { code: enabled.recoveryCodes[0]! }, enabled.cookie)).status)
      .toBe(200);

    const key = ecKey();
    expect((await registerPasskey(api, enabled.cookie, key, 'Phone')).status).toBe(200);

    const withoutUv = await loginOptions(api);
    const firstFactor = assertionCredential(key, withoutUv.challenge, { signCount: 1, flags: 0x01 });
    const needsMfa = await post(api, '/api/auth/passkeys/login', { credential: firstFactor });
    expect(needsMfa.status).toBe(200);
    expect(sessionPair(needsMfa)).toBeNull();
    const challenge = await needsMfa.json() as { mfaRequired?: boolean; challenge?: string };
    expect(challenge.mfaRequired).toBe(true);
    expect(typeof challenge.challenge).toBe('string');

    const withUv = await loginOptions(api);
    const twoFactors = assertionCredential(key, withUv.challenge, { signCount: 2, flags: 0x05 });
    const signedIn = await post(api, '/api/auth/passkeys/login', { credential: twoFactors });
    expect(signedIn.status).toBe(200);
    expect(sessionPair(signedIn)).not.toBeNull();
    expect(await signedIn.json()).toMatchObject({ user: { displayName: 'Sam Lee' } });
  });
});

describe('passkey management', () => {
  it('requires step-up to delete and accepts a passkey assertion for that step-up', async () => {
    const { api } = makeApp();
    const { cookie, email } = await signUp(api);
    expect((await stepUpWithPassword(api, cookie)).status).toBe(200);
    const key = ecKey();
    expect((await registerPasskey(api, cookie, key)).status).toBe(200);

    // A fresh password session has no step-up window.
    expect((await post(api, '/api/auth/logout', {}, cookie)).status).toBe(200);
    const fresh = sessionCookie(await passwordLogin(api, email));

    const denied = await api.request(`/api/auth/passkeys/${encodeURIComponent(b64(key.credentialId))}`, {
      method: 'DELETE',
      headers: jsonHeaders(fresh),
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'step_up_required' });

    const options = await stepUpOptions(api, fresh);
    const expression = assertionCredential(key, options.challenge, { signCount: 1 });
    const stepped = await post(api, '/api/auth/step-up', { passkey: expression }, fresh);
    expect(stepped.status).toBe(200);

    const removed = await api.request(`/api/auth/passkeys/${encodeURIComponent(b64(key.credentialId))}`, {
      method: 'DELETE',
      headers: jsonHeaders(fresh),
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ ok: true });

    const list = await api.request('/api/auth/passkeys', { headers: { cookie: fresh } });
    expect((await list.json() as { passkeys: unknown[] }).passkeys).toHaveLength(0);
  });
});
