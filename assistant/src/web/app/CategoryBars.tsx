import { categoryMeta } from './categories.js';
import { money } from './format.js';
import { Icon } from './ui.js';

/** Category spend as one-hue bars with fixed columns: name, bar, share, amount right-aligned. */
export function CategoryBars({ categories, max }: { categories: { category: string; totalMinor: number; sharePct: number; count?: number }[]; max: number }) {
  return (
    <ul className="cat-bars">
      {categories.map((c, i) => {
        const meta = categoryMeta(c.category);
        return (
          <li key={c.category} className={i === 0 ? 'is-top' : undefined}>
            <span className="cat-bar-name"><Icon name={meta.icon} size={16} />{meta.label}</span>
            <span className="cat-bar-track" aria-hidden="true"><span style={{ width: `${Math.max(3, (c.totalMinor / max) * 100)}%` }} /></span>
            <span className="cat-bar-share num">{c.sharePct}%</span>
            <span className="cat-bar-amount num">{money(c.totalMinor)}</span>
          </li>
        );
      })}
    </ul>
  );
}
