import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, call, isRetrySafe, wakeRetryDelays, wakeTiming } from '../src/web/api.js';

const WAKING = 'The ledger is waking up. Try again in a moment.';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('wakeRetryDelays', () => {
  it('waits less than a minute in total, so a cold Render wake is covered', () => {
    const total = wakeRetryDelays().reduce((sum, ms) => sum + ms, 0);
    expect(total).toBeLessThanOrEqual(40_000);
    expect(total).toBeGreaterThan(20_000);
  });

  it('backs off in ascending order', () => {
    const delays = wakeRetryDelays();
    expect(delays.length).toBeGreaterThan(1);
    for (let i = 1; i < delays.length; i += 1) {
      expect(delays[i]!).toBeGreaterThan(delays[i - 1]!);
    }
  });

  it('hands out a fresh copy so a caller cannot change the schedule', () => {
    const first = wakeRetryDelays();
    first.push(1);
    expect(wakeRetryDelays()).not.toContain(1);
  });
});

describe('isRetrySafe', () => {
  it('treats a request with no init as a GET read', () => {
    expect(isRetrySafe()).toBe(true);
    expect(isRetrySafe({})).toBe(true);
    expect(isRetrySafe({ method: 'get' })).toBe(true);
  });

  it('treats HEAD as safe', () => {
    expect(isRetrySafe({ method: 'HEAD' })).toBe(true);
    expect(isRetrySafe({ method: 'head' })).toBe(true);
  });

  it('refuses a POST with no idempotency key', () => {
    expect(isRetrySafe({ method: 'POST', body: '{}' })).toBe(false);
    expect(isRetrySafe({ method: 'post', headers: { 'Content-Type': 'application/json' } })).toBe(false);
  });

  it('accepts a POST carrying a plain-object idempotency key', () => {
    expect(isRetrySafe({ method: 'POST', headers: { 'Idempotency-Key': 'key-1' } })).toBe(true);
    expect(isRetrySafe({ method: 'POST', headers: { 'idempotency-key': 'key-1' } })).toBe(true);
  });

  it('accepts a POST carrying a Headers instance, case-insensitively', () => {
    const headers = new Headers({ 'idempotency-key': 'key-2' });
    expect(isRetrySafe({ method: 'POST', headers })).toBe(true);
  });

  it('accepts a POST carrying an array of tuples', () => {
    expect(isRetrySafe({ method: 'POST', headers: [['Idempotency-Key', 'key-3']] })).toBe(true);
  });
});

/** The three shapes RequestInit.headers allows, all carrying the same key. */
const HEADER_FORMATS: Array<[string, (key: string) => HeadersInit]> = [
  ['plain object', (key) => ({ 'Idempotency-Key': key })],
  ['array of tuples', (key) => [['Idempotency-Key', key]]],
  ['Headers instance', (key) => new Headers({ 'Idempotency-Key': key })],
];

describe.each(HEADER_FORMATS)('call() with %s headers', (_format, makeHeaders) => {
  it('sends the idempotency key and Content-Type on both attempts', async () => {
    vi.spyOn(wakeTiming, 'sleep').mockResolvedValue(undefined);
    const sent: { key: string | null; contentType: string | null }[] = [];
    let attempt = 0;
    vi.stubGlobal('fetch', async (_path: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      sent.push({ key: headers.get('Idempotency-Key'), contentType: headers.get('Content-Type') });
      attempt += 1;
      return attempt === 1
        ? jsonResponse({ error: WAKING }, 503)
        : jsonResponse({ id: 't1', status: 'COMPLETED' }, 201);
    });

    await call('/api/transfers', {
      method: 'POST',
      headers: makeHeaders('key-abc'),
      body: JSON.stringify({ amountMinor: 100 }),
    });

    expect(sent).toHaveLength(2);
    expect(sent.map((s) => s.key)).toEqual(['key-abc', 'key-abc']);
    expect(sent.map((s) => s.contentType)).toEqual(['application/json', 'application/json']);
  });
});

