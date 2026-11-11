import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/server/app.js';
import * as authModule from '../src/server/auth.js';
import {
  hashSessionToken,
  InMemoryAuthStore,
  newSessionToken,
  SESSION_COOKIE,
  type AuthRecord,
} from '../src/server/auth.js';
import { CompositeLedger, PracticeLedger } from '../src/server/practice-ledger.js';
import { InMemorySpendLogStore } from '../src/server/spend-log.js';
import { MemoryMailer } from '../src/server/mailer.js';
import { LedgerError, type LedgerAuditor, type LedgerReader, type LedgerWriter } from '../src/server/ledger.js';

/**
 * Acceptance tests for step 2.1 (session hardening). These encode the target
 * behaviour and are expected to fail until the implementation lands.
 *
 * Hard-coded limits are written as literals so a missing export fails the
 * export assertions instead of mangling the timing maths.
 */
const SESSION_IDLE_MS = 30 * 60 * 1000;
const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;
const T0 = new Date('2026-01-05T09:00:00Z');

/** Reads constants the implementation must export from src/server/auth.ts. */
const authExports = authModule as unknown as Record<string, unknown>;

let clock = new Date(T0);

function makeApp(options: { now?: () => Date } = {}) {
  const store = new InMemoryAuthStore();
  const mailer = new MemoryMailer();
  const practice = new PracticeLedger();
  const reject = () => Promise.reject(new LedgerError(503, 'live ledger is down'));
  const live = new Proxy({}, { get: () => reject }) as LedgerReader & LedgerWriter & LedgerAuditor;
  const api = createApp({
    ledger: new CompositeLedger(live, practice, async () => false),
    practice,
    spendLogs: new InMemorySpendLogStore(),
    auth: store,
    mailer,
    appUrl: 'https://settle.example',
    now: options.now,
  });
  return { api, store, mailer };
}

let ipCounter = 10;
function nextIp(): string {
  return `198.51.100.${ipCounter++}`;
}

function jsonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'content-type': 'application/json', 'x-forwarded-for': nextIp(), ...extra };
}

function post(api: ReturnType<typeof makeApp>['api'], path: string, body: unknown,
  extra: Record<string, string> = {}) {
  return api.request(path, { method: 'POST', headers: jsonHeaders(extra), body: JSON.stringify(body) });
}

/** "name=value" of the session cookie, independent of the name the code uses. */
function sessionPair(res: Response): string {
  const raw = res.headers.get('set-cookie') ?? '';
  const pair = raw.split(';')[0] ?? '';
  if (!pair.includes('=')) throw new Error(`missing session cookie: "${raw}"`);
  return pair;
}

function cookieName(pair: string): string {
  return pair.slice(0, pair.indexOf('='));
}

function cookieValue(pair: string): string {
  return pair.slice(pair.indexOf('=') + 1);
}

