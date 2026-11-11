/**
 * Normalized transaction view used by the subscription/spending detector.
 *
 * Imported rows and manually logged spends become one list with positive
 * expense amounts, signed income, a category and a stable source. M3 only feeds
 * the existing detector, but future transaction-level detectors can consume
 * this shape without knowing whether a row came from a CSV, OFX or the user.
 */
import type { IncomeLogEntry } from './personal-finance.js';
import type { SpendCategory, SpendLogEntry } from './spend-log.js';
import { SPEND_CATEGORIES } from './spend-log.js';
import type { StoredImportTransaction } from './imports-store.js';

export interface NormalizedTransaction {
  id: string;
  accountId: string;
  source: 'logged' | 'imported';
  kind: 'expense' | 'income';
  amountMinor: number;
  signedAmountMinor: number;
  currency: string;
  category: SpendCategory;
  description: string;
  occurredAt: string;
  importId?: string;
}

function categoryOrOther(value: string): SpendCategory {
  return (SPEND_CATEGORIES as readonly string[]).includes(value)
    ? value as SpendCategory
    : 'other';
}

export function normalizeImportTransactions(rows: readonly StoredImportTransaction[]): NormalizedTransaction[] {
  return rows.map((row) => ({
    id: row.id,
    accountId: row.accountId,
    source: 'imported',
    kind: row.amountMinor < 0 ? 'expense' : 'income',
    amountMinor: Math.abs(row.amountMinor),
    signedAmountMinor: row.amountMinor,
    currency: row.currency,
    category: categoryOrOther(row.categoryId),
    description: row.descriptorClean,
    occurredAt: `${row.postedDate}T12:00:00.000Z`,
    importId: row.importId,
  }));
}

export function normalizeTransactionList(input: {
  spends: readonly SpendLogEntry[];
  incomes: readonly IncomeLogEntry[];
  imports: readonly StoredImportTransaction[];
}): NormalizedTransaction[] {
  const logged = input.spends.map((spend) => ({
    id: spend.id,
    accountId: spend.accountId,
    source: 'logged' as const,
    kind: 'expense' as const,
    amountMinor: spend.amountMinor,
    signedAmountMinor: -spend.amountMinor,
    currency: spend.currency,
    category: spend.category,
    description: spend.note?.trim() ? spend.note : spend.category,
    occurredAt: spend.occurredAt,
  }));
  const income = input.incomes.map((entry) => ({
    id: entry.id,
    accountId: entry.accountId,
    source: 'logged' as const,
    kind: 'income' as const,
    amountMinor: entry.amountMinor,
    signedAmountMinor: entry.amountMinor,
    currency: entry.currency,
    category: 'other' as const,
    description: entry.note?.trim() ? entry.note : entry.source,
    occurredAt: entry.occurredAt,
  }));
  return [...logged, ...income, ...normalizeImportTransactions(input.imports)]
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

/** The existing detector consumes SpendLogEntry; imported expenses fit it. */
export function importedTransactionsToSpendEntries(rows: readonly StoredImportTransaction[]): SpendLogEntry[] {
  return rows
    .filter((row) => row.amountMinor < 0)
    .map((row) => ({
      id: row.id,
      accountId: row.accountId,
      amountMinor: Math.abs(row.amountMinor),
      currency: row.currency,
      category: categoryOrOther(row.categoryId),
      note: row.descriptorClean,
      occurredAt: `${row.postedDate}T12:00:00.000Z`,
      source: 'import',
      createdAt: row.createdAt,
    }));
}
