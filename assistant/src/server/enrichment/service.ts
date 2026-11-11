import { formatMoney } from '../money.js';
import type { SpendCategory, SpendLogEntry, SpendSource } from '../spend-log.js';
import {
  applyCascade,
  previewRule,
  ruleMatches,
  type CategoryOverride,
  type EnrichmentResult,
  type NormalizedTransaction,
  type RulePreview,
  type UserRule,
} from './categorize.js';
import { cleanDescriptor } from './descriptor.js';
import {
  merchantByAlias,
  normalizeMerchantName,
  resolveMerchant,
  type MerchantRecord,
} from './merchants.js';
import type { EnrichmentStore } from './store.js';

/**
 * Wire the pure rules engine to a store and to ledger rows. M3 imports call
 * enrichSpendDraft() for every imported row; the manual spend route calls the
 * same function, so the two paths cannot drift apart.
 */

export interface SpendDraft {
  amountMinor: number;
  descriptor?: string | null;
  note?: string | null;
  occurredAt: string;
  source?: SpendSource;
  category?: SpendCategory | null;
}

export interface EnrichedSpendRow extends EnrichmentResult {
  id: string;
  amountMinor: number;
  amount: string;
  note: string | null;
  occurredAt: string;
  spendSource: SpendSource;
}

export interface RuleApplyResult {
  affected: number;
  skipped: number;
  overrides: CategoryOverride[];
}

export interface MerchantCorrectionInput {
  transactionId: string;
  merchantName: string;
  category?: SpendCategory | null;
}

export interface MerchantCorrectionResult {
  merchant: MerchantRecord;
  override: CategoryOverride;
  transaction: EnrichedSpendRow;
}

export interface EnrichedContext {
  merchants: MerchantRecord[];
  rules: UserRule[];
  overrides: Map<string, CategoryOverride>;
  descriptors: Map<string, string>;
}

export async function loadEnrichmentContext(
  store: EnrichmentStore,
  accountId: string,
): Promise<EnrichedContext> {
  const [merchants, rules, overrides, descriptors] = await Promise.all([
    store.listMerchants(accountId),
    store.listRules(accountId),
    store.getOverrides(accountId),
    store.getDescriptors(accountId),
  ]);
  return { merchants, rules, overrides, descriptors };
}

export function normalizeSpend(entry: SpendLogEntry, descriptor?: string | null): NormalizedTransaction {
  return {
    id: entry.id,
    accountId: entry.accountId,
    amountMinor: entry.amountMinor,
    descriptor: descriptor?.trim() || entry.descriptorClean || entry.note || '',
    occurredAt: entry.occurredAt,
    category: entry.category,
    source: entry.source,
  };
}

export function enrichedSpendRow(
  entry: SpendLogEntry,
  result: EnrichmentResult,
): EnrichedSpendRow {
  return {
    id: entry.id,
    amountMinor: entry.amountMinor,
    amount: formatMoney(entry.amountMinor, entry.currency),
    note: entry.note,
    occurredAt: entry.occurredAt,
    spendSource: entry.source,
    ...result,
  };
}

/** Enrich every row for a read view, applying stored corrections and rules. */
export async function enrichSpendEntries(
  store: EnrichmentStore,
  accountId: string,
  entries: readonly SpendLogEntry[],
): Promise<EnrichedSpendRow[]> {
  const context = await loadEnrichmentContext(store, accountId);
  return entries.map((entry) =>
    enrichedSpendRow(entry, applyCascade(normalizeSpend(entry, context.descriptors.get(entry.id)), {
      merchants: context.merchants,
      rules: context.rules,
      override: context.overrides.get(entry.id) ?? null,
    })),
  );
}

/**
 * Enrich one draft before it is stored. An explicit category wins as "manual";
 * the descriptor is still cleaned and the merchant resolved, so the row can be
 * corrected or audited later. No category means the cascade decides.
 */
export async function enrichSpendDraft(
  store: EnrichmentStore,
  accountId: string,
  draft: SpendDraft,
  now = new Date(),
  manualCategory?: SpendCategory | null,
): Promise<EnrichmentResult> {
  const context = await loadEnrichmentContext(store, accountId);
  const chosen = manualCategory ?? draft.category ?? null;
  const tx: NormalizedTransaction = {
    id: `draft-${now.getTime()}`,
    accountId,
    amountMinor: draft.amountMinor,
    descriptor: draft.descriptor ?? draft.note ?? '',
    occurredAt: draft.occurredAt,
    category: chosen,
    source: draft.source,
  };
  const override: CategoryOverride | null = chosen
    ? {
        category: chosen,
        source: 'manual',
        ruleId: null,
        ruleVersion: null,
        merchantId: null,
      }
    : null;
  return applyCascade(tx, {
    merchants: context.merchants,
    rules: context.rules,
    override,
  });
}

