import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { InMemoryAuthStore } from '../src/server/auth.js';
import { CompositeLedger, PracticeLedger } from '../src/server/practice-ledger.js';
import { InMemorySpendLogStore } from '../src/server/spend-log.js';
import { LedgerError, type LedgerAuditor, type LedgerReader, type LedgerWriter } from '../src/server/ledger.js';

function app(liveUp = false, enforceWalletAuth = false) {
  const practice = new PracticeLedger();
  const reject = () => Promise.reject(new LedgerError(503, 'live ledger is down'));
  const live: LedgerReader & LedgerWriter & LedgerAuditor = {
    getAccount: reject,
    accountsByOwner: reject,
    getTransfer: reject,
    transfersForAccount: reject,
    entries: reject,
    openAccount: reject,
    deposit: reject,
    transfer: reject,
    trail: reject,
    integrity: reject,
    tamperChecks: reject,
    postTransfer: reject,
    postDeposit: reject,
  };
  return createApp({
    ledger: new CompositeLedger(live, practice, async () => false),
    practice,
    spendLogs: new InMemorySpendLogStore(),
    auth: new InMemoryAuthStore(),
    enforceWalletAuth,
    isLiveLedgerUp: async () => liveUp,
  });
}

const json = { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.10' };

function cookieFrom(res: Response): string {
  const raw = res.headers.get('set-cookie') ?? '';
  const pair = raw.split(';')[0] ?? '';
  if (!pair.startsWith('settle_session=')) throw new Error(`missing session cookie: ${raw}`);
  return pair;
}

describe('account sign-in', () => {
  it('creates an account, keeps the session, and rejects a bad password', async () => {
    const api = app();
    const created = await api.request('/api/auth/register', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: 'Sam@Example.com', password: 'correct-horse', displayName: 'Sam Lee' }),
    });
    expect(created.status).toBe(201);
    const body = await created.json() as { user: { email: string; displayName: string }; account: { id: string; owner: string }; funded: boolean };
    expect(body.user).toEqual({ email: 'sam@example.com', displayName: 'Sam Lee' });
    expect(body.account.owner.startsWith('sam-lee-')).toBe(true);
    expect(body.funded).toBe(true);
    const cookie = cookieFrom(created);

    const session = await api.request('/api/auth/session', { headers: { cookie } });
    expect(session.status).toBe(200);
    const restored = await session.json() as { user: { email: string }; account: { id: string } };
    expect(restored.user.email).toBe('sam@example.com');
    expect(restored.account.id).toBe(body.account.id);

    const wrong = await api.request('/api/auth/login', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: 'sam@example.com', password: 'nope-nope' }),
    });
    expect(wrong.status).toBe(401);

    const again = await api.request('/api/auth/register', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: 'sam@example.com', password: 'correct-horse', displayName: 'Sam Lee' }),
    });
    expect(again.status).toBe(409);

    const loggedOut = await api.request('/api/auth/logout', { method: 'POST', headers: { cookie } });
    expect(loggedOut.status).toBe(200);
    const after = await api.request('/api/auth/session', { headers: { cookie } });
    expect(await after.json()).toEqual({ user: null });

    const back = await api.request('/api/auth/login', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: 'sam@example.com', password: 'correct-horse' }),
    });
    expect(back.status).toBe(200);
    const signedIn = await back.json() as { account: { id: string } };
    expect(signedIn.account.id).toBe(body.account.id);
  });

  it('requires the owning session to access a registered wallet', async () => {
    const api = app();
    const register = async (email: string, displayName: string) => api.request('/api/auth/register', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email, password: 'correct-horse', displayName }),
    });
    const first = await register('one@example.com', 'One Person');
    const firstBody = await first.json() as { account: { id: string } };
    const firstCookie = cookieFrom(first);

    const anonymous = await api.request(`/api/accounts/${firstBody.account.id}`);
    expect(anonymous.status).toBe(401);

    const queryRead = await api.request(`/api/accounts?id=${firstBody.account.id}`);
    expect(queryRead.status).toBe(401);

    const unauthenticatedRequests = await api.request(`/api/requests?accountId=${firstBody.account.id}`);
    expect(unauthenticatedRequests.status).toBe(401);

    const unauthenticatedBankAction = await api.request('/api/bank/inbound', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ accountId: firstBody.account.id }),
    });
    expect(unauthenticatedBankAction.status).toBe(401);

    const unauthenticatedTransfer = await api.request('/api/transfers', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        sourceAccountId: firstBody.account.id,
        destinationAccountId: '01111111-1111-7111-8111-111111111101',
        amountMinor: 100,
        currency: 'USD',
      }),
    });
    expect(unauthenticatedTransfer.status).toBe(401);

    const own = await api.request(`/api/accounts/${firstBody.account.id}`, { headers: { cookie: firstCookie } });
    expect(own.status).toBe(200);
    const ownQuery = await api.request(`/api/accounts?id=${firstBody.account.id}`, { headers: { cookie: firstCookie } });
    expect(ownQuery.status).toBe(200);

    const second = await register('two@example.com', 'Two Person');
    const secondBody = await second.json() as { account: { id: string } };
    const foreign = await api.request(`/api/accounts/${secondBody.account.id}`, { headers: { cookie: firstCookie } });
    expect(foreign.status).toBe(403);
    const foreignQuery = await api.request(`/api/accounts?id=${secondBody.account.id}`, { headers: { cookie: firstCookie } });
    expect(foreignQuery.status).toBe(403);

    const sample = await api.request('/api/accounts/01111111-1111-7111-8111-111111111101');
    expect(sample.status).toBe(200);
  });

  it('does not open an unowned wallet against the live ledger', async () => {
    const api = app(true);
    const response = await api.request('/api/accounts', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ ownerId: 'unowned', currency: 'USD' }),
    });
    expect(response.status).toBe(403);
  });

  it('refuses a short password and a missing email the same way', async () => {
    const api = app();
    const short = await api.request('/api/auth/register', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: 'a@b.co', password: 'short', displayName: 'Ada' }),
    });
    expect(short.status).toBe(400);
    expect((await short.json() as { error: string }).error).toMatch(/8 characters/);

    const unknown = await api.request('/api/auth/login', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: 'nobody@example.com', password: 'correct-horse' }),
    });
    expect(unknown.status).toBe(401);
    expect((await unknown.json() as { error: string }).error).toBe('Email or password is incorrect.');
  });
});
