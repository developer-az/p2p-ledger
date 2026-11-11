import type { SpendCategory } from '../api.js';

export interface CategoryMeta {
  label: string;
  /** A CSS custom property reference; the value lives in styles/tokens.css. */
  color: string;
}

/**
 * Chart palette: hues spaced ~45° apart so donut segments stay easy to tell apart
 * (avoids red/orange and green/teal pairs that looked alike on the wheel). The
 * values are tokens, `--cat-<id>`, with a light and a dark cut.
 */
export const CATEGORY_META: Record<SpendCategory, CategoryMeta> = {
  dining: { label: 'Dining', color: 'var(--cat-dining)' },
  groceries: { label: 'Groceries', color: 'var(--cat-groceries)' },
  transport: { label: 'Transport', color: 'var(--cat-transport)' },
  entertainment: { label: 'Fun', color: 'var(--cat-entertainment)' },
  housing: { label: 'Housing', color: 'var(--cat-housing)' },
  shopping: { label: 'Shopping', color: 'var(--cat-shopping)' },
  health: { label: 'Health', color: 'var(--cat-health)' },
  other: { label: 'Other', color: 'var(--cat-other)' },
};

export function categoryMeta(category: string): CategoryMeta {
  return CATEGORY_META[category as SpendCategory] ?? CATEGORY_META.other;
}

export function categoryLabel(category: string): string {
  return categoryMeta(category).label;
}
