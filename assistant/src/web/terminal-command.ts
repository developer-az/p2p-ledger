/** Maps CMD line input to actions before falling through to chat. */

export type TerminalAction =
  | { kind: 'help' }
  | { kind: 'onboard' }
  | { kind: 'audit' }
  | { kind: 'race' }
  | { kind: 'deposit'; amount: string }
  | { kind: 'pay'; args: string }
  | { kind: 'split'; totalMinor: number; peers: string[]; memo: string }
  | { kind: 'peer'; owner: string }
  | { kind: 'peers' }
  | { kind: 'bank-in' }
  | { kind: 'bank-out' }
  | { kind: 'open'; owner: string }
  | { kind: 'signout' }
  | { kind: 'refresh' }
  | { kind: 'log'; amountMinor: number; category: string; note: string }
  | { kind: 'chat'; text: string };

export function parseTerminalInput(raw: string): TerminalAction {
  const line = raw.trim();
  if (!line) return { kind: 'chat', text: '' };

  const lower = line.toLowerCase();

  if (lower === 'help' || lower === ':help' || lower === 'f1') return { kind: 'help' };
  if (lower === 'f2' || lower === ':onboard' || lower === ':seed') return { kind: 'onboard' };
  if (lower === 'f3' || lower === ':audit' || lower === ':integrity') return { kind: 'audit' };
  if (lower === 'f4' || lower === ':race') return { kind: 'race' };
  if (lower === ':signout' || lower === 'signout') return { kind: 'signout' };
  if (lower === ':refresh' || lower === 'refresh') return { kind: 'refresh' };

  if (lower.startsWith(':deposit ')) return { kind: 'deposit', amount: line.slice(9).trim() };
  if (lower.startsWith('deposit ')) return { kind: 'deposit', amount: line.slice(8).trim() };

  if (lower.startsWith(':pay ')) return { kind: 'pay', args: line.slice(5).trim() };
  const payNatural = /^pay\s+(\S+\s+\S+(?:\s+.+)?)$/i.exec(line);
  const payArgs = payNatural?.[1];
  if (payArgs) return { kind: 'pay', args: payArgs.trim() };

  if (lower.startsWith(':open ')) return { kind: 'open', owner: line.slice(6).trim() };
  if (lower.startsWith('open ')) return { kind: 'open', owner: line.slice(5).trim() };

  if (lower === ':peers' || lower === 'peers') return { kind: 'peers' };
  if (lower === 'bank in' || lower === ':bank in' || lower === 'ach in' || lower === ':ach in') return { kind: 'bank-in' };
  if (lower === 'bank out' || lower === ':bank out' || lower === 'ach out' || lower === ':ach out') return { kind: 'bank-out' };
  if (lower.startsWith(':peer ')) return { kind: 'peer', owner: line.slice(6).trim() };
  if (lower.startsWith('peer ')) return { kind: 'peer', owner: line.slice(5).trim() };

  const logLine = /^log\s+(\S+)\s+(\S+)(?:\s+(.+))?$/i.exec(line);
  const logAmount = logLine?.[1];
  const logCategory = logLine?.[2];
  if (logAmount && logCategory) {
    const total = Number(logAmount.replace(/[$,]/g, ''));
    if (Number.isFinite(total) && total > 0) {
      return {
        kind: 'log',
        amountMinor: Math.round(total * 100),
        category: logCategory.toLowerCase(),
        note: (logLine[3] ?? '').trim(),
      };
    }
  }

  const splitLine = /^split\s+(\S+)\s+(.+)$/i.exec(line);
  const splitAmount = splitLine?.[1];
  const splitRest = splitLine?.[2];
  if (splitAmount && splitRest) {
    const total = Number(splitAmount.replace(/[$,]/g, ''));
    if (Number.isFinite(total) && total > 0) {
      const tokens = splitRest.trim().split(/\s+/).filter(Boolean);
      if (tokens.length >= 1) {
        const memo = tokens.length > 1 ? tokens[tokens.length - 1]! : 'split';
        const peerTokens = tokens.length > 1 ? tokens.slice(0, -1) : tokens;
        const peers = peerTokens.map((t) => t.toLowerCase()).slice(0, 8);
        return {
          kind: 'split',
          totalMinor: Math.round(total * 100),
          peers,
          memo,
        };
      }
    }
  }

  return { kind: 'chat', text: line };
}

/** Split total cents across N peers (last peer gets rounding remainder). */
export function splitAmountsMinor(totalMinor: number, peerCount: number): number[] {
  if (peerCount <= 0) return [];
  const base = Math.floor(totalMinor / peerCount);
  const remainder = totalMinor - base * peerCount;
  return Array.from({ length: peerCount }, (_, i) => base + (i === peerCount - 1 ? remainder : 0));
}
