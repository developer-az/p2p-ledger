import { describe, expect, it } from 'vitest';
import { InMemorySpendLogStore, summarizeSpending, weeklySpendingStory } from '../src/server/spend-log.js';
import { fixtureSpendEntries, FIXTURE_NOW } from '../evals/spend-fixture.js';
import { ME } from '../evals/fixture.js';

describe('spend-log', () => {
  it('aggregates fixture spends', () => {
    const events = fixtureSpendEntries();
    expect(summarizeSpending(events, 30, FIXTURE_NOW).totalSpent).toBe('$312.00');
    const weekly = weeklySpendingStory(events, FIXTURE_NOW);
    expect(weekly.totalThisWeek).toBe('$230.00');
    expect(weekly.totalLastWeek).toBe('$82.00');
  });

  it('removes one manual log without touching the rest', async () => {
    const store = new InMemorySpendLogStore(fixtureSpendEntries());
    expect(await store.remove('me', 's1')).toBe(false);
    expect(await store.remove(ME, 's1')).toBe(true);
    expect(await store.list(ME, { limit: 50 })).toHaveLength(6);
    expect(await store.remove(ME, 's1')).toBe(false);
  });
});
