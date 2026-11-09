import { describe, expect, it } from 'vitest';
import {
  buildActions,
  categoryMovers,
  cumulativeMonth,
  habitPeak,
  peakWeekday,
  rollingAverage,
} from '../src/web/app/pattern-insights.js';
import { money } from '../src/web/app/format.js';
import { categoryLabel } from '../src/web/app/categories.js';
import type {
  PatternCategory,
  PatternDay,
  PatternWeekday,
  SpendCategory,
  SpendingPatterns,
} from '../src/web/api.js';

function day(date: string, spendMinor: number, overrides: Partial<PatternDay> = {}): PatternDay {
  return {
    date,
    spendMinor,
    incomeMinor: 0,
    count: spendMinor > 0 ? 1 : 0,
    ...overrides,
  };
}

function category(
  name: SpendCategory,
  totalMinor: number,
  prevTotalMinor = 0,
  overrides: Partial<PatternCategory> = {},
): PatternCategory {
  return {
    category: name,
    totalMinor,
    count: 1,
    prevTotalMinor,
    changePct: prevTotalMinor > 0 ? Math.round(((totalMinor - prevTotalMinor) / prevTotalMinor) * 100) : null,
    sharePct: 0,
    ...overrides,
  };
}

function weekday(
  weekdayNumber: number,
  label: string,
  averageMinor: number,
  overrides: Partial<PatternWeekday> = {},
): PatternWeekday {
  return {
    weekday: weekdayNumber,
    label,
    totalMinor: averageMinor,
    count: averageMinor > 0 ? 1 : 0,
    averageMinor,
    ...overrides,
  };
}

function month(overrides: Partial<SpendingPatterns['month']> = {}): SpendingPatterns['month'] {
  return {
    label: 'October',
    start: '2026-10-01',
    spentMinor: 0,
    incomeMinor: 0,
    projectedSpendMinor: 0,
    dayOfMonth: 8,
    daysInMonth: 31,
    ...overrides,
  };
}

function totals(overrides: Partial<SpendingPatterns['totals']> = {}): SpendingPatterns['totals'] {
  return {
    spend30dMinor: 0,
    spendPrev30dMinor: 0,
    income30dMinor: 0,
    averageActiveDayMinor: 0,
    averageCalendarDayMinor: 0,
    biggestDay: null,
    topCategory: null,
    activeDays30d: 0,
    ...overrides,
  };
}

function patterns(overrides: Partial<SpendingPatterns> = {}): SpendingPatterns {
  return {
    generatedAt: '2026-10-08T12:00:00.000Z',
    days: [],
    categories: [],
    weekdays: [],
    week: {
      start: '2026-10-05',
      end: '2026-10-11',
      spentMinor: 0,
      lastWeekSpentMinor: 0,
      budgetMinor: null,
      remainingMinor: null,
    },
    month: month(),
    streak: {
      currentDays: 0,
      longestDays: 0,
      loggedDays30d: 0,
      lastLoggedAt: null,
    },
    totals: totals(),
    ...overrides,
  };
}

describe('cumulativeMonth', () => {
  it('returns an empty point list while keeping pace and projection', () => {
    const result = cumulativeMonth(
      [],
      month({ spentMinor: 1_000, dayOfMonth: 5, projectedSpendMinor: 6_000 }),
    );

    expect(result).toEqual({
      points: [],
      paceMinorPerDay: 200,
      projectedMinor: 6_000,
    });
  });

  it('filters days before the month start, sorts them and accumulates spend', () => {
    const result = cumulativeMonth(
      [
        day('2026-10-03', 200),
        day('2026-09-30', 999),
        day('2026-10-01', 100),
        day('2026-10-04', 300),
        day('2026-09-15', 50),
      ],
      month({ start: '2026-10-01', spentMinor: 8_000, dayOfMonth: 8, projectedSpendMinor: 30_000 }),
    );

    expect(result.points).toEqual([
      { day: 1, date: '2026-10-01', cumulativeMinor: 100 },
      { day: 3, date: '2026-10-03', cumulativeMinor: 300 },
      { day: 4, date: '2026-10-04', cumulativeMinor: 600 },
    ]);
    expect(result.paceMinorPerDay).toBe(1_000);
    expect(result.projectedMinor).toBe(30_000);
  });

  it('uses a zero pace when the month has no elapsed days', () => {
    const result = cumulativeMonth(
      [day('2026-10-01', 100)],
      month({ spentMinor: 500, dayOfMonth: 0 }),
    );

    expect(result.paceMinorPerDay).toBe(0);
    expect(result.points).toEqual([{ day: 1, date: '2026-10-01', cumulativeMinor: 100 }]);
  });
});

