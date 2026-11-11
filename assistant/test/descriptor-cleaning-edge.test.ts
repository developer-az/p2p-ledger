import { describe, expect, it } from 'vitest';
import { cleanDescriptor } from '../src/server/enrichment/descriptor.js';

/**
 * Edge cases for descriptor cleaning: processor prefixes that only apply with
 * their delimiter, stacked prefixes, parenthesised phone numbers and the
 * marketplace forms that hide the merchant behind an order code.
 */
describe('cleanDescriptor edge cases', () => {
  it.each([
    ['SPROUTS FARMERS MARKET #123 SEATTLE WA', 'SPROUTS FARMERS MARKET'],
    ['SQUARESPACE INC', 'SQUARESPACE INC'],
    ['PPG PAINTS STORE 12', 'PPG PAINTS'],
    ['SP *SPROUTS FARMERS MARKET', 'SPROUTS FARMERS MARKET'],
    ['SQUARE *BLUE BOTTLE COFFEE', 'BLUE BOTTLE COFFEE'],
    ['PAYPAL*NETFLIX.COM', 'NETFLIX'],
    ['PP*STARBUCKS', 'STARBUCKS'],
    ['TST* STARBUCKS', 'STARBUCKS'],
    ['SQ *SQ *STARBUCKS #99', 'STARBUCKS'],
    ['PAYPAL *PAYPAL *NETFLIX', 'NETFLIX'],
    ['(800)555-1212 STARBUCKS', 'STARBUCKS'],
    ['STARBUCKS (800)555-1212', 'STARBUCKS'],
    ['STARBUCKS (800) 555-1212 SEATTLE WA', 'STARBUCKS'],
    ['AMAZON.COM*AB12', 'AMAZON'],
    ['AMZN.COM/BILL', 'AMAZON'],
    ['AMZN*2H4K9', 'AMAZON'],
    ['TARGET T-1234', 'TARGET'],
  ])('cleans %s', (raw, expected) => {
    expect(cleanDescriptor(raw)).toBe(expected);
  });

  it('keeps a merchant that merely starts with the letters of a processor code', () => {
    expect(cleanDescriptor('SPROUTS FARMERS MARKET')).toBe('SPROUTS FARMERS MARKET');
    expect(cleanDescriptor('SQUARESPACE')).toBe('SQUARESPACE');
    expect(cleanDescriptor('PPG PAINTS')).toBe('PPG PAINTS');
  });
});
