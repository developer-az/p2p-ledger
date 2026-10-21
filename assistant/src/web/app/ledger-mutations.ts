import {
  api,
  type AccountView,
  type IncomeSource,
  type SpendCategory,
} from '../api.js';
import { categoryLabel } from './categories.js';
import { money, parseMoney } from './format.js';
import type { OptimisticMutation } from './ledger-store.js';

function bumpMoneyField(current: string | undefined, deltaMinor: number, currency: string): string {
  const base = parseMoney(current) ?? 0;
  return money(base + deltaMinor, currency);
}

function recomputeProjectedCash(view: AccountView): AccountView['finance'] | undefined {
  const profile = view.moneyProfile;
  const finance = view.finance;
  if (!profile || !finance || profile.walletCashMinor === null) return finance;

  const incomeMinor = parseMoney(finance.periodTotals.income) ?? 0;
  const spentMinor = parseMoney(finance.periodTotals.spent) ?? 0;
  let minor = profile.walletCashMinor + incomeMinor;
  if (profile.spendLogsAffectWallet) minor -= spentMinor;

  return {
    ...finance,
    projectedCash: money(minor, profile.currency),
    netCash: money(profile.walletCashMinor - profile.creditOwedMinor, profile.currency),
  };
}

function patchFinanceIncome(view: AccountView, amountMinor: number): AccountView {
  const currency = view.currency;
  const finance = view.finance;
  if (!finance) return view;

  const nextFinance = recomputeProjectedCash({
    ...view,
    finance: {
      ...finance,
      periodTotals: {
        ...finance.periodTotals,
        income: bumpMoneyField(finance.periodTotals.income, amountMinor, currency),
      },
    },
  });

  const patterns = view.patterns;
  const nextPatterns = patterns
    ? {
        ...patterns,
        month: {
          ...patterns.month,
          incomeMinor: patterns.month.incomeMinor + amountMinor,
        },
        totals: {
          ...patterns.totals,
          income30dMinor: patterns.totals.income30dMinor + amountMinor,
        },
      }
    : patterns;

  return { ...view, finance: nextFinance, patterns: nextPatterns };
}

function spendInTrackedWeek(view: AccountView): boolean {
  const week = view.patterns?.week;
  if (!week) return true;
  const today = new Date().toISOString().slice(0, 10);
  const start = week.start.slice(0, 10);
  const end = week.end.slice(0, 10);
  return today >= start && today <= end;
}

function patchFinanceSpend(view: AccountView, amountMinor: number): AccountView {
  const profile = view.moneyProfile;
  const finance = view.finance;
  if (!finance) return view;

  const withTotals: AccountView = {
    ...view,
    finance: {
      ...finance,
      periodTotals: {
        ...finance.periodTotals,
        spent: bumpMoneyField(finance.periodTotals.spent, amountMinor, view.currency),
      },
    },
  };

  return { ...withTotals, finance: recomputeProjectedCash(withTotals) };
}

function patchPatternsSpend(
  view: AccountView,
  amountMinor: number,
  category: SpendCategory,
  occurredAt: string,
): AccountView {
  const patterns = view.patterns;
  if (!patterns) return view;

  const inWeek = spendInTrackedWeek(view);
  const week = inWeek
    ? {
        ...patterns.week,
        spentMinor: patterns.week.spentMinor + amountMinor,
        remainingMinor:
          patterns.week.budgetMinor === null
            ? null
            : Math.max(0, patterns.week.budgetMinor - (patterns.week.spentMinor + amountMinor)),
      }
    : patterns.week;

  const categories = patterns.categories.map((row) =>
    row.category === category
      ? {
          ...row,
          totalMinor: row.totalMinor + amountMinor,
          count: row.count + 1,
        }
      : row,
  );

  return {
    ...view,
    patterns: {
      ...patterns,
      week,
      categories,
      totals: {
        ...patterns.totals,
        spend30dMinor: patterns.totals.spend30dMinor + amountMinor,
      },
      streak: {
        ...patterns.streak,
        lastLoggedAt: occurredAt,
      },
    },
  };
}

export function recordIncomeMutation(
  accountId: string,
  amountMinor: number,
  source: IncomeSource,
  note?: string,
): OptimisticMutation {
  const label = `Logging ${money(amountMinor)} · ${source}`;
  return {
    label,
    apply: (view) => patchFinanceIncome(view, amountMinor),
    commit: async () => {
      await api.recordIncome(accountId, { amountMinor, source, note });
    },
  };
}

export function recordSpendMutation(
  accountId: string,
  amountMinor: number,
  category: SpendCategory,
  note?: string,
): OptimisticMutation {
  const occurredAt = new Date().toISOString();
  const label = `Logging ${money(amountMinor)} · ${categoryLabel(category)}`;
  return {
    label,
    apply: (view) => {
      const entry = {
        id: `optimistic-${occurredAt}`,
        amount: money(amountMinor, view.currency),
        amountMinor,
        category,
        note: note ?? null,
        occurredAt,
      };
      const spent = patchFinanceSpend(view, amountMinor);
      const patterned = patchPatternsSpend(spent, amountMinor, category, occurredAt);
      const entries = [entry, ...(patterned.spendEntries ?? [])];
      return { ...patterned, spendEntries: entries.slice(0, 80) };
    },
    commit: async () => {
      await api.recordSpend(accountId, { amountMinor, category, note });
    },
  };
}
