import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { LedgerError, type LedgerAuditor, type LedgerWriter } from '../src/server/ledger.js';
import { CompositeLedger, PracticeLedger } from '../src/server/practice-ledger.js';
import { ScriptedProvider } from '../src/server/providers/scripted.js';
import { fixtureSpendLogStore } from '../evals/spend-fixture.js';
import { FixtureLedger, ME, NOW } from '../evals/fixture.js';

const spendLogs = fixtureSpendLogStore();

const practice = new PracticeLedger();

const readOnly = () => Promise.reject(new Error('read-only fixture'));
const writer: LedgerWriter & LedgerAuditor = {
  openAccount: readOnly,
  deposit: readOnly,
  transfer: readOnly,
  trail: readOnly,
  integrity: readOnly,
  tamperChecks: readOnly,
  postTransfer: readOnly,
  postDeposit: readOnly,
};
const app = createApp({
  ledger: new CompositeLedger(Object.assign(new FixtureLedger(), writer), practice, async () => false),
  practice,
  spendLogs,
  provider: () => new ScriptedProvider([{ answer: 'Hello!' }]),
  now: () => NOW,
});
const chat = (body: unknown, ip = '1.1.1.1') => app.request('/api/chat', {
  method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
});

describe('GET /api/accounts/:id', () => {
  it('returns the balance and recent activity for a user account', async () => {
    const res = await app.request(`/api/accounts?id=${ME}`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      balance: string; owner: string;
      summary: { stopped: string; declinedCount: number };
      transfers: { direction: string; status: string; declineExplanation: string | null }[];
    };
    expect(body).toMatchObject({ owner: 'riley', balance: '$3,750.51' });
    expect(body.transfers.length).toBeGreaterThan(0);
    expect(body.transfers[0]).toMatchObject({ direction: 'received' });
    expect(body.transfers.some((t) => t.status === 'REJECTED')).toBe(true);
    const stopped = body.transfers.find((t) => t.status === 'REJECTED');
    expect(stopped?.declineExplanation).toMatch(/60-second|5 transfers/i);
    expect(body.summary.stopped).toMatch(/^\$/);
    expect(body.summary.declinedCount).toBeGreaterThan(0);
    expect((await app.request(`/api/accounts/${ME}`)).status).toBe(200);
  });

  it('includes habits and unified activity feed on the account view', async () => {
    const res = await app.request(`/api/accounts?id=${ME}`);
    const body = await res.json() as {
      habits: { weekly: { totalThisWeek: string } };
      activityFeed: { kind: string }[];
      insights: { bullets: string[] };
      finance: { periodLabel: string };
    };
    expect(body.habits.weekly.totalThisWeek).toBe('$230.00');
    expect(body.activityFeed.some((r) => r.kind === 'logged')).toBe(true);
    expect(body.activityFeed.some((r) => r.kind === 'paid' || r.kind === 'income')).toBe(true);
    expect(body.insights.bullets.length).toBeGreaterThan(0);
    expect(body.finance.periodLabel).toBeTruthy();
  });

  it('records income and updates finance profile', async () => {
    const patch = await app.request(`/api/accounts/${ME}/finance`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletCashMinor: 50000, creditOwedMinor: 10000, spendLogsAffectWallet: false }),
    });
    expect(patch.status).toBe(200);
    const income = await app.request(`/api/accounts/${ME}/incomes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountMinor: 250000, source: 'salary' }),
    });
    expect(income.status).toBe(201);
    const view = await app.request(`/api/accounts?id=${ME}`);
    const body = await view.json() as { activityFeed: { kind: string }[]; finance: { projectedCash: string } };
    expect(body.activityFeed.some((r) => r.kind === 'logged_income')).toBe(true);
    expect(body.finance.projectedCash).toBe('$3,000.00');
  });

  it('records a spend', async () => {
    const res = await app.request(`/api/accounts/${ME}/spends`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountMinor: 500, category: 'dining' }),
    });
    expect(res.status).toBe(201);
  });

  it('seeds a guided practice demo with personal history', async () => {
    const res = await app.request('/api/demo/practice', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as { accounts: { id: string }[]; focusAccountId: string };
    expect(body.accounts).toHaveLength(3);
    const view = await app.request(`/api/accounts?id=${body.focusAccountId}`);
    const account = await view.json() as {
      moneyProfile: { walletCashMinor: number | null; weeklyBudgetMinor: number | null };
      patterns: { totals: { spend30dMinor: number }; streak: { currentDays: number } };
    };
    expect(account.moneyProfile.walletCashMinor).toBe(320_000);
    expect(account.moneyProfile.weeklyBudgetMinor).toBe(45_000);
    expect(account.patterns.totals.spend30dMinor).toBeGreaterThan(0);
    expect(account.patterns.streak.currentDays).toBeGreaterThan(0);
  });

  it('funds a brand-new wallet and gives it a first peer', async () => {
    const created = await app.request('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerId: 'new-person-test', currency: 'USD' }),
    });
    expect(created.status).toBe(201);
    const account = await created.json() as { id: string };
    const welcome = await app.request('/api/bank/welcome', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: account.id }),
    });
    expect(welcome.status).toBe(200);
    const packageBody = await welcome.json() as { depositTransferId: string; corridor: { peer: { id: string } } };
    expect(packageBody.depositTransferId).toBeTruthy();
    expect(packageBody.corridor.peer.id).toBeTruthy();
    const view = await app.request(`/api/accounts?id=${account.id}`);
    const body = await view.json() as { balance: string };
    expect(body.balance).not.toBe('$0.00');
    const peersRes = await app.request(`/api/peers?accountId=${account.id}`);
    const peers = await peersRes.json() as { id: string }[];
    expect(peers.some((peer) => peer.id === packageBody.corridor.peer.id)).toBe(true);
  });

  it('says the ledger is waking when the upstream returns 502', async () => {
    const asleepLive = Object.assign(new FixtureLedger(), writer, {
      getAccount: () => Promise.reject(new LedgerError(502, 'bad gateway')),
    });
    const asleep = createApp({
      ledger: new CompositeLedger(asleepLive, practice, async () => false),
      practice,
      spendLogs,
      provider: () => new ScriptedProvider([{ answer: 'Hello!' }]),
      now: () => NOW,
    });
    const res = await asleep.request(`/api/accounts?id=${ME}`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'The ledger is waking up. Try again in a moment.' });
  });

  it('hides unknown and system accounts', async () => {
    expect((await app.request('/api/accounts/not-a-uuid')).status).toBe(404);
    expect((await app.request('/api/accounts/00000000-0000-7000-8000-000000000001')).status).toBe(404);
  });
});

describe('POST /api/chat', () => {
  it('answers for a valid account', async () => {
    const res = await chat({ accountId: ME, messages: [{ role: 'user', text: 'hi' }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ answer: 'Hello!', provider: 'scripted' });
  });

  it('rejects malformed bodies and unknown or system accounts', async () => {
    expect((await chat({ accountId: 'nope', messages: [] })).status).toBe(400);
    expect((await chat({ accountId: ME, messages: [{ role: 'assistant', text: 'x' }] })).status).toBe(400);
    expect((await chat({ accountId: '0199c0de-0000-7000-8000-0000000000ff', messages: [{ role: 'user', text: 'hi' }] })).status).toBe(404);
    expect((await chat({ accountId: '00000000-0000-7000-8000-000000000001', messages: [{ role: 'user', text: 'hi' }] })).status).toBe(404);
  });

  it('answers from the ledger when the model is out of quota', async () => {
    const limited = createApp({
      ledger: new CompositeLedger(Object.assign(new FixtureLedger(), writer), practice, async () => false),
      practice,
      spendLogs,
      now: () => NOW,
      provider: () => ({
        name: 'scripted',
        model: 'fake',
        run: () => Promise.reject(Object.assign(new Error('quota'), { status: 429 })),
      }),
    });
    const res = await limited.request('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ accountId: ME, messages: [{ role: 'user', text: "What's my balance?" }] }),
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '8.8.8.8' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ answer: 'Your balance is $3,750.51.', provider: 'ledger' });
  });

  it('rate-limits a single client', async () => {
    const statuses = [];
    for (let i = 0; i < 22; i++) statuses.push((await chat({ accountId: ME, messages: [{ role: 'user', text: 'hi' }] }, '9.9.9.9')).status);
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});
