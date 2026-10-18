import { InMemorySpendLogStore, type SpendLogEntry } from '../src/server/spend-log.js';
import { ME, NOW } from './fixture.js';

export function fixtureSpendEntries(): SpendLogEntry[] {
  const row = (
    id: string,
    amountMinor: number,
    category: SpendLogEntry['category'],
    occurredAt: string,
    note: string | null,
  ): SpendLogEntry => ({
    id,
    accountId: ME,
    amountMinor,
    currency: 'USD',
    category,
    note,
    occurredAt,
    source: 'manual',
    createdAt: occurredAt,
  });
  return [
    row('s1', 2_200, 'dining', '2026-09-28T18:00:00Z', 'Takeout'),
    row('s2', 6_000, 'groceries', '2026-09-30T12:00:00Z', 'Trader run'),
    row('s3', 3_200, 'transport', '2026-10-04T08:30:00Z', 'Transit pass'),
    row('s4', 4_500, 'groceries', '2026-10-05T17:45:00Z', 'Groceries'),
    row('s5', 12_000, 'entertainment', '2026-10-06T20:00:00Z', 'Concert'),
    row('s6', 1_800, 'dining', '2026-10-07T09:00:00Z', 'Coffee runs'),
    row('s7', 1_500, 'dining', '2026-10-08T11:00:00Z', 'Lunch'),
  ];
}

export function fixtureSpendLogStore() {
  return new InMemorySpendLogStore(fixtureSpendEntries());
}

export const FIXTURE_NOW = NOW;
