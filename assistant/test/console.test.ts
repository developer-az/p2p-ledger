import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import type { Account, LedgerAuditor, LedgerEntry, LedgerReader, LedgerWriter, Transfer, TransferRequest } from '../src/server/ledger.js';
import { ScriptedProvider } from '../src/server/providers/scripted.js';

const FUNDING = '00000000-0000-7000-8000-000000000001';
const ALEX = '0199c0de-0000-7000-8000-0000000000a1';
const SAM = '0199c0de-0000-7000-8000-0000000000a2';
const EVE = '0199c0de-0000-7000-8000-0000000000a3';

/** Keeps the real service's write semantics: one transfer per idempotency key, entries only for completed ones. */
class MemoryLedger implements LedgerReader, LedgerWriter, LedgerAuditor {
  accounts = new Map<string, Account>();
  transfers: (Transfer & { key: string })[] = [];
  entriesList: LedgerEntry[] = [];
  private seq = 0;

  constructor() {
    const open = (id: string, ownerId: string, balanceMinor: number, type: Account['type'] = 'USER') =>
      this.accounts.set(id, { id, ownerId, currency: 'USD', type, balanceMinor, createdAt: '2026-10-01T00:00:00Z' });
    open(FUNDING, 'system:funding', 0, 'SYSTEM');
    open(ALEX, 'alex', 0);
    open(SAM, 'sam', 0);
    open(EVE, 'eve', 0);
  }

  async getAccount(id: string) { return this.accounts.get(id) ?? null; }
  async accountsByOwner(owner: string) { return [...this.accounts.values()].filter((a) => a.ownerId === owner); }
  async getTransfer(id: string) { return this.transfers.find((t) => t.id === id) ?? null; }
  async transfersForAccount(accountId: string, limit: number) {
    return this.transfers.filter((t) => t.sourceAccountId === accountId || t.destinationAccountId === accountId).reverse().slice(0, limit);
  }
  async entries(accountId: string) { return this.entriesList.filter((e) => e.accountId === accountId); }
  async openAccount(): Promise<Account> { throw new Error('unused'); }
  async deposit(accountId: string, amountMinor: number, key: string) {
    return (await this.postDeposit(accountId, { amountMinor }, key)).transfer;
  }
  async transfer(req: TransferRequest, key: string) { return (await this.postTransfer(req, key)).transfer; }

  async postTransfer(req: TransferRequest, key: string) {
    return this.write(key, 'TRANSFER', req.sourceAccountId, req.destinationAccountId, req.amountMinor, req.memo ?? null,
      req.amountMinor > 100_000 ? 'NEW_ACCOUNT_LARGE_TRANSFER' : null);
  }

  async postDeposit(accountId: string, body: { amountMinor: number; memo?: string }, key: string) {
    return this.write(key, 'DEPOSIT', FUNDING, accountId, body.amountMinor, body.memo ?? null, null);
  }

  async trail(id: string) {
    const t = this.transfers.find((x) => x.id === id);
    if (!t) return null;
    return {
      transfer: t,
      idempotencyKey: t.key,
      requestHash: 'hash',
      entries: this.entriesList.filter((e) => e.transferId === id),
      events: [{ eventId: `e-${id}`, eventType: 'TransferCompleted', createdAt: t.createdAt, publishedAt: '2026-10-08T12:00:00.120Z' }],
    };
  }

  async integrity() {
    return {
      checkedAt: '2026-10-08T12:00:00Z', entryCount: this.entriesList.length,
      entriesSumMinor: this.entriesList.reduce((s, e) => s + e.amountMinor, 0),
      transferCount: this.transfers.length, unbalancedTransfers: 0, rejectedWithEntries: 0, accountCount: 4,
      accountsDrifted: 0, outbox: { total: this.transfers.length, pending: 0, oldestPendingAt: null, p95DeliveryMs: 120 },
      balanced: true,
    };
  }

  async tamperChecks(transferId: string) {
    return { transferId, accountId: ALEX, attempts: [{ attempt: 'Delete a posted entry', sql: 'delete …', refused: true, databaseSaid: 'ledger_entries is append-only' }] };
  }

  private write(key: string, kind: Transfer['kind'], from: string, to: string, amountMinor: number, memo: string | null, rejection: string | null) {
    const existing = this.transfers.find((t) => t.key === key);
    if (existing) return { status: 200, replayed: true, transfer: existing };
    const t = {
      id: `0199c0de-0000-7000-8000-${String(++this.seq).padStart(12, '0')}`, key, kind,
      sourceAccountId: from, destinationAccountId: to, amountMinor, currency: 'USD', memo,
      status: rejection ? 'REJECTED' as const : 'COMPLETED' as const, rejectionReason: rejection, createdAt: '2026-10-08T12:00:00Z',
    };
    this.transfers.push(t);
    if (!rejection) {
      const src = this.accounts.get(from)!;
      const dst = this.accounts.get(to)!;
      src.balanceMinor -= amountMinor;
      dst.balanceMinor += amountMinor;
      const at = t.createdAt;
      this.entriesList.push({ id: this.seq * 2, transferId: t.id, accountId: from, amountMinor: -amountMinor, balanceAfterMinor: src.balanceMinor, createdAt: at });
      this.entriesList.push({ id: this.seq * 2 + 1, transferId: t.id, accountId: to, amountMinor, balanceAfterMinor: dst.balanceMinor, createdAt: at });
    }
    return { status: 201, replayed: false, transfer: t };
  }
}

