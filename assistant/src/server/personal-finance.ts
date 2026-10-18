import { randomUUID } from 'node:crypto';
import { databaseUrlFromEnv } from './integrity-postgres.js';
import { formatMoney } from './money.js';
import type { SpendLogEntry } from './spend-log.js';

export const INCOME_SOURCES = ['salary', 'freelance', 'gift', 'refund', 'other'] as const;
export type IncomeSource = (typeof INCOME_SOURCES)[number];

export interface MoneyProfile {
  accountId: string;
  currency: string;
  periodLabel: string;
  periodStart: string;
  /** Cash in checking / wallet (user-declared, not the P2P ledger). */
  walletCashMinor: number | null;
  /** Total owed on credit cards (positive = debt). */
  creditOwedMinor: number;
  /** A gentle weekly pace the person sets for themselves. Null until they choose one. */
  weeklyBudgetMinor: number | null;
  /**
   * When true, new spend logs reduce your projected cash from walletCash.
   * When false, walletCash is already “after spending” — logs are for history/insight only.
   */
  spendLogsAffectWallet: boolean;
  updatedAt: string;
}

export interface IncomeLogEntry {
  id: string;
  accountId: string;
  amountMinor: number;
  currency: string;
  source: IncomeSource;
  note: string | null;
  occurredAt: string;
  createdAt: string;
}

export interface RecordIncomeInput {
  amountMinor: number;
  source: IncomeSource;
  note?: string | null;
  occurredAt?: string;
  currency?: string;
}

export interface MoneyProfilePatch {
  walletCashMinor?: number | null;
  creditOwedMinor?: number;
  weeklyBudgetMinor?: number | null;
  spendLogsAffectWallet?: boolean;
  periodLabel?: string;
  periodStart?: string;
}

export interface FinancePeriodTotals {
  incomeMinor: number;
  spendMinor: number;
  income: string;
  spent: string;
}

export interface FinanceSnapshot {
  periodLabel: string;
  periodStart: string;
  walletCash: string | null;
  creditOwed: string;
  weeklyBudget: string | null;
  netCash: string | null;
  ledgerWallet: string;
  spendLogsAffectWallet: boolean;
  periodTotals: FinancePeriodTotals;
  /** Cash after period income/spend rules (only when wallet is set). */
  projectedCash: string | null;
  bullets: string[];
}

export interface PersonalFinanceStore {
  getProfile(accountId: string, currency: string, now?: Date): Promise<MoneyProfile>;
  updateProfile(accountId: string, currency: string, patch: MoneyProfilePatch, now?: Date): Promise<MoneyProfile>;
  startNewPeriod(accountId: string, currency: string, now?: Date): Promise<MoneyProfile>;
  recordIncome(accountId: string, input: RecordIncomeInput, now?: Date): Promise<IncomeLogEntry>;
  listIncome(accountId: string, opts?: { since?: Date; limit?: number }): Promise<IncomeLogEntry[]>;
}

