import { describe, expect, it } from 'vitest';
import {
  InMemoryEnrichmentStore,
  mergeMerchantAlias,
} from '../src/server/enrichment/store.js';
import {
  applyRuleRetroactively,
  enrichSpendDraft,
  recordMerchantCorrection,
  type SpendDraft,
} from '../src/server/enrichment/service.js';
import type { SpendLogEntry } from '../src/server/spend-log.js';

const ACCOUNT = '00000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-10-08T12:00:00Z');

function entry(id: string, note: string, amountMinor: number, category: SpendLogEntry['category'] = 'other'): SpendLogEntry {
  return {
    id,
    accountId: ACCOUNT,
    amountMinor,
    currency: 'USD',
    category,
    note,
    occurredAt: NOW.toISOString(),
    source: 'import',
    createdAt: NOW.toISOString(),
  };
}

function draft(note: string, amountMinor: number): SpendDraft {
  return { amountMinor, note, occurredAt: NOW.toISOString(), source: 'import' };
}

describe('in-memory enrichment store', () => {
  it('seeds the merchant catalog once per account and keeps aliases unique', async () => {
    const store = new InMemoryEnrichmentStore();
    const first = await store.listMerchants(ACCOUNT);
    const second = await store.listMerchants(ACCOUNT);
    expect(first.length).toBeGreaterThan(20);
    expect(second.map((m) => m.id)).toEqual(first.map((m) => m.id));
    const starbucks = first.find((m) => m.name === 'Starbucks')!;
    await store.addAlias(ACCOUNT, starbucks.id, 'SBUX COFFEE');
    await store.addAlias(ACCOUNT, starbucks.id, 'SBUX COFFEE');
    const changed = await store.listMerchants(ACCOUNT);
    expect(changed.find((m) => m.id === starbucks.id)?.aliases.filter((a) => a === 'SBUX COFFEE')).toHaveLength(1);
  });

  it('creates a versioned rule, then archives the previous version', async () => {
    const store = new InMemoryEnrichmentStore();
    const created = await store.createRule(ACCOUNT, {
      merchantContains: 'STARBUCKS',
      maxAmountMinor: 1_000,
      category: 'dining',
    }, NOW);
    expect(created.version).toBe(1);
    const updated = await store.updateRule(ACCOUNT, created.ruleId, {
      merchantContains: 'STARBUCKS',
      maxAmountMinor: null,
      category: 'other',
    }, NOW);
    expect(updated!.version).toBe(2);
    const active = await store.listRules(ACCOUNT);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ ruleId: created.ruleId, version: 2, status: 'active' });
    const versions = await store.listRuleVersions(ACCOUNT);
    expect(versions.map((row) => row.version)).toEqual([2, 1]);
    expect(versions[1]?.status).toBe('archived');
  });

  it('keeps rule history after archiving', async () => {
    const store = new InMemoryEnrichmentStore();
    const rule = await store.createRule(ACCOUNT, {
      merchantContains: 'NETFLIX',
      maxAmountMinor: null,
      category: 'entertainment',
    }, NOW);
    expect(await store.archiveRule(ACCOUNT, rule.ruleId)).toBe(true);
    expect(await store.listRules(ACCOUNT)).toHaveLength(0);
    expect(await store.listRuleVersions(ACCOUNT)).toHaveLength(1);
    expect(await store.archiveRule(ACCOUNT, 'missing')).toBe(false);
  });

  it('stores and clears category overrides per transaction', async () => {
    const store = new InMemoryEnrichmentStore();
    await store.setOverride(ACCOUNT, 'spend-1', {
      category: 'groceries',
      source: 'user_correction',
      ruleId: null,
      ruleVersion: null,
      merchantId: 'merchant-1',
    }, NOW);
    const overrides = await store.getOverrides(ACCOUNT);
    expect(overrides.get('spend-1')).toMatchObject({ category: 'groceries', source: 'user_correction' });
    await store.clearOverride(ACCOUNT, 'spend-1');
    expect((await store.getOverrides(ACCOUNT)).size).toBe(0);
  });
});

