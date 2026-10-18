import { describe, expect, it } from 'vitest';
import { summarizeSpending, weeklySpendingStory } from '../src/server/spend-log.js';
import { fixtureSpendEntries, FIXTURE_NOW } from '../evals/spend-fixture.js';

describe('spend-log', () => {
  it('aggregates fixture spends', () => {
    const events = fixtureSpendEntries();
    expect(summarizeSpending(events, 30, FIXTURE_NOW).totalSpent).toBe('$312.00');
    const weekly = weeklySpendingStory(events, FIXTURE_NOW);
    expect(weekly.totalThisWeek).toBe('$230.00');
    expect(weekly.totalLastWeek).toBe('$82.00');
  });
});
