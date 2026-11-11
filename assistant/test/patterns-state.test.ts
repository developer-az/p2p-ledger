import { describe, expect, it } from 'vitest';
import { patternsState } from '../src/web/app/pattern-insights.js';

type Arg = Parameters<typeof patternsState>[0];

const entry = (occurredAt: string) => ({
  id: occurredAt, amount: '$5.00', amountMinor: 500, category: 'coffee', note: null, occurredAt,
});

const withCategories = (n: number) => ({
  categories: Array.from({ length: n }, (_, i) => ({ category: `c${i}`, totalMinor: 100 })),
});

describe('patternsState', () => {
  it('is "none" when nothing was ever logged', () => {
    expect(patternsState({ spendEntries: [], patterns: withCategories(0) } as unknown as Arg)).toEqual({ kind: 'none' });
    expect(patternsState({} as unknown as Arg)).toEqual({ kind: 'none' });
  });

  it('is "stale" with the newest log date when logs exist but none in the 30-day window', () => {
    const view = {
      spendEntries: [entry('2026-08-01T10:00:00.000Z'), entry('2026-09-14T09:30:00.000Z'), entry('2026-07-02T08:00:00.000Z')],
      patterns: withCategories(0),
    };
    expect(patternsState(view as unknown as Arg)).toEqual({ kind: 'stale', lastLoggedAt: '2026-09-14T09:30:00.000Z' });
  });

  it('is "ready" whenever the 30-day window has categories', () => {
    const view = { spendEntries: [entry('2026-11-09T10:00:00.000Z')], patterns: withCategories(2) };
    expect(patternsState(view as unknown as Arg)).toEqual({ kind: 'ready' });
  });

  it('is "ready" even if spendEntries was not sent but categories exist', () => {
    expect(patternsState({ patterns: withCategories(1) } as unknown as Arg)).toEqual({ kind: 'ready' });
  });
});
