import { describe, expect, it } from 'vitest';
import {
  buildFinanceSnapshot,
  defaultMoneyProfile,
  InMemoryPersonalFinanceStore,
  sumSince,
} from '../src/server/personal-finance.js';
import type { SpendLogEntry } from '../src/server/spend-log.js';

const ACCOUNT = '00000000-0000-4000-8000-000000000001';

describe('personal finance', () => {
  it('projects cash when spend logs affect wallet', () => {
    const profile = {
      ...defaultMoneyProfile(ACCOUNT, 'USD', new Date('2026-11-01T12:00:00Z')),
      walletCashMinor: 50_000,
      creditOwedMinor: 10_000,
      spendLogsAffectWallet: true,
      periodStart: '2026-11-01T00:00:00.000Z',
    };
    const spends: SpendLogEntry[] = [{
      id: '1',
      accountId: ACCOUNT,
      amountMinor: 2_500,
      currency: 'USD',
      category: 'dining',
      note: null,
      occurredAt: '2026-11-05T12:00:00Z',
      source: 'manual',
      createdAt: '2026-11-05T12:00:00Z',
    }];
    const snap = buildFinanceSnapshot(profile, '$100.00', spends, []);
    expect(snap.netCash).toBe('$400.00');
    expect(snap.projectedCash).toBe('$475.00');
    expect(snap.periodTotals.spent).toBe('$25.00');
  });

  it('does not subtract spends when balance already reflects them', () => {
    const profile = {
      ...defaultMoneyProfile(ACCOUNT, 'USD'),
      walletCashMinor: 50_000,
      spendLogsAffectWallet: false,
      periodStart: '2026-01-01T00:00:00.000Z',
    };
    const spends: SpendLogEntry[] = [{
      id: '1',
      accountId: ACCOUNT,
      amountMinor: 5_000,
      currency: 'USD',
      category: 'groceries',
      note: null,
      occurredAt: '2026-01-10T12:00:00Z',
      source: 'manual',
      createdAt: '2026-01-10T12:00:00Z',
    }];
    const snap = buildFinanceSnapshot(profile, '$0.00', spends, []);
    expect(snap.projectedCash).toBe('$500.00');
  });

  it('rollover keeps balances and resets period', async () => {
    const store = new InMemoryPersonalFinanceStore();
    await store.updateProfile(ACCOUNT, 'USD', { walletCashMinor: 50_000, creditOwedMinor: 5_000 });
    const after = await store.startNewPeriod(ACCOUNT, 'USD', new Date('2026-12-02T00:00:00Z'));
    expect(after.walletCashMinor).toBe(50_000);
    expect(after.creditOwedMinor).toBe(5_000);
    expect(after.periodLabel).toMatch(/December 2026/);
  });

  it('sumSince ignores older rows', () => {
    const total = sumSince(
      [{ amountMinor: 100, occurredAt: '2026-11-01T00:00:00Z' }, { amountMinor: 200, occurredAt: '2026-10-01T00:00:00Z' }],
      '2026-11-01T00:00:00Z',
    );
    expect(total).toBe(100);
  });
});
