import { describe, expect, it } from 'vitest';
import { parseTerminalInput, splitAmountsMinor } from '../src/web/terminal-command.js';

describe('parseTerminalInput', () => {
  it('maps function keys and help', () => {
    expect(parseTerminalInput('F1').kind).toBe('help');
    expect(parseTerminalInput('f1').kind).toBe('help');
    expect(parseTerminalInput('F2').kind).toBe('onboard');
    expect(parseTerminalInput('F4').kind).toBe('race');
  });

  it('maps natural pay without colon', () => {
    const p = parseTerminalInput('pay sam 10 lunch');
    expect(p).toEqual({ kind: 'pay', args: 'sam 10 lunch' });
  });

  it('maps colon pay', () => {
    expect(parseTerminalInput(':pay sam 10 lunch')).toEqual({ kind: 'pay', args: 'sam 10 lunch' });
  });

  it('falls through to chat for questions', () => {
    expect(parseTerminalInput('what is my balance?')).toEqual({ kind: 'chat', text: 'what is my balance?' });
  });

  it('maps deposit variants', () => {
    expect(parseTerminalInput('deposit 50').kind).toBe('deposit');
    expect(parseTerminalInput(':deposit 50')).toEqual({ kind: 'deposit', amount: '50' });
  });

  it('maps peer focus', () => {
    expect(parseTerminalInput('peer sam')).toEqual({ kind: 'peer', owner: 'sam' });
  });

  it('maps log spend command', () => {
    expect(parseTerminalInput('log 12.50 dining lunch')).toEqual({
      kind: 'log',
      amountMinor: 1250,
      category: 'dining',
      note: 'lunch',
    });
  });

  it('maps split bill across one peer', () => {
    expect(parseTerminalInput('split 50 sam dinner')).toEqual({
      kind: 'split',
      totalMinor: 5000,
      peers: ['sam'],
      memo: 'dinner',
    });
  });

  it('maps split with dollar sign and multiple peers', () => {
    expect(parseTerminalInput('split $60 sam jordan lunch')).toEqual({
      kind: 'split',
      totalMinor: 6000,
      peers: ['sam', 'jordan'],
      memo: 'lunch',
    });
  });
});

describe('splitAmountsMinor', () => {
  it('distributes remainder to last peer', () => {
    expect(splitAmountsMinor(100, 3)).toEqual([33, 33, 34]);
  });
});
