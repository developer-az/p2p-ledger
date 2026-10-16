import { describe, expect, it } from 'vitest';
import { listPeerRefs, peerLedgerView } from '../src/server/peer-ledger.js';
import type { Account, LedgerReader, Transfer } from '../src/server/ledger.js';

const A = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';

function ledgerWith(transfers: Transfer[]): LedgerReader {
  const accounts = new Map<string, Account>([
    [A, { id: A, ownerId: 'alex-x', currency: 'USD', type: 'USER', balanceMinor: 1000, createdAt: '2026-01-01T00:00:00Z' }],
    [B, { id: B, ownerId: 'sam-y', currency: 'USD', type: 'USER', balanceMinor: 500, createdAt: '2026-01-01T00:00:00Z' }],
  ]);
  return {
    getAccount: (id) => Promise.resolve(accounts.get(id) ?? null),
    accountsByOwner: (owner) => Promise.resolve([...accounts.values()].filter((a) => a.ownerId === owner)),
    getTransfer: () => Promise.resolve(null),
    transfersForAccount: () => Promise.resolve(transfers),
    entries: () => Promise.resolve([]),
  };
}

describe('peer-ledger', () => {
  it('lists peers from transfer history', async () => {
    const t: Transfer = {
      id: 't1', kind: 'TRANSFER', sourceAccountId: A, destinationAccountId: B, amountMinor: 100,
      currency: 'USD', memo: 'x', status: 'COMPLETED', rejectionReason: null, createdAt: new Date().toISOString(),
    };
    const peers = await listPeerRefs(ledgerWith([t]), A);
    expect(peers).toEqual([{ id: B, owner: 'sam-y' }]);
  });

  it('summarizes bilateral activity', async () => {
    const now = new Date().toISOString();
    const transfers: Transfer[] = [
      {
        id: 't1', kind: 'TRANSFER', sourceAccountId: A, destinationAccountId: B, amountMinor: 400,
        currency: 'USD', memo: 'lunch', status: 'COMPLETED', rejectionReason: null, createdAt: now,
      },
      {
        id: 't2', kind: 'TRANSFER', sourceAccountId: B, destinationAccountId: A, amountMinor: 200,
        currency: 'USD', memo: 'uber', status: 'COMPLETED', rejectionReason: null, createdAt: now,
      },
    ];
    const view = await peerLedgerView(ledgerWith(transfers), A, B, 30, 10);
    expect(view?.sentToPeer).toBe('$4.00');
    expect(view?.receivedFromPeer).toBe('$2.00');
    expect(view?.transfers).toHaveLength(2);
  });
});
