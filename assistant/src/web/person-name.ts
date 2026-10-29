const KNOWN_PEERS = new Set(['anthony', 'sam', 'jordan', 'treasurer']);

/** Display name for ledger owner_id (peers, bank corridors). */
export function personName(owner: string): string {
  if (owner.startsWith('Bank funding')) return 'Bank';
  const parts = owner.split('-').filter(Boolean);
  if (parts.length === 0) return owner;
  const base = parts[0]!;
  const label = base.charAt(0).toUpperCase() + base.slice(1);
  const tag = parts[1];
  const baseKey = base.toLowerCase();
  if (
    tag
    && tag.length <= 8
    && /^[a-f0-9]+$/i.test(tag)
    && !KNOWN_PEERS.has(baseKey)
  ) {
    return `${label} ·${tag}`;
  }
  return label;
}
