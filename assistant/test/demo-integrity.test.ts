import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { InMemoryAuthStore } from '../src/server/auth.js';
import { demoSeedCashMinor } from '../src/server/demo-habits.js';
import { InMemoryPersonalFinanceStore } from '../src/server/personal-finance.js';
import { CompositeLedger, PRACTICE_ANTHONY, PracticeLedger } from '../src/server/practice-ledger.js';
import { InMemorySpendLogStore } from '../src/server/spend-log.js';

const START = new Date('2026-11-10T15:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 86_400_000;

type SpendEntry = { note: string | null };

function setup() {
  let current = START;
  const practice = new PracticeLedger();
  const spendLogs = new InMemorySpendLogStore();
  const finance = new InMemoryPersonalFinanceStore();
  const ledger = new CompositeLedger(practice as never, practice, async () => false);
  const app = createApp({
    ledger,
    practice,
    spendLogs,
    personalFinance: finance,
    auth: new InMemoryAuthStore(),
    now: () => current,
  });
  const request = (path: string, method = 'GET', body?: unknown): Promise<Response> =>
    Promise.resolve(app.request(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
  return {
    app,
    practice,
    spendLogs,
    finance,
    request,
    advance: (ms: number) => { current = new Date(current.getTime() + ms); },
    account: async () => {
      const res = await request(`/accounts?id=${PRACTICE_ANTHONY}`);
      expect(res.status).toBe(200);
      return await res.json() as {
        spendEntries: SpendEntry[];
        moneyProfile: { walletCashMinor: number | null };
      };
    },
  };
}

describe('practice demo integrity', () => {
  it('keeps the smoke script off the shared practice ids', () => {
    const source = readFileSync(new URL('../scripts/smoke-api.ts', import.meta.url), 'utf8')
      .replace(/\r\n/g, '\n');
    const writeChecks = source.split(/\n  \{\n/)
      .filter((chunk) => /method:\s*['"](?:POST|PUT|DELETE)['"]/.test(chunk));
    expect(writeChecks.length).toBeGreaterThan(0);
    for (const chunk of writeChecks) {
      expect(chunk).not.toMatch(/PRACTICE_(?:ANTHONY|SAM|JORDAN)/);
    }
    /* Reads may still verify the sample fixture; writes must not name it. */
    expect(source).toContain('demoSeedCashMinor');
  });

  it('keeps demo writes made through the UI for the rest of the day', async () => {
    const api = setup();
    expect((await api.request('/demo/practice', 'POST', {})).status).toBe(200);

    const spend = await api.request(`/accounts/${PRACTICE_ANTHONY}/spends`, 'POST', {
      amountMinor: 2_500,
      category: 'dining',
      note: 'Demo lunch',
    });
    expect(spend.status).toBe(201);
    const finance = await api.request(`/accounts/${PRACTICE_ANTHONY}/finance`, 'PATCH', {
      walletCashMinor: 123_456,
    });
    expect(finance.status).toBe(200);

    api.advance(23 * HOUR);
    const view = await api.account();
    expect(view.spendEntries.some((entry) => entry.note === 'Demo lunch')).toBe(true);
    expect(view.moneyProfile.walletCashMinor).toBe(123_456);
  });

  it('resets the shared demo after 24 hours, then leaves the new seed alone', async () => {
    const api = setup();
    expect((await api.request('/demo/practice', 'POST', {})).status).toBe(200);
    expect((await api.request(`/accounts/${PRACTICE_ANTHONY}/spends`, 'POST', {
      amountMinor: 1_100,
      category: 'dining',
      note: 'Before reset',
    })).status).toBe(201);
    expect((await api.request(`/accounts/${PRACTICE_ANTHONY}/finance`, 'PATCH', {
      walletCashMinor: 123_456,
    })).status).toBe(200);

    api.advance(DAY + HOUR);
    const reset = await api.account();
    expect(reset.moneyProfile.walletCashMinor).toBe(demoSeedCashMinor('anthony'));
    expect(reset.spendEntries.some((entry) => entry.note === 'Before reset')).toBe(false);

    /* A write after the reset survives the next read; the daily timer restarted. */
    expect((await api.request(`/accounts/${PRACTICE_ANTHONY}/spends`, 'POST', {
      amountMinor: 900,
      category: 'dining',
      note: 'After reset',
    })).status).toBe(201);
    api.advance(HOUR);
    const after = await api.account();
    expect(after.spendEntries.some((entry) => entry.note === 'After reset')).toBe(true);
    expect(after.moneyProfile.walletCashMinor).toBe(demoSeedCashMinor('anthony'));
  });
});
