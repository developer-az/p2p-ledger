/**
 * Acceptance tests for the Google OAuth/MFA gap.
 *
 * A Google callback for an MFA-enabled account must stop at a second factor:
 * no session cookie, and a redirect to /signin?mfa=<challenge>. The challenge
 * is then completed through the normal POST /api/auth/mfa/verify route.
 * An account without MFA keeps the existing behaviour (session cookie set by
 * the callback itself).
 *
 * The Google token exchange and JWKS fetch are stubbed in-process with a
 * runtime-generated RSA key, so no key material is stored in this file.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createApp } from '../src/server/app.js';
import { InMemoryAuthStore, SESSION_COOKIE, type AuthRecord } from '../src/server/auth.js';
import { LedgerError, type LedgerAuditor, type LedgerReader, type LedgerWriter } from '../src/server/ledger.js';
import { MemoryMailer } from '../src/server/mailer.js';
import { CompositeLedger, PracticeLedger } from '../src/server/practice-ledger.js';
import { InMemorySpendLogStore } from '../src/server/spend-log.js';
import { encryptSecret, totp } from '../src/server/totp.js';
import { randomUUID } from 'node:crypto';

const T0 = Date.UTC(2026, 0, 5, 9, 0, 0);
const MFA_KEY = Buffer.alloc(32, 0x3c);
const CLIENT_ID = 'test.apps.googleusercontent.com';
/** Built with join() so no credential-shaped literal sits in the test. */
const CLIENT_SECRET = ['test', 'only', 'google', 'secret'].join('-');
const APP_ORIGIN = 'https://settle.example';
const FLOW_COOKIE = 'settle_google_flow';
const KEY_ID = 'test-google-key';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

let clockMs = T0;
let signingKey: CryptoKey;
let publicJwk: Record<string, unknown>;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  signingKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KEY_ID, alg: 'RS256', use: 'sig' };
});

beforeEach(() => {
  clockMs = T0;
  vi.stubEnv('GOOGLE_AUTH_ENABLED', 'true');
  vi.stubEnv('GOOGLE_CLIENT_ID', CLIENT_ID);
  vi.stubEnv('GOOGLE_CLIENT_SECRET', CLIENT_SECRET);
  vi.stubEnv('APP_URL', APP_ORIGIN);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

afterAll(() => {
  vi.restoreAllMocks();
});

/** Short IPv4 literal helper: no scattered address strings in assertions. */
function testIp(last: number): string {
  return ['198', '51', '100', String(last)].join('.');
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function googleFetch(idToken: string) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === GOOGLE_TOKEN_URL) return json({ id_token: idToken });
    if (url === GOOGLE_JWKS_URL) return json({ keys: [publicJwk] });
    throw new Error(`unexpected Google fetch: ${url}`);
  });
}

function makeApp(store = new InMemoryAuthStore()) {
  Object.defineProperty(store, 'persistent', { value: true });
  const practice = new PracticeLedger();
  const reject = () => Promise.reject(new LedgerError(503, 'live ledger is down'));
  const live = new Proxy({}, { get: () => reject }) as LedgerReader & LedgerWriter & LedgerAuditor;
  const api = createApp({
    ledger: new CompositeLedger(live, practice, async () => false),
    practice,
    spendLogs: new InMemorySpendLogStore(),
    auth: store,
    mailer: new MemoryMailer(),
    appUrl: APP_ORIGIN,
    now: () => new Date(clockMs),
    mfaKey: MFA_KEY,
    breachedPassword: async () => false,
  });
  return { api, store };
}

type App = ReturnType<typeof makeApp>['api'];

