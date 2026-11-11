/**
 * Acceptance tests for step 2.3 — breached-password check (HIBP k-anonymity).
 *
 * Expected to fail until `src/server/breached-password.ts` exists and
 * `createApp` accepts the `breachedPassword` option.
 *
 * Contract under test:
 *   isBreachedPassword(password, fetchImpl = fetch): Promise<boolean>
 *     - SHA-1 the password (UTF-8), uppercase hex
 *     - GET https://api.pwnedpasswords.com/range/<first 5 hex chars>
 *       with header `Add-Padding: true`; nothing else about the password leaves
 *     - match the remaining 35-char suffix in `SUFFIX:COUNT` lines;
 *       a matching line with count 0 is padding, not a breach
 *     - network error, non-200 or the 2 s timeout => false (fail-open), never throws
 *
 * No test here touches the network: the module tests inject a fake fetch and
 * the app tests inject `breachedPassword`, with a guard that fails if anything
 * reaches the global `fetch`.
 */

import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isBreachedPassword } from '../src/server/breached-password.js';
import { createApp } from '../src/server/app.js';
import { InMemoryAuthStore } from '../src/server/auth.js';
import { MemoryMailer } from '../src/server/mailer.js';
import { CompositeLedger, PracticeLedger } from '../src/server/practice-ledger.js';
import { InMemorySpendLogStore } from '../src/server/spend-log.js';
import { LedgerError, type LedgerAuditor, type LedgerReader, type LedgerWriter } from '../src/server/ledger.js';

const sha1Upper = (password: string): string => createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();

type RecordedCall = { url: string; init: RequestInit | undefined };

/** Fake range API: answers with `body` and records what was asked for. */
function fakeFetch(body: string, opts: { status?: number } = {}) {
  const calls: RecordedCall[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      init,
    });
    return new Response(body, { status: opts.status ?? 200 });
  }) as typeof fetch;
  return { impl, calls };
}

/** A fetch that behaves like the real one: it settles only when aborted. */
const hangingFetch = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
  const abort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
  if (init?.signal?.aborted) abort();
  else init?.signal?.addEventListener('abort', abort);
})) as typeof fetch;

describe('isBreachedPassword k-anonymity', () => {
  it('sends only the 5-char hash prefix and never the hash suffix or the password', async () => {
    const password = 'correct-horse-battery-staple';
    const hash = sha1Upper(password);
    expect(hash).toMatch(/^[0-9A-F]{40}$/);

    const { impl, calls } = fakeFetch(`${hash.slice(5)}:4\r\n`);
    expect(await isBreachedPassword(password, impl)).toBe(true);

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    const url = new URL(call.url);
    expect(url.origin).toBe('https://api.pwnedpasswords.com');
    expect(url.pathname).toBe(`/range/${hash.slice(0, 5)}`);
    expect(url.pathname.slice('/range/'.length)).toMatch(/^[0-9A-F]{5}$/);

    // Nothing identifying may appear anywhere in the request.
    expect(call.url.toUpperCase()).not.toContain(hash.slice(5));
    expect(call.url).not.toContain(hash);
    expect(call.url).not.toContain(password);
    expect(JSON.stringify(call.init ?? {})).not.toContain(password);
    expect(JSON.stringify(call.init ?? {})).not.toContain(hash);

    expect(new Headers(call.init?.headers).get('add-padding')).toBe('true');
  });

  it('matches the 35-char suffix among padded lines and ignores a count of 0', async () => {
    const password = 'hunter2-hunter2';
    const suffix = sha1Upper(password).slice(5);
    expect(suffix).toHaveLength(35);

    const body = [
      '0018A45C4D1DEF81644B54AB7F969B88D65:0',
      '00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2',
      `${suffix}:7`,
      '00000000000000000000000000000000000:0',
    ].join('\r\n');
    const hit = fakeFetch(body);
    expect(await isBreachedPassword(password, hit.impl)).toBe(true);

    // Same suffix, count 0: that line is padding, the password is not breached.
    const padded = fakeFetch(`${suffix}:0\r\n0018A45C4D1DEF81644B54AB7F969B88D65:0`);
    expect(await isBreachedPassword(password, padded.impl)).toBe(false);

    // A different suffix with a real count is not a match.
    const other = fakeFetch('0018A45C4D1DEF81644B54AB7F969B88D65:9');
    expect(await isBreachedPassword(password, other.impl)).toBe(false);
  });

  it('fails open (false, no throw) when the request cannot be made', async () => {
    const offline = (async () => {
      throw new Error('getaddrinfo ENOTFOUND api.pwnedpasswords.com');
    }) as typeof fetch;
    await expect(isBreachedPassword('some-password-here', offline)).resolves.toBe(false);

    const unavailable = fakeFetch('anything:1', { status: 503 });
    await expect(isBreachedPassword('some-password-here', unavailable.impl)).resolves.toBe(false);

    const forbidden = fakeFetch('anything:1', { status: 403 });
    await expect(isBreachedPassword('some-password-here', forbidden.impl)).resolves.toBe(false);
  });

  it('gives up after about 2 seconds with false instead of hanging', async () => {
    const started = Date.now();
    await expect(isBreachedPassword('slow-password-here', hangingFetch)).resolves.toBe(false);
    const elapsed = Date.now() - started;
    expect(elapsed, 'the range lookup must time out at 2 s').toBeGreaterThanOrEqual(1_800);
    expect(elapsed).toBeLessThan(4_000);
  }, 10_000);
});

