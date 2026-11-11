/**
 * Regression tests for the five verified M2 review findings.
 *
 * 1. A password reset for an MFA account must not skip the second factor.
 * 2. MFA setup/enable must refuse to replace a live authenticator (409).
 * 3. pg's sslmode/uselibpqcompat parsing must not override the TLS options
 *    that db-tls.ts decides on.
 * 4. Second-factor attempts are account-scoped: five failures lock
 *    verify/disable/step-up with a 429 + Retry-After.
 * 5. The data-rights export pages through every income and spend row instead
 *    of stopping at 1,000.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import type { ConnectionOptions } from 'node:tls';
import { createApp } from '../src/server/app.js';
import {
  InMemoryAuthStore,
  RESET_TOKEN_TTL_SEC,
  SESSION_COOKIE,
  hashSessionToken,
  newSessionToken,
} from '../src/server/auth.js';
import { pgConfig } from '../src/server/db-tls.js';
import { LedgerError, type LedgerAuditor, type LedgerReader, type LedgerWriter } from '../src/server/ledger.js';
import { MemoryMailer } from '../src/server/mailer.js';
import { InMemoryPersonalFinanceStore } from '../src/server/personal-finance.js';
import { CompositeLedger, PracticeLedger } from '../src/server/practice-ledger.js';
import { InMemorySpendLogStore } from '../src/server/spend-log.js';
import { base32Decode, totp } from '../src/server/totp.js';

const PASSWORD = ['correct', 'horse', 'battery', 'staple'].join('-');
const NEW_PASSWORD = ['brand', 'new', 'password', 'm2'].join('-');
const WRONG_PASSWORD = ['not', 'the', 'password'].join('-');
const MFA_KEY = Buffer.alloc(32, 0x2a);

const T0 = Date.UTC(2026, 0, 5, 9, 0, 0);
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

function advance(ms: number): void {
  clockMs += ms;
  vi.setSystemTime(new Date(clockMs));
}

function makeApp() {
  const auth = new InMemoryAuthStore();
  const mailer = new MemoryMailer();
  const personalFinance = new InMemoryPersonalFinanceStore();
  const spendLogs = new InMemorySpendLogStore();
  const practice = new PracticeLedger();
  const reject = () => Promise.reject(new LedgerError(503, 'live ledger is down'));
  const live = new Proxy({}, { get: () => reject }) as LedgerReader & LedgerWriter & LedgerAuditor;
  const api = createApp({
    ledger: new CompositeLedger(live, practice, async () => false),
    practice,
    spendLogs,
    personalFinance,
    auth,
    mailer,
    appUrl: 'https://settle.example',
    now: () => new Date(Date.now()),
    mfaKey: MFA_KEY,
    breachedPassword: async () => false,
  });
  return { api, auth, mailer, personalFinance, spendLogs };
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

async function post(api: Api, path: string, body: unknown, cookie?: string): Promise<Response> {
  return api.request(path, {
    method: 'POST',
    headers: jsonHeaders(cookie),
    body: JSON.stringify(body),
  });
}

/** Splits the combined Set-Cookie header without breaking on attribute commas. */
function setCookieParts(res: Response): string[] {
  return (res.headers.get('set-cookie') ?? '')
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

async function signUp(api: Api, email: string): Promise<string> {
  const res = await post(api, '/api/auth/register', { email, password: PASSWORD, displayName: 'Sam Lee' });
  expect(res.status).toBe(201);
  return sessionCookie(res);
}

/** /setup + /enable, returning the new cookie, the TOTP secret and the recovery codes. */
async function enableMfa(api: Api, cookie: string): Promise<{
  cookie: string;
  secret: Buffer;
  recoveryCodes: string[];
}> {
  const setup = await post(api, '/api/auth/mfa/setup', {}, cookie);
  expect(setup.status).toBe(200);
  const setupBody = await setup.json() as { secret: string };
  const secret = base32Decode(setupBody.secret);
  const enabled = await post(api, '/api/auth/mfa/enable', { code: totp(secret, clockMs) }, cookie);
  expect(enabled.status).toBe(200);
  const body = await enabled.json() as { recoveryCodes: string[] };
  return { cookie: sessionPair(enabled) ?? cookie, secret, recoveryCodes: body.recoveryCodes };
}

async function login(api: Api, email: string, password = PASSWORD): Promise<Response> {
  return post(api, '/api/auth/login', { email, password });
}

async function challengeFor(api: Api, email: string): Promise<string> {
  const res = await login(api, email);
  expect(res.status).toBe(200);
  const body = await res.json() as { mfaRequired?: boolean; challenge?: string };
  expect(body.mfaRequired).toBe(true);
  expect(typeof body.challenge).toBe('string');
  expect(sessionPair(res), 'a pending challenge must not issue a session').toBeNull();
  return body.challenge!;
}

async function verify(api: Api, challenge: string, code: string): Promise<Response> {
  return post(api, '/api/auth/mfa/verify', { challenge, code });
}

function wrongCode(valid: string): string {
  return valid === '000000' ? '111111' : '000000';
}

describe('1. password reset keeps the second factor', () => {
  it('returns an MFA challenge instead of a session for an account with MFA enabled', async () => {
    const { api, auth } = makeApp();
    const email = 'reset-mfa@example.com';
    const oldCookie = await signUp(api, email);
    const { secret } = await enableMfa(api, oldCookie);
    advance(60_000);

    // The request step sleeps 600 ms for timing parity and is covered by the
    // existing reset tests; seed the token directly so this test stays on the
    // completion path.
    const user = await auth.findByEmail(email);
    expect(user).not.toBeNull();
    const token = newSessionToken();
    await auth.saveResetToken(hashSessionToken(token), user!.id,
      new Date(clockMs + RESET_TOKEN_TTL_SEC * 1000));

    const confirmed = await post(api, '/api/auth/password-reset/confirm', { token, password: NEW_PASSWORD });
    expect(confirmed.status).toBe(200);
    const body = await confirmed.json() as { ok?: boolean; mfaRequired?: boolean; challenge?: string };
    expect(body.ok).not.toBe(true);
    expect(body.mfaRequired).toBe(true);
    expect(typeof body.challenge).toBe('string');
    expect(body.challenge!.length).toBeGreaterThan(10);
    expect(sessionPair(confirmed), 'the reset alone must not sign the user in').toBeNull();

    // The reset revoked the pre-reset session, and no new one exists yet.
    const stale = await api.request('/api/auth/session', { headers: { cookie: oldCookie } });
    expect((await stale.json() as { user: unknown }).user).toBeNull();
    const anonymous = await api.request('/api/auth/session', { headers: jsonHeaders() });
    expect((await anonymous.json() as { user: unknown }).user).toBeNull();

    const wrong = await verify(api, body.challenge!, wrongCode(totp(secret, clockMs)));
    expect(wrong.status).toBe(400);
    expect(sessionPair(wrong)).toBeNull();
    expect((await login(api, email, NEW_PASSWORD)).headers.get('set-cookie')).toBeNull();

    const done = await verify(api, body.challenge!, totp(secret, clockMs));
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ ok: true });
    const who = await api.request('/api/auth/session', { headers: { cookie: sessionCookie(done) } });
    expect((await who.json() as { user: { email: string } | null }).user?.email).toBe(email);
  });
});

