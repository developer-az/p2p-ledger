/**
 * Acceptance tests for step 2.6 — append-only security audit log.
 *
 * These encode the target behaviour and are expected to fail until
 * `AuthStore.appendAudit` / `listAudit`, `AUDIT_DDL`, and GET /api/auth/audit
 * exist. The type-only imports below are intentionally the currently missing
 * exports, so `tsc --noEmit` reports only those.
 *
 * Assumed store contract:
 *   appendAudit({ userId, type, at, ipPrefix, device, detail? }): Promise<void>
 *   listAudit(userId, limit?): Promise<AuditEvent[]>   // newest first, default 50
 *   AuditEvent = { id: string; type: AuditType; at: Date; ipPrefix; device; detail? }
 */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/server/app.js';
import * as authModule from '../src/server/auth.js';
import {
  InMemoryAuthStore,
  SESSION_COOKIE,
  hashSessionToken,
  newSessionToken,
  type AuditEvent,
  type AuditType,
  type AuthRecord,
  type AuthStore,
} from '../src/server/auth.js';
import { LedgerError, type LedgerAuditor, type LedgerReader, type LedgerWriter } from '../src/server/ledger.js';
import { MemoryMailer } from '../src/server/mailer.js';
import { CompositeLedger, PracticeLedger } from '../src/server/practice-ledger.js';
import { InMemorySpendLogStore } from '../src/server/spend-log.js';
import { base32Decode, totp } from '../src/server/totp.js';

const T0 = Date.UTC(2026, 0, 5, 9, 0, 0);
const MFA_KEY = Buffer.alloc(32, 0x2a);

/** Built with join() so no credential-shaped literal sits in the test. */
const PASSWORD = ['audit', 'log', 'correct', 'horse'].join('-');
const NEW_PASSWORD = ['audit', 'log', 'rotated', 'horse'].join('-');
const WRONG_PASSWORD = ['audit', 'log', 'wrong', 'horse'].join('-');
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

type AuditInput = {
  userId: string;
  type: AuditType;
  at: Date;
  ipPrefix: string | null;
  device: string | null;
  detail?: Record<string, string | number | boolean>;
};

interface AuditCapableStore extends AuthStore {
  appendAudit(event: AuditInput): Promise<void>;
  listAudit(userId: string, limit?: number): Promise<AuditEvent[]>;
}

function auditStore(store: AuthStore): AuditCapableStore {
  return store as unknown as AuditCapableStore;
}

/** Short IPv4 literal helper: no scattered address strings in assertions. */
function testIp(last: number): string {
  return ['203', '0', '113', String(last)].join('.');
}

let clockMs = T0;
let ipCounter = 10;

beforeEach(() => {
  clockMs = T0;
  ipCounter = 10;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function advance(ms: number): void {
  clockMs += ms;
}

function makeApp(store: AuthStore = new InMemoryAuthStore()) {
  const practice = new PracticeLedger();
  const reject = () => Promise.reject(new LedgerError(503, 'live ledger is down'));
  const live = new Proxy({}, { get: () => reject }) as LedgerReader & LedgerWriter & LedgerAuditor;
  const api = createApp({
    ledger: new CompositeLedger(live, practice, async () => false),
    practice,
    spendLogs: new InMemorySpendLogStore(),
    auth: store,
    mailer: new MemoryMailer(),
    appUrl: 'https://settle.example',
    now: () => new Date(clockMs),
    mfaKey: MFA_KEY,
    breachedPassword: async () => false,
  });
  return { api, store };
}

type App = ReturnType<typeof makeApp>['api'];

function jsonHeaders(cookie?: string, lastIp = 10): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-forwarded-for': testIp(lastIp || ipCounter++),
    'user-agent': USER_AGENT,
  };
  if (cookie) headers.cookie = cookie;
  return headers;
}

