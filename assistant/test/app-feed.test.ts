import { describe, expect, it } from 'vitest';
import type { AccountView } from '../src/web/api.js';
import { buildFeed, filterFeed } from '../src/web/app/feed.js';

const view = {
  id: 'a', owner: 'alex-4b4792', balance: '$100.00', currency: 'USD', openedAt: '2026-10-01T00:00:00Z',
  summary: { sent: '$0.00', received: '$0.00', deposited: '$0.00', stopped: '$0.00', declinedCount: 1 },
  transfers: [
    { transferId: 't1', direction: 'sent', counterparty: 'sam-4b4792', amount: '$42.50', status: 'COMPLETED', declineReason: null, declineExplanation: null, memo: 'Pizza night', createdAt: '2026-10-18T12:00:00Z', counterpartyAccountId: 's', kind: 'TRANSFER' },
    { transferId: 't2', direction: 'received', counterparty: 'sam-4b4792', amount: '$18.00', status: 'COMPLETED', declineReason: null, declineExplanation: null, memo: null, createdAt: '2026-10-17T12:00:00Z', counterpartyAccountId: 's', kind: 'TRANSFER' },
    { transferId: 't3', direction: 'sent', counterparty: 'jordan-4b4792', amount: '$1,200.00', status: 'REJECTED', declineReason: 'NEW_ACCOUNT_LARGE_TRANSFER', declineExplanation: 'too big', memo: 'Rent', createdAt: '2026-10-16T12:00:00Z', counterpartyAccountId: 'j', kind: 'TRANSFER' },
    { transferId: 't4', direction: 'deposit', counterparty: 'Bank funding', amount: '$5,000.00', status: 'COMPLETED', declineReason: null, declineExplanation: null, memo: 'Bank deposit', createdAt: '2026-10-15T12:00:00Z', counterpartyAccountId: 'f', kind: 'DEPOSIT' },
  ],
  activityFeed: [
    { id: 'spend-1', kind: 'logged', label: 'You logged', detail: 'dining · Coffee with Sam', amount: '$4.50', occurredAt: '2026-10-18T09:00:00Z', category: 'dining' },
    { id: 'income-1', kind: 'logged_income', label: 'Income logged', detail: 'salary', amount: '$900.00', occurredAt: '2026-10-14T09:00:00Z', category: 'salary' },
    { id: 'xfer-t1', kind: 'paid', label: 'Paid out', detail: 'x', amount: '$42.50', occurredAt: '2026-10-18T12:00:00Z', transferId: 't1' },
  ],
} as unknown as AccountView;

describe('buildFeed', () => {
  const feed = buildFeed(view);

  it('merges ledger rows and logs without duplicating transfers, newest first', () => {
    expect(feed.map((i) => i.id)).toEqual(['x-t1', 'spend-1', 'x-t2', 'x-t3', 'x-t4', 'income-1']);
  });

  it('signs amounts from the wallet owner point of view', () => {
    const byId = Object.fromEntries(feed.map((i) => [i.id, i]));
    expect(byId['x-t1']).toMatchObject({ kind: 'sent', signedMinor: -4250, title: 'Pizza night', subtitle: 'To Sam' });
    expect(byId['x-t2']).toMatchObject({ kind: 'received', signedMinor: 1800, title: 'From Sam' });
    expect(byId['x-t4']).toMatchObject({ kind: 'deposit', signedMinor: 500_000 });
    expect(byId['spend-1']).toMatchObject({ kind: 'spend', signedMinor: -450, title: 'Coffee with Sam' });
    expect(byId['income-1']).toMatchObject({ kind: 'income', signedMinor: 90_000 });
  });

  it('keeps the decline reason on blocked payments', () => {
    const declined = feed.find((i) => i.kind === 'declined')!;
    expect(declined).toMatchObject({ declineReason: 'NEW_ACCOUNT_LARGE_TRANSFER', subtitle: 'Declined · To Jordan' });
  });
});

describe('filterFeed', () => {
  const feed = buildFeed(view);
  it('filters by kind', () => {
    expect(filterFeed(feed, 'declined', '').map((i) => i.id)).toEqual(['x-t3']);
    expect(filterFeed(feed, 'spending', '').map((i) => i.id)).toEqual(['spend-1']);
    expect(filterFeed(feed, 'payments', '').map((i) => i.id)).toEqual(['x-t1', 'x-t2', 'x-t4']);
  });
  it('searches titles and names', () => {
    expect(filterFeed(feed, 'all', 'sam').map((i) => i.id)).toEqual(['x-t1', 'spend-1', 'x-t2']);
    expect(filterFeed(feed, 'all', 'nothing like this')).toEqual([]);
  });
});
