import { Fragment } from 'react';
import { groupByDay, money, timeLabel } from './format.js';
import type { FeedItem } from './feed.js';
import { Icon, type IconName } from './ui.js';

const ICONS: Record<FeedItem['kind'], IconName> = {
  sent: 'send',
  received: 'receive',
  deposit: 'bank',
  declined: 'alert',
  spend: 'pencil',
  income: 'plus',
};

export function FeedRow({ item, onOpen, showTime = false }: { item: FeedItem; onOpen: (item: FeedItem) => void; showTime?: boolean }) {
  const incoming = item.signedMinor > 0 && item.kind !== 'declined';
  const amountClass = item.kind === 'declined' ? 'amount amount-failed' : incoming ? 'amount amount-in' : 'amount';
  const sign = item.signedMinor > 0 ? '+' : item.signedMinor < 0 ? '−' : '';
  return (
    <li>
      <button type="button" className="item" onClick={() => onOpen(item)}>
        <span className={`icon-circle${incoming ? ' icon-in' : ''}${item.kind === 'declined' ? ' icon-failed' : ''}`}>
          <Icon name={ICONS[item.kind]} size={18} />
        </span>
        <span className="item-body">
          <span className="item-title" style={{ display: 'block' }}>{item.title}</span>
          <span className="item-sub" style={{ display: 'block' }}>
            {item.subtitle}{showTime ? ` · ${timeLabel(item.occurredAt)}` : ''}
          </span>
        </span>
        <span className={amountClass}>
          {sign}{money(Math.abs(item.signedMinor))}
        </span>
      </button>
    </li>
  );
}

export function FeedList({ items, onOpen, grouped = true, now = new Date() }: {
  items: FeedItem[];
  onOpen: (item: FeedItem) => void;
  grouped?: boolean;
  now?: Date;
}) {
  if (!grouped) {
    return (
      <ul className="list">
        {items.map((i) => <FeedRow key={i.id} item={i} onOpen={onOpen} showTime />)}
      </ul>
    );
  }
  return (
    <div>
      {groupByDay(items.map((i) => ({ ...i })), now).map((g) => (
        <Fragment key={g.label}>
          <p className="day-label">{g.label}</p>
          <ul className="list">
            {g.rows.map((i) => <FeedRow key={i.id} item={i} onOpen={onOpen} showTime />)}
          </ul>
        </Fragment>
      ))}
    </div>
  );
}