describe('rollingAverage', () => {
  it('averages the current day with up to six previous days', () => {
    const days = [100, 200, 300, 400, 500, 600, 700, 800].map((spend, index) =>
      day(`2026-10-0${index + 1}`, spend),
    );

    const result = rollingAverage(days);

    expect(result.map((row) => row.date)).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
    ]);
    expect(result.map((row) => row.spendMinor)).toEqual([100, 200, 300, 400, 500, 600, 700, 800]);
    expect(result.map((row) => row.averageMinor)).toEqual([100, 150, 200, 250, 300, 350, 400, 500]);
  });

  it('respects a window shorter than the history and rounds averages', () => {
    const result = rollingAverage(
      [day('2026-10-03', 104), day('2026-10-01', 100), day('2026-10-02', 101)],
      2,
    );

    expect(result).toEqual([
      { date: '2026-10-01', spendMinor: 100, averageMinor: 100 },
      { date: '2026-10-02', spendMinor: 101, averageMinor: 101 },
      { date: '2026-10-03', spendMinor: 104, averageMinor: 103 },
    ]);
  });

  it('returns an empty list for no days', () => {
    expect(rollingAverage([])).toEqual([]);
  });
});

describe('categoryMovers', () => {
  it('computes changes, drops zero movers and sorts by absolute change', () => {
    const movers = categoryMovers([
      category('shopping', 1_200, 700),
      category('groceries', 800, 1_400, { changePct: -43 }),
      category('transport', 900, 900),
      category('dining', 1_500, 1_000),
    ]);

    expect(movers[0]).toEqual({
      category: 'groceries',
      totalMinor: 800,
      prevTotalMinor: 1_400,
      changeMinor: -600,
      changePct: -43,
    });
    expect(movers.map((row) => [row.category, row.changeMinor])).toEqual([
      ['groceries', -600],
      ['dining', 500],
      ['shopping', 500],
    ]);
    expect(movers.map((row) => row.changePct)).toEqual([-43, 50, 71]);
  });

  it('breaks ties by category name and preserves a null change percentage', () => {
    const movers = categoryMovers([
      category('shopping', 1_500, 1_000, { changePct: 50 }),
      category('dining', 500, 0, { changePct: null }),
    ]);

    expect(movers.map((row) => row.category)).toEqual(['dining', 'shopping']);
    expect(movers[0]?.changePct).toBeNull();
  });

  it('returns an empty list for no categories', () => {
    expect(categoryMovers([])).toEqual([]);
  });
});

describe('peakWeekday', () => {
  it('finds the highest average and compares it with the other weekdays', () => {
    const result = peakWeekday([
      weekday(0, 'Sunday', 1_000),
      weekday(1, 'Monday', 3_000),
      weekday(2, 'Tuesday', 1_000),
    ]);

    expect(result).toEqual({
      weekday: 1,
      label: 'Monday',
      averageMinor: 3_000,
      othersAverageMinor: 1_000,
      multiple: 3,
    });
  });

  it('returns null for an empty list and for all-zero averages', () => {
    expect(peakWeekday([])).toBeNull();
    expect(peakWeekday([weekday(1, 'Monday', 0), weekday(2, 'Tuesday', 0)])).toBeNull();
  });

  it('picks the lowest weekday number when averages tie', () => {
    const result = peakWeekday([
      weekday(4, 'Thursday', 2_000),
      weekday(0, 'Sunday', 1_000),
      weekday(2, 'Tuesday', 2_000),
    ]);

    expect(result?.weekday).toBe(2);
    expect(result?.label).toBe('Tuesday');
    expect(result?.othersAverageMinor).toBe(1_500);
    expect(result?.multiple).toBe(1.3);
  });

  it('returns a null multiple when the other weekdays average zero', () => {
    const result = peakWeekday([weekday(3, 'Wednesday', 500)]);

    expect(result).toEqual({
      weekday: 3,
      label: 'Wednesday',
      averageMinor: 500,
      othersAverageMinor: 0,
      multiple: null,
    });
  });
});

