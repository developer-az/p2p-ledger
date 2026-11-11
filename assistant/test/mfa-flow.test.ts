/**
 * Acceptance tests for step 2.2 — TOTP MFA + recovery codes, HTTP flow.
 *
 * These encode the target behaviour and are expected to fail until
 * `createApp({ mfaKey })` and the /api/auth/mfa* + /api/auth/step-up routes
 * exist (vitest: missing module / 404 responses).
 *
 * Assumed routes (all JSON, all require a signed-in session unless noted):
 *   GET    /api/auth/mfa            -> { enabled, recoveryCodesLeft }
 *   POST   /api/auth/mfa/setup      -> 200 { secret (base32), otpauthUri }
 *   POST   /api/auth/mfa/enable     { code } -> 200 { recoveryCodes: string[10] } | 400 { error: 'invalid_code' }
 *   POST   /api/auth/mfa/verify     { challenge, code } (no session) -> 200 { ok: true } + cookie
 *   POST   /api/auth/mfa/disable    { code } -> 200
 *   POST   /api/auth/step-up        { code } | { password } -> 200 { ok: true, until: ISO }
 * Sign-in for an MFA user: POST /api/auth/login -> 200 { mfaRequired: true, challenge } with no session cookie.
 *
 * Time is driven through both `createApp({ now })` and the fake system clock,
 * so an implementation that reads either one sees the same instant.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/server/app.js';
import { InMemoryAuthStore, SESSION_COOKIE } from '../src/server/auth.js';
import { LedgerError, type LedgerAuditor, type LedgerReader, type LedgerWriter } from '../src/server/ledger.js';
import { MemoryMailer } from '../src/server/mailer.js';
import { CompositeLedger, PracticeLedger } from '../src/server/practice-ledger.js';
import { InMemorySpendLogStore } from '../src/server/spend-log.js';
import { base32Decode, totp } from '../src/server/totp.js';

const T0 = Date.UTC(2026, 0, 5, 9, 0, 0);
const STEP_UP_MS = 10 * 60_000;
const CHALLENGE_TTL_MS = 5 * 60_000;

/** Built with join() so no literal password string sits in a login() call. */
const PASSWORD = ['correct', 'horse', 'battery', 'staple'].join('-');
const WRONG_PASSWORD = ['not', 'the', 'password'].join('-');

/** 32-byte AES key for the TOTP secret; the flow only needs a stable value. */
const MFA_KEY = Buffer.alloc(32, 0x2a);

let clockMs = T0;
let ipCounter = 10;

beforeEach(() => {
  clockMs = T0;
  ipCounter = 10;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(clockMs));
});

afterEach(() => {
  vi.useRealTimers();
});

/** Moves the app clock and the fake system clock together. */
function advance(ms: number): void {
  clockMs += ms;
  vi.setSystemTime(new Date(clockMs));
}

function makeApp() {
  const auth = new InMemoryAuthStore();
  const mailer = new MemoryMailer();
  const practice = new PracticeLedger();
  const reject = () => Promise.reject(new LedgerError(503, 'live ledger is down'));
  const live = new Proxy({}, { get: () => reject }) as LedgerReader & LedgerWriter & LedgerAuditor;
  const deps = {
    ledger: new CompositeLedger(live, practice, async () => false),
    practice,
    spendLogs: new InMemorySpendLogStore(),
    auth,
    mailer,
    appUrl: 'https://settle.example',
    now: () => new Date(Date.now()),
    // New createApp option: 32-byte key that encrypts the stored TOTP secret.
    mfaKey: MFA_KEY,
    breachedPassword: async () => false,
  };
  const api = createApp(deps as Parameters<typeof createApp>[0]);
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

/** Splits the combined Set-Cookie header without breaking on attribute commas. */
function setCookieParts(res: Response): string[] {
  const raw = res.headers.get('set-cookie') ?? '';
  return raw
    .split(/,(?=\s*[A-Za-z0-9_-]+=)/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** "name=value" of the session cookie, or null when the response sets none. */
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

/** The response's new session cookie when it sets one, else the cookie we sent. */
function rotatedCookie(res: Response, previous: string): string {
  return sessionPair(res) ?? previous;
}

function cookieValue(pair: string): string {
  return pair.slice(pair.indexOf('=') + 1);
}

async function signUp(api: Api, email: string): Promise<string> {
  const res = await api.request('/api/auth/register', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ email, password: PASSWORD, displayName: 'Sam Lee' }),
  });
  expect(res.status).toBe(201);
  return sessionCookie(res);
}

