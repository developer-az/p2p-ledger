import type { SpendCategory } from '../api.js';
import type { IconName } from './ui.js';

export interface CategoryMeta {
  label: string;
  icon: IconName;
}

/**
 * Categories are told apart by name and icon, never by colour: every chart draws in the one
 * data hue (the card stock), so a category list reads the same in light, dark and greyscale.
 */
export const CATEGORY_META: Record<SpendCategory, CategoryMeta> = {
  dining: { label: 'Dining', icon: 'dining' },
  groceries: { label: 'Groceries', icon: 'cart' },
  transport: { label: 'Transport', icon: 'bus' },
  entertainment: { label: 'Fun', icon: 'ticket' },
  housing: { label: 'Housing', icon: 'home' },
  shopping: { label: 'Shopping', icon: 'bag' },
  health: { label: 'Health', icon: 'heart' },
  other: { label: 'Other', icon: 'dots' },
};

export function categoryMeta(category: string): CategoryMeta {
  return CATEGORY_META[category as SpendCategory] ?? CATEGORY_META.other;
}

export function categoryLabel(category: string): string {
  return categoryMeta(category).label;
}
