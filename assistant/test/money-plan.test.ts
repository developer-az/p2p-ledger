import { describe, expect, it } from 'vitest';
import type { AccountView } from '../src/web/api.js';
import { moneyPlan } from '../src/web/app/money-plan.js';

describe('moneyPlan', () => {
  it('includes logged income in net position when finance projected cash is set', () => {
    const view = {
      balance: '$120.00',
      moneyProfile: {
        walletCashMinor: 200_000,
        creditOwedMinor: 50_000,
        weeklyBudgetMinor: 40_000,
        spendLogsAffectWallet: false,
        currency: 'USD',
        periodLabel: 'October',
        periodStart: '2026-10-01T00:00:00.000Z',
      },
      finance: {
        projectedCash: '$2,500.00',
        walletCash: '$2,000.00',
        creditOwed: '$500.00',
        weeklyBudget: '$400.00',
        netCash: '$1,500.00',
        ledgerWallet: '$120.00',
        spendLogsAffectWallet: false,
        periodLabel: 'October',
        periodStart: '2026-10-01T00:00:00.000Z',
        periodTotals: { income: '$500.00', spent: '$0.00', incomeMinor: 50_000, spendMinor: 0 },
        bullets: [],
      },
    } as unknown as AccountView;

    expect(moneyPlan(view).netMinor).toBe(200_000);
  });
});
