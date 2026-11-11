import { describe, expect, it } from 'vitest';
import {
  buildCashForecast,
  detectRecurring,
  normalizeTransactions,
  type NormalizedTransaction,
} from '../src/server/risk.js';
import type { IncomeLogEntry } from '../src/server/personal-finance.js';
import type { SpendLogEntry } from '../src/server/spend-log.js';

const NOW = new Date('2026-11-10T12:00:00Z');

function spend(id: string, amountMinor: number, occurredAt: string, note: string): SpendLogEntry {
  return {
    id,
    accountId: 'me',
    amountMinor,
    currency: 'USD',
    category: 'housing',
    note,
    occurredAt,
    source: 'manual',
    createdAt: occurredAt,
  };
}

function income(id: string, amountMinor: number, occurredAt: string): IncomeLogEntry {
  return {
    id,
    accountId: 'me',
    amountMinor,
    currency: 'USD',
    source: 'salary',
    note: null,
    occurredAt,
    createdAt: occurredAt,
  };
}

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

describe('transaction normalisation', () => {
  it('turns spends and income into one signed-independent transaction list', () => {
    const rows = normalizeTransactions(
      [
        { ...spend('s1', 2_200, '2026-11-01T18:00:00Z', '  Coffee   Shop '), category: 'dining' },
      ],
      [income('i1', 250_000, '2026-11-02T09:00:00Z')],
    );

    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.source === 'spend')).toMatchObject({
      direction: 'out',
      amountMinor: 2_200,
      merchant: 'Coffee Shop',
      merchantKey: 'coffee shop',
      category: 'dining',
      source: 'spend',
    });
    expect(rows.find((row) => row.source === 'income')).toMatchObject({
      direction: 'in',
      amountMinor: 250_000,
      merchant: 'Salary',
      merchantKey: 'salary',
      category: 'salary',
      source: 'income',
    });
  });
});

describe('recurring detection', () => {
  it('finds a monthly rent stream and its next date', () => {
    const rows = normalizeTransactions([
      spend('r1', 30_000, '2026-09-01T09:00:00Z', 'Rent'),
      spend('r2', 30_000, '2026-10-01T09:00:00Z', 'Rent'),
      spend('r3', 30_000, '2026-11-01T09:00:00Z', 'Rent'),
    ], []);

    const streams = detectRecurring(rows);
    expect(streams).toHaveLength(1);
    expect(streams[0]).toMatchObject({
      merchant: 'Rent',
      merchantKey: 'rent',
      direction: 'out',
      amountMinor: 30_000,
      intervalDays: 30,
      occurrences: 3,
      nextDate: '2026-12-01',
    });
  });

  it('does not call irregular gaps recurring', () => {
    const rows = [
      txn('a', 'out', 10_000, '2026-09-01T09:00:00Z', 'Corner Store', 'groceries'),
      txn('b', 'out', 10_000, '2026-09-11T09:00:00Z', 'Corner Store', 'groceries'),
      txn('c', 'out', 10_000, '2026-10-21T09:00:00Z', 'Corner Store', 'groceries'),
    ];

    expect(detectRecurring(rows)).toEqual([]);
  });
});

describe('cash forecast', () => {
  it('projects recurring outflows, planned income and average discretionary spend', () => {
    const rows = normalizeTransactions([
      spend('rent-1', 30_000, '2026-09-01T09:00:00Z', 'Rent'),
      spend('rent-2', 30_000, '2026-10-01T09:00:00Z', 'Rent'),
      spend('rent-3', 30_000, '2026-11-01T09:00:00Z', 'Rent'),
      { ...spend('coffee', 3_000, '2026-11-05T09:00:00Z', 'Corner Cafe'), category: 'dining' },
    ], [
      income('pay-1', 100_000, '2026-09-25T09:00:00Z'),
      income('pay-2', 100_000, '2026-10-25T09:00:00Z'),
    ]);

    const forecast = buildCashForecast({
      now: NOW,
      currentBalanceMinor: 100_000,
      transactions: rows,
      horizonDays: 90,
    });

    expect(forecast.points).toHaveLength(91);
    expect(forecast.averageDiscretionaryMinorPerDay).toBe(33);
    expect(forecast.monthlyIncomeMinor).toBe(100_000);
    expect(forecast.monthlyRecurringOutflowMinor).toBe(30_000);
    expect(forecast.milestones.map((m) => m.day)).toEqual([30, 60, 90]);
    expect(forecast.milestones.map((m) => m.balanceMinor)).toEqual([169_000, 238_000, 307_000]);
    expect(forecast.lowestBalanceMinor).toBeLessThan(100_000);
    expect(forecast.lowestDate).toMatch(/^2026-\d{2}-\d{2}$/);
    expect(forecast.shortfall).toBe(false);
    expect(forecast.recurringOutflows[0]?.merchant).toBe('Rent');
    expect(forecast.assumptions.length).toBeGreaterThan(0);
  });

  it('keeps a flat line when there is no history', () => {
    const forecast = buildCashForecast({
      now: NOW,
      currentBalanceMinor: 5_000,
      transactions: [],
    });

    expect(forecast.points).toHaveLength(91);
    expect(forecast.averageDiscretionaryMinorPerDay).toBe(0);
    expect(forecast.milestones.every((m) => m.balanceMinor === 5_000)).toBe(true);
    expect(forecast.lowestBalanceMinor).toBe(5_000);
    expect(forecast.shortfall).toBe(false);
  });

  it('marks a shortfall when the projected balance goes negative', () => {
    const forecast = buildCashForecast({
      now: NOW,
      currentBalanceMinor: 1_000,
      transactions: [
        txn('big', 'out', 50_000, '2026-11-09T09:00:00Z', 'Airline', 'other'),
      ],
      horizonDays: 30,
    });

    expect(forecast.shortfall).toBe(true);
    expect(forecast.lowestBalanceMinor).toBeLessThan(0);
  });
});
