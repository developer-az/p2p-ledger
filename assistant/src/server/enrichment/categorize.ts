import type { SpendCategory, SpendSource } from '../spend-log.js';
import { cleanDescriptor } from './descriptor.js';
import {
  resolveMerchant,
  type MerchantMethod,
  type MerchantRecord,
} from './merchants.js';

/**
 * The categorization cascade, in the order a person expects:
 *
 *   1. an explicit correction (manual category or a "this is not Starbucks" fix)
 *   2. an active user rule, newest version first
 *   3. the merchant's default category
 *   4. a keyword rule for descriptors nobody can resolve
 *   5. "other", visibly unresolved so the rules page can ask for a fix
 *
 * Every result carries its source. Nothing is guessed silently, and no model is
 * involved: the free version has to work offline and explain itself.
 */

export type CategorySource =
  | 'user_rule'
  | 'user_correction'
  | 'merchant_default'
  | 'keyword'
  | 'manual'
  | 'unresolved';

export type RuleStatus = 'active' | 'archived';

export interface UserRule {
  /** Version-row id, unique across the account. */
  id: string;
  /** Stable rule id shared by every version. */
  ruleId: string;
  accountId: string;
  merchantContains: string;
  /** Strict upper bound in minor units; null means no amount condition. */
  maxAmountMinor: number | null;
  category: SpendCategory;
  version: number;
  status: RuleStatus;
  createdAt: string;
}

export interface RuleDraft {
  merchantContains: string;
  maxAmountMinor: number | null;
  category: SpendCategory;
}

export interface NormalizedTransaction {
  id: string;
  accountId: string;
  amountMinor: number;
  /** Raw statement text or a person's note. */
  descriptor: string;
  occurredAt: string;
  /** The category stored by the ledger before enrichment, when there is one. */
  category: SpendCategory | null;
  source?: SpendSource;
}

export interface CategoryOverride {
  category: SpendCategory;
  source: CategorySource;
  ruleId: string | null;
  ruleVersion: number | null;
  merchantId: string | null;
}

export interface CascadeContext {
  merchants: readonly MerchantRecord[];
  rules: readonly UserRule[];
  override?: CategoryOverride | null;
  threshold?: number;
}

export interface EnrichmentResult {
  descriptorClean: string;
  merchant: MerchantRecord | null;
  merchantId: string | null;
  merchantName: string | null;
  merchantDomain: string | null;
  merchantMethod: MerchantMethod;
  merchantConfidence: number;
  merchantDefaultCategory: SpendCategory | null;
  category: SpendCategory;
  categorySource: CategorySource;
  ruleId: string | null;
  ruleVersion: number | null;
  matchedKeyword: string | null;
}

export interface RulePreviewRow {
  transactionId: string;
  descriptorClean: string;
  merchantName: string | null;
  amountMinor: number;
  occurredAt: string;
  previousCategory: SpendCategory | null;
  previousSource: CategorySource;
  category: SpendCategory;
}

export interface RulePreview {
  affected: number;
  /** Matches left alone because a person already categorized them. */
  skipped: number;
  transactions: RulePreviewRow[];
  byCategory: { category: SpendCategory; count: number; amountMinor: number }[];
}

interface KeywordRule {
  keyword: string;
  category: SpendCategory;
}

const KEYWORD_RULES: KeywordRule[] = [
  { keyword: 'PIZZA', category: 'dining' },
  { keyword: 'COFFEE', category: 'dining' },
  { keyword: 'CAFE', category: 'dining' },
  { keyword: 'RESTAURANT', category: 'dining' },
  { keyword: 'BURGER', category: 'dining' },
  { keyword: 'TACO', category: 'dining' },
  { keyword: 'SUSHI', category: 'dining' },
  { keyword: 'BAKERY', category: 'dining' },
  { keyword: 'GROCERY', category: 'groceries' },
  { keyword: 'SUPERMARKET', category: 'groceries' },
  { keyword: 'FOODS', category: 'groceries' },
  { keyword: 'GAS', category: 'transport' },
  { keyword: 'FUEL', category: 'transport' },
  { keyword: 'PARKING', category: 'transport' },
  { keyword: 'TOLL', category: 'transport' },
  { keyword: 'TRANSIT', category: 'transport' },
  { keyword: 'AIRLINE', category: 'transport' },
  { keyword: 'HOTEL', category: 'entertainment' },
  { keyword: 'CINEMA', category: 'entertainment' },
  { keyword: 'THEATER', category: 'entertainment' },
  { keyword: 'THEATRE', category: 'entertainment' },
  { keyword: 'MOVIE', category: 'entertainment' },
  { keyword: 'MUSIC', category: 'entertainment' },
  { keyword: 'PHARMACY', category: 'health' },
  { keyword: 'CLINIC', category: 'health' },
  { keyword: 'DENTAL', category: 'health' },
  { keyword: 'MEDICAL', category: 'health' },
  { keyword: 'RENT', category: 'housing' },
  { keyword: 'UTILITY', category: 'housing' },
  { keyword: 'ELECTRIC', category: 'housing' },
  { keyword: 'INTERNET', category: 'housing' },
  { keyword: 'WIRELESS', category: 'housing' },
  { keyword: 'BOOK', category: 'shopping' },
  { keyword: 'MART', category: 'shopping' },
  { keyword: 'SHOP', category: 'shopping' },
];

/** Longest keyword wins, so a more specific phrase is not shadowed by a short one. */
const KEYWORDS_BY_LENGTH = [...KEYWORD_RULES].sort((a, b) => b.keyword.length - a.keyword.length);

function normalizedNeedle(value: string): string {
  return cleanDescriptor(value);
}

