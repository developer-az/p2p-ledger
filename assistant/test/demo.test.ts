import { describe, expect, it } from 'vitest';
import { RENT_AMOUNT_MINOR, RENT_MEMO, seedDemo } from '../src/server/demo.js';
import type { Account, LedgerWriter, Transfer } from '../src/server/ledger.js';

function writer(): LedgerWriter & { transfers: Transfer[] } {
  const transfers: Transfer[] = [];
  let n = 0;
  const account = (ownerId: string): Account => ({
    id: `00000000-0000-7000-8000-${String(++n).padStart(12, '0')}`,
    ownerId, currency: 'USD', type: 'USER', balanceMinor: 0, createdAt: new Date().toISOString(),
  });
  const transfer = (req: { sourceAccountId: string; destinationAccountId: string; amountMinor: number; currency: string; memo?: string }, kind: Transfer['kind']): Transfer => {
    const rejected = kind === 'TRANSFER' && req.amountMinor > 100_000;
    const row: Transfer = {
      id: `t-${++n}`,
      kind,
      sourceAccountId: req.sourceAccountId,
      destinationAccountId: req.destinationAccountId,
      amountMinor: req.amountMinor,
      currency: req.currency,
      memo: req.memo ?? null,
      status: rejected ? 'REJECTED' : 'COMPLETED',
      rejectionReason: rejected ? 'NEW_ACCOUNT_LARGE_TRANSFER' : null,
      createdAt: new Date().toISOString(),
    };
    transfers.push(row);
    return row;
  };
  return {
    transfers,
    openAccount: (ownerId) => Promise.resolve(account(ownerId)),
    deposit: (accountId, amountMinor, _key) => Promise.resolve(transfer({
      sourceAccountId: 'funding', destinationAccountId: accountId, amountMinor, currency: 'USD', memo: 'deposit',
    }, 'DEPOSIT')),
    transfer: (req) => Promise.resolve(transfer(req, 'TRANSFER')),
  };
}

describe('seedDemo', () => {
  it('returns the sender and the declined rent transfer from the ledger', async () => {
    const ledger = writer();
    const result = await seedDemo(ledger);
    expect(result.focusAccountId).toBe(result.accounts[0]?.id);
    expect(result.stopped).toMatchObject({
      status: 'REJECTED',
      amount: '$1,200.00',
      memo: RENT_MEMO,
      reason: 'NEW_ACCOUNT_LARGE_TRANSFER',
    });
    expect(ledger.transfers.some((t) => t.memo === RENT_MEMO && t.amountMinor === RENT_AMOUNT_MINOR && t.status === 'REJECTED')).toBe(true);
  });
});