function periodLabelFor(d: Date): string {
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function defaultPeriodStart(d: Date): string {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  return start.toISOString();
}

export function defaultMoneyProfile(accountId: string, currency: string, now = new Date()): MoneyProfile {
  const periodStart = defaultPeriodStart(now);
  return {
    accountId,
    currency,
    periodLabel: periodLabelFor(new Date(periodStart)),
    periodStart,
    walletCashMinor: null,
    creditOwedMinor: 0,
    weeklyBudgetMinor: null,
    spendLogsAffectWallet: true,
    updatedAt: now.toISOString(),
  };
}

export function sumSince(
  entries: { amountMinor: number; occurredAt: string }[],
  sinceIso: string,
): number {
  const since = Date.parse(sinceIso);
  return entries
    .filter((e) => Date.parse(e.occurredAt) >= since)
    .reduce((n, e) => n + e.amountMinor, 0);
}

export function buildFinanceSnapshot(
  profile: MoneyProfile,
  ledgerBalance: string,
  spends: SpendLogEntry[],
  incomes: IncomeLogEntry[],
): FinanceSnapshot {
  const spendMinor = sumSince(spends, profile.periodStart);
  const incomeMinor = sumSince(incomes, profile.periodStart);
  const periodTotals: FinancePeriodTotals = {
    incomeMinor,
    spendMinor,
    income: formatMoney(incomeMinor, profile.currency),
    spent: formatMoney(spendMinor, profile.currency),
  };

  const walletCash = profile.walletCashMinor === null
    ? null
    : formatMoney(profile.walletCashMinor, profile.currency);
  const creditOwed = formatMoney(profile.creditOwedMinor, profile.currency);
  const weeklyBudget = profile.weeklyBudgetMinor === null
    ? null
    : formatMoney(profile.weeklyBudgetMinor, profile.currency);
  const netCash = profile.walletCashMinor === null
    ? null
    : formatMoney(profile.walletCashMinor - profile.creditOwedMinor, profile.currency);

  let projectedCash: string | null = null;
  if (profile.walletCashMinor !== null) {
    let minor = profile.walletCashMinor;
    minor += incomeMinor;
    if (profile.spendLogsAffectWallet) minor -= spendMinor;
    projectedCash = formatMoney(minor, profile.currency);
  }

  const bullets: string[] = [];
  bullets.push(
    `Period “${profile.periodLabel}” since ${profile.periodStart.slice(0, 10)} — logged ${periodTotals.spent} out, ${periodTotals.income} in.`,
  );
  if (profile.walletCashMinor === null) {
    bullets.push('Set your cash balance below (separate from credit debt). The ledger wallet is only for settling with friends.');
  } else if (!profile.spendLogsAffectWallet) {
    bullets.push(
      'Spend logs are historical only — your cash balance already reflects what you spent. Turn on “subtract new logs” if you want each log to reduce projected cash.',
    );
  } else if (projectedCash) {
    bullets.push(
      `Projected cash this period: ${projectedCash} (cash ${walletCash} + income − logged spend). Credit owed ${creditOwed} is separate.`,
    );
  }
  if (profile.creditOwedMinor > 0 && profile.walletCashMinor !== null) {
    const net = profile.walletCashMinor - profile.creditOwedMinor;
    bullets.push(
      net >= 0
        ? `After credit cards you have about ${formatMoney(net, profile.currency)} liquid.`
        : `Credit debt exceeds cash by ${formatMoney(-net, profile.currency)} — track paydown in ACTIVITY.`,
    );
  }
  bullets.push(`P2P ledger balance (exact settle-ups): ${ledgerBalance}.`);

  return {
    periodLabel: profile.periodLabel,
    periodStart: profile.periodStart,
    walletCash,
    creditOwed,
    weeklyBudget,
    netCash,
    ledgerWallet: ledgerBalance,
    spendLogsAffectWallet: profile.spendLogsAffectWallet,
    periodTotals,
    projectedCash,
    bullets,
  };
}

export class InMemoryPersonalFinanceStore implements PersonalFinanceStore {
  private profiles = new Map<string, MoneyProfile>();
  private incomes: IncomeLogEntry[] = [];

  async getProfile(accountId: string, currency: string, now = new Date()): Promise<MoneyProfile> {
    const existing = this.profiles.get(accountId);
    if (existing) return existing;
    const p = defaultMoneyProfile(accountId, currency, now);
    this.profiles.set(accountId, p);
    return p;
  }

  async updateProfile(accountId: string, currency: string, patch: MoneyProfilePatch, now = new Date()): Promise<MoneyProfile> {
    const base = await this.getProfile(accountId, currency, now);
    const next: MoneyProfile = {
      ...base,
      walletCashMinor: patch.walletCashMinor !== undefined ? patch.walletCashMinor : base.walletCashMinor,
      creditOwedMinor: patch.creditOwedMinor ?? base.creditOwedMinor,
      weeklyBudgetMinor: patch.weeklyBudgetMinor !== undefined ? patch.weeklyBudgetMinor : base.weeklyBudgetMinor,
      spendLogsAffectWallet: patch.spendLogsAffectWallet ?? base.spendLogsAffectWallet,
      periodLabel: patch.periodLabel ?? base.periodLabel,
      periodStart: patch.periodStart ?? base.periodStart,
      updatedAt: now.toISOString(),
    };
    this.profiles.set(accountId, next);
    return next;
  }

  async startNewPeriod(accountId: string, currency: string, now = new Date()): Promise<MoneyProfile> {
    const base = await this.getProfile(accountId, currency, now);
    const periodStart = now.toISOString();
    return this.updateProfile(accountId, currency, {
      periodLabel: periodLabelFor(now),
      periodStart,
    }, now);
  }

  async recordIncome(accountId: string, input: RecordIncomeInput, now = new Date()): Promise<IncomeLogEntry> {
    if (input.amountMinor <= 0) throw new Error('amountMinor must be positive');
    const event: IncomeLogEntry = {
      id: randomUUID(),
      accountId,
      amountMinor: input.amountMinor,
      currency: input.currency ?? 'USD',
      source: input.source,
      note: input.note ?? null,
      occurredAt: input.occurredAt ?? now.toISOString(),
      createdAt: now.toISOString(),
    };
    this.incomes.push(event);
    return event;
  }

  async listIncome(accountId: string, opts?: { since?: Date; limit?: number }): Promise<IncomeLogEntry[]> {
    const limit = opts?.limit ?? 100;
    const since = opts?.since?.getTime();
    return this.incomes
      .filter((e) => e.accountId === accountId && (since === undefined || Date.parse(e.occurredAt) >= since))
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, limit);
  }
}

