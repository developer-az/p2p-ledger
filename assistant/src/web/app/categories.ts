import type { SpendCategory } from '../api.js';

export interface CategoryMeta {
  label: string;
  emoji: string;
  color: string;
}

export const CATEGORY_META: Record<SpendCategory, CategoryMeta> = {
  dining: { label: 'Dining', emoji: '🍜', color: '#ff8a5b' },
  groceries: { label: 'Groceries', emoji: '🛒', color: '#8ed081' },
  transport: { label: 'Transport', emoji: '🚌', color: '#7cc4ff' },
  entertainment: { label: 'Fun', emoji: '🎟️', color: '#c9b8ff' },
  housing: { label: 'Housing', emoji: '🏠', color: '#ffd166' },
  shopping: { label: 'Shopping', emoji: '🛍️', color: '#ff9fb2' },
  health: { label: 'Health', emoji: '💊', color: '#6ee7b7' },
  other: { label: 'Other', emoji: '✨', color: '#b8b8b8' },
};

export function categoryMeta(category: string): CategoryMeta {
  return CATEGORY_META[category as SpendCategory] ?? CATEGORY_META.other;
}

export function categoryLabel(category: string): string {
  return categoryMeta(category).label;
}
