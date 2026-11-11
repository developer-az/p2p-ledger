import { describe, expect, it } from 'vitest';
import type { AccountView } from '../src/web/api.js';
import { buildFeed } from '../src/web/app/feed.js';
import { monthIncomeSummary } from '../src/web/app/money-plan.js';

/**
 * The practice household's +$5,000 "Added from bank" row is a ledger deposit.
 * A deposit moves money the person already owns onto the ledger, so it is money
 * in the balance, not income. Only income the person logged counts toward the
 * month income figure, and the tile says so.
 */
function household(incomeMinor: number): AccountView {
  return {
    balance: '$5,000.00',
    transfers: [
      {
        transferId: 'p-dep-anthony',
        direction: 'deposit',
        counterparty: 'Bank',
        amount: '$5,000.00',
        status: 'COMPLETED',
        declineReason: null,
        declineExplanation: null,
        memo: 'Added from bank',
        createdAt: '2026-10-02T12:00:00.000Z',
        counterpartyAccountId: 'funding',
        kind: 'DEPOSIT',
      },
    ],
    activityFeed: [
      {
        id: 'income-1',
        kind: 'logged_income',
        amount: '$2,500.00',
        detail: 'Salary · October pay',
        category: 'salary',
        occurredAt: '2026-10-03T12:00:00.000Z',
        spendId: null,
      },
    ],
    patterns: {
      month: { incomeMinor, spentMinor: 0, projectedSpendMinor: 0 },
    },
  } as unknown as AccountView;
}

describe('month income tile', () => {
  it('counts logged income and leaves bank deposits in the balance', () => {
    const view = household(250_000);
    const feed = buildFeed(view);

    expect(feed).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'deposit', title: 'Added from bank', signedMinor: 500_000 }),
      expect.objectContaining({ kind: 'income', signedMinor: 250_000 }),
    ]));
    expect(monthIncomeSummary(view).minor).toBe(250_000);
    expect(monthIncomeSummary(view).label).toBe('Income logged this month');
    expect(monthIncomeSummary(view).note).toContain('Bank transfers');
  });

  it('shows zero when the only money in is a deposit', () => {
    const view = household(0);
    const feed = buildFeed(view);

    expect(feed.some((item) => item.kind === 'deposit' && item.signedMinor === 500_000)).toBe(true);
    expect(monthIncomeSummary(view).minor).toBe(0);
  });
});