const SCHEMA_SQL = `
create table if not exists money_profiles (
    account_id              uuid primary key,
    currency                char(3)     not null default 'USD',
    period_label            text        not null,
    period_start            timestamptz not null,
    wallet_cash_minor       bigint,
    credit_owed_minor       bigint      not null default 0,
    weekly_budget_minor     bigint,
    spend_logs_affect_wallet boolean    not null default true,
    updated_at              timestamptz not null default now()
);
alter table money_profiles add column if not exists weekly_budget_minor bigint;
create table if not exists income_logs (
    id            uuid primary key,
    account_id    uuid        not null,
    amount_minor  bigint      not null check (amount_minor > 0),
    currency      char(3)     not null default 'USD',
    source        text        not null,
    note          text,
    occurred_at   timestamptz not null,
    created_at    timestamptz not null default now()
);
create index if not exists income_logs_account_occurred_idx on income_logs (account_id, occurred_at desc);
`;

export class PostgresPersonalFinanceStore implements PersonalFinanceStore {
  private schemaReady = false;

  constructor(private readonly connectionString: string) {}

  private async client() {
    const { default: pg } = await import('pg');
    const ssl = /supabase|sslmode=require/i.test(this.connectionString) ? { rejectUnauthorized: false } : undefined;
    const client = new pg.Client({ connectionString: this.connectionString, ssl });
    await client.connect();
    return client;
  }

  private async ensureSchema(c: import('pg').Client) {
    if (this.schemaReady) return;
    await c.query(SCHEMA_SQL);
    this.schemaReady = true;
  }

  private rowToProfile(row: Record<string, unknown>): MoneyProfile {
    return {
      accountId: String(row.account_id),
      currency: String(row.currency),
      periodLabel: String(row.period_label),
      periodStart: new Date(String(row.period_start)).toISOString(),
      walletCashMinor: row.wallet_cash_minor === null || row.wallet_cash_minor === undefined
        ? null
        : Number(row.wallet_cash_minor),
      creditOwedMinor: Number(row.credit_owed_minor ?? 0),
      weeklyBudgetMinor: row.weekly_budget_minor === null || row.weekly_budget_minor === undefined
        ? null
        : Number(row.weekly_budget_minor),
      spendLogsAffectWallet: Boolean(row.spend_logs_affect_wallet),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    };
  }

