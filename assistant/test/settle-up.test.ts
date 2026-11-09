import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, PRACTICE_REQUEST_UTILITIES } from '../src/server/app.js';
import { InMemoryPaymentRequestStore } from '../src/server/payment-requests.js';
import {
  CompositeLedger,
  PRACTICE_ANTHONY,
  PRACTICE_SAM,
  PracticeLedger,
} from '../src/server/practice-ledger.js';
import { fixtureSpendLogStore } from '../evals/spend-fixture.js';
import type { LedgerAuditor, LedgerReader, LedgerWriter } from '../src/server/ledger.js';
import { PRACTICE_ANTHONY_ID } from '../src/web/practice-fixture.js';
import { applyResolvedOverlay, rememberResolved } from '../src/web/app/settle-overlay.js';
import { assertPaid } from '../src/web/app/SettleUp.js';
import type { PaymentRequestView } from '../src/web/api.js';

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
    requesterAccountId: PRACTICE_ANTHONY,
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
    const res = await post(`/requests/${id}/settle`, { accountId: PRACTICE_ANTHONY, settledVia: 'zelle' });
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
      const res = await post(`/requests/${id}/settle`, { accountId: PRACTICE_ANTHONY, settledVia: rail });
      expect(res.status).toBe(200);
      expect(((await res.json()) as RequestView).request.settledVia).toBe(rail);
    }
    const bad = await createAsk(post);
    expect((await post(`/requests/${bad}/settle`, { accountId: PRACTICE_ANTHONY, settledVia: 'wire' })).status).toBe(400);
    expect((await post(`/requests/${bad}/settle`, { accountId: PRACTICE_ANTHONY })).status).toBe(400);
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
    expect((await post(`/requests/${id}/settle`, { accountId: PRACTICE_ANTHONY, settledVia: 'cash' })).status).toBe(200);
    expect((await post(`/requests/${id}/settle`, { accountId: PRACTICE_ANTHONY, settledVia: 'cash' })).status).toBe(409);

    const second = await createAsk(post);
    expect((await post(`/requests/${second}/pay`, { accountId: PRACTICE_SAM })).status).toBe(200);
    const late = await post(`/requests/${second}/settle`, { accountId: PRACTICE_ANTHONY, settledVia: 'crypto' });
    expect(late.status).toBe(409);
    expect(((await late.json()) as RequestView).request.settledVia).toBeNull();
  });

  it('404s an unknown request', async () => {
    const { post } = setup();
    const res = await post('/requests/00000000-0000-4000-8000-000000000000/settle', {
      accountId: PRACTICE_ANTHONY,
      settledVia: 'zelle',
    });
    expect(res.status).toBe(404);
  });
});

