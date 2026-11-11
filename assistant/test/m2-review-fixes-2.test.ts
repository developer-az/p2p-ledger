/**
 * Regression tests for the second round of M2 review findings.
 *
 * 1. WebAuthn challenges are bound to a purpose and account, and saving a
 *    passkey needs a live step-up.
 * 2. Passkey challenges are consumed atomically before verification.
 * 4. A shred on another instance invalidates cached data keys within the TTL.
 */
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
  type KeyObject,
} from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { createApp } from '../src/server/app.js';
import { InMemoryAuthStore, SESSION_COOKIE } from '../src/server/auth.js';
import { pgConfig } from '../src/server/db-tls.js';
import { LocalKeyWrapper, PostgresDataKeyStore, ShreddedKeyError } from '../src/server/envelope.js';
import { LedgerError, type LedgerAuditor, type LedgerReader, type LedgerWriter } from '../src/server/ledger.js';
import { MemoryMailer } from '../src/server/mailer.js';
import { CompositeLedger, PracticeLedger } from '../src/server/practice-ledger.js';
import { InMemorySpendLogStore, type SpendLogEntry } from '../src/server/spend-log.js';
import { JavaWorkflows, RoutedSpendLogStore } from '../src/server/java-workflows.js';

const RP_ID = 'settle.example';
const ORIGIN = 'https://settle.example';
const PASSWORD = ['review', 'fixes', 'two', 'correct', 'horse'].join('-');
const MFA_KEY = Buffer.alloc(32, 0x2a);
const T0 = Date.UTC(2026, 0, 5, 9, 0, 0);

let clockMs = T0;
let ipCounter = 10;
let emailCounter = 0;

type CborInput =
  | number
  | string
  | Uint8Array
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
  const out = Buffer.alloc(5);
  out[0] = (major << 5) | 26;
  out.writeUInt32BE(length, 1);
  return out;
}

function encodeCbor(value: CborInput): Buffer {
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') {
    const body = Buffer.from(value, 'utf8');
    return Buffer.concat([head(3, body.length), body]);
  }
  if (value instanceof Uint8Array) {
    return Buffer.concat([head(2, value.length), Buffer.from(value)]);
  }
  const entries: [CborInput, CborInput][] = value instanceof Map
    ? [...value.entries()]
    : Object.entries(value);
  return Buffer.concat([
    head(5, entries.length),
    ...entries.flatMap(([key, item]) => [encodeCbor(key), encodeCbor(item)]),
  ]);
}

interface KeyMaterial {
  credentialId: Buffer;
  privateKey: KeyObject;
  alg: -7;
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
  return { credentialId: randomBytes(16), privateKey, alg: -7, cose };
}

const b64 = (value: Uint8Array): string => Buffer.from(value).toString('base64url');
const sha256 = (value: string | Uint8Array): Buffer =>
  createHash('sha256').update(value).digest();

function authenticatorData(options: {
  flags: number;
  signCount: number;
  credentialId?: Buffer;
  cose?: Buffer;
}): Buffer {
  const count = Buffer.alloc(4);
  count.writeUInt32BE(options.signCount);
  const parts = [sha256(RP_ID), Buffer.from([options.flags]), count];
  if (options.credentialId && options.cose) {
    const length = Buffer.alloc(2);
    length.writeUInt16BE(options.credentialId.length);
    parts.push(Buffer.alloc(16), length, options.credentialId, options.cose);
  }
  return Buffer.concat(parts);
}

function clientData(type: 'webauthn.create' | 'webauthn.get', challenge: string): Buffer {
  return Buffer.from(JSON.stringify({
    type,
    challenge,
    origin: ORIGIN,
    crossOrigin: false,
  }), 'utf8');
}

function registrationCredential(key: KeyMaterial, challenge: string) {
  const authData = authenticatorData({
    flags: 0x45,
    signCount: 0,
    credentialId: key.credentialId,
    cose: key.cose,
  });
  const data = clientData('webauthn.create', challenge);
  return {
    id: b64(key.credentialId),
    rawId: b64(key.credentialId),
    type: 'public-key',
    response: {
      clientDataJSON: b64(data),
      attestationObject: b64(encodeCbor(new Map<CborInput, CborInput>([
        ['fmt', 'none'],
        ['attStmt', new Map<CborInput, CborInput>()],
        ['authData', authData],
      ]))),
      transports: ['internal'],
    },
    clientExtensionResults: {},
  };
}