describe('habitPeak', () => {
  const weekdays = [weekday(1, 'Monday', 1_000), weekday(2, 'Tuesday', 3_000)];

  it('returns null for empty weekdays', () => {
    expect(habitPeak(patterns({ weekdays: [] }))).toBeNull();
  });

  it('returns null when the multiple is below 1.5', () => {
    const result = habitPeak(
      patterns({
        weekdays: [weekday(1, 'Monday', 1_400), weekday(2, 'Tuesday', 1_000)],
      }),
    );

    expect(result).toBeNull();
  });

  it('returns null when the other weekdays average zero', () => {
    const result = habitPeak(patterns({ weekdays: [weekday(3, 'Wednesday', 500)] }));

    expect(result).toBeNull();
  });

  it('returns the peak when the multiple is at least 1.5 and there is no biggest day', () => {
    const result = habitPeak(patterns({ weekdays, totals: totals({ biggestDay: null }) }));

    expect(result).toEqual(peakWeekday(weekdays));
  });

  it('returns null when the biggest day alone is at least half of the peak weekday total', () => {
    const result = habitPeak(
      patterns({
        weekdays,
        totals: totals({ biggestDay: day('2026-10-20', 1_500) }),
      }),
    );

    expect(result).toBeNull();
  });

  it('returns the peak when the biggest day on the peak weekday is under half of its total', () => {
    const result = habitPeak(
      patterns({
        weekdays,
        totals: totals({ biggestDay: day('2026-10-20', 1_000) }),
      }),
    );

    expect(result).toEqual(peakWeekday(weekdays));
  });

  it('returns the peak when the biggest day falls on another weekday', () => {
    const result = habitPeak(
      patterns({
        weekdays,
        totals: totals({ biggestDay: day('2026-10-19', 2_000) }),
      }),
    );

    expect(result).toEqual(peakWeekday(weekdays));
  });
});

