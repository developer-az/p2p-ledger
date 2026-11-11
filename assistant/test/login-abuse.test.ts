/**
 * Acceptance tests for step 2.3 — login abuse controls.
 *
 * These encode the target behaviour and are expected to fail until
 * `src/server/login-throttle.ts` exists and `createApp` wires it in.
 *
 * SIGN-UP ENUMERATION DECISION (read from the current code, 2026-11):
 * The app signs a new user in inside `POST /api/auth/register` (201 plus the
 * session cookie), so the two options in the brief do not both fit:
 *   - returning the 201 shape for an existing email would have to hand out
 *     account data (or invent it), and
 *   - a *new* email can only answer 201 or the 503 provisioning failure on that
 *     path, so the generic 400 {error:'signup_failed'} would itself be the
 *     enumeration oracle — and `test/auth.test.ts` pins 409 for the duplicate.
 * The strictest option that keeps the existing suite green is therefore:
 *   duplicate sign-up => 409 with the constant body {error:'signup_failed'},
 *   no session cookie, and no echo of the submitted email or display name.
 * That drops the descriptive "an account with that email already exists" body
 * (the real enumeration hint in a response) and pins the body to a constant, so
 * a future edit cannot reintroduce the wording. The remaining oracle is the
 * status code itself; removing it needs an "always 202, confirm by email"
 * sign-up design, which is out of scope for step 2.3.
 *
 * Password reset is asserted exactly as specified: identical status AND body
 * for known and unknown emails.
 *
 * Time: the app clock (`createApp({ now })`) and `Date` are driven together so
 * the tests pass whether the throttle reads the injected clock or `Date.now()`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/server/app.js';
import { InMemoryAuthStore } from '../src/server/auth.js';
import { backoffSeconds, LoginThrottle } from '../src/server/login-throttle.js';
import { MemoryMailer } from '../src/server/mailer.js';
import { CompositeLedger, PracticeLedger } from '../src/server/practice-ledger.js';
import { InMemorySpendLogStore } from '../src/server/spend-log.js';
import { LedgerError, type LedgerAuditor, type LedgerReader, type LedgerWriter } from '../src/server/ledger.js';
const WRONG_PASSWORD = ['not', 'the', 'password'].join('-');
const testIp = (n: number) => `198.51.100.${n}`;

const T0 = Date.UTC(2026, 0, 5, 9, 0, 0);
let clockMs = T0;

/** Moves both `Date` (fake-timer Date only) and the app clock. */
function setClock(secondsFromT0: number): void {
  clockMs = T0 + secondsFromT0 * 1000;
  vi.setSystemTime(new Date(clockMs));
}

beforeEach(() => {
  setClock(0);
});

afterEach(() => {
  vi.useRealTimers();
});

const PASSWORD = 'correct-horse-battery';

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
    // Both clocks matter: `now` is what the app should thread into the
    // throttle, `Date` is what a shortcut implementation would read.
    now: () => new Date(Date.now()),
    // Keep tests off the network (step 2.3 breached-password option).
    breachedPassword: async () => false,
  };
  // `breachedPassword` is a new createApp option that does not exist yet; the
  // cast keeps tsc reporting only the missing-module error.
  const api = createApp(deps as Parameters<typeof createApp>[0]);
  return { api, auth, mailer };
}

async function post(
  api: ReturnType<typeof makeApp>['api'],
  path: string,
  body: unknown,
  ip = '203.0.113.10',
  extra: Record<string, string> = {},
): Promise<Response> {
  return await api.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...extra },
    body: JSON.stringify(body),
  });
}

async function register(
  api: ReturnType<typeof makeApp>['api'],
  email: string,
  ip = '203.0.113.10',
): Promise<Response> {
  const res = await post(api, '/api/auth/register', { email, password: PASSWORD, displayName: 'Sam Lee' }, ip);
  expect(res.status).toBe(201);
  return res;
}

const login = (
  api: ReturnType<typeof makeApp>['api'],
  email: string,
  password: string,
  ip = '203.0.113.10',
) => post(api, '/api/auth/login', { email, password }, ip);

describe('backoffSeconds', () => {
  it('follows the published curve: 0-4 free, 30 s from the fifth failure, doubling, capped at 15 min', () => {
    expect([0, 1, 2, 3, 4].map(backoffSeconds)).toEqual([0, 0, 0, 0, 0]);
    expect(backoffSeconds(5)).toBe(30);
    expect(backoffSeconds(6)).toBe(60);
    expect(backoffSeconds(7)).toBe(120);
    expect(backoffSeconds(8)).toBe(240);
    expect(backoffSeconds(9)).toBe(480);
    expect(backoffSeconds(10)).toBe(900);
    expect(backoffSeconds(11)).toBe(900);
    expect(backoffSeconds(50)).toBe(900);
  });
});

