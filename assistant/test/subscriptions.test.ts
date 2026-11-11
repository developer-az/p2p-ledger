import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { CompositeLedger, PracticeLedger } from '../src/server/practice-ledger.js';
import { InMemorySpendLogStore, type SpendLogEntry } from '../src/server/spend-log.js';
import {
  buildSubscriptionReport,
  detectSubscriptions,
  normalizeSpendTransactions,
  type NormalizedTransaction,
} from '../src/server/subscriptions.js';
import { FixtureLedger, ME } from '../evals/fixture.js';

const NOW = new Date('2026-11-10T12:00:00Z');
const ACCOUNT = ME;

const CATEGORY_BY_MERCHANT: Record<string, SpendLogEntry['category']> = {
  Netflix: 'entertainment',
  Spotify: 'entertainment',
  'iCloud+': 'other',
  'Equinox Gym': 'health',
  'Adobe Creative Cloud': 'other',
  Hulu: 'entertainment',
  Audible: 'entertainment',
};

function spend(note: string, amountMinor: number, occurredAt: string, id = `${note}-${occurredAt}`): SpendLogEntry {
  return {
    id,
    accountId: ACCOUNT,
    amountMinor,
    currency: 'USD',
    category: CATEGORY_BY_MERCHANT[note] ?? 'other',
    note,
    occurredAt: `${occurredAt}T12:00:00Z`,
    source: 'manual',
    createdAt: `${occurredAt}T12:00:00Z`,
  };
}

/**
 * Mirrors PLAN 5.1: five active streams, one price rise, two candidates that
 * must not enter the run-rate. Amounts produce exactly $65.96/mo and $791.52/yr.
 */
