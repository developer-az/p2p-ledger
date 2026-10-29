import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { splitEvenly } from '../src/server/money.js';
import { InMemoryPaymentRequestStore } from '../src/server/payment-requests.js';
import {
  CompositeLedger,
  PRACTICE_ANTHONY,
  PRACTICE_JORDAN,
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
  const balance = async (id: string) => (await ledger.getAccount(id))!.balanceMinor;
  return { app, ledger, post, balance };
}

type RequestBody = { requests: { id: string; status: string; amountMinor: number }[] };

describe('splitEvenly', () => {
  it('always adds back to the total and gives leftover cents to the first shares', () => {
    expect(splitEvenly(1000, 3)).toEqual([334, 333, 333]);
    expect(splitEvenly(5, 8)).toEqual([1, 1, 1, 1, 1, 0, 0, 0]);
    for (const [total, parts] of [[1, 1], [999, 7], [123_457, 4], [0, 3]] as const) {
      const shares = splitEvenly(total, parts);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
      expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
    }
  });

  it('rejects impossible input', () => {
    expect(() => splitEvenly(100, 0)).toThrow();
    expect(() => splitEvenly(-1, 2)).toThrow();
    expect(() => splitEvenly(1.5, 2)).toThrow();
  });
});

describe('payment requests', () => {
  it('creates one request per person and lists them for both sides', async () => {
    const { app, post } = setup();
    const res = await post('/requests', {
      requesterAccountId: PRACTICE_ANTHONY,
      memo: 'Dinner',
      payers: [
        { accountId: PRACTICE_SAM, amountMinor: 2000 },
        { accountId: PRACTICE_JORDAN, amountMinor: 2000 },
      ],
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as RequestBody).requests).toHaveLength(2);

    const sam = await (await app.request(`/api/requests?accountId=${PRACTICE_SAM}`)).json() as {
      incoming: { memo: string; amount: string; requester: { owner: string } }[]; outgoing: unknown[];
    };
    expect(sam.incoming).toHaveLength(1);
    expect(sam.incoming[0]).toMatchObject({ memo: 'Dinner', amount: '$20.00', requester: { owner: 'anthony' } });
    expect(sam.outgoing).toHaveLength(0);
    const anthony = await (await app.request(`/api/requests?accountId=${PRACTICE_ANTHONY}`)).json() as { outgoing: unknown[] };
    expect(anthony.outgoing).toHaveLength(2);
  });

  it('refuses asking yourself, asking someone twice, and unknown accounts', async () => {
    const { post } = setup();
    const base = { requesterAccountId: PRACTICE_ANTHONY };
    expect((await post('/requests', { ...base, payers: [{ accountId: PRACTICE_ANTHONY, amountMinor: 100 }] })).status).toBe(400);
    expect((await post('/requests', {
      ...base,
      payers: [{ accountId: PRACTICE_SAM, amountMinor: 100 }, { accountId: PRACTICE_SAM, amountMinor: 100 }],
    })).status).toBe(400);
    expect((await post('/requests', {
      ...base,
      payers: [{ accountId: '01111111-1111-7111-8111-1111111119ff', amountMinor: 100 }],
    })).status).toBe(404);
  });

  it('moves money once even when the payer clicks pay twice at the same moment', async () => {
    const { post, balance } = setup();
    const created = await (await post('/requests', {
      requesterAccountId: PRACTICE_ANTHONY,
      payers: [{ accountId: PRACTICE_SAM, amountMinor: 2500 }],
    })).json() as RequestBody;
    const id = created.requests[0]!.id;
    const [anthonyBefore, samBefore] = [await balance(PRACTICE_ANTHONY), await balance(PRACTICE_SAM)];

    const results = await Promise.all([
      post(`/requests/${id}/pay`, { accountId: PRACTICE_SAM }),
      post(`/requests/${id}/pay`, { accountId: PRACTICE_SAM }),
      post(`/requests/${id}/pay`, { accountId: PRACTICE_SAM }),
    ]);
    const bodies = await Promise.all(results.map((r) => r.json())) as { request: { status: string; transferId: string }; transfer: { id: string } }[];

    expect(new Set(bodies.map((b) => b.transfer.id)).size).toBe(1);
    expect(bodies.every((b) => b.request.status === 'PAID')).toBe(true);
    expect(await balance(PRACTICE_ANTHONY)).toBe(anthonyBefore + 2500);
    expect(await balance(PRACTICE_SAM)).toBe(samBefore - 2500);
  });

  it('keeps a request open after a decline and lets the payer try again once funded', async () => {
    const { app, post, balance } = setup();
    const created = await (await post('/requests', {
      requesterAccountId: PRACTICE_ANTHONY,
      payers: [{ accountId: PRACTICE_JORDAN, amountMinor: 10_000 }],
    })).json() as RequestBody;
    const id = created.requests[0]!.id;

    const declined = await (await post(`/requests/${id}/pay`, { accountId: PRACTICE_JORDAN })).json() as {
      request: { status: string; declinedAttempts: number };
      transfer: { status: string; rejectionReason: string; declineExplanation: string };
    };
    expect(declined.transfer).toMatchObject({ status: 'REJECTED', rejectionReason: 'INSUFFICIENT_FUNDS' });
    expect(declined.transfer.declineExplanation).toMatch(/enough balance/);
    expect(declined.request).toMatchObject({ status: 'PENDING', declinedAttempts: 1 });

    expect((await post(`/accounts/${PRACTICE_JORDAN}/deposits`, { amountMinor: 20_000 })).status).toBe(201);
    const jordanBefore = await balance(PRACTICE_JORDAN);
    const paid = await (await post(`/requests/${id}/pay`, { accountId: PRACTICE_JORDAN })).json() as {
      request: { status: string }; transfer: { status: string };
    };
    expect(paid.transfer.status).toBe('COMPLETED');
    expect(paid.request.status).toBe('PAID');
    expect(await balance(PRACTICE_JORDAN)).toBe(jordanBefore - 10_000);

    const listed = await (await app.request(`/api/requests?accountId=${PRACTICE_JORDAN}`)).json() as {
      incoming: { status: string }[];
    };
    expect(listed.incoming[0]!.status).toBe('PAID');
  });

  it('only lets the right person act, and only while the request is pending', async () => {
    const { post } = setup();
    const created = await (await post('/requests', {
      requesterAccountId: PRACTICE_ANTHONY,
      payers: [{ accountId: PRACTICE_SAM, amountMinor: 500 }],
    })).json() as RequestBody;
    const id = created.requests[0]!.id;

    expect((await post(`/requests/${id}/pay`, { accountId: PRACTICE_JORDAN })).status).toBe(403);
    expect((await post(`/requests/${id}/decline`, { accountId: PRACTICE_ANTHONY })).status).toBe(403);
    expect((await post(`/requests/${id}/cancel`, { accountId: PRACTICE_SAM })).status).toBe(403);

    expect((await post(`/requests/${id}/decline`, { accountId: PRACTICE_SAM })).status).toBe(200);
    expect((await post(`/requests/${id}/decline`, { accountId: PRACTICE_SAM })).status).toBe(409);
    expect((await post(`/requests/${id}/pay`, { accountId: PRACTICE_SAM })).status).toBe(409);
    expect((await post(`/requests/${id}/cancel`, { accountId: PRACTICE_ANTHONY })).status).toBe(409);
    expect((await post('/requests/00000000-0000-4000-8000-000000000000/pay', { accountId: PRACTICE_SAM })).status).toBe(404);
  });

  it('lets the requester cancel a pending request', async () => {
    const { post } = setup();
    const created = await (await post('/requests', {
      requesterAccountId: PRACTICE_ANTHONY,
      payers: [{ accountId: PRACTICE_SAM, amountMinor: 500 }],
    })).json() as RequestBody;
    const res = await post(`/requests/${created.requests[0]!.id}/cancel`, { accountId: PRACTICE_ANTHONY });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { request: { status: string } }).request.status).toBe('CANCELLED');
  });
});
