import type { SpendCategory } from '../api.js';
import type { FeedKind } from './feed.js';
import type { IconName } from './ui.js';

export interface CategoryMeta {
  label: string;
  /** A CSS custom property reference; the value lives in styles/tokens.css. */
  color: string;
  /** Glyph for the row avatar and the category picker. */
  icon: IconName;
}

/**
 * The one category map. Rows, tags, glyphs, pickers and the Top categories bars
 * all read their colour and icon from here, and every colour is a token from
 * styles/tokens.css. Tag and glyph ink is mixed from the category colour toward
 * --ink in views.css, which keeps 12px labels above 4.5:1 in both themes (the
 * raw light hues do not: dining, housing and shopping land near 4:1).
 */
export const CATEGORY_META: Record<SpendCategory, CategoryMeta> = {
  dining: { label: 'Dining', color: 'var(--cat-dining)', icon: 'coffee' },
  groceries: { label: 'Groceries', color: 'var(--cat-groceries)', icon: 'list' },
  transport: { label: 'Transport', color: 'var(--cat-transport)', icon: 'swap' },
  entertainment: { label: 'Fun', color: 'var(--cat-entertainment)', icon: 'smile' },
  housing: { label: 'Housing', color: 'var(--cat-housing)', icon: 'home' },
  shopping: { label: 'Shopping', color: 'var(--cat-shopping)', icon: 'card' },
  health: { label: 'Health', color: 'var(--cat-health)', icon: 'shield' },
  other: { label: 'Other', color: 'var(--cat-other)', icon: 'file' },
};

/** Income log sources are not spend categories; they use the money-in tone. */
export const INCOME_SOURCE_LABELS: Record<string, string> = {
  salary: 'Salary',
  freelance: 'Freelance',
  gift: 'Gift',
  refund: 'Refund',
  other: 'Other',
};

export function categoryMeta(category: string): CategoryMeta {
  return CATEGORY_META[category as SpendCategory] ?? CATEGORY_META.other;
}

export function categoryLabel(category: string): string {
  return categoryMeta(category).label;
}

export function categoryIcon(category: string): IconName {
  return categoryMeta(category).icon;
}

export function incomeSourceLabel(source: string): string {
  return INCOME_SOURCE_LABELS[source] ?? categoryLabel(source);
}

export interface GlyphMeta {
  icon: IconName;
  /** CSS token; the glyph is tinted with this colour. */
  color: string;
}

/**
 * The leading row glyph. Logged spending takes the category icon, income takes
 * the bank/income glyph on the positive tone, and a plain ledger movement takes
 * the send glyph. Unknown input falls back to the first letter in FeedList. The
 * shipped category set has no "bills" bucket; receipts and bills land in Other,
 * which uses the file glyph.
 */
export function feedGlyph(kind: FeedKind, category?: string): GlyphMeta | null {
  if (kind === 'deposit' || kind === 'received') return { icon: 'bank', color: 'var(--pos)' };
  if (kind === 'income') return { icon: 'income', color: 'var(--pos)' };
  if (kind === 'sent') return { icon: 'send', color: 'var(--ink)' };
  if (kind === 'declined') return { icon: 'alert', color: 'var(--neg)' };
  if (!category) return null;
  const meta = CATEGORY_META[category as SpendCategory];
  return meta ? { icon: meta.icon, color: meta.color } : null;
}
