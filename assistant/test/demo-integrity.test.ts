import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { InMemoryAuthStore } from '../src/server/auth.js';
import { demoSeedCashMinor, seedDemoHabits } from '../src/server/demo-habits.js';
import { InMemoryPersonalFinanceStore } from '../src/server/personal-finance.js';
import {
  CompositeLedger,
  PRACTICE_ANTHONY,
  PRACTICE_SAM,
  PracticeLedger,
} from '../src/server/practice-ledger.js';
import { InMemorySpendLogStore } from '../src/server/spend-log.js';

const SEED_BALANCE_MINOR = 344_951;

/**
 * Production-like app: wallet auth is enforced, so the shared practice fixture
 * must be read-only and each demo session must work on its own copy.
 */
function setup() {
  const practice = new PracticeLedger();
  const spendLogs = new InMemorySpendLogStore();
  const finance = new InMemoryPersonalFinanceStore();
  const ledger = new CompositeLedger(
    new PracticeLedger() as never,
    practice,
    async () => false,
  );
  const app = createApp({
    ledger,
    practice,
    spendLogs,
    personalFinance: finance,
    auth: new InMemoryAuthStore(),
    enforceWalletAuth: true,
  });
  const jsonPost = (path: string, body: unknown, cookie?: string): Promise<Response> =>
    Promise.resolve(app.request(`/api${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }));
  return { app, practice, spendLogs, finance, jsonPost };
}

async function startDemo(jsonPost: (path: string, body: unknown, cookie?: string) => Promise<Response>) {
  const res = await jsonPost('/demo/practice', {});
  expect(res.status).toBe(200);
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  expect(cookie).toContain('settle_practice=');
  return cookie;
}

describe('practice demo integrity', () => {
  it('refuses anonymous deposits, transfers and spends against the sample household', async () => {
    const { practice, jsonPost } = setup();

    const deposit = await jsonPost(`/accounts/${PRACTICE_ANTHONY}/deposits`, { amountMinor: 500_000 });
    expect(deposit.status).toBe(403);
    expect(await deposit.json()).toMatchObject({ error: expect.stringContaining('read-only') });

    const transfer = await jsonPost('/transfers', {
      sourceAccountId: PRACTICE_ANTHONY,
      destinationAccountId: PRACTICE_SAM,
      amountMinor: 50_000,
      currency: 'USD',
    });
    expect(transfer.status).toBe(403);

    const spend = await jsonPost(`/accounts/${PRACTICE_ANTHONY}/spends`, {
      amountMinor: 1_200,
      category: 'dining',
      note: 'Not in the seed',
    });
    expect(spend.status).toBe(403);

    expect((await practice.getAccount(PRACTICE_ANTHONY))?.balanceMinor).toBe(SEED_BALANCE_MINOR);
    expect(practice.hasDrifted()).toBe(false);
  });

  it('refuses a fixture write whose body is not labelled JSON', async () => {
    const { app, practice } = setup();
    /* A plain string body gets content-type text/plain; the ids are still visible. */
    const res = await app.request('/api/transfers', {
      method: 'POST',
      body: JSON.stringify({
        sourceAccountId: PRACTICE_ANTHONY,
        destinationAccountId: PRACTICE_SAM,
        amountMinor: 100,
        currency: 'USD',
      }),
    });
    expect(res.status).toBe(403);
    expect(practice.hasDrifted()).toBe(false);
  });

  it('leaves streamed import bodies intact for a signed-in live wallet', async () => {
    const { app } = setup();
    const registered = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'importer@example.com',
        password: 'smoke-password-1',
        displayName: 'Importer',
      }),
    });
    expect(registered.status).toBe(201);
    const cookie = registered.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const { account } = await registered.json() as { account: { id: string } };
    const csv = 'date,description,amount\n2026-01-02,Coffee,-4.50\n';
    const preview = await app.request(`/api/accounts/${account.id}/imports/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ filename: 'bank.csv', content: csv }),
    });
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ source: 'csv', columns: ['date', 'description', 'amount'] });
  });

  it('lets a demo session write to its own copy and leaves the shared fixture alone', async () => {
    const { app, practice, jsonPost } = setup();
    const cookie = await startDemo(jsonPost);

    const deposit = await jsonPost(`/accounts/${PRACTICE_ANTHONY}/deposits`, { amountMinor: 500_000 }, cookie);
    expect(deposit.status).toBe(201);

    /* A visitor without the demo cookie still sees the seeded household. */
    const anonymous = await app.request(`/api/accounts?id=${PRACTICE_ANTHONY}`);
    expect(anonymous.status).toBe(200);
    expect((await anonymous.json() as { balance: string }).balance).toBe('$3,449.51');
    expect((await practice.getAccount(PRACTICE_ANTHONY))?.balanceMinor).toBe(SEED_BALANCE_MINOR);

    /* The demo session keeps its own balance. */
    const session = await app.request(`/api/accounts?id=${PRACTICE_ANTHONY}`, { headers: { cookie } });
    expect(session.status).toBe(200);
    expect((await session.json() as { balance: string }).balance).toBe('$8,449.51');
    expect(practice.hasDrifted()).toBe(false);
  });

  it('repairs a drifted shared fixture on the first production read', async () => {
    const { app, practice } = setup();
    /* Simulate a write from an older build: one cent into the sample wallet. */
    await practice.deposit(PRACTICE_ANTHONY, 1, 'legacy-smoke-deposit');
    expect(practice.hasDrifted()).toBe(true);

    const res = await app.request(`/api/accounts?id=${PRACTICE_ANTHONY}`);
    expect(res.status).toBe(200);
    expect(practice.hasDrifted()).toBe(false);
    expect((await practice.getAccount(PRACTICE_ANTHONY))?.balanceMinor).toBe(SEED_BALANCE_MINOR);
  });

  it('re-seeds demo history that no longer matches the seed', async () => {
    const { app, practice, spendLogs, finance, jsonPost } = setup();
    await startDemo(jsonPost);

    const referenceSpends = new InMemorySpendLogStore();
    await seedDemoHabits(referenceSpends, new InMemoryPersonalFinanceStore(), PRACTICE_ANTHONY, 'anthony');
    const expectedRows = (await referenceSpends.list(PRACTICE_ANTHONY, { limit: 2_000 })).length;
    expect(expectedRows).toBeGreaterThan(0);

    /* A stale session, an import or an edited budget leaves state behind. */
    await spendLogs.record(PRACTICE_ANTHONY, {
      amountMinor: 4_200,
      category: 'dining',
      note: 'Stray row',
      occurredAt: new Date().toISOString(),
    });
    await finance.updateProfile(PRACTICE_ANTHONY, 'USD', { walletCashMinor: 999_999 });
    expect((await spendLogs.list(PRACTICE_ANTHONY, { limit: 2_000 })).length).toBe(expectedRows + 1);

    /* A production read heals the shared history, no demo start needed. */
    const healed = await app.request(`/api/accounts?id=${PRACTICE_ANTHONY}`);
    expect(healed.status).toBe(200);

    expect((await finance.getProfile(PRACTICE_ANTHONY, 'USD')).walletCashMinor)
      .toBe(demoSeedCashMinor('anthony'));
    expect((await spendLogs.list(PRACTICE_ANTHONY, { limit: 2_000 })).length).toBe(expectedRows);
    expect((await finance.listIncome(PRACTICE_ANTHONY, { limit: 100 })).length).toBe(1);

    /*
     * A cold serverless instance loses the in-memory spend log but keeps the
     * persisted income rows. The next demo start must replace them, not append
     * another income every cold start (the old drift: sample cash climbed by
     * one monthly income per restart).
     */
    await spendLogs.deleteAll?.(PRACTICE_ANTHONY);
    await startDemo(jsonPost);
    expect((await finance.listIncome(PRACTICE_ANTHONY, { limit: 100 })).length).toBe(1);
    expect((await spendLogs.list(PRACTICE_ANTHONY, { limit: 2_000 })).length).toBe(expectedRows);

    /* The ledger fixture was never written, so no repair was needed. */
    expect(practice.hasDrifted()).toBe(false);
  });

  it('keeps the smoke script from writing to the shared practice accounts', () => {
    const source = readFileSync(new URL('../scripts/smoke-api.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    /* Every check object that issues a POST must target the smoke account only. */
    const writeChecks = source.split(/\n  \{\n/).filter((chunk) => chunk.includes("method: 'POST'"));
    expect(writeChecks.length).toBeGreaterThan(0);
    for (const chunk of writeChecks) {
      expect(chunk).not.toMatch(/PRACTICE_(ANTHONY|SAM|JORDAN)/);
    }
    /* The fixture is still verified read-only: its seed cash must show up unchanged. */
    expect(source).toContain('demoSeedCashMinor');
    expect(source).toContain('SMOKE_EMAIL');
  });
});
