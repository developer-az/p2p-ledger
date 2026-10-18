import { describe, expect, it } from 'vitest';
import { seedDemoHabits } from '../src/server/demo-habits.js';
import { InMemoryPersonalFinanceStore } from '../src/server/personal-finance.js';
import { InMemorySpendLogStore } from '../src/server/spend-log.js';

const ACCOUNT = '00000000-0000-4000-8000-0000000000aa';

describe('demo habits', () => {
  it('gives a demo wallet a personal history and a weekly pace', async () => {
    const spends = new InMemorySpendLogStore();
    const finance = new InMemoryPersonalFinanceStore();
    const seeded = await seedDemoHabits(spends, finance, ACCOUNT, 'alex', new Date('2026-10-18T18:00:00Z'));
    expect(seeded).toBe(true);

    const profile = await finance.getProfile(ACCOUNT, 'USD');
    expect(profile.walletCashMinor).toBe(320_000);
    expect(profile.creditOwedMinor).toBe(45_000);
    expect(profile.weeklyBudgetMinor).toBe(45_000);

    const entries = await spends.list(ACCOUNT, { limit: 100 });
    expect(entries.length).toBeGreaterThan(20);
    expect(entries[0]?.category).toBe('dining');
    expect(entries.some((entry) => entry.category === 'housing')).toBe(true);
  });

  it('does not overwrite a wallet that already has logs', async () => {
    const spends = new InMemorySpendLogStore();
    const finance = new InMemoryPersonalFinanceStore();
    await seedDemoHabits(spends, finance, ACCOUNT, 'sam', new Date('2026-10-18T18:00:00Z'));
    const second = await seedDemoHabits(spends, finance, ACCOUNT, 'sam', new Date('2026-10-18T18:00:00Z'));
    expect(second).toBe(false);
    expect((await spends.list(ACCOUNT, { limit: 100 })).length).toBe(12);
  });
});