describe('buildActions', () => {
  it('builds a rising-category action on its own', () => {
    const actions = buildActions(
      patterns({ categories: [category('dining', 1_500, 1_000, { changePct: 50 })] }),
    );

    expect(actions).toEqual([
      {
        id: 'category-dining',
        title: `${categoryLabel('dining')} is up ${money(500)}`,
        detail: `Matching your ${money(1_000)} from the previous 30 days saves ${money(500)}.`,
        savingsMinor: 500,
      },
    ]);
  });

  it('builds a peak-weekday action on its own', () => {
    const actions = buildActions(
      patterns({
        weekdays: [weekday(1, 'Monday', 3_000), weekday(3, 'Wednesday', 1_000)],
      }),
    );

    expect(actions).toEqual([
      {
        id: 'weekday-1',
        title: `Mondays average ${money(3_000)}`,
        detail: `That is 3x your other days. Bringing Monday down to ${money(1_000)} saves about ${money(8_000)} a month.`,
        savingsMinor: 8_000,
      },
    ]);
  });

  it('builds a month-pace action on its own', () => {
    const actions = buildActions(
      patterns({
        month: month({
          label: 'October',
          spentMinor: 4_000,
          projectedSpendMinor: 15_000,
          dayOfMonth: 10,
          daysInMonth: 31,
        }),
        totals: totals({ spendPrev30dMinor: 10_000 }),
      }),
    );

    expect(actions).toEqual([
      {
        id: 'month-pace',
        title: `On pace for ${money(15_000)} this month`,
        detail: `Keep under ${money(285)} a day for the rest of October to match the previous 30 days (${money(10_000)}).`,
        savingsMinor: 5_000,
      },
    ]);
  });

  it('requires a category change of at least 500', () => {
    const below = buildActions(
      patterns({ categories: [category('dining', 1_499, 1_000)] }),
    );
    const at = buildActions(
      patterns({ categories: [category('dining', 1_500, 1_000)] }),
    );

    expect(below).toEqual([]);
    expect(at).toHaveLength(1);
    expect(at[0]?.id).toBe('category-dining');
    expect(at[0]?.savingsMinor).toBe(500);
  });

  it('requires a weekday multiple of at least 1.5', () => {
    const below = buildActions(
      patterns({
        weekdays: [weekday(1, 'Monday', 1_400), weekday(2, 'Tuesday', 1_000)],
      }),
    );
    const at = buildActions(
      patterns({
        weekdays: [weekday(1, 'Monday', 1_500), weekday(2, 'Tuesday', 1_000)],
      }),
    );

    expect(below).toEqual([]);
    expect(at).toHaveLength(1);
    expect(at[0]?.id).toBe('weekday-1');
    expect(at[0]?.savingsMinor).toBe(2_000);
  });

  it('skips the month pace unless the projection beats last month', () => {
    const equal = buildActions(
      patterns({
        month: month({ projectedSpendMinor: 10_000, dayOfMonth: 10 }),
        totals: totals({ spendPrev30dMinor: 10_000 }),
      }),
    );
    const lower = buildActions(
      patterns({
        month: month({ projectedSpendMinor: 9_000, dayOfMonth: 10 }),
        totals: totals({ spendPrev30dMinor: 10_000 }),
      }),
    );

    expect(equal).toEqual([]);
    expect(lower).toEqual([]);
  });

  it('skips the month pace when no days are left', () => {
    const actions = buildActions(
      patterns({
        month: month({
          spentMinor: 5_000,
          projectedSpendMinor: 20_000,
          dayOfMonth: 31,
          daysInMonth: 31,
        }),
        totals: totals({ spendPrev30dMinor: 10_000 }),
      }),
    );

    expect(actions).toEqual([]);
  });

  it('uses the passed-last-month detail when the per-day allowance is zero', () => {
    const actions = buildActions(
      patterns({
        month: month({
          label: 'October',
          spentMinor: 4_000,
          projectedSpendMinor: 5_000,
          dayOfMonth: 10,
          daysInMonth: 31,
        }),
        totals: totals({ spendPrev30dMinor: 3_000 }),
      }),
    );

    expect(actions).toEqual([
      {
        id: 'month-pace',
        title: `On pace for ${money(5_000)} this month`,
        detail: `You have already spent more than the previous 30 days (${money(3_000)}).`,
        savingsMinor: 2_000,
      },
    ]);
  });

  it('sorts actions by savings and returns at most three', () => {
    const actions = buildActions(
      patterns({
        categories: [category('dining', 1_600, 1_000)],
        weekdays: [weekday(1, 'Monday', 3_000), weekday(3, 'Wednesday', 1_000)],
        month: month({
          label: 'October',
          spentMinor: 4_000,
          projectedSpendMinor: 15_000,
          dayOfMonth: 10,
          daysInMonth: 31,
        }),
        totals: totals({ spendPrev30dMinor: 10_000 }),
      }),
    );

    expect(actions).toHaveLength(3);
    expect(actions.map((action) => action.id)).toEqual([
      'weekday-1',
      'month-pace',
      'category-dining',
    ]);
    expect(actions.map((action) => action.savingsMinor)).toEqual([8_000, 5_000, 600]);
  });

  it('returns no actions when no rule applies', () => {
    expect(buildActions(patterns())).toEqual([]);
  });
});