function cookieAttributes(res: Response): string[] {
  return (res.headers.get('set-cookie') ?? '')
    .split(';')
    .slice(1)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

async function register(api: ReturnType<typeof makeApp>['api'], email: string,
  extra: Record<string, string> = {}) {
  const res = await post(api, '/api/auth/register',
    { email, password: 'correct-horse', displayName: 'Sam Lee' }, extra);
  expect(res.status).toBe(201);
  return { res, pair: sessionPair(res) };
}

async function login(api: ReturnType<typeof makeApp>['api'], email: string,
  extra: Record<string, string> = {}) {
  const res = await post(api, '/api/auth/login',
    { email, password: 'correct-horse' }, extra);
  expect(res.status).toBe(200);
  return { res, pair: sessionPair(res) };
}

async function seedUser(store: InMemoryAuthStore): Promise<AuthRecord> {
  const user: AuthRecord = {
    id: randomUUID(),
    email: `user-${randomUUID()}@example.com`,
    passwordHash: 'not-used-here',
    displayName: 'Unit Test',
    accountId: randomUUID(),
    ownerId: `unit-test-${randomUUID().slice(0, 8)}`,
  };
  await store.insert(user);
  return user;
}

type SessionRow = {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  device: string;
  ipPrefix: string | null;
};

async function listedSessions(api: ReturnType<typeof makeApp>['api'], cookie: string) {
  const res = await api.request('/api/auth/sessions', { headers: { cookie } });
  expect(res.status).toBe(200);
  const body = await res.json() as { sessions: SessionRow[] };
  expect(Array.isArray(body.sessions)).toBe(true);
  return body.sessions;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('session cookie', () => {
  it('uses the __Host- name and hardened attributes on sign-up and sign-in', async () => {
    expect(SESSION_COOKIE).toBe('__Host-settle_session');
    const { api } = makeApp();

    const created = await post(api, '/api/auth/register',
      { email: 'sam@example.com', password: 'correct-horse', displayName: 'Sam Lee' },
      { 'x-forwarded-proto': 'https', 'user-agent': 'Mozilla/5.0 (Macintosh) Chrome/120.0' });
    expect(created.status).toBe(201);

    const signedIn = await post(api, '/api/auth/login',
      { email: 'sam@example.com', password: 'correct-horse' },
      { 'x-forwarded-proto': 'https', 'user-agent': 'Mozilla/5.0 (Macintosh) Chrome/120.0' });
    expect(signedIn.status).toBe(200);

    for (const res of [created, signedIn]) {
      const pair = sessionPair(res);
      expect(cookieName(pair)).toBe(SESSION_COOKIE);
      expect(cookieValue(pair).length).toBeGreaterThan(20);
      const attributes = cookieAttributes(res);
      expect(attributes).toContain('path=/');
      expect(attributes).toContain('httponly');
      expect(attributes).toContain('secure');
      expect(attributes.some((a) => a.startsWith('samesite=lax'))).toBe(true);
      expect(attributes.some((a) => a.startsWith('domain='))).toBe(false);
    }
  });
});

describe('session rotation', () => {
  it('issues a fresh token on every sign-in and never reuses a supplied one', async () => {
    const { api } = makeApp();
    const first = await register(api, 'rotating@example.com');
    const firstToken = cookieValue(first.pair);

    const second = await login(api, 'rotating@example.com');
    const secondToken = cookieValue(second.pair);
    expect(cookieName(second.pair)).toBe(SESSION_COOKIE);
    expect(secondToken).not.toBe(firstToken);

    // Signing in while presenting an existing session cookie must not adopt it.
    const third = await login(api, 'rotating@example.com', { cookie: first.pair });
    const thirdToken = cookieValue(third.pair);
    expect(thirdToken).not.toBe(firstToken);
    expect(thirdToken).not.toBe(secondToken);
  });

  it('invalidates older sessions after a password reset', async () => {
    clock = new Date(T0);
    const { api, mailer } = makeApp({ now: () => clock });
    const { pair } = await register(api, 'reset@example.com');

    const requested = await post(api, '/api/auth/password-reset/request', { email: 'reset@example.com' });
    expect(requested.status).toBe(202);
    const token = /#token=([A-Za-z0-9_-]+)/.exec(mailer.sent[0]?.text ?? '')?.[1] ?? '';
    expect(token.length).toBeGreaterThan(20);

    const confirmed = await post(api, '/api/auth/password-reset/confirm',
      { token, password: 'brand-new-password' });
    expect(confirmed.status).toBe(200);
    expect(cookieValue(sessionPair(confirmed))).not.toBe(cookieValue(pair));

    const old = await api.request('/api/auth/session', { headers: { cookie: pair } });
    expect((await old.json() as { user: unknown }).user).toBeNull();

    const oldPassword = await post(api, '/api/auth/login',
      { email: 'reset@example.com', password: 'correct-horse' });
    expect(oldPassword.status).toBe(401);
  });
});

describe('session timeouts', () => {
  it('exports the idle and absolute limits', () => {
    expect(authExports.SESSION_IDLE_MS, 'SESSION_IDLE_MS must be exported from src/server/auth.ts')
      .toBe(SESSION_IDLE_MS);
    expect(authExports.SESSION_ABSOLUTE_MS, 'SESSION_ABSOLUTE_MS must be exported from src/server/auth.ts')
      .toBe(SESSION_ABSOLUTE_MS);
  });

  it('rejects a session idle for 31 minutes and refreshes last-seen on use', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T0));
    const store = new InMemoryAuthStore();
    const user = await seedUser(store);
    const tokenHash = hashSessionToken(newSessionToken());
    const created = new Date(T0);
    await store.saveSession(tokenHash, user.id, new Date(created.getTime() + SESSION_ABSOLUTE_MS));
    const at = (minutes: number) => new Date(created.getTime() + minutes * 60_000);

    expect(await store.userForToken(tokenHash, at(0))).not.toBeNull();
    // 20 minutes idle: still inside the window, and the lookup moves last-seen.
    expect(await store.userForToken(tokenHash, at(20))).not.toBeNull();
    // 29 minutes after the last successful use: still valid.
    expect(await store.userForToken(tokenHash, at(49))).not.toBeNull();
    // 31 minutes after the last successful use: idle timeout.
    expect(await store.userForToken(tokenHash, at(80))).toBeNull();
  });

  it('keeps a session used every 20 minutes until 7 days after creation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T0));
    const store = new InMemoryAuthStore();
    const user = await seedUser(store);
    const tokenHash = hashSessionToken(newSessionToken());
    const created = new Date(T0);
    const expiresAt = new Date(created.getTime() + SESSION_ABSOLUTE_MS);
    await store.saveSession(tokenHash, user.id, expiresAt);

    for (let minutes = 0; minutes < 7 * 24 * 60; minutes += 20) {
      const at = new Date(created.getTime() + minutes * 60_000);
      expect(await store.userForToken(tokenHash, at),
        `session must stay valid ${minutes} minutes after creation`).not.toBeNull();
    }

    // Just inside seven days: still valid (last use was 20 minutes ago).
    expect(await store.userForToken(tokenHash, new Date(expiresAt.getTime() - 1))).not.toBeNull();
    // Seven days after creation: absolute timeout, regardless of activity.
    expect(await store.userForToken(tokenHash, expiresAt)).toBeNull();
  });

  it('tracks last-seen through the API and rejects an idle session', async () => {
    clock = new Date(T0);
    const { api } = makeApp({ now: () => clock });
    const { pair } = await register(api, 'idle@example.com');

    clock = new Date(T0.getTime() + 20 * 60_000);
    const afterTwenty = await listedSessions(api, pair);
    expect(afterTwenty).toHaveLength(1);
    expect(Date.parse(afterTwenty[0]!.createdAt)).toBe(T0.getTime());
    expect(Date.parse(afterTwenty[0]!.lastSeenAt)).toBe(T0.getTime() + 20 * 60_000);

    clock = new Date(T0.getTime() + 40 * 60_000);
    const afterForty = await listedSessions(api, pair);
    expect(Date.parse(afterForty[0]!.lastSeenAt)).toBe(T0.getTime() + 40 * 60_000);

    // 31 minutes after the last use: the cookie no longer authenticates.
    clock = new Date(T0.getTime() + 71 * 60_000);
    const stale = await api.request('/api/auth/sessions', { headers: { cookie: pair } });
    expect(stale.status).toBe(401);
  });
});

