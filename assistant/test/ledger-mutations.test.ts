import { describe, expect, it, vi } from 'vitest';
import type { AccountView } from '../src/web/api.js';
import { recordIncomeMutation, recordSpendMutation } from '../src/web/app/ledger-mutations.js';

const baseView = (): AccountView =>
  ({
    id: 'acct-1',
    currency: 'USD',
    balance: '$100.00',
    moneyProfile: {
      accountId: 'acct-1',
      currency: 'USD',
      periodLabel: 'Oct 2026',
      periodStart: '2026-10-01T00:00:00.000Z',
      walletCashMinor: 200_000,
      creditOwedMinor: 50_000,
      weeklyBudgetMinor: 45_000,
      spendLogsAffectWallet: true,
      updatedAt: '2026-10-01T00:00:00.000Z',
    },
    finance: {
      periodLabel: 'Oct 2026',
      periodStart: '2026-10-01T00:00:00.000Z',
      walletCash: '$2,000.00',
      creditOwed: '$500.00',
      weeklyBudget: '$450.00',
      netCash: '$1,500.00',
      ledgerWallet: '$100.00',
      spendLogsAffectWallet: true,
      periodTotals: { income: '$750.00', spent: '$101.40' },
      projectedCash: '$2,648.60',
      bullets: [],
    },
    patterns: {
      generatedAt: '2026-10-21T00:00:00.000Z',
      days: [],
      categories: [{ category: 'dining', totalMinor: 5000, count: 2, prevTotalMinor: 0, changePct: null, sharePct: 40 }],
      weekdays: [],
      week: {
        start: '2026-10-20T00:00:00.000Z',
        end: '2026-10-26T23:59:59.999Z',
        spentMinor: 10_140,
        lastWeekSpentMinor: 8000,
        budgetMinor: 45_000,
        remainingMinor: 34_860,
      },
      month: { label: 'Oct', start: '2026-10-01', spentMinor: 50_000, incomeMinor: 75_000, projectedSpendMinor: 0, dayOfMonth: 21, daysInMonth: 31 },
      streak: { currentDays: 3, longestDays: 5, loggedDays30d: 10, lastLoggedAt: '2026-10-20T12:00:00.000Z' },
      totals: { spend30dMinor: 50_000, spendPrev30dMinor: 40_000, income30dMinor: 75_000, averageActiveDayMinor: 0, averageCalendarDayMinor: 0, biggestDay: null, topCategory: null, activeDays30d: 10 },
    },
    spendEntries: [],
    transfers: [],
  }) as unknown as AccountView;

describe('ledger-mutations', () => {
  it('bumps projected cash when income is logged', () => {
    const mutation = recordIncomeMutation('acct-1', 50_000, 'salary');
    const next = mutation.apply(baseView());
    expect(next?.finance?.periodTotals.income).toBe('$1,250.00');
    expect(next?.finance?.projectedCash).toBe('$3,148.60');
  });

  it('updates week spend and projected cash when spend is logged', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T12:00:00.000Z'));
    try {
      const mutation = recordSpendMutation('acct-1', 2500, 'dining');
      const next = mutation.apply(baseView());
      expect(next?.patterns?.week.spentMinor).toBe(12_640);
      expect(next?.finance?.projectedCash).toBe('$2,623.60'); // cash + income − period spend
      expect(next?.spendEntries?.[0]?.amountMinor).toBe(2500);
    } finally {
      vi.useRealTimers();
    }
  });
});
