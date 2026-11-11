import { randomUUID } from 'node:crypto';

import { formatMoney } from './money.js';

export const SPEND_CATEGORIES = [
  'dining',
  'groceries',
  'transport',
  'entertainment',
  'housing',
  'shopping',
  'health',
  'other',
] as const;

export type SpendCategory = (typeof SPEND_CATEGORIES)[number];

export type SpendSource = 'manual' | 'cmd' | 'import';

export interface SpendLogEntry {
  id: string;
  accountId: string;
  amountMinor: number;
  currency: string;
  category: SpendCategory;
  note: string | null;
  occurredAt: string;
  source: SpendSource;
  createdAt: string;
}

export interface RecordSpendInput {
  amountMinor: number;
  category: SpendCategory;
  note?: string | null;
  occurredAt?: string;
  source?: SpendSource;
  currency?: string;
}

export interface SpendLogStore {
  record(accountId: string, input: RecordSpendInput, now?: Date, idempotencyKey?: string): Promise<SpendLogEntry>;
  list(accountId: string, opts?: { since?: Date; limit?: number }): Promise<SpendLogEntry[]>;
  /** Ascending id keyset page used by bounded data export. */
  listSpendPage(accountId: string, afterId: string | null, limit: number): Promise<SpendLogEntry[]>;
  /** Alias kept for callers that use the same name as the income store. */
  listPage(accountId: string, afterId: string | null, limit: number): Promise<SpendLogEntry[]>;
  /** Remove one manual log. Returns false when it was already gone. */
  remove(accountId: string, spendId: string): Promise<boolean>;
  /**
   * Account deletion: removes every spend log for this account. Optional because
   * the live Java ledger owns its own spend logs and keeps the append-only
   * financial history; only the TS-backed stores can purge here.
   */
  deleteAll?(accountId: string): Promise<void>;
}

export interface CategoryTotal {
  category: SpendCategory;
  total: string;
  count: number;
}

export interface SpendingSummary {
  windowDays: number;
  totalSpent: string;
  byCategory: CategoryTotal[];
  entryCount: number;
}

export interface CategoryTrend {
  category: SpendCategory;
  thisWeek: string;
  lastWeek: string;
  direction: 'up' | 'down' | 'flat';
}

export interface HabitsHome {
  weekly: {
    weekEnding: string;
    totalThisWeek: string;
    totalLastWeek: string;
    weekOverWeek: string;
    highlights: CategoryTrend[];
    recentSpends: { amount: string; category: SpendCategory; note: string | null; occurredAt: string }[];
  };
  summary30d: SpendingSummary;
}

const MS_DAY = 86_400_000;

export function isSpendCategory(value: string): value is SpendCategory {
  return (SPEND_CATEGORIES as readonly string[]).includes(value);
}

export function summarizeSpendingSince(
  entries: SpendLogEntry[],
  sinceIso: string,
  currency = 'USD',
): SpendingSummary {
  const since = Date.parse(sinceIso);
  const recent = entries.filter((e) => Date.parse(e.occurredAt) >= since);
  const byCat = new Map<SpendCategory, { minor: number; count: number }>();
  let totalMinor = 0;
  for (const e of recent) {
    totalMinor += e.amountMinor;
    const row = byCat.get(e.category) ?? { minor: 0, count: 0 };
    row.minor += e.amountMinor;
    row.count += 1;
    byCat.set(e.category, row);
  }
  const byCategory = [...byCat.entries()]
    .sort((a, b) => b[1].minor - a[1].minor)
    .map(([category, v]) => ({
      category,
      total: formatMoney(v.minor, currency),
      count: v.count,
    }));
  const windowDays = Math.max(1, Math.ceil((Date.now() - since) / MS_DAY));
  return {
    windowDays,
    totalSpent: formatMoney(totalMinor, currency),
    byCategory,
    entryCount: recent.length,
  };
}

export function summarizeSpending(entries: SpendLogEntry[], days: number, now: Date, currency = 'USD'): SpendingSummary {
  const since = now.getTime() - days * MS_DAY;
  const recent = entries.filter((e) => Date.parse(e.occurredAt) >= since);
  const byCat = new Map<SpendCategory, { minor: number; count: number }>();
  let totalMinor = 0;
  for (const e of recent) {
    totalMinor += e.amountMinor;
    const row = byCat.get(e.category) ?? { minor: 0, count: 0 };
    row.minor += e.amountMinor;
    row.count += 1;
    byCat.set(e.category, row);
  }
  const byCategory = [...byCat.entries()]
    .sort((a, b) => b[1].minor - a[1].minor)
    .map(([category, v]) => ({
      category,
      total: formatMoney(v.minor, currency),
      count: v.count,
    }));
  return {
    windowDays: days,
    totalSpent: formatMoney(totalMinor, currency),
    byCategory,
    entryCount: recent.length,
  };
}

