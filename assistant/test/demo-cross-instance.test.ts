import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { InMemoryAuthStore } from '../src/server/auth.js';
import { CompositeLedger, PRACTICE_ANTHONY, PracticeLedger } from '../src/server/practice-ledger.js';
import { InMemorySpendLogStore } from '../src/server/spend-log.js';

const NOW = new Date('2026-11-10T15:00:00.000Z');

/** One serverless instance: its own memory, nothing shared with any other instance. */
function instance() {
  const practice = new PracticeLedger();
  return createApp({
    ledger: new CompositeLedger(practice as never, practice, async () => false),
    practice,
    spendLogs: new InMemorySpendLogStore(),
    auth: new InMemoryAuthStore(),
    now: () => NOW,
  });
}

type View = {
  patterns: { categories: { totalMinor: number }[]; totals: unknown };
  habits: unknown;
};

async function view(api: ReturnType<typeof instance>, id = PRACTICE_ANTHONY): Promise<View> {
  const res = await api.request(`/api/accounts?id=${id}`);
  expect(res.status).toBe(200);
  return await res.json() as View;
}

describe('practice demo does not depend on which instance served the seed request', () => {
  it('a cold instance that never saw POST /demo/practice still returns the demo history', async () => {
    const a = instance();
    const b = instance();
    expect((await a.request('/api/demo/practice', { method: 'POST' })).status).toBe(200);

    const onA = await view(a);
    const onB = await view(b);

    expect(onA.patterns.categories.length).toBeGreaterThan(0);
    expect(onB.patterns.categories.length).toBeGreaterThan(0);
    expect(onB.patterns.categories).toEqual(onA.patterns.categories);
    expect(onB.patterns.totals).toEqual(onA.patterns.totals);
  });

  it('reading twice does not seed twice', async () => {
    const b = instance();
    const first = await view(b);
    const second = await view(b);
    expect(second.patterns.categories).toEqual(first.patterns.categories);
    expect(second.patterns.totals).toEqual(first.patterns.totals);
  });

  it('an explicit seed after a lazy seed does not duplicate history', async () => {
    const b = instance();
    const lazy = await view(b);
    expect((await b.request('/api/demo/practice', { method: 'POST' })).status).toBe(200);
    const after = await view(b);
    expect(after.patterns.totals).toEqual(lazy.patterns.totals);
  });
});
