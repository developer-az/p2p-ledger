import type {
  PatternCategory,
  PatternDay,
  PatternWeekday,
  SpendCategory,
  SpendingPatterns,
} from '../api.js';
import { money } from './format.js';
import { categoryLabel } from './categories.js';

export interface MonthCumulativePoint {
  day: number;
  date: string;
  cumulativeMinor: number;
}

export interface MonthCumulative {
  points: MonthCumulativePoint[];
  paceMinorPerDay: number;
  projectedMinor: number;
}

export interface DailyAverage {
  date: string;
  spendMinor: number;
  averageMinor: number;
}

export interface CategoryMover {
  category: SpendCategory;
  totalMinor: number;
  prevTotalMinor: number;
  changeMinor: number;
  changePct: number | null;
}

export interface PeakWeekday {
  weekday: number;
  label: string;
  averageMinor: number;
  othersAverageMinor: number;
  multiple: number | null;
}

export interface PatternAction {
  id: string;
  title: string;
  detail: string;
  savingsMinor: number;
}

/** Running month-to-date spend per day, plus the current pace and projection. */
export function cumulativeMonth(
  days: PatternDay[],
  month: SpendingPatterns['month'],
): MonthCumulative {
  const inMonth = days
    .filter((day) => day.date >= month.start)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  let running = 0;
  const points = inMonth.map((day) => {
    running += day.spendMinor;
    return {
      day: Number(day.date.slice(8, 10)),
      date: day.date,
      cumulativeMinor: running,
    };
  });

  return {
    points,
    paceMinorPerDay: month.dayOfMonth > 0 ? Math.round(month.spentMinor / month.dayOfMonth) : 0,
    projectedMinor: month.projectedSpendMinor,
  };
}

/** Per-day spend with a trailing mean over the current and previous window-1 days. */
export function rollingAverage(days: PatternDay[], window = 7): DailyAverage[] {
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const size = Math.max(1, window);

  return sorted.map((day, index) => {
    const from = Math.max(0, index - (size - 1));
    const slice = sorted.slice(from, index + 1);
    const sum = slice.reduce((total, row) => total + row.spendMinor, 0);
    return {
      date: day.date,
      spendMinor: day.spendMinor,
      averageMinor: Math.round(sum / slice.length),
    };
  });
}

/** Month-over-month category changes, zero movers removed and largest swings first. */
export function categoryMovers(categories: PatternCategory[]): CategoryMover[] {
  return categories
    .map((row) => ({
      category: row.category,
      totalMinor: row.totalMinor,
      prevTotalMinor: row.prevTotalMinor,
      changeMinor: row.totalMinor - row.prevTotalMinor,
      changePct: row.changePct,
    }))
    .filter((row) => row.changeMinor !== 0)
    .sort((a, b) => {
      const byAbs = Math.abs(b.changeMinor) - Math.abs(a.changeMinor);
      if (byAbs !== 0) return byAbs;
      return a.category < b.category ? -1 : a.category > b.category ? 1 : 0;
    });
}

/** The weekday with the highest average spend compared with the rest of the week. */
export function peakWeekday(weekdays: PatternWeekday[]): PeakWeekday | null {
  if (weekdays.length === 0) return null;
  if (weekdays.every((row) => row.averageMinor === 0)) return null;

  let peak = weekdays[0]!;
  for (const row of weekdays.slice(1)) {
    if (row.averageMinor > peak.averageMinor) peak = row;
    else if (row.averageMinor === peak.averageMinor && row.weekday < peak.weekday) peak = row;
  }

  const others = weekdays.filter((row) => row !== peak);
  const othersAverageMinor =
    others.length > 0
      ? Math.round(others.reduce((total, row) => total + row.averageMinor, 0) / others.length)
      : 0;

  return {
    weekday: peak.weekday,
    label: peak.label,
    averageMinor: peak.averageMinor,
    othersAverageMinor,
    multiple:
      othersAverageMinor > 0
        ? Math.round((peak.averageMinor / othersAverageMinor) * 10) / 10
        : null,
  };
}

