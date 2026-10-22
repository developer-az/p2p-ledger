import type { SpendCategory } from '../api.js';

export interface CategoryMeta {
  label: string;
  emoji: string;
  color: string;
}

/** Distinct hues for charts and legends (donut, peek, Patterns). */
export const CATEGORY_META: Record<SpendCategory, CategoryMeta> = {
  dining: { label: 'Dining', emoji: '🍜', color: '#d94f3d' },
  groceries: { label: 'Groceries', emoji: '🛒', color: '#2f9e55' },
  transport: { label: 'Transport', emoji: '🚌', color: '#3b7fd4' },
  entertainment: { label: 'Fun', emoji: '🎟️', color: '#9b59e8' },
  housing: { label: 'Housing', emoji: '🏠', color: '#c9922a' },
  shopping: { label: 'Shopping', emoji: '🛍️', color: '#e06b9a' },
  health: { label: 'Health', emoji: '💊', color: '#1fad9b' },
  other: { label: 'Other', emoji: '✨', color: '#8a8f98' },
};

export function categoryMeta(category: string): CategoryMeta {
  return CATEGORY_META[category as SpendCategory] ?? CATEGORY_META.other;
}

export function categoryLabel(category: string): string {
  return categoryMeta(category).label;
}
