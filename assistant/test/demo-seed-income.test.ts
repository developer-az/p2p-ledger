import { describe, expect, it } from 'vitest';
import { seedDemoHabits } from '../src/server/demo-habits.js';
import { InMemorySpendLogStore } from '../src/server/spend-log.js';
import { InMemoryPersonalFinanceStore } from '../src/server/personal-finance.js';

describe('demo seeding across instances', () => {
  it('adds demo income once even when each instance has its own empty spend logs', async () => {
    const shared = new InMemoryPersonalFinanceStore();
    const id = '01111111-1111-7111-8111-111111111101';
    for (let i = 0; i < 5; i++) await seedDemoHabits(new InMemorySpendLogStore(), shared, id, 'anthony');
    expect(await shared.listIncome(id)).toHaveLength(1);
  });
});
