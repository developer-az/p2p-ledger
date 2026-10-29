import type { PersonalFinanceStore } from './personal-finance.js';
import type { SpendCategory, SpendLogStore } from './spend-log.js';

const MS_DAY = 86_400_000;
const MS_HOUR = 3_600_000;

export type DemoPersona = 'anthony' | 'sam' | 'jordan';

interface DemoSpend {
  daysAgo: number;
  hoursAgo?: number;
  amountMinor: number;
  category: SpendCategory;
  note: string;
}

interface DemoProfile {
  cashMinor: number;
  creditMinor: number;
  weeklyBudgetMinor: number;
  incomeMinor: number;
  incomeSource: 'salary' | 'freelance';
  spends: DemoSpend[];
}

const ANTHONY: DemoProfile = {
  cashMinor: 320_000,
  creditMinor: 45_000,
  weeklyBudgetMinor: 45_000,
  incomeMinor: 420_000,
  incomeSource: 'salary',
  spends: [
    { daysAgo: 0, hoursAgo: 2, amountMinor: 450, category: 'dining', note: 'Coffee' },
    { daysAgo: 0, hoursAgo: 5, amountMinor: 1_650, category: 'dining', note: 'Lunch with Sam' },
    { daysAgo: 1, hoursAgo: 3, amountMinor: 4_210, category: 'groceries', note: 'Weekly shop' },
    { daysAgo: 1, hoursAgo: 8, amountMinor: 350, category: 'dining', note: 'Coffee' },
    { daysAgo: 2, hoursAgo: 4, amountMinor: 280, category: 'transport', note: 'Bus pass' },
    { daysAgo: 2, hoursAgo: 9, amountMinor: 3_200, category: 'dining', note: 'Dinner out' },
    { daysAgo: 3, hoursAgo: 6, amountMinor: 5_400, category: 'entertainment', note: 'Concert' },
    { daysAgo: 4, hoursAgo: 5, amountMinor: 8_900, category: 'shopping', note: 'Running shoes' },
    { daysAgo: 5, hoursAgo: 4, amountMinor: 6_120, category: 'groceries', note: 'Market run' },
    { daysAgo: 6, hoursAgo: 7, amountMinor: 2_200, category: 'health', note: 'Pharmacy' },
    { daysAgo: 7, hoursAgo: 5, amountMinor: 1_450, category: 'dining', note: 'Lunch' },
    { daysAgo: 8, hoursAgo: 6, amountMinor: 7_800, category: 'entertainment', note: 'Tickets' },
    { daysAgo: 9, hoursAgo: 4, amountMinor: 5_400, category: 'groceries', note: 'Groceries' },
    { daysAgo: 10, hoursAgo: 8, amountMinor: 2_600, category: 'dining', note: 'Pizza night' },
    { daysAgo: 11, hoursAgo: 3, amountMinor: 450, category: 'dining', note: 'Coffee' },
    { daysAgo: 14, hoursAgo: 4, amountMinor: 4_300, category: 'groceries', note: 'Groceries' },
    { daysAgo: 16, hoursAgo: 7, amountMinor: 3_100, category: 'dining', note: 'Dinner' },
    { daysAgo: 18, hoursAgo: 5, amountMinor: 1_200, category: 'transport', note: 'Train' },
    { daysAgo: 20, hoursAgo: 6, amountMinor: 145_000, category: 'housing', note: 'Rent share' },
    { daysAgo: 20, hoursAgo: 6, amountMinor: 8_800, category: 'shopping', note: 'Jacket' },
    { daysAgo: 22, hoursAgo: 4, amountMinor: 1_800, category: 'dining', note: 'Lunch' },
    { daysAgo: 24, hoursAgo: 8, amountMinor: 6_000, category: 'groceries', note: 'Costco' },
    { daysAgo: 27, hoursAgo: 5, amountMinor: 4_200, category: 'entertainment', note: 'Movie night' },
    { daysAgo: 30, hoursAgo: 7, amountMinor: 2_200, category: 'dining', note: 'Takeout' },
    { daysAgo: 33, hoursAgo: 4, amountMinor: 900, category: 'transport', note: 'Transit' },
    { daysAgo: 36, hoursAgo: 6, amountMinor: 1_500, category: 'health', note: 'Vitamins' },
    { daysAgo: 40, hoursAgo: 5, amountMinor: 3_500, category: 'shopping', note: 'Home supplies' },
  ],
};

