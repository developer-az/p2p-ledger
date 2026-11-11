import { describe, expect, it } from 'vitest';
import {
  applyCascade,
  previewRule,
  type NormalizedTransaction,
  type UserRule,
} from '../src/server/enrichment/categorize.js';
import { MERCHANT_CATALOG } from '../src/server/enrichment/merchants.js';

const ACCOUNT = '00000000-0000-4000-8000-000000000001';
const NOW = '2026-10-08T12:00:00.000Z';

function tx(id: string, descriptor: string, amountMinor: number): NormalizedTransaction {
  return {
    id,
    accountId: ACCOUNT,
    amountMinor,
    descriptor,
    occurredAt: NOW,
    category: null,
  };
}

function rule(overrides: Partial<UserRule> = {}): UserRule {
  return {
    id: `${ACCOUNT}:rule-1:v1`,
    ruleId: 'rule-1',
    accountId: ACCOUNT,
    merchantContains: 'STARBUCKS',
    maxAmountMinor: 1_000,
    category: 'other',
    version: 1,
    status: 'active',
    createdAt: NOW,
    ...overrides,
  };
}

describe('categorization cascade', () => {
  it('puts a matching user rule above the merchant default', () => {
    const result = applyCascade(tx('s1', 'SQ *STARBUCKS #1234', 650), {
      merchants: MERCHANT_CATALOG,
      rules: [rule()],
    });
    expect(result.merchantName).toBe('Starbucks');
    expect(result.category).toBe('other');
    expect(result.categorySource).toBe('user_rule');
    expect(result.ruleId).toBe('rule-1');
    expect(result.ruleVersion).toBe(1);
  });

  it('falls through to the merchant default when the amount is over the rule limit', () => {
    const result = applyCascade(tx('s2', 'STARBUCKS SEATTLE WA', 1_500), {
      merchants: MERCHANT_CATALOG,
      rules: [rule()],
    });
    expect(result.category).toBe('dining');
    expect(result.categorySource).toBe('merchant_default');
    expect(result.ruleId).toBeNull();
  });

  it('uses merchant defaults for a clean exact alias', () => {
    const result = applyCascade(tx('s3', 'WHOLE FOODS MARKET #1029', 4_500), {
      merchants: MERCHANT_CATALOG,
      rules: [],
    });
    expect(result.merchantName).toBe('Whole Foods Market');
    expect(result.category).toBe('groceries');
    expect(result.categorySource).toBe('merchant_default');
  });

  it('uses a keyword when no merchant resolves', () => {
    const result = applyCascade(tx('s4', 'JOES PIZZA PALACE', 2_100), {
      merchants: MERCHANT_CATALOG,
      rules: [],
    });
    expect(result.merchant).toBeNull();
    expect(result.category).toBe('dining');
    expect(result.categorySource).toBe('keyword');
  });

  it('records an unresolved descriptor as other', () => {
    const result = applyCascade(tx('s5', 'ZZQX HOLDINGS', 2_100), {
      merchants: MERCHANT_CATALOG,
      rules: [],
    });
    expect(result.category).toBe('other');
    expect(result.categorySource).toBe('unresolved');
  });

  it('prefers a manual override over every automatic source', () => {
    const result = applyCascade(tx('s6', 'STARBUCKS', 650), {
      merchants: MERCHANT_CATALOG,
      rules: [rule()],
      override: { category: 'health', source: 'user_correction', ruleId: null, ruleVersion: null, merchantId: null },
    });
    expect(result.category).toBe('health');
    expect(result.categorySource).toBe('user_correction');
  });

  it('uses the newest active version of a rule when both match', () => {
    const result = applyCascade(tx('s7', 'STARBUCKS', 650), {
      merchants: MERCHANT_CATALOG,
      rules: [
        rule({ id: `${ACCOUNT}:rule-1:v2`, version: 2, category: 'shopping' }),
        rule({ id: `${ACCOUNT}:rule-1:v1`, version: 1, category: 'entertainment' }),
      ],
    });
    expect(result.category).toBe('shopping');
    expect(result.ruleVersion).toBe(2);
  });
});

describe('rule preview', () => {
  const transactions = [
    tx('s1', 'SQ *STARBUCKS #1234', 650),
    tx('s2', 'STARBUCKS SEATTLE WA', 1_500),
    tx('s3', 'WHOLE FOODS MARKET', 3_000),
  ];

  it('lists only matching transactions and leaves the input untouched', () => {
    const before = JSON.stringify(transactions);
    const preview = previewRule(rule(), transactions, MERCHANT_CATALOG);
    expect(preview.affected).toBe(1);
    expect(preview.transactions.map((row) => row.transactionId)).toEqual(['s1']);
    expect(preview.transactions[0]).toMatchObject({ merchantName: 'Starbucks', category: 'other' });
    expect(JSON.stringify(transactions)).toBe(before);
  });

  it('matches a rule against the resolved merchant name, not just the raw text', () => {
    const preview = previewRule(rule({ merchantContains: 'Starbucks', maxAmountMinor: null }), transactions, MERCHANT_CATALOG);
    expect(preview.affected).toBe(2);
  });

  it('treats the amount limit as strict', () => {
    const exact = previewRule(rule({ maxAmountMinor: 650 }), transactions, MERCHANT_CATALOG);
    expect(exact.affected).toBe(0);
    const above = previewRule(rule({ maxAmountMinor: 651 }), transactions, MERCHANT_CATALOG);
    expect(above.affected).toBe(1);
  });
});
