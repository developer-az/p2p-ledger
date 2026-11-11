/**
 * Regression tests for the M6 review findings.
 *
 * 1. Risk snapshots page past the newest 500 rows so an older report month,
 *    its comparison month and the forecast lookback stay complete.
 * 2. Income enters a forecast only when a recurring cadence was detected.
 * 3. CSV cells that a spreadsheet would execute are prefixed with an apostrophe.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import type { LedgerAuditor, LedgerReader, LedgerWriter } from '../src/server/ledger.js';
import { InMemoryPersonalFinanceStore } from '../src/server/personal-finance.js';
import { CompositeLedger, PracticeLedger } from '../src/server/practice-ledger.js';
import { buildCashForecast, buildMonthlyReport, reportCsv, type NormalizedTransaction } from '../src/server/risk.js';
import { InMemorySpendLogStore } from '../src/server/spend-log.js';

const NOW = new Date('2026-11-15T12:00:00Z');

function setup() {
  const practice = new PracticeLedger();
  const unused = { getAccount: async () => null } as unknown as LedgerReader & LedgerWriter & LedgerAuditor;
  const spendLogs = new InMemorySpendLogStore();
  const personalFinance = new InMemoryPersonalFinanceStore();
  const app = createApp({
    ledger: new CompositeLedger(unused, practice, async () => false),
    practice,
    spendLogs,
    personalFinance,
    now: () => NOW,
  });
  return { app, practice, spendLogs, personalFinance };
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

describe('risk snapshot pagination', () => {
  it('reports an older month and its comparison month past 500 newer rows', async () => {
    const { app, practice, spendLogs, personalFinance } = setup();
    const account = await practice.openAccount('m6-report-owner', 'USD');

    for (let index = 0; index < 550; index += 1) {
      await spendLogs.record(account.id, {
        amountMinor: 100,
        category: 'dining',
        note: `newer-spend-${index}`,
        occurredAt: `2026-11-${String((index % 14) + 1).padStart(2, '0')}T12:00:00Z`,
      }, NOW);
      await personalFinance.recordIncome(account.id, {
        amountMinor: 200,
        source: 'salary',
        note: `newer-income-${index}`,
        occurredAt: `2026-11-${String((index % 14) + 1).padStart(2, '0')}T12:00:00Z`,
      }, NOW);
    }
    await spendLogs.record(account.id, {
      amountMinor: 2_200,
      category: 'groceries',
      note: 'September groceries',
      occurredAt: '2026-09-12T12:00:00Z',
    }, NOW);
    await personalFinance.recordIncome(account.id, {
      amountMinor: 9_900,
      source: 'salary',
      note: 'September payroll',
      occurredAt: '2026-09-25T12:00:00Z',
    }, NOW);
    await spendLogs.record(account.id, {
      amountMinor: 1_100,
      category: 'dining',
      note: 'August dinner',
      occurredAt: '2026-08-12T12:00:00Z',
    }, NOW);
    await personalFinance.recordIncome(account.id, {
      amountMinor: 7_700,
      source: 'salary',
      note: 'August payroll',
      occurredAt: '2026-08-25T12:00:00Z',
    }, NOW);

    const res = await app.request(`/api/accounts/${account.id}/reports/monthly?month=2026-09`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      incomeMinor: number;
      spendMinor: number;
      previous: { incomeMinor: number; spendMinor: number };
    };
    expect(body).toMatchObject({
      incomeMinor: 9_900,
      spendMinor: 2_200,
      previous: { incomeMinor: 7_700, spendMinor: 1_100 },
    });
  });

  it('detects an older income cadence for the forecast past 500 newer inflows', async () => {
    const { app, practice, spendLogs, personalFinance } = setup();
    const account = await practice.openAccount('m6-forecast-owner', 'USD');

    for (let index = 0; index < 550; index += 1) {
      await personalFinance.recordIncome(account.id, {
        amountMinor: 100,
        source: 'other',
        note: `one-off-${index}`,
        occurredAt: `2026-11-${String((index % 14) + 1).padStart(2, '0')}T12:00:00Z`,
      }, NOW);
    }
    await personalFinance.recordIncome(account.id, {
      amountMinor: 12_345,
      source: 'salary',
      note: 'Payroll',
      occurredAt: '2026-09-25T09:00:00Z',
    }, NOW);
    await personalFinance.recordIncome(account.id, {
      amountMinor: 12_345,
      source: 'salary',
      note: 'Payroll',
      occurredAt: '2026-10-25T09:00:00Z',
    }, NOW);
    // Keep the spend store part of the fixture even though this case is income-only.
    await spendLogs.record(account.id, {
      amountMinor: 1_000,
      category: 'other',
      note: 'Forecast fixture',
      occurredAt: '2026-11-10T12:00:00Z',
    }, NOW);

    const res = await app.request(`/api/accounts/${account.id}/forecast`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      monthlyIncomeMinor: number;
      plannedIncome: { merchant: string; amountMinor: number }[];
    };
    expect(body.monthlyIncomeMinor).toBe(12_345);
    expect(body.plannedIncome).toContainEqual(expect.objectContaining({
      merchant: 'Payroll',
      amountMinor: 12_345,
    }));
  });
});

describe('income recurrence evidence', () => {
  it('does not turn one logged income into a monthly payment', () => {
    const forecast = buildCashForecast({
      now: NOW,
      currentBalanceMinor: 50_000,
      transactions: [
        txn('one', 'in', 100_000, '2026-11-01T09:00:00Z', 'One-off deposit', 'other'),
      ],
      horizonDays: 90,
    });

    expect(forecast.plannedIncome).toEqual([]);
    expect(forecast.monthlyIncomeMinor).toBe(0);
    expect(forecast.points.every((point) => point.balanceMinor <= 50_000)).toBe(true);
  });

  it('leaves irregular income out of the projection', () => {
    const forecast = buildCashForecast({
      now: NOW,
      currentBalanceMinor: 50_000,
      transactions: [
        txn('a', 'in', 80_000, '2026-09-01T09:00:00Z', 'Client', 'freelance'),
        txn('b', 'in', 80_000, '2026-09-11T09:00:00Z', 'Client', 'freelance'),
        txn('c', 'in', 80_000, '2026-10-21T09:00:00Z', 'Client', 'freelance'),
      ],
      horizonDays: 90,
    });

    expect(forecast.plannedIncome).toEqual([]);
    expect(forecast.monthlyIncomeMinor).toBe(0);
  });
});

describe('report CSV formula escaping', () => {
  it('prefixes formula-leading text before RFC 4180 quoting', () => {
    const report = buildMonthlyReport({
      now: NOW,
      transactions: [
        txn('a', 'out', 1_000, '2026-11-02T12:00:00Z', '=SUM(A1)', '+category'),
        txn('b', 'out', 2_000, '2026-11-03T12:00:00Z', '-Merchant', '@category'),
        txn('c', 'out', 3_000, '2026-11-04T12:00:00Z', '\tTabbed', '\rCarriage'),
        txn('d', 'out', 4_000, '2026-11-05T12:00:00Z', '=HYPERLINK("https://example.test")', 'other'),
      ],
    });
    const csv = reportCsv(report);

    expect(csv).toContain("'=SUM(A1)");
    expect(csv).toContain("'+category");
    expect(csv).toContain("'-Merchant");
    expect(csv).toContain("'@category");
    expect(csv).toContain("'\tTabbed");
    expect(csv).toContain("\"'\rCarriage\"");
    expect(csv).toContain('"\'=HYPERLINK(""https://example.test"")"');
  });
});
