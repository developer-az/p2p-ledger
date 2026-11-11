import { describe, expect, it } from 'vitest';
import { buildMonthlyReport, reportCsv, type NormalizedTransaction } from '../src/server/risk.js';

const NOW = new Date('2026-11-15T12:00:00Z');

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

const rows = [
  txn('n1', 'in', 300_000, '2026-11-01T09:00:00Z', 'Salary', 'salary'),
  txn('n2', 'out', 2_000, '2026-11-02T12:00:00Z', 'Cafe', 'dining'),
  txn('n3', 'out', 3_000, '2026-11-03T12:00:00Z', 'Cafe', 'dining'),
  txn('n4', 'out', 5_000, '2026-11-04T12:00:00Z', 'Market', 'groceries'),
  txn('n5', 'in', 50_000, '2026-11-05T12:00:00Z', 'Client', 'freelance'),
  txn('o1', 'in', 280_000, '2026-10-01T09:00:00Z', 'Salary', 'salary'),
  txn('o2', 'out', 4_000, '2026-10-02T12:00:00Z', 'Cafe', 'dining'),
];

describe('monthly report', () => {
  it('summarises income, spend, categories, merchants and the prior month', () => {
    const report = buildMonthlyReport({ now: NOW, transactions: rows });

    expect(report).toMatchObject({
      month: '2026-11',
      label: 'November 2026',
      start: '2026-11-01',
      end: '2026-11-30',
      incomeMinor: 350_000,
      spendMinor: 10_000,
      netMinor: 340_000,
      transactionCount: 5,
    });
    expect(report.byCategory).toEqual([
      { key: 'dining', kind: 'spend', inMinor: 0, outMinor: 5_000, count: 2 },
      { key: 'freelance', kind: 'income', inMinor: 50_000, outMinor: 0, count: 1 },
      { key: 'groceries', kind: 'spend', inMinor: 0, outMinor: 5_000, count: 1 },
      { key: 'salary', kind: 'income', inMinor: 300_000, outMinor: 0, count: 1 },
    ]);
    expect(report.topMerchants).toEqual([
      { merchant: 'Cafe', merchantKey: 'cafe', spendMinor: 5_000, count: 2, sharePct: 50 },
      { merchant: 'Market', merchantKey: 'market', spendMinor: 5_000, count: 1, sharePct: 50 },
    ]);
    expect(report.previous).toMatchObject({
      month: '2026-10',
      label: 'October 2026',
      incomeMinor: 280_000,
      spendMinor: 4_000,
      netMinor: 276_000,
    });
    expect(report.change).toMatchObject({
      incomePct: 25,
      spendPct: 150,
      netPct: 23,
      incomeDeltaMinor: 70_000,
      spendDeltaMinor: 6_000,
      netDeltaMinor: 64_000,
    });
  });

  it('can report a named month and returns zeros for an empty one', () => {
    const october = buildMonthlyReport({ now: NOW, transactions: rows, month: '2026-10' });
    expect(october.month).toBe('2026-10');
    expect(october.incomeMinor).toBe(280_000);
    expect(october.spendMinor).toBe(4_000);

    const empty = buildMonthlyReport({ now: NOW, transactions: rows, month: '2026-09' });
    expect(empty.incomeMinor).toBe(0);
    expect(empty.spendMinor).toBe(0);
    expect(empty.netMinor).toBe(0);
    expect(empty.byCategory).toEqual([]);
    expect(empty.topMerchants).toEqual([]);
    expect(empty.change.incomePct).toBeNull();
  });

  it('exports a stable CSV with summary, categories and merchants', () => {
    const csv = reportCsv(buildMonthlyReport({ now: NOW, transactions: rows }));
    const lines = csv.trim().split('\n');

    expect(lines[0]).toBe('Monthly report,November 2026');
    expect(lines).toContain('Period,2026-11-01,2026-11-30');
    expect(lines).toContain('Income,3500.00');
    expect(lines).toContain('Spend,100.00');
    expect(lines).toContain('Net,3400.00');
    expect(lines).toContain('spend,dining,0.00,50.00,2');
    expect(lines).toContain('income,salary,3000.00,0.00,1');
    expect(lines).toContain('Cafe,50.00,2,50');
  });
});