function ruleCandidates(tx: NormalizedTransaction, merchant: MerchantRecord | null): string[] {
  const clean = cleanDescriptor(tx.descriptor);
  const values = [clean, tx.descriptor];
  if (merchant) values.push(merchant.name, ...merchant.aliases);
  return values.map(normalizedNeedle).filter(Boolean);
}

/** True when the rule's merchant text appears in the descriptor or resolved merchant. */
export function ruleMatches(
  rule: UserRule,
  tx: NormalizedTransaction,
  merchant: MerchantRecord | null,
): boolean {
  if (rule.status !== 'active') return false;
  const needle = normalizedNeedle(rule.merchantContains);
  if (!needle) return false;
  if (!ruleCandidates(tx, merchant).some((candidate) => candidate.includes(needle))) return false;
  return rule.maxAmountMinor === null || tx.amountMinor < rule.maxAmountMinor;
}

export function keywordCategory(clean: string): KeywordRule | null {
  for (const rule of KEYWORDS_BY_LENGTH) {
    if (clean.includes(rule.keyword)) return rule;
  }
  return null;
}

function activeRulesNewestFirst(rules: readonly UserRule[]): UserRule[] {
  return rules
    .filter((rule) => rule.status === 'active')
    .sort((a, b) => b.version - a.version || b.createdAt.localeCompare(a.createdAt));
}

function resultFor(
  descriptorClean: string,
  merchant: ReturnType<typeof resolveMerchant>,
  override: CategoryOverride | null | undefined,
  rule: UserRule | null,
  keyword: KeywordRule | null,
): EnrichmentResult {
  const base = {
    descriptorClean,
    merchant: merchant.merchant,
    merchantId: merchant.merchant?.id ?? null,
    merchantName: merchant.merchant?.name ?? null,
    merchantDomain: merchant.merchant?.domain ?? null,
    merchantMethod: merchant.method,
    merchantConfidence: merchant.confidence,
    merchantDefaultCategory: merchant.merchant?.defaultCategory ?? null,
    matchedKeyword: keyword?.keyword ?? null,
  };
  if (override) {
    return {
      ...base,
      category: override.category,
      categorySource: override.source,
      ruleId: override.ruleId,
      ruleVersion: override.ruleVersion,
    };
  }
  if (rule) {
    return {
      ...base,
      category: rule.category,
      categorySource: 'user_rule',
      ruleId: rule.ruleId,
      ruleVersion: rule.version,
    };
  }
  if (merchant.merchant?.defaultCategory) {
    return {
      ...base,
      category: merchant.merchant.defaultCategory,
      categorySource: 'merchant_default',
      ruleId: null,
      ruleVersion: null,
    };
  }
  if (keyword) {
    return {
      ...base,
      category: keyword.category,
      categorySource: 'keyword',
      ruleId: null,
      ruleVersion: null,
    };
  }
  return {
    ...base,
    category: 'other',
    categorySource: 'unresolved',
    ruleId: null,
    ruleVersion: null,
  };
}

/** Run one descriptor through the full cascade. Pure: callers can preview freely. */
export function applyCascade(tx: NormalizedTransaction, context: CascadeContext): EnrichmentResult {
  const clean = cleanDescriptor(tx.descriptor);
  const merchant = resolveMerchant(clean, context.merchants, { threshold: context.threshold });
  const rule = activeRulesNewestFirst(context.rules)
    .find((candidate) => ruleMatches(candidate, tx, merchant.merchant)) ?? null;
  const keyword = keywordCategory(clean);
  return resultFor(clean, merchant, context.override, rule, keyword);
}

/** Dry run of one rule over a normalized list. Does not write anything. */
export function previewRule(
  rule: Pick<UserRule, 'merchantContains' | 'maxAmountMinor' | 'category' | 'status'>,
  transactions: readonly NormalizedTransaction[],
  merchants: readonly MerchantRecord[],
  context: { rules?: readonly UserRule[]; overrides?: ReadonlyMap<string, CategoryOverride> } = {},
): RulePreview {
  const rows: RulePreviewRow[] = [];
  let skipped = 0;
  const wholeRule = 'accountId' in rule
    ? rule as UserRule
    : {
        ...rule,
        id: 'preview',
        ruleId: 'preview',
        accountId: '',
        version: 1,
        createdAt: '',
      } as UserRule;

  for (const tx of transactions) {
    const merchant = resolveMerchant(tx.descriptor, merchants);
    if (!ruleMatches(wholeRule, tx, merchant.merchant)) continue;
    const override = context.overrides?.get(tx.id) ?? null;
    // Applying the rule refuses to overwrite a manual category or a correction.
    // The preview must not promise those rows either, or the apply count drops
    // without explanation.
    if (override?.source === 'manual' || override?.source === 'user_correction') {
      skipped += 1;
      continue;
    }
    const before = applyCascade(tx, {
      merchants,
      rules: context.rules ?? [],
      override,
    });
    rows.push({
      transactionId: tx.id,
      descriptorClean: before.descriptorClean,
      merchantName: before.merchantName,
      amountMinor: tx.amountMinor,
      occurredAt: tx.occurredAt,
      previousCategory: tx.category,
      previousSource: before.categorySource,
      category: wholeRule.category,
    });
  }

  const totals = new Map<SpendCategory, { count: number; amountMinor: number }>();
  for (const row of rows) {
    const current = totals.get(row.category) ?? { count: 0, amountMinor: 0 };
    current.count += 1;
    current.amountMinor += row.amountMinor;
    totals.set(row.category, current);
  }
  return {
    affected: rows.length,
    skipped,
    transactions: rows,
    byCategory: [...totals.entries()].map(([category, value]) => ({ category, ...value })),
  };
}
