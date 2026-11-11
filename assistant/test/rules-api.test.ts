import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { CompositeLedger, PracticeLedger } from '../src/server/practice-ledger.js';
import type { LedgerAuditor, LedgerWriter } from '../src/server/ledger.js';
import { InMemorySpendLogStore, type SpendLogEntry } from '../src/server/spend-log.js';
import { InMemoryPersonalFinanceStore } from '../src/server/personal-finance.js';
import { FixtureLedger, ME, NOW } from '../evals/fixture.js';

function spend(id: string, note: string, amountMinor: number, category: SpendLogEntry['category'] = 'other'): SpendLogEntry {
  return {
    id,
    accountId: ME,
    amountMinor,
    currency: 'USD',
    category,
    note,
    occurredAt: NOW.toISOString(),
    source: 'import',
    createdAt: NOW.toISOString(),
  };
}

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

function makeApp() {
  const spendLogs = new InMemorySpendLogStore([
    spend('11111111-1111-4111-8111-111111111101', 'SQ *STARBUCKS #1234 SEATTLE WA', 650),
    spend('11111111-1111-4111-8111-111111111102', 'STARBUCKS', 1_500),
    spend('11111111-1111-4111-8111-111111111103', 'WHOLE FOODS MARKET #1029', 3_000),
    spend('11111111-1111-4111-8111-111111111104', 'CORNER MART #44', 900),
  ]);
  const practice = new PracticeLedger();
  const app = createApp({
    ledger: new CompositeLedger(Object.assign(new FixtureLedger(), writer), practice, async () => false),
    practice,
    spendLogs,
    personalFinance: new InMemoryPersonalFinanceStore(),
    enforceWalletAuth: false,
    now: () => NOW,
  });
  const post = (path: string, body: unknown) => app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { app, spendLogs, post };
}

describe('rules API', () => {
  it('lists merchants, recent transactions and rule stats', async () => {
    const { app } = makeApp();
    const res = await app.request(`/api/accounts/${ME}/rules`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      merchants: { name: string }[];
      transactions: { id: string; descriptorClean: string; merchantName: string | null }[];
      stats: { transactions: number; resolved: number };
      rules: unknown[];
    };
    expect(body.merchants.some((m) => m.name === 'Starbucks')).toBe(true);
    expect(body.transactions).toHaveLength(4);
    expect(body.transactions[0]).toMatchObject({ descriptorClean: 'STARBUCKS', merchantName: 'Starbucks' });
    expect(body.stats.transactions).toBe(4);
    expect(body.stats.resolved).toBeGreaterThanOrEqual(3);
    expect(body.rules).toEqual([]);
  });

  it('previews a rule without writing it', async () => {
    const { app, post } = makeApp();
    const res = await post(`/api/accounts/${ME}/rules/preview`, {
      merchantContains: 'STARBUCKS',
      maxAmountMinor: 1_000,
      category: 'other',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { affected: number; transactions: { transactionId: string }[] };
    expect(body.affected).toBe(1);
    expect(body.transactions[0]?.transactionId).toBe('11111111-1111-4111-8111-111111111101');
    const list = await (await app.request(`/api/accounts/${ME}/rules`)).json() as { rules: unknown[] };
    expect(list.rules).toHaveLength(0);
  });

  it('creates, versions and applies a rule retroactively', async () => {
    const { app, post } = makeApp();
    const created = await post(`/api/accounts/${ME}/rules`, {
      merchantContains: 'STARBUCKS',
      maxAmountMinor: 1_000,
      category: 'other',
    });
    expect(created.status).toBe(201);
    const rule = await created.json() as { ruleId: string; version: number };
    expect(rule.version).toBe(1);

    const applied = await post(`/api/accounts/${ME}/rules/${rule.ruleId}/apply`, {});
    expect(applied.status).toBe(200);
    expect(await applied.json()).toMatchObject({ applied: 1 });

    const list = await (await app.request(`/api/accounts/${ME}/rules`)).json() as {
      rules: { ruleId: string; version: number }[];
      transactions: { id: string; category: string; categorySource: string }[];
    };
    expect(list.rules[0]).toMatchObject({ ruleId: rule.ruleId, version: 1 });
    expect(list.transactions.find((row) => row.id.endsWith('101'))).toMatchObject({
      category: 'other',
      categorySource: 'user_rule',
    });

    const patched = await app.request(`/api/accounts/${ME}/rules/${rule.ruleId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ merchantContains: 'STARBUCKS', maxAmountMinor: null, category: 'dining' }),
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ ruleId: rule.ruleId, version: 2 });

    const archived = await app.request(`/api/accounts/${ME}/rules/${rule.ruleId}`, { method: 'DELETE' });
    expect(archived.status).toBe(200);
    const empty = await (await app.request(`/api/accounts/${ME}/rules`)).json() as { rules: unknown[] };
    expect(empty.rules).toHaveLength(0);
  });

  it('rejects an invalid rule body', async () => {
    const { post } = makeApp();
    const res = await post(`/api/accounts/${ME}/rules`, { merchantContains: ' ', category: 'nope' });
    expect(res.status).toBe(400);
  });

  it('records a merchant correction and uses it for later transactions', async () => {
    const { app, post } = makeApp();
    const res = await post(`/api/accounts/${ME}/merchants/corrections`, {
      transactionId: '11111111-1111-4111-8111-111111111104',
      merchantName: 'Corner Mart',
      category: 'groceries',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { merchant: { name: string }; transaction: { categorySource: string; category: string } };
    expect(body.merchant.name).toBe('Corner Mart');
    expect(body.transaction).toMatchObject({ category: 'groceries', categorySource: 'user_correction' });

    const list = await (await app.request(`/api/accounts/${ME}/rules`)).json() as {
      merchants: { name: string; aliases: string[] }[];
      transactions: { id: string; merchantName: string | null; merchantMethod: string }[];
    };
    const merchant = list.merchants.find((row) => row.name === 'Corner Mart');
    expect(merchant?.aliases).toContain('CORNER MART');
    expect(list.transactions.find((row) => row.id.endsWith('104'))).toMatchObject({
      merchantName: 'Corner Mart',
      merchantMethod: 'exact_alias',
    });
  });

  it('keeps an explicitly picked category on read as manual', async () => {
    const { app, post } = makeApp();
    const created = await post(`/api/accounts/${ME}/spends`, {
      amountMinor: 1_250,
      note: 'CORNER MART #44',
      category: 'groceries',
    });
    expect(created.status).toBe(201);
    const event = await created.json() as { id: string };
    const list = await (await app.request(`/api/accounts/${ME}/rules`)).json() as {
      transactions: { id: string; category: string; categorySource: string }[];
    };
    expect(list.transactions.find((row) => row.id === event.id)).toMatchObject({
      category: 'groceries',
      categorySource: 'manual',
    });
  });

  it('keeps live categorization out of manual spend logging', async () => {
    const { app, post } = makeApp();
    const res = await post(`/api/accounts/${ME}/spends`, {
      amountMinor: 700,
      note: 'SQ *STARBUCKS #99',
    });
    expect(res.status).toBe(201);
    const body = await res.json() as {
      category: string;
      categorySource: string;
      descriptorClean: string;
      merchantName: string;
    };
    expect(body).toMatchObject({
      category: 'dining',
      categorySource: 'merchant_default',
      descriptorClean: 'STARBUCKS',
      merchantName: 'Starbucks',
    });
  });
});
