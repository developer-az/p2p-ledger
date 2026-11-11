import type { AccountView, SpendCategory } from '../api.js';

export type LandingFigureInput = Partial<Pick<AccountView, 'spendEntries' | 'patterns'>>;

export interface LandingFigures {
  rows: number;
  payees: number;
  categories: number;
  daysOfHistory: number;
  spend30dMinor: number;
  topCategory: SpendCategory | null;
  topCategorySharePct: number | null;
}

const DAY_MS = 86_400_000;

/** UTC calendar day index for an ISO timestamp, or null when unparseable. */
function utcDay(occurredAt: string): number | null {
  const time = Date.parse(occurredAt);
  return Number.isNaN(time) ? null : Math.floor(time / DAY_MS);
}

/** Counts behind the landing page figure strip for the sample household.
 *
 * Rows, distinct spend descriptions (trimmed, lowercased notes) and distinct categories come
 * from the spend log. These are free-text notes, not resolved payees: canonical merchants
 * arrive with merchant resolution in M4. Days of history counts whole UTC calendar days from
 * the earliest to the latest entry inclusive, so a single day of logs reads as 1 and no logs
 * read as 0. The 30-day spend and top category are taken from the patterns totals.
 */
export function landingFigures(view: LandingFigureInput): LandingFigures {
  const entries = view.spendEntries ?? [];

  const payees = new Set<string>();
  const categories = new Set<string>();
  let earliestDay = Number.POSITIVE_INFINITY;
  let latestDay = Number.NEGATIVE_INFINITY;

  for (const entry of entries) {
    const payee = entry.note?.trim().toLowerCase();
    if (payee) payees.add(payee);
    categories.add(entry.category);

    const day = utcDay(entry.occurredAt);
    if (day === null) continue;
    if (day < earliestDay) earliestDay = day;
    if (day > latestDay) latestDay = day;
  }

  const totals = view.patterns?.totals;
  const top = totals?.topCategory ?? null;
  const sharePct = top?.sharePct;

  return {
    rows: entries.length,
    payees: payees.size,
    categories: categories.size,
    daysOfHistory:
      earliestDay === Number.POSITIVE_INFINITY || latestDay === Number.NEGATIVE_INFINITY
        ? 0
        : latestDay - earliestDay + 1,
    spend30dMinor: totals?.spend30dMinor ?? 0,
    topCategory: top?.category ?? null,
    topCategorySharePct:
      typeof sharePct === 'number' && Number.isFinite(sharePct) ? Math.round(sharePct) : null,
  };
}
