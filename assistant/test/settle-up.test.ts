import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { InMemoryPaymentRequestStore } from '../src/server/payment-requests.js';
import {
  CompositeLedger,
  PRACTICE_ALEX,
  PRACTICE_SAM,
  PracticeLedger,
} from '../src/server/practice-ledger.js';
import { fixtureSpendLogStore } from '../evals/spend-fixture.js';
import type { LedgerAuditor, LedgerReader, LedgerWriter } from '../src/server/ledger.js';

function setup() {
  const practice = new PracticeLedger();
  const unused = { getAccount: async () => null } as unknown as LedgerReader & LedgerWriter & LedgerAuditor;
  const ledger = new CompositeLedger(unused, practice, async () => false);
  const app = createApp({
    ledger,
    practice,
    spendLogs: fixtureSpendLogStore(),
    paymentRequests: new InMemoryPaymentRequestStore(),
  });
  const post = (path: string, body: unknown) => app.request(`/api${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
  return { app, post };
}

type RequestView = {
  request: { id: string; status: string; settledVia: string | null; transferId: string | null };
};

async function createAsk(post: (path: string, body: unknown) => Promise<Response> | Response) {
  const res = await post('/requests', {
    requesterAccountId: PRACTICE_ALEX,
    memo: 'Ski house',
    payers: [{ accountId: PRACTICE_SAM, amountMinor: 4_200 }],
  });
  expect(res.status).toBe(201);
  const body = await res.json() as { requests: { id: string }[] };
  return body.requests[0]!.id;
}

describe('POST /api/requests/:id/settle', () => {
  it('lets the requester record an outside settlement with the rail on the receipt', async () => {
    const { post } = setup();
    const id = await createAsk(post);
    const res = await post(`/requests/${id}/settle`, { accountId: PRACTICE_ALEX, settledVia: 'zelle' });
    expect(res.status).toBe(200);
    const { request } = await res.json() as RequestView;
    expect(request.status).toBe('PAID');
    expect(request.settledVia).toBe('zelle');
    expect(request.transferId).toBeNull();
  });

  it('rejects every supported rail and refuses unknown ones', async () => {
    const { post } = setup();
    for (const rail of ['cashapp', 'venmo', 'cash', 'crypto', 'other']) {
      const id = await createAsk(post);
      const res = await post(`/requests/${id}/settle`, { accountId: PRACTICE_ALEX, settledVia: rail });
      expect(res.status).toBe(200);
      expect(((await res.json()) as RequestView).request.settledVia).toBe(rail);
    }
    const bad = await createAsk(post);
    expect((await post(`/requests/${bad}/settle`, { accountId: PRACTICE_ALEX, settledVia: 'wire' })).status).toBe(400);
    expect((await post(`/requests/${bad}/settle`, { accountId: PRACTICE_ALEX })).status).toBe(400);
  });

  it('only lets the person who asked record the settlement', async () => {
    const { post } = setup();
    const id = await createAsk(post);
    const res = await post(`/requests/${id}/settle`, { accountId: PRACTICE_SAM, settledVia: 'cash' });
    expect(res.status).toBe(403);
  });

  it('cannot settle a request twice or after it was paid in-app', async () => {
    const { post } = setup();
    const id = await createAsk(post);
    expect((await post(`/requests/${id}/settle`, { accountId: PRACTICE_ALEX, settledVia: 'cash' })).status).toBe(200);
    expect((await post(`/requests/${id}/settle`, { accountId: PRACTICE_ALEX, settledVia: 'cash' })).status).toBe(409);

    const second = await createAsk(post);
    expect((await post(`/requests/${second}/pay`, { accountId: PRACTICE_SAM })).status).toBe(200);
    const late = await post(`/requests/${second}/settle`, { accountId: PRACTICE_ALEX, settledVia: 'crypto' });
    expect(late.status).toBe(409);
    expect(((await late.json()) as RequestView).request.settledVia).toBeNull();
  });

  it('404s an unknown request', async () => {
    const { post } = setup();
    const res = await post('/requests/00000000-0000-4000-8000-000000000000/settle', {
      accountId: PRACTICE_ALEX,
      settledVia: 'zelle',
    });
    expect(res.status).toBe(404);
  });
});