function assertionCredential(key: KeyMaterial, challenge: string, signCount: number) {
  const authData = authenticatorData({ flags: 0x05, signCount });
  const data = clientData('webauthn.get', challenge);
  const signed = Buffer.concat([authData, sha256(data)]);
  const signature = sign('sha256', signed, { key: key.privateKey, dsaEncoding: 'der' });
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

function makeApp() {
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
    appUrl: ORIGIN,
    now: () => new Date(clockMs),
    mfaKey: MFA_KEY,
    breachedPassword: async () => false,
  });
  return { api, auth };
}

type Api = ReturnType<typeof makeApp>['api'];

function jsonHeaders(cookie?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-forwarded-for': `198.51.100.${10 + (ipCounter++ % 200)}`,
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
  const email = `m2-review-${emailCounter}@example.com`;
  const res = await post(api, '/api/auth/register', {
    email,
    password: PASSWORD,
    displayName: 'Sam Lee',
  });
  expect(res.status).toBe(201);
  return { cookie: sessionCookie(res), email };
}

async function stepUp(api: Api, cookie: string): Promise<void> {
  const res = await post(api, '/api/auth/step-up', { password: PASSWORD }, cookie);
  expect(res.status).toBe(200);
}

async function registrationOptions(api: Api, cookie: string): Promise<string> {
  const res = await post(api, '/api/auth/passkeys/register/options', {}, cookie);
  expect(res.status).toBe(200);
  return (await res.json() as { challenge: string }).challenge;
}

async function stepUpOptions(api: Api, cookie: string): Promise<string> {
  const res = await post(api, '/api/auth/step-up/passkey/options', {}, cookie);
  expect(res.status).toBe(200);
  return (await res.json() as { challenge: string }).challenge;
}

async function loginOptions(api: Api): Promise<string> {
  const res = await post(api, '/api/auth/passkeys/login/options', {});
  expect(res.status).toBe(200);
  return (await res.json() as { challenge: string }).challenge;
}

describe('1. WebAuthn challenges are purpose-bound and registration needs step-up to save', () => {
  it('refuses to register with a step-up challenge', async () => {
    const { api } = makeApp();
    const { cookie } = await signUp(api);
    await stepUp(api, cookie);

    const challenge = await stepUpOptions(api, cookie);
    const key = ecKey();
    const res = await post(api, '/api/auth/passkeys/register', {
      credential: registrationCredential(key, challenge),
      name: 'Wrong purpose',
    }, cookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'challenge_expired' });

    const list = await api.request('/api/auth/passkeys', { headers: { cookie } });
    expect((await list.json() as { passkeys: unknown[] }).passkeys).toHaveLength(0);
  });

  it('answers 403 step_up_required when the step-up has ended before the save', async () => {
    const { api } = makeApp();
    const { cookie, email } = await signUp(api);
    await stepUp(api, cookie);

    const challenge = await registrationOptions(api, cookie);
    const key = ecKey();

    // A new password session is signed in but has no step-up window. The
    // challenge belongs to the same account, so only the save-time gate stops it.
    expect((await post(api, '/api/auth/logout', {}, cookie)).status).toBe(200);
    const fresh = sessionCookie(await post(api, '/api/auth/login', { email, password: PASSWORD }));
    const res = await post(api, '/api/auth/passkeys/register', {
      credential: registrationCredential(key, challenge),
      name: 'Stale step-up',
    }, fresh);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'step_up_required' });

    const list = await api.request('/api/auth/passkeys', { headers: { cookie: fresh } });
    expect((await list.json() as { passkeys: unknown[] }).passkeys).toHaveLength(0);
  });
});

describe('2. passkey challenge consumption is atomic', () => {
  it('issues exactly one session for two concurrent logins with the same assertion', async () => {
    const { api } = makeApp();
    const { cookie } = await signUp(api);
    await stepUp(api, cookie);

    const key = ecKey();
    const saveChallenge = await registrationOptions(api, cookie);
    const registered = await post(api, '/api/auth/passkeys/register', {
      credential: registrationCredential(key, saveChallenge),
      name: 'Concurrent key',
    }, cookie);
    expect(registered.status).toBe(200);
    expect((await post(api, '/api/auth/logout', {}, cookie)).status).toBe(200);

    // Registration stored signCount 0, so a zero counter is a valid assertion
    // that two requests can replay at the same time.
    const challenge = await loginOptions(api);
    const credential = assertionCredential(key, challenge, 0);
    const [first, second] = await Promise.all([
      post(api, '/api/auth/passkeys/login', { credential }),
      post(api, '/api/auth/passkeys/login', { credential }),
    ]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 400]);
    expect([sessionPair(first), sessionPair(second)].filter(Boolean)).toHaveLength(1);
    const rejected = first.status === 400 ? first : second;
    expect(await rejected.json()).toEqual({ error: 'challenge_expired' });
  });
});

const DATABASE_URL = process.env.SETTLE_TEST_DATABASE_URL?.trim();

