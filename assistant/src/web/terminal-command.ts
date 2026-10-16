/** Maps CMD line input to actions before falling through to chat. */

export type TerminalAction =
  | { kind: 'help' }
  | { kind: 'onboard' }
  | { kind: 'audit' }
  | { kind: 'race' }
  | { kind: 'deposit'; amount: string }
  | { kind: 'pay'; args: string }
  | { kind: 'split'; total: string; args: string }
  | { kind: 'peer'; owner: string }
  | { kind: 'peers' }
  | { kind: 'open'; owner: string }
  | { kind: 'signout' }
  | { kind: 'refresh' }
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
  if (lower.startsWith(':peer ')) return { kind: 'peer', owner: line.slice(6).trim() };
  if (lower.startsWith('peer ')) return { kind: 'peer', owner: line.slice(5).trim() };

  const split = /^split\s+(\S+)\s+(\S+)(?:\s+(.+))?$/i.exec(line);
  const splitTotal = split?.[1];
  const splitPeer = split?.[2];
  if (splitTotal && splitPeer) {
    const half = Number(splitTotal.replace(/[$,]/g, ''));
    if (Number.isFinite(half) && half > 0) {
      const each = (half / 2).toFixed(2);
      const memo = split[3]?.trim() || 'split';
      return { kind: 'pay', args: `${splitPeer} ${each} ${memo}` };
    }
  }

  return { kind: 'chat', text: line };
}