export function weeklySpendingStory(entries: SpendLogEntry[], now: Date, currency = 'USD'): HabitsHome['weekly'] {
  const end = now.getTime();
  const thisStart = end - 7 * MS_DAY;
  const lastStart = end - 14 * MS_DAY;
  const inRange = (e: SpendLogEntry, from: number, to: number) => {
    const t = Date.parse(e.occurredAt);
    return t >= from && t < to;
  };
  const thisWeek = entries.filter((e) => inRange(e, thisStart, end));
  const lastWeek = entries.filter((e) => inRange(e, lastStart, thisStart));
  const sum = (list: SpendLogEntry[]) => list.reduce((n, e) => n + e.amountMinor, 0);
  const thisTotal = sum(thisWeek);
  const lastTotal = sum(lastWeek);
  const trendDir = (a: number, b: number): CategoryTrend['direction'] => {
    if (a === b) return 'flat';
    return a > b ? 'up' : 'down';
  };
  const catTotals = (list: SpendLogEntry[]) => {
    const m = new Map<SpendCategory, number>();
    for (const e of list) m.set(e.category, (m.get(e.category) ?? 0) + e.amountMinor);
    return m;
  };
  const thisCats = catTotals(thisWeek);
  const lastCats = catTotals(lastWeek);
  const categories = new Set([...thisCats.keys(), ...lastCats.keys()]);
  const highlights: CategoryTrend[] = [...categories]
    .map((category) => {
      const a = thisCats.get(category) ?? 0;
      const b = lastCats.get(category) ?? 0;
      return {
        category,
        thisWeek: formatMoney(a, currency),
        lastWeek: formatMoney(b, currency),
        direction: trendDir(a, b),
      };
    })
    .sort((x, y) => (thisCats.get(y.category) ?? 0) - (thisCats.get(x.category) ?? 0))
    .slice(0, 5);
  const recentSpends = [...thisWeek]
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, 8)
    .map((e) => ({
      amount: formatMoney(e.amountMinor, e.currency),
      category: e.category,
      note: e.note,
      occurredAt: e.occurredAt,
    }));
  const delta = thisTotal - lastTotal;
  const weekOverWeek = delta === 0
    ? 'about the same as last week'
    : delta > 0
      ? `${formatMoney(delta, currency)} more than last week`
      : `${formatMoney(-delta, currency)} less than last week`;
  return {
    weekEnding: now.toISOString().slice(0, 10),
    totalThisWeek: formatMoney(thisTotal, currency),
    totalLastWeek: formatMoney(lastTotal, currency),
    weekOverWeek,
    highlights,
    recentSpends,
  };
}

export async function buildHabitsHome(
  store: SpendLogStore,
  accountId: string,
  now: Date,
  currency = 'USD',
  periodStart?: string,
): Promise<HabitsHome> {
  const events = await store.list(accountId, { limit: 500 });
  return buildHabitsFromEntries(events, now, currency, periodStart);
}

/** Same shape as buildHabitsHome, for callers that already loaded the entries. */
export function buildHabitsFromEntries(
  events: SpendLogEntry[],
  now: Date,
  currency = 'USD',
  periodStart?: string,
): HabitsHome {
  return {
    weekly: weeklySpendingStory(events, now, currency),
    summary30d: periodStart
      ? summarizeSpendingSince(events, periodStart, currency)
      : summarizeSpending(events, 30, now, currency),
  };
}

export class InMemorySpendLogStore implements SpendLogStore {
  private readonly events: SpendLogEntry[];

  constructor(seed?: SpendLogEntry[]) {
    this.events = seed ? [...seed] : [];
  }

  async record(accountId: string, input: RecordSpendInput, now = new Date()): Promise<SpendLogEntry> {
    if (input.amountMinor <= 0) throw new Error('amountMinor must be positive');
    const event: SpendLogEntry = {
      id: randomUUID(),
      accountId,
      amountMinor: input.amountMinor,
      currency: input.currency ?? 'USD',
      category: input.category,
      note: input.note ?? null,
      occurredAt: input.occurredAt ?? now.toISOString(),
      source: input.source ?? 'manual',
      createdAt: now.toISOString(),
    };
    this.events.push(event);
    return event;
  }

  async list(accountId: string, opts?: { since?: Date; limit?: number }): Promise<SpendLogEntry[]> {
    const limit = opts?.limit ?? 100;
    const since = opts?.since?.getTime();
    return this.events
      .filter((e) => e.accountId === accountId && (since === undefined || Date.parse(e.occurredAt) >= since))
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, limit);
  }

  async listSpendPage(accountId: string, afterId: string | null, limit: number): Promise<SpendLogEntry[]> {
    return this.events
      .filter((entry) => entry.accountId === accountId && (afterId === null || entry.id > afterId))
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, Math.max(1, limit));
  }

  async listPage(accountId: string, afterId: string | null, limit: number): Promise<SpendLogEntry[]> {
    return this.listSpendPage(accountId, afterId, limit);
  }

  async remove(accountId: string, spendId: string): Promise<boolean> {
    const index = this.events.findIndex((e) => e.id === spendId && e.accountId === accountId);
    if (index === -1) return false;
    this.events.splice(index, 1);
    return true;
  }

  async deleteAll(accountId: string): Promise<void> {
    for (let index = this.events.length - 1; index >= 0; index--) {
      if (this.events[index]!.accountId === accountId) this.events.splice(index, 1);
    }
  }
}

// Practice-only; live persistence is routed to the Java ledger in instance.ts.
export function createSpendLogStore(): SpendLogStore {
  return new InMemorySpendLogStore();
}
