import { formatMoney } from './money.js';
import type { IncomeLogEntry } from './personal-finance.js';
import type { SpendLogEntry } from './spend-log.js';

/**
 * Shared money-risk computations: a normalized transaction list, recurring
 * streams, a cash forecast, server-evaluated alerts and a monthly report.
 *
 * Everything here is pure: routes load the rows, these functions decide what
 * they mean. Keeping one normalized list means M3 imports, manual logs and the
 * sample household all feed the same detectors.
 */

const DAY_MS = 86_400_000;
const DISCRETIONARY_WINDOW_DAYS = 90;

export type TransactionDirection = 'in' | 'out';

export interface NormalizedTransaction {
  id: string;
  accountId: string;
  direction: TransactionDirection;
  /** Always positive; direction carries the sign. */
  amountMinor: number;
  currency: string;
  occurredAt: string;
  merchant: string;
  merchantKey: string;
  /** Spend category for outflows, income source for inflows. */
  category: string | null;
  source: 'spend' | 'income';
}

export interface RecurringStream {
  key: string;
  merchant: string;
  merchantKey: string;
  direction: TransactionDirection;
  category: string | null;
  amountMinor: number;
  intervalDays: number;
  occurrences: number;
  lastDate: string;
  nextDate: string;
  confidence: 'low' | 'medium' | 'high';
}

export interface ForecastPoint {
  day: number;
  date: string;
  balanceMinor: number;
}

export interface ForecastMilestone {
  day: number;
  date: string;
  balanceMinor: number;
  incomeMinor: number;
  outflowMinor: number;
}

export interface PlannedIncome {
  date: string;
  amountMinor: number;
  merchant: string;
}

export interface CashForecast {
  generatedAt: string;
  currency: string;
  startingBalanceMinor: number;
  horizonDays: number;
  points: ForecastPoint[];
  milestones: ForecastMilestone[];
  recurringOutflows: RecurringStream[];
  plannedIncome: PlannedIncome[];
  averageDiscretionaryMinorPerDay: number;
  monthlyIncomeMinor: number;
  monthlyRecurringOutflowMinor: number;
  lowestBalanceMinor: number;
  lowestDate: string;
  shortfall: boolean;
  assumptions: string[];
}

export type AlertRule = 'LOW_PROJECTED_BALANCE' | 'LARGE_SPEND' | 'WEEKLY_PLAN_OVERSPEND' | 'UPCOMING_LARGE_CHARGE';
export type AlertSeverity = 'high' | 'medium' | 'low';

export interface RiskAlert {
  id: string;
  rule: AlertRule;
  severity: AlertSeverity;
  title: string;
  detail: string;
  evidence: Record<string, string | number | null>;
  occurredAt: string | null;
}

export interface AlertInput {
  now: Date;
  transactions: NormalizedTransaction[];
  currentBalanceMinor: number;
  weeklyBudgetMinor: number | null;
  weeklySpentMinor: number;
  weekStart?: string;
  dismissed?: Iterable<string>;
  upcomingThresholdMinor?: number;
  horizonDays?: number;
}

export interface ReportCategoryRow {
  key: string;
  kind: 'spend' | 'income';
  inMinor: number;
  outMinor: number;
  count: number;
}

export interface ReportMerchantRow {
  merchant: string;
  merchantKey: string;
  spendMinor: number;
  count: number;
  sharePct: number;
}

export interface MonthlyReport {
  month: string;
  label: string;
  start: string;
  end: string;
  currency: string;
  incomeMinor: number;
  spendMinor: number;
  netMinor: number;
  transactionCount: number;
  byCategory: ReportCategoryRow[];
  topMerchants: ReportMerchantRow[];
  previous: {
    month: string;
    label: string;
    incomeMinor: number;
    spendMinor: number;
    netMinor: number;
  };
  change: {
    incomePct: number | null;
    spendPct: number | null;
    netPct: number | null;
    incomeDeltaMinor: number;
    spendDeltaMinor: number;
    netDeltaMinor: number;
  };
}

function startOfUtcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function dateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function dateKeyToMs(key: string): number {
  const parsed = Date.parse(`${key}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function addDaysKey(key: string, days: number): string {
  return dateKey(dateKeyToMs(key) + days * DAY_MS);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

function cleanLabel(value: string | null | undefined, fallback: string): string {
  const cleaned = (value ?? '').replace(/\s+/g, ' ').trim();
  return cleaned || capitalize(fallback);
}

function merchantKeyOf(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Turn spend and income rows into one normalized, direction-aware list. */
export function normalizeTransactions(
  spends: SpendLogEntry[],
  incomes: IncomeLogEntry[],
): NormalizedTransaction[] {
  const out: NormalizedTransaction[] = [];
  for (const row of spends) {
    const merchant = cleanLabel(row.note, row.category);
    out.push({
      id: row.id,
      accountId: row.accountId,
      direction: 'out',
      amountMinor: row.amountMinor,
      currency: row.currency,
      occurredAt: row.occurredAt,
      merchant,
      merchantKey: merchantKeyOf(merchant),
      category: row.category,
      source: 'spend',
    });
  }
  for (const row of incomes) {
    const merchant = cleanLabel(row.note, row.source);
    out.push({
      id: row.id,
      accountId: row.accountId,
      direction: 'in',
      amountMinor: row.amountMinor,
      currency: row.currency,
      occurredAt: row.occurredAt,
      merchant,
      merchantKey: merchantKeyOf(merchant),
      category: row.source,
      source: 'income',
    });
  }
  return out.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

function cadenceDays(medianGap: number): number | null {
  if (medianGap >= 5 && medianGap <= 9) return 7;
  if (medianGap >= 12 && medianGap <= 16) return 14;
  if (medianGap >= 25 && medianGap <= 35) return 30;
  if (medianGap >= 80 && medianGap <= 100) return 91;
  return null;
}

function toleranceFor(intervalDays: number): number {
  if (intervalDays === 7) return 2;
  if (intervalDays === 14) return 3;
  if (intervalDays === 30) return 5;
  return 10;
}

/** Find same-merchant streams that repeat on a weekly, fortnightly, monthly or quarterly cadence. */
export function detectRecurring(transactions: NormalizedTransaction[]): RecurringStream[] {
  const groups = new Map<string, NormalizedTransaction[]>();
  for (const txn of transactions) {
    if (!Number.isFinite(Date.parse(txn.occurredAt))) continue;
    const key = `${txn.direction}:${txn.merchantKey}`;
    const group = groups.get(key);
    if (group) group.push(txn);
    else groups.set(key, [txn]);
  }

  const streams: RecurringStream[] = [];
  for (const [key, group] of groups) {
    const byDate = new Map<string, NormalizedTransaction[]>();
    for (const txn of group) {
      const day = dateKey(Date.parse(txn.occurredAt));
      const rows = byDate.get(day);
      if (rows) rows.push(txn);
      else byDate.set(day, [txn]);
    }
    const dates = [...byDate.keys()].sort();
    if (dates.length < 2) continue;

    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i += 1) {
      gaps.push(Math.round((dateKeyToMs(dates[i]!) - dateKeyToMs(dates[i - 1]!)) / DAY_MS));
    }
    const medianGap = median(gaps);
    const intervalDays = cadenceDays(medianGap);
    if (intervalDays === null) continue;
    const tolerance = toleranceFor(intervalDays);
    const near = gaps.filter((gap) => Math.abs(gap - intervalDays) <= tolerance).length;
    if (near < Math.ceil(gaps.length * 0.6)) continue;

    const sample = group[group.length - 1]!;
    const amounts = group.map((txn) => txn.amountMinor);
    const lastDate = dates[dates.length - 1]!;
    streams.push({
      key: `${key}:${amountTone(median(amounts))}`,
      merchant: sample.merchant,
      merchantKey: sample.merchantKey,
      direction: sample.direction,
      category: sample.category,
      amountMinor: Math.round(median(amounts)),
      intervalDays,
      occurrences: dates.length,
      lastDate,
      nextDate: addDaysKey(lastDate, intervalDays),
      confidence: dates.length >= 4 ? 'high' : dates.length >= 3 ? 'medium' : 'low',
    });
  }
  return streams.sort((a, b) => a.nextDate.localeCompare(b.nextDate) || a.merchant.localeCompare(b.merchant));
}

function amountTone(amount: number): string {
  return Math.round(amount).toString(36);
}

interface DueEvent {
  day: number;
  date: string;
  direction: TransactionDirection;
  amountMinor: number;
  merchant: string;
  streamKey: string;
}

function dueEvents(
  stream: RecurringStream,
  startMs: number,
  horizonDays: number,
  includeToday = false,
): DueEvent[] {
  let dueMs = dateKeyToMs(stream.nextDate);
  if (!Number.isFinite(dueMs)) return [];
  const limit = startMs + horizonDays * DAY_MS;
  while (includeToday ? dueMs < startMs : dueMs <= startMs) dueMs += stream.intervalDays * DAY_MS;
  const events: DueEvent[] = [];
  while (dueMs <= limit) {
    events.push({
      day: Math.round((dueMs - startMs) / DAY_MS),
      date: dateKey(dueMs),
      direction: stream.direction,
      amountMinor: stream.amountMinor,
      merchant: stream.merchant,
      streamKey: stream.key,
    });
    dueMs += stream.intervalDays * DAY_MS;
  }
  return events;
}

function monthlyFromInterval(amountMinor: number, intervalDays: number): number {
  return Math.round((amountMinor * 30) / intervalDays);
}

/** Project daily cash for 30/60/90 days from detected streams plus average discretionary spend. */
export function buildCashForecast(input: {
  now: Date;
  currentBalanceMinor: number;
  transactions: NormalizedTransaction[];
  horizonDays?: number;
  currency?: string;
}): CashForecast {
  const startMs = startOfUtcDay(input.now);
  const horizonDays = Math.max(1, Math.trunc(input.horizonDays ?? 90));
  const detected = detectRecurring(input.transactions);
  const recurringOutflows = detected.filter((stream) => stream.direction === 'out');

  // Income only enters the projection when detectRecurring found a cadence with
  // at least two occurrences. A single one-off deposit must not become a
  // monthly payment.
  const incomeStreams = detected.filter((stream) => stream.direction === 'in');

  const recurringOutKeys = new Set(recurringOutflows.map((stream) => stream.merchantKey));
  const windowStartMs = startMs - DISCRETIONARY_WINDOW_DAYS * DAY_MS;
  const nowMs = input.now.getTime();
  const discretionaryMinor = input.transactions
    .filter((txn) => txn.direction === 'out' && !recurringOutKeys.has(txn.merchantKey))
    .filter((txn) => {
      const at = Date.parse(txn.occurredAt);
      return Number.isFinite(at) && at >= windowStartMs && at <= nowMs;
    })
    .reduce((sum, txn) => sum + txn.amountMinor, 0);
  const discretionaryPerDay = discretionaryMinor / DISCRETIONARY_WINDOW_DAYS;
  const averageDiscretionaryMinorPerDay = Math.round(discretionaryPerDay);

  const events: DueEvent[] = [];
  for (const stream of recurringOutflows) events.push(...dueEvents(stream, startMs, horizonDays));
  for (const stream of incomeStreams) events.push(...dueEvents(stream, startMs, horizonDays));

  const incomeByDay = new Map<number, number>();
  const outflowByDay = new Map<number, number>();
  for (const event of events) {
    const target = event.direction === 'in' ? incomeByDay : outflowByDay;
    target.set(event.day, (target.get(event.day) ?? 0) + event.amountMinor);
  }

  const points: ForecastPoint[] = [{
    day: 0,
    date: dateKey(startMs),
    balanceMinor: input.currentBalanceMinor,
  }];
  let incomeToDate = 0;
  let recurringOutToDate = 0;
  for (let day = 1; day <= horizonDays; day += 1) {
    incomeToDate += incomeByDay.get(day) ?? 0;
    recurringOutToDate += outflowByDay.get(day) ?? 0;
    const discretionaryToDate = Math.round(discretionaryPerDay * day);
    points.push({
      day,
      date: dateKey(startMs + day * DAY_MS),
      balanceMinor: input.currentBalanceMinor + incomeToDate - recurringOutToDate - discretionaryToDate,
    });
  }

  const milestoneDays = [30, 60, 90].filter((day) => day <= horizonDays);
  if (milestoneDays.length === 0) milestoneDays.push(horizonDays);
  const milestones = milestoneDays.map((day): ForecastMilestone => {
    const point = points[day]!;
    const incomeMinor = events
      .filter((event) => event.direction === 'in' && event.day <= day)
      .reduce((sum, event) => sum + event.amountMinor, 0);
    const outflowMinor = events
      .filter((event) => event.direction === 'out' && event.day <= day)
      .reduce((sum, event) => sum + event.amountMinor, 0)
      + Math.round(discretionaryPerDay * day);
    return { day, date: point.date, balanceMinor: point.balanceMinor, incomeMinor, outflowMinor };
  });

  let lowestBalanceMinor = input.currentBalanceMinor;
  let lowestDate = dateKey(startMs);
  for (const point of points) {
    if (point.balanceMinor < lowestBalanceMinor) {
      lowestBalanceMinor = point.balanceMinor;
      lowestDate = point.date;
    }
  }

  const plannedIncome: PlannedIncome[] = events
    .filter((event) => event.direction === 'in')
    .map((event) => ({ date: event.date, amountMinor: event.amountMinor, merchant: event.merchant }));

  const monthlyIncomeMinor = incomeStreams
    .reduce((sum, stream) => sum + monthlyFromInterval(stream.amountMinor, stream.intervalDays), 0);
  const monthlyRecurringOutflowMinor = recurringOutflows
    .reduce((sum, stream) => sum + monthlyFromInterval(stream.amountMinor, stream.intervalDays), 0);

  return {
    generatedAt: input.now.toISOString(),
    currency: input.currency ?? input.transactions[0]?.currency ?? 'USD',
    startingBalanceMinor: input.currentBalanceMinor,
    horizonDays,
    points,
    milestones,
    recurringOutflows,
    plannedIncome,
    averageDiscretionaryMinorPerDay,
    monthlyIncomeMinor,
    monthlyRecurringOutflowMinor,
    lowestBalanceMinor,
    lowestDate,
    shortfall: lowestBalanceMinor < 0,
    assumptions: [
      'Recurring means the same merchant repeats every 7, 14, 30 or 91 days.',
      'Everything else uses your average logged spend over the last 90 days, spread evenly.',
      incomeStreams.length > 0
        ? 'Planned income uses the cadence found in your income logs.'
        : 'No recurring income was detected, so the projection leaves income out.',
    ],
  };
}

function severityRank(severity: AlertSeverity): number {
  return severity === 'high' ? 0 : severity === 'medium' ? 1 : 2;
}

function weekStartKey(now: Date): string {
  const day = startOfUtcDay(now);
  const weekday = new Date(day).getUTCDay();
  const sinceMonday = (weekday + 6) % 7;
  return dateKey(day - sinceMonday * DAY_MS);
}

/** Evaluate the four alert rules against one account's normalized history. */
export function buildRiskAlerts(input: AlertInput): RiskAlert[] {
  const alerts: RiskAlert[] = [];
  const startMs = startOfUtcDay(input.now);
  const nowMs = input.now.getTime();
  const currency = input.transactions[0]?.currency ?? 'USD';
  const horizonDays = input.horizonDays ?? 30;

  const forecast = buildCashForecast({
    now: input.now,
    currentBalanceMinor: input.currentBalanceMinor,
    transactions: input.transactions,
    horizonDays,
    currency,
  });
  const projected = forecast.points[forecast.points.length - 1]!;
  const lowThresholdMinor = input.weeklyBudgetMinor ?? 0;
  if (projected.balanceMinor < 0 || (lowThresholdMinor > 0 && projected.balanceMinor < lowThresholdMinor)) {
    const high = projected.balanceMinor < 0;
    alerts.push({
      id: `low-projected-balance:${dateKey(startMs)}`,
      rule: 'LOW_PROJECTED_BALANCE',
      severity: high ? 'high' : 'medium',
      title: high ? 'Projected cash goes negative' : 'Projected cash runs low',
      detail: high
        ? `At the current pace, cash reaches ${formatMoney(projected.balanceMinor, currency)} by ${projected.date}.`
        : `Cash is projected at ${formatMoney(projected.balanceMinor, currency)} by ${projected.date}, below your ${formatMoney(lowThresholdMinor, currency)} weekly plan.`,
      evidence: {
        projectedBalanceMinor: projected.balanceMinor,
        horizonDays,
        projectedDate: projected.date,
        thresholdMinor: lowThresholdMinor,
      },
      occurredAt: `${projected.date}T00:00:00.000Z`,
    });
  }

  const outflows = input.transactions.filter((txn) => txn.direction === 'out');
  const recent = outflows.filter((txn) => {
    const at = Date.parse(txn.occurredAt);
    return Number.isFinite(at) && at >= startMs - 7 * DAY_MS && at <= nowMs;
  });
  for (const candidate of recent) {
    if (!candidate.category) continue;
    const candidateAt = Date.parse(candidate.occurredAt);
    const prior = outflows
      .filter((txn) => txn.category === candidate.category && Date.parse(txn.occurredAt) < candidateAt)
      .filter((txn) => Date.parse(txn.occurredAt) >= startMs - 90 * DAY_MS)
      .map((txn) => txn.amountMinor);
    if (prior.length < 3) continue;
    const categoryMedian = Math.round(median(prior));
    if (categoryMedian <= 0) continue;
    const ratio = candidate.amountMinor / categoryMedian;
    if (ratio < 2.5 || candidate.amountMinor - categoryMedian < 2_000) continue;
    const ruleSeverity: AlertSeverity = ratio >= 5 ? 'high' : 'medium';
    alerts.push({
      id: `large-spend:${candidate.id}`,
      rule: 'LARGE_SPEND',
      severity: ruleSeverity,
      title: `Large ${candidate.category} charge`,
      detail: `${candidate.merchant} was ${formatMoney(candidate.amountMinor, candidate.currency)} — ${ratio.toFixed(1)}× your ${candidate.category} median of ${formatMoney(categoryMedian, candidate.currency)}.`,
      evidence: {
        amountMinor: candidate.amountMinor,
        medianMinor: categoryMedian,
        ratio: Math.round(ratio * 10) / 10,
        merchant: candidate.merchant,
        category: candidate.category,
      },
      occurredAt: candidate.occurredAt,
    });
  }

  if (input.weeklyBudgetMinor !== null && input.weeklySpentMinor > input.weeklyBudgetMinor) {
    const overMinor = input.weeklySpentMinor - input.weeklyBudgetMinor;
    const weekStart = input.weekStart ?? weekStartKey(input.now);
    alerts.push({
      id: `weekly-plan-overspend:${weekStart}`,
      rule: 'WEEKLY_PLAN_OVERSPEND',
      severity: input.weeklySpentMinor > input.weeklyBudgetMinor * 1.25 ? 'high' : 'medium',
      title: 'Weekly plan overspent',
      detail: `You are ${formatMoney(overMinor, currency)} over the ${formatMoney(input.weeklyBudgetMinor, currency)} weekly plan.`,
      evidence: {
        overMinor,
        budgetMinor: input.weeklyBudgetMinor,
        spentMinor: input.weeklySpentMinor,
      },
      occurredAt: `${weekStart}T00:00:00.000Z`,
    });
  }

  const threshold = input.upcomingThresholdMinor
    ?? Math.max(10_000, Math.round(Math.max(0, input.currentBalanceMinor) * 0.2));
  for (const stream of forecast.recurringOutflows) {
    for (const event of dueEvents(stream, startMs, 14)) {
      if (event.amountMinor < threshold) continue;
      const dueSoon = event.day <= 3 || (input.currentBalanceMinor > 0 && event.amountMinor >= input.currentBalanceMinor);
      alerts.push({
        id: `upcoming-large-charge:${stream.merchantKey}:${event.date}`,
        rule: 'UPCOMING_LARGE_CHARGE',
        severity: dueSoon ? 'high' : 'medium',
        title: 'Upcoming large charge',
        detail: `${event.merchant} is due ${event.date} for ${formatMoney(event.amountMinor, currency)}.`,
        evidence: {
          amountMinor: event.amountMinor,
          dueDate: event.date,
          merchant: event.merchant,
        },
        occurredAt: `${event.date}T00:00:00.000Z`,
      });
    }
  }

  const dismissed = new Set(input.dismissed ?? []);
  return alerts
    .filter((alert) => !dismissed.has(alert.id))
    .sort((a, b) =>
      severityRank(a.severity) - severityRank(b.severity)
      || a.id.localeCompare(b.id));
}

interface MonthInfo {
  month: string;
  label: string;
  start: string;
  end: string;
  startMs: number;
  endMs: number;
  nextMs: number;
}

function monthInfo(month: string | undefined, now: Date): MonthInfo {
  const fallback = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const selected = month && /^\d{4}-\d{2}$/.test(month) ? month : fallback;
  const [yearText, monthText] = selected.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const startMs = Date.UTC(year, monthIndex, 1);
  const nextMs = Date.UTC(year, monthIndex + 1, 1);
  return {
    month: selected,
    label: new Date(startMs).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    start: dateKey(startMs),
    end: dateKey(nextMs - DAY_MS),
    startMs,
    endMs: nextMs - DAY_MS,
    nextMs,
  };
}

interface MonthSummary {
  incomeMinor: number;
  spendMinor: number;
  netMinor: number;
  transactionCount: number;
  byCategory: ReportCategoryRow[];
  topMerchants: ReportMerchantRow[];
}

function monthSummary(transactions: NormalizedTransaction[], info: MonthInfo, limit = 5): MonthSummary {
  const rows = transactions.filter((txn) => {
    const at = Date.parse(txn.occurredAt);
    return Number.isFinite(at) && at >= info.startMs && at < info.nextMs;
  });

  let incomeMinor = 0;
  let spendMinor = 0;
  const categories = new Map<string, ReportCategoryRow>();
  const merchants = new Map<string, { merchant: string; merchantKey: string; spendMinor: number; count: number }>();

  for (const txn of rows) {
    if (txn.direction === 'in') incomeMinor += txn.amountMinor;
    else spendMinor += txn.amountMinor;

    const key = txn.category ?? 'other';
    const categoryKey = `${txn.direction === 'in' ? 'income' : 'spend'}:${key}`;
    const category = categories.get(categoryKey);
    if (category) {
      category.count += 1;
      if (txn.direction === 'in') category.inMinor += txn.amountMinor;
      else category.outMinor += txn.amountMinor;
    } else {
      categories.set(categoryKey, {
        key,
        kind: txn.direction === 'in' ? 'income' : 'spend',
        inMinor: txn.direction === 'in' ? txn.amountMinor : 0,
        outMinor: txn.direction === 'out' ? txn.amountMinor : 0,
        count: 1,
      });
    }

    if (txn.direction === 'out') {
      const merchant = merchants.get(txn.merchantKey);
      if (merchant) {
        merchant.spendMinor += txn.amountMinor;
        merchant.count += 1;
      } else {
        merchants.set(txn.merchantKey, {
          merchant: txn.merchant,
          merchantKey: txn.merchantKey,
          spendMinor: txn.amountMinor,
          count: 1,
        });
      }
    }
  }

  const byCategory = [...categories.values()]
    .sort((a, b) => a.key.localeCompare(b.key) || a.kind.localeCompare(b.kind));
  const topMerchants = [...merchants.values()]
    .sort((a, b) => b.spendMinor - a.spendMinor || a.merchantKey.localeCompare(b.merchantKey))
    .slice(0, Math.max(1, limit))
    .map((merchant) => ({
      ...merchant,
      sharePct: spendMinor > 0 ? Math.round((merchant.spendMinor / spendMinor) * 100) : 0,
    }));

  return {
    incomeMinor,
    spendMinor,
    netMinor: incomeMinor - spendMinor,
    transactionCount: rows.length,
    byCategory,
    topMerchants,
  };
}

function changePct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Monthly in/out by category, top merchants and month-over-month movement. */
export function buildMonthlyReport(input: {
  now: Date;
  transactions: NormalizedTransaction[];
  month?: string;
  currency?: string;
  topMerchantLimit?: number;
}): MonthlyReport {
  const info = monthInfo(input.month, input.now);
  const previousInfo = monthInfo(
    new Date(Date.UTC(Number(info.month.slice(0, 4)), Number(info.month.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7),
    input.now,
  );
  const current = monthSummary(input.transactions, info, input.topMerchantLimit);
  const previous = monthSummary(input.transactions, previousInfo, input.topMerchantLimit);
  const hasRows = current.transactionCount > 0;

  return {
    month: info.month,
    label: info.label,
    start: info.start,
    end: info.end,
    currency: input.currency ?? input.transactions[0]?.currency ?? 'USD',
    incomeMinor: current.incomeMinor,
    spendMinor: current.spendMinor,
    netMinor: current.netMinor,
    transactionCount: current.transactionCount,
    byCategory: current.byCategory,
    topMerchants: current.topMerchants,
    previous: {
      month: previousInfo.month,
      label: previousInfo.label,
      incomeMinor: previous.incomeMinor,
      spendMinor: previous.spendMinor,
      netMinor: previous.netMinor,
    },
    change: {
      incomePct: hasRows ? changePct(current.incomeMinor, previous.incomeMinor) : null,
      spendPct: hasRows ? changePct(current.spendMinor, previous.spendMinor) : null,
      netPct: hasRows ? changePct(current.netMinor, previous.netMinor) : null,
      incomeDeltaMinor: current.incomeMinor - previous.incomeMinor,
      spendDeltaMinor: current.spendMinor - previous.spendMinor,
      netDeltaMinor: current.netMinor - previous.netMinor,
    },
  };
}

function csvCell(value: string | number | null): string {
  const raw = value === null ? '' : String(value);
  // Spreadsheet apps execute cells that start with these characters. Prefix
  // with an apostrophe before RFC 4180 quoting so the text stays text.
  const text = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvMinor(minor: number): string {
  return (minor / 100).toFixed(2);
}

/** Stable CSV for the report page; amounts are plain decimals, not currency symbols. */
export function reportCsv(report: MonthlyReport): string {
  const lines: string[] = [
    ['Monthly report', report.label].map(csvCell).join(','),
    ['Period', report.start, report.end].map(csvCell).join(','),
    ['Currency', report.currency].map(csvCell).join(','),
    '',
    'Summary',
    'Metric,Amount',
    ['Income', csvMinor(report.incomeMinor)].join(','),
    ['Spend', csvMinor(report.spendMinor)].join(','),
    ['Net', csvMinor(report.netMinor)].join(','),
    '',
    'In and out by category',
    'Type,Category,In,Out,Count',
  ];
  for (const row of report.byCategory) {
    lines.push([
      row.kind,
      row.key,
      csvMinor(row.inMinor),
      csvMinor(row.outMinor),
      row.count,
    ].map(csvCell).join(','));
  }
  lines.push('', 'Top merchants', 'Merchant,Spend,Count,Share %');
  for (const merchant of report.topMerchants) {
    lines.push([
      merchant.merchant,
      csvMinor(merchant.spendMinor),
      merchant.count,
      merchant.sharePct,
    ].map(csvCell).join(','));
  }
  lines.push('', 'Month over month', 'Metric,Previous,Current,Change %');
  const change = (pct: number | null) => pct === null ? '' : pct;
  lines.push(['Income', csvMinor(report.previous.incomeMinor), csvMinor(report.incomeMinor), change(report.change.incomePct)].map(csvCell).join(','));
  lines.push(['Spend', csvMinor(report.previous.spendMinor), csvMinor(report.spendMinor), change(report.change.spendPct)].map(csvCell).join(','));
  lines.push(['Net', csvMinor(report.previous.netMinor), csvMinor(report.netMinor), change(report.change.netPct)].map(csvCell).join(','));
  return `${lines.join('\n')}\n`;
}
