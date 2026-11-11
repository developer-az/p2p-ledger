import type { SpendLogEntry } from './spend-log.js';

/**
 * Recurring-stream detection over a normalized transaction list.
 *
 * Spend logs are the first source; statement imports can hand the same shape
 * to `detectSubscriptions` once they land. The detector is deliberately
 * conservative: a merchant becomes an active stream only when its billing
 * intervals fit one cadence, the amounts stay stable, and the latest charge is
 * recent. A single charge or a trial that has not repeated stays a candidate
 * and never enters the run-rate.
 */

export type SubscriptionCadence = 'weekly' | 'monthly' | 'quarterly' | 'annual';

export interface NormalizedTransaction {
  id: string;
  /** Display name after cleaning the descriptor. */
  merchant: string;
  /** Grouping key: cleaned descriptor, without card numbers or store ids. */
  merchantKey: string;
  /** Known service key when the descriptor matches a common subscription. */
  serviceKey: string | null;
  serviceName: string | null;
  category: string;
  amountMinor: number;
  occurredAt: string;
}

export interface SubscriptionCharge {
  id: string;
  occurredAt: string;
  amountMinor: number;
}

export interface SubscriptionPriceChange {
  fromMinor: number;
  toMinor: number;
  pct: number;
  occurredAt: string;
}

export interface SubscriptionStream {
  id: string;
  merchant: string;
  serviceKey: string | null;
  serviceName: string | null;
  category: string;
  cadence: SubscriptionCadence;
  /** Latest billed amount; trials are excluded when a full charge exists. */
  amountMinor: number;
  monthlyMinor: number;
  annualMinor: number;
  lastChargeAt: string;
  nextChargeAt: string;
  charges: SubscriptionCharge[];
  priceHistory: SubscriptionCharge[];
  priceChange: SubscriptionPriceChange | null;
  priceCreep: boolean;
  confidence: number;
  trialToPaid: boolean;
  trialChargeMinor: number | null;
  markedToCancel: boolean;
  markedAt: string | null;
}

export interface SubscriptionCandidate {
  id: string;
  merchant: string;
  serviceKey: string | null;
  serviceName: string | null;
  category: string;
  amountMinor: number;
  occurredAt: string;
  reason: 'single_charge' | 'unverified_cadence';
  trialToPaid: boolean;
  trialChargeMinor: number | null;
  nextChargeAt: string | null;
}

export interface DuplicateSubscription {
  serviceKey: string;
  serviceName: string;
  streamIds: string[];
  monthlyMinor: number;
  annualMinor: number;
}

export interface SubscriptionTotals {
  activeCount: number;
  monthlyRunRateMinor: number;
  annualRunRateMinor: number;
  candidateCount: number;
  duplicateCount: number;
}

export interface SubscriptionReport {
  generatedAt: string;
  streams: SubscriptionStream[];
  candidates: SubscriptionCandidate[];
  duplicates: DuplicateSubscription[];
  totals: SubscriptionTotals;
}

export interface SubscriptionMark {
  accountId: string;
  streamId: string;
  markedToCancel: boolean;
  markedAt: string;
}

interface KnownService {
  key: string;
  name: string;
  aliases: string[];
}

const KNOWN_SERVICES: KnownService[] = [
  { key: 'netflix', name: 'Netflix', aliases: ['netflix', 'nflx'] },
  { key: 'spotify', name: 'Spotify', aliases: ['spotify'] },
  { key: 'icloud', name: 'iCloud+', aliases: ['icloud', 'icloud+', 'apple icloud', 'apple com bill'] },
  { key: 'adobe', name: 'Adobe Creative Cloud', aliases: ['adobe', 'adobe creative cloud', 'adobe systems'] },
  { key: 'hulu', name: 'Hulu', aliases: ['hulu'] },
  { key: 'audible', name: 'Audible', aliases: ['audible'] },
  { key: 'disney', name: 'Disney+', aliases: ['disney', 'disney+', 'disney plus'] },
  { key: 'youtube', name: 'YouTube Premium', aliases: ['youtube', 'youtube premium', 'youtube music'] },
  { key: 'amazon', name: 'Amazon Prime', aliases: ['amazon prime', 'amzn prime', 'prime video'] },
  { key: 'nytimes', name: 'The New York Times', aliases: ['new york times', 'nytimes', 'nyt'] },
  { key: 'chatgpt', name: 'ChatGPT Plus', aliases: ['chatgpt', 'openai', 'chatgpt plus'] },
  { key: 'dropbox', name: 'Dropbox', aliases: ['dropbox'] },
  { key: 'notion', name: 'Notion', aliases: ['notion', 'notion labs'] },
  { key: 'github', name: 'GitHub', aliases: ['github'] },
];