/** Dry run used by the Rules page; no writes, no hidden state. */
export async function previewRuleForAccount(
  store: EnrichmentStore,
  accountId: string,
  draft: Pick<UserRule, 'merchantContains' | 'maxAmountMinor' | 'category' | 'status'>,
  entries: readonly SpendLogEntry[],
): Promise<RulePreview> {
  const context = await loadEnrichmentContext(store, accountId);
  return previewRule(draft, entries.map((entry) => normalizeSpend(entry, context.descriptors.get(entry.id))), context.merchants, {
    rules: context.rules,
    overrides: context.overrides,
  });
}

/**
 * Write the rule's category onto every matching historical row as an override.
 * A person's explicit correction is never overwritten; newer rule applications
 * may replace an older rule's override.
 */
export async function applyRuleRetroactively(
  store: EnrichmentStore,
  accountId: string,
  rule: UserRule,
  entries: readonly SpendLogEntry[],
  now = new Date(),
): Promise<RuleApplyResult> {
  const context = await loadEnrichmentContext(store, accountId);
  let affected = 0;
  let skipped = 0;
  const overrides: CategoryOverride[] = [];
  for (const entry of entries) {
    const tx = normalizeSpend(entry, context.descriptors.get(entry.id));
    const merchant = resolveMerchant(tx.descriptor, context.merchants);
    if (!ruleMatches(rule, tx, merchant.merchant)) continue;
    const existing = context.overrides.get(entry.id);
    if (existing?.source === 'manual' || existing?.source === 'user_correction') {
      skipped += 1;
      continue;
    }
    const override: CategoryOverride = {
      category: rule.category,
      source: 'user_rule',
      ruleId: rule.ruleId,
      ruleVersion: rule.version,
      merchantId: merchant.merchant?.id ?? null,
    };
    await store.setOverride(accountId, entry.id, override, now);
    overrides.push(override);
    affected += 1;
  }
  return { affected, skipped, overrides };
}

/**
 * A correction does two things: it writes this transaction's category, and it
 * teaches the resolver the descriptor (and the merchant name) as an alias for
 * next time. Creating the merchant on demand keeps the flow one field long.
 */
export async function recordMerchantCorrection(
  store: EnrichmentStore,
  accountId: string,
  entries: readonly SpendLogEntry[],
  input: MerchantCorrectionInput,
  now = new Date(),
): Promise<MerchantCorrectionResult> {
  const entry = entries.find((row) => row.id === input.transactionId);
  if (!entry) throw new Error('Transaction not found');

  const merchants = await store.listMerchants(accountId);
  const descriptors = await store.getDescriptors(accountId);
  const wanted = input.merchantName.trim();
  const existing = merchantByAlias(merchants, wanted)
    ?? merchants.find((merchant) => normalizeMerchantName(merchant.name) === normalizeMerchantName(wanted))
    ?? null;
  const descriptor = descriptors.get(entry.id) ?? entry.descriptorClean ?? entry.note ?? '';
  const merchant = existing ?? await store.createMerchant(accountId, {
    name: wanted,
    defaultCategory: input.category ?? null,
    aliases: [wanted, cleanDescriptor(descriptor)].filter(Boolean),
  });
  if (existing) {
    // The corrected descriptor becomes the strongest possible signal.
    const clean = cleanDescriptor(descriptor);
    if (clean) await store.addAlias(accountId, existing.id, clean);
  }

  const category = input.category ?? merchant.defaultCategory ?? entry.category;
  const override: CategoryOverride = {
    category,
    source: 'user_correction',
    ruleId: null,
    ruleVersion: null,
    merchantId: merchant.id,
  };
  await store.setOverride(accountId, entry.id, override, now);

  const refreshed = await store.listMerchants(accountId);
  const resolved = refreshed.find((row) => row.id === merchant.id) ?? merchant;
  const result = applyCascade(normalizeSpend(entry, descriptor), {
    merchants: refreshed,
    rules: await store.listRules(accountId),
    override,
  });
  return {
    merchant: resolved,
    override,
    transaction: enrichedSpendRow(entry, result),
  };
}
