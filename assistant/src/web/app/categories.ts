import type { SpendCategory } from '../api.js';

export interface CategoryMeta {
  label: string;
  emoji: string;
  color: string;
}

/**
 * Chart palette: hues spaced ~45° apart so donut segments stay easy to tell apart
 * (avoids red/orange and green/teal pairs that looked alike on the wheel).
 */
export const CATEGORY_META: Record<SpendCategory, CategoryMeta> = {
  dining: { label: 'Dining', emoji: '🍜', color: '#d55e00' },
  groceries: { label: 'Groceries', emoji: '🛒', color: '#009e73' },
  transport: { label: 'Transport', emoji: '🚌', color: '#0072b2' },
  entertainment: { label: 'Fun', emoji: '🎟️', color: '#cc79a7' },
  housing: { label: 'Housing', emoji: '🏠', color: '#e69f00' },
  shopping: { label: 'Shopping', emoji: '🛍️', color: '#56b4e9' },
  health: { label: 'Health', emoji: '💊', color: '#785ef0' },
  other: { label: 'Other', emoji: '✨', color: '#64748b' },
};

export function categoryMeta(category: string): CategoryMeta {
  return CATEGORY_META[category as SpendCategory] ?? CATEGORY_META.other;
}

export function categoryLabel(category: string): string {
  return categoryMeta(category).label;
}