/** Minimal sessionStorage for the overlay tests: the vitest env is plain node. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => { map.clear(); },
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => { map.delete(key); },
    setItem: (key: string, value: string) => { map.set(key, value); },
  };
}

function row(overrides: Partial<PaymentRequestView>): PaymentRequestView {
  return {
    id: PRACTICE_REQUEST_UTILITIES,
    requesterAccountId: '01111111-1111-7111-8111-111111111103',
    payerAccountId: PRACTICE_ANTHONY,
    requester: { id: '01111111-1111-7111-8111-111111111103', owner: 'jordan' },
    payer: { id: PRACTICE_ANTHONY, owner: 'anthony' },
    amountMinor: 6_000,
    amount: '$60.00',
    currency: 'USD',
    memo: 'Utilities share',
    status: 'PENDING',
    transferId: null,
    settledVia: null,
    declinedAttempts: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    resolvedAt: null,
    ...overrides,
  };
}

describe('practice request session overlay', () => {
  beforeEach(() => vi.stubGlobal('sessionStorage', memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it('paints a remembered PAID status (and rail) over a row served as PENDING again', () => {
    rememberResolved(PRACTICE_ANTHONY_ID, PRACTICE_REQUEST_UTILITIES, { status: 'PAID', settledVia: 'zelle' });
    const stale = { incoming: [row({})], outgoing: [] };

    const painted = applyResolvedOverlay(PRACTICE_ANTHONY_ID, stale);
    expect(painted.incoming[0]).toMatchObject({ id: PRACTICE_REQUEST_UTILITIES, status: 'PAID', settledVia: 'zelle' });
    /* the input rows are not mutated */
    expect(stale.incoming[0]!.status).toBe('PENDING');
    expect(stale.incoming[0]!.settledVia).toBeNull();
  });

  it('leaves rows with unknown ids PENDING and ignores non-practice accounts', () => {
    rememberResolved(PRACTICE_ANTHONY_ID, PRACTICE_REQUEST_UTILITIES, { status: 'DECLINED', settledVia: null });
    const unknownId = '01111111-1111-7111-8111-1111111119ff';
    const rows = { incoming: [row({ id: unknownId })], outgoing: [row({ id: PRACTICE_REQUEST_UTILITIES, status: 'PAID' })] };

    const painted = applyResolvedOverlay(PRACTICE_ANTHONY_ID, rows);
    expect(painted.incoming[0]!.status).toBe('PENDING');
    /* an already-resolved row is left alone */
    expect(painted.outgoing[0]!.status).toBe('PAID');

    /* a live account never reads or writes the practice overlay */
    const live = '00000000-0000-4000-8000-0000000000aa';
    rememberResolved(live, PRACTICE_REQUEST_UTILITIES, { status: 'PAID', settledVia: null });
    expect(applyResolvedOverlay(live, rows).incoming[0]!.status).toBe('PENDING');
  });

  it('survives storage that throws', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    });
    expect(() => rememberResolved(PRACTICE_ANTHONY_ID, PRACTICE_REQUEST_UTILITIES, { status: 'PAID', settledVia: null })).not.toThrow();
    expect(applyResolvedOverlay(PRACTICE_ANTHONY_ID, { incoming: [row({})], outgoing: [] }).incoming[0]!.status).toBe('PENDING');
  });
});

describe('assertPaid', () => {
  function thrownMessage(fn: () => void): string {
    try {
      fn();
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error('expected assertPaid to throw');
  }

  it('passes when the request landed PAID with a COMPLETED transfer', () => {
    expect(() => assertPaid({
      request: { status: 'PAID' },
      transfer: { status: 'COMPLETED', rejectionReason: null, declineExplanation: null },
    })).not.toThrow();
  });

  it('passes when a repeated pay returns only the already-PAID request', () => {
    expect(() => assertPaid({ request: { status: 'PAID' } })).not.toThrow();
  });

  it('throws the decline explanation when a PENDING request came back REJECTED', () => {
    const message = thrownMessage(() => assertPaid({
      request: { status: 'PENDING' },
      transfer: {
        status: 'REJECTED',
        rejectionReason: 'INSUFFICIENT_FUNDS',
        declineExplanation: 'Your wallet does not cover this. Add money and try again.',
      },
    }));
    expect(message).toBe('Your wallet does not cover this. Add money and try again.');
  });

  it('falls back to the rejection reason, then to the default text', () => {
    expect(thrownMessage(() => assertPaid({
      request: { status: 'PENDING' },
      transfer: { status: 'REJECTED', rejectionReason: 'INSUFFICIENT_FUNDS', declineExplanation: null },
    }))).toBe('INSUFFICIENT_FUNDS');

    expect(thrownMessage(() => assertPaid({
      request: { status: 'PENDING' },
      transfer: { status: 'REJECTED', rejectionReason: null, declineExplanation: null },
    }))).toBe('That payment did not go through. Try again.');

    expect(thrownMessage(() => assertPaid({ request: { status: 'PENDING' } })))
      .toBe('That payment did not go through. Try again.');
  });
});
