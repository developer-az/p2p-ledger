/** M3.3 — dedupe keys carry an occurrence index, so identical coffees survive. */
import { describe, expect, it } from 'vitest';
import {
  assignDedupeKeys,
  cleanDescriptor,
  dedupeKeyFor,
  splitNewRows,
} from '../src/server/import-dedupe.js';

const coffee = {
  postedDate: '2026-07-15',
  amountMinor: -550,
  descriptorClean: 'blue bottle coffee',
  lineNumber: 10,
};

describe('descriptor cleanup', () => {
  it('normalizes case, whitespace and trailing card numbers', () => {
    expect(cleanDescriptor('  BLUE   BOTTLE COFFEE  #1042 ')).toBe('blue bottle coffee');
    expect(cleanDescriptor('AMAZON MKTPLACE PMTS AMZN.COM/BILL WA')).toBe('amazon mktplace pmts amzn.com/bill wa');
    expect(cleanDescriptor('')).toBe('');
  });
});

describe('dedupe keys', () => {
  it('includes the occurrence index so two identical same-day rows both survive', () => {
    const first = assignDedupeKeys('acct-1', [coffee]);
    const second = assignDedupeKeys('acct-1', [coffee]);
    // Separate calls model two rows in the same file only when the caller
    // passes the occurrence index. The pipeline groups duplicates per file.
    expect(first[0]!.dedupeKey).toBe(second[0]!.dedupeKey);
    expect(dedupeKeyFor('acct-1', coffee, 0)).not.toBe(dedupeKeyFor('acct-1', coffee, 1));
    expect(dedupeKeyFor('acct-1', coffee, 0)).toMatch(/^[a-f0-9]{64}$/);
    expect(dedupeKeyFor('acct-1', coffee, 0)).not.toBe(dedupeKeyFor('acct-2', coffee, 0));
  });

  it('assigns occurrence indexes within one file, keeping both coffees distinct', () => {
    const keyed = assignDedupeKeys('acct-1', [
      { ...coffee, lineNumber: 10 },
      { ...coffee, lineNumber: 11 },
      { ...coffee, lineNumber: 12 },
    ]);
    expect(keyed.map((r) => r.occurrenceIndex)).toEqual([0, 1, 2]);
    expect(new Set(keyed.map((r) => r.dedupeKey)).size).toBe(3);
  });

  it('reuses the same keys when an overlapping statement repeats rows', () => {
    const original = assignDedupeKeys('acct-1', [
      { ...coffee, lineNumber: 10 },
      { ...coffee, lineNumber: 11 },
    ]);
    const overlap = assignDedupeKeys('acct-1', [
      { ...coffee, lineNumber: 2 },
      { ...coffee, lineNumber: 3 },
    ]);
    expect(overlap.map((r) => r.dedupeKey)).toEqual(original.map((r) => r.dedupeKey));

    const split = splitNewRows(original, new Set([original[0]!.dedupeKey]));
    expect(split.duplicates).toHaveLength(1);
    expect(split.fresh).toHaveLength(1);
  });
});