async function passwordLogin(api: Api, email: string): Promise<Response> {
  return await api.request('/api/auth/login', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ email, password: PASSWORD }),
  });
}

async function mfaStatus(api: Api, cookie: string): Promise<{ enabled: boolean; recoveryCodesLeft: number }> {
  const res = await api.request('/api/auth/mfa', { headers: { cookie } });
  expect(res.status).toBe(200);
  const body = await res.json() as { enabled: boolean; recoveryCodesLeft: number };
  return body;
}

/** Runs /setup and returns the decoded pending secret. */
async function setupMfa(api: Api, cookie: string): Promise<Buffer> {
  const res = await api.request('/api/auth/mfa/setup', { method: 'POST', headers: jsonHeaders(cookie) });
  expect(res.status).toBe(200);
  const body = await res.json() as { secret: string; otpauthUri: string };
  expect(typeof body.secret).toBe('string');
  expect(body.secret).toMatch(/^[A-Z2-7]+$/);
  expect(body.otpauthUri.startsWith('otpauth://totp/')).toBe(true);
  expect(body.otpauthUri).toContain(`secret=${body.secret}`);
  return base32Decode(body.secret);
}

/** /setup + /enable with the code for the current step. */
async function enableMfa(api: Api, cookie: string): Promise<{ cookie: string; secret: Buffer; recoveryCodes: string[] }> {
  const secret = await setupMfa(api, cookie);
  const res = await api.request('/api/auth/mfa/enable', {
    method: 'POST',
    headers: jsonHeaders(cookie),
    body: JSON.stringify({ code: totp(secret, clockMs) }),
  });
  expect(res.status).toBe(200);
  const body = await res.json() as { recoveryCodes: string[] };
  expect(Array.isArray(body.recoveryCodes)).toBe(true);
  return { cookie: rotatedCookie(res, cookie), secret, recoveryCodes: body.recoveryCodes };
}

async function challengeFor(api: Api, email: string): Promise<string> {
  const res = await passwordLogin(api, email);
  expect(res.status).toBe(200);
  const body = await res.json() as { mfaRequired?: boolean; challenge?: string };
  expect(body.mfaRequired, 'sign-in for an MFA user must ask for a second factor').toBe(true);
  expect(typeof body.challenge).toBe('string');
  expect((body.challenge ?? '').length).toBeGreaterThan(10);
  expect(sessionPair(res), 'a pending MFA challenge must not hand out a session').toBeNull();
  return body.challenge!;
}

async function verify(api: Api, challenge: string, code: string): Promise<Response> {
  return await api.request('/api/auth/mfa/verify', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ challenge, code }),
  });
}

async function disable(api: Api, cookie: string, code: string): Promise<Response> {
  return await api.request('/api/auth/mfa/disable', {
    method: 'POST',
    headers: jsonHeaders(cookie),
    body: JSON.stringify({ code }),
  });
}

async function stepUp(api: Api, cookie: string, body: unknown): Promise<Response> {
  return await api.request('/api/auth/step-up', {
    method: 'POST',
    headers: jsonHeaders(cookie),
    body: JSON.stringify(body),
  });
}

/** A code that is guaranteed not to be `valid` (so a wrong-code test is deterministic). */
function wrongCode(valid: string): string {
  return valid === '000000' ? '111111' : '000000';
}