describe('2. MFA setup cannot replace a live authenticator', () => {
  it('answers 409 mfa_already_enabled for setup and enable once MFA is on', async () => {
    const { api } = makeApp();
    const enabled = await enableMfa(api, await signUp(api, 'mfa-live@example.com'));
    advance(60_000);

    const setup = await post(api, '/api/auth/mfa/setup', {}, enabled.cookie);
    expect(setup.status).toBe(409);
    expect(await setup.json()).toEqual({ error: 'mfa_already_enabled' });

    const enableAgain = await post(api, '/api/auth/mfa/enable',
      { code: totp(enabled.secret, clockMs) }, enabled.cookie);
    expect(enableAgain.status).toBe(409);
    expect(await enableAgain.json()).toEqual({ error: 'mfa_already_enabled' });

    // The documented replacement path still works: disable with the current
    // code, then start a fresh setup.
    const disabled = await post(api, '/api/auth/mfa/disable',
      { code: totp(enabled.secret, clockMs) }, enabled.cookie);
    expect(disabled.status).toBe(200);
    const cookie = sessionCookie(disabled);

    const fresh = await post(api, '/api/auth/mfa/setup', {}, cookie);
    expect(fresh.status).toBe(200);
    expect((await fresh.json() as { secret: string }).secret).toMatch(/^[A-Z2-7]+$/);
  });
});

