import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { InMemorySpendLogStore } from '../src/server/spend-log.js';
import { CompositeLedger, PracticeLedger, PRACTICE_ANTHONY, PRACTICE_SAM } from '../src/server/practice-ledger.js';
import { ScriptedProvider } from '../src/server/providers/scripted.js';
import type { LedgerAuditor, LedgerReader, LedgerWriter, Transfer, TransferRequest, WriteResult } from '../src/server/ledger.js';

class MemoryLedger implements LedgerReader, LedgerWriter, LedgerAuditor {
  private practice = new PracticeLedger();

  getAccount(id: string) { return this.practice.getAccount(id); }
  accountsByOwner(o: string) { return this.practice.accountsByOwner(o); }
  getTransfer(id: string) { return this.practice.getTransfer(id); }
  transfersForAccount(id: string, lim: number) { return this.practice.transfersForAccount(id, lim); }
  entries(id: string, lim: number) { return this.practice.entries(id, lim); }
  openAccount(o: string, c: string) { return this.practice.openAccount(o, c); }
  deposit(id: string, amt: number, key: string) { return this.practice.deposit(id, amt, key); }
  transfer(req: TransferRequest, key: string) { return this.practice.transfer(req, key); }
  async postTransfer(req: TransferRequest, key: string): Promise<WriteResult> {
    const transfer = await this.practice.transfer(req, key);
    return { status: 201, replayed: false, transfer };
  }
  async postDeposit(accountId: string, body: { amountMinor: number }, key: string): Promise<WriteResult> {
    const transfer = await this.practice.deposit(accountId, body.amountMinor, key);
    return { status: 201, replayed: false, transfer };
  }
  trail() { return Promise.resolve(null); }
  integrity() { return Promise.reject(new Error('unused')); }
  tamperChecks() { return Promise.resolve(null); }
  replay() { return Promise.reject(new Error('unused')); }
}

describe('POST /api/race', () => {
  it('posts one transfer for five parallel copies with the same key', async () => {
    const ledger = new MemoryLedger();
    const practice = new PracticeLedger();
    const app = createApp({
      ledger: new CompositeLedger(ledger, practice, async () => false),
      practice,
      spendLogs: new InMemorySpendLogStore(),
      provider: () => new ScriptedProvider([{ answer: 'ok' }]),
    });
    const res = await app.request('/api/race', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: PRACTICE_ANTHONY, fromAccountId: PRACTICE_SAM }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { distinctTransfers: number; copies: number; attempts: { replayed: boolean }[] };
    expect(body.copies).toBe(5);
    expect(body.distinctTransfers).toBe(1);
  });
});