describe('CSRF protection on mutating /api requests', () => {
  const mutations: Array<[string, string]> = [
    ['POST', '/api/auth/login'],
    ['PUT', '/api/accounts/00000000-0000-7000-8000-000000000001'],
    ['PATCH', '/api/accounts/00000000-0000-7000-8000-000000000001/finance'],
    ['DELETE', '/api/auth/sessions/some-session-id'],
  ];

  it('rejects an untrusted Origin with 403 and {error:cross_origin} for every method', async () => {
    const { api } = makeApp();
    for (const [method, path] of mutations) {
      const res = await api.request(path, {
        method,
        headers: jsonHeaders({ origin: 'https://untrusted.example' }),
        body: method === 'DELETE' ? undefined : '{}',
      });
      expect(res.status, `${method} ${path} must be blocked`).toBe(403);
      expect(await res.json(), `${method} ${path} must report cross_origin`).toEqual({ error: 'cross_origin' });
    }
  });

  it('rejects Sec-Fetch-Site: cross-site with 403 and {error:cross_origin}', async () => {
    const { api } = makeApp();
    for (const [method, path] of mutations) {
      const res = await api.request(path, {
        method,
        headers: jsonHeaders({ 'sec-fetch-site': 'cross-site' }),
        body: method === 'DELETE' ? undefined : '{}',
      });
      expect(res.status, `${method} ${path} must be blocked`).toBe(403);
      expect(await res.json()).toEqual({ error: 'cross_origin' });
    }
  });

  it('allows same-origin, Sec-Fetch-Site none, and headerless writes', async () => {
    const { api } = makeApp();

    const sameOrigin = await api.request('/api/auth/logout', {
      method: 'POST',
      headers: { origin: 'http://localhost', 'sec-fetch-site': 'same-origin' },
    });
    expect(sameOrigin.status).toBe(200);

    const fetchNone = await api.request('/api/auth/logout', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'none' },
    });
    expect(fetchNone.status).toBe(200);

    // curl and server-to-server callers send neither header.
    const headerless = await api.request('/api/auth/logout', { method: 'POST' });
    expect(headerless.status).toBe(200);
  });

  it('never blocks GET reads, including the OAuth callback', async () => {
    const { api } = makeApp();
    const crossSite = { origin: 'https://untrusted.example', 'sec-fetch-site': 'cross-site' };

    const boot = await api.request('/api/bootstrap', { headers: crossSite });
    expect(boot.status).toBe(200);

    const callback = await api.request('/api/auth/google/callback?code=x&state=y', { headers: crossSite });
    expect(callback.status).not.toBe(403);
  });
});

