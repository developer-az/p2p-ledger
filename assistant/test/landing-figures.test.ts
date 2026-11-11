import { describe, expect, it } from 'vitest';
import { landingFigures, type LandingFigureInput } from '../src/web/app/landing-figures.js';
import { createApp } from '../src/server/app.js';
import { InMemoryAuthStore } from '../src/server/auth.js';
import { CompositeLedger, PRACTICE_ANTHONY, PracticeLedger } from '../src/server/practice-ledger.js';
import { InMemorySpendLogStore } from '../src/server/spend-log.js';

function entry(id: string, amountMinor: number, category: string, note: string | null, occurredAt: string) {
  return { id, amount: (amountMinor / 100).toFixed(2), amountMinor, category, note, occurredAt };
}

function view(entries: ReturnType<typeof entry>[], totals?: { spend30dMinor: number; top?: { category: string; sharePct: number } | null }): LandingFigureInput {
  return {
    spendEntries: entries as LandingFigureInput['spendEntries'],
    patterns: totals
      ? ({
          totals: {
            spend30dMinor: totals.spend30dMinor,
            topCategory: totals.top ? { category: totals.top.category, sharePct: totals.top.sharePct } : null,
          },
        } as LandingFigureInput['patterns'])
      : undefined,
  };
}

describe('landingFigures', () => {
  it('counts rows, distinct payees, distinct categories and days of history', () => {
    const figures = landingFigures(view([
      entry('a', 450, 'food', 'Blue Bottle', '2026-11-01T09:00:00.000Z'),
      entry('b', 1250, 'food', '  blue bottle ', '2026-11-03T09:00:00.000Z'),
      entry('c', 9900, 'shopping', 'Target', '2026-11-05T18:00:00.000Z'),
      entry('d', 300, 'transport', null, '2026-11-10T07:30:00.000Z'),
      entry('e', 200, 'transport', '', '2026-11-10T08:30:00.000Z'),
    ], { spend30dMinor: 12100, top: { category: 'shopping', sharePct: 82 } }));

    expect(figures).toEqual({
      rows: 5,
      payees: 2,
      categories: 3,
      daysOfHistory: 10,
      spend30dMinor: 12100,
      topCategory: 'shopping',
      topCategorySharePct: 82,
    });
  });

  it('returns zeros and nulls for an empty view', () => {
    expect(landingFigures({})).toEqual({
      rows: 0,
      payees: 0,
      categories: 0,
      daysOfHistory: 0,
      spend30dMinor: 0,
      topCategory: null,
      topCategorySharePct: null,
    });
  });

  it('counts one day of history when every row falls on the same day', () => {
    const figures = landingFigures(view([
      entry('a', 100, 'food', 'A', '2026-11-10T01:00:00.000Z'),
      entry('b', 100, 'food', 'B', '2026-11-10T22:00:00.000Z'),
    ]));
    expect(figures.daysOfHistory).toBe(1);
    expect(figures.spend30dMinor).toBe(0);
    expect(figures.topCategory).toBeNull();
  });

  it('returns integers only', () => {
    const figures = landingFigures(view([
      entry('a', 333, 'food', 'A', '2026-10-01T00:00:00.000Z'),
      entry('b', 333, 'fun', 'B', '2026-10-15T12:00:00.000Z'),
    ], { spend30dMinor: 666, top: { category: 'food', sharePct: 50 } }));
    for (const value of Object.values(figures)) {
      if (typeof value === 'number') expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('gives non-zero figures for the real sample household', async () => {
    const practice = new PracticeLedger();
    const api = createApp({
      ledger: new CompositeLedger(practice as never, practice, async () => false),
      practice,
      spendLogs: new InMemorySpendLogStore(),
      auth: new InMemoryAuthStore(),
      now: () => new Date('2026-11-10T15:00:00.000Z'),
    });
    const res = await api.request(`/api/accounts?id=${PRACTICE_ANTHONY}`);
    expect(res.status).toBe(200);
    const figures = landingFigures(await res.json() as LandingFigureInput);
    expect(figures.rows).toBeGreaterThan(10);
    expect(figures.payees).toBeGreaterThan(0);
    expect(figures.categories).toBeGreaterThan(1);
    expect(figures.daysOfHistory).toBeGreaterThan(7);
    expect(figures.spend30dMinor).toBeGreaterThan(0);
    expect(figures.topCategory).not.toBeNull();
  });
});
