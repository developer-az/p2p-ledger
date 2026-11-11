import { describe, expect, it } from 'vitest';
import {
  MERCHANT_CATALOG,
  merchantByAlias,
  normalizeMerchantName,
  resolveMerchant,
  similarity,
} from '../src/server/enrichment/merchants.js';

describe('merchant resolution', () => {
  it('matches an exact alias before trying similarity', () => {
    const match = resolveMerchant('SQ *STARBUCKS #1234 SEATTLE WA', MERCHANT_CATALOG);
    expect(match.method).toBe('exact_alias');
    expect(match.confidence).toBe(1);
    expect(match.merchant?.name).toBe('Starbucks');
  });

  it('normalizes punctuation for exact aliases', () => {
    expect(normalizeMerchantName('Trader Joe\'s')).toBe('TRADER JOES');
    expect(merchantByAlias(MERCHANT_CATALOG, 'TRADER JOES')?.name).toBe('Trader Joe\'s');
  });

  it('resolves a one-letter typo with trigram similarity', () => {
    const match = resolveMerchant('BLUE BOTTLE COFEE', MERCHANT_CATALOG);
    expect(match.method).toBe('similarity');
    expect(match.merchant?.name).toBe('Blue Bottle Coffee');
    expect(match.confidence).toBeGreaterThanOrEqual(0.6);
    expect(match.confidence).toBeLessThan(1);
  });

  it('does not guess when the score is below the threshold', () => {
    const match = resolveMerchant('ZZQX HOLDINGS', MERCHANT_CATALOG);
    expect(match.method).toBe('unresolved');
    expect(match.merchant).toBeNull();
    expect(match.confidence).toBe(0);
  });

  it('lets a higher threshold turn a fuzzy hit into unresolved', () => {
    const match = resolveMerchant('BLUE BOTTLE COFEE', MERCHANT_CATALOG, { threshold: 0.99 });
    expect(match.merchant).toBeNull();
  });

  it('scores identical strings as 1 and disjoint strings as 0', () => {
    expect(similarity('STARBUCKS', 'STARBUCKS')).toBe(1);
    expect(similarity('STARBUCKS', 'ZZQX HOLDINGS')).toBe(0);
  });

  it('prefers the longer, more specific alias when two merchants share a prefix', () => {
    expect(resolveMerchant('UBER EATS', MERCHANT_CATALOG).merchant?.name).toBe('Uber Eats');
    expect(resolveMerchant('UBER TRIP', MERCHANT_CATALOG).merchant?.name).toBe('Uber');
  });
});