/** The weekday peak that reads as a habit rather than a single large day. */
export function habitPeak(p: Pick<SpendingPatterns, 'weekdays' | 'totals'>): PeakWeekday | null {
  const peak = peakWeekday(p.weekdays);
  if (peak === null || peak.multiple === null || peak.multiple < 1.5) return null;

  const biggestDay = p.totals.biggestDay;
  const peakRow = p.weekdays.find((row) => row.weekday === peak.weekday);
  const oneOffPeakDay =
    biggestDay !== null &&
    peakRow !== undefined &&
    new Date(`${biggestDay.date}T00:00:00Z`).getUTCDay() === peak.weekday &&
    biggestDay.spendMinor * 2 >= peakRow.totalMinor;
  if (oneOffPeakDay) return null;

  return peak;
}

/** Up to three concrete savings suggestions derived from the spending patterns.
 *
 * Guards the rising-category rule: skips housing and movers with no previous-30-day baseline before choosing the largest increase.
 * Guards the peak-weekday rule: skips when the biggest day alone is at least half of that weekday's total.
 * Guards the month-pace rule: skips when the biggest day falls inside this month and is at least half of the month's spend so far.
 */
export function buildActions(p: SpendingPatterns): PatternAction[] {
  const actions: PatternAction[] = [];

  const rising = categoryMovers(p.categories)
    .filter((row) => row.changeMinor > 0)
    .filter((row) => row.category !== 'housing' && row.prevTotalMinor !== 0)
    .sort((a, b) => {
      const byChange = b.changeMinor - a.changeMinor;
      if (byChange !== 0) return byChange;
      return a.category < b.category ? -1 : a.category > b.category ? 1 : 0;
    })[0];
  if (rising && rising.changeMinor >= 500) {
    actions.push({
      id: `category-${rising.category}`,
      title: `${categoryLabel(rising.category)} is up ${money(rising.changeMinor)}`,
      detail: `Matching your ${money(rising.prevTotalMinor)} from the previous 30 days saves ${money(rising.changeMinor)}.`,
      savingsMinor: rising.changeMinor,
    });
  }

  const peak = habitPeak(p);
  const biggestDay = p.totals.biggestDay;
  if (peak) {
    const gap = peak.averageMinor - peak.othersAverageMinor;
    actions.push({
      id: `weekday-${peak.weekday}`,
      title: `${peak.label}s average ${money(peak.averageMinor)}`,
      detail: `That is ${peak.multiple}x your other days. Bringing ${peak.label} down to ${money(peak.othersAverageMinor)} saves about ${money(gap * 4)} a month.`,
      savingsMinor: gap * 4,
    });
  }

  const prev = p.totals.spendPrev30dMinor;
  const projected = p.month.projectedSpendMinor;
  const daysLeft = p.month.daysInMonth - p.month.dayOfMonth;
  const oneOffMonthDay =
    biggestDay !== null &&
    biggestDay.date >= p.month.start &&
    biggestDay.spendMinor * 2 >= p.month.spentMinor;
  if (prev > 0 && projected > prev && daysLeft > 0 && !oneOffMonthDay) {
    const perDay = Math.max(0, Math.floor((prev - p.month.spentMinor) / daysLeft));
    actions.push({
      id: 'month-pace',
      title: `On pace for ${money(projected)} this month`,
      detail:
        perDay > 0
          ? `Keep under ${money(perDay)} a day for the rest of ${p.month.label} to match the previous 30 days (${money(prev)}).`
          : `You have already spent more than the previous 30 days (${money(prev)}).`,
      savingsMinor: projected - prev,
    });
  }

  return actions.sort((a, b) => b.savingsMinor - a.savingsMinor).slice(0, 3);
}
