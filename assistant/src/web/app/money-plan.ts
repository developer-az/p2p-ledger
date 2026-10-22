import type { AccountView, PatternCategory, SpendingPatterns } from '../api.js';
import { categoryLabel } from './categories.js';
import { money, parseMoney } from './format.js';

export interface MoneyPlan {
  hasBaseline: boolean;
  cashMinor: number | null;
  creditMinor: number;
  netMinor: number | null;
  ledgerMinor: number;
  budgetMinor: number | null;
  weekSpentMinor: number;
  weekLeftMinor: number | null;
  weekProgress: number;
  overBudget: boolean;
  projectedCashMinor: number | null;
  periodIncomeMinor: number;
  periodSpentMinor: number;
  streakDays: number;
  activeDays30d: number;
  topCategory: PatternCategory | null;
  patterns: SpendingPatterns | null;
}

export function moneyPlan(view: AccountView | null | undefined): MoneyPlan {
  const profile = view?.moneyProfile;
  const patterns = view?.patterns ?? null;
  const cashMinor = profile?.walletCashMinor ?? null;
  const creditMinor = profile?.creditOwedMinor ?? 0;
  const ledgerMinor = parseMoney(view?.balance) ?? 0;
  const projectedCashMinor = parseMoney(view?.finance?.projectedCash) ?? cashMinor;
  const budgetMinor = profile?.weeklyBudgetMinor ?? null;
  const weekSpentMinor = patterns?.week.spentMinor ?? 0;
  const weekLeftMinor = budgetMinor === null ? null : Math.max(0, budgetMinor - weekSpentMinor);
  const weekProgress = budgetMinor && budgetMinor > 0 ? weekSpentMinor / budgetMinor : 0;
  const periodIncomeMinor = parseMoney(view?.finance?.periodTotals.income) ?? patterns?.month.incomeMinor ?? 0;
  const periodSpentMinor = parseMoney(view?.finance?.periodTotals.spent) ?? 0;
  return {
    hasBaseline: cashMinor !== null,
    cashMinor,
    creditMinor,
    netMinor: cashMinor === null ? null : (projectedCashMinor ?? cashMinor) - creditMinor,
    ledgerMinor,
    budgetMinor,
    weekSpentMinor,
    weekLeftMinor,
    weekProgress,
    overBudget: budgetMinor !== null && weekSpentMinor > budgetMinor,
    projectedCashMinor: parseMoney(view?.finance?.projectedCash) ?? cashMinor,
    periodIncomeMinor,
    periodSpentMinor,
    streakDays: patterns?.streak.currentDays ?? 0,
    activeDays30d: patterns?.streak.loggedDays30d ?? 0,
    topCategory: patterns?.totals.topCategory ?? null,
    patterns,
  };
}

export function suggestedWeeklyBudget(cashMinor: number | null, monthlyIncomeMinor = 0): number {
  const base = monthlyIncomeMinor > 0 ? monthlyIncomeMinor / 4 : cashMinor === null ? 0 : cashMinor * 0.18;
  const rounded = Math.round(base / 1000) * 1000;
  if (rounded <= 0) return 15_000;
  return Math.min(150_000, Math.max(5_000, rounded));
}

export function monthsToClear(creditMinor: number, weeklyPaymentMinor: number): number {
  if (creditMinor <= 0) return 0;
  if (weeklyPaymentMinor <= 0) return Number.POSITIVE_INFINITY;
  return Math.ceil(creditMinor / weeklyPaymentMinor);
}

export function moneyStory(plan: MoneyPlan): { key: string; tone: 'good' | 'warn' | 'neutral'; title: string; body: string }[] {
  const patterns = plan.patterns;
  if (!patterns) return [];
  const stories: { key: string; tone: 'good' | 'warn' | 'neutral'; title: string; body: string }[] = [];
  const top = patterns.totals.topCategory;
  if (top && top.totalMinor > 0) {
    stories.push({
      key: 'top',
      tone: 'neutral',
      title: `${categoryLabel(top.category)} leads your spend`,
      body: `${top.sharePct}% of the last 30 days — ${top.count} ${top.count === 1 ? 'log' : 'logs'}.`,
    });
  }
  if (patterns.totals.spendPrev30dMinor > 0) {
    const delta = patterns.totals.spend30dMinor - patterns.totals.spendPrev30dMinor;
    const pct = Math.round((delta / patterns.totals.spendPrev30dMinor) * 100);
    if (Math.abs(pct) >= 8) {
      stories.push({
        key: 'trend',
        tone: pct > 0 ? 'warn' : 'good',
        title: pct > 0 ? `You're logging ${Math.abs(pct)}% more than before` : `You're logging ${Math.abs(pct)}% less than before`,
        body: pct > 0
          ? 'A good week to check the categories that crept up.'
          : 'Whatever changed, it is working. Keep the pace.',
      });
    }
  }
  const weekdays = [...patterns.weekdays].sort((a, b) => b.averageMinor - a.averageMinor);
  const biggest = weekdays[0];
  if (biggest && biggest.averageMinor > 0) {
    stories.push({
      key: 'weekday',
      tone: 'neutral',
      title: `${biggest.label}s are your biggest day`,
      body: `About ${money(biggest.averageMinor)} on average across eight weeks.`,
    });
  }
  if (plan.streakDays >= 2) {
    stories.push({
      key: 'streak',
      tone: 'good',
      title: `${plan.streakDays} days of knowing`,
      body: 'Logging is a rhythm, not a chore. One tap keeps it alive.',
    });
  }
  if (patterns.month.projectedSpendMinor > 0) {
    stories.push({
      key: 'projection',
      tone: 'neutral',
      title: 'Where this month is heading',
      body: `At today's pace you'll log about ${money(patterns.month.projectedSpendMinor)} by month end.`,
    });
  }
  return stories;
}