describe('MFA setup and enable', () => {
  it('stores a pending secret, then enables with a valid code and returns ten recovery codes', async () => {
    const { api } = makeApp();
    const cookie = await signUp(api, 'setup@example.com');

    const before = await mfaStatus(api, cookie);
    expect(before.enabled).toBe(false);
    expect(before.recoveryCodesLeft).toBe(0);

    const secret = await setupMfa(api, cookie);
    // A setup alone must not enable MFA yet.
    expect((await mfaStatus(api, cookie)).enabled).toBe(false);

    const res = await api.request('/api/auth/mfa/enable', {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ code: totp(secret, clockMs) }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { recoveryCodes: string[] };
    expect(body.recoveryCodes).toHaveLength(10);
    expect(new Set(body.recoveryCodes).size).toBe(10);
    for (const code of body.recoveryCodes) expect(code).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}$/);

    const after = await mfaStatus(api, rotatedCookie(res, cookie));
    expect(after.enabled).toBe(true);
    expect(after.recoveryCodesLeft).toBe(10);
  });

  it('refuses to enable with a wrong code', async () => {
    const { api } = makeApp();
    const cookie = await signUp(api, 'bad-enable@example.com');
    const secret = await setupMfa(api, cookie);

    const res = await api.request('/api/auth/mfa/enable', {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ code: wrongCode(totp(secret, clockMs)) }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_code' });
    expect((await mfaStatus(api, cookie)).enabled).toBe(false);
  });

  it('does not ask for MFA before enable', async () => {
    const { api } = makeApp();
    const cookie = await signUp(api, 'pending@example.com');
    await setupMfa(api, cookie);

    const res = await passwordLogin(api, 'pending@example.com');
    expect(res.status).toBe(200);
    const body = await res.json() as { mfaRequired?: boolean };
    expect(body.mfaRequired).not.toBe(true);
    expect(sessionPair(res)).not.toBeNull();
  });

  it('requires a signed-in session on every session-bound MFA route', async () => {
    const { api } = makeApp();
    const reqs = [
      api.request('/api/auth/mfa', { headers: jsonHeaders() }),
      api.request('/api/auth/mfa/setup', { method: 'POST', headers: jsonHeaders() }),
      api.request('/api/auth/mfa/enable', {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ code: '123456' }),
      }),
      api.request('/api/auth/mfa/disable', {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ code: '123456' }),
      }),
      api.request('/api/auth/step-up', {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ password: PASSWORD }),
      }),
    ];
    for (const res of await Promise.all(reqs)) expect(res.status).toBe(401);
  });
});