describe('session list and revocation', () => {
  const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

  it('lists sessions with a current flag, device label, ip prefix and opaque ids', async () => {
    const { api } = makeApp();
    const first = await register(api, 'list@example.com',
      { 'user-agent': CHROME, 'x-forwarded-for': '203.0.113.10, 70.41.3.18' });
    const second = await login(api, 'list@example.com',
      { 'user-agent': SAFARI, 'x-forwarded-for': '2001:db8:1234:5678::1' });
    const third = await login(api, 'list@example.com', { 'user-agent': 'curl/8.5.0' });

    const sessions = await listedSessions(api, first.pair);
    expect(sessions).toHaveLength(3);

    for (const session of sessions) {
      expect(typeof session.id).toBe('string');
      expect(session.id.length).toBeGreaterThan(0);
      expect(typeof session.current).toBe('boolean');
      expect(Number.isFinite(Date.parse(session.createdAt))).toBe(true);
      expect(Number.isFinite(Date.parse(session.lastSeenAt))).toBe(true);
      expect(typeof session.device).toBe('string');
      expect(session.device.length).toBeGreaterThan(0);
      expect(session.device.length).toBeLessThanOrEqual(40);
      expect(session.device).not.toBe(CHROME);
      expect(session.device).not.toBe(SAFARI);
      expect(session.ipPrefix === null || typeof session.ipPrefix === 'string').toBe(true);
    }

    const current = sessions.filter((s) => s.current);
    expect(current).toHaveLength(1);
    expect(current[0]!.ipPrefix).toBe('203.0.113.0/24');

    const ipv6 = sessions.find((s) => s.ipPrefix === '2001:db8:1234::/48');
    expect(ipv6).toBeDefined();
    expect(current[0]!.device).not.toBe(ipv6!.device);

    // The public id must not be the token, the token hash, or duplicate another row.
    const tokens = [first, second, third].map((s) => cookieValue(s.pair));
    const ids = sessions.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const token of tokens) {
      expect(ids).not.toContain(token);
      expect(ids).not.toContain(hashSessionToken(token));
    }
  });

  it('revokes another session of the same user and keeps the caller signed in', async () => {
    const { api } = makeApp();
    const first = await register(api, 'revoke@example.com', { 'user-agent': CHROME });
    const second = await login(api, 'revoke@example.com', { 'user-agent': SAFARI });

    const before = await listedSessions(api, first.pair);
    expect(before).toHaveLength(2);
    const victim = before.find((s) => !s.current);
    expect(victim).toBeDefined();

    const revoked = await api.request(`/api/auth/sessions/${encodeURIComponent(victim!.id)}`, {
      method: 'DELETE',
      headers: { cookie: first.pair },
    });
    expect([200, 204]).toContain(revoked.status);

    // The revoked session no longer authenticates.
    const stale = await api.request('/api/auth/sessions', { headers: { cookie: second.pair } });
    expect(stale.status).toBe(401);
    const whoAmI = await api.request('/api/auth/session', { headers: { cookie: second.pair } });
    expect((await whoAmI.json() as { user: unknown }).user).toBeNull();

    // The caller's own session still works and the victim is gone from the list.
    const after = await listedSessions(api, first.pair);
    expect(after).toHaveLength(1);
    expect(after[0]!.current).toBe(true);
    expect(after[0]!.id).toBe(before.find((s) => s.current)!.id);
  });

  it('returns 404 when revoking a session that belongs to another user', async () => {
    const { api } = makeApp();
    const one = await register(api, 'one@example.com', { 'user-agent': CHROME });
    const two = await register(api, 'two@example.com', { 'user-agent': SAFARI });
    const foreign = await listedSessions(api, two.pair);
    expect(foreign).toHaveLength(1);

    const res = await api.request(`/api/auth/sessions/${encodeURIComponent(foreign[0]!.id)}`, {
      method: 'DELETE',
      headers: { cookie: one.pair },
    });
    expect(res.status).toBe(404);

    // The other user's session survived.
    const stillThere = await api.request('/api/auth/sessions', { headers: { cookie: two.pair } });
    expect(stillThere.status).toBe(200);
  });

  it('requires a signed-in session for listing and revoking', async () => {
    const { api } = makeApp();
    const list = await api.request('/api/auth/sessions');
    expect(list.status).toBe(401);

    const revoke = await api.request('/api/auth/sessions/any-session-id', { method: 'DELETE' });
    expect(revoke.status).toBe(401);
  });
});
