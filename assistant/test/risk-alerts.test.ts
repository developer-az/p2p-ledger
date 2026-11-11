import { describe, expect, it } from 'vitest';
import { buildRiskAlerts, type NormalizedTransaction } from '../src/server/risk.js';

const NOW = new Date('2026-11-10T12:00:00Z');

function txn(
  id: string,
  direction: 'in' | 'out',
  amountMinor: number,
  occurredAt: string,
  merchant: string,
  category: string,
): NormalizedTransaction {
  return {
    id,
    accountId: 'me',
    direction,
    amountMinor,
    currency: 'USD',
    occurredAt,
    merchant,
    merchantKey: merchant.toLowerCase(),
    category,
    source: direction === 'out' ? 'spend' : 'income',
  };
}

describe('risk alerts', () => {
  it('flags an overspent weekly plan with the amount over', () => {
    const alerts = buildRiskAlerts({
      now: NOW,
      transactions: [],
      currentBalanceMinor: 100_000,
      weeklyBudgetMinor: 10_000,
      weeklySpentMinor: 12_000,
      weekStart: '2026-11-09',
    });

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      rule: 'WEEKLY_PLAN_OVERSPEND',
      severity: 'medium',
      id: 'weekly-plan-overspend:2026-11-09',
    });
    expect(alerts[0]?.evidence).toMatchObject({ overMinor: 2_000, budgetMinor: 10_000 });
  });

  it('raises a high low-balance alert when cash goes negative', () => {
    const alerts = buildRiskAlerts({
      now: NOW,
      transactions: [],
      currentBalanceMinor: -500,
      weeklyBudgetMinor: null,
      weeklySpentMinor: 0,
    });

    expect(alerts.some((a) => a.rule === 'LOW_PROJECTED_BALANCE' && a.severity === 'high')).toBe(true);
  });

  it('compares a recent charge to the category median', () => {
    const alerts = buildRiskAlerts({
      now: NOW,
      transactions: [
        txn('d1', 'out', 1_000, '2026-09-11T12:00:00Z', 'Cafe One', 'dining'),
        txn('d2', 'out', 1_200, '2026-09-21T12:00:00Z', 'Cafe Two', 'dining'),
        txn('d3', 'out', 1_100, '2026-10-01T12:00:00Z', 'Cafe Three', 'dining'),
        txn('d4', 'out', 6_000, '2026-11-08T12:00:00Z', 'Steak House', 'dining'),
      ],
      currentBalanceMinor: 100_000,
      weeklyBudgetMinor: null,
      weeklySpentMinor: 0,
    });

    const large = alerts.find((a) => a.rule === 'LARGE_SPEND');
    expect(large).toMatchObject({
      id: 'large-spend:d4',
      severity: 'high',
    });
    expect(large?.evidence).toMatchObject({
      amountMinor: 6_000,
      medianMinor: 1_100,
      ratio: 5.5,
    });
  });

  it('does not flag a charge that is close to the category median', () => {
    const alerts = buildRiskAlerts({
      now: NOW,
      transactions: [
        txn('d1', 'out', 1_000, '2026-09-11T12:00:00Z', 'Cafe One', 'dining'),
        txn('d2', 'out', 1_200, '2026-09-21T12:00:00Z', 'Cafe Two', 'dining'),
        txn('d3', 'out', 1_100, '2026-10-01T12:00:00Z', 'Cafe Three', 'dining'),
        txn('d4', 'out', 2_000, '2026-11-08T12:00:00Z', 'Cafe Four', 'dining'),
      ],
      currentBalanceMinor: 100_000,
      weeklyBudgetMinor: null,
      weeklySpentMinor: 0,
    });

    expect(alerts.some((a) => a.rule === 'LARGE_SPEND')).toBe(false);
  });

  it('warns about a recurring charge due in the next two weeks', () => {
    const alerts = buildRiskAlerts({
      now: NOW,
      transactions: [
        txn('rent-1', 'out', 30_000, '2026-08-12T09:00:00Z', 'Rent', 'housing'),
        txn('rent-2', 'out', 30_000, '2026-09-12T09:00:00Z', 'Rent', 'housing'),
        txn('rent-3', 'out', 30_000, '2026-10-12T09:00:00Z', 'Rent', 'housing'),
      ],
      currentBalanceMinor: 100_000,
      weeklyBudgetMinor: null,
      weeklySpentMinor: 0,
      upcomingThresholdMinor: 10_000,
    });

    const upcoming = alerts.find((a) => a.rule === 'UPCOMING_LARGE_CHARGE');
    expect(upcoming).toMatchObject({
      severity: 'high',
      id: 'upcoming-large-charge:rent:2026-11-11',
    });
    expect(upcoming?.evidence).toMatchObject({
      amountMinor: 30_000,
      dueDate: '2026-11-11',
      merchant: 'Rent',
    });
  });

  it('filters dismissed alerts and sorts the rest by severity', () => {
    const first = buildRiskAlerts({
      now: NOW,
      transactions: [],
      currentBalanceMinor: 100_000,
      weeklyBudgetMinor: 10_000,
      weeklySpentMinor: 12_000,
      weekStart: '2026-11-09',
    });
    expect(first).toHaveLength(1);
    const dismissed = first[0]!.id;

    expect(buildRiskAlerts({
      now: NOW,
      transactions: [],
      currentBalanceMinor: 100_000,
      weeklyBudgetMinor: 10_000,
      weeklySpentMinor: 12_000,
      weekStart: '2026-11-09',
      dismissed: [dismissed],
    })).toEqual([]);

    const sorted = buildRiskAlerts({
      now: NOW,
      transactions: [],
      currentBalanceMinor: -500,
      weeklyBudgetMinor: 10_000,
      weeklySpentMinor: 12_000,
      weekStart: '2026-11-09',
    });
    expect(sorted.map((a) => a.severity)).toEqual(['high', 'medium']);
  });
});