/** Splits combined Set-Cookie headers without breaking on attribute commas. */
function setCookieParts(res: Response): string[] {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const raw = res.headers.get('set-cookie') ?? '';
  return raw
    .split(/,(?=\s*[A-Za-z0-9_-]+=)/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function sessionPair(res: Response): string | null {
  for (const part of setCookieParts(res)) {
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

async function seedUser(store: AuthStore, email: string): Promise<AuthRecord> {
  const user: AuthRecord = {
    id: randomUUID(),
    email,
    passwordHash: 'not-used-by-these-tests',
    displayName: 'Audit Tester',
    accountId: randomUUID(),
    ownerId: `audit-${randomUUID().slice(0, 8)}`,
  };
  await store.insert(user);
  return user;
}

async function sessionFor(store: AuthStore, user: AuthRecord): Promise<string> {
  const token = newSessionToken();
  await store.saveSession(hashSessionToken(token), user.id, new Date(clockMs + 7 * 24 * 3_600_000));
  return `${SESSION_COOKIE}=${token}`;
}

async function register(api: App, store: AuthStore, email: string) {
  const res = await api.request('/api/auth/register', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ email, password: PASSWORD, displayName: 'Audit Tester' }),
  });
  expect(res.status).toBe(201);
  const user = await store.findByEmail(email);
  expect(user, 'registration must create the user').not.toBeNull();
  return { cookie: sessionCookie(res), user: user! };
}

async function eventsFor(store: AuthStore, userId: string, limit?: number): Promise<AuditEvent[]> {
  return auditStore(store).listAudit(userId, limit);
}

async function setupMfa(api: App, cookie: string): Promise<Buffer> {
  const res = await api.request('/api/auth/mfa/setup', { method: 'POST', headers: jsonHeaders(cookie) });
  expect(res.status).toBe(200);
  const body = await res.json() as { secret: string };
  expect(body.secret).toMatch(/^[A-Z2-7]+$/);
  return base32Decode(body.secret);
}

async function enableMfa(api: App, store: AuthStore, email: string) {
  const { cookie, user } = await register(api, store, email);
  const secret = await setupMfa(api, cookie);
  const res = await api.request('/api/auth/mfa/enable', {
    method: 'POST',
    headers: jsonHeaders(cookie),
    body: JSON.stringify({ code: totp(secret, clockMs) }),
  });
  expect(res.status).toBe(200);
  const body = await res.json() as { recoveryCodes: string[] };
  expect(body.recoveryCodes).toHaveLength(10);
  return { cookie: sessionCookie(res), secret, recoveryCodes: body.recoveryCodes, user };
}

/** Store that records every append so an unknown email can be proved silent. */
class CountingStore extends InMemoryAuthStore {
  readonly appended: AuditInput[] = [];

  appendAudit(event: AuditInput): Promise<void> {
    this.appended.push(event);
    return Promise.resolve();
  }
}

describe('audit store is append-only', () => {
  it('exposes append and list but no update, delete, or clear path', () => {
    const store = new InMemoryAuthStore();
    expect(typeof (store as unknown as { appendAudit?: unknown }).appendAudit).toBe('function');
    expect(typeof (store as unknown as { listAudit?: unknown }).listAudit).toBe('function');
    expect((store as unknown as { updateAudit?: unknown }).updateAudit).toBeUndefined();
    expect((store as unknown as { deleteAudit?: unknown }).deleteAudit).toBeUndefined();
    expect((store as unknown as { clearAudit?: unknown }).clearAudit).toBeUndefined();
  });

  it('appends a full event and lists it newest first with a generated id', async () => {
    const store = new InMemoryAuthStore();
    const user = randomUUID();
    await auditStore(store).appendAudit({
      userId: user,
      type: 'export',
      at: new Date(T0),
      ipPrefix: testIp(0) + '/24',
      device: 'Chrome on Linux',
      detail: { rows: 3, partial: false },
    });
    await auditStore(store).appendAudit({
      userId: user,
      type: 'step_up',
      at: new Date(T0 + 1_000),
      ipPrefix: null,
      device: null,
    });

    const events = await eventsFor(store, user);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.type)).toEqual(['step_up', 'export']);
    for (const event of events) {
      expect(typeof event.id).toBe('string');
      expect(event.id.length).toBeGreaterThan(0);
      expect(event.at).toBeInstanceOf(Date);
    }
    expect(events[1]).toMatchObject({
      type: 'export',
      ipPrefix: testIp(0) + '/24',
      device: 'Chrome on Linux',
      detail: { rows: 3, partial: false },
    });
  });

  it('defaults to the fifty newest events and honours an explicit limit', async () => {
    const store = new InMemoryAuthStore();
    const user = randomUUID();
    for (let index = 0; index < 60; index++) {
      await auditStore(store).appendAudit({
        userId: user,
        type: index % 2 === 0 ? 'login' : 'step_up',
        at: new Date(T0 + index * 1_000),
        ipPrefix: null,
        device: null,
      });
    }

    const firstPage = await eventsFor(store, user);
    expect(firstPage).toHaveLength(50);
    expect(firstPage[0]!.at.getTime()).toBe(T0 + 59_000);
    expect(firstPage[firstPage.length - 1]!.at.getTime()).toBe(T0 + 10_000);
    expect(new Set(firstPage.map((event) => event.id)).size).toBe(50);

    const shortPage = await eventsFor(store, user, 5);
    expect(shortPage).toHaveLength(5);
    expect(shortPage[0]!.at.getTime()).toBe(T0 + 59_000);
    expect(shortPage[4]!.at.getTime()).toBe(T0 + 55_000);
  });

  it('returns copies so mutating a result cannot rewrite history', async () => {
    const store = new InMemoryAuthStore();
    const user = randomUUID();
    await auditStore(store).appendAudit({
      userId: user,
      type: 'login',
      at: new Date(T0),
      ipPrefix: null,
      device: null,
      detail: { rows: 3 },
    });

    const firstRead = await eventsFor(store, user);
    const event = firstRead[0]!;
    event.type = 'account_deleted';
    event.at.setTime(T0 - 60_000);
    event.detail!.rows = 99;
    event.detail!.mutated = 'yes';

    const secondRead = await eventsFor(store, user);
    expect(secondRead).toHaveLength(1);
    expect(secondRead[0]!.type).toBe('login');
    expect(secondRead[0]!.at.getTime()).toBe(T0);
    expect(secondRead[0]!.detail).toEqual({ rows: 3 });
  });

  it('keeps events scoped to the requested user', async () => {
    const store = new InMemoryAuthStore();
    const one = randomUUID();
    const two = randomUUID();
    await auditStore(store).appendAudit({
      userId: one, type: 'login', at: new Date(T0), ipPrefix: null, device: null,
    });
    await auditStore(store).appendAudit({
      userId: two, type: 'mfa_enabled', at: new Date(T0 + 1_000), ipPrefix: null, device: null,
    });

    expect((await eventsFor(store, one)).map((event) => event.type)).toEqual(['login']);
    expect((await eventsFor(store, two)).map((event) => event.type)).toEqual(['mfa_enabled']);
  });
});