describe('LoginThrottle', () => {
  it('blocks a key after five failures with a 30 s wait and frees it after 30 s', () => {
    setClock(0);
    const throttle = new LoginThrottle({ now: () => Date.now() });
    for (let failure = 0; failure < 5; failure++) throttle.fail('acct:sam@example.com');

    expect(throttle.check('acct:sam@example.com')).toEqual({ allowed: false, retryAfterSec: 30 });
    // Keys are independent: another account is untouched.
    expect(throttle.check('acct:other@example.com')).toMatchObject({ allowed: true, retryAfterSec: 0 });

    setClock(29);
    expect(throttle.check('acct:sam@example.com').allowed).toBe(false);

    setClock(30);
    expect(throttle.check('acct:sam@example.com')).toMatchObject({ allowed: true, retryAfterSec: 0 });
  });

  it('escalates on further failures instead of starting over (only succeed() resets)', () => {
    setClock(0);
    const throttle = new LoginThrottle({ now: () => Date.now() });
    for (let failure = 0; failure < 5; failure++) throttle.fail('ip:203.0.113.10');

    setClock(30);
    expect(throttle.check('ip:203.0.113.10').allowed).toBe(true);

    // Sixth failure in total, so the wait doubles even though a window elapsed:
    // otherwise an attacker just waits out each 30 s coupon.
    throttle.fail('ip:203.0.113.10');
    const verdict = throttle.check('ip:203.0.113.10');
    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfterSec).toBe(60);
  });

  it('succeed() clears the failure count, and check() never counts as a failure', () => {
    setClock(0);
    const throttle = new LoginThrottle({ now: () => Date.now() });

    for (let failure = 0; failure < 4; failure++) throttle.fail('acct:sam@example.com');
    for (let read = 0; read < 20; read++) {
      expect(throttle.check('acct:sam@example.com').allowed).toBe(true);
    }

    throttle.succeed('acct:sam@example.com');
    for (let failure = 0; failure < 4; failure++) throttle.fail('acct:sam@example.com');
    expect(throttle.check('acct:sam@example.com').allowed).toBe(true);

    // The fifth failure after the reset starts at the bottom of the curve (30),
    // not at the nine failures accumulated before it (480).
    throttle.fail('acct:sam@example.com');
    expect(throttle.check('acct:sam@example.com')).toEqual({ allowed: false, retryAfterSec: 30 });

    // And a success clears a lockout outright.
    throttle.succeed('acct:sam@example.com');
    expect(throttle.check('acct:sam@example.com').allowed).toBe(true);
  });
});

describe('account lockout through the API', () => {
  it('locks the email after five wrong passwords, even for the right one, then frees it after 30 s', async () => {
    const { api } = makeApp();
    await register(api, 'target@example.com');

    // Case is normalised: 'acct:<lower-cased email>' is one bucket.
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await login(api, attempt % 2 ? 'Target@Example.com' : 'target@example.com', WRONG_PASSWORD);
      expect(res.status, `wrong attempt ${attempt + 1} must be a plain 401`).toBe(401);
    }

    const blocked = await login(api, 'target@example.com', PASSWORD);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: 'too_many_attempts' });
    const retryAfter = blocked.headers.get('retry-after');
    expect(retryAfter, 'the 429 must carry Retry-After').toBeTruthy();
    expect(Number.isInteger(Number(retryAfter))).toBe(true);
    // The clock is frozen at the sixth attempt, so this is the first step of the curve.
    expect(Number(retryAfter)).toBe(30);
    expect(blocked.headers.get('set-cookie')).toBeNull();

    // Another account from another address is not affected by this lockout.
    await register(api, 'bystander@example.com', '198.51.100.20');
    expect((await login(api, 'bystander@example.com', PASSWORD, '198.51.100.20')).status).toBe(200);

    setClock(30);
    expect((await login(api, 'target@example.com', PASSWORD)).status).toBe(200);
  });

  it('does not lock an email that gets a correct password in between', async () => {
    const { api } = makeApp();
    await register(api, 'forgetful@example.com');

    for (let attempt = 0; attempt < 3; attempt++) {
      expect((await login(api, 'forgetful@example.com', WRONG_PASSWORD)).status).toBe(401);
    }
    expect((await login(api, 'forgetful@example.com', PASSWORD)).status).toBe(200);
    // The success reset the counter: three more wrong guesses are still plain
    // 401s, where three failures on top of the previous three would have
    // crossed the five-failure threshold.
    for (let attempt = 0; attempt < 3; attempt++) {
      expect((await login(api, 'forgetful@example.com', WRONG_PASSWORD)).status).toBe(401);
    }
  });

  it('trips the per-IP key after 20 failures spread across different emails', async () => {
    const { api } = makeApp();
    await register(api, 'real@example.com', '198.51.100.30');

    // Same first x-forwarded-for entry, different second hops: one IP bucket.
    for (let attempt = 0; attempt < 20; attempt++) {
      const res = await login(api, `stuffer-${attempt}@example.com`, 'wrong-password', `203.0.113.66, 10.0.0.${attempt}`);
      expect(res.status, `unknown-email attempt ${attempt + 1} must be a plain 401`).toBe(401);
    }

    const blocked = await login(api, 'real@example.com', PASSWORD, '203.0.113.66, 10.9.9.9');
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: 'too_many_attempts' });
    const retryAfter = Number(blocked.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThanOrEqual(30);
    expect(retryAfter).toBeLessThanOrEqual(900);

    // Only the offending address: a different first hop still signs in.
    expect((await login(api, 'real@example.com', PASSWORD, '192.0.2.7, 10.0.0.1')).status).toBe(200);
  });
});

