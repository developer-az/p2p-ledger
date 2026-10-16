import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { CompositeLedger, PracticeLedger, PRACTICE_ALEX, PRACTICE_SAM } from '../src/server/practice-ledger.js';
import { ScriptedProvider } from '../src/server/providers/scripted.js';
import type { LedgerReader, LedgerWriter } from '../src/server/ledger.js';

function practiceApp() {
  const practice = new PracticeLedger();
  const stub: LedgerReader & LedgerWriter = {
    getAccount: (id) => practice.getAccount(id),
    accountsByOwner: (o) => practice.accountsByOwner(o),
    getTransfer: (id) => practice.getTransfer(id),
    transfersForAccount: (id, lim) => practice.transfersForAccount(id, lim),
    entries: (id, lim) => practice.entries(id, lim),
    openAccount: (o, c) => practice.openAccount(o, c),
    deposit: (id, amt, key) => practice.deposit(id, amt, key),
    transfer: (req, key) => practice.transfer(req, key),
  };
  return createApp({
    ledger: new CompositeLedger(stub, practice, async () => false),
    practice,
    provider: () => new ScriptedProvider([{ answer: 'ok' }]),
  });
}

describe('POST /api/race', () => {
  it('posts one transfer for five parallel copies with the same key', async () => {
    const app = practiceApp();
    const res = await app.request('/api/race', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: PRACTICE_ALEX, fromAccountId: PRACTICE_SAM }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { distinctTransfers: number; copies: number };
    expect(body.copies).toBe(5);
    expect(body.distinctTransfers).toBe(1);
  });
});
