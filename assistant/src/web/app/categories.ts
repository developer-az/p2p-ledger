import type { SpendCategory } from '../api.js';

export interface CategoryMeta {
  label: string;
  emoji: string;
  color: string;
}

/**
 * Category colours are a monochrome ramp, not a rainbow — the house palette only
 * allows one metal (chrome), so categories are distinguished by weight, not hue.
 * Values are CSS expressions over theme tokens, so the ramp inverts with the
 * theme automatically (ink on porcelain / porcelain on obsidian).
 */
export const CATEGORY_META: Record<SpendCategory, CategoryMeta> = {
  dining: { label: 'Dining', emoji: '🍜', color: 'var(--ink)' },
  groceries: { label: 'Groceries', emoji: '🛒', color: 'color-mix(in srgb, var(--ink) 74%, var(--surface))' },
  transport: { label: 'Transport', emoji: '🚌', color: 'color-mix(in srgb, var(--ink) 60%, var(--surface))' },
  entertainment: { label: 'Fun', emoji: '🎟️', color: 'color-mix(in srgb, var(--ink) 48%, var(--surface))' },
  housing: { label: 'Housing', emoji: '🏠', color: 'color-mix(in srgb, var(--ink) 38%, var(--surface))' },
  shopping: { label: 'Shopping', emoji: '🛍️', color: 'color-mix(in srgb, var(--ink) 30%, var(--surface))' },
  health: { label: 'Health', emoji: '💊', color: 'color-mix(in srgb, var(--ink) 22%, var(--surface))' },
  other: { label: 'Other', emoji: '✨', color: 'color-mix(in srgb, var(--ink) 14%, var(--surface))' },
};

export function categoryMeta(category: string): CategoryMeta {
  return CATEGORY_META[category as SpendCategory] ?? CATEGORY_META.other;
}

export function categoryLabel(category: string): string {
  return categoryMeta(category).label;
}