const BREACHED = 'breached-password-123';
const CLEAN = 'a-fine-unique-password';
const PASSWORD = 'correct-horse-battery';

let networkCalls = 0;

beforeEach(() => {
  networkCalls = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    networkCalls += 1;
    throw new Error('network disabled in tests');
  });
});

afterEach(() => {
  expect(networkCalls, 'these tests must never reach the real network').toBe(0);
  vi.restoreAllMocks();
});

function makeApp(breachedPassword: (password: string) => Promise<boolean>) {
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
    breachedPassword,
  };
  // `breachedPassword` is a new createApp option that does not exist yet; the
  // cast keeps tsc reporting only the missing-module errors.
  const api = createApp(deps as Parameters<typeof createApp>[0]);
  return { api, auth, mailer };
}

type Api = ReturnType<typeof makeApp>['api'];

let ipCounter = 10;
async function post(api: Api, path: string, body: unknown): Promise<Response> {
  return await api.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${ipCounter++}` },
    body: JSON.stringify(body),
  });
}

const tokenFrom = (text: string): string => /#token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? '';

describe('sign-up with a breached password', () => {
  it('refuses with 400 {error:breached_password} and creates no account', async () => {
    const seen: string[] = [];
    const { api, auth } = makeApp(async (password) => {
      seen.push(password);
      return password === BREACHED;
    });

    const res = await post(api, '/api/auth/register',
      { email: 'breach@example.com', password: BREACHED, displayName: 'Sam Lee' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'breached_password' });
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(seen).toEqual([BREACHED]);
    expect(await auth.findByEmail('breach@example.com')).toBeNull();
  });

  it('proceeds with 201 when the check says the password is not breached', async () => {
    const { api, auth } = makeApp(async (password) => password === BREACHED);

    const res = await post(api, '/api/auth/register',
      { email: 'clean@example.com', password: CLEAN, displayName: 'Sam Lee' });
    expect(res.status).toBe(201);
    expect(res.headers.get('set-cookie')).toBeTruthy();
    expect(await auth.findByEmail('clean@example.com')).not.toBeNull();
  });
});

describe('password reset with a breached password', () => {
  async function registeredWithResetToken(api: Api, mailer: MemoryMailer, email: string) {
    const created = await post(api, '/api/auth/register', { email, password: PASSWORD, displayName: 'Sam Lee' });
    expect(created.status).toBe(201);
    const requested = await post(api, '/api/auth/password-reset/request', { email });
    expect(requested.status).toBe(202);
    const token = tokenFrom(mailer.sent.at(-1)?.text ?? '');
    expect(token.length).toBeGreaterThan(20);
    return token;
  }

  it('refuses with 400 {error:breached_password} and leaves the old password working', async () => {
    const { api, mailer } = makeApp(async (password) => password === BREACHED);
    const token = await registeredWithResetToken(api, mailer, 'reset-breach@example.com');

    const res = await post(api, '/api/auth/password-reset/confirm', { token, password: BREACHED });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'breached_password' });
    expect(res.headers.get('set-cookie')).toBeNull();

    // The reset was refused before it changed anything.
    expect((await post(api, '/api/auth/login', { email: 'reset-breach@example.com', password: PASSWORD })).status).toBe(200);
  });

  it('completes when the check says the password is not breached', async () => {
    const { api, mailer } = makeApp(async (password) => password === BREACHED);
    const token = await registeredWithResetToken(api, mailer, 'reset-clean@example.com');

    const res = await post(api, '/api/auth/password-reset/confirm', { token, password: CLEAN });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeTruthy();

    expect((await post(api, '/api/auth/login', { email: 'reset-clean@example.com', password: CLEAN })).status).toBe(200);
    expect((await post(api, '/api/auth/login', { email: 'reset-clean@example.com', password: PASSWORD })).status).toBe(401);
  });
});
