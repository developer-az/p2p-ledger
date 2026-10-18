import { describe, expect, it } from 'vitest';
import { buildSpendingPatterns } from '../src/server/spending-patterns.js';
import { fixtureSpendEntries } from '../evals/spend-fixture.js';
import type { IncomeLogEntry } from '../src/server/personal-finance.js';

const NOW = new Date('2026-10-08T12:00:00Z');

function income(amountMinor: number, occurredAt: string): IncomeLogEntry {
  return {
    id: `i-${occurredAt}`,
    accountId: 'me',
    amountMinor,
    currency: 'USD',
    source: 'salary',
    note: null,
    occurredAt,
    createdAt: occurredAt,
  };
}

describe('spending patterns', () => {
  it('builds a calendar week, streak and month projection from logged spends', () => {
    const patterns = buildSpendingPatterns(
      fixtureSpendEntries(),
      [income(250_000, '2026-10-02T09:00:00Z')],
      NOW,
      { weeklyBudgetMinor: 20_000, currency: 'USD' },
    );

    expect(patterns.week.start).toBe('2026-10-05');
    expect(patterns.week.spentMinor).toBe(19_800);
    expect(patterns.week.remainingMinor).toBe(200);
    expect(patterns.week.lastWeekSpentMinor).toBe(11_400);
    expect(patterns.streak.currentDays).toBe(5);
    expect(patterns.streak.loggedDays30d).toBe(7);
    expect(patterns.month.spentMinor).toBe(23_000);
    expect(patterns.month.incomeMinor).toBe(250_000);
    expect(patterns.month.projectedSpendMinor).toBe(89_125);
    expect(patterns.totals.topCategory?.category).toBe('entertainment');
    expect(patterns.totals.topCategory?.sharePct).toBe(38);
    expect(patterns.days).toHaveLength(56);
  });

  it('handles an empty history without dividing by zero', () => {
    const patterns = buildSpendingPatterns([], [], NOW);
    expect(patterns.totals.spend30dMinor).toBe(0);
    expect(patterns.totals.averageActiveDayMinor).toBe(0);
    expect(patterns.streak.currentDays).toBe(0);
    expect(patterns.week.remainingMinor).toBeNull();
    expect(patterns.categories).toEqual([]);
    expect(patterns.totals.biggestDay).toBeNull();
  });

  it('compares this period with the previous one', () => {
    const patterns = buildSpendingPatterns(fixtureSpendEntries(), [], NOW);
    const dining = patterns.categories.find((c) => c.category === 'dining');
    expect(dining?.totalMinor).toBe(5_500);
    expect(dining?.changePct).toBeNull();
    expect(patterns.totals.spendPrev30dMinor).toBe(0);
  });
});