const SAM: DemoProfile = {
  cashMinor: 185_000,
  creditMinor: 0,
  weeklyBudgetMinor: 28_000,
  incomeMinor: 320_000,
  incomeSource: 'salary',
  spends: [
    { daysAgo: 0, hoursAgo: 4, amountMinor: 1_200, category: 'dining', note: 'Team lunch' },
    { daysAgo: 1, hoursAgo: 5, amountMinor: 2_800, category: 'transport', note: 'Rideshare' },
    { daysAgo: 2, hoursAgo: 7, amountMinor: 5_100, category: 'groceries', note: 'Groceries' },
    { daysAgo: 4, hoursAgo: 3, amountMinor: 3_600, category: 'entertainment', note: 'Climbing gym' },
    { daysAgo: 6, hoursAgo: 6, amountMinor: 1_800, category: 'dining', note: 'Coffee + pastry' },
    { daysAgo: 8, hoursAgo: 4, amountMinor: 4_400, category: 'health', note: 'Physio' },
    { daysAgo: 11, hoursAgo: 5, amountMinor: 6_200, category: 'shopping', note: 'Desk lamp' },
    { daysAgo: 14, hoursAgo: 7, amountMinor: 2_100, category: 'dining', note: 'Dinner' },
    { daysAgo: 17, hoursAgo: 4, amountMinor: 5_800, category: 'groceries', note: 'Weekly shop' },
    { daysAgo: 21, hoursAgo: 6, amountMinor: 1_500, category: 'transport', note: 'Train' },
    { daysAgo: 25, hoursAgo: 5, amountMinor: 3_200, category: 'entertainment', note: 'Concert' },
    { daysAgo: 30, hoursAgo: 4, amountMinor: 2_400, category: 'dining', note: 'Brunch' },
  ],
};

const JORDAN: DemoProfile = {
  cashMinor: 90_000,
  creditMinor: 120_000,
  weeklyBudgetMinor: 20_000,
  incomeMinor: 260_000,
  incomeSource: 'freelance',
  spends: [
    { daysAgo: 0, hoursAgo: 3, amountMinor: 3_400, category: 'groceries', note: 'Groceries' },
    { daysAgo: 2, hoursAgo: 6, amountMinor: 1_100, category: 'transport', note: 'Fuel' },
    { daysAgo: 4, hoursAgo: 5, amountMinor: 2_600, category: 'dining', note: 'Dinner' },
    { daysAgo: 7, hoursAgo: 7, amountMinor: 8_500, category: 'housing', note: 'Utilities' },
    { daysAgo: 10, hoursAgo: 4, amountMinor: 1_800, category: 'health', note: 'Pharmacy' },
    { daysAgo: 14, hoursAgo: 6, amountMinor: 4_200, category: 'shopping', note: 'Household' },
    { daysAgo: 19, hoursAgo: 5, amountMinor: 2_900, category: 'dining', note: 'Takeout' },
    { daysAgo: 26, hoursAgo: 4, amountMinor: 3_100, category: 'groceries', note: 'Market' },
  ],
};

const PROFILES: Record<DemoPersona, DemoProfile> = { anthony: ANTHONY, sam: SAM, jordan: JORDAN };

function at(now: Date, daysAgo: number, hoursAgo = 0): string {
  return new Date(now.getTime() - daysAgo * MS_DAY - hoursAgo * MS_HOUR).toISOString();
}

/**
 * Gives a demo wallet a believable personal history so the product has something
 * to teach with on first open. Idempotent: a wallet with any spend log is left alone.
 */
export async function seedDemoHabits(
  spendLogs: SpendLogStore,
  finance: PersonalFinanceStore,
  accountId: string,
  persona: DemoPersona,
  now = new Date(),
): Promise<boolean> {
  const existing = await spendLogs.list(accountId, { limit: 1 });
  if (existing.length > 0) return false;
  const profile = PROFILES[persona];
  await finance.updateProfile(accountId, 'USD', {
    walletCashMinor: profile.cashMinor,
    creditOwedMinor: profile.creditMinor,
    weeklyBudgetMinor: profile.weeklyBudgetMinor,
    spendLogsAffectWallet: true,
  }, now);
  await finance.recordIncome(accountId, {
    amountMinor: profile.incomeMinor,
    source: profile.incomeSource,
    note: 'Demo income · this month',
    occurredAt: at(now, 17, 3),
  }, now);
  for (const spend of profile.spends) {
    await spendLogs.record(accountId, {
      amountMinor: spend.amountMinor,
      category: spend.category,
      note: spend.note,
      occurredAt: at(now, spend.daysAgo, spend.hoursAgo ?? 0),
      source: 'import',
    }, now);
  }
  return true;
}
