import { afterEach, describe, expect, it } from 'vitest';
import { HttpLedgerClient } from '../src/server/ledger.js';

const original = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = original;
});

describe('HttpLedgerClient', () => {
  it('retries a 502 while the ledger wakes, then returns the account', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls < 3) return new Response('bad gateway', { status: 502 });
      return new Response(JSON.stringify({
        id: 'abc', ownerId: 'sam', currency: 'USD', type: 'USER', balanceMinor: 100, createdAt: '2026-01-01T00:00:00Z',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    const account = await new HttpLedgerClient('http://ledger.test', 1_000, 0).getAccount('abc');
    expect(account?.ownerId).toBe('sam');
    expect(calls).toBe(3);
  });
});