describe('enrichment service', () => {
  it('enriches a draft, keeps an explicit manual category, and still resolves the merchant', async () => {
    const store = new InMemoryEnrichmentStore();
    const result = await enrichSpendDraft(store, ACCOUNT, draft('SQ *STARBUCKS #1234 SEATTLE WA', 650), NOW);
    expect(result.descriptorClean).toBe('STARBUCKS');
    expect(result.merchantName).toBe('Starbucks');
    expect(result.category).toBe('dining');
    expect(result.categorySource).toBe('merchant_default');

    const manual = await enrichSpendDraft(store, ACCOUNT, draft('SQ *STARBUCKS #1234', 650), NOW, 'shopping');
    expect(manual.category).toBe('shopping');
    expect(manual.categorySource).toBe('manual');
    expect(manual.merchantName).toBe('Starbucks');
  });

  it('applies the latest active rule when logging a new spend', async () => {
    const store = new InMemoryEnrichmentStore();
    await store.createRule(ACCOUNT, {
      merchantContains: 'STARBUCKS',
      maxAmountMinor: 1_000,
      category: 'other',
    }, NOW);
    const result = await enrichSpendDraft(store, ACCOUNT, draft('STARBUCKS', 650), NOW);
    expect(result.category).toBe('other');
    expect(result.categorySource).toBe('user_rule');
  });

  it('applies a rule retroactively to matching spends without touching others', async () => {
    const store = new InMemoryEnrichmentStore();
    const rule = await store.createRule(ACCOUNT, {
      merchantContains: 'STARBUCKS',
      maxAmountMinor: 1_000,
      category: 'entertainment',
    }, NOW);
    const rows = [
      entry('spend-1', 'SQ *STARBUCKS #1234', 650),
      entry('spend-2', 'STARBUCKS', 1_500),
      entry('spend-3', 'WHOLE FOODS MARKET', 3_000),
    ];
    const applied = await applyRuleRetroactively(store, ACCOUNT, rule, rows, NOW);
    expect(applied.affected).toBe(1);
    const overrides = await store.getOverrides(ACCOUNT);
    expect(overrides.get('spend-1')).toMatchObject({ category: 'entertainment', ruleId: rule.ruleId, ruleVersion: 1 });
    expect(overrides.has('spend-2')).toBe(false);
    expect(overrides.has('spend-3')).toBe(false);
  });

  it('turns a merchant correction into an alias that resolves next time', async () => {
    const store = new InMemoryEnrichmentStore();
    const rows = [
      entry('spend-1', 'CORNER MART #44', 900, 'other'),
      entry('spend-2', 'CORNER MART SEATTLE WA', 1_100, 'other'),
    ];
    const correction = await recordMerchantCorrection(store, ACCOUNT, rows, {
      transactionId: 'spend-1',
      merchantName: 'Corner Mart',
      category: 'groceries',
    }, NOW);
    expect(correction.merchant.name).toBe('Corner Mart');
    expect(correction.override.category).toBe('groceries');
    const second = await enrichSpendDraft(store, ACCOUNT, draft('CORNER MART #44', 900), NOW);
    expect(second.merchantName).toBe('Corner Mart');
    expect(second.merchantMethod).toBe('exact_alias');
    expect(second.category).toBe('groceries');
  });

  it('rejects a correction for a transaction outside the account', async () => {
    const store = new InMemoryEnrichmentStore();
    await expect(recordMerchantCorrection(store, ACCOUNT, [], {
      transactionId: 'missing',
      merchantName: 'Corner Mart',
    }, NOW)).rejects.toThrow(/not found/i);
  });
});

describe('mergeMerchantAlias', () => {
  it('does not duplicate an alias but records a new one in sorted order', () => {
    const merchant = { id: 'm1', name: 'Corner Mart', domain: null, defaultCategory: null, aliases: ['CORNER MART'] };
    expect(mergeMerchantAlias(merchant, 'CORNER MART').aliases).toHaveLength(1);
    expect(mergeMerchantAlias(merchant, 'CORNER MART SEATTLE').aliases).toEqual([
      'CORNER MART',
      'CORNER MART SEATTLE',
    ]);
  });
});
