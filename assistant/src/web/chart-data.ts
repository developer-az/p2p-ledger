import type { AccountActivity, AccountSummary, PatternDay } from './api.js';
import type { LedgerEntryRow } from './api.js';

/** Parse "$1,234.56" → minor units */
export function moneyStringToMinor(s: string): number {
  const n = Number(s.replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export interface CashflowBars {
  deposited: number;
  received: number;
  sent: number;
  inflow: number;
}

export function cashflowFromSummary(summary: AccountSummary): CashflowBars {
  return {
    deposited: moneyStringToMinor(summary.deposited),
    received: moneyStringToMinor(summary.received),
    sent: moneyStringToMinor(summary.sent),
    inflow: moneyStringToMinor(summary.inflow ?? summary.received),
  };
}

export function balanceSeriesFromEntries(entries: LedgerEntryRow[]): { x: number; y: number }[] {
  const sorted = [...entries].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
  return sorted.map((e, i) => ({ x: i, y: e.balanceAfterMinor }));
}

/** Daily values for one field of the trailing pattern window, oldest first. */
export function dailySeries(days: PatternDay[], key: 'spendMinor' | 'incomeMinor', count = 30): number[] {
  return days.slice(-count).map((day) => day[key]);
}

/**
 * The cash trend that ends at the current cash figure: walk the trailing window
 * backwards, undoing each day's logged income and spend. Callers only use this
 * when spend logs affect the wallet, so the line is a movement series and not a
 * second, invented balance.
 */
export function cashSeries(days: PatternDay[], endCashMinor: number, count = 30): number[] {
  const window = days.slice(-count);
  const out = new Array<number>(window.length);
  let value = endCashMinor;
  for (let i = window.length - 1; i >= 0; i -= 1) {
    const day = window[i]!;
    out[i] = value;
    value -= day.incomeMinor - day.spendMinor;
  }
  return out;
}

export function transferStatusCounts(transfers: AccountActivity[]): { completed: number; rejected: number } {
  let completed = 0;
  let rejected = 0;
  for (const t of transfers) {
    if (t.status === 'REJECTED') rejected++;
    else completed++;
  }
  return { completed, rejected };
}
