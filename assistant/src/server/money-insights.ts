import type { AccountSummary } from './tools.js';
import type { HabitsHome, SpendLogEntry } from './spend-log.js';
import type { AccountActivity } from './tools.js';

export type FeedKind = 'logged' | 'income' | 'paid' | 'failed';

export interface ActivityFeedRow {
  id: string;
  kind: FeedKind;
  /** Plain label for the TYPE column */
  label: string;
  detail: string;
  amount: string;
  occurredAt: string;
  /** Ledger transfer id when kind is not logged */
  transferId?: string;
  spendId?: string;
  category?: string;
}

export interface PersonalInsights {
  walletBalance: string;
  income30d: string;
  loggedSpend30d: string;
  sentToPeople30d: string;
  bullets: string[];
}

function transferKind(t: AccountActivity): FeedKind {
  if (t.status === 'REJECTED') return 'failed';
  if (t.direction === 'deposit' || t.direction === 'received') return 'income';
  return 'paid';
}

function transferLabel(t: AccountActivity): string {
  if (t.status === 'REJECTED') return 'Payment blocked';
  if (t.direction === 'deposit') return 'Money in';
  if (t.direction === 'received') return 'Received';
  return 'Paid out';
}

function transferDetail(t: AccountActivity): string {
  if (t.direction === 'deposit') return t.memo || 'Deposit';
  if (t.direction === 'received') return `From ${t.counterparty}${t.memo ? ` · ${t.memo}` : ''}`;
  return `To ${t.counterparty}${t.memo ? ` · ${t.memo}` : ''}`;
}

export function buildActivityFeed(
  transfers: AccountActivity[],
  spends: SpendLogEntry[],
  formatSpend: (minor: number, currency: string) => string,
): ActivityFeedRow[] {
  const rows: ActivityFeedRow[] = [];
  for (const s of spends) {
    rows.push({
      id: `spend-${s.id}`,
      kind: 'logged',
      label: 'You logged',
      detail: [s.category, s.note].filter(Boolean).join(' · ') || s.category,
      amount: formatSpend(s.amountMinor, s.currency),
      occurredAt: s.occurredAt,
      spendId: s.id,
      category: s.category,
    });
  }
  for (const t of transfers) {
    rows.push({
      id: `xfer-${t.transferId}`,
      kind: transferKind(t),
      label: transferLabel(t),
      detail: transferDetail(t),
      amount: t.amount,
      occurredAt: t.createdAt,
      transferId: t.transferId,
    });
  }
  return rows.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

export function buildPersonalInsights(
  balance: string,
  summary: AccountSummary,
  habits: HabitsHome,
): PersonalInsights {
  const income30d = summary.inflow ?? summary.deposited;
  const loggedSpend30d = habits.summary30d.totalSpent;
  const sentToPeople30d = summary.sent;
  const bullets: string[] = [];

  bullets.push(
    `Last 7 days you logged ${habits.weekly.totalThisWeek} on your own categories (${habits.weekly.weekOverWeek}).`,
  );
  if (habits.summary30d.entryCount === 0) {
    bullets.push('No spending logs yet — use LOG or `log 12 dining coffee` so insights are about you, not your bank’s categories.');
  } else {
    const top = habits.summary30d.byCategory[0];
    if (top) bullets.push(`Your biggest logged category this month is ${top.category} (${top.total}, ${top.count} entries).`);
  }
  if (summary.deposited !== '$0.00' || summary.received !== '$0.00') {
    bullets.push(
      `On the ledger (real wallet): ${income30d} came in and ${sentToPeople30d} went to people in 30 days — separate from what you log for habits.`,
    );
  }
  bullets.push('Banks optimize for spend. This feed mixes what you choose to track with exact ledger moves when you settle up.');

  return {
    walletBalance: balance,
    income30d,
    loggedSpend30d,
    sentToPeople30d,
    bullets,
  };
}