describe('app writes security audit events', () => {
  it('records a successful password sign-in as login with coarse request metadata', async () => {
    const { api, store } = makeApp();
    const { user } = await register(api, store, 'login-event@example.com');
    const before = await eventsFor(store, user.id);
    advance(1_000);

    const res = await api.request('/api/auth/login', {
      method: 'POST',
      headers: jsonHeaders(undefined, 31),
      body: JSON.stringify({ email: user.email, password: PASSWORD }),
    });
    expect(res.status).toBe(200);

    const events = await eventsFor(store, user.id);
    expect(events.length).toBe(before.length + 1);
    expect(events[0]!.type).toBe('login');
    expect(events[0]!.ipPrefix).toBe(testIp(0) + '/24');
    expect(events[0]!.device).toBe('Chrome on Linux');
  });

  it('records a wrong password for a known account as login_failed', async () => {
    const { api, store } = makeApp();
    const { user } = await register(api, store, 'failed-event@example.com');
    const before = await eventsFor(store, user.id);
    advance(1_000);

    const res = await api.request('/api/auth/login', {
      method: 'POST',
      headers: jsonHeaders(undefined, 32),
      body: JSON.stringify({ email: user.email, password: WRONG_PASSWORD }),
    });
    expect(res.status).toBe(401);

    const events = await eventsFor(store, user.id);
    expect(events.length).toBeGreaterThan(before.length);
    expect(events.some((event) => event.type === 'login_failed')).toBe(true);
  });

  it('writes nothing for a sign-in attempt against an unknown email', async () => {
    const store = new CountingStore();
    const { api } = makeApp(store);
    const res = await api.request('/api/auth/login', {
      method: 'POST',
      headers: jsonHeaders(undefined, 33),
      body: JSON.stringify({ email: 'nobody-audit@example.com', password: WRONG_PASSWORD }),
    });
    expect(res.status).toBe(401);
    expect(store.appended).toHaveLength(0);
  });

  it('records MFA enable and disable', async () => {
    const { api, store } = makeApp();
    const enabled = await enableMfa(api, store, 'mfa-events@example.com');

    expect((await eventsFor(store, enabled.user.id)).some((event) => event.type === 'mfa_enabled')).toBe(true);

    advance(60_000);
    const res = await api.request('/api/auth/mfa/disable', {
      method: 'POST',
      headers: jsonHeaders(enabled.cookie),
      body: JSON.stringify({ code: totp(enabled.secret, clockMs) }),
    });
    expect(res.status).toBe(200);

    expect((await eventsFor(store, enabled.user.id)).some((event) => event.type === 'mfa_disabled')).toBe(true);
  });

  it('records a sign-in completed with a recovery code', async () => {
    const { api, store } = makeApp();
    const enabled = await enableMfa(api, store, 'recovery-event@example.com');
    advance(60_000);

    const login = await api.request('/api/auth/login', {
      method: 'POST',
      headers: jsonHeaders(undefined, 34),
      body: JSON.stringify({ email: enabled.user.email, password: PASSWORD }),
    });
    expect(login.status).toBe(200);
    const challenge = (await login.json() as { challenge?: string }).challenge;
    expect(challenge).toBeTruthy();

    const verify = await api.request('/api/auth/mfa/verify', {
      method: 'POST',
      headers: jsonHeaders(undefined, 35),
      body: JSON.stringify({ challenge, code: enabled.recoveryCodes[0] }),
    });
    expect(verify.status).toBe(200);

    expect((await eventsFor(store, enabled.user.id)).some((event) => event.type === 'recovery_code_used')).toBe(true);
  });

  it('records a session revocation', async () => {
    const { api, store } = makeApp();
    const { cookie, user } = await register(api, store, 'revoke-event@example.com');
    const second = await api.request('/api/auth/login', {
      method: 'POST',
      headers: jsonHeaders(undefined, 36),
      body: JSON.stringify({ email: user.email, password: PASSWORD }),
    });
    expect(second.status).toBe(200);

    const list = await api.request('/api/auth/sessions', { headers: { cookie } });
    expect(list.status).toBe(200);
    const sessions = (await list.json() as { sessions: Array<{ id: string; current: boolean }> }).sessions;
    const other = sessions.find((session) => !session.current);
    expect(other, 'a second session must be visible to the first').toBeDefined();

    const res = await api.request(`/api/auth/sessions/${other!.id}`, {
      method: 'DELETE',
      headers: jsonHeaders(cookie, 37),
    });
    expect(res.status).toBe(200);

    expect((await eventsFor(store, user.id)).some((event) => event.type === 'session_revoked')).toBe(true);
  });

  it('records a completed password reset as password_changed', async () => {
    const { api, store } = makeApp();
    const { user } = await register(api, store, 'reset-event@example.com');
    const token = newSessionToken();
    await store.saveResetToken(hashSessionToken(token), user.id, new Date(clockMs + 30 * 60_000));

    const res = await api.request('/api/auth/password-reset/confirm', {
      method: 'POST',
      headers: jsonHeaders(undefined, 38),
      body: JSON.stringify({ token, password: NEW_PASSWORD }),
    });
    expect(res.status).toBe(200);

    expect((await eventsFor(store, user.id)).some((event) => event.type === 'password_changed')).toBe(true);
  });

  it('records a successful step-up', async () => {
    const { api, store } = makeApp();
    const { cookie, user } = await register(api, store, 'step-up-event@example.com');

    const res = await api.request('/api/auth/step-up', {
      method: 'POST',
      headers: jsonHeaders(cookie, 39),
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(res.status).toBe(200);

    expect((await eventsFor(store, user.id)).some((event) => event.type === 'step_up')).toBe(true);
  });
});

describe('GET /api/auth/audit', () => {
  it('returns only the caller\'s events, newest first, without detail', async () => {
    const { api, store } = makeApp();
    const caller = await seedUser(store, 'audit-caller@example.com');
    const other = await seedUser(store, 'audit-other@example.com');
    const cookie = await sessionFor(store, caller);

    await auditStore(store).appendAudit({
      userId: caller.id,
      type: 'export',
      at: new Date(T0 + 1_000),
      ipPrefix: testIp(0) + '/24',
      device: 'Chrome on Linux',
      detail: { rows: 3 },
    });
    await auditStore(store).appendAudit({
      userId: caller.id,
      type: 'step_up',
      at: new Date(T0 + 2_000),
      ipPrefix: null,
      device: null,
    });
    await auditStore(store).appendAudit({
      userId: other.id,
      type: 'login',
      at: new Date(T0 + 3_000),
      ipPrefix: null,
      device: null,
    });

    const res = await api.request('/api/auth/audit', { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as { events: Array<Record<string, unknown>> };
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.map((event) => event.type)).toEqual(['step_up', 'export']);

    for (const event of body.events) {
      expect(typeof event.id).toBe('string');
      expect((event.id as string).length).toBeGreaterThan(0);
      expect(typeof event.at).toBe('string');
      expect(new Date(event.at as string).toISOString()).toBe(event.at);
      expect(event).toHaveProperty('ipPrefix');
      expect(event).toHaveProperty('device');
      expect(Object.prototype.hasOwnProperty.call(event, 'detail')).toBe(false);
    }
    expect(body.events[0]).toMatchObject({ type: 'step_up', ipPrefix: null, device: null });
    expect(body.events[1]).toMatchObject({
      type: 'export',
      ipPrefix: testIp(0) + '/24',
      device: 'Chrome on Linux',
    });
  });

  it('rejects anonymous callers', async () => {
    const { api } = makeApp();
    const res = await api.request('/api/auth/audit');
    expect(res.status).toBe(401);
  });
});

describe('Postgres audit schema', () => {
  it('creates app_audit_log with the ledger-style append-only trigger', () => {
    const ddl = (authModule as unknown as { AUDIT_DDL?: unknown }).AUDIT_DDL;
    expect(typeof ddl).toBe('string');
    const sql = String(ddl).toLowerCase();
    expect(sql).toMatch(/create\s+table\s+(if\s+not\s+exists\s+)?app_audit_log/);
    expect(sql).toMatch(/create\s+(or\s+replace\s+)?function\s+[a-z0-9_]+\s*\(\s*\)/);
    expect(sql).toMatch(/create\s+trigger\s+[a-z0-9_]+/);
    expect(sql).toMatch(/before\s+update\s+or\s+delete/);
    expect(sql).toMatch(/raise\s+exception/);
    expect(sql).toMatch(/on\s+app_audit_log/);
  });
});
