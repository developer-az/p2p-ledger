import { describe, expect, it } from 'vitest';
import { rankPalette, scoreMatch, type PaletteItem } from '../src/web/app/palette.js';

const cmd = (id: string, label: string, keywords?: string[]): PaletteItem => ({ id, label, kind: 'command', keywords });
const tx = (id: string, label: string): PaletteItem => ({ id, label, kind: 'transaction' });

describe('scoreMatch', () => {
  it('ranks prefix over word start over subsequence, case-insensitively', () => {
    expect(scoreMatch('ins', 'Insights')).toBe(3);
    expect(scoreMatch('INS', 'insights')).toBe(3);
    expect(scoreMatch('the', 'Toggle theme')).toBe(2);
    expect(scoreMatch('tgth', 'Toggle theme')).toBe(1);
    expect(scoreMatch('xyz', 'Toggle theme')).toBe(0);
  });

  it('treats an empty or blank query as a weak match', () => {
    expect(scoreMatch('', 'Anything')).toBe(1);
    expect(scoreMatch('   ', 'Anything')).toBe(1);
  });

  it('ignores surrounding whitespace in the query', () => {
    expect(scoreMatch('  ins ', 'Insights')).toBe(3);
  });
});

describe('rankPalette', () => {
  const commands = [
    cmd('go-overview', 'Go to Overview', ['home', 'dashboard']),
    cmd('go-transactions', 'Go to Transactions'),
    cmd('go-insights', 'Go to Insights', ['patterns']),
    cmd('new', 'New transaction', ['add', 'log']),
    cmd('theme', 'Toggle theme', ['dark', 'light']),
  ];
  const transactions = Array.from({ length: 12 }, (_, i) => tx(`t${i}`, i % 2 ? `Coffee ${i}` : `Groceries ${i}`));

  it('returns all commands in order and no transactions for an empty query', () => {
    expect(rankPalette('', commands, transactions).map((i) => i.id)).toEqual(commands.map((c) => c.id));
    expect(rankPalette('  ', commands, transactions).map((i) => i.id)).toEqual(commands.map((c) => c.id));
  });

  it('drops non-matches and sorts by score', () => {
    const ids = rankPalette('new', commands, []).map((i) => i.id);
    expect(ids[0]).toBe('new');
    expect(ids).not.toContain('theme');
  });

  it('matches keywords as well as labels, using the best score', () => {
    expect(rankPalette('patterns', commands, []).map((i) => i.id)).toEqual(['go-insights']);
    expect(rankPalette('dark', commands, []).map((i) => i.id)).toEqual(['theme']);
  });

  it('puts commands before transactions on equal scores and keeps input order within a kind', () => {
    const items = rankPalette('co', [cmd('copy', 'Copy link')], [tx('a', 'Coffee'), tx('b', 'Coconut')]);
    expect(items.map((i) => i.id)).toEqual(['copy', 'a', 'b']);
  });

  it('caps transactions at 8 by default and at the given limit', () => {
    expect(rankPalette('coffee', [], transactions).length).toBe(6);
    expect(rankPalette('e', [], transactions).filter((i) => i.kind === 'transaction').length).toBe(8);
    expect(rankPalette('e', [], transactions, { maxTransactions: 3 }).length).toBe(3);
  });

  it('does not mutate its inputs', () => {
    const before = commands.map((c) => c.id);
    rankPalette('go', commands, transactions);
    expect(commands.map((c) => c.id)).toEqual(before);
  });
});
