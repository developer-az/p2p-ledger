import { describe, expect, it } from 'vitest';
import { parseTerminalInput } from '../src/web/terminal-command.js';

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

  it('maps peer focus and split bill pay', () => {
    expect(parseTerminalInput('peer sam')).toEqual({ kind: 'peer', owner: 'sam' });
    expect(parseTerminalInput('split 50 sam dinner')).toEqual({ kind: 'pay', args: 'sam 25.00 dinner' });
  });
});
