import { Fragment, type CSSProperties } from 'react';
import { categoryLabel, categoryMeta, feedGlyph, incomeSourceLabel } from './categories.js';
import { groupByDay, money, monthDay, timeLabel } from './format.js';
import type { FeedItem } from './feed.js';
import { Icon } from './ui.js';

/** Inline tint for the glyph and tag: the material reads `--tint` / `--tint-strength`. */
function tintStyle(color: string): CSSProperties {
  return { '--tint': color, '--tint-strength': 'var(--tint-state)' } as CSSProperties;
}

/** Spend tags carry the category, income tags the source; ledger rows carry none. */
function tagFor(item: FeedItem): { label: string; color: string } | null {
  if (item.kind === 'income') {
    return { label: incomeSourceLabel(item.category ?? 'other'), color: 'var(--pos)' };
  }
  if (item.category) return { label: categoryLabel(item.category), color: categoryMeta(item.category).color };
  return null;
}

export function FeedRow({ item, onOpen, showTime = false }: { item: FeedItem; onOpen: (item: FeedItem) => void; showTime?: boolean }) {
  const incoming = item.signedMinor > 0 && item.kind !== 'declined';
  const declined = item.kind === 'declined';
  const sign = item.signedMinor > 0 ? '+' : item.signedMinor < 0 ? '−' : '';
  // Grouped lists already carry the day in their header, so rows show the time.
  // A flat list (Overview) has no header, so each row shows its date instead.
  const meta = showTime ? timeLabel(item.occurredAt) : monthDay(item.occurredAt);
  const amountClass = `v-amount num${incoming ? ' is-pos' : ''}${declined ? ' is-failed' : ''}`;
  const glyph = feedGlyph(item.kind, item.category);
  const tag = tagFor(item);
  const fallback = item.title.trim().charAt(0).toUpperCase() || '·';
  return (
    <li>
      <button type="button" className="v-row" onClick={() => onOpen(item)}>
        <span
          className="v-glyph glass-tint"
          style={glyph ? tintStyle(glyph.color) : undefined}
          aria-hidden="true"
        >
          {glyph ? <Icon name={glyph.icon} size={18} /> : fallback}
        </span>
        <span className="v-row-main">
          <span className="v-row-title">{item.title}</span>
          <span className="v-row-sub">
            {item.subtitle}{meta ? ` · ${meta}` : ''}
          </span>
        </span>
        {tag ? <span className="v-chip" style={tintStyle(tag.color)}>{tag.label}</span> : null}
        <span className={amountClass}>
          {sign}{money(Math.abs(item.signedMinor))}
        </span>
      </button>
    </li>
  );
}

export function FeedList({ items, onOpen, grouped = true, dayTotals = false, now = new Date() }: {
  items: FeedItem[];
  onOpen: (item: FeedItem) => void;
  grouped?: boolean;
  dayTotals?: boolean;
  now?: Date;
}) {
  if (!grouped) {
    return (
      <ul className="v-feed-list">
        {items.map((i) => <FeedRow key={i.id} item={i} onOpen={onOpen} />)}
      </ul>
    );
  }
  return (
    <div>
      {groupByDay(items.map((i) => ({ ...i })), now).map((g) => {
        const net = g.rows.reduce((total, item) => total + (item.kind === 'declined' ? 0 : item.signedMinor), 0);
        return (
          <Fragment key={g.label}>
            <div className="v-day-head">
              <p className="v-day-label">{g.label}</p>
              {dayTotals && net !== 0 ? <span className={`v-day-total num${net > 0 ? ' is-pos' : ''}`}>{net > 0 ? '+' : '−'}{money(Math.abs(net))}</span> : null}
            </div>
            <ul className="v-feed-list">
              {g.rows.map((i) => <FeedRow key={i.id} item={i} onOpen={onOpen} showTime />)}
            </ul>
          </Fragment>
        );
      })}
    </div>
  );
}