const DAY_MS = 86_400_000;

const CADENCE_RULES: Record<SubscriptionCadence, {
  minCharges: number;
  minDays: number;
  maxDays: number;
  freshnessDays: number;
}> = {
  weekly: { minCharges: 3, minDays: 5, maxDays: 9, freshnessDays: 21 },
  monthly: { minCharges: 3, minDays: 25, maxDays: 36, freshnessDays: 50 },
  quarterly: { minCharges: 3, minDays: 84, maxDays: 100, freshnessDays: 130 },
  annual: { minCharges: 2, minDays: 350, maxDays: 380, freshnessDays: 400 },
};

const CADENCE_ORDER: SubscriptionCadence[] = ['weekly', 'monthly', 'quarterly', 'annual'];

function normalizeDescriptor(value: string): string {
  return value
    .toLowerCase()
    .replace(/^(sq|tst|paypal|amzn mktp|pos debit|purchase)\s*[*#-]?\s*/, '')
    .replace(/\b\d{4,}\b/g, ' ')
    .replace(/#\d+/g, ' ')
    .replace(/[^a-z0-9+&.' -]/g, ' ')
    .replace(/\b(com|www|inc|llc|ltd)\b/g, ' ')
    .replace(/[.'']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCase(value: string): string {
  return value
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function serviceForMerchant(key: string): KnownService | null {
  for (const service of KNOWN_SERVICES) {
    for (const alias of service.aliases) {
      const normalized = normalizeDescriptor(alias);
      if (key === normalized || key.startsWith(`${normalized} `) || key.endsWith(` ${normalized}`)) {
        return service;
      }
    }
  }
  return null;
}

function merchantForDescriptor(clean: string, service: KnownService | null): string {
  const key = normalizeDescriptor(clean);
  if (service && service.aliases.some((alias) => normalizeDescriptor(alias) === key)) return service.name;
  return titleCase(clean);
}

/** Normalize logged spends (or future statement rows) into merchant-keyed transactions. */
export function normalizeSpendTransactions(spends: SpendLogEntry[]): NormalizedTransaction[] {
  const rows: NormalizedTransaction[] = [];
  for (const entry of spends) {
    if (!entry.note || entry.amountMinor <= 0) continue;
    const clean = normalizeDescriptor(entry.note);
    if (!clean) continue;
    const service = serviceForMerchant(clean);
    rows.push({
      id: entry.id,
      merchant: merchantForDescriptor(entry.note, service),
      merchantKey: clean,
      serviceKey: service?.key ?? null,
      serviceName: service?.name ?? null,
      category: entry.category,
      amountMinor: entry.amountMinor,
      occurredAt: entry.occurredAt,
    });
  }
  return rows;
}

function timestamp(iso: string): number {
  const value = new Date(iso).getTime();
  return Number.isNaN(value) ? 0 : value;
}

function dayGap(a: string, b: string): number {
  return Math.round((timestamp(b) - timestamp(a)) / DAY_MS);
}

function toCharge(transaction: NormalizedTransaction): SubscriptionCharge {
  return { id: transaction.id, occurredAt: transaction.occurredAt, amountMinor: transaction.amountMinor };
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const daysInMonth = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, daysInMonth));
  return next;
}

function addCadence(date: Date, cadence: SubscriptionCadence): Date {
  if (cadence === 'weekly') return new Date(date.getTime() + 7 * DAY_MS);
  if (cadence === 'monthly') return addMonths(date, 1);
  if (cadence === 'quarterly') return addMonths(date, 3);
  return addMonths(date, 12);
}

function nextChargeAfter(lastIso: string, cadence: SubscriptionCadence, now: Date): string {
  let next = addCadence(new Date(lastIso), cadence);
  for (let guard = 0; guard < 24 && next.getTime() < now.getTime(); guard += 1) {
    next = addCadence(next, cadence);
  }
  return next.toISOString();
}

function inferCadence(charges: SubscriptionCharge[], requireMinimum = true): SubscriptionCadence | null {
  if (charges.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < charges.length; i += 1) gaps.push(dayGap(charges[i - 1]!.occurredAt, charges[i]!.occurredAt));
  for (const cadence of CADENCE_ORDER) {
    const rule = CADENCE_RULES[cadence];
    if (requireMinimum && charges.length < rule.minCharges) continue;
    if (gaps.every((gap) => gap >= rule.minDays && gap <= rule.maxDays)) return cadence;
  }
  return null;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
}

function isStable(charges: SubscriptionCharge[]): boolean {
  if (charges.length <= 1) return true;
  const center = median(charges.map((charge) => charge.amountMinor));
  if (center <= 0) return false;
  return charges.every((charge) => charge.amountMinor >= center * 0.4 && charge.amountMinor <= center * 1.6);
}

function billingCharges(charges: SubscriptionCharge[]): SubscriptionCharge[] {
  const full = charges.filter((charge) => charge.amountMinor > 100);
  return full.length >= 2 ? full : charges;
}

function detectTrial(charges: SubscriptionCharge[]): { trialChargeMinor: number; paidAt: string } | null {
  for (const charge of charges) {
    if (charge.amountMinor > 100) continue;
    const paid = charges.find((later) => (
      timestamp(later.occurredAt) > timestamp(charge.occurredAt)
      && later.amountMinor >= Math.max(500, charge.amountMinor * 5)
      && dayGap(charge.occurredAt, later.occurredAt) <= 60
    ));
    if (paid) return { trialChargeMinor: charge.amountMinor, paidAt: paid.occurredAt };
  }
  return null;
}

function findPriceChange(charges: SubscriptionCharge[]): SubscriptionPriceChange | null {
  let change: SubscriptionPriceChange | null = null;
  for (let i = 1; i < charges.length; i += 1) {
    const from = charges[i - 1]!;
    const to = charges[i]!;
    if (to.amountMinor === from.amountMinor) continue;
    change = {
      fromMinor: from.amountMinor,
      toMinor: to.amountMinor,
      pct: from.amountMinor > 0 ? Math.round(((to.amountMinor - from.amountMinor) / from.amountMinor) * 100) : 0,
      occurredAt: to.occurredAt,
    };
  }
  return change;
}

function isFresh(cadence: SubscriptionCadence, lastChargeAt: string, now: Date): boolean {
  const ageDays = (now.getTime() - timestamp(lastChargeAt)) / DAY_MS;
  return ageDays >= -1 && ageDays <= CADENCE_RULES[cadence].freshnessDays;
}

function monthlyFor(cadence: SubscriptionCadence, amountMinor: number): number {
  if (cadence === 'weekly') return Math.round((amountMinor * 52) / 12);
  if (cadence === 'monthly') return amountMinor;
  if (cadence === 'quarterly') return Math.round(amountMinor / 3);
  return Math.round(amountMinor / 12);
}

function streamIdFor(merchantKey: string, cadence: SubscriptionCadence): string {
  const slug = merchantKey.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'stream';
  return `sub-${slug}-${cadence}`;
}

function candidateIdFor(merchantKey: string): string {
  const slug = merchantKey.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'candidate';
  return `candidate-${slug}`;
}

function looksLikeSubscription(merchantKey: string): boolean {
  return /(subscription|membership|monthly|annual|premium|plus|pro|plan|club|gym|cloud|music|video|fitness)/.test(merchantKey);
}

function withMarks(report: SubscriptionReport, marks: SubscriptionMark[]): SubscriptionReport {
  if (marks.length === 0) return report;
  const active = new Map(marks.filter((mark) => mark.markedToCancel).map((mark) => [mark.streamId, mark]));
  return {
    ...report,
    streams: report.streams.map((stream) => ({
      ...stream,
      markedToCancel: active.has(stream.id),
      markedAt: active.get(stream.id)?.markedAt ?? null,
    })),
  };
}

export function detectSubscriptions(transactions: NormalizedTransaction[], now: Date): SubscriptionReport {
  const groups = new Map<string, NormalizedTransaction[]>();
  for (const transaction of transactions) {
    if (timestamp(transaction.occurredAt) > now.getTime() + DAY_MS) continue;
    const rows = groups.get(transaction.merchantKey);
    if (rows) rows.push(transaction);
    else groups.set(transaction.merchantKey, [transaction]);
  }

  const streams: SubscriptionStream[] = [];
  const candidates: SubscriptionCandidate[] = [];

  for (const [merchantKey, rows] of groups) {
    const sorted = [...rows].sort((a, b) => timestamp(a.occurredAt) - timestamp(b.occurredAt));
    const charges = sorted.map(toCharge);
    const billed = billingCharges(charges);
    const cadence = inferCadence(billed);
    const trial = detectTrial(charges);
    const sample = sorted.at(-1)!;
    const lastCharge = billed.at(-1)!;

    if (cadence && isStable(billed) && isFresh(cadence, lastCharge.occurredAt, now)) {
      const amountMinor = lastCharge.amountMinor;
      const monthlyMinor = monthlyFor(cadence, amountMinor);
      const priceChange = findPriceChange(billed);
      streams.push({
        id: streamIdFor(merchantKey, cadence),
        merchant: sample.merchant,
        serviceKey: sample.serviceKey,
        serviceName: sample.serviceName,
        category: sample.category,
        cadence,
        amountMinor,
        monthlyMinor,
        annualMinor: monthlyMinor * 12,
        lastChargeAt: lastCharge.occurredAt,
        nextChargeAt: nextChargeAfter(lastCharge.occurredAt, cadence, now),
        charges,
        priceHistory: billed,
        priceChange,
        priceCreep: priceChange !== null && priceChange.toMinor > priceChange.fromMinor,
        confidence: Math.min(0.99, 0.55 + (sample.serviceKey ? 0.25 : 0) + Math.min(charges.length, 6) * 0.03),
        trialToPaid: trial !== null,
        trialChargeMinor: trial?.trialChargeMinor ?? null,
        markedToCancel: false,
        markedAt: null,
      });
      continue;
    }

    const knownOrPlausible = sample.serviceKey !== null || looksLikeSubscription(merchantKey);
    const reason: SubscriptionCandidate['reason'] = charges.length === 1 ? 'single_charge' : 'unverified_cadence';
    if (knownOrPlausible && (charges.length === 1 ? lastCharge.amountMinor >= 300 : true)) {
      const guessed = inferCadence(billed, false);
      candidates.push({
        id: candidateIdFor(merchantKey),
        merchant: sample.merchant,
        serviceKey: sample.serviceKey,
        serviceName: sample.serviceName,
        category: sample.category,
        amountMinor: lastCharge.amountMinor,
        occurredAt: lastCharge.occurredAt,
        reason,
        trialToPaid: trial !== null,
        trialChargeMinor: trial?.trialChargeMinor ?? null,
        nextChargeAt: guessed ? nextChargeAfter(lastCharge.occurredAt, guessed, now) : null,
      });
    }
  }

  streams.sort((a, b) => b.monthlyMinor - a.monthlyMinor || a.merchant.localeCompare(b.merchant));
  candidates.sort((a, b) => b.amountMinor - a.amountMinor || a.merchant.localeCompare(b.merchant));

  const duplicates: DuplicateSubscription[] = [];
  const byService = new Map<string, SubscriptionStream[]>();
  for (const stream of streams) {
    if (!stream.serviceKey) continue;
    const list = byService.get(stream.serviceKey);
    if (list) list.push(stream);
    else byService.set(stream.serviceKey, [stream]);
  }
  for (const [serviceKey, list] of byService) {
    if (list.length < 2) continue;
    const first = list[0]!;
    const monthlyMinor = list.reduce((sum, stream) => sum + stream.monthlyMinor, 0);
    duplicates.push({
      serviceKey,
      serviceName: first.serviceName ?? first.merchant,
      streamIds: list.map((stream) => stream.id),
      monthlyMinor,
      annualMinor: monthlyMinor * 12,
    });
  }
  duplicates.sort((a, b) => b.monthlyMinor - a.monthlyMinor || a.serviceName.localeCompare(b.serviceName));

  const monthlyRunRateMinor = streams.reduce((sum, stream) => sum + stream.monthlyMinor, 0);
  return {
    generatedAt: now.toISOString(),
    streams,
    candidates,
    duplicates,
    totals: {
      activeCount: streams.length,
      monthlyRunRateMinor,
      annualRunRateMinor: monthlyRunRateMinor * 12,
      candidateCount: candidates.length,
      duplicateCount: duplicates.length,
    },
  };
}

export function buildSubscriptionReport(
  spends: SpendLogEntry[],
  now: Date,
  marks: SubscriptionMark[] = [],
): SubscriptionReport {
  return withMarks(detectSubscriptions(normalizeSpendTransactions(spends), now), marks);
}
