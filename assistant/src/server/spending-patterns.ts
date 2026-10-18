import type { IncomeLogEntry, MoneyProfile } from './personal-finance.js';
import type { SpendCategory, SpendLogEntry } from './spend-log.js';

const MS_DAY = 86_400_000;
const WINDOW_DAYS = 56;
const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export interface PatternDay {
  /** UTC day key, YYYY-MM-DD. */
  date: string;
  spendMinor: number;
  incomeMinor: number;
  count: number;
}

export interface PatternCategory {
  category: SpendCategory;
  totalMinor: number;
  count: number;
  prevTotalMinor: number;
  /** Percent change against the previous 30 days. Null when there was nothing to compare with. */
  changePct: number | null;
  /** Share of the last 30 days of logged spend, 0-100. */
  sharePct: number;
}

export interface PatternWeekday {
  weekday: number;
  label: string;
  totalMinor: number;
  count: number;
  /** Average spend per occurrence of this weekday across the eight-week window. */
  averageMinor: number;
}

export interface SpendingPatterns {
  generatedAt: string;
  days: PatternDay[];
  categories: PatternCategory[];
  weekdays: PatternWeekday[];
  week: {
    start: string;
    end: string;
    spentMinor: number;
    lastWeekSpentMinor: number;
    budgetMinor: number | null;
    remainingMinor: number | null;
  };
  month: {
    label: string;
    start: string;
    spentMinor: number;
    incomeMinor: number;
    projectedSpendMinor: number;
    dayOfMonth: number;
    daysInMonth: number;
  };
  streak: {
    currentDays: number;
    longestDays: number;
    loggedDays30d: number;
    lastLoggedAt: string | null;
  };
  totals: {
    spend30dMinor: number;
    spendPrev30dMinor: number;
    income30dMinor: number;
    averageActiveDayMinor: number;
    averageCalendarDayMinor: number;
    biggestDay: PatternDay | null;
    topCategory: PatternCategory | null;
    activeDays30d: number;
  };
}

function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * MS_DAY);
}

/** Monday 00:00 UTC of the week containing `d`. */
function startOfWeek(d: Date): Date {
  const day = utcDayStart(d);
  const offset = (day.getUTCDay() + 6) % 7;
  return addDays(day, -offset);
}