describe('MFA sign-in', () => {
  it('verifies a TOTP challenge into a session', async () => {
    const { api } = makeApp();
    const email = 'signin@example.com';
    const { secret } = await enableMfa(api, await signUp(api, email));
    // A later step, so the code used to enable cannot be mistaken for a replay.
    advance(60_000);

    const challenge = await challengeFor(api, email);
    const res = await verify(api, challenge, totp(secret, clockMs));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const cookie = sessionCookie(res);
    const who = await api.request('/api/auth/session', { headers: { cookie } });
    expect(who.status).toBe(200);
    const body = await who.json() as { user: { email: string } | null };
    expect(body.user?.email).toBe(email);
  });

  it('rejects a replayed TOTP code', async () => {
    const { api } = makeApp();
    const email = 'replay@example.com';
    const { secret } = await enableMfa(api, await signUp(api, email));
    advance(60_000);

    const code = totp(secret, clockMs);
    const first = await verify(api, await challengeFor(api, email), code);
    expect(first.status).toBe(200);
    expect(sessionPair(first)).not.toBeNull();

    // Same clock, same step: the code must not work a second time.
    const again = await verify(api, await challengeFor(api, email), code);
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ error: 'invalid_code' });
    expect(sessionPair(again)).toBeNull();
  });

  it('accepts a recovery code once and counts it down', async () => {
    const { api } = makeApp();
    const email = 'recovery@example.com';
    const { recoveryCodes } = await enableMfa(api, await signUp(api, email));
    advance(60_000);

    const used = recoveryCodes[0]!;
    const first = await verify(api, await challengeFor(api, email), used);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true });
    expect((await mfaStatus(api, sessionCookie(first))).recoveryCodesLeft).toBe(9);

    const reused = await verify(api, await challengeFor(api, email), used);
    expect(reused.status, 'a recovery code is single use').toBe(400);
    expect(await reused.json()).toEqual({ error: 'invalid_code' });
    expect(sessionPair(reused)).toBeNull();

    // Case and dashes are normalised: the second code still works without them.
    const normalised = recoveryCodes[1]!.toUpperCase().replace('-', '');
    const next = await verify(api, await challengeFor(api, email), normalised);
    expect(next.status).toBe(200);
    expect((await mfaStatus(api, sessionCookie(next))).recoveryCodesLeft).toBe(8);
  });

  it('expires a challenge after five minutes', async () => {
    const { api } = makeApp();
    const email = 'expiry@example.com';
    const { secret } = await enableMfa(api, await signUp(api, email));
    advance(60_000);

    // Just inside the window: still verifies.
    const fresh = await challengeFor(api, email);
    advance(CHALLENGE_TTL_MS - 60_000);
    const inside = await verify(api, fresh, totp(secret, clockMs));
    expect(inside.status).toBe(200);

    const stale = await challengeFor(api, email);
    advance(CHALLENGE_TTL_MS + 1_000);
    const expired = await verify(api, stale, totp(secret, clockMs));
    expect(expired.status).toBe(400);
    expect(await expired.json()).toEqual({ error: 'challenge_expired' });
    expect(sessionPair(expired)).toBeNull();
  });

  it('invalidates a challenge after five wrong codes', async () => {
    const { api } = makeApp();
    const email = 'attempts@example.com';
    const { secret } = await enableMfa(api, await signUp(api, email));
    advance(60_000);

    const challenge = await challengeFor(api, email);
    for (let attempt = 1; attempt <= 5; attempt++) {
      const res = await verify(api, challenge, String(attempt).repeat(6));
      expect(res.status, `wrong attempt ${attempt} must be refused`).toBe(400);
    }

    const afterFive = await verify(api, challenge, totp(secret, clockMs));
    expect(afterFive.status, 'the challenge must be dead after five wrong codes').toBe(400);
    expect((await afterFive.json() as { ok?: boolean }).ok).not.toBe(true);
    expect(sessionPair(afterFive)).toBeNull();

    // Per-challenge, not per-account: a fresh challenge still verifies.
    const fresh = await verify(api, await challengeFor(api, email), totp(secret, clockMs));
    expect(fresh.status).toBe(200);
    expect(sessionPair(fresh)).not.toBeNull();
  });

  it('rejects an unknown challenge', async () => {
    const { api } = makeApp();
    const res = await verify(api, ['not', 'a', 'challenge'].join('-'), '123456');
    expect(res.status).toBe(400);
    expect(sessionPair(res)).toBeNull();
  });
});

describe('MFA disable', () => {
  it('disables with a valid TOTP and stops asking at sign-in', async () => {
    const { api } = makeApp();
    const email = 'disable@example.com';
    const enabled = await enableMfa(api, await signUp(api, email));
    advance(60_000);

    const res = await disable(api, enabled.cookie, totp(enabled.secret, clockMs));
    expect(res.status).toBe(200);
    const cookie = rotatedCookie(res, enabled.cookie);

    const status = await mfaStatus(api, cookie);
    expect(status.enabled).toBe(false);
    expect(status.recoveryCodesLeft).toBe(0);

    const signIn = await passwordLogin(api, email);
    expect(signIn.status).toBe(200);
    const body = await signIn.json() as { mfaRequired?: boolean; user?: { email: string } };
    expect(body.mfaRequired).not.toBe(true);
    expect(body.user?.email).toBe(email);
    expect(sessionPair(signIn)).not.toBeNull();
  });

  it('disables with a recovery code', async () => {
    const { api } = makeApp();
    const email = 'disable-recovery@example.com';
    const enabled = await enableMfa(api, await signUp(api, email));
    advance(60_000);

    const res = await disable(api, enabled.cookie, enabled.recoveryCodes[3]!);
    expect(res.status).toBe(200);
    expect((await mfaStatus(api, rotatedCookie(res, enabled.cookie))).enabled).toBe(false);
  });

  it('refuses to disable with a wrong code', async () => {
    const { api } = makeApp();
    const email = 'disable-wrong@example.com';
    const enabled = await enableMfa(api, await signUp(api, email));
    advance(60_000);

    const res = await disable(api, enabled.cookie, wrongCode(totp(enabled.secret, clockMs)));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_code' });
    expect((await mfaStatus(api, enabled.cookie)).enabled).toBe(true);
  });
});

