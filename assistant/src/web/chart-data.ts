import type { AccountActivity, AccountSummary } from './api.js';
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

export function transferStatusCounts(transfers: AccountActivity[]): { completed: number; rejected: number } {
  let completed = 0;
  let rejected = 0;
  for (const t of transfers) {
    if (t.status === 'REJECTED') rejected++;
    else completed++;
  }
  return { completed, rejected };
}