describe('no enumeration on sign-in', () => {
  it('returns the identical 401 and body for a wrong password and an unknown email', async () => {
    const { api } = makeApp();
    await register(api, 'known@example.com');

    const wrongPassword = await login(api, 'known@example.com', WRONG_PASSWORD, testIp(40));
    const unknownEmail = await login(api, 'nobody@example.com', WRONG_PASSWORD, testIp(41));
    const unknownWithKnownPassword = await login(api, 'nobody@example.com', PASSWORD, '198.51.100.42');

    const wrongBody = await wrongPassword.text();
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(unknownWithKnownPassword.status).toBe(401);
    expect(await unknownEmail.text()).toBe(wrongBody);
    expect(await unknownWithKnownPassword.text()).toBe(wrongBody);
    expect(JSON.parse(wrongBody)).toEqual({ error: 'Email or password is incorrect.' });
    for (const res of [wrongPassword, unknownEmail, unknownWithKnownPassword]) {
      expect(res.headers.get('set-cookie')).toBeNull();
    }
  });

  it('answers password-reset requests identically for known and unknown emails', async () => {
    const { api, mailer } = makeApp();
    await register(api, 'recover@example.com');

    const known = await post(api, '/api/auth/password-reset/request', { email: 'Recover@Example.com' }, '198.51.100.50');
    const unknown = await post(api, '/api/auth/password-reset/request', { email: 'nobody@example.com' }, '198.51.100.51');

    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    const knownBody = await known.text();
    expect(await unknown.text()).toBe(knownBody);
    expect(JSON.parse(knownBody)).toMatchObject({ ok: true });
    expect(known.headers.get('set-cookie')).toBeNull();
    expect(unknown.headers.get('set-cookie')).toBeNull();
    // Only the real account is mailed; the response does not say so.
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe('recover@example.com');
  });
});

describe('no enumeration on sign-up', () => {
  it('answers a duplicate email with the constant generic body and no account data', async () => {
    const { api } = makeApp();
    const created = await register(api, 'taken@example.com');
    const createdBody = await created.json() as { user: { email: string }; account: { id: string } };
    expect(createdBody.user.email).toBe('taken@example.com');
    expect(created.headers.get('set-cookie')).toBeTruthy();

    const duplicate = await post(api, '/api/auth/register', { email: 'taken@example.com', password: PASSWORD, displayName: 'Sam Lee' });
    // 409 is pinned by test/auth.test.ts; the body must not describe the account.
    expect(duplicate.status).toBe(409);
    const duplicateBody = await duplicate.text();
    expect(JSON.parse(duplicateBody)).toEqual({ error: 'signup_failed' });
    expect(duplicate.headers.get('set-cookie')).toBeNull();

    // Same constant body for a different display name and password: the reply
    // carries nothing about the existing account.
    const duplicateAgain = await post(api, '/api/auth/register', {
      email: 'TAKEN@example.com', password: 'another-password', displayName: 'Someone Else',
    });
    expect(duplicateAgain.status).toBe(409);
    const duplicateAgainBody = await duplicateAgain.text();
    expect(duplicateAgainBody).toBe(duplicateBody);
    expect(duplicateAgainBody).not.toContain('taken@example.com');
    expect(duplicateAgainBody).not.toContain('Someone Else');

    // The original account is untouched by the duplicate attempts.
    expect((await login(api, 'taken@example.com', PASSWORD, '198.51.100.60')).status).toBe(200);
  });
});
