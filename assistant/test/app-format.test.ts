import { describe, expect, it } from 'vitest';
import { changeWords, dayLabel, displayName, groupByDay, initials, money, parseMoney } from '../src/web/app/format.js';
import { declineCopy } from '../src/web/app/copy.js';
import { DECLINE_REASONS } from '../src/server/tools.js';

describe('parseMoney', () => {
  it('reads what the server formats', () => {
    expect(parseMoney('$1,234.50')).toBe(123_450);
    expect(parseMoney('-$5.00')).toBe(-500);
    expect(parseMoney('+$0.07')).toBe(7);
    expect(parseMoney('$0.00')).toBe(0);
  });
  it('returns null for text that is not money', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney('about five dollars')).toBeNull();
  });
  it('round-trips with money()', () => {
    for (const minor of [0, 1, 99, 100, 123_456_789]) expect(parseMoney(money(minor))).toBe(minor);
  });
});

describe('names', () => {
  it('drops the random suffix on demo owners', () => {
    expect(displayName('anthony-4b4792')).toBe('Anthony');
    expect(displayName('sam')).toBe('Sam');
    expect(displayName('system:funding')).toBe('Your bank');
    expect(initials('jordan-1a2b3c')).toBe('J');
  });
});

describe('days', () => {
  const now = new Date(2026, 9, 18, 15, 0);
  it('labels today and yesterday', () => {
    expect(dayLabel(new Date(2026, 9, 18, 9, 0).toISOString(), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 9, 17, 23, 0).toISOString(), now)).toBe('Yesterday');
  });
  it('groups consecutive rows by day', () => {
    const rows = [
      { occurredAt: new Date(2026, 9, 18, 14, 0).toISOString(), id: 'a' },
      { occurredAt: new Date(2026, 9, 18, 8, 0).toISOString(), id: 'b' },
      { occurredAt: new Date(2026, 9, 17, 8, 0).toISOString(), id: 'c' },
    ];
    const groups = groupByDay(rows, now);
    expect(groups.map((g) => [g.label, g.rows.length])).toEqual([['Today', 2], ['Yesterday', 1]]);
  });
});

describe('changeWords', () => {
  it('describes week over week change', () => {
    expect(changeWords(150, 100)).toBe('50% more than last week');
    expect(changeWords(50, 100)).toBe('50% less than last week');
    expect(changeWords(100, 100)).toBe('Same as last week');
    expect(changeWords(0, 0)).toBeNull();
  });
});

describe('declineCopy', () => {
  it('has friendly copy for every code the ledger can return', () => {
    for (const code of Object.keys(DECLINE_REASONS)) {
      const copy = declineCopy(code);
      expect(copy.title).not.toMatch(/^This payment was declined$/);
      expect(copy.next.length).toBeGreaterThan(5);
    }
  });
  it('falls back for unknown codes', () => {
    expect(declineCopy('SOMETHING_NEW', 'because').why).toBe('because');
  });
});
