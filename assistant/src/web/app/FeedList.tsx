import { Fragment } from 'react';
import { categoryLabel } from './categories.js';
import { groupByDay, money, monthDay, timeLabel } from './format.js';
import type { FeedItem } from './feed.js';

export function FeedRow({ item, onOpen, showTime = false }: { item: FeedItem; onOpen: (item: FeedItem) => void; showTime?: boolean }) {
  const incoming = item.signedMinor > 0 && item.kind !== 'declined';
  const declined = item.kind === 'declined';
  const sign = item.signedMinor > 0 ? '+' : item.signedMinor < 0 ? '−' : '';
  // Grouped lists already carry the day in their header, so rows show the time.
  // A flat list (Overview) has no header, so each row shows its date instead.
  const meta = showTime ? timeLabel(item.occurredAt) : monthDay(item.occurredAt);
  const amountClass = `v-amount num${incoming ? ' is-pos' : ''}${declined ? ' is-failed' : ''}`;
  return (
    <li>
      <button type="button" className="v-row" onClick={() => onOpen(item)}>
        <span className="v-row-main">
          <span className="v-row-title">{item.title}</span>
          <span className="v-row-sub">
            {item.subtitle}{meta ? ` · ${meta}` : ''}
          </span>
        </span>
        {item.category ? <span className="v-chip">{categoryLabel(item.category)}</span> : null}
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