function setCookieParts(res: Response): string[] {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const raw = res.headers.get('set-cookie') ?? '';
  return raw
    .split(/,(?=\s*[A-Za-z0-9_-]+=)/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function cookiePair(res: Response, name: string): string | null {
  for (const part of setCookieParts(res)) {
    const pair = part.split(';')[0] ?? '';
    if (pair.startsWith(name + '=')) return pair;
  }
  return null;
}

function sessionPair(res: Response): string | null {
  return cookiePair(res, SESSION_COOKIE);
}

function sessionCookie(res: Response): string {
  const pair = sessionPair(res);
  if (!pair) throw new Error(`missing session cookie: "${res.headers.get('set-cookie') ?? ''}"`);
  return pair;
}

async function seedUser(store: InMemoryAuthStore, email: string): Promise<AuthRecord> {
  const user: AuthRecord = {
    id: randomUUID(),
    email,
    passwordHash: 'not-used-by-these-tests',
    displayName: 'Google Tester',
    accountId: randomUUID(),
    ownerId: `google-${randomUUID().slice(0, 8)}`,
  };
  await store.insert(user);
  return user;
}

async function idTokenFor(nonce: string, subject: string, email: string): Promise<string> {
  return new SignJWT({ email, email_verified: true, nonce })
    .setProtectedHeader({ alg: 'RS256', kid: KEY_ID })
    .setIssuer('https://accounts.google.com')
    .setAudience(CLIENT_ID)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(signingKey);
}

async function startFlow(api: App) {
  const res = await api.request(`${APP_ORIGIN}/api/auth/google/start?accepted=1`);
  expect(res.status).toBe(302);
  const flowCookie = cookiePair(res, FLOW_COOKIE);
  expect(flowCookie, 'Google start must set its signed flow cookie').not.toBeNull();

  const raw = decodeURIComponent(flowCookie!.slice(flowCookie!.indexOf('=') + 1));
  const flow = JSON.parse(raw.slice(0, raw.lastIndexOf('.'))) as { state?: string; nonce?: string };
  expect(typeof flow.state).toBe('string');
  expect(typeof flow.nonce).toBe('string');
  return { flowCookie: flowCookie!, state: flow.state!, nonce: flow.nonce! };
}

async function callback(api: App, flowCookie: string, state: string) {
  return api.request(
    `${APP_ORIGIN}/api/auth/google/callback?state=${encodeURIComponent(state)}&code=test-authorization-code`,
    { headers: { cookie: flowCookie, 'x-forwarded-for': testIp(21) } },
  );
}

function redirectTarget(res: Response): URL {
  const location = res.headers.get('Location');
  expect(location, 'Google callback must redirect').not.toBeNull();
  return new URL(location!, APP_ORIGIN);
}

describe('Google sign-in with MFA enabled', () => {
  it('withholds the session cookie and hands off to /signin?mfa=<challenge>', async () => {
    const { api, store } = makeApp();
    const user = await seedUser(store, 'google-mfa@example.com');
    const secret = Buffer.alloc(20, 0x5a);
    await store.enableMfa(user.id, encryptSecret(secret, MFA_KEY), [], null);
    await store.linkGoogleSubject('google-subject-mfa', user.id);

    const flow = await startFlow(api);
    vi.stubGlobal('fetch', googleFetch(await idTokenFor(flow.nonce, 'google-subject-mfa', user.email)));
    const res = await callback(api, flow.flowCookie, flow.state);

    expect([302, 303]).toContain(res.status);
    const target = redirectTarget(res);
    expect(target.pathname).toBe('/signin');
    const challenge = target.searchParams.get('mfa');
    expect(challenge, 'the redirect must carry an MFA challenge').toBeTruthy();
    expect(challenge!.length).toBeGreaterThan(10);
    expect(sessionPair(res), 'no session cookie before the second factor').toBeNull();

    const verify = await api.request(`${APP_ORIGIN}/api/auth/mfa/verify`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': testIp(22),
      },
      body: JSON.stringify({ challenge, code: totp(secret, clockMs) }),
    });
    expect(verify.status).toBe(200);
    expect(await verify.json()).toEqual({ ok: true });

    const cookie = sessionCookie(verify);
    const session = await api.request(`${APP_ORIGIN}/api/auth/session`, { headers: { cookie } });
    expect(session.status).toBe(200);
    const body = await session.json() as { user: { email: string } | null };
    expect(body.user?.email).toBe(user.email);
  });
});

describe('Google sign-in without MFA', () => {
  it('still signs the user in directly with a session cookie', async () => {
    const { api, store } = makeApp();
    const user = await seedUser(store, 'google-plain@example.com');
    await store.linkGoogleSubject('google-subject-plain', user.id);

    const flow = await startFlow(api);
    vi.stubGlobal('fetch', googleFetch(await idTokenFor(flow.nonce, 'google-subject-plain', user.email)));
    const res = await callback(api, flow.flowCookie, flow.state);

    expect([302, 303]).toContain(res.status);
    const cookie = sessionPair(res);
    expect(cookie, 'a non-MFA Google sign-in must still set a session cookie').not.toBeNull();
    expect(redirectTarget(res).searchParams.get('authComplete')).toBe('google');

    const session = await api.request(`${APP_ORIGIN}/api/auth/session`, { headers: { cookie: cookie! } });
    expect(session.status).toBe(200);
    const body = await session.json() as { user: { email: string } | null };
    expect(body.user?.email).toBe(user.email);
  });
});
