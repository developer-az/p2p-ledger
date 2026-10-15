import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { CompositeLedger, PRACTICE_ALEX, PRACTICE_RENT_TRANSFER, PRACTICE_SAM, PracticeLedger } from '../src/server/practice-ledger.js';
import { ScriptedProvider } from '../src/server/providers/scripted.js';
import type { LedgerWriter } from '../src/server/ledger.js';

const rejectWriter: LedgerWriter = {
  openAccount: () => Promise.reject(new Error('live down')),
  deposit: () => Promise.reject(new Error('live down')),
  transfer: () => Promise.reject(new Error('live down')),
};

describe('practice ledger', () => {
  const practice = new PracticeLedger();
  const ledger = new CompositeLedger(rejectWriter, practice, async () => false);
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