describe('call() header defaults', () => {
  it('does not overwrite a caller-provided Content-Type', async () => {
    const seen: (string | null)[] = [];
    vi.stubGlobal('fetch', async (_path: string, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get('Content-Type'));
      return jsonResponse({ id: 't1' }, 200);
    });

    await call('/api/transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Idempotency-Key': 'key-xyz' },
      body: '{}',
    });

    expect(seen).toEqual(['application/json; charset=utf-8']);
  });
});

describe('call() while the ledger wakes', () => {
  it('retries the same request after a 503 waking-up and then succeeds', async () => {
    const sleep = vi.spyOn(wakeTiming, 'sleep').mockResolvedValue(undefined);
    const paths: string[] = [];
    vi.stubGlobal('fetch', async (path: string) => {
      paths.push(path);
      return paths.length === 1 ? jsonResponse({ error: WAKING }, 503) : jsonResponse({ live: true }, 200);
    });

    await expect(api.bootstrap()).resolves.toMatchObject({ live: true });
    expect(paths).toEqual(['/api/bootstrap', '/api/bootstrap']);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(wakeRetryDelays()[0]);
  });

  it('keeps the idempotency key across retries', async () => {
    vi.spyOn(wakeTiming, 'sleep').mockResolvedValue(undefined);
    const keys: (string | null)[] = [];
    let attempt = 0;
    vi.stubGlobal('fetch', async (_path: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      keys.push(headers.get('Idempotency-Key'));
      attempt += 1;
      return attempt === 1 ? jsonResponse({ error: WAKING }, 503) : jsonResponse({ id: 't1', status: 'COMPLETED' }, 201);
    });

    await api.transfer({
      sourceAccountId: 'a', destinationAccountId: 'b', amountMinor: 100, currency: 'USD',
    }, 'key-123');
    expect(keys).toEqual(['key-123', 'key-123']);
  });

  it('does not retry a POST that has no idempotency key', async () => {
    const sleep = vi.spyOn(wakeTiming, 'sleep').mockResolvedValue(undefined);
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls += 1;
      return jsonResponse({ error: WAKING }, 503);
    });

    await expect(api.login({ email: 'a@b.c', password: 'pw' })).rejects.toThrow(WAKING);
    expect(calls).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries a POST that carries an idempotency key', async () => {
    const sleep = vi.spyOn(wakeTiming, 'sleep').mockResolvedValue(undefined);
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls += 1;
      return calls === 1 ? jsonResponse({ error: WAKING }, 503) : jsonResponse({ id: 'd1', status: 'COMPLETED' }, 201);
    });

    await expect(api.deposit('acct-1', 500)).resolves.toMatchObject({ id: 'd1' });
    expect(calls).toBe(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('surfaces the error once the delays run out', async () => {
    const sleep = vi.spyOn(wakeTiming, 'sleep').mockResolvedValue(undefined);
    vi.stubGlobal('fetch', async () => jsonResponse({ error: WAKING }, 503));

    await expect(api.bootstrap()).rejects.toThrow(WAKING);
    expect(sleep).toHaveBeenCalledTimes(wakeRetryDelays().length);
  });

  it('does not retry other 503s', async () => {
    const sleep = vi.spyOn(wakeTiming, 'sleep').mockResolvedValue(undefined);
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls += 1;
      return jsonResponse({ error: 'Account creation is temporarily unavailable. Please try again later.' }, 503);
    });

    await expect(api.bootstrap()).rejects.toThrow('Account creation is temporarily unavailable');
    expect(calls).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('wake() swallows a hard failure', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse({ error: 'boom' }, 500));
    await expect(api.wake()).resolves.toEqual({ awake: false });
  });

  it('does not retry an unkeyed POST when the caller mutates its own headers mid-flight', async () => {
    const sleep = vi.spyOn(wakeTiming, 'sleep').mockResolvedValue(undefined);
    /* The retry decision comes from the headers this request actually sent, not
       from the caller's object, which it is free to change at any time. */
    const callerHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    const init: RequestInit = { method: 'POST', headers: callerHeaders, body: '{}' };
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls += 1;
      callerHeaders['Idempotency-Key'] = 'added-after-the-fact';
      return jsonResponse({ error: WAKING }, 503);
    });

    await expect(call('/api/transfers', init)).rejects.toThrow(WAKING);
    expect(calls).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