describe('session rotation on MFA changes', () => {
  it('rotates the session and revokes the other sessions when enabling MFA', async () => {
    const { api } = makeApp();
    const email = 'rotate-enable@example.com';
    const first = await signUp(api, email);
    const secondRes = await passwordLogin(api, email);
    expect(secondRes.status).toBe(200);
    const second = sessionCookie(secondRes);

    const before = await api.request('/api/auth/sessions', { headers: { cookie: first } });
    expect((await before.json() as { sessions: unknown[] }).sessions).toHaveLength(2);

    const secret = await setupMfa(api, first);
    const enableRes = await api.request('/api/auth/mfa/enable', {
      method: 'POST',
      headers: jsonHeaders(first),
      body: JSON.stringify({ code: totp(secret, clockMs) }),
    });
    expect(enableRes.status).toBe(200);

    const rotated = sessionCookie(enableRes);
    expect(cookieValue(rotated)).not.toBe(cookieValue(first));
    expect(cookieValue(rotated)).not.toBe(cookieValue(second));

    for (const stale of [first, second]) {
      const res = await api.request('/api/auth/mfa', { headers: { cookie: stale } });
      expect(res.status, 'the old cookie must stop authenticating').toBe(401);
    }

    const list = await api.request('/api/auth/sessions', { headers: { cookie: rotated } });
    expect(list.status).toBe(200);
    expect((await list.json() as { sessions: unknown[] }).sessions).toHaveLength(1);
  });

  it('rotates the session and revokes the other sessions when disabling MFA', async () => {
    const { api } = makeApp();
    const email = 'rotate-disable@example.com';
    const enabled = await enableMfa(api, await signUp(api, email));

    // A second live session for the same user (laptop plus phone): verify a
    // code on a later step to get another cookie.
    advance(60_000);
    const otherRes = await verify(api, await challengeFor(api, email), totp(enabled.secret, clockMs));
    expect(otherRes.status).toBe(200);
    const other = sessionCookie(otherRes);

    advance(60_000);
    const res = await disable(api, enabled.cookie, totp(enabled.secret, clockMs));
    expect(res.status).toBe(200);
    const rotated = sessionCookie(res);
    expect(cookieValue(rotated)).not.toBe(cookieValue(enabled.cookie));

    for (const stale of [enabled.cookie, other]) {
      const check = await api.request('/api/auth/mfa', { headers: { cookie: stale } });
      expect(check.status, 'the old cookie must stop authenticating').toBe(401);
    }
    const list = await api.request('/api/auth/sessions', { headers: { cookie: rotated } });
    expect(list.status).toBe(200);
    expect((await list.json() as { sessions: unknown[] }).sessions).toHaveLength(1);
  });
});

describe('step-up', () => {
  it('grants a ten-minute window to an MFA user with a valid code', async () => {
    const { api } = makeApp();
    const { cookie, secret } = await enableMfa(api, await signUp(api, 'step-up@example.com'));
    advance(60_000);

    const res = await stepUp(api, cookie, { code: totp(secret, clockMs) });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; until: string };
    expect(body.ok).toBe(true);
    expect(Date.parse(body.until)).toBe(clockMs + STEP_UP_MS);
  });

  it('rejects a wrong code for an MFA user', async () => {
    const { api } = makeApp();
    const { cookie, secret } = await enableMfa(api, await signUp(api, 'step-up-wrong@example.com'));
    advance(60_000);

    const res = await stepUp(api, cookie, { code: wrongCode(totp(secret, clockMs)) });
    expect(res.status).toBe(400);
  });

  it('takes the password instead for a user without MFA', async () => {
    const { api } = makeApp();
    const cookie = await signUp(api, 'step-up-password@example.com');

    const ok = await stepUp(api, cookie, { password: PASSWORD });
    expect(ok.status).toBe(200);
    const body = await ok.json() as { ok: boolean; until: string };
    expect(body.ok).toBe(true);
    expect(Date.parse(body.until)).toBe(clockMs + STEP_UP_MS);

    const bad = await stepUp(api, cookie, { password: WRONG_PASSWORD });
    expect([400, 401]).toContain(bad.status);
  });
});