describe('buildActions guard rules', () => {
  it('skips a housing increase with no baseline', () => {
    const actions = buildActions(
      patterns({ categories: [category('housing', 145_000, 0)] }),
    );

    expect(actions.filter((action) => action.id.startsWith('category-'))).toEqual([]);
    expect(actions).toEqual([]);
  });

  it('skips housing even when it has a baseline', () => {
    const actions = buildActions(
      patterns({ categories: [category('housing', 52_000, 50_000)] }),
    );

    expect(actions.filter((action) => action.id.startsWith('category-'))).toEqual([]);
    expect(actions).toEqual([]);
  });

  it('skips a new category spend with no baseline', () => {
    const actions = buildActions(
      patterns({ categories: [category('dining', 5_000, 0)] }),
    );

    expect(actions.filter((action) => action.id.startsWith('category-'))).toEqual([]);
    expect(actions).toEqual([]);
  });

  it('picks the largest eligible mover when an excluded housing increase is larger', () => {
    const actions = buildActions(
      patterns({
        categories: [category('dining', 1_600, 1_000), category('housing', 9_000, 0)],
      }),
    );

    expect(actions).toEqual([
      {
        id: 'category-dining',
        title: `${categoryLabel('dining')} is up ${money(600)}`,
        detail: `Matching your ${money(1_000)} from the previous 30 days saves ${money(600)}.`,
        savingsMinor: 600,
      },
    ]);
  });

  it('skips the peak weekday when one day is at least half of that weekday total', () => {
    const actions = buildActions(
      patterns({
        weekdays: [weekday(1, 'Monday', 1_000), weekday(2, 'Tuesday', 3_000)],
        totals: totals({ biggestDay: day('2026-10-20', 1_500) }),
      }),
    );

    expect(actions.filter((action) => action.id.startsWith('weekday-'))).toEqual([]);
    expect(actions).toEqual([]);
  });

  it('keeps the peak weekday when the biggest day is under half of that weekday total', () => {
    const actions = buildActions(
      patterns({
        weekdays: [weekday(1, 'Monday', 1_000), weekday(2, 'Tuesday', 3_000)],
        totals: totals({ biggestDay: day('2026-10-20', 1_000) }),
      }),
    );

    expect(actions).toEqual([
      {
        id: 'weekday-2',
        title: `Tuesdays average ${money(3_000)}`,
        detail: `That is 3x your other days. Bringing Tuesday down to ${money(1_000)} saves about ${money(8_000)} a month.`,
        savingsMinor: 8_000,
      },
    ]);
  });

  it('skips the month pace when the biggest day is inside this month and at least half of month spend', () => {
    const base = {
      month: month({
        label: 'October',
        start: '2026-10-01',
        spentMinor: 4_000,
        projectedSpendMinor: 15_000,
        dayOfMonth: 10,
        daysInMonth: 31,
      }),
      totals: totals({ spendPrev30dMinor: 10_000 }),
    };

    const control = buildActions(patterns(base));
    expect(control.filter((action) => action.id === 'month-pace')).toHaveLength(1);

    const actions = buildActions(
      patterns({
        ...base,
        totals: totals({
          spendPrev30dMinor: 10_000,
          biggestDay: day('2026-10-05', 2_500),
        }),
      }),
    );

    expect(actions.filter((action) => action.id === 'month-pace')).toEqual([]);
    expect(actions).toEqual([]);
  });

  it('keeps the month pace when the biggest day is inside this month but under half of month spend', () => {
    const actions = buildActions(
      patterns({
        month: month({
          label: 'October',
          start: '2026-10-01',
          spentMinor: 4_000,
          projectedSpendMinor: 15_000,
          dayOfMonth: 10,
          daysInMonth: 31,
        }),
        totals: totals({
          spendPrev30dMinor: 10_000,
          biggestDay: day('2026-10-05', 1_999),
        }),
      }),
    );

    const pace = actions.filter((action) => action.id === 'month-pace');
    expect(pace).toHaveLength(1);
    expect(pace[0]?.savingsMinor).toBe(5_000);
  });

  it('keeps the month pace when the biggest day falls before the month start', () => {
    const actions = buildActions(
      patterns({
        month: month({
          label: 'October',
          start: '2026-10-01',
          spentMinor: 4_000,
          projectedSpendMinor: 15_000,
          dayOfMonth: 10,
          daysInMonth: 31,
        }),
        totals: totals({
          spendPrev30dMinor: 10_000,
          biggestDay: day('2026-09-30', 3_500),
        }),
      }),
    );

    const pace = actions.filter((action) => action.id === 'month-pace');
    expect(pace).toHaveLength(1);
    expect(pace[0]?.savingsMinor).toBe(5_000);
  });

  it('keeps the peak weekday when the biggest day falls on another weekday', () => {
    const actions = buildActions(
      patterns({
        weekdays: [weekday(1, 'Monday', 1_000), weekday(2, 'Tuesday', 3_000)],
        totals: totals({ biggestDay: day('2026-10-19', 2_000) }),
      }),
    );

    expect(actions).toEqual([
      {
        id: 'weekday-2',
        title: `Tuesdays average ${money(3_000)}`,
        detail: `That is 3x your other days. Bringing Tuesday down to ${money(1_000)} saves about ${money(8_000)} a month.`,
        savingsMinor: 8_000,
      },
    ]);
  });
});
