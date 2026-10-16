import { describe, expect, it } from 'vitest';
import { MAX_DOLLARS_UI, parseDollarsToMinor } from '../src/server/money.js';

describe('parseDollarsToMinor', () => {
  it('accepts up to $999,000', () => {
    expect(parseDollarsToMinor('999000')).toBe(99_900_000);
    expect(parseDollarsToMinor('999,000.00')).toBe(99_900_000);
  });

  it('rejects above UI cap', () => {
    expect(parseDollarsToMinor('999001')).toBeNull();
    expect(parseDollarsToMinor(String(MAX_DOLLARS_UI + 1))).toBeNull();
  });
});
