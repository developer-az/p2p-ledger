import { describe, expect, it } from 'vitest';
import { buildActivityFeed } from '../src/server/money-insights.js';
import { formatMoney } from '../src/server/money.js';
import type { AccountActivity } from '../src/server/tools.js';
import { fixtureSpendEntries } from '../evals/spend-fixture.js';

const xfer = (id: string, createdAt: string): AccountActivity => ({
  transferId: id,
  direction: 'sent',
  counterparty: 'sam',
  counterpartyAccountId: 'b',
  kind: 'TRANSFER',
  amount: '$10.00',
  status: 'COMPLETED',
  declineReason: null,
  declineExplanation: null,
  memo: 'lunch',
  createdAt,
});

describe('buildActivityFeed', () => {
  it('merges spends and transfers newest first', () => {
    const spends = fixtureSpendEntries();
    const feed = buildActivityFeed([xfer('t1', '2026-10-09T12:00:00Z')], spends, formatMoney);
    expect(feed[0]?.kind).toBe('paid');
    expect(feed.some((r) => r.kind === 'logged')).toBe(true);
    expect(feed.filter((r) => r.kind === 'logged').length).toBe(7);
  });
});