describe('3. export cursors are opaque and owned by the export', () => {
  it('pages Java spends with a cursor that carries before+beforeId', async () => {
    const java = new JavaWorkflows('http://unused.test', 'test-key');
    const calls: string[] = [];
    const row = (id: string, occurredAt: string): SpendLogEntry => ({
      id,
      accountId: 'account-1',
      amountMinor: 100,
      currency: 'USD',
      category: 'other',
      note: null,
      occurredAt,
      source: 'manual',
      createdAt: occurredAt,
    });
    vi.spyOn(java, 'request').mockImplementation(async (_method, path) => {
      calls.push(path);
      return new URL(path, 'http://unused.test').searchParams.has('beforeId')
        ? [row('id-c', '2025-12-31T00:00:00.000Z')]
        : [row('id-b', '2026-01-02T00:00:00.000Z'), row('id-a', '2026-01-01T00:00:00.000Z')];
    });

    const firstStore = new RoutedSpendLogStore(new InMemorySpendLogStore(), java, () => false);
    const first = await firstStore.listSpendCursorPage('account-1', null, 2);
    expect(first.rows.map((entry) => entry.id)).toEqual(['id-b', 'id-a']);
    expect(first.next).toEqual(expect.any(String));

    // A different store instance can continue the export because the cursor,
    // not a per-process map, holds the Java keyset position.
    const secondStore = new RoutedSpendLogStore(new InMemorySpendLogStore(), java, () => false);
    const second = await secondStore.listSpendCursorPage('account-1', first.next, 2);
    expect(second.rows.map((entry) => entry.id)).toEqual(['id-c']);
    expect(second.next).toBeNull();

    const params = new URL(calls[1]!, 'http://unused.test').searchParams;
    expect(params.get('before')).toBe('2026-01-01T00:00:00.000Z');
    expect(params.get('beforeId')).toBe('id-a');
  });
});

describe.skipIf(!DATABASE_URL)('4. cached data keys notice a shred on another instance', () => {
  const url = DATABASE_URL!;

  it('re-checks the row after 5s and expires the cache after 30s', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const schema = `m2_review_${randomUUID().replace(/-/g, '')}`;
    const admin = new pg.Client(pgConfig(url));
    await admin.connect();
    try {
      vi.setSystemTime(new Date(T0));
      await admin.query(`create schema ${schema}`);
      const schemaUrl = `${url}${url.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${schema}`)}`;
      const keks: Record<string, Buffer> = { current: Buffer.alloc(32, 0x41) };
      const storeA = new PostgresDataKeyStore(schemaUrl, new LocalKeyWrapper(keks, 'current'));
      const storeB = new PostgresDataKeyStore(schemaUrl, new LocalKeyWrapper(keks, 'current'));

      // The cached key is used inside the grace period, then re-checked at 6s.
      const recheckUser = randomUUID();
      const recheckBlob = await storeA.encryptField(recheckUser, 'recheck this');
      expect(await storeB.decryptField(recheckUser, recheckBlob)).toBe('recheck this');
      await storeA.shred(recheckUser);
      vi.setSystemTime(new Date(T0 + 6_000));
      await expect(storeB.decryptField(recheckUser, recheckBlob)).rejects.toBeInstanceOf(ShreddedKeyError);

      // Even without an intervening check, the entry expires after 30s.
      const ttlUser = randomUUID();
      const ttlBlob = await storeA.encryptField(ttlUser, 'ttl this');
      expect(await storeB.decryptField(ttlUser, ttlBlob)).toBe('ttl this');
      await storeA.shred(ttlUser);
      vi.setSystemTime(new Date(T0 + 6_000 + 31_000));
      await expect(storeB.decryptField(ttlUser, ttlBlob)).rejects.toBeInstanceOf(ShreddedKeyError);
    } finally {
      vi.useRealTimers();
      await admin.query(`drop schema ${schema} cascade`);
      await admin.end();
    }
  }, 30_000);
});

describe('TOTP step claims are single-use', () => {
  it('lets exactly one of two concurrent claims of the same step win', async () => {
    const store = new InMemoryAuthStore();
    await store.insert({ id: 'u-claim', email: 'claim@example.com', passwordHash: 'x', displayName: 'C', accountId: 'acc-claim', ownerId: 'o-claim' });
    await store.saveMfaPendingSecret('u-claim', 'pending-blob');
    await store.enableMfa('u-claim', 'pending-blob', [], null);
    const results = await Promise.all([store.recordMfaStep('u-claim', 100), store.recordMfaStep('u-claim', 100)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await store.recordMfaStep('u-claim', 99)).toBe(false);
    expect(await store.recordMfaStep('u-claim', 101)).toBe(true);
  });
});
