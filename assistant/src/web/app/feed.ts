import type { AccountView } from '../api.js';
import { displayName, parseMoney } from './format.js';

export type FeedKind = 'sent' | 'received' | 'deposit' | 'declined' | 'spend' | 'income';

/** One line in the activity list, whether it came from the ledger or from the person's own logs. */
export interface FeedItem {
  id: string;
  kind: FeedKind;
  title: string;
  subtitle: string;
  /** Signed cents: negative leaves the wallet or budget, positive arrives. */
  signedMinor: number;
  occurredAt: string;
  /** Present for ledger rows. Logged spends and income have no transfer. */
  transferId?: string;
  counterparty?: string;
  memo?: string | null;
  category?: string;
  declineReason?: string | null;
  declineExplanation?: string | null;
}

export function isLedgerItem(item: FeedItem): boolean {
  return item.transferId !== undefined;
}

const CATEGORY_WORDS: Record<string, string> = {
  dining: 'Dining',
  groceries: 'Groceries',
  transport: 'Transport',
  entertainment: 'Fun',
  housing: 'Housing',
  shopping: 'Shopping',
  health: 'Health',
  other: 'Other',
};

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function buildFeed(view: AccountView): FeedItem[] {
  const items: FeedItem[] = [];

  for (const t of view.transfers) {
    const minor = parseMoney(t.amount) ?? 0;
    const name = displayName(t.counterparty);
    const base = { id: `x-${t.transferId}`, transferId: t.transferId, occurredAt: t.createdAt, memo: t.memo };
    if (t.status === 'REJECTED') {
      const incoming = t.direction !== 'sent';
      items.push({
        ...base,
        kind: 'declined',
        title: t.memo || (incoming ? `Payment from ${name}` : `Payment to ${name}`),
        subtitle: incoming ? `Declined · ${name}'s payment to you` : `Declined · To ${name}`,
        signedMinor: incoming ? minor : -minor,
        counterparty: t.counterparty,
        declineReason: t.declineReason,
        declineExplanation: t.declineExplanation,
      });
    } else if (t.direction === 'deposit') {
      items.push({ ...base, kind: 'deposit', title: 'Added from bank', subtitle: 'Bank transfer', signedMinor: minor, counterparty: t.counterparty });
    } else if (t.direction === 'received') {
      items.push({ ...base, kind: 'received', title: t.memo || `From ${name}`, subtitle: `From ${name}`, signedMinor: minor, counterparty: t.counterparty });
    } else {
      items.push({ ...base, kind: 'sent', title: t.memo || `To ${name}`, subtitle: `To ${name}`, signedMinor: -minor, counterparty: t.counterparty });
    }
  }

  for (const row of view.activityFeed ?? []) {
    if (row.kind !== 'logged' && row.kind !== 'logged_income') continue;
    const minor = parseMoney(row.amount) ?? 0;
    const note = row.detail.includes(' · ') ? row.detail.split(' · ').slice(1).join(' · ') : '';
    const category = row.category ?? 'other';
    if (row.kind === 'logged') {
      items.push({
        id: row.id,
        kind: 'spend',
        title: note || CATEGORY_WORDS[category] || titleCase(category),
        subtitle: `Logged by you · ${CATEGORY_WORDS[category] ?? titleCase(category)}`,
        signedMinor: -minor,
        occurredAt: row.occurredAt,
        category,
      });
    } else {
      items.push({
        id: row.id,
        kind: 'income',
        title: note || titleCase(category),
        subtitle: `Logged by you · ${titleCase(category)}`,
        signedMinor: minor,
        occurredAt: row.occurredAt,
        category,
      });
    }
  }

  return items.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

export type FeedFilter = 'all' | 'payments' | 'spending' | 'income' | 'declined';

export function filterFeed(items: FeedItem[], filter: FeedFilter, query: string): FeedItem[] {
  const q = query.trim().toLowerCase();
  return items.filter((i) => {
    if (filter === 'payments' && !(i.kind === 'sent' || i.kind === 'received' || i.kind === 'deposit')) return false;
    if (filter === 'spending' && i.kind !== 'spend') return false;
    if (filter === 'income' && !(i.kind === 'income' || i.kind === 'received' || i.kind === 'deposit')) return false;
    if (filter === 'declined' && i.kind !== 'declined') return false;
    if (!q) return true;
    return `${i.title} ${i.subtitle} ${i.category ?? ''}`.toLowerCase().includes(q);
  });
}
