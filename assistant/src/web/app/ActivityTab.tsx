import { useMemo, useState } from 'react';
import { buildFeed, filterFeed, type FeedFilter, type FeedItem } from './feed.js';
import { FeedList } from './FeedList.js';
import { EmptyState, Skeleton } from './ui.js';
import type { WalletData } from './data.js';

const FILTERS: { id: FeedFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'payments', label: 'Payments' },
  { id: 'spending', label: 'Spending' },
  { id: 'income', label: 'Money in' },
  { id: 'declined', label: 'Declined' },
];

export function ActivityTab({ data, onOpen }: { data: WalletData | null; onOpen: (item: FeedItem) => void }) {
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [query, setQuery] = useState('');
  const feed = useMemo(() => (data ? buildFeed(data.view) : []), [data]);
  const shown = useMemo(() => filterFeed(feed, filter, query), [feed, filter, query]);

  if (!data) return <Skeleton height={320} />;

  return (
    <div className="stack">
      <div>
        <h1 className="page-title">Activity</h1>
        <p className="page-sub">Every payment, and everything you logged yourself. Tap one to see its receipt.</p>
      </div>
      <div className="card stack">
        <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
          <div className="chips" role="group" aria-label="Filter activity">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" className="chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          <label className="sr-only" htmlFor="activity-search">Search activity</label>
          <input
            id="activity-search"
            className="input"
            style={{ maxWidth: 260 }}
            type="search"
            placeholder="Search by name or note"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {shown.length === 0 ? (
          <EmptyState title={feed.length === 0 ? 'No activity yet' : 'Nothing matches'}>
            {feed.length === 0 ? 'Payments and logged spending show up here.' : 'Try a different filter or search.'}
          </EmptyState>
        ) : (
          <FeedList items={shown} onOpen={onOpen} />
        )}
      </div>
    </div>
  );
}