export function subscriptionSpendFixture(): SpendLogEntry[] {
  const rows: SpendLogEntry[] = [];
  for (const day of ['2026-06-03', '2026-07-03', '2026-08-03']) rows.push(spend('Netflix', 1_549, day));
  for (const day of ['2026-09-03', '2026-10-03', '2026-11-03']) rows.push(spend('Netflix', 1_799, day));
  for (const day of ['2026-09-08', '2026-10-08', '2026-11-08']) rows.push(spend('Spotify', 1_199, day));
  for (const day of ['2026-09-01', '2026-10-01', '2026-11-01']) rows.push(spend('iCloud+', 299, day));
  for (const day of ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15']) rows.push(spend('Equinox Gym', 6_000, day));
  rows.push(spend('Adobe Creative Cloud', 15_588, '2024-12-01'));
  rows.push(spend('Adobe Creative Cloud', 15_588, '2025-12-01'));
  // Candidates: a completed trial and a single charge. Neither is an active stream.
  rows.push(spend('Hulu', 100, '2026-09-20'));
  rows.push(spend('Hulu', 1_799, '2026-10-20'));
  rows.push(spend('Audible', 1_495, '2026-11-05'));
  // Ordinary spending with the same merchant twice must not become a candidate.
  rows.push(spend('Whole Foods', 4_212, '2026-11-01'));
  rows.push(spend('Whole Foods', 3_877, '2026-11-08'));
  return rows;
}

function reportFrom(rows: SpendLogEntry[]) {
  return detectSubscriptions(normalizeSpendTransactions(rows), NOW);
}

describe('subscription detection (PLAN 5.1)', () => {
  it('finds five active streams and computes the exact monthly and annual run-rate', () => {
    const report = reportFrom(subscriptionSpendFixture());

    expect(report.totals.activeCount).toBe(5);
    expect(report.streams).toHaveLength(5);
    expect(report.totals.monthlyRunRateMinor).toBe(6_596);
    expect(report.totals.annualRunRateMinor).toBe(79_152);

    const byName = new Map(report.streams.map((stream) => [stream.merchant, stream]));
    expect(byName.get('Netflix')).toMatchObject({ cadence: 'monthly', amountMinor: 1_799, monthlyMinor: 1_799, annualMinor: 21_588 });
    expect(byName.get('Spotify')).toMatchObject({ cadence: 'monthly', amountMinor: 1_199 });
    expect(byName.get('iCloud+')).toMatchObject({ cadence: 'monthly', amountMinor: 299 });
    expect(byName.get('Equinox Gym')).toMatchObject({ cadence: 'quarterly', amountMinor: 6_000, monthlyMinor: 2_000 });
    expect(byName.get('Adobe Creative Cloud')).toMatchObject({ cadence: 'annual', amountMinor: 15_588, monthlyMinor: 1_299 });
  });

  it('detects one price increase and keeps the old price in the history', () => {
    const report = reportFrom(subscriptionSpendFixture());
    const netflix = report.streams.find((stream) => stream.merchant === 'Netflix');

    expect(netflix?.priceChange).toMatchObject({ fromMinor: 1_549, toMinor: 1_799, pct: 16 });
    expect(netflix?.priceChange?.occurredAt).toBe('2026-09-03T12:00:00Z');
    expect(netflix?.priceCreep).toBe(true);
    expect(netflix?.priceHistory.map((charge) => charge.amountMinor)).toEqual([1_549, 1_549, 1_549, 1_799, 1_799, 1_799]);
    expect(netflix?.nextChargeAt).toBe('2026-12-03T12:00:00.000Z');
    expect(netflix?.lastChargeAt).toBe('2026-11-03T12:00:00Z');
  });

  it('reports trial-to-paid and single-charge candidates without counting them in the run-rate', () => {
    const report = reportFrom(subscriptionSpendFixture());
    const hulu = report.candidates.find((candidate) => candidate.merchant === 'Hulu');
    const audible = report.candidates.find((candidate) => candidate.merchant === 'Audible');

    expect(report.candidates).toHaveLength(2);
    expect(hulu).toMatchObject({ reason: 'unverified_cadence', trialToPaid: true, trialChargeMinor: 100, amountMinor: 1_799 });
    expect(audible).toMatchObject({ reason: 'single_charge', trialToPaid: false, amountMinor: 1_495 });
    expect(report.streams.some((stream) => stream.merchant === 'Hulu' || stream.merchant === 'Audible')).toBe(false);
    expect(report.candidates.some((candidate) => candidate.merchant === 'Whole Foods')).toBe(false);
    expect(report.totals.candidateCount).toBe(2);
    expect(report.totals.monthlyRunRateMinor).toBe(6_596);
  });

  it('recognises a weekly cadence and converts it to a monthly run-rate', () => {
    const weekly: NormalizedTransaction[] = ['2026-10-17', '2026-10-24', '2026-10-31', '2026-11-07'].map((day, index) => ({
      id: `weekly-${index}`,
      merchant: 'Metro Weekly',
      merchantKey: 'metro weekly',
      serviceKey: null,
      serviceName: null,
      category: 'transport',
      amountMinor: 1_000,
      occurredAt: `${day}T09:00:00Z`,
    }));
    const report = detectSubscriptions(weekly, NOW);
    expect(report.streams).toHaveLength(1);
    expect(report.streams[0]).toMatchObject({ cadence: 'weekly', monthlyMinor: 4_333, annualMinor: 52_000 });
  });
});

describe('duplicate subscription detection (PLAN 5.3)', () => {
  it('flags two active streams for the same known service', () => {
    const rows = [
      ...['2026-09-01', '2026-10-01', '2026-11-01'].map((day) => spend('Netflix', 1_549, day)),
      ...['2026-09-05', '2026-10-05', '2026-11-05'].map((day) => spend('Netflix Premium', 2_299, day)),
    ];
    const report = reportFrom(rows);

    expect(report.streams).toHaveLength(2);
    expect(report.duplicates).toHaveLength(1);
    expect(report.duplicates[0]).toMatchObject({
      serviceKey: 'netflix',
      serviceName: 'Netflix',
      monthlyMinor: 3_848,
      annualMinor: 46_176,
    });
    expect(report.duplicates[0]?.streamIds).toHaveLength(2);
    expect(report.totals.duplicateCount).toBe(1);
  });

  it('marks a stream to cancel and reads the mark back through the account route', async () => {
    const practice = new PracticeLedger();
    const app = createApp({
      ledger: new CompositeLedger(new FixtureLedger() as never, practice, async () => false),
      practice,
      spendLogs: new InMemorySpendLogStore(subscriptionSpendFixture()),
      now: () => NOW,
    });

    const before = await app.request(`/api/accounts?id=${ACCOUNT}`);
    expect(before.status).toBe(200);
    const beforeBody = await before.json() as {
      subscriptions: { streams: { id: string; merchant: string; markedToCancel: boolean }[]; totals: { monthlyRunRateMinor: number } };
    };
    expect(beforeBody.subscriptions.totals.monthlyRunRateMinor).toBe(6_596);
    const netflix = beforeBody.subscriptions.streams.find((stream) => stream.merchant === 'Netflix');
    expect(netflix?.markedToCancel).toBe(false);

    const marked = await app.request(`/api/accounts/${ACCOUNT}/subscriptions/${netflix!.id}/mark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markedToCancel: true }),
    });
    expect(marked.status).toBe(200);

    const after = await app.request(`/api/accounts?id=${ACCOUNT}`);
    const afterBody = await after.json() as {
      subscriptions: { streams: { id: string; markedToCancel: boolean; markedAt: string | null }[] };
    };
    const markedNetflix = afterBody.subscriptions.streams.find((stream) => stream.id === netflix!.id);
    expect(markedNetflix?.markedToCancel).toBe(true);
    expect(markedNetflix?.markedAt).toBe(NOW.toISOString());

    const unmarked = await app.request(`/api/accounts/${ACCOUNT}/subscriptions/${netflix!.id}/mark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markedToCancel: false }),
    });
    expect(unmarked.status).toBe(200);
    const cleared = await app.request(`/api/accounts?id=${ACCOUNT}`);
    const clearedBody = await cleared.json() as { subscriptions: { streams: { id: string; markedToCancel: boolean }[] } };
    expect(clearedBody.subscriptions.streams.find((stream) => stream.id === netflix!.id)?.markedToCancel).toBe(false);
  });
});

describe('sample household subscriptions', () => {
  it('populates the practice wallet with realistic recurring streams', async () => {
    const practice = new PracticeLedger();
    const app = createApp({
      ledger: new CompositeLedger(new FixtureLedger() as never, practice, async () => false),
      practice,
      spendLogs: new InMemorySpendLogStore(),
      now: () => NOW,
    });
    const seeded = await app.request('/api/demo/practice', { method: 'POST' });
    expect(seeded.status).toBe(200);
    const body = await seeded.json() as { focusAccountId: string };
    const view = await app.request(`/api/accounts?id=${body.focusAccountId}`);
    const payload = await view.json() as { subscriptions: ReturnType<typeof buildSubscriptionReport> };

    expect(payload.subscriptions.totals.activeCount).toBeGreaterThanOrEqual(3);
    expect(payload.subscriptions.streams[0]?.priceHistory.length).toBeGreaterThanOrEqual(2);
    expect(payload.subscriptions.candidates.length).toBeGreaterThanOrEqual(1);
  });
});