async function setup() {
  const ledger = new MemoryLedger();
  await ledger.deposit(ALEX, 500_000, 'dep-alex');
  await ledger.deposit(SAM, 50_000, 'dep-sam');
  const pizza = await ledger.transfer({ sourceAccountId: ALEX, destinationAccountId: SAM, amountMinor: 4_250, currency: 'USD', memo: 'Pizza' }, 'k-pizza');
  const rent = await ledger.transfer({ sourceAccountId: ALEX, destinationAccountId: SAM, amountMinor: 120_000, currency: 'USD', memo: 'Rent' }, 'k-rent');
  const app = createApp({ ledger, provider: () => new ScriptedProvider([{ answer: 'ok' }]) });
  const post = (path: string, body: unknown, ip = '2.2.2.2') => app.request(`/api${path}`, {
    method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
  });
  return { ledger, app, post, pizza, rent };
}

describe('payment trail', () => {
  it('shows both legs of a completed payment and that they sum to zero', async () => {
    const { app, pizza } = await setup();
    const res = await app.request(`/api/trail?account=${ALEX}&transfer=${pizza.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { legs: { account: string; side: string; amount: string }[]; legsSum: string; request: { idempotencyKey: string; path: string }; events: { deliveryMs: number }[] };
    expect(body.legs).toEqual([
      expect.objectContaining({ account: 'alex', side: 'debit', amount: '$42.50' }),
      expect.objectContaining({ account: 'sam', side: 'credit', amount: '$42.50' }),
    ]);
    expect(body.legsSum).toBe('$0.00');
    expect(body.request).toMatchObject({ idempotencyKey: 'k-pizza', path: '/v1/transfers' });
    expect(body.events[0]?.deliveryMs).toBe(120);
  });

  it('shows no legs for a declined payment, with the rule that stopped it', async () => {
    const { app, rent } = await setup();
    const body = await (await app.request(`/api/trail?account=${ALEX}&transfer=${rent.id}`)).json() as { legs: unknown[]; decline: { code: string; explanation: string } };
    expect(body.legs).toEqual([]);
    expect(body.decline.code).toBe('NEW_ACCOUNT_LARGE_TRANSFER');
    expect(body.decline.explanation).toMatch(/24 hours/);
  });

  it('will not open a payment the viewed account is not part of', async () => {
    const { app, pizza } = await setup();
    expect((await app.request(`/api/trail?account=${EVE}&transfer=${pizza.id}`)).status).toBe(404);
    expect((await app.request(`/api/trail?account=${ALEX}&transfer=nope`)).status).toBe(404);
  });
});

describe('replay', () => {
  it('returns the stored result and posts nothing new', async () => {
    const { post, pizza, ledger } = await setup();
    const before = ledger.entriesList.length;
    const res = await post('/replay', { accountId: ALEX, transferId: pizza.id });
    expect(await res.json()).toMatchObject({
      httpStatus: 200, replayed: true, sameTransfer: true, entriesBefore: 2, entriesAfter: 2,
      balanceBefore: '$4,957.50', balanceAfter: '$4,957.50',
    });
    expect(ledger.entriesList.length).toBe(before);
  });
});

describe('race', () => {
  it('turns five identical in-flight requests into one payment', async () => {
    const { post, ledger } = await setup();
    const before = ledger.transfers.length;
    const res = await post('/race', { accountId: ALEX, fromAccountId: SAM });
    const body = await res.json() as { attempts: { httpStatus: number; replayed: boolean }[]; distinctTransfers: number; entriesPosted: number; amount: string };
    expect(body.attempts).toHaveLength(5);
    expect(body.attempts.filter((a) => a.httpStatus === 201)).toHaveLength(1);
    expect(body.attempts.filter((a) => a.replayed)).toHaveLength(4);
    expect(body).toMatchObject({ distinctTransfers: 1, entriesPosted: 2, amount: '$5.00' });
    expect(ledger.transfers.length).toBe(before + 1);
  });

  it('rejects a sender that is the same account or a system account', async () => {
    const { post } = await setup();
    expect((await post('/race', { accountId: ALEX, fromAccountId: ALEX })).status).toBe(400);
    expect((await post('/race', { accountId: ALEX, fromAccountId: FUNDING })).status).toBe(404);
  });
});

describe('tamper and books', () => {
  it('runs the database checks only on a payment that posted entries', async () => {
    const { post, pizza, rent } = await setup();
    const ok = await post('/tamper', { accountId: ALEX, transferId: pizza.id });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { attempts: { refused: boolean }[] }).attempts.every((a) => a.refused)).toBe(true);
    expect((await post('/tamper', { accountId: ALEX, transferId: rent.id })).status).toBe(400);
    expect((await post('/tamper', { accountId: EVE, transferId: pizza.id })).status).toBe(404);
  });

  it('reports the reconciled totals', async () => {
    const { app } = await setup();
    expect(await (await app.request('/api/integrity')).json()).toMatchObject({ balanced: true, entriesSum: '$0.00' });
  });
});
