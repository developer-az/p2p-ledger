import { describe, expect, it } from 'vitest';
import { cleanDescriptor, prettyDescriptor } from '../src/server/enrichment/descriptor.js';

/**
 * Table of synthetic card descriptors. Every row is generated from a known
 * merchant name plus the noise kinds a real statement feed carries, so a
 * failure points at one cleaning rule rather than at a hand-written expectation.
 */
const MERCHANTS = [
  'BLUE BOTTLE COFFEE',
  'STARBUCKS',
  'TRADER JOES',
  'WHOLE FOODS MARKET',
  'CHIPOTLE MEXICAN GRILL',
  'MCDONALDS',
  'SWEETGREEN',
  'SHAKE SHACK',
  'DOORDASH',
  'UBER EATS',
  'AMAZON',
  'TARGET',
  'COSTCO WHOLESALE',
  'SHELL OIL',
  'UBER TRIP HELP UBER',
  'LYFT',
  'NETFLIX',
  'SPOTIFY',
  'HULU',
  'COMCAST XFINITY',
  'VERIZON WIRELESS',
  'CVS PHARMACY',
  'WALGREENS',
  'BEST BUY',
  'HOME DEPOT',
  'DELTA AIR LINES',
  'MARRIOTT',
  'PLANET FITNESS',
  'PETCO',
  'SWEETGREEN NYC',
] as const;

const PREFIXES = ['', 'SQ *', 'TST* ', 'PAYPAL *', 'SP *', 'PP*', 'STRIPE *', 'POS DEBIT '] as const;
const SUFFIXES = [
  '',
  ' #1234',
  ' STORE 0456',
  ' 800-555-1212',
  ' SEATTLE WA 98101',
  ' NEW YORK, NY',
  ' XXXX1234',
  ' CARD 4321',
  ' USA',
  ' REF 88K2',
  ' 10/08',
  ' TERM 004',
  ' 1234',
] as const;

const table: Array<[string, string]> = [];
for (const [index, merchant] of MERCHANTS.entries()) {
  const variants = [
    `${PREFIXES[index % PREFIXES.length]}${merchant}${SUFFIXES[index % SUFFIXES.length]}`,
    `${PREFIXES[(index + 1) % PREFIXES.length]}${merchant}${SUFFIXES[(index + 2) % SUFFIXES.length]}`,
    `${PREFIXES[(index + 2) % PREFIXES.length]}${merchant}${SUFFIXES[(index + 4) % SUFFIXES.length]}`,
    `${PREFIXES[(index + 3) % PREFIXES.length]}${merchant}${SUFFIXES[(index + 6) % SUFFIXES.length]}`,
    `${PREFIXES[(index + 4) % PREFIXES.length]}${merchant}${SUFFIXES[(index + 8) % SUFFIXES.length]}`,
  ];
  for (const raw of variants) table.push([raw, merchant]);
}

describe('cleanDescriptor', () => {
  it('has a table of 150+ synthetic descriptors', () => {
    expect(table.length).toBeGreaterThanOrEqual(150);
  });

  it.each(table)('cleans %s', (raw, expected) => {
    expect(cleanDescriptor(raw)).toBe(expected);
  });

  it.each([
    ['SQ *BLUE BOTTLE COFFEE #1234 SEATTLE WA 98101', 'BLUE BOTTLE COFFEE'],
    ['TST* SWEETGREEN 800-555-1212', 'SWEETGREEN'],
    ['PAYPAL *NETFLIX.COM 866-579-7172', 'NETFLIX'],
    ['SP *ETSY INC NEW YORK NY', 'ETSY INC'],
    ['AMZN Mktp US*2H4K9', 'AMAZON'],
    ['AMAZON MKTPL*Q12XY', 'AMAZON'],
    ['APPLE.COM/BILL 866-712-7753', 'APPLE'],
    ['POS DEBIT TRADER JOES #456 800-555-1212', 'TRADER JOES'],
    ['CHECKCARD 1008 STARBUCKS 1234 SEATTLE WA', 'STARBUCKS'],
    ['DEBIT CARD PURCHASE - WHOLE FOODS MKT 1029 10/08', 'WHOLE FOODS MKT'],
    ['UBER   *TRIP HELP.UBER.COM', 'UBER TRIP HELP UBER'],
    ['  ', ''],
    ['***', ''],
  ])('handles the edge case %s', (raw, expected) => {
    expect(cleanDescriptor(raw)).toBe(expected);
  });

  it('is idempotent', () => {
    for (const [raw, expected] of table.slice(0, 40)) {
      expect(cleanDescriptor(cleanDescriptor(raw))).toBe(expected);
    }
  });

  it('produces a readable label for a cleaned descriptor', () => {
    expect(prettyDescriptor('BLUE BOTTLE COFFEE')).toBe('Blue Bottle Coffee');
    expect(prettyDescriptor('TRADER JOES')).toBe('Trader Joes');
  });
});
