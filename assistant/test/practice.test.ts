import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { CompositeLedger, PRACTICE_ALEX, PRACTICE_RENT_TRANSFER, PRACTICE_SAM, PracticeLedger } from '../src/server/practice-ledger.js';
import { ScriptedProvider } from '../src/server/providers/scripted.js';
import type { LedgerReader, LedgerWriter } from '../src/server/ledger.js';

const rejectLive: LedgerReader & LedgerWriter = {
  getAccount: () => Promise.reject(new Error('live down')),
  accountsByOwner: () => Promise.resolve([]),
  getTransfer: () => Promise.reject(new Error('live down')),
  transfersForAccount: () => Promise.resolve([]),
  entries: () => Promise.resolve([]),
  openAccount: () => Promise.reject(new Error('live down')),
  deposit: () => Promise.reject(new Error('live down')),
  transfer: () => Promise.reject(new Error('live down')),
};

describe('practice ledger', () => {
  const practice = new PracticeLedger();
  const ledger = new CompositeLedger(rejectLive, practice, async () => false);
  const app = createApp({
    ledger,
    practice,
    isLiveLedgerUp: async () => false,
    provider: () => new ScriptedProvider([{ answer: 'Hello!' }]),
  });

  it('serves bootstrap without a live ledger', async () => {
    const res = await app.request('/api/bootstrap');
    expect(res.status).toBe(200);
    const body = await res.json() as { live: boolean; practice: { focusAccountId: string; stoppedTransferId: string } };
    expect(body.live).toBe(false);
    expect(body.practice.focusAccountId).toBe(PRACTICE_ALEX);
    expect(body.practice.stoppedTransferId).toBe(PRACTICE_RENT_TRANSFER);
  });

  it('completes a practice transfer between peers', async () => {
    const res = await app.request('/api/transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'test-1' },
      body: JSON.stringify({
        sourceAccountId: PRACTICE_ALEX,
        destinationAccountId: PRACTICE_SAM,
        amountMinor: 100,
        currency: 'USD',
        memo: 'test tip',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('COMPLETED');
  });

  it('does not offer practice peers for a live-only wallet', async () => {
    const liveId = '01a1422e-888a-7188-a250-d869574a8191';
    const liveOnly: LedgerReader & LedgerWriter = {
      ...rejectLive,
      getAccount: (id) => Promise.resolve(
        id === liveId
          ? { id: liveId, ownerId: 'live-user', currency: 'USD', type: 'USER', balanceMinor: 0, createdAt: new Date().toISOString() }
          : null,
      ),
      transfersForAccount: () => Promise.resolve([]),
    };
    const liveApp = createApp({
      ledger: new CompositeLedger(liveOnly, practice, async () => true),
      practice,
      isLiveLedgerUp: async () => true,
      provider: () => new ScriptedProvider([{ answer: 'Hello!' }]),
    });
    const res = await liveApp.request(`/api/peers?accountId=${liveId}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('loads Alex with a declined rent payment', async () => {
    const res = await app.request(`/api/accounts?id=${PRACTICE_ALEX}`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      owner: string;
      balance: string;
      transfers: { status: string; memo: string | null; declineExplanation: string | null }[];
    };
    expect(body.owner).toBe('alex');
    expect(body.balance).toMatch(/^\$/);
    const rent = body.transfers.find((t) => t.memo?.includes('Rent'));
    expect(rent).toMatchObject({ status: 'REJECTED' });
    expect(rent?.declineExplanation).toMatch(/24 hours/i);
  });
});
