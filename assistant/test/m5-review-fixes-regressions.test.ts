import { describe, expect, it } from 'vitest';

import type { SpendLogEntry } from '../src/server/spend-log.js';
import {
  buildSubscriptionReport,
  detectSubscriptions,
  normalizeSpendTransactions,
  type NormalizedTransaction,
} from '../src/server/subscriptions.js';

const NOW = new Date('2026-11-10T12:00:00Z');
const ACCOUNT = 'account-m5-review';

function spend(note: string, amountMinor: number, occurredAt: string): SpendLogEntry {
  return {
    id: `${note}-${occurredAt}`,
    accountId: ACCOUNT,
    amountMinor,
    currency: 'USD',
    category: 'other',
    note,
    occurredAt: `${occurredAt}T12:00:00Z`,
    source: 'manual',
    createdAt: `${occurredAt}T12:00:00Z`,
  };
}

function transaction(
  id: string,
  merchant: string,
  merchantKey: string,
  amountMinor: number,
  occurredAt: string,
): NormalizedTransaction {
  return {
    id,
    merchant,
    merchantKey,
    serviceKey: null,
    serviceName: null,
    category: 'other',
    amountMinor,
    occurredAt,
  };
}

describe('M5 review regressions', () => {
  it('computes annual cost from the billing cadence instead of a rounded monthly amount', () => {
    const rows = ['2026-02-15', '2026-05-15', '2026-08-15'].map((day) => spend('Harbor Fitness', 1_000, day));
    const report = detectSubscriptions(normalizeSpendTransactions(rows), NOW);

    expect(report.streams).toHaveLength(1);
    expect(report.streams[0]).toMatchObject({
      cadence: 'quarterly',
      amountMinor: 1_000,
      monthlyMinor: 333,
      annualMinor: 4_000,
    });
    expect(report.totals).toMatchObject({ monthlyRunRateMinor: 333, annualRunRateMinor: 4_000 });
  });

  it('derives the weekly annual cost from 52 charges and the monthly equivalent separately', () => {
    const rows = ['2026-10-17', '2026-10-24', '2026-10-31', '2026-11-07'].map((day) => spend('Metro Weekly', 1_000, day));
    const report = detectSubscriptions(normalizeSpendTransactions(rows), NOW);

    expect(report.streams[0]).toMatchObject({ cadence: 'weekly', monthlyMinor: 4_333, annualMinor: 52_000 });
    expect(report.totals).toMatchObject({ monthlyRunRateMinor: 4_333, annualRunRateMinor: 52_000 });
  });

  it('builds the displayed merchant name from the cleaned descriptor', () => {
    const [row] = normalizeSpendTransactions([
      spend('Harbor Fitness 4111 1111 1111 1111', 1_000, '2026-11-01'),
    ]);

    expect(row?.merchantKey).toBe('harbor fitness');
    expect(row?.merchant).toBe('Harbor Fitness');
    expect(row?.merchant).not.toMatch(/\d/);
  });

  it('uses collision-resistant stream ids when merchant keys share a 60-character prefix', () => {
    const prefix = 'x'.repeat(60);
    const firstKey = `${prefix} alpha`;
    const secondKey = `${prefix} beta`;
    const days = ['2026-09-01', '2026-10-01', '2026-11-01'];
    const rows = [
      ...days.map((day) => transaction(`a-${day}`, firstKey, firstKey, 1_000, `${day}T12:00:00Z`)),
      ...days.map((day) => transaction(`b-${day}`, secondKey, secondKey, 2_000, `${day}T12:00:00Z`)),
    ];

    const report = detectSubscriptions(rows, NOW);
    expect(report.streams).toHaveLength(2);
    const ids = report.streams.map((stream) => stream.id);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) {
      expect(id).toMatch(/^sub-[A-Za-z0-9_-]{16,}$/);
    }

    const marked = buildSubscriptionReport(
      [
        ...days.map((day) => spend(firstKey, 1_000, day)),
        ...days.map((day) => spend(secondKey, 2_000, day)),
      ],
      NOW,
      [{ accountId: ACCOUNT, streamId: ids[0]!, markedToCancel: true, markedAt: NOW.toISOString() }],
    );
    expect(marked.streams.filter((stream) => stream.markedToCancel)).toHaveLength(1);
    expect(marked.streams.find((stream) => stream.markedToCancel)?.id).toBe(ids[0]);
  });
});