function monthLabel(d: Date): string {
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function timeOf(entry: { occurredAt: string }): number {
  return Date.parse(entry.occurredAt);
}

function inRange(t: number, from: number, to: number): boolean {
  return t >= from && t < to;
}

function sumMinor(entries: { amountMinor: number }[]): number {
  return entries.reduce((total, entry) => total + entry.amountMinor, 0);
}

function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? null : 0;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * Everything the Patterns screen needs, derived from what the person logged.
 * The function is deliberately pure so the numbers can be tested without a server.
 */
export function buildSpendingPatterns(
  spends: SpendLogEntry[],
  incomes: IncomeLogEntry[],
  now: Date,
  profile?: Pick<MoneyProfile, 'weeklyBudgetMinor' | 'currency'>,
): SpendingPatterns {
  const today = utcDayStart(now);
  const nowMs = now.getTime();
  const windowStart = addDays(today, -(WINDOW_DAYS - 1));
  const dayMap = new Map<string, PatternDay>();
  for (let i = 0; i < WINDOW_DAYS; i++) {
    const key = dayKey(addDays(windowStart, i));
    dayMap.set(key, { date: key, spendMinor: 0, incomeMinor: 0, count: 0 });
  }
  for (const spend of spends) {
    const key = dayKey(new Date(spend.occurredAt));
    const day = dayMap.get(key);
    if (!day) continue;
    day.spendMinor += spend.amountMinor;
    day.count += 1;
  }
  for (const income of incomes) {
    const key = dayKey(new Date(income.occurredAt));
    const day = dayMap.get(key);
    if (day) day.incomeMinor += income.amountMinor;
  }
  const days = [...dayMap.values()];

  const start30 = addDays(today, -29).getTime();
  const startPrev30 = addDays(today, -59).getTime();
  const spend30 = spends.filter((s) => inRange(timeOf(s), start30, nowMs + 1));
  const spendPrev30 = spends.filter((s) => inRange(timeOf(s), startPrev30, start30));
  const income30 = incomes.filter((i) => inRange(timeOf(i), start30, nowMs + 1));

  const spend30dMinor = sumMinor(spend30);
  const spendPrev30dMinor = sumMinor(spendPrev30);
  const income30dMinor = sumMinor(income30);

  const categoryMap = new Map<SpendCategory, { totalMinor: number; count: number; prevTotalMinor: number }>();
  for (const spend of spend30) {
    const row = categoryMap.get(spend.category) ?? { totalMinor: 0, count: 0, prevTotalMinor: 0 };
    row.totalMinor += spend.amountMinor;
    row.count += 1;
    categoryMap.set(spend.category, row);
  }
  for (const spend of spendPrev30) {
    const row = categoryMap.get(spend.category) ?? { totalMinor: 0, count: 0, prevTotalMinor: 0 };
    row.prevTotalMinor += spend.amountMinor;
    categoryMap.set(spend.category, row);
  }
  const categories: PatternCategory[] = [...categoryMap.entries()]
    .filter(([, row]) => row.totalMinor > 0)
    .map(([category, row]) => ({
      category,
      totalMinor: row.totalMinor,
      count: row.count,
      prevTotalMinor: row.prevTotalMinor,
      changePct: pctChange(row.totalMinor, row.prevTotalMinor),
      sharePct: spend30dMinor > 0 ? Math.round((row.totalMinor / spend30dMinor) * 100) : 0,
    }))
    .sort((a, b) => b.totalMinor - a.totalMinor);

  const weekdayTotals = Array.from({ length: 7 }, (_, weekday) => ({ weekday, totalMinor: 0, count: 0 }));
  for (const spend of spends) {
    const t = timeOf(spend);
    if (t < windowStart.getTime() || t > nowMs) continue;
    const row = weekdayTotals[new Date(spend.occurredAt).getUTCDay()];
    if (!row) continue;
    row.totalMinor += spend.amountMinor;
    row.count += 1;
  }
  const weekdays: PatternWeekday[] = weekdayTotals.map((row) => ({
    weekday: row.weekday,
    label: WEEKDAY_LABELS[row.weekday] ?? 'Day',
    totalMinor: row.totalMinor,
    count: row.count,
    averageMinor: Math.round(row.totalMinor / (WINDOW_DAYS / 7)),
  }));

  const weekStart = startOfWeek(now);
  const weekStartMs = weekStart.getTime();
  const lastWeekStartMs = addDays(weekStart, -7).getTime();
  const weekSpends = spends.filter((s) => inRange(timeOf(s), weekStartMs, nowMs + 1));
  const lastWeekSpends = spends.filter((s) => inRange(timeOf(s), lastWeekStartMs, weekStartMs));
  const weekSpentMinor = sumMinor(weekSpends);
  const budgetMinor = profile?.weeklyBudgetMinor ?? null;

  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthStartMs = monthStart.getTime();
  const monthSpends = spends.filter((s) => inRange(timeOf(s), monthStartMs, nowMs + 1));
  const monthIncomes = incomes.filter((i) => inRange(timeOf(i), monthStartMs, nowMs + 1));
  const dayOfMonth = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const monthSpentMinor = sumMinor(monthSpends);

  const loggedDays = new Set(spends.map((s) => dayKey(new Date(s.occurredAt))));
  let streakDays = 0;
  let cursor = loggedDays.has(dayKey(today)) ? today : addDays(today, -1);
  while (loggedDays.has(dayKey(cursor))) {
    streakDays += 1;
    cursor = addDays(cursor, -1);
  }
  const sortedDays = [...loggedDays].sort();
  let longestDays = 0;
  let run = 0;
  let previous: string | null = null;
  for (const key of sortedDays) {
    run = previous && dayKey(addDays(new Date(`${previous}T00:00:00.000Z`), 1)) === key ? run + 1 : 1;
    longestDays = Math.max(longestDays, run);
    previous = key;
  }
  const lastLoggedAt = spends.reduce<string | null>((latest, spend) => {
    if (!latest) return spend.occurredAt;
    return Date.parse(spend.occurredAt) > Date.parse(latest) ? spend.occurredAt : latest;
  }, null);
  const activeDayKeys = new Set(spend30.map((s) => dayKey(new Date(s.occurredAt))));

  const biggestDay = days.reduce<PatternDay | null>((biggest, day) => {
    if (day.spendMinor <= 0) return biggest;
    if (!biggest || day.spendMinor > biggest.spendMinor) return day;
    return biggest;
  }, null);

  return {
    generatedAt: now.toISOString(),
    days,
    categories,
    weekdays,
    week: {
      start: dayKey(weekStart),
      end: dayKey(today),
      spentMinor: weekSpentMinor,
      lastWeekSpentMinor: sumMinor(lastWeekSpends),
      budgetMinor,
      remainingMinor: budgetMinor === null ? null : budgetMinor - weekSpentMinor,
    },
    month: {
      label: monthLabel(now),
      start: dayKey(monthStart),
      spentMinor: monthSpentMinor,
      incomeMinor: sumMinor(monthIncomes),
      projectedSpendMinor: dayOfMonth > 0 ? Math.round((monthSpentMinor / dayOfMonth) * daysInMonth) : 0,
      dayOfMonth,
      daysInMonth,
    },
    streak: {
      currentDays: streakDays,
      longestDays,
      loggedDays30d: activeDayKeys.size,
      lastLoggedAt,
    },
    totals: {
      spend30dMinor,
      spendPrev30dMinor,
      income30dMinor,
      averageActiveDayMinor: activeDayKeys.size > 0 ? Math.round(spend30dMinor / activeDayKeys.size) : 0,
      averageCalendarDayMinor: Math.round(spend30dMinor / 30),
      biggestDay,
      topCategory: categories[0] ?? null,
      activeDays30d: activeDayKeys.size,
    },
  };
}