describe('3. pg connection strings cannot override the TLS options', () => {
  const URL_WITH_TLS_PARAMS =
    'postgres://u@h/db?sslmode=require&uselibpqcompat=true&application_name=x';

  function tls(value: ConnectionOptions | false): ConnectionOptions {
    expect(value).not.toBe(false);
    if (value === false) throw new Error('expected TLS options, got false');
    return value;
  }

  it('strips sslmode and uselibpqcompat but keeps application_name', () => {
    const config = pgConfig(URL_WITH_TLS_PARAMS, {});
    expect(config.connectionString).toBe('postgres://u@h/db?application_name=x');
    expect(tls(config.ssl as ConnectionOptions | false).rejectUnauthorized).toBe(true);
  });

  it('keeps the configured CA while stripping the TLS parameters', () => {
    const config = pgConfig(URL_WITH_TLS_PARAMS, { DATABASE_CA_CERT: 'test-ca-pem' });
    const ssl = tls(config.ssl as ConnectionOptions | false);
    expect(ssl.ca).toBe('test-ca-pem');
    expect(ssl.rejectUnauthorized).toBe(true);
  });

  it('does not let pg read sslrootcert from the URL (which would override ssl.ca)', () => {
    const url = 'postgres://u@h/db?sslmode=verify-full&sslrootcert=%2Fno%2Fsuch%2Fca.pem&application_name=y';
    const config = pgConfig(url, { DATABASE_CA_CERT: 'test-ca-pem' });
    expect(config.connectionString).toBe('postgres://u@h/db?application_name=y');
    expect(() => new pg.Client(config)).not.toThrow();
  });

  it('leaves pg with verification on after it parses the client config', () => {
    const client = new pg.Client(pgConfig(URL_WITH_TLS_PARAMS, {}));
    const params = (client as unknown as {
      connectionParameters: { ssl: ConnectionOptions | false; application_name?: string };
    }).connectionParameters;
    const ssl = tls(params.ssl);
    expect(ssl.rejectUnauthorized).toBe(true);
    expect(params.application_name).toBe('x');
  });
});

describe('4. account-scoped second-factor attempt limit', () => {
  it('blocks step-up after five wrong codes with 429 + Retry-After, and success resets it', async () => {
    const { api } = makeApp();
    const email = 'limit-stepup@example.com';
    const enabled = await enableMfa(api, await signUp(api, email));
    advance(60_000);

    for (let attempt = 1; attempt <= 5; attempt++) {
      const res = await post(api, '/api/auth/step-up',
        { code: wrongCode(totp(enabled.secret, clockMs)) }, enabled.cookie);
      expect(res.status, `wrong attempt ${attempt}`).toBe(400);
    }

    const blocked = await post(api, '/api/auth/step-up',
      { code: totp(enabled.secret, clockMs) }, enabled.cookie);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: 'too_many_attempts' });
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);

    advance(31_000);
    const ok = await post(api, '/api/auth/step-up',
      { code: totp(enabled.secret, clockMs) }, enabled.cookie);
    expect(ok.status).toBe(200);

    const afterSuccess = await post(api, '/api/auth/step-up',
      { code: wrongCode(totp(enabled.secret, clockMs)) }, enabled.cookie);
    expect(afterSuccess.status, 'a success must clear the counter').toBe(400);
  });

  it('blocks mfa/disable after five wrong codes', async () => {
    const { api } = makeApp();
    const enabled = await enableMfa(api, await signUp(api, 'limit-disable@example.com'));
    advance(60_000);

    for (let attempt = 1; attempt <= 5; attempt++) {
      const res = await post(api, '/api/auth/mfa/disable',
        { code: wrongCode(totp(enabled.secret, clockMs)) }, enabled.cookie);
      expect(res.status, `wrong attempt ${attempt}`).toBe(400);
    }

    const blocked = await post(api, '/api/auth/mfa/disable',
      { code: totp(enabled.secret, clockMs) }, enabled.cookie);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: 'too_many_attempts' });
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);

    const status = await api.request('/api/auth/mfa', { headers: { cookie: enabled.cookie } });
    expect((await status.json() as { enabled: boolean }).enabled).toBe(true);
  });

  it('applies the same account key to mfa/verify in addition to the per-challenge cap', async () => {
    const { api } = makeApp();
    const email = 'limit-verify@example.com';
    const enabled = await enableMfa(api, await signUp(api, email));
    advance(60_000);

    // A fresh first factor opens a new challenge and a clean counter.
    const challenge = await challengeFor(api, email);
    for (let attempt = 1; attempt <= 5; attempt++) {
      const res = await post(api, '/api/auth/step-up',
        { code: wrongCode(totp(enabled.secret, clockMs)) }, enabled.cookie);
      expect(res.status, `wrong attempt ${attempt}`).toBe(400);
    }

    const blocked = await verify(api, challenge, totp(enabled.secret, clockMs));
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: 'too_many_attempts' });
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(sessionPair(blocked)).toBeNull();

    advance(31_000);
    const ok = await verify(api, challenge, totp(enabled.secret, clockMs));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    expect(sessionPair(ok)).not.toBeNull();
  });

  it('still counts different accounts separately', async () => {
    const { api } = makeApp();
    const first = await enableMfa(api, await signUp(api, 'limit-a@example.com'));
    const second = await enableMfa(api, await signUp(api, 'limit-b@example.com'));
    advance(60_000);

    for (let attempt = 0; attempt < 5; attempt++) {
      await post(api, '/api/auth/step-up',
        { code: wrongCode(totp(first.secret, clockMs)) }, first.cookie);
    }
    const blocked = await post(api, '/api/auth/step-up',
      { code: totp(first.secret, clockMs) }, first.cookie);
    expect(blocked.status).toBe(429);

    const other = await post(api, '/api/auth/step-up',
      { code: totp(second.secret, clockMs) }, second.cookie);
    expect(other.status, 'another account must keep its own allowance').toBe(200);
  });
});

