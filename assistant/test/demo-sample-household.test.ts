import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { InMemoryAuthStore } from '../src/server/auth.js';
import { CompositeLedger, PRACTICE_ALEX, PracticeLedger } from '../src/server/practice-ledger.js';
import { InMemorySpendLogStore } from '../src/server/spend-log.js';
import { loadSession, saveSession } from '../src/web/app/session.js';
import { PRACTICE_ALEX_ID } from '../src/web/practice-fixture.js';

function memoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
}

describe('sample household (consumer preview)', () => {
  it('the practice sample household loads under production wallet auth, even with the live ledger up', async () => {
    // This is the path "Preview a sample household" now takes (Welcome.tsx):
    // POST /api/demo/practice, never POST /api/demo. A live-seeded demo used
    // to 401 here once wallet routes required the owning sign-in session,
    // because demo accounts have no session and are not practice accounts.
    const practice = new PracticeLedger();
    const live = new PracticeLedger();
    const api = createApp({
      ledger: new CompositeLedger(live as never, practice, async () => true),
      practice,
      liveLedger: live as never,
      isLiveLedgerUp: async () => true,
      spendLogs: new InMemorySpendLogStore(),
      auth: new InMemoryAuthStore(),
      enforceWalletAuth: true,
    });
    const seeded = await api.request('/api/demo/practice', { method: 'POST' });
    expect(seeded.status).toBe(200);
    const body = await seeded.json() as { accounts: { id: string }[]; focusAccountId: string };
    expect(body.focusAccountId).toBe(PRACTICE_ALEX);
    const view = await api.request(`/api/accounts?id=${body.focusAccountId}`);
    expect(view.status).toBe(200);
  });

  it('drops a stale live-seeded demo session, keeps a practice demo and a signed-in session', () => {
    (globalThis as { localStorage?: unknown }).localStorage = memoryStorage();

    // Pre-fix live demo: real Postgres account id, demo flag, no user.
    saveSession({
      account: { id: '123e4567-e89b-12d3-a456-426614174000', owner: 'alex-abcdef' },
      household: [{ id: '123e4567-e89b-12d3-a456-426614174000', owner: 'alex-abcdef' }],
      demo: true,
    });
    expect(loadSession()).toBeNull();

    saveSession({
      account: { id: PRACTICE_ALEX_ID, owner: 'alex' },
      household: [{ id: PRACTICE_ALEX_ID, owner: 'alex' }],
      demo: true,
    });
    expect(loadSession()?.account.id).toBe(PRACTICE_ALEX_ID);

    saveSession({
      account: { id: '123e4567-e89b-12d3-a456-426614174001', owner: 'me-abcdef' },
      household: [],
      demo: false,
      user: { email: 'me@example.com', displayName: 'Me Person' },
    });
    expect(loadSession()?.user?.email).toBe('me@example.com');
  });
});