  async getProfile(accountId: string, currency: string, now = new Date()): Promise<MoneyProfile> {
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      const res = await c.query(
        `select account_id, currency, period_label, period_start, wallet_cash_minor, credit_owed_minor,
                weekly_budget_minor, spend_logs_affect_wallet, updated_at from money_profiles where account_id = $1`,
        [accountId],
      );
      if (res.rows[0]) return this.rowToProfile(res.rows[0] as Record<string, unknown>);
      const p = defaultMoneyProfile(accountId, currency, now);
      await c.query(
        `insert into money_profiles (account_id, currency, period_label, period_start, wallet_cash_minor,
         credit_owed_minor, weekly_budget_minor, spend_logs_affect_wallet, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          accountId,
          currency,
          p.periodLabel,
          p.periodStart,
          null,
          0,
          null,
          true,
          now.toISOString(),
        ],
      );
      return p;
    } finally {
      await c.end();
    }
  }

  async updateProfile(accountId: string, currency: string, patch: MoneyProfilePatch, now = new Date()): Promise<MoneyProfile> {
    const current = await this.getProfile(accountId, currency, now);
    const next = await this.updateProfileFields(accountId, {
      walletCashMinor: patch.walletCashMinor !== undefined ? patch.walletCashMinor : current.walletCashMinor,
      creditOwedMinor: patch.creditOwedMinor ?? current.creditOwedMinor,
      weeklyBudgetMinor: patch.weeklyBudgetMinor !== undefined ? patch.weeklyBudgetMinor : current.weeklyBudgetMinor,
      spendLogsAffectWallet: patch.spendLogsAffectWallet ?? current.spendLogsAffectWallet,
      periodLabel: patch.periodLabel ?? current.periodLabel,
      periodStart: patch.periodStart ?? current.periodStart,
    }, now);
    return next;
  }

  private async updateProfileFields(
    accountId: string,
    fields: {
      walletCashMinor: number | null;
      creditOwedMinor: number;
      weeklyBudgetMinor: number | null;
      spendLogsAffectWallet: boolean;
      periodLabel: string;
      periodStart: string;
    },
    now: Date,
  ): Promise<MoneyProfile> {
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      await c.query(
        `update money_profiles set
           period_label = $2,
           period_start = $3,
           wallet_cash_minor = $4,
           credit_owed_minor = $5,
           weekly_budget_minor = $6,
           spend_logs_affect_wallet = $7,
           updated_at = $8
         where account_id = $1`,
        [
          accountId,
          fields.periodLabel,
          fields.periodStart,
          fields.walletCashMinor,
          fields.creditOwedMinor,
          fields.weeklyBudgetMinor,
          fields.spendLogsAffectWallet,
          now.toISOString(),
        ],
      );
      const res = await c.query(`select * from money_profiles where account_id = $1`, [accountId]);
      return this.rowToProfile(res.rows[0] as Record<string, unknown>);
    } finally {
      await c.end();
    }
  }

  async startNewPeriod(accountId: string, currency: string, now = new Date()): Promise<MoneyProfile> {
    const base = await this.getProfile(accountId, currency, now);
    return this.updateProfile(accountId, currency, {
      periodLabel: periodLabelFor(now),
      periodStart: now.toISOString(),
    }, now);
  }

  async recordIncome(accountId: string, input: RecordIncomeInput, now = new Date()): Promise<IncomeLogEntry> {
    if (input.amountMinor <= 0) throw new Error('amountMinor must be positive');
    const id = randomUUID();
    const occurredAt = input.occurredAt ?? now.toISOString();
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      await c.query(
        `insert into income_logs (id, account_id, amount_minor, currency, source, note, occurred_at, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          accountId,
          input.amountMinor,
          input.currency ?? 'USD',
          input.source,
          input.note ?? null,
          occurredAt,
          now.toISOString(),
        ],
      );
    } finally {
      await c.end();
    }
    return {
      id,
      accountId,
      amountMinor: input.amountMinor,
      currency: input.currency ?? 'USD',
      source: input.source,
      note: input.note ?? null,
      occurredAt,
      createdAt: now.toISOString(),
    };
  }

  async listIncome(accountId: string, opts?: { since?: Date; limit?: number }): Promise<IncomeLogEntry[]> {
    const limit = Math.min(opts?.limit ?? 100, 500);
    const c = await this.client();
    try {
      await this.ensureSchema(c);
      const params: unknown[] = [accountId];
      let sql = `select id, account_id, amount_minor, currency, source, note, occurred_at, created_at
                 from income_logs where account_id = $1`;
      if (opts?.since) {
        params.push(opts.since.toISOString());
        sql += ` and occurred_at >= $2 order by occurred_at desc limit $3`;
        params.push(limit);
      } else {
        sql += ` order by occurred_at desc limit $2`;
        params.push(limit);
      }
      const res = await c.query(sql, params);
      return res.rows.map((row: Record<string, unknown>) => ({
        id: String(row.id),
        accountId: String(row.account_id),
        amountMinor: Number(row.amount_minor),
        currency: String(row.currency),
        source: row.source as IncomeSource,
        note: row.note as string | null,
        occurredAt: new Date(String(row.occurred_at)).toISOString(),
        createdAt: new Date(String(row.created_at)).toISOString(),
      }));
    } finally {
      await c.end();
    }
  }
}

export function createPersonalFinanceStore(env: NodeJS.ProcessEnv = process.env): PersonalFinanceStore {
  const url = databaseUrlFromEnv(env);
  if (url) return new PostgresPersonalFinanceStore(url);
  return new InMemoryPersonalFinanceStore();
}

export function isIncomeSource(value: string): value is IncomeSource {
  return (INCOME_SOURCES as readonly string[]).includes(value);
}