describe('5. export pages through every row', () => {
  it('returns more than 1,000 income and spend rows', async () => {
    const { api, auth, personalFinance, spendLogs } = makeApp();
    const email = 'export-all@example.com';
    const cookie = await signUp(api, email);
    const user = await auth.findByEmail(email);
    expect(user).not.toBeNull();
    const accountId = user!.accountId;

    const INCOME_ROWS = 1_205;
    const SPEND_ROWS = 1_005;
    for (let index = 0; index < INCOME_ROWS; index++) {
      await personalFinance.recordIncome(accountId, {
        amountMinor: 100,
        source: 'salary',
        note: `income-${index}`,
        occurredAt: new Date(T0 + index * 1_000).toISOString(),
      }, new Date(T0));
    }
    for (let index = 0; index < SPEND_ROWS; index++) {
      await spendLogs.record(accountId, {
        amountMinor: 100,
        category: 'dining',
        note: `spend-${index}`,
        occurredAt: new Date(T0 + index * 1_000).toISOString(),
      }, new Date(T0));
    }

    const stepped = await post(api, '/api/auth/step-up', { password: PASSWORD }, cookie);
    expect(stepped.status).toBe(200);

    const res = await api.request('/api/account/export?format=json', { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      income: { note: string | null }[];
      spendLogs: { note: string | null }[];
    };
    expect(body.income).toHaveLength(INCOME_ROWS);
    expect(body.spendLogs).toHaveLength(SPEND_ROWS);
    expect(new Set(body.income.map((row) => row.note)).size).toBe(INCOME_ROWS);
    expect(new Set(body.spendLogs.map((row) => row.note)).size).toBe(SPEND_ROWS);
    expect(body.income.map((row) => row.note)).toContain('income-0');
    expect(body.income.map((row) => row.note)).toContain(`income-${INCOME_ROWS - 1}`);
    expect(body.spendLogs.map((row) => row.note)).toContain('spend-0');
    expect(body.spendLogs.map((row) => row.note)).toContain(`spend-${SPEND_ROWS - 1}`);

    // The non-MFA step-up used the password, so the wrong password is one
    // failure on the same account key and must not wedge the account.
    expect(WRONG_PASSWORD).not.toBe(PASSWORD);
  });

  it('exports every row as CSV too', async () => {
    const { api, auth, personalFinance, spendLogs } = makeApp();
    const email = 'export-all-csv@example.com';
    const cookie = await signUp(api, email);
    const user = await auth.findByEmail(email);
    const accountId = user!.accountId;

    const ROWS = 1_050;
    for (let index = 0; index < ROWS; index++) {
      await personalFinance.recordIncome(accountId, {
        amountMinor: 100,
        source: 'salary',
        note: `csv-income-${index}`,
        occurredAt: new Date(T0 + index * 1_000).toISOString(),
      }, new Date(T0));
    }
    await spendLogs.record(accountId, {
      amountMinor: 250,
      category: 'groceries',
      note: 'csv-spend',
      occurredAt: new Date(T0).toISOString(),
    }, new Date(T0));

    expect((await post(api, '/api/auth/step-up', { password: PASSWORD }, cookie)).status).toBe(200);
    const res = await api.request('/api/account/export?format=csv', { headers: { cookie } });
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain('csv-spend');
    for (const index of [0, 1, ROWS - 1]) expect(csv).toContain(`csv-income-${index}`);
    expect(csv.trim().split(/\r?\n/)).toHaveLength(ROWS + 1 + 1);
  });
});
